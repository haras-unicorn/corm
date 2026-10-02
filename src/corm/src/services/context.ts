import type { CormConfigManager } from "./config";
import type { CormHandles } from "./handles";
import type { CormTooling } from "./tooling";

export interface CormContext {
  handles: CormHandles;
  config: CormConfigManager;
  tooling: CormTooling;
}
