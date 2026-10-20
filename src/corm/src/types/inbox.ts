import z from "zod";
import type { CormAction } from "./action";

export const cormInboxMessageZod = z.object({
  event: z.custom<CormAction & { kind: "endpoint-message" }>(),
});

export type CormInboxMessage = z.infer<typeof cormInboxMessageZod>;

export const cormInboxZod = z.array(cormInboxMessageZod);

export type CormInbox = z.infer<typeof cormInboxMessageZod>;
