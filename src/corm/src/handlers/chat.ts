import type { CormContext } from "../services/context";
import type { CormToolCall } from "../services/tooling";
import type {
  CormOutcome,
  CormTaskSpec,
  CormTaskState,
} from "../services/types";

type CormEndpointMessage = OmwEvent & { kind: "endpoint-message" };

class CormChatHandler {
  public static kind(): string {
    return "chat";
  }

  public static should(event: OmwEvent): CormTaskSpec | undefined {
    if (event.kind === "endpoint-message") {
      return {
        placement: "immediate",
        exclusive: true,
        key: event.payload.session,
        state: event,
      };
    }

    return undefined;
  }

  private _context: CormContext;

  private _taskState: CormEndpointMessage;
  private _session: string;
  private _messages: ChatMessage[];
  private _clientTools: ChatTool[];
  private _tools: ChatTool[];

  private _providerIndex: number;
  private _params: unknown;
  private _generation?: string;
  private _wake?: string;

  private _content: string;
  private _reasoning: string;
  private _finish?: string;
  private _toolCalls: Map<string, ToolCall>;
  private _toolOrder: string[];

  private _cormCalls: CormToolCall[];
  private _cormToolCalls: ToolCall[];
  private _awaiting: Map<string, CormToolCall>;
  private _results: Map<string, string>;

  constructor(context: CormContext, _id: string, taskState: CormTaskState) {
    this._context = context;
    this._taskState = taskState as CormEndpointMessage;
    this._session = this._taskState.payload.session;
    this._messages = [...this._taskState.payload.messages];
    this._clientTools = [...(this._taskState.payload.tools ?? [])];
    this._tools = this._computeTools();

    this._providerIndex = 0;
    this._params = this._taskState.payload.params;
    this._generation = undefined;
    this._wake = undefined;

    this._content = "";
    this._reasoning = "";
    this._finish = undefined;
    this._toolCalls = new Map();
    this._toolOrder = [];

    this._cormCalls = [];
    this._cormToolCalls = [];
    this._awaiting = new Map();
    this._results = new Map();
  }

  public accepts(event: OmwEvent): boolean {
    switch (event.kind) {
      case "endpoint-message":
        return event.payload.session === this._session;
      case "chat-delta":
      case "chat-end":
        return this._generation !== undefined && event.id === this._generation;
      case "tool-result":
      case "error":
        return (
          (this._generation !== undefined && event.id === this._generation) ||
          this._awaiting.has(event.id) ||
          this._context.handles.subscriptions().endpoint === event.id
        );
      case "endpoint-session-end":
        return event.payload.session === this._session;
      case "timer":
        return this._wake !== undefined && event.id === this._wake;
      default:
        return false;
    }
  }

  public handle(event: OmwEvent): CormOutcome {
    if (event.kind === "endpoint-message") {
      if (event !== this._taskState) {
        this._cancelGeneration();
        this._messages.push(...event.payload.messages);
        this._clientTools.push(...(event.payload.tools ?? []));
        this._tools = this._computeTools();
        this._params = event.payload.params ?? this._params;
      }

      this._beginTurn();
      return "running";
    }

    if (event.kind === "chat-delta") {
      this._onDelta(event.payload);
      return "running";
    }

    if (event.kind === "chat-end") {
      return this._onChatEnd();
    }

    if (event.kind === "error") {
      if (this._generation !== undefined && event.id === this._generation) {
        return this._fallback();
      }

      const settled = this._context.tooling.settle(event);
      if (settled !== undefined) {
        this._settleTool(
          settled.call,
          `Tool error: ${settled.error ?? "unknown"}`,
        );
        return "running";
      }

      if (event.id === this._context.handles.subscriptions().endpoint) {
        this._cancelGeneration();
        return "complete";
      }

      return "running";
    }

    if (event.kind === "tool-result") {
      const settled = this._context.tooling.settle(event);
      if (settled !== undefined) {
        this._settleTool(settled.call, toolResultText(settled.result));
      }
      return "running";
    }

    if (
      event.kind === "timer" &&
      this._wake !== undefined &&
      event.id === this._wake
    ) {
      this._wake = undefined;
      this._beginTurn();
      return "running";
    }

    if (event.kind === "endpoint-session-end") {
      this._cancelGeneration();
      return "complete";
    }

    return "running";
  }

  private _computeTools(): ChatTool[] {
    return [...this._context.tooling.definitions(), ...this._clientTools];
  }

  private _beginTurn(): void {
    const provider = this._context.handles.providers()[this._providerIndex];
    if (provider === undefined) {
      this._streamFinish("stop");
      return;
    }

    this._resetTurn();

    const model =
      this._context.config.load().model || provider.listModels()[0] || "";

    this._generation = provider.chatStream(
      model,
      this._messages,
      this._tools,
      this._params as object | string | undefined,
    );
    this._context.handles.subscriptions().generation = this._generation;
  }

