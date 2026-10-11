import { matchTaggedUnionExhaustively } from "corm/types/fns";
import type { CormApprovedEffect } from "../effects";
import type {
  CormForwardClientToolCallEffect,
  CormInvokeCormToolEffect,
  CormRetryTextToolCallEffect,
} from "../effects/generation";
import type { CormFoldChatDeltaEffect } from "../effects/stream";
import type {
  CormAppendToolResultEffect,
  CormEnqueueInboundEffect,
} from "../effects/window";
import {
  CORM_DEFAULT_COMPACT_PROMPT,
  CORM_DEFAULT_RECAP_END_NOTICE,
  CORM_DEFAULT_RECAP_NOTICE,
} from "../lib/defaults";
import { runtimeMessage } from "../lib/framing";
import { toolCallKey } from "../lib/tokens";
import { isTurnCompacting } from "../lib/turn";
import {
  appendInboundMessages,
  appendReplayMessages,
  appendRuntimeMessage,
  appendSummaryDelta,
  appendToolResult,
  commitCompaction,
  dropLastExchange,
  enqueueInbound,
  fillNotice,
  foldAssistantDelta,
  recount,
  setActiveRequest,
  windowInput,
} from "../lib/window";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";
import type { CormHandles } from "./handles";
import type { CormLogger } from "./logger";

export interface CormDispatcher {
  dispatch(effect: CormApprovedEffect): void;
}

export const createDispatcher = (
  logger: CormLogger,
  handles: CormHandles,
  config: CormConfig,
  state: CormState,
) => new CormOmwDispatcher(logger, handles, config, state) as CormDispatcher;

class CormOmwDispatcher {
  private _logger: CormLogger;
  private _handles: CormHandles;
  private _config: CormConfig;
  private _state: CormState;

  constructor(
    logger: CormLogger,
    handles: CormHandles,
    config: CormConfig,
    state: CormState,
  ) {
    this._logger = logger;
    this._handles = handles;
    this._config = config;
    this._state = state;
  }

  public dispatch(effect: CormApprovedEffect): void {
    this._logger.debug(`dispatching effect ${effect.kind}`);

    matchTaggedUnionExhaustively("kind", effect, {
      "start-chat-generation": () => this._startChatGeneration(),
      "start-compaction-generation": (event) =>
        this._startCompactionGeneration(event),
      "commit-compaction": () => this._commitCompaction(),
      "cancel-generation": () => this._cancelGeneration(),
      "clear-generation": () => this._clearGeneration(),
      "invoke-corm-tool": (event) => this._invokeCormTool(event),
      "forward-client-tool-call": (event) => this._forwardClientToolCall(event),
      "retry-text-tool-call": (event) => this._retryTextToolCall(event),
      "circuit-break": (event) => this._circuitBreak(event),
      "set-active-request": (event) => this._setActiveRequest(event),
      "append-inbound-messages": (event) =>
        appendInboundMessages(
          this._state.disk.window,
          event.messages,
          this._state.disk.receipts,
          this._config,
        ),
      "enqueue-inbound": (event) => this._enqueueInbound(event),
      "append-recap": (event) => this._appendRecap(event),
      "append-runtime-message": (event) =>
        appendRuntimeMessage(
          this._state.disk.window,
          event.content,
          this._config,
        ),
      "append-tool-result": (event) => this._appendToolResult(event),
      "fold-chat-delta": (event) => this._foldChatDelta(event),
      "stream-endpoint-delta": (event) =>
        this._handles
          .host()
          .streamEndpoint(this._state.disk.window.session, event.delta),
      noop: (event) => this._logger.debug(`dropped ${event.dropped} event`),
    });
  }

  private _startChatGeneration(): void {
    const window = this._state.disk.window;
    recount(window, this._config);

    const tools = [...window.tools, ...window.clientTools];
    const model = this._config.model;
    const input = windowInput(window, this._config);
    const generation =
      window.params === undefined || window.params === null
        ? this._handles.chat(model, input, tools)
        : this._handles.chat(
            model,
            input,
            tools,
            window.params as object | string,
          );

    this._state.memory.subscriptions.generation = generation;
    this._state.disk.turn.summary = undefined;
    this._state.disk.window.anchor = undefined;
  }

