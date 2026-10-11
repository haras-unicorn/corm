import { approveEffects, type CormApprovedEffect } from "../effects";
import { isGenerationFree } from "../effects/generation";
import {
  CORM_DEFAULT_CIRCUIT_BREAKER_HINT,
  CORM_DEFAULT_CIRCUIT_BREAKER_LIMIT,
} from "../lib/defaults";
import { toolCallKey } from "../lib/tokens";
import { overSoft } from "../lib/window";
import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";
import type { CormPendingToolCall } from "../types/turn";
import { dropped } from "./dropped";

// The tool's error is fed back to the model as an ordinary `tool` message so it
// can recover instead of failing the turn.
const errorResult = (
  pending: CormPendingToolCall,
  message: string,
): ToolResult =>
  ({
    name: pending.name,
    arguments: pending.arguments,
    content: [{ type: "text", text: `Tool error: ${message}` }],
  }) as ToolResult;

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
      ? errorResult(pending, action.payload)
      : action.payload;

  const limit =
    config.circuitBreakerLimit ?? CORM_DEFAULT_CIRCUIT_BREAKER_LIMIT;
  const count =
    state.disk.turn.toolCalls[toolCallKey(pending.name, pending.arguments)];

  if (count !== undefined && count >= limit) {
    return approveEffects(
      state,
      action,
      {
        kind: "append-tool-result",
        id: action.id,
        result,
      },
      {
        kind: "circuit-break",
        hint: config.circuitBreakerHint ?? CORM_DEFAULT_CIRCUIT_BREAKER_HINT,
      },
      overSoft(state.disk.window, config)
        ? { kind: "start-compaction-generation", resume: true }
        : { kind: "start-chat-generation" },
    );
  }

  return approveEffects(
    state,
    action,
    {
      kind: "append-tool-result",
      id: action.id,
      result,
    },
    overSoft(state.disk.window, config)
      ? { kind: "start-compaction-generation", resume: true }
      : { kind: "start-chat-generation" },
  );
};
