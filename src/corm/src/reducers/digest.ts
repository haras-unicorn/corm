import { approveEffects, type CormApprovedEffect } from "../effects";
import { CORM_DEFAULT_DIGEST_QUEUED_NOTICE } from "../lib/defaults";
import { isDigestEnabled, isDigestTooSoon } from "../lib/digest";
import { isTurnBusy } from "../lib/turn";
import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";
import { dropped } from "./dropped";

// The digest system owns exactly one event: a `timer` whose id is the digest
// timer handle. Every other timer belongs to another system and is dropped.
export const digestReducer = (
  action: CormAction,
  state: CormState,
  config: CormConfig,
  now: number,
): CormApprovedEffect[] => {
  if (
    action.kind !== "timer" ||
    !isDigestEnabled(config) ||
    action.id !== state.memory.subscriptions.digest?.timer ||
    state.disk.turn.digest
  ) {
    return dropped(action, state, config);
  }

  if (isDigestTooSoon(state.disk.digest.last, now, config)) {
    return approveEffects(state, action, { kind: "arm-digest-timer" });
  }

  if (isTurnBusy(state)) {
    return approveEffects(
      state,
      action,
      {
        kind: "queue-notice",
        notice:
          config.digestQueuedNotice ?? CORM_DEFAULT_DIGEST_QUEUED_NOTICE,
      },
      { kind: "queue-digest" },
    );
  }

  return approveEffects(state, action, { kind: "start-digest" });
};
