import {
  cormConfigZod,
  cormStateZod,
  cormSubscriptionsZod,
  cormTaskSpecZod,
  cormWindowZod,
} from "corm/lib/opaque";
import { expect, test } from "vitest";

test("state defaults to empty queues", () => {
  expect(cormStateZod.parse({})).toEqual({ pending: [], immediate: [] });
});

test("state keeps an opaque window", () => {
  expect(cormStateZod.parse({ window: { a: 1 } })).toEqual({
    pending: [],
    immediate: [],
    window: { a: 1 },
  });
});

test("window state parses with defaults", () => {
  expect(cormWindowZod.parse({})).toEqual({
    messages: [],
    sources: {},
    digests: {},
    receipts: [],
    epoch: 0,
  });
});

test("config requires a model and a context length", () => {
  expect(cormConfigZod.parse({ model: "qwen", contextLength: 32768 })).toEqual({
    model: "qwen",
    contextLength: 32768,
  });
  expect(() => cormConfigZod.parse({})).toThrow();
  expect(() => cormConfigZod.parse({ model: "qwen" })).toThrow();
  expect(() => cormConfigZod.parse({ contextLength: 32768 })).toThrow();
});

test("config accepts an optional tools subset", () => {
  expect(
    cormConfigZod.parse({
      model: "qwen",
      contextLength: 32768,
      tools: ["read_file"],
    }),
  ).toEqual({
    model: "qwen",
    contextLength: 32768,
    tools: ["read_file"],
  });
});

test("subscriptions require lifecycle, endpoint and model", () => {
  expect(
    cormSubscriptionsZod.parse({
      lifecycle: "l",
      endpoint: "e",
      model: "corm",
    }),
  ).toEqual({ lifecycle: "l", endpoint: "e", model: "corm" });
  expect(() => cormSubscriptionsZod.parse({ lifecycle: "l" })).toThrow();
});

test("task spec accepts optional key and atomic", () => {
  expect(
    cormTaskSpecZod.parse({ placement: "pending", state: { a: 1 } }),
  ).toEqual({ placement: "pending", state: { a: 1 } });
  expect(() =>
    cormTaskSpecZod.parse({ placement: "nope", state: {} }),
  ).toThrow();
});
