import {
  estimateCharTokens,
  estimateMessagesTokens,
  estimateMessageTokens,
  estimateTextTokens,
  estimateTokenChars,
  messageDigest,
  messageFingerprint,
  toolCallKey,
  truncateContent,
} from "corm/lib/tokens";
import { expect, test } from "vitest";

const RATE = 4;
const OVERHEAD = 4;

test("estimateTextTokens rounds up and treats empty text as zero", () => {
  expect(estimateTextTokens(undefined, RATE)).toBe(0);
  expect(estimateTextTokens("", RATE)).toBe(0);
  expect(estimateTextTokens("abcd", RATE)).toBe(1);
  expect(estimateTextTokens("abcde", RATE)).toBe(2);
});

test("estimateMessageTokens counts content, reasoning and the tool calls", () => {
  expect(estimateMessageTokens({ content: "abcd" }, RATE, OVERHEAD)).toBe(5);
  expect(
    estimateMessageTokens(
      { content: "abcd", reasoning: "abcd" },
      RATE,
      OVERHEAD,
    ),
  ).toBe(6);
  expect(
    estimateMessageTokens(
      { toolCalls: [{ id: "1", name: "t", arguments: { a: 1 } }] },
      RATE,
      OVERHEAD,
    ),
  ).toBe(
    OVERHEAD +
      estimateTextTokens('[{"id":"1","name":"t","arguments":{"a":1}}]', RATE),
  );
});

test("estimateMessagesTokens sums the messages", () => {
  expect(
    estimateMessagesTokens(
      [{ content: "abcd" }, { content: "abcd" }],
      RATE,
      OVERHEAD,
    ),
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

test("estimateCharTokens and estimateTokenChars are inverse at a rate", () => {
  expect(estimateCharTokens(9, 4)).toBe(3);
  expect(estimateCharTokens(10, 4)).toBe(3);
  expect(estimateTokenChars(3, 4)).toBe(12);
});

test("messageDigest is stable and content-sensitive", () => {
  const base = { role: "user", content: "hi" } as const;

  expect(messageDigest(base)).toBe(messageDigest({ ...base }));
  expect(messageDigest(base)).not.toBe(
    messageDigest({ ...base, content: "yo" }),
  );
  expect(messageDigest(base)).toBe(
    messageDigest({ ...base, reasoning: "why" }),
  );
  expect(messageDigest(base)).not.toBe(
    messageDigest({ role: "assistant", content: "hi" }),
  );
});

test("messageFingerprint serializes the message", () => {
  expect(messageFingerprint({ role: "user", content: "hi" })).toBe(
    '{"role":"user","content":"hi"}',
  );
});

test("truncateContent leaves short content untouched", () => {
  expect(truncateContent("hi", 10, "<truncated>", 4)).toBe("hi");
});

test("truncateContent keeps the head and tail around the marker", () => {
  const content = "0123456789";

  const truncated = truncateContent(content, 2, "<t>", 2);

  expect(truncated).toContain("<t>");
  expect(truncated.length).toBeLessThan(content.length);
  expect(truncated.startsWith("0")).toBe(true);
});
