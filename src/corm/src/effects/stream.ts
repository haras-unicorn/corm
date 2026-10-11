import type { CormAction } from "../types/action";
import type { CormOmwChatDelta } from "../types/omw";
import type { CormState } from "../types/state";

// `fold-chat-delta` folds one provider chunk into the live assistant message
// (or into the rolling summary while compacting) and recounts the window. It
// only mutates state.
export interface CormFoldChatDeltaEffect {
  kind: "fold-chat-delta";
  delta: CormOmwChatDelta;
}

export type CormFoldChatDeltaEffectRule = {
  state: CormState;
  action: CormAction & { kind: "chat-delta" };
};

// `stream-endpoint-delta` streams one chunk to the endpoint session the turn is
// answering. It only performs the host call.
export interface CormStreamEndpointDeltaEffect {
  kind: "stream-endpoint-delta";
  delta: CormOmwChatDelta;
}

export type CormStreamEndpointDeltaEffectRule = {
  state: CormState;
  action: CormAction;
};
