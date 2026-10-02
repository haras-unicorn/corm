import CormChatHandler from "../handlers/chat";
import type { CormHandlerFactory } from "./registrar";

const registry = (() => {
  return new Set([CormChatHandler]) as Set<CormHandlerFactory>;
})();

export default registry;
