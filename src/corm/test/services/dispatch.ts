import { assistantMessage, userMessage } from "corm/lib/messages";
import { reduce } from "corm/reducers";
import { createDispatcher } from "corm/services/dispatch";
import { createCormLogger } from "corm/services/logger";
import type { CormAction } from "corm/types/action";
import { expect, test } from "vitest";
import {
  baseConfig,
  chatDelta,
  chatEnd,
  endpointMessage,
  makeHandles,
  makeHost,
  makeState,
  toolResultEvent,
} from "../common";

const config = baseConfig();
const toolName = "corm__filesystem__echo";

const setup = (
  stateConfig = config,
  prepare?: (state: ReturnType<typeof makeState>) => void,
) => {
  const fake = makeHost();
  const state = makeState(stateConfig);
  prepare?.(state);
  const { handles, chat, calls, cancels } = makeHandles(fake.host);
  const dispatcher = createDispatcher(
    createCormLogger(fake.host),
    handles,
    stateConfig,
    state,
  );

  const run = (event: CormAction): void => {
    for (const effect of reduce(event, state, stateConfig)) {
      dispatcher.dispatch(effect);
    }
  };

  return { state, run, fake, chat, calls, cancels, dispatcher };
};

test("starting a chat couples the host call with the state change", () => {
  const { state, run, chat, fake } = setup();

  run(endpointMessage("s1"));

  expect(chat).toHaveLength(1);
  expect(chat[0].model).toBe("model");
  expect(state.memory.subscriptions.generation).toBe("gen-1");
  expect(state.disk.window.session).toBe("s1");
  expect(state.disk.window.active).toHaveLength(1);
  expect(state.disk.turn.summary).toBeUndefined();
  expect(fake.streamed).toEqual([]);
});

test("a request that offers client tools warns and drops them", () => {
  const logs: string[] = [];
  const fake = makeHost({
    log: (level: string, message: string) => {
      if (level === "warn") {
        logs.push(message);
      }
    },
  });
  const state = makeState(config);
  const { handles, chat } = makeHandles(fake.host);
  const dispatcher = createDispatcher(
    createCormLogger(fake.host),
    handles,
    config,
    state,
  );
  const request = {
    id: "event-s1",
    kind: "endpoint-message",
    payload: {
      session: "s1",
      messages: [{ role: "user", content: "hi" }],
      tools: [
        { name: "client__thing", description: "client", inputSchema: {} },
      ],
    },
  } as OmwEvent & { kind: "endpoint-message" };

  for (const effect of reduce(request, state, config)) {
    dispatcher.dispatch(effect);
  }

  expect(chat).toHaveLength(1);
  expect(chat[0].tools).toEqual([]);
  expect(logs).toContain("dropping client tools: client__thing");
});

test("a delta folds into the live message and streams to the endpoint", () => {
  const { state, run, fake } = setup();

  run(endpointMessage("s1"));
  run(chatDelta("gen-1", { content: "hi" }));

  expect(state.disk.window.active.at(-1)?.content).toBe("hi");
  expect(fake.streamed).toEqual([{ session: "s1", delta: { content: "hi" } }]);
});

test("chat end clears the generation and streams the finish reason", () => {
  const { state, run, fake } = setup();

  run(endpointMessage("s1"));
  run(chatDelta("gen-1", { content: "hi" }));
  run(chatEnd("gen-1"));

  expect(state.memory.subscriptions.generation).toBeUndefined();
  expect(state.disk.turn.summary).toBeUndefined();
  expect(fake.streamed.at(-1)).toEqual({
    session: "s1",
    delta: { finishReason: "stop" },
  });
});

test("an owned tool call clears the generation and calls the tool", () => {
  const { state, run, calls } = setup();
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.session = "s1";
  state.disk.window.tools = [{ name: toolName }];
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [{ id: "call-1", name: toolName, arguments: '{"input":10}' }],
      config,
    ),
  ];

  run(chatEnd("gen-1"));

  expect(state.memory.subscriptions.generation).toBeUndefined();
  expect(calls).toEqual([{ name: toolName, args: { input: 10 } }]);
  expect(state.disk.turn.awaiting).toHaveProperty("call-uuid");
});

test("an awaited tool result appends the tool message and re-prompts", () => {
  const { state, run, chat } = setup();
  state.disk.window.session = "s1";
  state.disk.turn.awaiting = { "call-1": { name: toolName, arguments: {} } };

  run(toolResultEvent("call-1", "hi"));

  expect(state.disk.window.active.at(-1)?.role).toBe("tool");
  expect(state.disk.window.active.at(-1)?.content).toBe("hi");
  expect(chat).toHaveLength(1);
  expect(state.memory.subscriptions.generation).toBe("gen-1");
});

test("a request bumps the task and resets the per-turn counters", () => {
  const { state, run } = setup();
  state.disk.turn.toolCallRetries = 2;
  state.disk.turn.toolCalls = { "x:{}": 3 };

  run(endpointMessage("s1"));

  expect(state.disk.task).toBe(1);
  expect(state.disk.turn.toolCallRetries).toBe(0);
  expect(state.disk.turn.toolCalls).toEqual({});
});

