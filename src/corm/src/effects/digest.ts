import type { CormAction } from "../types/action";
import type { CormState } from "../types/state";

// `arm-digest-timer` opens the next digest wait on the configured cron. It only
// performs the host call and records the returned timer id.
export interface CormArmDigestTimerEffect {
  kind: "arm-digest-timer";
}

export type CormArmDigestTimerEffectRule = {
  state: CormState;
  action: CormAction;
};

// `start-digest` opens a background digest turn: it flushes parked notices,
// builds the prompt from the configured feeds and the previous run, clears the
// endpoint session, records the turn as a digest and opens a chat generation.
// It is only emitted when the turn is idle.
export interface CormStartDigestEffect {
  kind: "start-digest";
}

export type CormStartDigestEffectRule = {
  state: CormState;
  action: CormAction;
};

// `queue-digest` parks the digest at the next safe point. `resume` keeps the
// prompt already in the window and continues the interrupted answer; otherwise
// the digest starts from its prompt.
export interface CormQueueDigestEffect {
  kind: "queue-digest";
  resume?: boolean;
}

export type CormQueueDigestEffectRule = {
  state: CormState;
  action: CormAction;
};

// `commit-digest` records a completed digest's start time as the last
// successful run.
export interface CormCommitDigestEffect {
  kind: "commit-digest";
  at: number;
}

export type CormCommitDigestEffectRule = {
  state: CormState;
  action: CormAction & { kind: "chat-end" };
};
