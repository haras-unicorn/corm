import type { CormLogger } from "corm/lib/log";
import type { CormConfig } from "corm/lib/opaque";
import type { CormHandles } from "./handles";
import type { CormTooling } from "./tooling";
import type { CormWindow } from "./window";

export interface CormContext {
  handles: CormHandles;
  config: CormConfig;
  tooling: CormTooling;
  window: CormWindow;
  logger: CormLogger;
}