test("usage anchors the window size against the provider measurement", () => {
  const { state, run } = setup();

  run(endpointMessage("s1"));
  run(
    chatDelta("gen-1", {
      content: "hi",
      usage: { prompt_tokens: 3, completion_tokens: 5 },
    }),
  );

  expect(state.disk.window.anchor).toBe(8);
});

test("an over-soft chat end opens a compaction that collects and commits", () => {
  const tight = baseConfig({ contextLength: 100, compactThreshold: 0.5 });
  const { state, run, chat } = setup(tight);

  run(endpointMessage("s1"));
  state.disk.window.anchor = 60;
  run(chatEnd("gen-1"));

  expect(chat).toHaveLength(2);
  expect(state.disk.turn.summary).toBe("");

  run(chatDelta("gen-2", { content: "sum" }));
  expect(state.disk.turn.summary).toBe("sum");

  run(chatEnd("gen-2"));
  expect(state.disk.window.summary).toBe("sum");
  expect(state.disk.turn.summary).toBeUndefined();
});

test("a session end cancels the open generation", () => {
  const { state, run, cancels } = setup();

  run(endpointMessage("s1"));
  run({ id: "e", kind: "endpoint-session-end", payload: { session: "s1" } });

  expect(cancels).toEqual(["gen-1"]);
  expect(state.memory.subscriptions.generation).toBeUndefined();
});

test("a call corm does not offer is answered with an error tool message", () => {
  const { state, run, chat } = setup();
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.session = "s1";
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [{ id: "c1", name: "client__thing", arguments: "{}" }],
      config,
    ),
  ];

  run(chatEnd("gen-1"));

  const last = state.disk.window.active.at(-1);
  expect(last?.role).toBe("tool");
  expect(last?.message.toolCallId).toBe("c1");
  expect(last?.content).toContain("Tool error (client__thing #c1):");
  expect(chat).toHaveLength(1);
});

test("a failed owned tool is labeled with its name and call id", () => {
  const { state, run } = setup();
  state.disk.turn.awaiting = {
    "call-1": {
      name: toolName,
      arguments: {},
      toolCallId: "call-1",
      order: 0,
    },
  };

  run({ id: "call-1", kind: "error", payload: "boom" });

  const last = state.disk.window.active.at(-1);
  expect(last?.role).toBe("tool");
  expect(last?.content).toBe(
    "Tool error (corm__filesystem__echo #call-1): boom",
  );
});

test("out-of-order tool results are appended in call order", () => {
  const { state, run } = setup();
  state.disk.turn.awaiting = {
    "call-1": {
      name: toolName,
      arguments: {},
      toolCallId: "call-1",
      order: 1,
    },
    "call-2": {
      name: toolName,
      arguments: {},
      toolCallId: "call-2",
      order: 0,
    },
  };

  run(toolResultEvent("call-1", "second"));
  expect(state.disk.window.active).toHaveLength(0);

  run(toolResultEvent("call-2", "first"));

  const tools = state.disk.window.active.filter(
    (message) => message.role === "tool",
  );
  expect(tools.map((message) => message.content)).toEqual(["first", "second"]);
  expect(tools.map((message) => message.message.toolCallId)).toEqual([
    "call-2",
    "call-1",
  ]);
});

test("rejected and owned results flush together in call order", () => {
  const { state, run } = setup();
  state.disk.window.tools = [{ name: toolName }];
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [
        { id: "c1", name: "client__thing", arguments: "{}" },
        { id: "c2", name: toolName, arguments: "{}" },
      ],
      config,
    ),
  ];

  run(chatEnd("gen-1"));

  expect(state.disk.turn.awaiting["call-uuid"]).toMatchObject({ order: 1 });

  run(toolResultEvent("call-uuid", "owned"));

  const tools = state.disk.window.active.filter(
    (message) => message.role === "tool",
  );
  expect(tools.map((message) => message.message.toolCallId)).toEqual([
    "c1",
    "c2",
  ]);
  expect(tools[0]?.content).toContain("Tool error (client__thing #c1):");
  expect(tools[1]?.content).toBe("owned");
});

test("a text tool call retry appends the hint and counts the retry", () => {
  const { state, run } = setup();
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.active = [
    assistantMessage(
      'see <tool_call>{"name":"echo"}</tool_call>',
      undefined,
      [],
      config,
    ),
  ];

  run(chatEnd("gen-1"));

  expect(state.disk.turn.toolCallRetries).toBe(1);
  expect(state.disk.window.active.at(-1)?.message.content).toContain(
    "tool-calling mechanism",
  );
});

test("the circuit breaker drops the exchange and appends the hint", () => {
  const { state, run } = setup(baseConfig({ circuitBreakerLimit: 1 }));
  state.disk.turn.awaiting = { "call-1": { name: toolName, arguments: {} } };
  state.disk.turn.toolCalls = { [`${toolName}:{}`]: 1 };
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [{ id: "call-1", name: toolName, arguments: "{}" }],
      config,
    ),
  ];

  run(toolResultEvent("call-1", "hi"));

  expect(state.disk.window.active).toHaveLength(1);
  expect(state.disk.window.active[0]?.message.content).toContain("repeatedly");
});

