import {
  CORM_DEFAULT_CIRCUIT_BREAKER_HINT,
  CORM_DEFAULT_CIRCUIT_BREAKER_LIMIT,
  CORM_DEFAULT_COMPACT_NOTICE,
  CORM_DEFAULT_COMPACT_PARAMS,
  CORM_DEFAULT_COMPACT_PROMPT,
  CORM_DEFAULT_COMPACT_SUMMARY_LIMIT,
  CORM_DEFAULT_HARD_THRESHOLD,
  CORM_DEFAULT_TOOL_CALL_HINT,
  CORM_DEFAULT_TOOL_CALL_PATTERN,
  CORM_DEFAULT_TOOL_CALL_RETRY_LIMIT,
} from "corm/lib/defaults";
import { runtimeMessage } from "corm/lib/framing";
import type { CormOutcome, CormTaskIdentity } from "corm/lib/opaque";
import { estimateTokenChars } from "corm/lib/tokens";
import { mergeToolArguments, toolResultText } from "corm/lib/tools";
import type { CormContext } from "corm/services/context";
import type { CormToolCall } from "corm/services/tooling";

export abstract class CormTurnHandler {
  protected _context: CormContext;

  protected _task: CormTaskIdentity;
  protected _started: boolean;

  protected _clientTools: ChatTool[];
  protected _tools: ChatTool[];

  protected _providerIndex: number;
  protected _params: unknown;
  protected _generation?: string;
  protected _wake?: string;
  protected _phase: "chat" | "compact";
  protected _summaryBuffer: string;
  protected _continue?: () => CormOutcome;
  protected _toolCallRetries: number;

  protected _content: string;
  protected _reasoning: string;
  protected _finish?: string;
  protected _toolCalls: Map<string, ToolCall>;
  protected _toolOrder: string[];

  protected _cormCalls: CormToolCall[];
  protected _cormToolCalls: ToolCall[];
  protected _awaiting: Map<string, CormToolCall>;
  protected _results: Map<string, string>;

