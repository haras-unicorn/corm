import { approveEffects, type CormApprovedEffect } from "../effects";
import {
  isGenerationActive,
  isGenerationCompacting,
} from "../effects/generation";
import {
  CORM_DEFAULT_COMPACT_NOTICE,
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
    return state.disk.turn.resume
      ? approveEffects(
          state,
          action,
          { kind: "commit-compaction" },
          { kind: "clear-generation" },
          { kind: "start-chat-generation" },
        )
      : approveEffects(
          state,
          action,
          { kind: "commit-compaction" },
          { kind: "clear-generation" },
        );
  }

  const live = liveAssistant(state.disk.window);
  const toolCall = live?.toolCall;

  if (toolCall !== undefined && ownsTool(state.disk.window, toolCall.name)) {
    return approveEffects(state, action, {
      kind: "invoke-corm-tool",
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
  }

  if (toolCall !== undefined) {
    return approveEffects(
      state,
      action,
      { kind: "forward-client-tool-call", toolCall },
      { kind: "stream-endpoint-delta", delta: { finishReason: "tool_calls" } },
      { kind: "clear-generation" },
    );
  }

  const pattern = config.toolCallPattern ?? CORM_DEFAULT_TOOL_CALL_PATTERN;
  const retryLimit =
    config.toolCallRetryLimit ?? CORM_DEFAULT_TOOL_CALL_RETRY_LIMIT;

  if (
    isTextToolCall(live?.content ?? "", live?.reasoning ?? "", pattern) &&
    state.disk.turn.toolCallRetries < retryLimit
  ) {
    return approveEffects(
      state,
      action,
      {
        kind: "retry-text-tool-call",
        hint: config.toolCallHint ?? CORM_DEFAULT_TOOL_CALL_HINT,
      },
      { kind: "clear-generation" },
      { kind: "start-chat-generation" },
    );
  }

  if (overSoft(state.disk.window, config)) {
    return approveEffects(
      state,
      action,
      { kind: "stream-endpoint-delta", delta: { finishReason: "stop" } },
      { kind: "clear-generation" },
      { kind: "start-compaction-generation", resume: false },
    );
  }

  return approveEffects(
    state,
    action,
    { kind: "stream-endpoint-delta", delta: { finishReason: "stop" } },
    { kind: "clear-generation" },
  );
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
