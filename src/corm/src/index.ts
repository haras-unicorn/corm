import { hasAwaitingTools, isTurnIdling } from "./lib/turn";
import { reduce } from "./reducers";
import { createCormConfigManager } from "./services/config";
import { createDispatcher } from "./services/dispatch";
import { createCormHandlesManager } from "./services/handles";
import { createCormLogger } from "./services/logger";
import { createCormStateManager } from "./services/state";
import type { CormAction } from "./types/action";
import type { CormOmw, CormOmwEvent } from "./types/omw";

const globalOmw = omw as CormOmw;
const logger = createCormLogger(globalOmw.host);

logger.info("corm starting");

const config = createCormConfigManager(logger, globalOmw).load();
const handles = createCormHandlesManager(globalOmw, config, logger).load();
const stateManager = createCormStateManager(logger, handles, config);
const state = stateManager.load();

// The dispatcher's constructor arms the digest or parks a catch-up run for the
// next safe point.
const dispatcher = createDispatcher(logger, handles, config, state);

const dispatch = (event: CormAction): void => {
  for (const effect of reduce(
    event,
    state,
    config,
    globalOmw.host.timeNow(),
  )) {
    try {
      dispatcher.dispatch(effect);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`failed dispatching ${effect.kind}: ${message}`);
    }
  }
};

// One step of the machine: answer the next inbox message, otherwise start a
// parked digest, otherwise stay idle. Called at startup and after every event,
// so a finished turn immediately picks up whatever is waiting.
const pump = (): void => {
  if (!isTurnIdling(state) || hasAwaitingTools(state)) {
    return;
  }

  const queued = state.disk.inbox.shift();
  if (queued !== undefined) {
    logger.debug(
      `pumping queued endpoint request ${queued.event.payload.session}`,
    );
    dispatch(queued.event);
    return;
  }

  dispatcher.startPendingDigest();
};

logger.info("corm ready");

pump();

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
  pump();
}

logger.info("corm stopped");
