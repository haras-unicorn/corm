import { createCormHandlesManager } from "./services/handles";
import { createCormMachine } from "./services/machine";
import { createCormHandlerRegistrar } from "./services/registrar";
import { createCormStateManager } from "./services/state";

const globalOmw = omw;

const handleManager = createCormHandlesManager(globalOmw);
const stateManager = createCormStateManager(globalOmw);
const registrar = createCormHandlerRegistrar(
  handleManager.load(),
  stateManager.load(),
);

const machine = createCormMachine(
  handleManager.load(),
  stateManager.load(),
  registrar,
);
machine.initialize();

while (true) {
  const event = globalOmw.host.recv();

  machine.handle(event);

  if (event.kind === "reload" || event.kind === "shutdown") {
    stateManager.release(event);
    handleManager.release(event);

    break;
  }
}
