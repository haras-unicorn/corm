import CormChatHandler from "corm/handlers/chat";
import {
  CORM_DEFAULT_CIRCUIT_BREAKER_HINT,
  CORM_DEFAULT_COMPACT_NOTICE,
  CORM_DEFAULT_COMPACT_PRELUDE,
  CORM_DEFAULT_COMPACT_PROMPT,
  CORM_DEFAULT_PROMPT_PRELUDE,
  CORM_DEFAULT_RECAP_END_NOTICE,
  CORM_DEFAULT_TOOL_CALL_HINT,
} from "corm/lib/defaults";
import { frame } from "corm/lib/framing";
import type { CormConfig, CormSubscriptions } from "corm/lib/opaque";
import { combinedRuntimePrompts } from "corm/lib/registry";
import type { CormContext } from "corm/services/context";
import { expect, test } from "vitest";
import {
  chatDelta,
  chatEnd,
  endpointMessage,
  makeContext,
  makeHandles,
  makeHost,
  makeNamedToolings,
  makeProvider,
  makeToolingHandle,
  timerEvent,
} from "../common";

const runtimePrompt = (prompt?: string): ChatMessage => {
  let content = combinedRuntimePrompts({} as CormConfig).join("\n\n");
  if (prompt !== undefined && prompt !== "") {
    content += `\n\n\n${CORM_DEFAULT_PROMPT_PRELUDE}\n\n${prompt}`;
  }
  return { role: "system", content };
};

const runtime = (content: string): ChatMessage => ({
  role: "user",
  content: frame("runtime", content),
});

const summary = (text: string): ChatMessage =>
  runtime(`\n\n\n${CORM_DEFAULT_COMPACT_PRELUDE}\n\n${text}`);

const client = (content: string): ChatMessage => ({
  role: "user",
  content: frame("client", content),
});

const taskNotice = (context: CormContext, id: string): ChatMessage => {
  const key = context.window.sessionKey([{ role: "user", content: "hi" }]);
  return runtime(`You are starting task chat (${id}) session ${key}.`);
};

function makeSetup(
  providers: ProviderHandle[],
  toolings: ToolingHandle[],
  config: CormConfig = { model: "model", contextLength: 131072 },
) {
  const fake = makeHost();
  const subscriptions: CormSubscriptions = {
    lifecycle: "lifecycle-sub",
    endpoint: "endpoint-sub",
    model: "corm",
  };
  const handles = makeHandles({
    host: fake.host,
    providers,
    toolings: makeNamedToolings(toolings),
    subscriptions,
  });
  const context = makeContext(handles, config);

  return { context, subscriptions, streamed: fake.streamed };
}

function toolResultEvent(id: string): OmwEvent {
  return {
    id,
    kind: "tool-result",
    payload: {
      name: "echo",
      arguments: { in: "hi" },
      content: [{ type: "text", text: "hi" }],
    },
  };
}

test("chat streams content and completes on chat-end", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions, streamed } = makeSetup([provider], []);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  expect(CormChatHandler.should(start)?.key).toBe("s1");
  expect(handler.handle(start)).toBe("running");

  const gen = subscriptions.generation;
  expect(gen).toBeDefined();
  expect(handler.handle(chatDelta(gen as string, { content: "hello" }))).toBe(
    "running",
  );
  expect(streamed).toContainEqual({
    session: "s1",
    delta: { content: "hello" },
  });

  expect(handler.handle(chatEnd(gen as string))).toBe("complete");
  expect(streamed).toContainEqual({
    session: "s1",
    delta: { finishReason: "stop" },
  });
});

