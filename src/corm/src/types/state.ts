import z from "zod";
import { cormInboxZod } from "./inbox";
import { cormSubscriptionsZod } from "./subscriptions";
import { cormTurnZod, defaultTurn } from "./turn";
import { cormWindowZod } from "./window";

export const cormMemoryStateZod = z.object({
  subscriptions: cormSubscriptionsZod,
});

export interface CormMemoryState extends z.infer<typeof cormMemoryStateZod> {}

export const cormDiskStateZod = z.object({
  inbox: cormInboxZod.default([]),
  window: cormWindowZod,
  turn: cormTurnZod.default(defaultTurn()),
  // Bounded receipts of compaction evictions: the digests of each compaction's
  // evicted set, kept so a re-offered evicted message is classified as
  // `compacted` (and not re-added) rather than `new`.
  receipts: z.array(z.array(z.string())).default([]),
  // A per-process counter of endpoint requests served, used to label recaps.
  task: z.number().default(0),
});

export interface CormDiskState extends z.infer<typeof cormDiskStateZod> {}

export interface CormState {
  memory: CormMemoryState;
  disk: CormDiskState;
}
