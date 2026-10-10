import {
  cormConfigZod,
  cormStateZod,
  cormSubscriptionsZod,
  cormTaskSpecZod,
} from "corm/lib/opaque";
import { expect, test } from "vitest";

test("state defaults to empty queues", () => {
  expect(cormStateZod.parse({})).toEqual({ pending: [], immediate: [] });
});

test("config requires a model", () => {
  expect(cormConfigZod.parse({ model: "qwen" })).toEqual({ model: "qwen" });
  expect(() => cormConfigZod.parse({})).toThrow();
});

test("config accepts an optional tools subset", () => {
  expect(cormConfigZod.parse({ model: "qwen", tools: ["read_file"] })).toEqual({
    model: "qwen",
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
