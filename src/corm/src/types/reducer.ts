import type { CormApprovedEffect } from "../effects/index";
import type { CormAction } from "./action";
import type { CormConfig } from "./config";
import type { CormState } from "./state";

export type CormReducer = (
  action: CormAction,
  state: CormState,
  config: CormConfig,
) => CormApprovedEffect[];
