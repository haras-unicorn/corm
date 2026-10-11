import { z } from "zod";

// The persisted endpoint lifecycle subscriptions for the loaded model. Stored in
// memory so a reload can reuse the bus subscriptions instead of leaking and
// recreating them (subscriptions are idempotent to create but not to duplicate).
export const cormSubscriptionsZod = z.compile(
  z.object({
    // The lifecycle subscription id.
    lifecycle: z.string().readonly(),
    // The endpoint subscription id, matched when an endpoint error must end the
    // turn.
    endpoint: z.string().readonly(),
    // The model the subscriptions were created for; a model change invalidates
    // and recreates them.
    model: z.string().readonly(),
    // The id of the generation currently streaming, if any.
    generation: z.string().optional(),
  }),
);

export type CormSubscriptions = z.infer<typeof cormSubscriptionsZod>;

// The brain's full configuration, assembled by `config.ts` from the nested
// `corm_config` seed plus one flat `corm_config_<field>` overlay per field.
// `model` and `contextLength` are required; everything else is optional and
// falls back to a `CORM_DEFAULT_*` value. `validateConfig` enforces the bounds
// that couple the context knobs together.
export const cormConfigZod = z.compile(
  z.object({
    // The provider model to call. An empty string falls back to the active
    // provider's first listed model.
    model: z.string().readonly(),
    // The operator-set total context budget, in tokens. The model only caps it;
    // the brain trusts this to schedule compaction.
    contextLength: z.number().readonly(),
    // An optional leading system message injected at call time (never stored in
    // the window, so it survives compaction and is never duplicated).
    prompt: z.string().readonly().optional(),
    // Prelude to the optional leading system message.
    promptPrelude: z.string().readonly().optional(),
    // The `<tooling>__<tool>` subset the tooling layer exposes. Absent exposes
    // every tool; empty exposes none.
    tools: z.array(z.string()).readonly().optional(),
    // Soft-compaction trigger as a fraction of `contextLength`: a completed
    // turn/settle/ingest at or above it is compacted before the next call.
    compactThreshold: z.number().readonly().optional(),
    // Hard-compaction trigger as a fraction of `contextLength`: a generation
    // that crosses it mid-stream is cancelled, compacted and resumed. Must sit
    // in [compactThreshold, 1).
    hardThreshold: z.number().readonly().optional(),
    // The size (fraction of `contextLength`) of the verbatim tail that
    // compaction never evicts.
    protectRatio: z.number().readonly().optional(),
    // The count of recent messages the verbatim tail always keeps, regardless
    // of `protectRatio`.
    protectMessages: z.number().readonly().optional(),
    // Per-message token cap; any message longer than this is truncated to its
    // head and tail around a marker before it is considered for the window.
    messageTokenLimit: z.number().readonly().optional(),
    // The string that replaces a truncated message's removed middle.
    truncationMarker: z.string().readonly().optional(),
    // The system message appended next to a truncated user/tool message,
    // telling the model it can re-read the full content.
    truncationHint: z.string().readonly().optional(),
    // How many past compaction receipts to retain. A receipt is the digest
    // index of one compaction's evicted set, kept so a client that re-offers an
    // evicted message is classified as `compacted` (and not re-added) rather
    // than `new`.
    compactionReceipts: z.number().readonly().optional(),
    // The most recent messages of an incoming request to examine for recap
    // detection and replay. Older re-offers (which are already in the window)
    // are ignored, so a client that re-sends its whole history is bounded.
    requestMessages: z.number().readonly().optional(),
    // How many of a resuming source's most recent known messages to scan for
    // `compacted` entries when deciding whether to recap.
    recapMessages: z.number().readonly().optional(),
    // How many of a resuming source's recent known messages to replay in the
    // recap.
    replayMessages: z.number().readonly().optional(),
    // Size cap (fraction of `contextLength`) on the recap replay; the oldest
    // replayed messages are dropped until it fits.
    replayRatio: z.number().readonly().optional(),
    // Template for the notice that heads a resume recap. Fills `{{NAME}}` (the
    // handler kind) and `{{ID}}` (the machine task id).
    recapNotice: z.string().readonly().optional(),
    // Notice appended after a resume recap's replay, closing it off from the
    // new message that follows.
    recapEndNotice: z.string().readonly().optional(),
    // Template for the notice appended once when a brand-new task begins. Fills
    // `{{NAME}}` and `{{ID}}` the same way.
    taskNotice: z.string().readonly().optional(),
    // Token cap on the rolling summary produced by compaction.
    compactSummaryLimit: z.number().readonly().optional(),
    // The runtime prompt the compaction call runs under.
    compactPrompt: z.string().readonly().optional(),
    // The runtime prompt that is the prefix to every compaction.
    compactPrelude: z.string().readonly().optional(),
    // Extra provider params for the compaction call.
    compactParams: z.record(z.string(), z.unknown()).readonly().optional(),
    // The content streamed to the client when a hard compaction interrupts a
    // live generation.
    compactNotice: z.string().readonly().optional(),
    // The regex that detects a tool call emitted as text rather than through
    // the tool-calling mechanism.
    toolCallPattern: z.string().readonly().optional(),
    // The system message appended when a text tool call is detected, telling
    // the model to use the tool-calling interface.
    toolCallHint: z.string().readonly().optional(),
    // The number of times a text tool call is retried before giving up.
    toolCallRetryLimit: z.number().readonly().optional(),
    // The number of times the same tool call with the same arguments may repeat
    // in one user turn before the circuit breaker trips.
    circuitBreakerLimit: z.number().readonly().optional(),
    // The system message appended when the circuit breaker trips.
    circuitBreakerHint: z.string().readonly().optional(),
    // The root system message explaining the runtime to the model.
    runtimeSystemPrompt: z.string().readonly().optional(),
    // The system message explaining the chat handler to the model.
    chatSystemPrompt: z.string().readonly().optional(),
  }),
);

