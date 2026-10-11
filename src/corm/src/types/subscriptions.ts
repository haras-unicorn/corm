import z from "zod";

export const cormSubscriptionsZod = z.compile(
  z.object({
    lifecycle: z.string().readonly(),
    endpoint: z.string().readonly(),
    generation: z.string().optional(),
  }),
);

export type CormSubscriptions = z.infer<typeof cormSubscriptionsZod>;
