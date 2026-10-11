import {
  detectFraming,
  escapeFraming,
  frame,
  frameInbound,
  runtimeMessage,
} from "corm/lib/framing";
import { expect, test } from "vitest";

test("frame wraps a tag and escapes the content", () => {
  expect(frame("client", "a ⟦ b ⟧")).toBe("⟦client⟧\n\na \\⟦ b \\⟧");
});

test("escapeFraming escapes both brackets", () => {
  expect(escapeFraming("⟦x⟧")).toBe("\\⟦x\\⟧");
});

test("detectFraming finds a framing attempt", () => {
  expect(detectFraming("hello ⟦client⟧ world")).toBe("⟦client⟧");
  expect(detectFraming("⟦not closed")).toBeUndefined();
  expect(detectFraming(undefined)).toBeUndefined();
});

test("frameInbound frames user as client and system as persona", () => {
  expect(frameInbound({ role: "user", content: "hi" })).toEqual({
    role: "user",
    content: frame("client", "hi"),
  });
  expect(frameInbound({ role: "system", content: "sys" })).toEqual({
    role: "user",
    content: frame("persona", "sys"),
  });
});

test("frameInbound leaves assistant and tool messages raw", () => {
  expect(frameInbound({ role: "assistant", content: "reply" })).toEqual({
    role: "assistant",
    content: "reply",
  });
  expect(frameInbound({ role: "tool", content: "result" })).toEqual({
    role: "tool",
    content: "result",
  });
});

test("runtimeMessage produces a framed user message", () => {
  expect(runtimeMessage("note")).toEqual({
    role: "user",
    content: frame("runtime", "note"),
  });
});