test("chat stores the reply so a later turn sees the prior assistant message", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions } = makeSetup([provider], []);
  const start = endpointMessage("s1", [{ role: "user", content: "first" }]);
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  handler.handle(
    chatDelta(subscriptions.generation as string, { content: "one" }),
  );
  expect(handler.handle(chatEnd(subscriptions.generation as string))).toBe(
    "complete",
  );

  // The client re-offers only user messages; the assistant turn is not echoed.
  const next = endpointMessage("s1", [
    { role: "user", content: "first" },
    { role: "user", content: "second" },
  ]);
  handler.handle(next);

  expect(provider.calls[1].messages).toContainEqual({
    role: "assistant",
    content: "one",
  });
  expect(provider.calls[1].messages).toContainEqual(client("second"));
});

test("chat stores the reply in the shared window so another session sees it", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions } = makeSetup([provider], []);
  const startA = endpointMessage("a", [{ role: "user", content: "do X" }]);
  const handlerA = new CormChatHandler(context, "1", startA);

  handlerA.handle(startA);
  handlerA.handle(
    chatDelta(subscriptions.generation as string, { content: "did X" }),
  );
  expect(handlerA.handle(chatEnd(subscriptions.generation as string))).toBe(
    "complete",
  );

  const startB = endpointMessage("b", [{ role: "user", content: "do Y" }]);
  const handlerB = new CormChatHandler(context, "2", startB);
  handlerB.handle(startB);

  expect(provider.calls[1].messages).toContainEqual(client("do X"));
  expect(provider.calls[1].messages).toContainEqual({
    role: "assistant",
    content: "did X",
  });
  expect(provider.calls[1].messages).toContainEqual(client("do Y"));
});

test("chat does not duplicate an assistant reply the client echoes back", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions } = makeSetup([provider], []);
  const start = endpointMessage("s1", [{ role: "user", content: "first" }]);
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  handler.handle(
    chatDelta(subscriptions.generation as string, { content: "one" }),
  );
  expect(handler.handle(chatEnd(subscriptions.generation as string))).toBe(
    "complete",
  );

  const next = endpointMessage("s1", [
    { role: "user", content: "first" },
    { role: "assistant", content: "one" },
    { role: "user", content: "second" },
  ]);
  handler.handle(next);

  const replies = provider.calls[1].messages.filter(
    (message) => message.role === "assistant" && message.content === "one",
  );
  expect(replies).toHaveLength(1);
});

test("chat executes corm-owned tools and re-prompts", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions, streamed } = makeSetup([provider], [tooling]);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen1, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: '{"in":"hi"}',
      },
    }),
  );
  expect(handler.handle(chatEnd(gen1))).toBe("running");
  expect(tooling.invoked.map((call) => call.tool)).toEqual(["echo"]);

  const pending = context.tooling.pending();
  expect(pending).toHaveLength(1);

  expect(handler.handle(toolResultEvent(pending[0].uuid))).toBe("running");
  expect(handler.handle(timerEvent())).toBe("running");
  expect(provider.calls.length).toBe(2);

  const gen2 = subscriptions.generation as string;
  handler.handle(chatDelta(gen2, { content: "done" }));
  expect(handler.handle(chatEnd(gen2))).toBe("complete");
  expect(streamed.some((event) => event.delta.content === "done")).toBe(true);
});

test("chat replaces cumulative tool-call argument deltas", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup([provider], [tooling]);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen = subscriptions.generation as string;

  // omw re-sends the whole reassembled arguments on every delta, so a naive
  // concatenation would duplicate them.
  handler.handle(
    chatDelta(gen, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: '{"in"',
      },
    }),
  );
  handler.handle(
    chatDelta(gen, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: '{"in":"hi"}',
      },
    }),
  );
  expect(handler.handle(chatEnd(gen))).toBe("running");

  expect(tooling.invoked).toEqual([{ tool: "echo", args: '{"in":"hi"}' }]);
});

test("chat concatenates non-overlapping tool-call argument fragments", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup([provider], [tooling]);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen = subscriptions.generation as string;

  handler.handle(
    chatDelta(gen, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: '{"in":',
      },
    }),
  );
  handler.handle(
    chatDelta(gen, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: '"hi"}',
      },
    }),
  );
  expect(handler.handle(chatEnd(gen))).toBe("running");

  expect(tooling.invoked).toEqual([{ tool: "echo", args: '{"in":"hi"}' }]);
});

