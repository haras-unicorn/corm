import z from "zod";
import {
  CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  CORM_DEFAULT_PROMPT_PRELUDE,
  CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
} from "corm/lib/defaults";
import { recomputeMessage, systemMessage } from "corm/lib/messages";
import { cormTools } from "corm/lib/tools";
import { recount } from "corm/lib/window";
import type { CormConfig } from "./config";
import { cormInboxZod } from "./inbox";
import type { CormOmwTool } from "./omw";
import { cormSubscriptionsZod } from "./subscriptions";
import { cormTurnZod, defaultTurn, type CormTurn } from "./turn";
import { cormWindowZod, type CormWindow } from "./window";

export const cormMemoryStateZod = z.object({
  subscriptions: cormSubscriptionsZod,
});

export interface CormMemoryState extends z.infer<typeof cormMemoryStateZod> {}

export const cormDigestStateZod = z.object({
  // The start time of the last successful digest, in epoch milliseconds.
  last: z.number().optional(),
});

export type CormDigestState = z.infer<typeof cormDigestStateZod>;

// The persisted part of the disk state. Per-process fields (turn, notices) and
// config-derived fields (the system message and tool list) are rebuilt by
// `defaultDisk`; only the stored window data is parsed.
export const cormStoredDiskStateZod = z.object({
  inbox: cormInboxZod.default([]),
  window: cormWindowZod.optional(),
  // Bounded receipts of compaction evictions: the digests of each compaction's
  // evicted set, kept so a re-offered evicted message is classified as
  // `compacted` (and not re-added) rather than `new`.
  receipts: z.array(z.array(z.string())).default([]),
  digest: cormDigestStateZod.default({}),
  // A per-process counter of endpoint requests served, used to label recaps.
  task: z.number().default(0),
});

export type CormStoredDiskState = z.infer<typeof cormStoredDiskStateZod>;

export interface CormDiskState extends CormStoredDiskState {
  window: CormWindow;
  turn: CormTurn;
  // Runtime notices waiting for a safe point to enter the window. They are
  // transient: `defaultDisk` starts them empty.
  notices: string[];
}

export interface CormState {
  memory: CormMemoryState;
  disk: CormDiskState;
}

// Build the runtime disk state from the defaults (config-derived system prompt
// and tools, a fresh turn, empty notices) and, when restoring, the persisted
// subset.
export const defaultDisk = (
  config: CormConfig,
  tools: CormOmwTool[],
  stored?: CormStoredDiskState,
): CormDiskState => {
  const systemContent = [
    config.runtimeSystemPrompt ?? CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
    config.chatSystemPrompt ?? CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  ].join("\n\n");

  const content =
    config.prompt !== undefined && config.prompt !== ""
      ? `${systemContent}\n\n${
          config.promptPrelude ?? CORM_DEFAULT_PROMPT_PRELUDE
        }\n\n${config.prompt}`
      : systemContent;

  const window: CormWindow = {
    system: systemMessage(content, config),
    summary: stored?.window?.summary ?? "",
    active: (stored?.window?.active ?? []).map((message) =>
      recomputeMessage(message, config),
    ),
    tools: cormTools(tools, config),
    session: stored?.window?.session ?? "",
    params: stored?.window?.params,
    tokens: 0,
    chars: 0,
  };

  recount(window, config);

  return {
    inbox: stored?.inbox ?? [],
    window,
    turn: defaultTurn(),
    receipts: stored?.receipts ?? [],
    digest: { last: stored?.digest.last },
    task: stored?.task ?? 0,
    notices: [],
  };
};
