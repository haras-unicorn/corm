import { approveEffects, type CormApprovedEffect } from "../effects";
import { isGenerationFree } from "../effects/generation";
import {
  CORM_DEFAULT_CIRCUIT_BREAKER_HINT,
  CORM_DEFAULT_CIRCUIT_BREAKER_LIMIT,
} from "../lib/defaults";
import { toolCallKey } from "../lib/tokens";
import { errorToolResult } from "../lib/tools";
import { overSoft } from "../lib/window";
import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";
import { dropped } from "./dropped";

export const toolReducer = (
  action: CormAction,
  state: CormState,
  config: CormConfig,
): CormApprovedEffect[] => {
  if (action.kind !== "tool-result" && action.kind !== "error") {
    return dropped(action, state, config);
  }

  const pending = state.disk.turn.awaiting[action.id];
  if (pending === undefined) {
    return dropped(action, state, config);
  }

  if (!isGenerationFree(state)) {
    return dropped(action, state, config);
  }

  const result =
    action.kind === "error"
      ? errorToolResult(pending.name, pending.arguments, action.payload)
      : action.payload;

  const settle = {
    kind: "append-tool-result",
    id: action.id,
    result,
    toolCallId: pending.toolCallId,
  } as const;

  // A turn may await several tool calls: only the last one to settle starts the
  // next generation, so every result is in the window before the model is asked
  // to continue.
  const awaited = Object.keys(state.disk.turn.awaiting).length;
  if (awaited > 1) {
    return approveEffects(state, action, settle);
  }

  const limit =
    config.circuitBreakerLimit ?? CORM_DEFAULT_CIRCUIT_BREAKER_LIMIT;
  const count =
    state.disk.turn.toolCalls[toolCallKey(pending.name, pending.arguments)];

  const flush = state.disk.notices.length > 0;

  if (count !== undefined && count >= limit) {
    const hint = {
      kind: "circuit-break",
      hint: config.circuitBreakerHint ?? CORM_DEFAULT_CIRCUIT_BREAKER_HINT,
    } as const;

    if (overSoft(state.disk.window, config)) {
      return approveEffects(state, action, settle, hint, {
        kind: "start-compaction-generation",
        resume: true,
      });
    }

    return flush
      ? approveEffects(
          state,
          action,
          settle,
          hint,
          { kind: "flush-notices" },
          { kind: "start-chat-generation" },
        )
      : approveEffects(state, action, settle, hint, {
          kind: "start-chat-generation",
        });
  }

  if (overSoft(state.disk.window, config)) {
    return approveEffects(state, action, settle, {
      kind: "start-compaction-generation",
      resume: true,
    });
  }

  return flush
    ? approveEffects(
        state,
        action,
        settle,
        { kind: "flush-notices" },
        { kind: "start-chat-generation" },
      )
    : approveEffects(state, action, settle, { kind: "start-chat-generation" });
};
