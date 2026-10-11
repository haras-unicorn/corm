import type { CormAction } from "../types/action";
import type { CormConfig } from "../types/config";
import type { CormInboxMessage } from "../types/inbox";
import type {
  CormAssistantMessage,
  CormNonSystemMessage,
} from "../types/message";
import type { CormOmwChatDelta, CormOmwChatMessage } from "../types/omw";
import type { CormTurn } from "../types/turn";
import type { CormWindow } from "../types/window";
import {
  CORM_DEFAULT_CHARS_PER_TOKEN,
  CORM_DEFAULT_COMPACT_PRELUDE,
  CORM_DEFAULT_COMPACT_SUMMARY_LIMIT,
  CORM_DEFAULT_COMPACT_THRESHOLD,
  CORM_DEFAULT_COMPACTION_RECEIPTS,
  CORM_DEFAULT_HARD_THRESHOLD,
  CORM_DEFAULT_MESSAGE_OVERHEAD_TOKENS,
  CORM_DEFAULT_MESSAGE_TOKEN_LIMIT,
  CORM_DEFAULT_PROTECT_MESSAGES,
  CORM_DEFAULT_PROTECT_RATIO,
  CORM_DEFAULT_RECAP_MESSAGES,
  CORM_DEFAULT_REPLAY_MESSAGES,
  CORM_DEFAULT_REPLAY_RATIO,
  CORM_DEFAULT_REQUEST_MESSAGES,
  CORM_DEFAULT_TRUNCATION_HINT,
  CORM_DEFAULT_TRUNCATION_MARKER,
} from "./defaults";
import {
  assistantMessage,
  foldAssistant,
  toolMessage,
  userMessage,
} from "./messages";
import {
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTokenChars,
  truncateContent,
} from "./tokens";
import { toolResultText } from "./tools";

// The raw body of a message, truncated to `messageTokenLimit` with the head and
// tail kept around `truncationMarker`. Returns whether the body was cut so a
// `truncationHint` can be appended next to it.
const limitBody = (
  content: string,
  config: CormConfig,
): { content: string; truncated: boolean } => {
  const charsPerToken = config.charsPerToken ?? CORM_DEFAULT_CHARS_PER_TOKEN;
  const limit = config.messageTokenLimit ?? CORM_DEFAULT_MESSAGE_TOKEN_LIMIT;
  const marker = config.truncationMarker ?? CORM_DEFAULT_TRUNCATION_MARKER;

  if (content.length <= limit * charsPerToken) {
    return { content, truncated: false };
  }

  return {
    content: truncateContent(content, limit, marker, charsPerToken),
    truncated: true,
  };
};

export const truncationHintMessage = (
  config: CormConfig,
): CormNonSystemMessage =>
  userMessage(
    "runtime",
    config.truncationHint ?? CORM_DEFAULT_TRUNCATION_HINT,
    config,
  );

export const toNonSystem = (
  message: CormOmwChatMessage,
  config: CormConfig,
): CormNonSystemMessage => {
  switch (message.role ?? "user") {
    case "system":
      return userMessage("persona", message.content ?? "", config);
    case "assistant":
      return assistantMessage(
        message.content ?? "",
        message.reasoning,
        message.toolCall,
        config,
      );
    case "tool":
      return toolMessage(message.content ?? "", config);
    default:
      return userMessage("client", message.content ?? "", config);
  }
};

export const windowInput = (
  window: CormWindow,
  config: CormConfig,
): CormOmwChatMessage[] => {
  const messages: CormOmwChatMessage[] = [window.system.message];

  if (window.summary !== "") {
    messages.push(summaryMessage(window.summary, config).message);
  }

  messages.push(...window.active.map((message) => message.message));
  return messages;
};

export const summaryMessage = (
  summary: string,
  config: CormConfig,
): CormNonSystemMessage => {
  const prelude = config.compactPrelude ?? CORM_DEFAULT_COMPACT_PRELUDE;
  return userMessage("runtime", `\n\n\n${prelude}\n\n${summary}`, config);
};

export const liveAssistant = (
  window: CormWindow,
): CormAssistantMessage | undefined => {
  const last = window.active[window.active.length - 1];
  return last !== undefined && last.role === "assistant" ? last : undefined;
};

export const ownsTool = (window: CormWindow, name: string): boolean =>
  window.tools.some((tool) => tool.name === name);

export const setActiveRequest = (
  window: CormWindow,
  session: string,
  params: unknown,
  clientTools: CormWindow["clientTools"],
): void => {
  window.session = session;
  window.params = params;
  window.clientTools = clientTools;
};

// Frame and truncate one offered message. Only the user- and tool-role bodies
// are capped; an assistant message is stored as the provider produced it.
const incoming = (
  offered: CormOmwChatMessage,
  config: CormConfig,
): { message: CormNonSystemMessage; truncated: boolean } => {
  const role = offered.role ?? "user";
  if (role === "assistant") {
    return { message: toNonSystem(offered, config), truncated: false };
  }

  const body = limitBody(offered.content ?? "", config);
  return {
    message: toNonSystem({ ...offered, content: body.content }, config),
    truncated: body.truncated,
  };
};