test("chat forwards unknown client tool calls without executing them", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions, streamed } = makeSetup([provider], [tooling]);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen, {
      toolCall: { id: "client-1", name: "client__thing", arguments: "{}" },
    }),
  );
  expect(handler.handle(chatEnd(gen))).toBe("complete");
  expect(tooling.invoked).toEqual([]);
  expect(streamed.some((event) => event.delta.toolCall !== undefined)).toBe(
    true,
  );
});

test("chat falls back to the next provider on error", () => {
  const first = makeProvider("gpu");
  const second = makeProvider("cpu");
  const { context, subscriptions } = makeSetup([first, second], []);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen = subscriptions.generation as string;
  expect(handler.handle({ id: gen, kind: "error", payload: "boom" })).toBe(
    "running",
  );
  expect(handler.handle(timerEvent())).toBe("running");
  expect(second.calls.length).toBe(1);
  expect(subscriptions.generation).toBe("cpu-gen-1");
});

test("chat restarts on a same-session message and drops the interrupted partial", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions } = makeSetup([provider], []);
  const start = endpointMessage("s1");
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen = subscriptions.generation as string;
  handler.handle(chatDelta(gen, { reasoning: "thinking" }));
  handler.handle(chatDelta(gen, { content: "partial" }));

  expect(handler.handle(endpointMessage("s1"))).toBe("running");

  expect(provider.cancelled).toEqual([gen]);
  expect(provider.calls).toHaveLength(2);
  expect(provider.calls[1].messages).toEqual([
    runtimePrompt(),
    taskNotice(context, "1"),
    client("hi"),
  ]);
});

test("chat injects the configured prompt on every provider call", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup([provider], [tooling], {
    model: "model",
    contextLength: 131072,
    prompt: "be terse",
  });
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  expect(provider.calls[0].messages[0]).toEqual(runtimePrompt("be terse"));
  expect(provider.calls[0].messages[1]).toEqual(taskNotice(context, "1"));
  expect(provider.calls[0].messages[2]).toEqual(client("hi"));
  expect(provider.calls[0].messages).toHaveLength(3);

  const gen = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: "{}",
      },
    }),
  );
  expect(handler.handle(chatEnd(gen))).toBe("running");

  const pending = context.tooling.pending();
  handler.handle(toolResultEvent(pending[0].uuid));
  handler.handle(timerEvent());

  expect(provider.calls).toHaveLength(2);
  expect(provider.calls[1].messages[0]).toEqual(runtimePrompt("be terse"));
});

test("chat leaves the message list unmodified without a prompt", () => {
  const provider = makeProvider("gpu");
  const { context } = makeSetup([provider], []);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);

  expect(provider.calls[0].messages).toEqual([
    runtimePrompt(),
    taskNotice(context, "1"),
    client("hi"),
  ]);
});

test("chat falls back to the first provider model when the config model is empty", () => {
  const provider = makeProvider("gpu", ["mock-model"]);
  const { context } = makeSetup([provider], [], {
    model: "",
    contextLength: 131072,
  });
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);

  expect(provider.calls[0].model).toBe("mock-model");
});

const compactionConfig: CormConfig = {
  model: "model",
  contextLength: 100,
  protectRatio: 0.125,
  compactThreshold: 0.35,
  hardThreshold: 0.95,
  messageTokenLimit: 12,
  compactSummaryLimit: 12,
};

const fill = (context: CormContext, count: number): void => {
  for (let index = 0; index < count; index++) {
    context.window.append({ role: "user", content: "x" });
  }
};

test("compacts right after ingest when over soft", () => {
  const provider = makeProvider("gpu");
  const { context } = makeSetup([provider], [], compactionConfig);
  fill(context, 4);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  expect(handler.handle(start)).toBe("running");

  expect(provider.calls.at(-1)?.messages.at(-1)).toEqual(
    runtime(CORM_DEFAULT_COMPACT_PROMPT),
  );
  expect(provider.calls.at(-1)?.params).toEqual({});
  expect(handler.accepts(endpointMessage("s1"))).toBe(false);
});

