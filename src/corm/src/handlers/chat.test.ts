import { expect, test } from "vitest";
import type { CormContext } from "../services/context";
import type { CormHandles } from "../services/handles";
import { createCormTooling } from "../services/tooling";
import type { CormSubscriptions } from "../services/types";
import CormChatHandler from "./chat";

function makeProvider(name: string): ProviderHandle & { calls: unknown[] } {
  let counter = 0;
  const calls: unknown[] = [];
  return {
    name,
    kind: () => "openai",
    listModels: () => ["model"],
    chat: () => {
      throw new Error("blocking chat is banned");
    },
    chatStream: () => {
      counter += 1;
      calls.push(counter);
      return `${name}-gen-${counter}`;
    },
    isOpen: () => true,
    cancel: () => {},
    calls,
  } as unknown as ProviderHandle & { calls: unknown[] };
}

function makeToolingHandle(
  name: string,
  tools: string[],
): ToolingHandle & { called: { tool: string }[] } {
  let counter = 0;
  const called: { tool: string }[] = [];
  return {
    name,
    kind: () => "mcp",
    listTools: () =>
      tools.map((tool) => ({ name: tool, inputSchema: {} }) as Tool),
    callTool: (tool: string) => {
      called.push({ tool });
      counter += 1;
      return `${name}-call-${counter}`;
    },
    isOpen: () => true,
    cancel: () => {},
    callToolBlocking: () => {
      throw new Error("blocking tool calls are banned");
    },
    listResources: () => [],
    readResource: () => {
      throw new Error("no resources");
    },
    subscribeResourceList: () => "",
    unsubscribeResourceList: () => {},
    subscribeResource: () => "",
    unsubscribeResource: () => {},
    called,
  } as unknown as ToolingHandle & { called: { tool: string }[] };
}

function makeSetup(providers: ProviderHandle[], toolings: ToolingHandle[]) {
  const streamed: { session: string; delta: ChatDelta }[] = [];
  const subscriptions: CormSubscriptions = {
    lifecycle: "lifecycle-sub",
    endpoint: "endpoint-sub",
    model: "corm",
  };
  const host = {
    whoami: () => "corm",
    memoryGet: () => undefined,
    memoryGetAs: () => undefined,
    memorySet: () => {},
    subscribeEndpoint: () => "endpoint-sub",
    subscribeLifecycle: () => "lifecycle-sub",
    unsubscribeEndpoint: () => {},
    streamEndpoint: (session: string, delta: ChatDelta) => {
      streamed.push({ session, delta });
    },
    newUuid: () => "uuid",
    waitFor: () => "wake",
  } as unknown as Host;

  const handles = {
    host: () => host,
    providers: () => providers,
    main: () => providers[0],
    toolings: () => toolings.map((handle, index) => ({ name: `t${index}`, handle })),
    subscriptions: () => subscriptions,
  } as unknown as CormHandles;

  const context: CormContext = {
    handles,
    config: {
      load: () => ({ model: "model" }),
      release: () => {},
    },
    tooling: createCormTooling(handles),
  };

  return { context, subscriptions, streamed };
}

function endpointMessage(session = "s1"): OmwEvent {
  return {
    id: "event-1",
    kind: "endpoint-message",
    payload: {
      session,
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    },
  };
}

function chatDelta(gen: string, payload: ChatDelta): OmwEvent {
  return { id: gen, kind: "chat-delta", payload };
}

function chatEnd(gen: string): OmwEvent {
  return { id: gen, kind: "chat-end", payload: null };
}

function timerEvent(id = "wake"): OmwEvent {
  return { id, kind: "timer", payload: null };
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
  const { context, subscriptions, streamed } = makeSetup(
    [provider],
    [tooling],
  );
  const start = endpointMessage();
  const handler = new CormChatHandler(context, "1", start);

  handler.handle(start);
  const gen1 = subscriptions.generation as string;
  handler.handle(
    chatDelta(gen1, {
      toolCall: { id: "call-1", name: "corm__echo", arguments: '{"in":"hi"}' },
    }),
  );
  expect(handler.handle(chatEnd(gen1))).toBe("running");
  expect(tooling.called).toEqual([{ tool: "echo" }]);

  const pending = context.tooling.pending();
  expect(pending).toHaveLength(1);

  const toolResult: OmwEvent = {
    id: pending[0].uuid,
    kind: "tool-result",
    payload: {
      name: "echo",
      arguments: { in: "hi" },
      content: [{ type: "text", text: "hi" }],
    },
  };
  expect(handler.handle(toolResult)).toBe("running");
  expect(handler.handle(timerEvent())).toBe("running");
  expect(provider.calls.length).toBe(2);

  const gen2 = subscriptions.generation as string;
  handler.handle(chatDelta(gen2, { content: "done" }));
  expect(handler.handle(chatEnd(gen2))).toBe("complete");
  expect(streamed.some((event) => event.delta.content === "done")).toBe(true);
});

test("chat forwards unknown client tool calls without executing them", () => {
  const provider = makeProvider("gpu");
  const tooling = makeToolingHandle("filesystem", ["echo"]);
  const { context, subscriptions, streamed } = makeSetup(
    [provider],
    [tooling],
  );
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
  expect(tooling.called).toEqual([]);
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
  expect(
    handler.handle({ id: gen, kind: "error", payload: "boom" }),
  ).toBe("running");
  expect(handler.handle(timerEvent())).toBe("running");
  expect(second.calls.length).toBe(1);
  expect(subscriptions.generation).toBe("cpu-gen-1");
});
