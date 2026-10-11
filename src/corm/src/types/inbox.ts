import z from "zod";
import type { CormOmwEvent } from "./omw";

export const cormInboxMessageZod = z.object({
  event: z.custom<CormOmwEvent & { kind: "endpoint-message" }>(),
});

export type CormInboxMessage = z.infer<typeof cormInboxMessageZod>;

export const cormInboxZod = z.array(cormInboxMessageZod);

export type CormInbox = z.infer<typeof cormInboxMessageZod>;
