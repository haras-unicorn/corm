import { createCormLogger } from "./lib/log";
import type { CormOmw } from "./lib/omw";
import { createCormConfigManager } from "./services/config";
import type { CormContext } from "./services/context";
import { createCormHandlesManager } from "./services/handles";
import { createCormMachine } from "./services/machine";
import { createCormHandlerRegistrar } from "./services/registrar";
import { createCormStateManager } from "./services/state";
import { createCormTooling } from "./services/tooling";

const globalOmw = omw as CormOmw;
const logger = createCormLogger(globalOmw.host);

logger.info("corm starting");

const handleManager = createCormHandlesManager(globalOmw);
const configManager = createCormConfigManager(globalOmw);
const stateManager = createCormStateManager(globalOmw);

const context: CormContext = {
  handles: handleManager.load(),
  config: configManager.load(),
  tooling: createCormTooling(handleManager.load()),
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
    logger.warn(`failed waiting for events: ${message}`);
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