export const appendInboundMessages = (
  window: CormWindow,
  offered: CormOmwChatMessage[],
  receipts: string[][],
  config: CormConfig,
): void => {
  const known = new Set(window.active.map((message) => message.digest));

  for (const offeredMessage of offered) {
    const { message, truncated } = incoming(offeredMessage, config);
    if (known.has(message.digest) || isCompacted(message.digest, receipts)) {
      continue;
    }

    known.add(message.digest);
    window.active.push(message);

    if (truncated) {
      const hint = truncationHintMessage(config);
      window.active.push(hint);
      known.add(hint.digest);
    }
  }

  recount(window, config);
};

export const appendRuntimeMessage = (
  window: CormWindow,
  content: string,
  config: CormConfig,
): void => {
  window.active.push(userMessage("runtime", content, config));
  recount(window, config);
};

export const enqueueInbound = (
  inbox: CormInboxMessage[],
  event: CormAction & { kind: "endpoint-message" },
): void => {
  inbox.push({ event });
};

// A shallow copy of the window with the offered messages ingested, used by a
// reducer to decide (before the effect runs) whether the ingest crosses the
// compaction threshold.
export const projectIngest = (
  window: CormWindow,
  offered: CormOmwChatMessage[],
  receipts: string[][],
  config: CormConfig,
): CormWindow => {
  const clone: CormWindow = { ...window, active: [...window.active] };
  appendInboundMessages(clone, offered, receipts, config);
  return clone;
};

// Remove the most recent tool exchange: the trailing tool message(s) and the
// assistant message that produced them. Used when the circuit breaker drops a
// duplicate call.
export const dropLastExchange = (window: CormWindow): boolean => {
  if (window.active.length === 0) {
    return false;
  }

  while (window.active.length > 0 && window.active.at(-1)?.role === "tool") {
    window.active.pop();
  }

  if (window.active.at(-1)?.role === "assistant") {
    window.active.pop();
    return true;
  }

  return false;
};

export const appendToolResult = (
  window: CormWindow,
  result: ToolResult,
  config: CormConfig,
): void => {
  const body = limitBody(toolResultText(result), config);

  window.active.push(toolMessage(body.content, config));
  if (body.truncated) {
    window.active.push(truncationHintMessage(config));
  }

  recount(window, config);
};

export const foldAssistantDelta = (
  window: CormWindow,
  delta: CormOmwChatDelta,
  config: CormConfig,
): void => {
  const previous = liveAssistant(window);
  const message = foldAssistant(previous, delta, config);

  if (previous === undefined) {
    window.active.push(message);
  } else {
    window.active[window.active.length - 1] = message;
  }

  recount(window, config);
};

export const appendSummaryDelta = (
  turn: CormTurn,
  delta: CormOmwChatDelta,
  config: CormConfig,
): void => {
  if (delta.content === undefined) {
    return;
  }

  const charsPerToken = config.charsPerToken ?? CORM_DEFAULT_CHARS_PER_TOKEN;
  const limit = estimateTokenChars(
    config.compactSummaryLimit ?? CORM_DEFAULT_COMPACT_SUMMARY_LIMIT,
    charsPerToken,
  );

  turn.summary = ((turn.summary ?? "") + delta.content).slice(0, limit);
};

export const recount = (window: CormWindow, config: CormConfig): void => {
  const charsPerToken = config.charsPerToken ?? CORM_DEFAULT_CHARS_PER_TOKEN;
  const overhead =
    config.messageOverheadTokens ?? CORM_DEFAULT_MESSAGE_OVERHEAD_TOKENS;

  // The size metric tracks the message history only; the rolling summary is
  // accounted for separately and never counted against the compaction budget.
  window.tokens = estimateMessagesTokens(
    window.active.map((message) => message.message),
    charsPerToken,
    overhead,
  );
  window.chars = window.active.reduce(
    (total, message) => total + message.chars,
    0,
  );
};

// The size the thresholds compare against: the provider's last anchor when it
// is larger than the estimate, so a real measurement is never lowered away.
export const windowSize = (window: CormWindow): number =>
  Math.max(window.anchor ?? 0, window.tokens);

export const softLimit = (config: CormConfig): number =>
  (config.compactThreshold ?? CORM_DEFAULT_COMPACT_THRESHOLD) *
  config.contextLength;

export const hardLimit = (config: CormConfig): number =>
  (config.hardThreshold ?? CORM_DEFAULT_HARD_THRESHOLD) * config.contextLength;

export const overSoft = (window: CormWindow, config: CormConfig): boolean =>
  windowSize(window) >= softLimit(config);

