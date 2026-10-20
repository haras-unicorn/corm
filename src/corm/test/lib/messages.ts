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

test("assistantMessage starts with no deltas and no tool calls", () => {
  const message = assistantMessage("answer", "why", [], config);

  expect(message.role).toBe("assistant");
  expect(message.content).toBe("answer");
  expect(message.reasoning).toBe("why");
  expect(message.toolCalls).toEqual([]);
  expect(message.deltas).toEqual([]);
});

test("toolMessage carries its role and tool call id", () => {
  const message = toolMessage("result", "call-1", config);

  expect(message.role).toBe("tool");
  expect(message.toolCallId).toBe("call-1");
});

test("foldAssistant accumulates content and merges tool-call fragments", () => {
  const first = foldAssistant(
    undefined,
    {
      content: "he",
      toolCalls: [{ index: 0, id: "1", name: "t", arguments: '{"a":' }],
    },
    config,
  );
  const second = foldAssistant(
    first,
    { content: "llo", toolCalls: [{ index: 0, arguments: "1}" }] },
    config,
  );

  expect(second.content).toBe("hello");
  expect(second.toolCalls[0]?.name).toBe("t");
  expect(second.toolCalls[0]?.arguments).toBe('{"a":1}');
  expect(second.deltas).toHaveLength(2);
});

test("foldAssistant keeps parallel tool calls grouped by index", () => {
  const message = foldAssistant(
    undefined,
    {
      toolCalls: [
        { index: 0, id: "a", name: "x", arguments: "{}" },
        { index: 1, id: "b", name: "y", arguments: "{}" },
      ],
    },
    config,
  );

  expect(message.toolCalls.map((call) => call.name)).toEqual(["x", "y"]);
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

test("clientDelta keeps the visible fields and drops tool calls", () => {
  const toolCalls = [{ index: 0, id: "1", name: "t", arguments: "{}" }];

  expect(
    clientDelta({ content: "a", reasoning: "b", toolCalls, usage: {} }),
  ).toEqual({ content: "a", reasoning: "b", usage: {} });
  expect(clientDelta({})).toEqual({});
});
