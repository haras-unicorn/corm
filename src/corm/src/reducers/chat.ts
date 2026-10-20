import { approveEffects, type CormApprovedEffect } from "../effects";
import {
  isGenerationActive,
  isGenerationCompacting,
} from "../effects/generation";
import {
  CORM_DEFAULT_COMPACT_NOTICE,
  CORM_DEFAULT_DIGEST_RESUME_NOTICE,
  CORM_DEFAULT_TOOL_CALL_HINT,
  CORM_DEFAULT_TOOL_CALL_PATTERN,
  CORM_DEFAULT_TOOL_CALL_RETRY_LIMIT,
} from "../lib/defaults";
import { clientDelta } from "../lib/messages";
import { isTurnCompacting } from "../lib/turn";
import {
  foldAssistantDelta,
  liveAssistant,
  overHard,
  overSoft,
  ownsTool,
} from "../lib/window";
import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";
import { dropped } from "./dropped";

const onChatDelta = (
  action: CormAction & { kind: "chat-delta" },
  state: CormState,
  config: CormConfig,
): CormApprovedEffect[] => {
  if (
    !isGenerationActive(state) ||
    action.id !== state.memory.subscriptions.generation
  ) {
    return dropped(action, state, config);
  }

  if (isTurnCompacting(state)) {
    return approveEffects(state, action, {
      kind: "fold-chat-delta",
      delta: action.payload,
    });
  }

  const projected = {
    ...state.disk.window,
    active: [...state.disk.window.active],
  };
  foldAssistantDelta(projected, action.payload, config);

  if (overHard(projected, config)) {
    return approveEffects(
      state,
      action,
      { kind: "fold-chat-delta", delta: action.payload },
      { kind: "stream-endpoint-delta", delta: clientDelta(action.payload) },
      {
        kind: "stream-endpoint-delta",
        delta: { content: config.compactNotice ?? CORM_DEFAULT_COMPACT_NOTICE },
      },
      { kind: "cancel-generation" },
      { kind: "start-compaction-generation", resume: true },
    );
  }

  return approveEffects(
    state,
    action,
    { kind: "fold-chat-delta", delta: action.payload },
    { kind: "stream-endpoint-delta", delta: clientDelta(action.payload) },
  );
};

// A tool call the model wrote as text instead of through the tool-calling
// interface: match the pattern against the visible content, or the reasoning
// when there is no visible content.
const isTextToolCall = (
  content: string,
  reasoning: string,
  pattern: string,
): boolean => {
  const text = content !== "" ? content : reasoning;
  if (text === "") {
    return false;
  }

  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
};

