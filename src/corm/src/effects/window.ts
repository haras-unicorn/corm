import type { CormAction } from "../types/action";
import type { CormOmwChatMessage, CormOmwTool } from "../types/omw";
import type { CormState } from "../types/state";

// `set-active-request` records the endpoint request the turn is answering: the
// session deltas are streamed back to, the provider params, and the client's
// own tool definitions. It only mutates state.
export interface CormSetActiveRequestEffect {
  kind: "set-active-request";
  session: string;
  params: unknown;
  clientTools: CormOmwTool[];
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
// mutates state.
export interface CormAppendRecapEffect {
  kind: "append-recap";
  replay: CormOmwChatMessage[];
}

export type CormAppendRecapEffectRule = {
  state: CormState;
  action: CormAction & { kind: "endpoint-message" };
};
