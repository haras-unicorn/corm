export const estimateCharTokens = (
  chars: number,
  charsPerToken: number,
): number => {
  return Math.ceil(chars / charsPerToken);
};

export const estimateTokenChars = (
  tokens: number,
  charsPerToken: number,
): number => {
  return tokens * charsPerToken;
};

export const estimateTextTokens = (
  text: string | undefined,
  charsPerToken: number,
): number => {
  if (text === undefined || text === "") {
    return 0;
  }

  return estimateCharTokens(text.length, charsPerToken);
};

export const estimateMessageTokens = (
  message: ChatMessage,
  charsPerToken: number,
  messageTokenOverhead: number,
): number => {
  let tokens = messageTokenOverhead;
  tokens += estimateTextTokens(message.content, charsPerToken);
  tokens += estimateTextTokens(message.reasoning, charsPerToken);
  tokens += estimateTextTokens(stringify(message.toolCalls), charsPerToken);
  return tokens;
};

export const estimateMessagesTokens = (
  messages: ChatMessage[],
  charsPerToken: number,
  messageTokenOverhead: number,
): number =>
  messages.reduce(
    (total, message) =>
      total +
      estimateMessageTokens(message, charsPerToken, messageTokenOverhead),
    0,
  );

export const toolCallKey = (name: string, args: unknown): string =>
  `${name}:${canonicalize(args)}`;

// The prompt size a provider reported on a delta's opaque usage, summing the
// prompt and completion counts. omw passes the wire object through verbatim as
// an opaque JSON string (or, once parsed, an object), so both shapes and both
// the snake_case wire spelling and the camelCase alias are accepted.
export const usageAnchor = (usage: unknown): number | undefined => {
  let value = usage;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  if (value === null || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const number = (entry: unknown): number =>
    typeof entry === "number" ? entry : 0;
  const tokens =
    number(record.prompt_tokens ?? record.promptTokens) +
    number(record.completion_tokens ?? record.completionTokens);

  return tokens > 0 ? tokens : undefined;
};

export const messageFingerprint = (message: ChatMessage): string => {
  try {
    return JSON.stringify(message) ?? "";
  } catch {
    return "";
  }
};

// The identity of a message for the window's content addressing. `reasoning` is
// deliberately excluded: a client that re-offers its history sends the visible
// assistant content and tool calls but never the provider's private reasoning,
// so including it would make an assistant turn hash differently on re-offer and
// be appended as a duplicate instead of being skipped.
export const messageDigest = (message: ChatMessage): string => {
  const toolCalls = (message.toolCalls ?? [])
    .map(
      (call) =>
        `${call.id ?? ""}\u0001${toolCallKey(call.name, call.arguments)}`,
    )
    .join("\u0002");
  const text = [message.role ?? "user", message.content ?? "", toolCalls].join(
    "\u0000",
  );
  const first = fnv1a(text, 0x811c9dc5);
  const second = fnv1a(text, 0x01000193);
  return `${first.toString(16)}:${second.toString(16)}`;
};

export const truncateContent = (
  content: string,
  limitTokens: number,
  marker: string,
  charsPerToken: number,
): string => {
  const limit = limitTokens * charsPerToken;
  if (content.length <= limit) {
    return content;
  }

  const remaining = Math.max(0, limit - marker.length);
  const head = Math.ceil(remaining / 2);
  const tail = remaining - head;

  return content.slice(0, head) + marker + content.slice(content.length - tail);
};

export const fnv1a = (text: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const stringify = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(",")}}`;
};

const canonicalize = (value: unknown): string => {
  if (typeof value === "string") {
    try {
      return stableStringify(JSON.parse(value));
    } catch {
      return value;
    }
  }

  return stableStringify(value);
};
