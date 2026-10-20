import { matchTaggedUnionExhaustively } from "corm/types/fns";
import type { CormApprovedEffect } from "../effects";
import type {
  CormCommitDigestEffect,
  CormQueueDigestEffect,
} from "../effects/digest";
import type {
  CormInvokeCormToolsEffect,
  CormRetryTextToolCallEffect,
} from "../effects/generation";
import type { CormFoldChatDeltaEffect } from "../effects/stream";
import type {
  CormAppendToolResultEffect,
  CormEnqueueInboundEffect,
  CormQueueNoticeEffect,
} from "../effects/window";
import {
  CORM_DEFAULT_COMPACT_PROMPT,
  CORM_DEFAULT_DIGEST_LOOKBACK_MS,
  CORM_DEFAULT_DIGEST_PROMPT,
  CORM_DEFAULT_DIGEST_RESUME_NOTICE,
  CORM_DEFAULT_DIGEST_START_NOTICE,
  CORM_DEFAULT_RECAP_END_NOTICE,
  CORM_DEFAULT_RECAP_NOTICE,
} from "../lib/defaults";
import { isDigestDue, isDigestEnabled } from "../lib/digest";
import { runtimeMessage } from "../lib/framing";
import { toolCallKey, usageAnchor } from "../lib/tokens";
import { errorToolResult, parseToolArguments } from "../lib/tools";
import {
  hasAwaitingTools,
  isTurnCompacting,
  isTurnIdling,
} from "../lib/turn";
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

const isoTime = (ts: number): string => new Date(ts).toISOString();

