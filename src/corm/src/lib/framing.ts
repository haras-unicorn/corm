export const CORM_FRAMING_OPEN = "⟦";

export const CORM_FRAMING_CLOSE = "⟧";

export const CORM_FRAMING_TAGS = {
  runtime: "runtime",
  persona: "persona",
  client: "client",
} as const;

export type CormFramingTag =
  (typeof CORM_FRAMING_TAGS)[keyof typeof CORM_FRAMING_TAGS];

export const CORM_FRAMING_ATTEMPT = /⟦[A-Za-z][A-Za-z0-9_/.-]*⟧/;

export const escapeFraming = (text: string): string =>
  text
    .replaceAll(CORM_FRAMING_OPEN, `\\${CORM_FRAMING_OPEN}`)
    .replaceAll(CORM_FRAMING_CLOSE, `\\${CORM_FRAMING_CLOSE}`);

export const frame = (tag: string, content?: string): string =>
  `${CORM_FRAMING_OPEN}${tag}${CORM_FRAMING_CLOSE}\n\n${escapeFraming(content ?? "")}`;

export const detectFraming = (content?: string): string | undefined =>
  content === undefined
    ? undefined
    : (CORM_FRAMING_ATTEMPT.exec(content)?.[0] ?? undefined);

export const frameInbound = (message: ChatMessage): ChatMessage => {
  const role = message.role ?? "user";
  if (role === "assistant" || role === "tool") {
    return message;
  }

  const tag =
    role === "system" ? CORM_FRAMING_TAGS.persona : CORM_FRAMING_TAGS.client;

  return { ...message, role: "user", content: frame(tag, message.content) };
};

export const runtimeMessage = (content?: string): ChatMessage => ({
  role: "user",
  content: frame(CORM_FRAMING_TAGS.runtime, content),
});
