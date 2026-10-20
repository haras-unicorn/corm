import z from "zod";
import type {
  CormOmwChatDelta,
  CormOmwChatMessage,
  CormOmwRole,
  CormOmwToolCall,
} from "./omw";

export const cormMessageZod = z.object({
  message: z.custom<CormOmwChatMessage>(),
  role: z.custom<CormOmwRole>(),
  // `digest`/`chars`/`tokens` are derived from `message`; they are defaulted so
  // a restored window may seed only the message body and be recomputed on load.
  digest: z.string().default(""),
  chars: z.number().default(0),
  tokens: z.number().default(0),
});

export interface CormMessage extends z.infer<typeof cormMessageZod> {}

export const cormAssistantMessageZod = cormMessageZod.safeExtend({
  message: z.custom<CormOmwChatMessage & { role: "assistant" }>(),
  role: z.literal("assistant"),
  deltas: z.array(z.custom<CormOmwChatDelta>()).default([]),
  content: z.string().default(""),
  reasoning: z.string().optional(),
  toolCalls: z.array(z.custom<CormOmwToolCall>()).default([]),
});

export type CormAssistantMessage = z.infer<typeof cormAssistantMessageZod>;

export const cormSystemMessageZod = cormMessageZod.safeExtend({
  message: z.custom<CormOmwChatMessage & { role: "system" }>(),
  role: z.literal("system"),
  content: z.string().default(""),
});

export type CormSystemMessage = z.infer<typeof cormSystemMessageZod>;

export const cormToolMessageZod = cormMessageZod.safeExtend({
  message: z.custom<CormOmwChatMessage & { role: "tool" }>(),
  role: z.literal("tool"),
  content: z.string().default(""),
  toolCallId: z.string().optional(),
});

export interface CormToolMessage extends z.infer<typeof cormToolMessageZod> {}

export const cormUserMessageTagZod = z.enum(["runtime", "persona", "client"]);

export type CormUserMessageTag = z.infer<typeof cormUserMessageTagZod>;

export const cormUserMessageZod = cormMessageZod.safeExtend({
  message: z.custom<CormOmwChatMessage & { role: "user" }>(),
  role: z.literal("user"),
  tag: cormUserMessageTagZod,
  content: z.string().default(""),
});

export interface CormUserMessage extends z.infer<typeof cormUserMessageZod> {}

export const cormUserRuntimeMessageZod = cormUserMessageZod.safeExtend({
  tag: z.literal("runtime"),
});
export const cormUserPersonaMessageZod = cormUserMessageZod.safeExtend({
  tag: z.literal("persona"),
});
export const cormUserClientMessageZod = cormUserMessageZod.safeExtend({
  tag: z.literal("client"),
});

export type CormUserRuntimeMessage = z.infer<typeof cormUserRuntimeMessageZod>;
export type CormUserPersonaMessage = z.infer<typeof cormUserPersonaMessageZod>;
export type CormUserClientMessage = z.infer<typeof cormUserClientMessageZod>;

export const cormNonSystemMessageZod = z.discriminatedUnion("role", [
  cormAssistantMessageZod,
  cormToolMessageZod,
  cormUserMessageZod,
]);

export type CormNonSystemMessage = z.infer<typeof cormNonSystemMessageZod>;
