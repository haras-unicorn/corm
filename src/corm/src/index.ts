import { hasAwaitingTools, isTurnIdling } from "./lib/turn";
import { reduce } from "./reducers";
import { createCormConfigManager } from "./services/config";
import { createDispatcher } from "./services/dispatch";
import { createCormHandlesManager } from "./services/handles";
import { createCormLogger } from "./services/logger";
import { createCormStateManager } from "./services/state";
import type { CormOmw, CormOmwEvent } from "./types/omw";

const globalOmw = omw as CormOmw;
const logger = createCormLogger(globalOmw.host);

logger.info("corm starting");

const config = createCormConfigManager(logger, globalOmw).load();
const handles = createCormHandlesManager(globalOmw, config, logger).load();
const stateManager = createCormStateManager(logger, handles, config);
const state = stateManager.load();

const dispatcher = createDispatcher(logger, handles, config, state);

const dispatch = (event: CormOmwEvent): void => {
  for (const effect of reduce(event, state, config)) {
    try {
      dispatcher.dispatch(effect);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`failed dispatching ${effect.kind}: ${message}`);
    }
  }
};

// Drain the inbox once the machine is idle: only one generation (and one window
// writer) may run at a time, so requests that arrived mid-turn are answered in
// order here.
const drain = (): void => {
  while (
    state.disk.inbox.length > 0 &&
    isTurnIdling(state) &&
    !hasAwaitingTools(state)
  ) {
    const queued = state.disk.inbox.shift();
    if (queued === undefined) {
      break;
    }

    logger.debug(
      `draining queued endpoint request ${queued.event.payload.session}`,
    );
    dispatch(queued.event);
  }
};

logger.info("corm ready");

while (true) {
  let event: CormOmwEvent | null = null;
  try {
    event = handles.host().recv();
  } catch (error) {
    const message = (error as Error).message;
    logger.debug(`failed waiting for events: ${message}`);
    // NOTE: this is to prevent it from spinning in tests
    // since asserted tests keep going without emitting a shutdown event
    // until all tests pass
    globalOmw.host.sleepFor(100);
    continue;
  }

  logger.trace(`recv ${event.kind}`);

  if (event.kind === "reload" || event.kind === "shutdown") {
    logger.info(`corm ${event.kind}: releasing managers`);

    try {
      stateManager.release(event);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`failed releasing state manager: ${message}`);
    }

    break;
  }

  dispatch(event);
  drain();
}

logger.info("corm stopped");
