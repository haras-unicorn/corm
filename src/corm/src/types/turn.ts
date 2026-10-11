import z from "zod";

export const cormPendingToolCallZod = z.object({
  name: z.string(),
  arguments: z.unknown(),
});

export type CormPendingToolCall = z.infer<typeof cormPendingToolCallZod>;

export const cormTurnZod = z.object({
  // Present exactly while a compaction generation is in progress: `undefined`
  // means no compaction, a string (possibly empty at the very start) means the
  // partial summary is being collected. Its presence is the "compacting" flag.
  summary: z.string().optional(),
  // The tool calls this turn issued and has not yet settled, keyed by call id.
  awaiting: z.record(z.string(), cormPendingToolCallZod).default({}),
  // How many times a tool call emitted as text has been retried this user turn.
  toolCallRetries: z.number().default(0),
  // How many times each tool call (name + canonical arguments) has been issued
  // this user turn; the circuit breaker trips at `circuitBreakerLimit`.
  toolCalls: z.record(z.string(), z.number()).default({}),
  // Whether the compaction in progress should start a chat generation once it
  // commits (true when it interrupted or precedes an answer, false when the
  // answer already streamed and the next request comes from the inbox).
  resume: z.boolean().default(false),
});

export interface CormTurn extends z.infer<typeof cormTurnZod> {}

export const defaultTurn = (): CormTurn => ({
  summary: undefined,
  awaiting: {},
  toolCallRetries: 0,
  toolCalls: {},
  resume: false,
});
