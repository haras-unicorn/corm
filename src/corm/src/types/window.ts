import z from "zod";
import { cormNonSystemMessageZod, cormSystemMessageZod } from "./message";
import type { CormOmwTool } from "./omw";

export const cormWindowZod = z.compile(
  z.object({
    system: cormSystemMessageZod.default({
      message: { role: "system", content: "" },
      role: "system",
      content: "",
      digest: "",
      chars: 0,
      tokens: 0,
    }),
    // The rolling summary of the evicted history, injected as a leading
    // `⟦runtime⟧` message. Empty when there is nothing compacted yet.
    summary: z.string().default(""),
    active: z.array(cormNonSystemMessageZod).default([]),
    tools: z.array(z.custom<CormOmwTool>()).default([]),
    session: z.string().default(""),
    params: z.unknown().optional(),
    // The provider's reported prompt size for the last turn, used to anchor the
    // size metric against a real measurement instead of the estimate.
    anchor: z.number().optional(),
    tokens: z.number().default(0),
    chars: z.number().default(0),
  }),
);

export interface CormWindow extends z.infer<typeof cormWindowZod> {}