const onChatEnd = (
  action: CormAction & { kind: "chat-end" },
  state: CormState,
  config: CormConfig,
): CormApprovedEffect[] => {
  if (
    !isGenerationActive(state) ||
    action.id !== state.memory.subscriptions.generation
  ) {
    return dropped(action, state, config);
  }

  if (isGenerationCompacting(state)) {
    const flush = state.disk.notices.length > 0;

    if (!state.disk.turn.resume) {
      return flush
        ? approveEffects(
            state,
            action,
            { kind: "commit-compaction" },
            { kind: "clear-generation" },
            { kind: "flush-notices" },
          )
        : approveEffects(
            state,
            action,
            { kind: "commit-compaction" },
            { kind: "clear-generation" },
          );
    }

    const resume = {
      kind: "append-runtime-message",
      content: config.digestResumeNotice ?? CORM_DEFAULT_DIGEST_RESUME_NOTICE,
    } as const;

    if (state.disk.turn.digest && flush) {
      return approveEffects(
        state,
        action,
        { kind: "commit-compaction" },
        { kind: "clear-generation" },
        resume,
        { kind: "flush-notices" },
        { kind: "start-chat-generation" },
      );
    }

    if (state.disk.turn.digest) {
      return approveEffects(
        state,
        action,
        { kind: "commit-compaction" },
        { kind: "clear-generation" },
        resume,
        { kind: "start-chat-generation" },
      );
    }

    return flush
      ? approveEffects(
          state,
          action,
          { kind: "commit-compaction" },
          { kind: "clear-generation" },
          { kind: "flush-notices" },
          { kind: "start-chat-generation" },
        )
      : approveEffects(
          state,
          action,
          { kind: "commit-compaction" },
          { kind: "clear-generation" },
          { kind: "start-chat-generation" },
        );
  }

  const live = liveAssistant(state.disk.window);
  const toolCalls = live?.toolCalls ?? [];

  if (toolCalls.length > 0) {
    // corm only ever runs its own tools. A call is never handed back to the
    // client (that would let a second driver write the shared window and rewrite
    // the cached prefix), so a call the model made that corm does not offer is
    // answered with an error tool message, giving the model a bounded chance to
    // recover.
    const owned = toolCalls.flatMap((call, order) =>
      ownsTool(state.disk.window, call.name)
        ? [
            {
              name: call.name,
              arguments: call.arguments,
              toolCallId: call.id,
              order,
            },
          ]
        : [],
    );
    const rejected = toolCalls.flatMap((call, order) =>
      ownsTool(state.disk.window, call.name)
        ? []
        : [
            {
              name: call.name,
              arguments: call.arguments,
              toolCallId: call.id,
              order,
            },
          ],
    );
    const retryLimit =
      config.toolCallRetryLimit ?? CORM_DEFAULT_TOOL_CALL_RETRY_LIMIT;
    const recover = state.disk.turn.toolCallRetries < retryLimit;

    if (owned.length > 0) {
      return approveEffects(state, action, {
        kind: "invoke-corm-tools",
        calls: owned,
        rejected,
      });
    }

    if (recover) {
      return state.disk.notices.length > 0
        ? approveEffects(
            state,
            action,
            { kind: "invoke-corm-tools", calls: [], rejected },
            { kind: "flush-notices" },
            { kind: "start-chat-generation" },
          )
        : approveEffects(
            state,
            action,
            { kind: "invoke-corm-tools", calls: [], rejected },
            { kind: "start-chat-generation" },
          );
    }

    return approveEffects(
      state,
      action,
      { kind: "invoke-corm-tools", calls: [], rejected },
      { kind: "stream-endpoint-delta", delta: { finishReason: "stop" } },
    );
  }

  const pattern = config.toolCallPattern ?? CORM_DEFAULT_TOOL_CALL_PATTERN;
  const retryLimit =
    config.toolCallRetryLimit ?? CORM_DEFAULT_TOOL_CALL_RETRY_LIMIT;

  const flush = state.disk.notices.length > 0;

  if (
    isTextToolCall(live?.content ?? "", live?.reasoning ?? "", pattern) &&
    state.disk.turn.toolCallRetries < retryLimit
  ) {
    const retry = {
      kind: "retry-text-tool-call",
      hint: config.toolCallHint ?? CORM_DEFAULT_TOOL_CALL_HINT,
    } as const;

    return flush
      ? approveEffects(
          state,
          action,
          retry,
          { kind: "clear-generation" },
          { kind: "flush-notices" },
          { kind: "start-chat-generation" },
        )
      : approveEffects(
          state,
          action,
          retry,
          { kind: "clear-generation" },
          { kind: "start-chat-generation" },
        );
  }

  const finish = {
    kind: "stream-endpoint-delta",
    delta: { finishReason: "stop" },
  } as const;
  const digest = state.disk.turn.digest;
  const digestAt = state.disk.turn.digestSince;
  const commit =
    digest && digestAt !== undefined
      ? ({ kind: "commit-digest", at: digestAt } as const)
      : undefined;
  const arm = digest ? ({ kind: "arm-digest-timer" } as const) : undefined;

  if (overSoft(state.disk.window, config)) {
    // Commit the digest before housekeeping compaction evicts its answer; the
    // compaction completion flushes pending notices.
    if (commit !== undefined && arm !== undefined) {
      return approveEffects(
        state,
        action,
        finish,
        commit,
        arm,
        { kind: "clear-generation" },
        { kind: "start-compaction-generation", resume: false },
      );
    }

    if (arm !== undefined) {
      return approveEffects(
        state,
        action,
        finish,
        arm,
        { kind: "clear-generation" },
        { kind: "start-compaction-generation", resume: false },
      );
    }

    return approveEffects(
      state,
      action,
      finish,
      { kind: "clear-generation" },
      { kind: "start-compaction-generation", resume: false },
    );
  }

  if (commit !== undefined && arm !== undefined) {
    return flush
      ? approveEffects(
          state,
          action,
          finish,
          commit,
          arm,
          { kind: "flush-notices" },
          { kind: "clear-generation" },
        )
      : approveEffects(state, action, finish, commit, arm, {
          kind: "clear-generation",
        });
  }

  if (arm !== undefined) {
    return flush
      ? approveEffects(
          state,
          action,
          finish,
          arm,
          { kind: "flush-notices" },
          { kind: "clear-generation" },
        )
      : approveEffects(state, action, finish, arm, {
          kind: "clear-generation",
        });
  }

  return flush
    ? approveEffects(
        state,
        action,
        finish,
        { kind: "flush-notices" },
        { kind: "clear-generation" },
      )
    : approveEffects(state, action, finish, { kind: "clear-generation" });
};

const onError = (
  action: CormAction & { kind: "error" },
  state: CormState,
  config: CormConfig,
): CormApprovedEffect[] => {
  if (
    !isGenerationActive(state) ||
    action.id !== state.memory.subscriptions.generation
  ) {
    return dropped(action, state, config);
  }

  if (isGenerationCompacting(state)) {
    return approveEffects(
      state,
      action,
      { kind: "cancel-generation" },
      { kind: "start-compaction-generation", resume: state.disk.turn.resume },
    );
  }

  // A failed digest is not treated as done: re-arm the schedule without
  // advancing `digest.last`, so the next run covers the missed window.
  if (state.disk.turn.digest) {
    return approveEffects(
      state,
      action,
      { kind: "stream-endpoint-delta", delta: { finishReason: "stop" } },
      { kind: "arm-digest-timer" },
      { kind: "clear-generation" },
    );
  }

  return approveEffects(
    state,
    action,
    { kind: "stream-endpoint-delta", delta: { finishReason: "stop" } },
    { kind: "clear-generation" },
  );
};

export const chatReducer = (
  action: CormAction,
  state: CormState,
  config: CormConfig,
): CormApprovedEffect[] => {
  switch (action.kind) {
    case "chat-delta":
      return onChatDelta(action, state, config);
    case "chat-end":
      return onChatEnd(action, state, config);
    case "error":
      return onError(action, state, config);
    default:
      return dropped(action, state, config);
  }
};
