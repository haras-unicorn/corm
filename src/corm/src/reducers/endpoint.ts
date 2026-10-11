import { approveEffects, type CormApprovedEffect } from "../effects";
import { isGenerationActive, isGenerationFree } from "../effects/generation";
import { hasAwaitingTools } from "../lib/turn";
import {
  needsRecap,
  overSoft,
  projectIngest,
  recapReplay,
} from "../lib/window";
import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";
import { dropped } from "./dropped";

export const endpointReducer = (
  action: CormAction,
  state: CormState,
  config: CormConfig,
): CormApprovedEffect[] => {
  if (action.kind === "endpoint-message") {
    if (!isGenerationFree(state) || hasAwaitingTools(state)) {
      return approveEffects(state, action, {
        kind: "enqueue-inbound",
        event: action,
      });
    }

    const payload = action.payload;
    const projected = projectIngest(
      state.disk.window,
      payload.messages,
      state.disk.receipts,
      config,
    );
    const start = overSoft(projected, config)
      ? ({ kind: "start-compaction-generation", resume: true } as const)
      : ({ kind: "start-chat-generation" } as const);

    if (needsRecap(payload.messages, state.disk.receipts, config)) {
      return approveEffects(
        state,
        action,
        {
          kind: "set-active-request",
          session: payload.session,
          params: payload.params,
          clientTools: payload.tools ?? [],
        },
        {
          kind: "append-recap",
          replay: recapReplay(payload.messages, state.disk.receipts, config),
        },
        { kind: "append-inbound-messages", messages: payload.messages },
        start,
      );
    }

    return approveEffects(
      state,
      action,
      {
        kind: "set-active-request",
        session: payload.session,
        params: payload.params,
        clientTools: payload.tools ?? [],
      },
      { kind: "append-inbound-messages", messages: payload.messages },
      start,
    );
  }

  if (action.kind === "endpoint-session-end") {
    if (!isGenerationActive(state)) {
      return dropped(action, state, config);
    }

    return approveEffects(state, action, { kind: "cancel-generation" });
  }

  return dropped(action, state, config);
};
