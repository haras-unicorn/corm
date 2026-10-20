import { matchTaggedUnionExhaustively } from "corm/types/fns";
import type { CormReducer } from "../types/reducer";
import { chatReducer } from "./chat";
import { digestReducer } from "./digest";
import { dropped } from "./dropped";
import { endpointReducer } from "./endpoint";
import { toolReducer } from "./tool";

export const reduce: CormReducer = (action, state, config, now = 0) =>
  matchTaggedUnionExhaustively("kind", action, {
    "endpoint-message": (event) => endpointReducer(event, state, config),
    "endpoint-session-end": (event) => endpointReducer(event, state, config),
    "chat-delta": (event) => chatReducer(event, state, config),
    "chat-end": (event) => chatReducer(event, state, config),
    error: (event) =>
      state.disk.turn.awaiting[event.id] !== undefined
        ? toolReducer(event, state, config)
        : chatReducer(event, state, config),
    timer: (event) => digestReducer(event, state, config, now),
    "tool-result": (event) => toolReducer(event, state, config),
    message: (event) => dropped(event, state, config),
    reload: (event) => dropped(event, state, config),
    shutdown: (event) => dropped(event, state, config),
    "resource-list-updated": (event) => dropped(event, state, config),
    "resource-updated": (event) => dropped(event, state, config),
  });
