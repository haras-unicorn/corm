import type { CormConfig } from "../types/config";
import type {
  CormAssistantMessage,
  CormNonSystemMessage,
  CormSystemMessage,
  CormToolMessage,
  CormUserMessage,
  CormUserMessageTag,
} from "../types/message";
import type {
  CormOmwChatDelta,
  CormOmwChatMessage,
  CormOmwToolCall,
} from "../types/omw";
import {
  CORM_DEFAULT_CHARS_PER_TOKEN,
  CORM_DEFAULT_MESSAGE_OVERHEAD_TOKENS,
} from "./defaults";
import { frame } from "./framing";
import { estimateMessageTokens, messageDigest } from "./tokens";
import { mergeToolCalls } from "./tools";

const rate = (config: CormConfig): [number, number] => [
  config.charsPerToken ?? CORM_DEFAULT_CHARS_PER_TOKEN,
  config.messageOverheadTokens ?? CORM_DEFAULT_MESSAGE_OVERHEAD_TOKENS,
];

const base = <M extends CormOmwChatMessage>(message: M, config: CormConfig) => {
  const [charsPerToken, overhead] = rate(config);
  return {
    message,
    digest: messageDigest(message),
    chars: message.content?.length ?? 0,
    tokens: estimateMessageTokens(message, charsPerToken, overhead),
  };
};

export const systemMessage = (
  content: string,
  config: CormConfig,
): CormSystemMessage => {
  const message = { role: "system", content } as const;
  return { ...base(message, config), role: "system", content };
};

export const userMessage = (
  tag: CormUserMessageTag,
  content: string,
  config: CormConfig,
): CormUserMessage => {
  const framed = frame(tag, content);
  const message = { role: "user", content: framed } as const;
  return { ...base(message, config), role: "user", tag, content: framed };
};

export const assistantMessage = (
  content: string,
  reasoning: string | undefined,
  toolCall: CormOmwToolCall | undefined,
  config: CormConfig,
): CormAssistantMessage => {
  const message = { role: "assistant", content, reasoning, toolCall } as const;
  return {
    ...base(message, config),
    role: "assistant",
    content,
    reasoning,
    toolCall,
    deltas: [],
  };
};

export const toolMessage = (
  content: string,
  config: CormConfig,
): CormToolMessage => {
  const message = { role: "tool", content } as const;
  return { ...base(message, config), role: "tool", content };
};

export const foldAssistant = (
  previous: CormAssistantMessage | undefined,
  delta: CormOmwChatDelta,
  config: CormConfig,
): CormAssistantMessage => {
  const content = (previous?.content ?? "") + (delta.content ?? "");
  const reasoning = (previous?.reasoning ?? "") + (delta.reasoning ?? "");
  const toolCall = mergeToolCalls(previous?.toolCall, delta.toolCall);

  const next = assistantMessage(
    content,
    reasoning === "" ? undefined : reasoning,
    toolCall,
    config,
  );
  next.deltas = [...(previous?.deltas ?? []), delta];

  return next;
};

// Recompute the derived fields of a stored message after it is restored, so a
// seeded window may carry only the provider-form `message`.
export const recomputeMessage = <M extends CormNonSystemMessage>(
  message: M,
  config: CormConfig,
): M => {
  const [charsPerToken, overhead] = rate(config);
  return {
    ...message,
    digest: messageDigest(message.message),
    chars: message.message.content?.length ?? 0,
    tokens: estimateMessageTokens(message.message, charsPerToken, overhead),
  };
};

export const clientDelta = (delta: CormOmwChatDelta): CormOmwChatDelta => {
  const visible: CormOmwChatDelta = {};
  if (delta.content !== undefined) {
    visible.content = delta.content;
  }
  if (delta.reasoning !== undefined) {
    visible.reasoning = delta.reasoning;
  }
  if (delta.toolCall !== undefined) {
    visible.toolCall = delta.toolCall;
  }
  if (delta.usage !== undefined) {
    visible.usage = delta.usage;
  }
  return visible;
};
