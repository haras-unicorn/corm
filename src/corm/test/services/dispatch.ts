import { assistantMessage, userMessage } from "corm/lib/messages";
import { reduce } from "corm/reducers";
import { createDispatcher } from "corm/services/dispatch";
import { createCormLogger } from "corm/services/logger";
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

const setup = (stateConfig = config) => {
  const fake = makeHost();
  const state = makeState(stateConfig);
  const { handles, chat, calls, cancels } = makeHandles(fake.host);
  const dispatcher = createDispatcher(
    createCormLogger(fake.host),
    handles,
    stateConfig,
    state,
  );

  const run = (event: OmwEvent): void => {
    for (const effect of reduce(event, state, stateConfig)) {
      dispatcher.dispatch(effect);
    }
  };

  return { state, run, fake, chat, calls, cancels };
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
      { id: "call-1", name: toolName, arguments: "{}" },
      config,
    ),
  ];

  run(chatEnd("gen-1"));

  expect(state.memory.subscriptions.generation).toBeUndefined();
  expect(calls).toEqual([{ name: toolName, args: "{}" }]);
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
      usage: { promptTokens: 3, completionTokens: 5 },
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

test("a client tool call is streamed to the endpoint", () => {
  const { state, run, fake } = setup();
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.session = "s1";
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      { id: "c1", name: "client__thing", arguments: "{}" },
      config,
    ),
  ];

  run(chatEnd("gen-1"));

  expect(fake.streamed).toContainEqual({
    session: "s1",
    delta: { toolCall: { id: "c1", name: "client__thing", arguments: "{}" } },
  });
});

test("a text tool call retry appends the hint and counts the retry", () => {
  const { state, run } = setup();
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.active = [
    assistantMessage(
      'see <tool_call>{"name":"echo"}</tool_call>',
      undefined,
      undefined,
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
      { id: "call-1", name: toolName, arguments: "{}" },
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

test("a recap appends the notice, the replay and the end marker", () => {
  const { state, run } = setup();
  const old = { role: "user", content: "old" } as const;
  state.disk.receipts = [[userMessage("client", "old", config).digest]];
  state.disk.task = 3;

  run(endpointMessage("s1", [old, { role: "user", content: "new" }]));

  const contents = state.disk.window.active.map(
    (message) => message.message.content ?? "",
  );
  expect(contents.some((content) => content.includes("chat (4)"))).toBe(true);
  expect(contents).toContain("⟦client⟧\n\nold");
  expect(contents.some((content) => content.includes("End of replay"))).toBe(
    true,
  );
});
