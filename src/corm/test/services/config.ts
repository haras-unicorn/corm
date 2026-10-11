import { cormConfigKey } from "corm/lib/keys";
import { createCormConfigManager } from "corm/services/config";
import { createCormLogger } from "corm/services/logger";
import { expect, test } from "vitest";
import { makeHost, makeOmw } from "../common";

const makeManager = (entries: [string, string][]) => {
  const fake = makeHost();
  for (const [key, value] of entries) {
    fake.memory.set(key, value);
  }
  const omw = makeOmw({ host: fake.host });
  return createCormConfigManager(createCormLogger(fake.host), omw);
};

test("load returns the validated nested seed", () => {
  const manager = makeManager([
    [cormConfigKey, JSON.stringify({ model: "qwen", contextLength: 131072 })],
  ]);

  expect(manager.load()).toEqual({ model: "qwen", contextLength: 131072 });
});

test("load overlays flat memory keys onto the nested config", () => {
  const manager = makeManager([
    [
      cormConfigKey,
      JSON.stringify({ model: "qwen", contextLength: 131072, prompt: "base" }),
    ],
    [`${cormConfigKey}_prompt`, "be terse"],
  ]);

  expect(manager.load()).toEqual({
    model: "qwen",
    contextLength: 131072,
    prompt: "be terse",
  });
});

test("load assembles from flat memory keys without a nested object", () => {
  const manager = makeManager([
    [`${cormConfigKey}_model`, '"qwen"'],
    [`${cormConfigKey}_contextLength`, "131072"],
  ]);

  expect(manager.load()).toEqual({ model: "qwen", contextLength: 131072 });
});

test("load coerces flat overlay values by JSON, falling back to the raw string", () => {
  const manager = makeManager([
    [cormConfigKey, JSON.stringify({ model: "qwen", contextLength: 131072 })],
    [`${cormConfigKey}_replayRatio`, "0.1"],
    [`${cormConfigKey}_prompt`, "be terse"],
  ]);

  expect(manager.load()).toEqual({
    model: "qwen",
    contextLength: 131072,
    replayRatio: 0.1,
    prompt: "be terse",
  });
});

test("load throws on an invalid seed", () => {
  const manager = makeManager([
    [cormConfigKey, JSON.stringify({ nope: true })],
  ]);

  expect(() => manager.load()).toThrow();
});

test("load throws when contextLength violates the protect bound", () => {
  const manager = makeManager([
    [cormConfigKey, JSON.stringify({ model: "qwen", contextLength: 1024 })],
  ]);

  expect(() => manager.load()).toThrow();
});

test("load reads memory once and caches the result", () => {
  const fake = makeHost();
  fake.memory.set(
    cormConfigKey,
    JSON.stringify({ model: "qwen", contextLength: 131072 }),
  );
  let reads = 0;
  const host = makeHost({
    memoryGetAs: () => {
      reads += 1;
      return { model: "qwen", contextLength: 131072 };
    },
    memoryGet: () => undefined,
  }).host;
  const manager = createCormConfigManager(
    createCormLogger(fake.host),
    makeOmw({ host }),
  );

  manager.load();
  manager.load();
  manager.load();

  expect(reads).toBe(1);
});
