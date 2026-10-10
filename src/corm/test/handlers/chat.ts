import CormChatHandler from "corm/handlers/chat";
import type { CormConfig, CormSubscriptions } from "corm/lib/opaque";
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

function makeSetup(
  providers: ProviderHandle[],
  toolings: ToolingHandle[],
  config: CormConfig = { model: "model" },
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

test("chat restarts on a same-session message and keeps the interrupted turn", () => {
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
    { role: "assistant", content: "partial", reasoning: "thinking" },
    { role: "user", content: "hi" },
  ]);
});

test("chat injects the configured prompt on every provider call", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions } = makeSetup([provider], [tooling], {
    model: "model",
    prompt: "be terse",
  });
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  expect(provider.calls[0].messages[0]).toEqual({
    role: "system",
    content: "be terse",
  });
  expect(provider.calls[0].messages).toHaveLength(2);

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
  expect(provider.calls[1].messages[0]).toEqual({
    role: "system",
    content: "be terse",
  });
});

test("chat leaves the message list unmodified without a prompt", () => {
  const provider = makeProvider("gpu");
  const { context } = makeSetup([provider], []);
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);

  expect(provider.calls[0].messages).toEqual([{ role: "user", content: "hi" }]);
});

test("chat falls back to the first provider model when the config model is empty", () => {
  const provider = makeProvider("gpu", ["mock-model"]);
  const { context } = makeSetup([provider], [], { model: "" });
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);

  expect(provider.calls[0].model).toBe("mock-model");
});
