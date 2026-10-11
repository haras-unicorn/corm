import { CormTurnHandler } from "corm/handlers/turn";
import { CORM_DEFAULT_CHAT_SYSTEM_PROMPT } from "corm/lib/defaults";
import type {
  CormConfig,
  CormOutcome,
  CormTaskSpec,
  CormTaskState,
} from "corm/lib/opaque";
import type { CormContext } from "corm/services/context";

export type CormEndpointMessage = OmwEvent & { kind: "endpoint-message" };

class CormChatHandler extends CormTurnHandler {
  private _session: string;
  private _origin: CormEndpointMessage;

  public static kind(): string {
    return "chat";
  }

  public static prompt(config: CormConfig): string {
    return config.chatSystemPrompt ?? CORM_DEFAULT_CHAT_SYSTEM_PROMPT;
  }

  public static should(event: OmwEvent): CormTaskSpec | undefined {
    if (event.kind === "endpoint-message") {
      return {
        placement: "immediate",
        atomic: true,
        key: event.payload.session,
        state: event,
      };
    }

    return undefined;
  }

  constructor(
    context: CormContext,
    id: string,
    taskState: CormTaskState,
    name: string = CormChatHandler.kind(),
  ) {
    super(context, id, name);

    this._origin = taskState as CormEndpointMessage;
    this._session = this._origin.payload.session;
    this._configure(this._origin.payload.params, [
      ...(this._origin.payload.tools ?? []),
    ]);

    this._task.description = `session ${this._context.window.sessionKey(
      this._origin.payload.messages,
    )}`;
  }

  public accepts(event: OmwEvent): boolean {
    switch (event.kind) {
      case "endpoint-message":
        return (
          this._phase === "chat" && event.payload.session === this._session
        );
      case "endpoint-session-end":
        return event.payload.session === this._session;
      case "error":
        return (
          super.accepts(event) ||
          event.id === this._context.handles.subscriptions().endpoint
        );
      default:
        return super.accepts(event);
    }
  }

  public handle(event: OmwEvent): CormOutcome {
    if (event.kind === "endpoint-message") {
      return this._onEndpointMessage(event);
    }

    if (event.kind === "endpoint-session-end") {
      this._context.logger.info(
        `session ${this._session} ended; completing the turn`,
      );
      this._cancelGeneration();
      return "complete";
    }

    if (
      event.kind === "error" &&
      event.id === this._context.handles.subscriptions().endpoint
    ) {
      this._context.logger.warn(
        "endpoint subscription errored; completing the session",
      );
      this._cancelGeneration();
      return "complete";
    }

    return super.handle(event);
  }

  protected _sinkContent(text: string): void {
    this._context.handles.host().streamEndpoint(this._session, {
      content: text,
    });
  }

  protected _sinkReasoning(text: string): void {
    this._context.handles.host().streamEndpoint(this._session, {
      reasoning: text,
    });
  }

  protected _sinkUsage(usage: Usage): void {
    this._context.handles.host().streamEndpoint(this._session, { usage });
  }

  protected _sinkFinish(reason: string): void {
    this._context.handles.host().streamEndpoint(this._session, {
      finishReason: reason,
    });
  }

  protected _sinkToolCall(call: ToolCall): void {
    this._context.handles.host().streamEndpoint(this._session, {
      toolCall: call,
    });
  }

  protected _sinkNotice(text: string): void {
    this._context.handles.host().streamEndpoint(this._session, {
      content: text,
    });
  }

  private _onEndpointMessage(event: CormEndpointMessage): CormOutcome {
    if (event !== this._origin) {
      this._context.logger.info(
        `session ${this._session} received a new message; restarting the turn`,
      );

      this._configure(event.payload.params ?? this._params, [
        ...this._clientTools,
        ...(event.payload.tools ?? []),
      ]);
      this._toolCallRetries = 0;
    } else {
      this._startTask();
    }

    this._cancelGeneration();

    const recap = this._context.window.recap(
      this._task,
      event.payload.messages,
    );

    if (recap.length > 0) {
      this._context.logger.debug(
        `appending a ${recap.length}-message recap for session ${this._session}`,
      );
      this._context.window.append(...recap);
    }

    this._context.window.ingest(this._session, event.payload.messages);

    if (this._context.window.overSoft()) {
      return this._beginCompaction(() => {
        this._beginTurn();
        return "running";
      });
    }

    this._beginTurn();
    return "running";
  }
}

export default CormChatHandler;