export type CormConfig = z.infer<typeof cormConfigZod>;

// The identity of a handler's task: the handler kind (`name`), the machine's
// monotonic task id (`id`) and an optional `description` scoped to the task
// (for chat, the logical session). It fills the `{{NAME}}` / `{{ID}}` /
// `{{DESCRIPTION}}` placeholders in the task and recap notices; it is never
// persisted or parsed.
export interface CormTaskIdentity {
  name: string;
  id: string;
  description?: string;
}

// The opaque task/envelope state a handler is reconstructed from. It is the
// originating `OmwEvent` for a chat task (or the equivalent for other kinds), so
// it is intentionally unconstrained here and narrowed by each handler.
export const cormTaskStateZod = z.compile(z.any());

export type CormTaskState = z.infer<typeof cormTaskStateZod>;

// Where a task is placed relative to the active one: `immediate` starts (or
// merges) now, `pending` is queued until the active task completes.
export const cormTaskPlacementZod = z.compile(z.enum(["immediate", "pending"]));

export type CormTaskPlacement = z.infer<typeof cormTaskPlacementZod>;

// The registrar's decision for an event: how to place it, the state to build the
// handler from, an optional merge/coalesce key and whether it must run alone.
export const cormTaskSpecZod = z.compile(
  z.object({
    placement: cormTaskPlacementZod,
    state: cormTaskStateZod,
    // Merge/coalesce key (for chat, the session). A same-key `immediate` event
    // is offered to the active handler; a same-key `pending` task is replaced
    // (latest wins).
    key: z.string().optional(),
    // Whether the task must be the only active one; a new atomic `immediate`
    // task is queued instead of started while another atomic task runs.
    atomic: z.boolean().optional(),
  }),
);

export type CormTaskSpec = z.infer<typeof cormTaskSpecZod>;

// A task spec paired with the handler kind that materialized it.
export const cormMaterializedTaskSpecZod = z.compile(
  z.object({
    kind: z.string(),
    spec: cormTaskSpecZod,
  }),
);

export type CormMaterializedTaskSpec = z.infer<
  typeof cormMaterializedTaskSpecZod
>;

// A live task on the machine's stack: its handler kind, a monotonic id and the
// state the handler was built from.
export const cormTaskZod = z.compile(
  z.object({
    kind: z.string(),
    id: z.string(),
    state: cormTaskStateZod,
  }),
);

export type CormTask = z.infer<typeof cormTaskZod>;

// The persisted shape of the global context window. `messages` stays opaque here
// (each entry is a `ChatMessage`) so the schema does not have to track every
// message field; `restore` casts them back.
export const cormWindowZod = z.compile(
  z.object({
    // The rolling summary that stands in for the evicted messages.
    summary: z.string().optional(),
    // The verbatim message history, prompt-free.
    messages: z.array(z.unknown()).default([]),
    // Per-source ingest cursors: how many messages the source had last time and
    // a fingerprint of its last message, used to find the new suffix.
    sources: z
      .record(z.string(), z.object({ count: z.number(), last: z.string() }))
      .default({}),
    // Content digest -> positions still present in `messages`.
    digests: z.record(z.string(), z.array(z.number())).default({}),
    // Bounded list of past compaction receipts (each digest -> positions that
    // were evicted by that compaction), newest last.
    receipts: z.array(z.record(z.string(), z.array(z.number()))).default([]),
    // Incremented on every rewrite of the window (compaction or duplicate drop)
    // so a stale token anchor is discarded.
    epoch: z.number().default(0),
  }),
);

export type CormWindowState = z.infer<typeof cormWindowZod>;

// The whole persisted global state: the task stack plus the window it shares.
export const cormStateZod = z.compile(
  z.object({
    // Tasks waiting for the active one to finish, oldest first.
    pending: z.array(cormTaskZod).default([]),
    // Tasks currently active (the machine only ever runs one generation, so in
    // practice this holds at most one chat task).
    immediate: z.array(cormTaskZod).default([]),
    // The window snapshot, persisted alongside the stack so the two cannot
    // drift.
    window: z.unknown().optional(),
  }),
);

export type CormGlobalState = z.infer<typeof cormStateZod>;

// Whether a handler has finished (`complete`) or is still waiting on events
// (`running`).
export const cormOutcomeZod = z.compile(z.enum(["running", "complete"]));

export type CormOutcome = z.infer<typeof cormOutcomeZod>;
