import z from "zod";

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
    // The provider names the brain probes. Seeded by Nix from the enabled
    // provider modules; absent probes every known provider.
    providers: z.array(z.string()).readonly().optional(),
    // The tooling (MCP server) names the brain probes. Seeded by Nix from the
    // enabled servers; absent probes every known tooling.
    toolings: z.array(z.string()).readonly().optional(),
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
    // Characters per token for token calculations.
    charsPerToken: z.number().readonly().optional(),
    // Message overhead in tokens for token calculations.
    messageOverheadTokens: z.number().readonly().optional(),
  }),
);

export interface CormConfig extends z.infer<typeof cormConfigZod> {}