test("compacts after a tool settle when over soft", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions, streamed } = makeSetup(
    [provider],
    [tooling],
    compactionConfig,
  );
  fill(context, 2);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen1, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: "{}",
      },
    }),
  );
  handler.handle(chatEnd(gen1));

  const pending = context.tooling.pending();
  expect(handler.handle(toolResultEvent(pending[0].uuid))).toBe("running");

  const compactCall = provider.calls.at(-1);
  expect(compactCall?.messages.at(-1)).toEqual(
    runtime(CORM_DEFAULT_COMPACT_PROMPT),
  );
  expect(compactCall?.tools).toEqual([]);

  const gen2 = subscriptions.generation as string;
  handler.handle(chatDelta(gen2, { content: "summary" }));
  expect(streamed.some((event) => event.delta.content === "summary")).toBe(
    false,
  );
  expect(handler.handle(chatEnd(gen2))).toBe("running");

  handler.handle(timerEvent());
  expect(provider.calls.at(-1)?.messages[1]).toEqual(summary("summary"));
});

test("compacts at turn end when the anchor crosses the soft threshold", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions, streamed } = makeSetup(
    [provider],
    [],
    compactionConfig,
  );
  fill(context, 2);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(chatDelta(gen1, { usage: { promptTokens: 90 } }));

  expect(handler.handle(chatEnd(gen1))).toBe("running");

  expect(streamed.some((event) => event.delta.finishReason === "stop")).toBe(
    true,
  );
  expect(provider.calls.at(-1)?.messages.at(-1)).toEqual(
    runtime(CORM_DEFAULT_COMPACT_PROMPT),
  );
  expect(handler.accepts(endpointMessage("s1"))).toBe(false);
});

test("retries compaction on error without falling back", () => {
  const first = makeProvider("gpu");
  const second = makeProvider("cpu");
  const { context, subscriptions, streamed } = makeSetup(
    [first, second],
    [],
    compactionConfig,
  );
  fill(context, 2);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(chatDelta(gen1, { usage: { promptTokens: 90 } }));
  handler.handle(chatEnd(gen1));

  const compactGen = subscriptions.generation as string;
  const callsBefore = first.calls.length + second.calls.length;

  expect(
    handler.handle({ id: compactGen, kind: "error", payload: "boom" }),
  ).toBe("running");

  expect(second.calls).toHaveLength(0);
  expect(first.calls.length + second.calls.length).toBe(callsBefore);
  expect(subscriptions.generation).toBeUndefined();

  expect(handler.handle(timerEvent())).toBe("running");
  expect(first.calls.length + second.calls.length).toBe(callsBefore + 1);

  const retryGen = subscriptions.generation as string;
  handler.handle(chatDelta(retryGen, { content: "summary" }));
  expect(streamed.some((event) => event.delta.content === "summary")).toBe(
    false,
  );
  expect(handler.handle(chatEnd(retryGen))).toBe("complete");
});

test("compacts with the configured params instead of the turn params", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions } = makeSetup([provider], [], {
    ...compactionConfig,
    compactParams: { temperature: 0.25 },
  });
  fill(context, 2);
  const start: OmwEvent & { kind: "endpoint-message" } = {
    id: "event-s1",
    kind: "endpoint-message",
    payload: {
      session: "s1",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      params: { temperature: 1.2 },
    },
  };
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(chatDelta(gen1, { usage: { promptTokens: 90 } }));
  handler.handle(chatEnd(gen1));

  expect(provider.calls[0].params).toEqual({ temperature: 1.2 });
  expect(provider.calls[1].params).toEqual({ temperature: 0.25 });
});

const hardConfig: CormConfig = {
  model: "model",
  contextLength: 100,
  protectRatio: 0.125,
  compactThreshold: 0.5,
  hardThreshold: 0.65,
  messageTokenLimit: 12,
  compactSummaryLimit: 12,
};

