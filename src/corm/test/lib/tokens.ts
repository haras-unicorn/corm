import {
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTextTokens,
  toolCallKey,
} from "corm/lib/tokens";
import { expect, test } from "vitest";

test("estimateTextTokens rounds up and treats empty text as zero", () => {
  expect(estimateTextTokens(undefined)).toBe(0);
  expect(estimateTextTokens("")).toBe(0);
  expect(estimateTextTokens("abcd")).toBe(1);
  expect(estimateTextTokens("abcde")).toBe(2);
});

test("estimateMessageTokens counts content, reasoning and the tool call", () => {
  expect(estimateMessageTokens({ content: "abcd" })).toBe(5);
  expect(estimateMessageTokens({ content: "abcd", reasoning: "abcd" })).toBe(6);
  expect(
    estimateMessageTokens({
      toolCall: { id: "1", name: "t", arguments: { a: 1 } },
    }),
  ).toBe(4 + estimateTextTokens('{"id":"1","name":"t","arguments":{"a":1}}'));
});

test("estimateMessagesTokens sums the messages", () => {
  expect(
    estimateMessagesTokens([{ content: "abcd" }, { content: "abcd" }]),
  ).toBe(10);
});

test("toolCallKey canonicalizes argument key order", () => {
  expect(toolCallKey("t", { a: 1, b: 2 })).toBe(
    toolCallKey("t", { b: 2, a: 1 }),
  );
});

test("toolCallKey canonicalizes a JSON string argument", () => {
  expect(toolCallKey("t", '{"a":1,"b":2}')).toBe(
    toolCallKey("t", { b: 2, a: 1 }),
  );
});

test("toolCallKey keeps a non-JSON string verbatim", () => {
  expect(toolCallKey("t", "not json")).toContain("not json");
  expect(toolCallKey("t", "not json")).not.toBe(toolCallKey("t", "other text"));
});

test("toolCallKey distinguishes names and value types", () => {
  expect(toolCallKey("a", { x: 1 })).not.toBe(toolCallKey("b", { x: 1 }));
  expect(toolCallKey("t", { x: 1 })).not.toBe(toolCallKey("t", { x: "1" }));
});
