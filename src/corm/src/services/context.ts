import type { CormLogger } from "corm/lib/log";
import type { CormConfig } from "corm/lib/opaque";
import type { CormHandles } from "./handles";
import type { CormTooling } from "./tooling";

export interface CormContext {
  handles: CormHandles;
  config: CormConfig;
  tooling: CormTooling;
  logger: CormLogger;
}
