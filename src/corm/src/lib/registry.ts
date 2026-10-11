import CormChatHandler from "corm/handlers/chat";
import type { CormHandlerFactory } from "corm/services/registrar";
import { CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT } from "./defaults";
import type { CormConfig } from "./opaque";

const registry = (() => {
  return new Set([CormChatHandler]) as Set<CormHandlerFactory>;
})();

export const handlerPrompts = (config: CormConfig): string[] =>
  [...registry]
    .map((factory) => factory.prompt(config))
    .filter((prompt) => prompt !== "");

export const combinedRuntimePrompts = (config: CormConfig): string[] =>
  [
    config.runtimeSystemPrompt ?? CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
    ...handlerPrompts(config),
  ].filter((part) => part !== "");

export default registry;
