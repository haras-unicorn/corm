import {
  contentText,
  cormTools,
  errorToolResult,
  foldToolCalls,
  mergeToolArguments,
  parseToolArguments,
  toolResultText,
} from "corm/lib/tools";
import { expect, test } from "vitest";
import { baseConfig } from "../common";

const tool = (name: string): ChatTool => ({ name }) as ChatTool;

test("cormTools drops the always-disabled tools", () => {
  const tools = [
    tool("corm__git__git_status"),
    tool("corm__filesystem__read_file"),
  ];

  expect(cormTools(tools, baseConfig()).map((entry) => entry.name)).toEqual([
    "corm__git__git_status",
  ]);
});

test("cormTools restricts to the configured subset", () => {
  const tools = [
    tool("corm__git__git_status"),
    tool("corm__filesystem__list_directory"),
  ];

  expect(
    cormTools(tools, baseConfig({ tools: ["git__git_status"] })).map(
      (entry) => entry.name,
    ),
  ).toEqual(["corm__git__git_status"]);
});

test("cormTools exposes everything when the subset is absent", () => {
  const tools = [
    tool("corm__git__git_status"),
    tool("corm__filesystem__list_directory"),
  ];

  expect(cormTools(tools, baseConfig())).toHaveLength(2);
});

const result = (content: unknown, structuredContent?: unknown): ToolResult => ({
  name: "read_text_file",
  arguments: {},
  content,
  structuredContent,
  isError: false,
});

test("errorToolResult carries the raw message for the window to label", () => {
  const error = errorToolResult("corm__filesystem__echo", {}, "boom");

  expect(error.isError).toBe(true);
  expect(toolResultText(error)).toBe("boom");
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

test("mergeToolArguments concatenates raw string fragments", () => {
  expect(mergeToolArguments('{"a":', "1}")).toBe('{"a":1}');
});

test("mergeToolArguments keeps whichever side is present", () => {
  expect(mergeToolArguments(undefined, "x")).toBe("x");
  expect(mergeToolArguments("x", undefined)).toBe("x");
  expect(mergeToolArguments(undefined, undefined)).toBe("");
});

test("mergeToolArguments restores fragments omw handed over parsed", () => {
  expect(mergeToolArguments('{"limit":', 10)).toBe('{"limit":10');
  expect(mergeToolArguments('{"ok":', true)).toBe('{"ok":true');
  expect(mergeToolArguments('{"a":', { b: 2 })).toBe('{"a":{"b":2}');
});

test("foldToolCalls groups fragments by index", () => {
  const first = foldToolCalls(undefined, [
    { index: 0, id: "1", name: "a", arguments: '{"x":' },
    { index: 1, id: "2", name: "b", arguments: "{}" },
  ]);
  const second = foldToolCalls(first, [{ index: 0, arguments: "1}" }]);

  expect(second).toEqual([
    { id: "1", name: "a", arguments: '{"x":1}' },
    { id: "2", name: "b", arguments: "{}" },
  ]);
});

test("foldToolCalls reconstructs JSON across parsed fragments", () => {
  const first = foldToolCalls(undefined, [
    { index: 0, id: "1", name: "a", arguments: '{"limit":' },
  ]);
  const second = foldToolCalls(first, [{ index: 0, arguments: 10 }]);
  const third = foldToolCalls(second, [{ index: 0, arguments: "}" }]);

  expect(third).toEqual([{ id: "1", name: "a", arguments: '{"limit":10}' }]);
  expect(JSON.parse(String(third[0].arguments))).toEqual({ limit: 10 });
});

test("parseToolArguments returns the value callTool expects", () => {
  expect(parseToolArguments('{"input":"hi"}')).toEqual({ input: "hi" });
  expect(parseToolArguments("")).toEqual({});
  expect(parseToolArguments("   ")).toEqual({});
  expect(parseToolArguments("{not json")).toEqual({});
  expect(parseToolArguments(undefined)).toEqual({});
});

test("foldToolCalls returns the previous calls when there are no fragments", () => {
  const calls = [{ id: "1", name: "a", arguments: "{}" }];

  expect(foldToolCalls(calls, undefined)).toBe(calls);
  expect(foldToolCalls(undefined, undefined)).toEqual([]);
});