  private _startCompactionGeneration(
    effect: Extract<
      CormApprovedEffect,
      { kind: "start-compaction-generation" }
    >,
  ): void {
    const window = this._state.disk.window;

    const messages = [
      ...windowInput(window, this._config),
      runtimeMessage(this._config.compactPrompt ?? CORM_DEFAULT_COMPACT_PROMPT),
    ];

    const generation = this._handles.chat(
      this._config.model,
      messages,
      [],
      (this._config.compactParams ?? {}) as object,
    );

    this._state.memory.subscriptions.generation = generation;
    this._state.disk.turn.summary = "";
    this._state.disk.turn.resume = effect.resume;
  }

  private _commitCompaction(): void {
    const window = this._state.disk.window;
    commitCompaction(
      window,
      this._state.disk.turn.summary ?? "",
      this._state.disk.receipts,
      this._config,
    );
    this._state.disk.turn.summary = undefined;
  }

  private _cancelGeneration(): void {
    const generation = this._state.memory.subscriptions.generation;
    if (generation !== undefined) {
      this._handles.cancel(generation);
    }

    this._state.memory.subscriptions.generation = undefined;
    this._state.disk.turn.summary = undefined;
  }

  private _clearGeneration(): void {
    this._state.memory.subscriptions.generation = undefined;
    this._state.disk.turn.summary = undefined;
    this._state.disk.turn.resume = false;
  }

  private _setActiveRequest(
    effect: Extract<CormApprovedEffect, { kind: "set-active-request" }>,
  ): void {
    setActiveRequest(
      this._state.disk.window,
      effect.session,
      effect.params,
      effect.clientTools,
    );

    // A new endpoint request opens a new user turn: the text-tool-call retry and
    // circuit-breaker counters are scoped to it.
    this._state.disk.turn.toolCallRetries = 0;
    this._state.disk.turn.toolCalls = {};
    this._state.disk.task += 1;
  }

  private _appendRecap(
    effect: Extract<CormApprovedEffect, { kind: "append-recap" }>,
  ): void {
    const notice = fillNotice(
      this._config.recapNotice ?? CORM_DEFAULT_RECAP_NOTICE,
      { name: "chat", id: this._state.disk.task, description: "" },
    );
    appendRuntimeMessage(this._state.disk.window, notice, this._config);
    appendReplayMessages(this._state.disk.window, effect.replay, this._config);
    appendRuntimeMessage(
      this._state.disk.window,
      this._config.recapEndNotice ?? CORM_DEFAULT_RECAP_END_NOTICE,
      this._config,
    );
  }

  private _enqueueInbound(effect: CormEnqueueInboundEffect): void {
    enqueueInbound(this._state.disk.inbox, effect.event);
  }

  private _retryTextToolCall(effect: CormRetryTextToolCallEffect): void {
    appendRuntimeMessage(this._state.disk.window, effect.hint, this._config);
    this._state.disk.turn.toolCallRetries += 1;
  }

  private _circuitBreak(
    effect: Extract<CormApprovedEffect, { kind: "circuit-break" }>,
  ): void {
    dropLastExchange(this._state.disk.window);
    appendRuntimeMessage(this._state.disk.window, effect.hint, this._config);
    recount(this._state.disk.window, this._config);
  }

  private _invokeCormTool(effect: CormInvokeCormToolEffect): void {
    this._state.memory.subscriptions.generation = undefined;
    this._state.disk.turn.summary = undefined;

    const key = toolCallKey(effect.name, effect.arguments);
    this._state.disk.turn.toolCalls[key] =
      (this._state.disk.turn.toolCalls[key] ?? 0) + 1;

    const uuid = this._handles.call(effect.name, effect.arguments);
    this._state.disk.turn.awaiting[uuid] = {
      name: effect.name,
      arguments: effect.arguments,
    };
  }

  private _forwardClientToolCall(
    effect: CormForwardClientToolCallEffect,
  ): void {
    this._handles.host().streamEndpoint(this._state.disk.window.session, {
      toolCall: effect.toolCall,
    });
  }

  private _appendToolResult(effect: CormAppendToolResultEffect): void {
    appendToolResult(this._state.disk.window, effect.result, this._config);
    delete this._state.disk.turn.awaiting[effect.id];
  }

  private _foldChatDelta(effect: CormFoldChatDeltaEffect): void {
    const usage = effect.delta.usage;
    if (usage !== undefined) {
      const anchor = (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
      if (anchor > 0) {
        this._state.disk.window.anchor = anchor;
      }
    }

    if (isTurnCompacting(this._state)) {
      appendSummaryDelta(this._state.disk.turn, effect.delta, this._config);
      return;
    }

    foldAssistantDelta(this._state.disk.window, effect.delta, this._config);
  }
}