  constructor(context: CormContext, id: string, name: string) {
    this._context = context;
    this._task = { name, id };
    this._started = false;

    this._clientTools = [];
    this._tools = this._computeTools();

    this._providerIndex = 0;
    this._params = undefined;
    this._generation = undefined;
    this._wake = undefined;
    this._phase = "chat";
    this._summaryBuffer = "";
    this._continue = undefined;
    this._toolCallRetries = 0;

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
      case "chat-delta":
      case "chat-end":
        return this._generation !== undefined && event.id === this._generation;
      case "tool-result":
      case "error":
        return (
          (this._generation !== undefined && event.id === this._generation) ||
          this._awaiting.has(event.id)
        );
      case "timer":
        return this._wake !== undefined && event.id === this._wake;
      default:
        return false;
    }
  }

  public handle(event: OmwEvent): CormOutcome {
    if (event.kind === "chat-delta") {
      return this._onDelta(event.payload);
    }

    if (event.kind === "chat-end") {
      return this._onChatEnd();
    }

    if (event.kind === "error") {
      if (this._generation !== undefined && event.id === this._generation) {
        if (this._phase === "compact") {
          return this._retryCompaction();
        }

        return this._fallback();
      }

      const settled = this._context.tooling.settle(event);
      if (settled !== undefined) {
        this._context.logger.error(
          `tool ${settled.call.exposed} errored: ${settled.error ?? "unknown"}`,
        );
        return this._settleTool(
          settled.call,
          `Tool error: ${settled.error ?? "unknown"}`,
        );
      }

      return "running";
    }

    if (event.kind === "tool-result") {
      const settled = this._context.tooling.settle(event);
      if (settled !== undefined) {
        return this._settleTool(settled.call, toolResultText(settled.result));
      }
      return "running";
    }

    if (
      event.kind === "timer" &&
      this._wake !== undefined &&
      event.id === this._wake
    ) {
      this._wake = undefined;

      if (this._phase === "compact") {
        return this._beginCompaction(
          this._continue ?? (() => "complete" as const),
        );
      }

      this._beginTurn();
      return "running";
    }

    return "running";
  }

  protected abstract _sinkContent(text: string): void;

  protected abstract _sinkReasoning(text: string): void;

  protected abstract _sinkUsage(usage: Usage): void;

  protected abstract _sinkFinish(reason: string): void;

  protected abstract _sinkToolCall(call: ToolCall): void;

  protected abstract _sinkNotice(text: string): void;

  protected _configure(params: unknown, clientTools: ChatTool[]): void {
    this._params = params;
    this._clientTools = clientTools;
    this._tools = this._computeTools();
  }

  protected _startTask(): void {
    if (this._started) {
      return;
    }

    this._started = true;
    this._context.window.append(...this._context.window.start(this._task));
  }

  protected _computeTools(): ChatTool[] {
    return [...this._context.tooling.definitions(), ...this._clientTools];
  }

  protected _beginTurn(): void {
    const provider = this._context.handles.providers()[this._providerIndex];
    if (provider === undefined) {
      this._context.logger.warn(
        "no provider left for the turn; finishing with stop",
      );
      this._streamFinish("stop");
      return;
    }

    this._resetTurn();

    const model = this._context.config.model || provider.listModels()[0] || "";
    const messages = this._context.window.input();

    this._context.logger.info(
      `starting turn on provider ${provider.name} model ${model} with ${messages.length} message(s) and ${this._tools.length} tool(s)`,
    );

    this._generation = provider.chatStream(
      model,
      messages,
      this._tools,
      this._params as object | string | undefined,
    );
    this._context.handles.subscriptions().generation = this._generation;
  }

  protected _resetTurn(): void {
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

  protected _onDelta(delta: ChatDelta): CormOutcome {
    if (this._phase === "compact") {
      if (delta.content !== undefined) {
        this._summaryBuffer += delta.content;
        const limit = estimateTokenChars(
          this._context.config.compactSummaryLimit ??
            CORM_DEFAULT_COMPACT_SUMMARY_LIMIT,
        );
        if (this._summaryBuffer.length > limit) {
          this._summaryBuffer = this._summaryBuffer.slice(0, limit);
        }
      }

      return "running";
    }

    if (delta.reasoning !== undefined) {
      this._reasoning += delta.reasoning;
      this._sinkReasoning(delta.reasoning);
    }

    if (delta.content !== undefined) {
      this._content += delta.content;
      this._sinkContent(delta.content);
    }

    if (delta.usage !== undefined) {
      this._sinkUsage(delta.usage);

      if (delta.usage.promptTokens !== undefined) {
        this._context.window.anchor(delta.usage.promptTokens);
      }
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
          arguments: mergeToolArguments(existing.arguments, call.arguments),
        });
      }
    }

    if (delta.finishReason !== undefined) {
      this._finish = delta.finishReason;
    }

    if (this._overHard()) {
      return this._hardCompact();
    }

    return "running";
  }

  private _overHard(): boolean {
    const hardThreshold =
      this._context.config.hardThreshold ?? CORM_DEFAULT_HARD_THRESHOLD;

    const inflight: ChatMessage = {
      role: "assistant",
      content: this._content || undefined,
      reasoning: this._reasoning || undefined,
    };

    return (
      this._context.window.tokens(inflight) >
      hardThreshold * this._context.config.contextLength
    );
  }

  private _hardCompact(): CormOutcome {
    this._context.logger.info(
      "hard context limit reached; compacting mid-turn",
    );

    this._cancelGeneration();

    this._sinkNotice(
      this._context.config.compactNotice ?? CORM_DEFAULT_COMPACT_NOTICE,
    );

    return this._beginCompaction(() => this._resumeTurn());
  }

  private _textToolCall(): boolean {
    const pattern =
      this._context.config.toolCallPattern ?? CORM_DEFAULT_TOOL_CALL_PATTERN;

    const text = this._content !== "" ? this._content : this._reasoning;

    if (pattern === "" || text === "") {
      return false;
    }

    try {
      return new RegExp(pattern).test(text);
    } catch (error) {
      this._context.logger.error(
        `invalid toolCallPattern: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  private _toolCallRetryLimit(): number {
    return (
      this._context.config.toolCallRetryLimit ??
      CORM_DEFAULT_TOOL_CALL_RETRY_LIMIT
    );
  }

  protected _onChatEnd(): CormOutcome {
    if (this._phase === "compact") {
      return this._finishCompaction();
    }

    const calls = this._toolOrder
      .map((id) => this._toolCalls.get(id))
      .filter((call): call is ToolCall => call !== undefined);

    const corm = calls.filter((call) => this._context.tooling.own(call.name));
    const client = calls.filter(
      (call) => !this._context.tooling.own(call.name),
    );

    this._context.logger.debug(
      `chat ended with finish ${this._finish ?? "stop"}; ${corm.length} corm tool call(s) and ${client.length} client tool call(s)`,
    );

    for (const call of client) {
      this._context.logger.trace(`forwarding client tool call ${call.name}`);
      this._sinkToolCall(call);
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

    if (this._textToolCall()) {
      const limit = this._toolCallRetryLimit();

      if (this._toolCallRetries < limit) {
        this._toolCallRetries += 1;
        this._context.logger.warn(
          `tool call emitted as text; appending the hint and retrying (${this._toolCallRetries}/${limit})`,
        );
        this._context.window.append(
          runtimeMessage(
            this._context.config.toolCallHint ?? CORM_DEFAULT_TOOL_CALL_HINT,
          ),
        );
        return this._resumeTurn();
      }

      this._context.logger.warn(
        "tool call emitted as text and the retry limit is reached; finishing",
      );
    }

    this._storeReply();
    this._streamFinish(this._finish ?? "stop");

    if (this._context.window.overSoft()) {
      return this._beginCompaction(() => "complete");
    }

    return "complete";
  }

  protected _settleTool(call: CormToolCall, text: string): CormOutcome {
    this._context.logger.trace(
      `settling corm tool ${call.exposed} (${call.uuid})`,
    );

    this._awaiting.delete(call.uuid);
    this._results.set(call.uuid, text);

    if (this._awaiting.size > 0) {
      this._context.logger.debug(
        `waiting on ${this._awaiting.size} more tool result(s)`,
      );
      return "running";
    }

    for (let index = 0; index < this._cormCalls.length; index++) {
      const invoked = this._cormCalls[index];
      const original = this._cormToolCalls[index];
      this._context.window.append(
        {
          role: "assistant",
          content: index === 0 ? this._content || undefined : undefined,
          toolCall: original,
        },
        {
          role: "tool",
          content: this._results.get(invoked.uuid) ?? "",
        },
      );
    }

    this._breakCircuits();

    if (this._context.window.overSoft()) {
      return this._beginCompaction(() => this._resumeTurn());
    }

    return this._resumeTurn();
  }

  private _breakCircuits(): void {
    const limit = this._circuitBreakerLimit();

    for (const original of this._cormToolCalls) {
      const count = this._context.window.noteToolCall(
        original.name,
        original.arguments,
      );

      if (count < limit) {
        continue;
      }

      const removed = this._context.window.dropDuplicateToolExchanges(
        original.name,
        original.arguments,
      );

      this._context.logger.warn(
        `circuit breaker tripped on ${original.name} after ${count} call(s); removed ${removed} repeated exchange(s)`,
      );

      this._context.window.append(
        runtimeMessage(
          this._context.config.circuitBreakerHint ??
            CORM_DEFAULT_CIRCUIT_BREAKER_HINT,
        ),
      );
    }
  }

  private _circuitBreakerLimit(): number {
    return (
      this._context.config.circuitBreakerLimit ??
      CORM_DEFAULT_CIRCUIT_BREAKER_LIMIT
    );
  }

  private _resumeTurn(): CormOutcome {
    this._resume();
    return "running";
  }

  protected _resume(): void {
    this._context.logger.trace("scheduling the next turn");
    this._wake = this._context.handles.host().waitFor(1);
  }

  protected _beginCompaction(cont: () => CormOutcome): CormOutcome {
    const provider = this._context.handles.providers()[this._providerIndex];
    const { evictable } = this._context.window.partition();

    if (provider === undefined || evictable.length === 0) {
      this._context.logger.error(
        `cannot compact (provider=${provider?.name ?? "none"}, evictable=${evictable.length}); continuing`,
      );
      return cont();
    }

    this._phase = "compact";
    this._continue = cont;
    this._summaryBuffer = "";

    const model = this._context.config.model || provider.listModels()[0] || "";

    this._context.logger.info(
      `compacting ${evictable.length} message(s) on provider ${provider.name}`,
    );

    // The compaction instruction is appended to the outbound messages only, so
    // the shared window prefix is reused from the KV cache but the instruction
    // itself never enters the window (it must not displace the protected tail or
    // be re-sent on the resumed turn).
    this._generation = provider.chatStream(
      model,
      [
        ...this._context.window.input(),
        runtimeMessage(
          this._context.config.compactPrompt ?? CORM_DEFAULT_COMPACT_PROMPT,
        ),
      ],
      [],
      this._context.config.compactParams ?? CORM_DEFAULT_COMPACT_PARAMS,
    );
    this._context.handles.subscriptions().generation = this._generation;

    return "running";
  }

  protected _finishCompaction(): CormOutcome {
    const cont = this._continue;
    this._continue = undefined;

    this._context.window.compact(this._summaryBuffer);
    this._summaryBuffer = "";
    this._phase = "chat";
    this._context.handles.subscriptions().generation = undefined;
    this._generation = undefined;

    this._context.logger.info("compaction finished");

    return cont !== undefined ? cont() : "complete";
  }

  protected _retryCompaction(): CormOutcome {
    this._context.logger.warn("compaction failed; retrying after a short wait");

    this._summaryBuffer = "";
    this._generation = undefined;
    this._context.handles.subscriptions().generation = undefined;
    this._resume();

    return "running";
  }

  protected _fallback(): CormOutcome {
    this._context.logger.warn(
      `provider ${this._context.handles.providers()[this._providerIndex]?.name ?? this._providerIndex} failed; falling back`,
    );

    this._generation = undefined;
    this._providerIndex += 1;

    if (this._providerIndex < this._context.handles.providers().length) {
      this._resume();
      return "running";
    }

    this._context.logger.info("no provider fallback left; finishing with stop");
    this._storeReply();
    this._streamFinish("stop");
    return "complete";
  }

  // The provider's answer is streamed to the client but must also enter the
  // window: otherwise the model never sees that it already replied, so it
  // re-answers an earlier (possibly another session's) message. Only the
  // visible content is stored, and it is stored in the same shape a client
  // echoes it back in, so `ingest` classifies the re-offer as `current` and
  // does not duplicate it (reasoning is deliberately not stored).
  protected _storeReply(): void {
    const content = this._content || undefined;
    if (content === undefined) {
      return;
    }

    this._context.logger.debug("storing the assistant reply in the window");
    this._context.window.append({ role: "assistant", content });
  }

  protected _streamFinish(reason: string): void {
    this._context.logger.debug(`finishing stream with reason ${reason}`);
    this._sinkFinish(reason);
    this._context.handles.subscriptions().generation = undefined;
    this._generation = undefined;
  }

  protected _cancelGeneration(): void {
    const subscription = this._context.handles.subscriptions();
    if (this._generation !== undefined) {
      for (const provider of this._context.handles.providers()) {
        if (provider.isOpen(this._generation)) {
          this._context.logger.debug(
            `cancelling generation ${this._generation} on ${provider.name}`,
          );
          provider.cancel(this._generation);
        }
      }
      subscription.generation = undefined;
      this._generation = undefined;
    }
  }
}
