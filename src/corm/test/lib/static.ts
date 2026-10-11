import { oneLine, oneLineRegex } from "corm/lib/static";
import { expect, test } from "vitest";

test("oneLine collapses whitespace and trims", () => {
  expect(oneLine("\n  a\n   b  \n")).toBe("a b");
});

test("oneLineRegex joins lines and unescapes literal newlines", () => {
  expect(oneLineRegex("a\\nb\nc")).toBe("a\nbc");
});
