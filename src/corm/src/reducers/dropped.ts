import { approveEffects, type CormApprovedEffect } from "../effects";
import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormState } from "../types/state";

// The single effect a reducer returns when an event is meaningless in the
// current state: a `noop` carrying the event kind so the dispatcher can log the
// drop. Returning `noop` (rather than an empty array) keeps every reducer
// returning at least one effect, so "nothing happened" is an explicit,
// observable decision instead of an empty list.
export const dropped = (
  action: CormAction,
  state: CormState,
  _config: CormConfig,
): CormApprovedEffect[] =>
  approveEffects(state, action, { kind: "noop", dropped: action.kind });
