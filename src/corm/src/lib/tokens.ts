const CORM_CHARS_PER_TOKEN = 4;

const CORM_MESSAGE_OVERHEAD_TOKENS = 4;

export const estimateCharTokens = (chars: number): number => {
  return Math.ceil(chars / CORM_CHARS_PER_TOKEN);
};

export const estimateTokenChars = (tokens: number): number => {
  return tokens * CORM_CHARS_PER_TOKEN;
};

export const estimateTextTokens = (text?: string): number => {
  if (text === undefined || text === "") {
    return 0;
  }

  return estimateCharTokens(text.length);
};

export const estimateMessageTokens = (message: ChatMessage): number => {
  let tokens = CORM_MESSAGE_OVERHEAD_TOKENS;
  tokens += estimateTextTokens(message.content);
  tokens += estimateTextTokens(message.reasoning);
  tokens += estimateTextTokens(stringify(message.toolCall));
  return tokens;
};

export const estimateMessagesTokens = (messages: ChatMessage[]): number =>
  messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );

export const toolCallKey = (name: string, args: unknown): string =>
  `${name}:${canonicalize(args)}`;

export const messageFingerprint = (message: ChatMessage): string => {
  try {
    return JSON.stringify(message) ?? "";
  } catch {
    return "";
  }
};

export const messageDigest = (message: ChatMessage): string => {
  const text = [
    message.role ?? "user",
    message.content ?? "",
    message.reasoning ?? "",
    message.toolCall !== undefined
      ? `${message.toolCall.id ?? ""}\u0001${toolCallKey(message.toolCall.name, message.toolCall.arguments)}`
      : "",
  ].join("\u0000");
  const first = fnv1a(text, 0x811c9dc5);
  const second = fnv1a(text, 0x01000193);
  return `${first.toString(16)}:${second.toString(16)}`;
};

export const truncateContent = (
  content: string,
  limitTokens: number,
  marker: string,
): string => {
  const limit = limitTokens * CORM_CHARS_PER_TOKEN;
  if (content.length <= limit) {
    return content;
  }

  const remaining = Math.max(0, limit - marker.length);
  const head = Math.ceil(remaining / 2);
  const tail = remaining - head;

  return content.slice(0, head) + marker + content.slice(content.length - tail);
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

const fnv1a = (text: string, seed: number): number => {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};