export interface CormDispatcher {
  dispatch(effect: CormApprovedEffect): void;
  // Starts the digest the subscriptions parked for the next safe point.
  startPendingDigest(): void;
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
  private _toolResults: {
    order: number;
    name: string;
    result: ToolResult;
    toolCallId: string | undefined;
  }[] = [];

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
    this._startup();
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
      "invoke-corm-tools": (event) => this._invokeCormTools(event),
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
      "stream-endpoint-delta": (event) => this._streamEndpointDelta(event),
      "arm-digest-timer": () => this._armDigestTimer(),
      "start-digest": () => this._startDigest(),
      "queue-digest": (event) => this._queueDigest(event),
      "commit-digest": (event) => this._commitDigest(event),
      "queue-notice": (event) => this._queueNotice(event),
      "flush-notices": () => this._flushNotices(),
      noop: (event) => this._logger.debug(`dropped ${event.dropped} event`),
    });
  }

  private _startChatGeneration(): void {
    const window = this._state.disk.window;
    recount(window, this._config);

    const tools = window.tools;
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
      try {
        this._handles.cancel(generation);
      } catch (error) {
        // The stream may have ended already; the cancellation was a no-op.
        this._logger.warn(
          `could not cancel generation ${generation}: ${(error as Error).message}`,
        );
      }
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
    setActiveRequest(this._state.disk.window, effect.session, effect.params);

    if (effect.droppedClientTools.length > 0) {
      this._logger.warn(
        `dropping client tools: ${effect.droppedClientTools.join(", ")}`,
      );
    }

    // A new endpoint request opens a new user turn: the text-tool-call retry and
    // circuit-breaker counters are scoped to it.
    this._state.disk.turn.toolCallRetries = 0;
    this._state.disk.turn.toolCalls = {};
    this._state.disk.task += 1;
  }

  private _streamEndpointDelta(
    effect: Extract<CormApprovedEffect, { kind: "stream-endpoint-delta" }>,
  ): void {
    const session = this._state.disk.window.session;
    if (session === "") {
      return;
    }

    this._handles.host().streamEndpoint(session, effect.delta);
  }

  // Startup is the digest catch-up point: a missed run is parked for the next
  // safe point, otherwise the cron is armed.
  private _startup(): void {
    if (!isDigestEnabled(this._config)) {
      return;
    }

    if (
      isDigestDue(
        this._state.disk.digest.last,
        this._handles.host().timeNow(),
        this._config,
      )
    ) {
      this._state.memory.subscriptions.digest = { pending: "start" };
      this._logger.debug("digest catch-up pending");
      return;
    }

    this._armDigestTimer();
  }

  public startPendingDigest(): void {
    const pending = this._state.memory.subscriptions.digest?.pending;
    if (pending === undefined) {
      return;
    }

    if (!isTurnIdling(this._state) || hasAwaitingTools(this._state)) {
      return;
    }

    if (pending === "resume") {
      this._resumeDigest();
      return;
    }

    this._startDigest();
  }

  private _armDigestTimer(): void {
    // Arming is also the digest's terminal step: it clears the in-flight flag
    // on success, failure and a skipped fire alike.
    this._state.disk.turn.digest = false;
    this._state.disk.turn.digestSince = undefined;

    const cron = this._config.digestCron;
    if (typeof cron !== "string") {
      this._state.memory.subscriptions.digest = undefined;
      return;
    }

    const uuid = this._handles.host().waitCron(cron);
    this._state.memory.subscriptions.digest = { timer: uuid };
    this._logger.debug(`armed digest timer ${uuid} for ${cron}`);
  }

  private _startDigest(): void {
    const host = this._handles.host();
    const now = host.timeNow();
    const last = this._state.disk.digest.last;
    const since =
      last ??
      now - (this._config.digestLookbackMs ?? CORM_DEFAULT_DIGEST_LOOKBACK_MS);
    const template = this._config.digestPrompt ?? CORM_DEFAULT_DIGEST_PROMPT;
    const feeds = (this._config.digestFeeds ?? []).join(", ");
    const body = template
      .replaceAll("{{FEEDS}}", feeds)
      .replaceAll("{{SINCE}}", isoTime(since))
      .replaceAll("{{NOW}}", isoTime(now));
    const notice =
      this._config.digestStartNotice ?? CORM_DEFAULT_DIGEST_START_NOTICE;

    this._state.memory.subscriptions.digest = undefined;
    this._state.disk.turn.digest = true;
    this._state.disk.turn.digestSince = now;
    this._state.disk.window.session = "";
    this._state.disk.window.params = undefined;
    this._state.disk.turn.toolCallRetries = 0;
    this._state.disk.turn.toolCalls = {};
    this._state.disk.task += 1;

    this._flushNotices();
    appendRuntimeMessage(
      this._state.disk.window,
      `${notice}\n\n${body}`,
      this._config,
    );

    this._logger.info(
      `starting digest for ${feeds === "" ? "no feeds" : feeds}`,
    );
    this._startChatGeneration();
  }

  // A preempted digest keeps its prompt and partial answer in the window, so it
  // resumes with a notice instead of appending the prompt again.
  private _resumeDigest(): void {
    this._state.memory.subscriptions.digest = undefined;
    this._state.disk.turn.digest = true;
    this._state.disk.window.session = "";
    this._state.disk.window.params = undefined;
    this._state.disk.turn.toolCallRetries = 0;
    this._state.disk.turn.toolCalls = {};
    this._state.disk.task += 1;
    this._flushNotices();
    appendRuntimeMessage(
      this._state.disk.window,
      this._config.digestResumeNotice ?? CORM_DEFAULT_DIGEST_RESUME_NOTICE,
      this._config,
    );
    this._logger.info("resuming digest");
    this._startChatGeneration();
  }

  private _queueDigest(effect: CormQueueDigestEffect): void {
    // A preempted digest stops being the active turn, so the endpoint answer
    // that follows is not committed as a digest. `digestSince` is kept so the
    // resumed turn commits the original start time.
    if (effect.resume === true) {
      this._state.disk.turn.digest = false;
    }

    this._state.memory.subscriptions.digest = {
      ...(this._state.memory.subscriptions.digest ?? {}),
      pending: effect.resume === true ? "resume" : "start",
    };
    this._logger.debug(
      `queued digest (${effect.resume === true ? "resume" : "start"})`,
    );
  }

  private _commitDigest(effect: CormCommitDigestEffect): void {
    this._state.disk.digest.last = effect.at;
    this._logger.info(`committed digest at ${effect.at}`);
  }

  private _queueNotice(effect: CormQueueNoticeEffect): void {
    if (!this._state.disk.notices.includes(effect.notice)) {
      this._state.disk.notices.push(effect.notice);
      this._logger.debug("queued runtime notice");
    }
  }

  private _flushNotices(): void {
    if (this._state.disk.notices.length === 0) {
      return;
    }

    for (const notice of this._state.disk.notices) {
      appendRuntimeMessage(this._state.disk.window, notice, this._config);
    }

    this._state.disk.notices = [];
    this._logger.debug("flushed runtime notices");
  }

  private _appendRecap(
    effect: Extract<CormApprovedEffect, { kind: "append-recap" }>,
  ): void {
    const notice = fillNotice(
      effect.notice ?? this._config.recapNotice ?? CORM_DEFAULT_RECAP_NOTICE,
      { name: "endpoint", id: this._state.disk.task, description: "" },
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

  private _invokeCormTools(effect: CormInvokeCormToolsEffect): void {
    this._state.memory.subscriptions.generation = undefined;
    this._state.disk.turn.summary = undefined;

    for (const call of effect.rejected) {
      this._logger.warn(`rejecting unavailable tool call ${call.name}`);
      this._toolResults.push({
        order: call.order,
        name: call.name,
        result: errorToolResult(
          call.name,
          call.arguments,
          "is not available; corm only calls the tools it offers.",
        ),
        toolCallId: call.toolCallId,
      });
    }

    if (effect.rejected.length > 0) {
      this._state.disk.turn.toolCallRetries += 1;
    }

    for (const call of effect.calls) {
      const key = toolCallKey(call.name, call.arguments);
      this._state.disk.turn.toolCalls[key] =
        (this._state.disk.turn.toolCalls[key] ?? 0) + 1;

      this._logger.debug(`invoking tool ${call.name}`);
      const uuid = this._handles.call(
        call.name,
        parseToolArguments(call.arguments),
      );
      this._state.disk.turn.awaiting[uuid] = {
        name: call.name,
        arguments: call.arguments,
        toolCallId: call.toolCallId,
        order: call.order,
      };
    }

    if (Object.keys(this._state.disk.turn.awaiting).length === 0) {
      this._flushToolResults();
    }
  }

  private _appendToolResult(effect: CormAppendToolResultEffect): void {
    const pending = this._state.disk.turn.awaiting[effect.id];
    this._toolResults.push({
      order: pending?.order ?? Number.MAX_SAFE_INTEGER,
      name: pending?.name ?? effect.result.name,
      result: effect.result,
      toolCallId: effect.toolCallId,
    });
    delete this._state.disk.turn.awaiting[effect.id];

    if (Object.keys(this._state.disk.turn.awaiting).length === 0) {
      this._flushToolResults();
    }
  }

  private _flushToolResults(): void {
    if (this._toolResults.length === 0) {
      return;
    }

    const results = this._toolResults.sort((a, b) => a.order - b.order);
    this._toolResults = [];

    for (const entry of results) {
      appendToolResult(
        this._state.disk.window,
        entry.result,
        entry.toolCallId,
        this._config,
        entry.name,
      );
    }
  }

  private _foldChatDelta(effect: CormFoldChatDeltaEffect): void {
    const anchor = usageAnchor(effect.delta.usage);
    if (anchor !== undefined) {
      this._state.disk.window.anchor = anchor;
    }

    if (isTurnCompacting(this._state)) {
      appendSummaryDelta(this._state.disk.turn, effect.delta, this._config);
      return;
    }

    foldAssistantDelta(this._state.disk.window, effect.delta, this._config);
  }
}