test("cancels and compacts when a streamed turn crosses the hard limit", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions, streamed } = makeSetup(
    [provider],
    [],
    hardConfig,
  );
  fill(context, 4);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;

  expect(handler.handle(chatDelta(gen1, { content: "x".repeat(300) }))).toBe(
    "running",
  );

  expect(provider.cancelled).toEqual([gen1]);

  expect(streamed).toContainEqual({
    session: "s1",
    delta: { content: CORM_DEFAULT_COMPACT_NOTICE },
  });

  const compactCall = provider.calls.at(-1);
  expect(compactCall?.messages.at(-1)).toEqual(
    runtime(CORM_DEFAULT_COMPACT_PROMPT),
  );
  expect(compactCall?.tools).toEqual([]);

  const gen2 = subscriptions.generation as string;
  handler.handle(chatDelta(gen2, { content: "summary" }));
  expect(streamed.some((event) => event.delta.content === "summary")).toBe(
    false,
  );
  expect(handler.handle(chatEnd(gen2))).toBe("running");

  handler.handle(timerEvent());

  const resumed = provider.calls.at(-1);
  expect(resumed?.messages[1]).toEqual(summary("summary"));
  expect(resumed?.messages).toContainEqual(client("hi"));
  expect(
    resumed?.messages.some(
      (message) => message.content === CORM_DEFAULT_COMPACT_NOTICE,
    ),
  ).toBe(false);
});

const textToolConfig: CormConfig = {
  model: "model",
  contextLength: 131072,
  toolCallPattern: "<tool_call>.*?</tool_call>",
  toolCallRetryLimit: 2,
};

test("detects a tool call emitted as text, hints and retries without executing", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions, streamed } = makeSetup(
    [provider],
    [tooling],
    textToolConfig,
  );
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen1, {
      content: 'ok <tool_call>{"name":"echo"}</tool_call> done',
    }),
  );

  expect(handler.handle(chatEnd(gen1))).toBe("running");
  expect(tooling.invoked).toEqual([]);
  expect(streamed.some((event) => event.delta.finishReason !== undefined)).toBe(
    false,
  );

  expect(handler.handle(timerEvent())).toBe("running");
  expect(provider.calls).toHaveLength(2);
  expect(provider.calls.at(-1)?.messages).toContainEqual(
    runtime(CORM_DEFAULT_TOOL_CALL_HINT),
  );
});

test("detects a tool call emitted only in reasoning", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup(
    [provider],
    [tooling],
    textToolConfig,
  );
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen1, {
      reasoning: 'see <tool_call>{"name":"echo"}</tool_call>',
    }),
  );

  expect(handler.handle(chatEnd(gen1))).toBe("running");
  expect(tooling.invoked).toEqual([]);

  expect(handler.handle(timerEvent())).toBe("running");
  expect(provider.calls).toHaveLength(2);
  expect(provider.calls.at(-1)?.messages).toContainEqual(
    runtime(CORM_DEFAULT_TOOL_CALL_HINT),
  );
});

test("does not retry on a reasoning tool call when visible content is present", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup(
    [provider],
    [tooling],
    textToolConfig,
  );
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen1, {
      reasoning: 'see <tool_call>{"name":"echo"}</tool_call>',
      content: "all done",
    }),
  );

  expect(handler.handle(chatEnd(gen1))).toBe("complete");
  expect(tooling.invoked).toEqual([]);
  expect(provider.calls).toHaveLength(1);
});

