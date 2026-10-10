import { cormConfigKey } from "corm/lib/keys";
import type { CormOmw } from "corm/lib/omw";
import { createCormConfigManager } from "corm/services/config";
import { expect, test } from "vitest";

function makeOmw(
  memory: Map<string, string> = new Map(),
  calls: { count: number } = { count: 0 },
): CormOmw {
  return {
    host: {
      log: () => {},
      memoryGetAs: (key: string) => {
        calls.count += 1;
        const value = memory.get(key);
        if (value === undefined) {
          return undefined;
        }
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      },
      memoryGet: (key: string) => memory.get(key),
    },
  } as unknown as CormOmw;
}

test("load returns the validated nested seed", () => {
  const memory = new Map([[cormConfigKey, JSON.stringify({ model: "qwen" })]]);
  const manager = createCormConfigManager(makeOmw(memory));

  expect(manager.load()).toEqual({ model: "qwen" });
});

test("load overlays flat memory keys onto the nested config", () => {
  const memory = new Map([
    [cormConfigKey, JSON.stringify({ model: "qwen", prompt: "base" })],
  ]);
  memory.set(`${cormConfigKey}_prompt`, "be terse");
  const manager = createCormConfigManager(makeOmw(memory));

  expect(manager.load()).toEqual({ model: "qwen", prompt: "be terse" });
});

test("load assembles from flat memory keys without a nested object", () => {
  const memory = new Map([[`${cormConfigKey}_model`, "qwen"]]);
  const manager = createCormConfigManager(makeOmw(memory));

  expect(manager.load()).toEqual({ model: "qwen" });
});

test("load reads flat prompts as raw strings, not JSON", () => {
  const memory = new Map([[cormConfigKey, JSON.stringify({ model: "qwen" })]]);
  memory.set(`${cormConfigKey}_prompt`, '{"a":1}');
  const manager = createCormConfigManager(makeOmw(memory));

  expect(manager.load()).toEqual({ model: "qwen", prompt: '{"a":1}' });
});

test("load falls back to an empty model on an invalid seed", () => {
  const memory = new Map([[cormConfigKey, JSON.stringify({ nope: true })]]);
  const manager = createCormConfigManager(makeOmw(memory));

  expect(manager.load()).toEqual({ model: "" });
});

test("load reads memory once and caches the result", () => {
  const memory = new Map([[cormConfigKey, JSON.stringify({ model: "qwen" })]]);
  const calls = { count: 0 };
  const manager = createCormConfigManager(makeOmw(memory, calls));

  manager.load();
  manager.load();
  manager.load();

  expect(calls.count).toBe(1);
});

test("release is a no-op", () => {
  const memory = new Map([[cormConfigKey, JSON.stringify({ model: "qwen" })]]);
  const manager = createCormConfigManager(makeOmw(memory));

  expect(() =>
    manager.release({ id: "x", kind: "reload", payload: null }),
  ).not.toThrow();
});