test("a busy turn enqueues the inbound request", () => {
  const { state, run } = setup();
  state.memory.subscriptions.generation = "gen-1";

  run(endpointMessage("s2"));

  expect(state.disk.inbox).toHaveLength(1);
});

test("startup parks a due digest and starts it on the next pump", () => {
  const digestConfig = baseConfig({
    digestCron: "0 0 8 * * *",
    digestFeeds: ["https://example.test/feed"],
    digestLookbackMs: 1000,
    digestStartNotice: "start",
  });
  const { state, run, chat, fake, dispatcher } = setup(digestConfig);

  expect(state.memory.subscriptions.digest).toEqual({ pending: "start" });
  expect(chat).toHaveLength(0);

  dispatcher.startPendingDigest();

  expect(chat).toHaveLength(1);
  expect(state.disk.turn.digest).toBe(true);
  expect(state.disk.window.session).toBe("");
  const prompt = state.disk.window.active.at(-1)?.message.content ?? "";
  expect(prompt).toContain("start");
  expect(prompt).toContain("https://example.test/feed");
  expect(prompt).toContain("1970-01-01T00:16:39.000Z");

  run(chatDelta("gen-1", { content: "hello" }));
  expect(fake.streamed).toEqual([]);
});

test("startup arms the timer when the last digest is fresh", () => {
  const digestConfig = baseConfig({
    digestCron: "0 0 8 * * *",
    digestFeeds: ["feed"],
  });
  const { state, dispatcher } = setup(digestConfig, (prepared) => {
    prepared.disk.digest.last = 1_000_000;
  });

  expect(state.memory.subscriptions.digest).toEqual({
    timer: "timer-0 0 8 * * *",
  });
  dispatcher.startPendingDigest();
  expect(state.memory.subscriptions.digest).toEqual({
    timer: "timer-0 0 8 * * *",
  });
});

test("a completed digest records its start time and re-arms", () => {
  const digestConfig = baseConfig({
    digestCron: "0 0 8 * * *",
    digestFeeds: ["feed"],
  });
  const { state, run } = setup(digestConfig);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.digest = true;
  state.disk.turn.digestSince = 123;
  state.disk.window.active.push(
    assistantMessage("digest text", undefined, [], digestConfig),
  );

  run(chatEnd("gen-1"));

  expect(state.disk.digest.last).toBe(123);
  expect(state.disk.turn.digest).toBe(false);
  expect(state.memory.subscriptions.digest).toEqual({
    timer: "timer-0 0 8 * * *",
  });
});

test("an inbox message preempts a digest and the digest resumes after it", () => {
  const digestConfig = baseConfig({
    digestCron: "0 0 8 * * *",
    digestFeeds: ["feed"],
  });
  const { state, run, chat, dispatcher } = setup(digestConfig);

  dispatcher.startPendingDigest();
  expect(state.disk.turn.digest).toBe(true);
  expect(state.memory.subscriptions.generation).toBe("gen-1");

  run(endpointMessage("s1"));

  expect(state.disk.turn.digest).toBe(false);
  expect(state.memory.subscriptions.digest).toEqual({ pending: "resume" });
  expect(chat).toHaveLength(2);
  expect(state.memory.subscriptions.generation).toBe("gen-2");

  run(chatEnd("gen-2"));
  dispatcher.startPendingDigest();

  expect(state.disk.turn.digest).toBe(true);
  expect(state.memory.subscriptions.digest).toBeUndefined();
  expect(chat).toHaveLength(3);
  expect(state.disk.window.active.at(-1)?.message.content).toContain(
    "resuming the daily digest",
  );
});

test("pending notices are flushed before the digest prompt", () => {
  const digestConfig = baseConfig({
    digestCron: "0 0 8 * * *",
    digestFeeds: ["feed"],
  });
  const { state, dispatcher } = setup(digestConfig);
  state.disk.notices = ["endpoint arrived"];

  dispatcher.startPendingDigest();

  const contents = state.disk.window.active.map(
    (message) => message.message.content ?? "",
  );
  expect(contents[0]).toContain("endpoint arrived");
  expect(contents[1]).toContain("daily digest job");
});

test("a recap appends the notice, the replay and the end marker", () => {
  const { state, run } = setup();
  const old = { role: "user", content: "old" } as const;
  state.disk.receipts = [[userMessage("client", "old", config).digest]];
  state.disk.task = 3;

  run(endpointMessage("s1", [old, { role: "user", content: "new" }]));

  const contents = state.disk.window.active.map(
    (message) => message.message.content ?? "",
  );
  expect(
    contents.some((content) => content.includes("message from the endpoint")),
  ).toBe(true);
  expect(contents).toContain("⟦client⟧\n\nold");
  expect(contents.some((content) => content.includes("End of replay"))).toBe(
    true,
  );
});
