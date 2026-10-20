import type { CormAction } from "../types/action";
import type { CormState } from "../types/state";

// A state with any generation open.
type CormGenerationOpenState = CormState & {
  memory: { subscriptions: { generation: string } };
};

// An open chat generation (no summary buffer).
type CormGenerationChattingState = CormGenerationOpenState & {
  disk: { turn: { summary: undefined } };
};

// An open compaction generation (a summary buffer is being collected).
type CormGenerationCompactingState = CormGenerationOpenState & {
  disk: { turn: { summary: string } };
};

// No generation open.
type CormGenerationClosedState = CormState & {
  memory: { subscriptions: { generation: undefined } };
};

// `start-chat-generation` opens a chat generation on the active provider. It
// reads the provider input from the state's window and writes the returned
// generation id back into the state. It is only legal when no generation is
// open.
export interface CormStartChatGenerationEffect {
  kind: "start-chat-generation";
}

export type CormStartChatGenerationEffectRule = {
  state: CormGenerationClosedState;
  action: CormAction;
  next: CormGenerationChattingState;
};

// `start-compaction-generation` opens a compaction generation: it asks the same
// provider for a summary of the window's evictable history. Same legality as a
// chat generation (no open generation), and it starts the summary buffer so
// incoming deltas are collected as a summary.
export interface CormStartCompactionGenerationEffect {
  kind: "start-compaction-generation";
  // Whether a chat generation starts once this compaction commits.
  resume: boolean;
}

export type CormStartCompactionGenerationEffectRule = {
  state: CormGenerationClosedState;
  action: CormAction;
  next: CormGenerationCompactingState;
};

// `commit-compaction` installs the collected summary and keeps the protected
// tail, recording the evicted set as a receipt. The generation is still open
// until the caller clears it.
export interface CormCommitCompactionEffect {
  kind: "commit-compaction";
}

export type CormCommitCompactionEffectRule = {
  state: CormGenerationCompactingState;
  action: CormAction & { kind: "chat-end" };
  next: CormGenerationCompactingState;
};

// `cancel-generation` cancels the open generation on whichever provider owns it
// and clears the generation id. It is only legal while a generation is open.
export interface CormCancelGenerationEffect {
  kind: "cancel-generation";
}

export type CormCancelGenerationEffectRule = {
  state: CormGenerationOpenState;
  action: CormAction;
  next: CormGenerationClosedState;
};

// `clear-generation` forgets the generation id without cancelling it (the
// provider already ended the stream). It is only legal while a generation id is
// still recorded.
export interface CormClearGenerationEffect {
  kind: "clear-generation";
}

export type CormClearGenerationEffectRule = {
  state: CormGenerationOpenState;
  action: CormAction;
  next: CormGenerationClosedState;
};

// `invoke-corm-tools` calls the corm-owned tools the assistant asked for,
// records each in the turn's awaiting set for its matching tool result, and
// clears the generation. Calls the assistant made that corm does not offer are
// answered with an error `tool` message (`rejected`) so the provider's
// tool-call contract holds and the model can recover. `order` is the call's
// position in the assistant's tool-call array, used to settle results in call
// order. It is only legal at the end of a turn and while a generation is open.
export interface CormInvokeCormToolsEffect {
  kind: "invoke-corm-tools";
  calls: {
    name: string;
    arguments: unknown;
    toolCallId: string;
    order: number;
  }[];
  rejected: {
    name: string;
    arguments: unknown;
    toolCallId: string;
    order: number;
  }[];
}

export type CormInvokeCormToolsEffectRule = {
  state: CormGenerationOpenState;
  action: CormAction & { kind: "chat-end" };
  next: CormGenerationClosedState;
};

// `retry-text-tool-call` handles a tool call the model wrote as text instead of
// through the tool-calling mechanism: it records the retry and appends the hint
// so the model uses the interface. It only matters while a turn is streaming and
// leaves the generation open; the caller clears and restarts it.
export interface CormRetryTextToolCallEffect {
  kind: "retry-text-tool-call";
  hint: string;
}

export type CormRetryTextToolCallEffectRule = {
  state: CormGenerationOpenState;
  action: CormAction & { kind: "chat-end" };
};

// `circuit-break` trips the breaker on a tool call that repeated too many times
// in one user turn: it drops the duplicate exchange and appends the hint. The
// generation is already closed (the tool call settled).
export interface CormCircuitBreakEffect {
  kind: "circuit-break";
  hint: string;
}

export type CormCircuitBreakEffectRule = {
  state: CormGenerationClosedState;
  action: CormAction & ({ kind: "tool-result" } | { kind: "error" });
};

export const isGenerationFree = (
  state: CormState,
): state is CormStartChatGenerationEffectRule["state"] => {
  return state.memory.subscriptions.generation === undefined;
};

export const isGenerationActive = (
  state: CormState,
): state is CormCancelGenerationEffectRule["state"] => {
  return state.memory.subscriptions.generation !== undefined;
};

export const isGenerationCompacting = (
  state: CormState,
): state is CormGenerationCompactingState => {
  return (
    state.memory.subscriptions.generation !== undefined &&
    state.disk.turn.summary !== undefined
  );
};