  private _resetTurn(): void {
    this._content = "";
    this._reasoning = "";
    this._finish = undefined;
    this._toolCalls = new Map();
    this._toolOrder = [];
    this._cormCalls = [];
    this._cormToolCalls = [];
    this._awaiting = new Map();
    this._results = new Map();
  }

  private _onDelta(delta: ChatDelta): void {
    if (delta.reasoning !== undefined) {
      this._reasoning += delta.reasoning;
      this._context.handles
        .host()
        .streamEndpoint(this._session, { reasoning: delta.reasoning });
    }

    if (delta.content !== undefined) {
      this._content += delta.content;
      this._context.handles
        .host()
        .streamEndpoint(this._session, { content: delta.content });
    }

    if (delta.usage !== undefined) {
      this._context.handles
        .host()
        .streamEndpoint(this._session, { usage: delta.usage });
    }

    if (delta.toolCall !== undefined) {
      const call = delta.toolCall;
      const existing = this._toolCalls.get(call.id);
      if (existing === undefined) {
        this._toolCalls.set(call.id, call);
        this._toolOrder.push(call.id);
      } else {
        this._toolCalls.set(call.id, {
          ...existing,
          arguments: mergeArguments(existing.arguments, call.arguments),
        });
      }
    }

    if (delta.finishReason !== undefined) {
      this._finish = delta.finishReason;
    }
  }

  private _onChatEnd(): CormOutcome {
    const calls = this._toolOrder
      .map((id) => this._toolCalls.get(id))
      .filter((call): call is ToolCall => call !== undefined);

    const corm = calls.filter((call) => this._context.tooling.own(call.name));
    const client = calls.filter(
      (call) => !this._context.tooling.own(call.name),
    );

    for (const call of client) {
      this._context.handles
        .host()
        .streamEndpoint(this._session, { toolCall: call });
    }

    if (corm.length > 0) {
      this._cormToolCalls = corm;
      this._cormCalls = corm.map((call) =>
        this._context.tooling.invoke(call.name, call.arguments),
      );
      for (const invoked of this._cormCalls) {
        this._awaiting.set(invoked.uuid, invoked);
      }
      return "running";
    }

    if (client.length > 0) {
      this._streamFinish("tool_calls");
      return "complete";
    }

    this._streamFinish(this._finish ?? "stop");
    return "complete";
  }

  private _settleTool(call: CormToolCall, text: string): void {
    this._awaiting.delete(call.uuid);
    this._results.set(call.uuid, text);

    if (this._awaiting.size > 0) {
      return;
    }

    for (let index = 0; index < this._cormCalls.length; index++) {
      const invoked = this._cormCalls[index];
      const original = this._cormToolCalls[index];
      this._messages.push({
        role: "assistant",
        content: index === 0 ? this._content || undefined : undefined,
        toolCall: original,
      });
      this._messages.push({
        role: "tool",
        content: this._results.get(invoked.uuid) ?? "",
      });
    }

    this._resume();
  }

  private _resume(): void {
    this._wake = this._context.handles.host().waitFor(1);
  }

  private _fallback(): CormOutcome {
    this._generation = undefined;
    this._providerIndex += 1;

    if (this._providerIndex < this._context.handles.providers().length) {
      this._resume();
      return "running";
    }

    this._streamFinish("stop");
    return "complete";
  }

  private _streamFinish(reason: string): void {
    this._context.handles
      .host()
      .streamEndpoint(this._session, { finishReason: reason });
    this._context.handles.subscriptions().generation = undefined;
    this._generation = undefined;
  }

  private _cancelGeneration(): void {
    const subscription = this._context.handles.subscriptions();
    if (this._generation !== undefined) {
      for (const provider of this._context.handles.providers()) {
        if (provider.isOpen(this._generation)) {
          provider.cancel(this._generation);
        }
      }
      subscription.generation = undefined;
      this._generation = undefined;
    }
  }
}

function mergeArguments(previous: unknown, next: unknown): unknown {
  if (typeof previous === "string" && typeof next === "string") {
    return previous + next;
  }

  return next;
}

function toolResultText(result: ToolResult | undefined): string {
  if (result === undefined) {
    return "";
  }

  if (result.structuredContent !== undefined) {
    const structured = result.structuredContent as { content?: unknown };
    if (typeof structured?.content === "string") {
      return structured.content;
    }
  }

  const content = result.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        block != null &&
        typeof block === "object" &&
        "text" in block &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  return JSON.stringify(result.content ?? result.structuredContent ?? "");
}

export default CormChatHandler;