test("stops retrying once the text tool-call retry limit is reached", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions, streamed } = makeSetup(
    [provider],
    [],
    textToolConfig,
  );
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);

  const text = { content: "<tool_call>x</tool_call>" };

  let gen = subscriptions.generation as string;
  handler.handle(chatDelta(gen, text));
  expect(handler.handle(chatEnd(gen))).toBe("running");

  handler.handle(timerEvent());
  gen = subscriptions.generation as string;
  handler.handle(chatDelta(gen, text));
  expect(handler.handle(chatEnd(gen))).toBe("running");

  handler.handle(timerEvent());
  gen = subscriptions.generation as string;
  handler.handle(chatDelta(gen, text));
  expect(handler.handle(chatEnd(gen))).toBe("complete");

  expect(provider.calls).toHaveLength(3);
  expect(streamed).toContainEqual({
    session: "s1",
    delta: { finishReason: "stop" },
  });
});

const breakerConfig: CormConfig = {
  model: "model",
  contextLength: 131072,
  circuitBreakerLimit: 2,
};

function driveEcho(
  handler: CormChatHandler,
  context: CormContext,
  subscriptions: CormSubscriptions,
): void {
  const gen = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen, {
      toolCall: {
        id: "call-1",
        name: "corm__filesystem__echo",
        arguments: "{}",
      },
    }),
  );
  handler.handle(chatEnd(gen));
  const pending = context.tooling.pending();
  handler.handle(toolResultEvent(pending[pending.length - 1].uuid));
}

test("trips the circuit breaker, drops repeated exchanges and hints", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup(
    [provider],
    [tooling],
    breakerConfig,
  );
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  driveEcho(handler, context, subscriptions);
  expect(
    context.window.input().filter((message) => message.toolCall !== undefined),
  ).toHaveLength(1);

  handler.handle(timerEvent());
  driveEcho(handler, context, subscriptions);

  expect(
    context.window.input().filter((message) => message.toolCall !== undefined),
  ).toHaveLength(1);
  expect(context.window.input()).toContainEqual(
    runtime(CORM_DEFAULT_CIRCUIT_BREAKER_HINT),
  );
  expect(tooling.invoked).toHaveLength(2);
});

test("resets the circuit breaker count on a new endpoint message", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup(
    [provider],
    [tooling],
    breakerConfig,
  );
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  driveEcho(handler, context, subscriptions);

  handler.handle(timerEvent());
  handler.handle(
    endpointMessage("s1", [
      { role: "user", content: "hi" },
      { role: "user", content: "again" },
    ]),
  );
  driveEcho(handler, context, subscriptions);

  expect(context.window.input()).not.toContainEqual(
    runtime(CORM_DEFAULT_CIRCUIT_BREAKER_HINT),
  );
  expect(tooling.invoked).toHaveLength(2);
});

test("appends a recap before ingesting a resumed session's message", () => {
  const provider = makeProvider("gpu");
  const { context } = makeSetup([provider], [], {
    model: "model",
    contextLength: 131072,
    protectMessages: 1,
  });

  context.window.ingest("a", [{ role: "user", content: "a1" }]);
  context.window.append(client("keep"));
  context.window.compact("summary");

  const start = endpointMessage("a", [
    { role: "user", content: "a1" },
    { role: "user", content: "a2" },
  ]);
  const handler = new CormChatHandler(context, "1", start);
  handler.handle(start);

  const messages = provider.calls.at(-1)?.messages ?? [];
  const recapIndex = messages.findIndex((message) =>
    message.content?.includes("You started task chat"),
  );
  const newIndex = messages.findIndex(
    (message) => message.content === client("a2").content,
  );

  expect(recapIndex).toBeGreaterThanOrEqual(0);
  expect(newIndex).toBeGreaterThan(recapIndex);
  expect(messages).toContainEqual(runtime(CORM_DEFAULT_RECAP_END_NOTICE));
});

test("appends the task notice once, never on a merge", () => {
  const provider = makeProvider("gpu");
  const { context, subscriptions } = makeSetup([provider], []);
  const start = endpointMessage("s1");
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  handler.handle(chatEnd(subscriptions.generation as string));
  handler.handle(endpointMessage("s1"));

  const notices = context.window
    .input()
    .filter((message) => message.content === taskNotice(context, "1").content);

  expect(notices).toHaveLength(1);
});
