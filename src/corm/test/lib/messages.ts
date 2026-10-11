import {
  assistantMessage,
  clientDelta,
  foldAssistant,
  recomputeMessage,
  systemMessage,
  toolMessage,
  userMessage,
} from "corm/lib/messages";
import { expect, test } from "vitest";
import { baseConfig } from "../common";

const config = baseConfig();

test("systemMessage carries its role, digest, chars and tokens", () => {
  const message = systemMessage("hello", config);

  expect(message.role).toBe("system");
  expect(message.content).toBe("hello");
  expect(message.digest).not.toBe("");
  expect(message.chars).toBe(5);
  expect(message.tokens).toBeGreaterThan(0);
});

test("userMessage frames the content under its tag", () => {
  const message = userMessage("client", "hi", config);

  expect(message.role).toBe("user");
  expect(message.tag).toBe("client");
  expect(message.content).toContain("⟦client⟧");
});

test("assistantMessage starts with no deltas", () => {
  const message = assistantMessage("answer", "why", undefined, config);

  expect(message.role).toBe("assistant");
  expect(message.content).toBe("answer");
  expect(message.reasoning).toBe("why");
  expect(message.deltas).toEqual([]);
});

test("toolMessage carries its role", () => {
  expect(toolMessage("result", config).role).toBe("tool");
});

test("foldAssistant accumulates content and merges the tool call", () => {
  const first = foldAssistant(
    undefined,
    { content: "he", toolCall: { id: "1", name: "t", arguments: '{"a":' } },
    config,
  );
  const second = foldAssistant(
    first,
    { content: "llo", toolCall: { id: "1", name: "t", arguments: '{"a":1}' } },
    config,
  );

  expect(second.content).toBe("hello");
  expect(second.toolCall?.arguments).toBe('{"a":1}');
  expect(second.deltas).toHaveLength(2);
});

test("foldAssistant drops empty reasoning", () => {
  const message = foldAssistant(undefined, { content: "x" }, config);

  expect(message.reasoning).toBeUndefined();
});

test("recomputeMessage rebuilds the derived fields", () => {
  const fresh = userMessage("client", "hi", config);
  const stale = { ...fresh, digest: "stale", chars: 0, tokens: 0 };

  const recomputed = recomputeMessage(stale, config);

  expect(recomputed.digest).toBe(fresh.digest);
  expect(recomputed.chars).toBe(fresh.chars);
  expect(recomputed.tokens).toBe(fresh.tokens);
});

test("clientDelta keeps only the visible fields", () => {
  const toolCall = { id: "1", name: "t", arguments: "{}" };

  expect(
    clientDelta({ content: "a", reasoning: "b", toolCall, usage: {} }),
  ).toEqual({ content: "a", reasoning: "b", toolCall, usage: {} });
  expect(clientDelta({})).toEqual({});
});
