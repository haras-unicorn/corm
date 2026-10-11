import CormChatHandler from "corm/handlers/chat";
import {
  CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
} from "corm/lib/defaults";
import type { CormConfig } from "corm/lib/opaque";
import { combinedRuntimePrompts, handlerPrompts } from "corm/lib/registry";
import { expect, test } from "vitest";

test("handlerPrompt aggregates the registered handlers' contributions", () => {
  expect(CormChatHandler.prompt({} as CormConfig)).toBe(
    CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  );
  expect(handlerPrompts({} as CormConfig)).toStrictEqual([
    CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  ]);
});

test("combinedRuntimePrompt injects the handler guidance after the runtime prompt", () => {
  expect(combinedRuntimePrompts({} as CormConfig)).toStrictEqual([
    CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
    CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  ]);
});
