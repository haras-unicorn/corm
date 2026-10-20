import z from "zod";

export const cormDigestSubscriptionZod = z.object({
  // The armed cron timer handle. Ephemeral: it is reset on load.
  timer: z.string().optional(),
  // What the digest needs to do at the next safe point.
  pending: z.enum(["start", "resume"]).optional(),
});

export type CormDigestSubscription = z.infer<typeof cormDigestSubscriptionZod>;

export const cormSubscriptionsZod = z.compile(
  z.object({
    lifecycle: z.string().readonly(),
    endpoint: z.string().readonly(),
    generation: z.string().optional(),
    digest: cormDigestSubscriptionZod.optional(),
  }),
);

export type CormSubscriptions = z.infer<typeof cormSubscriptionsZod>;
