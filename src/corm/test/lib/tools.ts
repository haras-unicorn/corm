import { contentText, toolResultText } from "corm/lib/tools";
import { expect, test } from "vitest";

const result = (content: unknown, structuredContent?: unknown): ToolResult => ({
  name: "read_text_file",
  arguments: {},
  content,
  structuredContent,
});

test("contentText prefers structured content", () => {
  expect(contentText(result("raw", { content: "structured" }))).toBe(
    "structured",
  );
});

test("contentText reads plain string content", () => {
  expect(contentText(result("hello"))).toBe("hello");
});

test("contentText reads the first text block", () => {
  expect(
    contentText(
      result([
        { type: "image", data: "..." },
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ]),
    ),
  ).toBe("first");
});

test("contentText returns undefined when there is no text", () => {
  expect(contentText(result([{ type: "image", data: "..." }]))).toBe(undefined);
  expect(contentText(result(undefined))).toBe(undefined);
});

test("toolResultText returns an empty string without a result", () => {
  expect(toolResultText(undefined)).toBe("");
});

test("toolResultText joins every text block", () => {
  expect(
    toolResultText(
      result([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ]),
    ),
  ).toBe("a\nb");
});

test("toolResultText prefers structured content", () => {
  expect(toolResultText(result("raw", { content: "structured" }))).toBe(
    "structured",
  );
});

test("toolResultText falls back to JSON", () => {
  expect(toolResultText(result({ answer: 42 }))).toBe('{"answer":42}');
});
