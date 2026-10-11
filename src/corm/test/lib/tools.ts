import {
  contentText,
  cormTools,
  mergeToolArguments,
  mergeToolCalls,
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

test("mergeToolArguments extends overlapping cumulative fragments", () => {
  expect(mergeToolArguments('{"a":', '{"a":1}')).toBe('{"a":1}');
  expect(mergeToolArguments('{"a":', "1}")).toBe('{"a":1}');
});

test("mergeToolArguments replaces non-string arguments", () => {
  expect(mergeToolArguments({ a: 1 }, { b: 2 })).toEqual({ b: 2 });
});

test("mergeToolCalls merges arguments of the same call", () => {
  const merged = mergeToolCalls(
    { id: "1", name: "t", arguments: '{"a":' },
    { id: "1", name: "t", arguments: '{"a":1}' },
  );

  expect(merged).toEqual({ id: "1", name: "t", arguments: '{"a":1}' });
});

test("mergeToolCalls throws when mixing different calls", () => {
  expect(() =>
    mergeToolCalls(
      { id: "1", name: "t", arguments: "{}" },
      { id: "2", name: "u", arguments: "{}" },
    ),
  ).toThrow();
});

test("mergeToolCalls falls back to whichever side is present", () => {
  const call = { id: "1", name: "t", arguments: "{}" };

  expect(mergeToolCalls(undefined, call)).toEqual(call);
  expect(mergeToolCalls(call, undefined)).toEqual(call);
  expect(mergeToolCalls(undefined, undefined)).toBeUndefined();
});
