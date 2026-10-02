import type testConfig from "../omw.test.template.json";
import { createCormConfigManager } from "./services/config";
import type { CormContext } from "./services/context";
import { createCormHandlesManager } from "./services/handles";
import { createCormMachine } from "./services/machine";
import { createCormHandlerRegistrar } from "./services/registrar";
import { createCormStateManager } from "./services/state";
import { createCormTooling } from "./services/tooling";

const globalOmw = omw as Omw<typeof testConfig>;

const handleManager = createCormHandlesManager(globalOmw);
const stateManager = createCormStateManager(globalOmw);
const configManager = createCormConfigManager(globalOmw);

const context: CormContext = {
  handles: handleManager.load(),
  config: configManager,
  tooling: createCormTooling(handleManager.load()),
};

const registrar = createCormHandlerRegistrar(context);
const machine = createCormMachine(context, stateManager.load(), registrar);
machine.initialize();

while (true) {
  const event = globalOmw.host.recv();

  machine.handle(event);

  if (event.kind === "reload" || event.kind === "shutdown") {
    stateManager.release(event);
    handleManager.release(event);
    configManager.release(event);

    break;
  }
}
