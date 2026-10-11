import type { CormState } from "../types/state";

export const isTurnIdling = (state: CormState): boolean =>
  state.memory.subscriptions.generation === undefined;

export const isTurnChatting = (state: CormState): boolean =>
  state.memory.subscriptions.generation !== undefined &&
  state.disk.turn.summary === undefined;

export const isTurnCompacting = (state: CormState): boolean =>
  state.memory.subscriptions.generation !== undefined &&
  state.disk.turn.summary !== undefined;

// A turn is busy while a generation is open or a tool call is still awaited;
// an endpoint request that arrives then is queued rather than answered.
export const hasAwaitingTools = (state: CormState): boolean =>
  Object.keys(state.disk.turn.awaiting).length > 0;

export const isTurnBusy = (state: CormState): boolean =>
  state.memory.subscriptions.generation !== undefined ||
  hasAwaitingTools(state);
