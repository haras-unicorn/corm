import { z } from "zod";

export const cormSubscriptionsZod = z.compile(
  z.object({
    lifecycle: z.string().readonly(),
    endpoint: z.string().readonly(),
    model: z.string().readonly(),
    generation: z.string().optional(),
  }),
);

export type CormSubscriptions = z.infer<typeof cormSubscriptionsZod>;

export const cormConfigZod = z.compile(
  z.object({
    model: z.string().readonly(),
    prompt: z.string().readonly().optional(),
    tools: z.array(z.string()).readonly().optional(),
  }),
);

export type CormConfig = z.infer<typeof cormConfigZod>;

export const cormTaskStateZod = z.compile(z.any());

export type CormTaskState = z.infer<typeof cormTaskStateZod>;

export const cormTaskPlacementZod = z.compile(z.enum(["immediate", "pending"]));

export type CormTaskPlacement = z.infer<typeof cormTaskPlacementZod>;

export const cormTaskSpecZod = z.compile(
  z.object({
    placement: cormTaskPlacementZod,
    state: cormTaskStateZod,
    key: z.string().optional(),
    atomic: z.boolean().optional(),
  }),
);

export type CormTaskSpec = z.infer<typeof cormTaskSpecZod>;

export const cormMaterializedTaskSpecZod = z.compile(
  z.object({
    kind: z.string(),
    spec: cormTaskSpecZod,
  }),
);

export type CormMaterializedTaskSpec = z.infer<
  typeof cormMaterializedTaskSpecZod
>;

export const cormTaskZod = z.compile(
  z.object({
    kind: z.string(),
    id: z.string(),
    state: cormTaskStateZod,
  }),
);

export type CormTask = z.infer<typeof cormTaskZod>;

export const cormStateZod = z.compile(
  z.object({
    pending: z.array(cormTaskZod).default([]),
    immediate: z.array(cormTaskZod).default([]),
  }),
);

export type CormGlobalState = z.infer<typeof cormStateZod>;

export const cormOutcomeZod = z.compile(z.enum(["running", "complete"]));

export type CormOutcome = z.infer<typeof cormOutcomeZod>;
