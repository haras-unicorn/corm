import type { CormOmw } from "./lib/omw";
import { createCormConfigManager } from "./services/config";
import type { CormContext } from "./services/context";
import { createCormHandlesManager } from "./services/handles";
import { createCormLogger } from "./services/logger";
import { createCormMachine } from "./services/machine";
import { createCormHandlerRegistrar } from "./services/registrar";
import { createCormStateManager } from "./services/state";
import { createCormTooling } from "./services/tooling";
import { createCormWindow } from "./services/window";

const globalOmw = omw as CormOmw;
const logger = createCormLogger(globalOmw.host);

logger.info("corm starting");

const handleManager = createCormHandlesManager(globalOmw);
const configManager = createCormConfigManager(globalOmw);

const handles = handleManager.load();
const config = configManager.load();
const tooling = createCormTooling(handles, config.tools);
const window = createCormWindow(config, logger);
const stateManager = createCormStateManager(globalOmw, window);

const context: CormContext = {
  handles,
  config,
  tooling,
  window,
  logger,
};

const registrar = createCormHandlerRegistrar(context);
const machine = createCormMachine(context, stateManager.load(), registrar);

logger.info("corm ready");

while (true) {
  let event: OmwEvent | null = null;
  try {
    event = globalOmw.host.recv();
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

  try {
    machine.handle(event);
  } catch (error) {
    const message = (error as Error).message;
    logger.warn(`failed handling event '${event.kind}': ${message}`);
    continue;
  }

  if (event.kind === "reload" || event.kind === "shutdown") {
    logger.info(`corm ${event.kind}: releasing managers`);

    try {
      stateManager.release(event);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`failed releasing state manager: ${message}`);
    }

    try {
      handleManager.release(event);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`failed releasing handle manager: ${message}`);
    }

    try {
      configManager.release(event);
    } catch (error) {
      const message = (error as Error).message;
      logger.error(`failed releasing config manager: ${message}`);
    }

    break;
  }
}

logger.info("corm stopped");
