import type { CormHandles } from "corm/services/handles";
import type {
  CormGlobalState,
  CormOutcome,
  CormTaskSpec,
  CormTaskState,
} from "corm/services/types";

class CormChatHandler {
  public static kind(): string {
    return "chat";
  }

  public static should(event: OmwEvent): CormTaskSpec | undefined {
    if (event.kind === "endpoint-message") {
      return {
        placement: "immediate",
        state: event,
      };
    }

    return undefined;
  }

  private _handles: CormHandles;
  private _taskState: OmwEvent & { kind: "endpoint-message" };
  private _last: (OmwEvent & { kind: "chat-delta" }) | undefined;

  constructor(
    handles: CormHandles,
    _globalState: CormGlobalState,
    _id: string,
    taskState: CormTaskState,
  ) {
    this._handles = handles;
    this._taskState = taskState;
    this._last = undefined;
  }

  public handle(event: OmwEvent): CormOutcome {
    if (event === this._taskState) {
      this._handles.subscriptions().generation = this._handles
        .main()
        .chatStream(
          "model",
          this._taskState.payload.messages,
          this._taskState.payload.tools,
        );
      return "running";
    }

    if (event.kind === "chat-delta") {
      this._handles.host().streamEndpoint(this._taskState.payload.session, {
        ...event.payload,
        finish_reason: undefined,
      });
      this._last = event.payload.finish_reason ? event : this._last;
      return "running";
    }

    if (
      event.kind === "endpoint-session-end" &&
      event.payload.session === this._taskState.payload.session
    ) {
      const generation = this._handles.subscriptions().generation;
      if (generation) {
        this._handles.main().cancel(generation);
      }
      this._handles.subscriptions().generation = undefined;
      return "complete";
    }

    if (event.kind === "chat-end") {
      this._handles.host().streamEndpoint(this._taskState.payload.session, {
        finish_reason: this._last?.payload.finish_reason ?? "stop",
      });
      this._handles.subscriptions().generation = undefined;
      return "complete";
    }

    if (event.kind === "error") {
      const generation = this._handles.subscriptions().generation;
      if (event.id === generation) {
        this._handles.host().streamEndpoint(this._taskState.payload.session, {
          finish_reason: "stop",
        });
        this._handles.subscriptions().generation = undefined;
        return "complete";
      }

      const endpoint = this._handles.subscriptions().endpoint;
      if (event.id === endpoint) {
        if (generation) {
          this._handles.main().cancel(generation);
          this._handles.subscriptions().generation = undefined;
        }
        return "complete";
      }
    }

    throw new Error(`unable to handle event ${JSON.stringify(event)}`);
  }
}

export default CormChatHandler;
