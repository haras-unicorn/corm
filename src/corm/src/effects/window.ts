import type { CormAction } from "../types/action";
import type { CormOmwChatMessage } from "../types/omw";
import type { CormState } from "../types/state";

// `set-active-request` records the endpoint request the turn is answering: the
// session deltas are streamed back to and the provider params. A client may
// offer its own tools; corm drops them (they would break the shared prefix and
// hand the turn to the client) and only warns via `droppedClientTools`. It only
// mutates state.
export interface CormSetActiveRequestEffect {
  kind: "set-active-request";
  session: string;
  params: unknown;
  droppedClientTools: string[];
}

export type CormSetActiveRequestEffectRule = {
  state: CormState;
  action: CormAction & { kind: "endpoint-message" };
};

// `append-inbound-messages` frames, truncates and appends the request's message
// history to the window, skipping messages the window already knows. It only
// mutates state.
export interface CormAppendInboundMessagesEffect {
  kind: "append-inbound-messages";
  messages: CormOmwChatMessage[];
}

export type CormAppendInboundMessagesEffectRule = {
  state: CormState;
  action: CormAction & { kind: "endpoint-message" };
};

// `append-tool-result` appends the tool's returned content to the window as a
// tool message and forgets the awaited call. It only mutates state.
export interface CormAppendToolResultEffect {
  kind: "append-tool-result";
  id: string;
  result: ToolResult;
  toolCallId?: string;
}

export type CormAppendToolResultEffectRule = {
  state: CormState;
  action: CormAction & ({ kind: "tool-result" } | { kind: "error" });
};

// `enqueue-inbound` parks an endpoint request in the inbox while the turn is
// busy (a generation is open or a tool call is outstanding), so the drain can
// answer it once the machine is idle again. It only mutates state.
export interface CormEnqueueInboundEffect {
  kind: "enqueue-inbound";
  event: CormAction & { kind: "endpoint-message" };
}

export type CormEnqueueInboundEffectRule = {
  state: CormState;
  action: CormAction & { kind: "endpoint-message" };
};

// `append-runtime-message` appends one `⟦runtime⟧` message to the window and
// recounts it. It is how hints, notices and replays enter the shared context.
// It only mutates state.
export interface CormAppendRuntimeMessageEffect {
  kind: "append-runtime-message";
  content: string;
}

export type CormAppendRuntimeMessageEffectRule = {
  state: CormState;
  action: CormAction;
};

// `append-recap` prepends a resume recap block -- the recap notice, a bounded
// replay of the re-offered messages compaction evicted, and the end-of-replay
// marker -- for a source whose recent messages compaction evicted. It only
// mutates state. `notice` overrides the configured recap notice (the endpoint
// uses its own wording).
export interface CormAppendRecapEffect {
  kind: "append-recap";
  replay: CormOmwChatMessage[];
  notice?: string;
}

export type CormAppendRecapEffectRule = {
  state: CormState;
  action: CormAction & { kind: "endpoint-message" };
};

// `queue-notice` parks a runtime notice until a safe point (no live assistant
// and no awaited tool call) can append it. It only mutates state.
export interface CormQueueNoticeEffect {
  kind: "queue-notice";
  notice: string;
}

export type CormQueueNoticeEffectRule = {
  state: CormState;
  action: CormAction;
};

// `flush-notices` appends every parked notice to the window in order and clears
// the queue. It only mutates state.
export interface CormFlushNoticesEffect {
  kind: "flush-notices";
}

export type CormFlushNoticesEffectRule = {
  state: CormState;
  action: CormAction;
};
