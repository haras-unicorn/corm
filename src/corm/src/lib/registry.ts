import CormChatHandler from "corm/handlers/chat";
import type { CormHandlerFactory } from "corm/services/registrar";

const registry = (() => {
  return new Set([CormChatHandler]) as Set<CormHandlerFactory>;
})();

export default registry;
