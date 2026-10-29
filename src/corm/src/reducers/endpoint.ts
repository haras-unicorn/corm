import { approveEffects, type CormApprovedEffect } from "../effects";
import {
  isGenerationActive,
  isGenerationFree,
} from "../effects/generation";
import {
  CORM_DEFAULT_ENDPOINT_QUEUED_NOTICE,
  CORM_DEFAULT_ENDPOINT_RECAP_NOTICE,
} from "../lib/defaults";
import { hasAwaitingTools } from "../lib/turn";
import {
  liveAssistant,
  needsRecap,
  overSoft,
  projectIngest,
  recapReplay,
} from "../lib/window";
import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";
import { dropped } from "./dropped";

// An inbox message preempts only the background digest, and only while it is
// streaming text: a compaction or an outstanding tool call must settle first,
// and a foreground endpoint turn keeps the queue-while-busy behavior.
const isDigestPreemptible = (state: CormState): boolean =>
  state.disk.turn.digest &&
  isGenerationActive(state) &&
  state.disk.turn.summary === undefined &&
  !hasAwaitingTools(state) &&
  (liveAssistant(state.disk.window)?.toolCalls.length ?? 0) === 0;

// The state a cancelled digest generation leaves behind, used to evaluate the
// endpoint request that preempts it.
const closeGeneration = (state: CormState): CormState => ({
  ...state,
  memory: {
    subscriptions: {
      ...state.memory.subscriptions,
      generation: undefined,
    },
  },
  disk: {
    ...state.disk,
    turn: { ...state.disk.turn, summary: undefined },
  },
});

const endpointMessage = (
  state: CormState,
  action: CormAction & { kind: "endpoint-message" },
  config: CormConfig,
): CormApprovedEffect[] => {
  if (!isGenerationFree(state) || hasAwaitingTools(state)) {
    return approveEffects(
      state,
      action,
      {
        kind: "queue-notice",
        notice:
          config.endpointQueuedNotice ?? CORM_DEFAULT_ENDPOINT_QUEUED_NOTICE,
      },
      { kind: "enqueue-inbound", event: action },
    );
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
  const request = {
    kind: "set-active-request",
    session: payload.session,
    params: payload.params,
    droppedClientTools: (payload.tools ?? []).map((tool) => tool.name),
  } as const;

  const flush = state.disk.notices.length > 0;
  const recap = {
    kind: "append-recap",
    replay: recapReplay(payload.messages, state.disk.receipts, config),
    notice:
      config.endpointRecapNotice ??
      config.recapNotice ??
      CORM_DEFAULT_ENDPOINT_RECAP_NOTICE,
  } as const;
  const inbound = {
    kind: "append-inbound-messages",
    messages: payload.messages,
  } as const;

  if (needsRecap(payload.messages, state.disk.receipts, config)) {
    return flush
      ? approveEffects(
          state,
          action,
          { kind: "flush-notices" },
          request,
          recap,
          inbound,
          start,
        )
      : approveEffects(state, action, request, recap, inbound, start);
  }

  return flush
    ? approveEffects(
        state,
        action,
        { kind: "flush-notices" },
        request,
        inbound,
        start,
      )
    : approveEffects(state, action, request, inbound, start);
};

export const endpointReducer = (
  action: CormAction,
  state: CormState,
  config: CormConfig,
): CormApprovedEffect[] => {
  if (action.kind === "endpoint-message") {
    if (isDigestPreemptible(state) && isGenerationActive(state)) {
      return [
        ...approveEffects(
          state,
          action,
          { kind: "cancel-generation" },
          { kind: "queue-digest", resume: true },
        ),
        ...endpointMessage(closeGeneration(state), action, config),
      ];
    }

    return endpointMessage(state, action, config);
  }

  if (action.kind === "endpoint-session-end") {
    // A background digest clears the session, so an unrelated client ending
    // must not cancel it; only the session the active turn is answering does.
    if (
      !isGenerationActive(state) ||
      state.disk.window.session !== action.payload.session
    ) {
      return dropped(action, state);
    }

    return approveEffects(state, action, { kind: "cancel-generation" });
  }

  return dropped(action, state);
};