export const overHard = (window: CormWindow, config: CormConfig): boolean =>
  windowSize(window) >= hardLimit(config);

// How many recent messages compaction never evicts: at most `protectMessages`
// and at most `protectRatio` of the window, but never fewer than one.
export const protectedTailCount = (
  window: CormWindow,
  config: CormConfig,
): number => {
  const count = window.active.length;
  const ratio = config.protectRatio ?? CORM_DEFAULT_PROTECT_RATIO;
  const cap = config.protectMessages ?? CORM_DEFAULT_PROTECT_MESSAGES;
  return Math.max(1, Math.min(cap, Math.floor(count * ratio)));
};

// Install a collected summary: fold everything before the protected tail into
// it, record the evicted digests as a receipt, and drop the anchor (the size
// metric is re-measured from the compacted window).
export const commitCompaction = (
  window: CormWindow,
  summary: string,
  receipts: string[][],
  config: CormConfig,
): void => {
  const tailCount = protectedTailCount(window, config);
  const cut = Math.max(0, window.active.length - tailCount);
  const evicted = window.active.slice(0, cut);

  if (evicted.length > 0) {
    receipts.push(evicted.map((message) => message.digest));
    const cap = config.compactionReceipts ?? CORM_DEFAULT_COMPACTION_RECEIPTS;
    while (receipts.length > cap) {
      receipts.shift();
    }
  }

  window.summary = summary;
  window.active = window.active.slice(cut);
  window.anchor = undefined;
  recount(window, config);
};

export const isCompacted = (digest: string, receipts: string[][]): boolean =>
  receipts.some((receipt) => receipt.includes(digest));

export const fillNotice = (
  template: string,
  values: { name: string; id: number; description: string },
): string =>
  template
    .replaceAll("{{NAME}}", values.name)
    .replaceAll("{{ID}}", String(values.id))
    .replaceAll("{{DESCRIPTION}}", values.description);

// The examined tail of an incoming request: the most recent `requestMessages`
// messages, so a client that re-sends its whole history stays bounded.
const requestTail = (
  offered: CormOmwChatMessage[],
  config: CormConfig,
): CormOmwChatMessage[] =>
  offered.slice(
    -Math.max(1, config.requestMessages ?? CORM_DEFAULT_REQUEST_MESSAGES),
  );

// A request whose most recent known messages include one that compaction has
// since evicted needs a recap before its new turn; interleaving alone never
// recaps. Only the examined tail's last `recapMessages` are scanned.
export const needsRecap = (
  offered: CormOmwChatMessage[],
  receipts: string[][],
  config: CormConfig,
): boolean => {
  if (receipts.length === 0) {
    return false;
  }

  const recent = requestTail(offered, config).slice(
    -Math.max(1, config.recapMessages ?? CORM_DEFAULT_RECAP_MESSAGES),
  );

  return recent.some((message) =>
    isCompacted(incoming(message, config).message.digest, receipts),
  );
};

// The messages to replay in a resume recap: the newest `replayMessages` of the
// examined tail that compaction has evicted, trimmed from the oldest until the
// replay fits `replayRatio * contextLength` tokens.
export const recapReplay = (
  offered: CormOmwChatMessage[],
  receipts: string[][],
  config: CormConfig,
): CormOmwChatMessage[] => {
  if (receipts.length === 0) {
    return [];
  }

  const charsPerToken = config.charsPerToken ?? CORM_DEFAULT_CHARS_PER_TOKEN;
  const overhead =
    config.messageOverheadTokens ?? CORM_DEFAULT_MESSAGE_OVERHEAD_TOKENS;
  const cap =
    (config.replayRatio ?? CORM_DEFAULT_REPLAY_RATIO) * config.contextLength;

  const replying = requestTail(offered, config)
    .filter((message) =>
      isCompacted(incoming(message, config).message.digest, receipts),
    )
    .slice(-Math.max(1, config.replayMessages ?? CORM_DEFAULT_REPLAY_MESSAGES));

  const tokens = (message: CormOmwChatMessage): number =>
    estimateMessageTokens(
      incoming(message, config).message,
      charsPerToken,
      overhead,
    );

  let start = 0;
  let total = replying.reduce((sum, message) => sum + tokens(message), 0);
  while (start < replying.length - 1 && total > cap) {
    total -= tokens(replying[start]);
    start += 1;
  }

  return replying.slice(start);
};

// Append replayed raw messages to the window, framing and truncating each like
// an ingest but without the known/compacted skip (the replay is deliberately of
// evicted content recovered from the re-offer).
export const appendReplayMessages = (
  window: CormWindow,
  offered: CormOmwChatMessage[],
  config: CormConfig,
): void => {
  for (const offeredMessage of offered) {
    const { message, truncated } = incoming(offeredMessage, config);
    window.active.push(message);
    if (truncated) {
      window.active.push(truncationHintMessage(config));
    }
  }

  recount(window, config);
};
