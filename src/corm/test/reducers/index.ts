import { assistantMessage, userMessage } from "corm/lib/messages";
import { reduce } from "corm/reducers";
import { expect, test } from "vitest";
import {
  baseConfig,
  chatDelta,
  chatEnd,
  endpointMessage,
  makeState,
  toolResultEvent,
} from "../common";

const config = baseConfig();
const toolName = "corm__filesystem__echo";

const kinds = (effects: { kind: string }[]): string[] =>
  effects.map((effect) => effect.kind);

test("an endpoint message sets the request, appends the history and starts a turn", () => {
  const state = makeState(config);

  const effects = reduce(endpointMessage("s1"), state, config);

  expect(kinds(effects)).toEqual([
    "set-active-request",
    "append-inbound-messages",
    "start-chat-generation",
  ]);
  expect(effects[0]).toMatchObject({ session: "s1" });
});

test("an endpoint message is queued while a generation is active", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";

  const effects = reduce(endpointMessage("s1"), state, config);

  expect(kinds(effects)).toEqual(["queue-notice", "enqueue-inbound"]);
  expect(effects[1]).toMatchObject({ event: { kind: "endpoint-message" } });
});

test("an endpoint message is queued while a tool call is outstanding", () => {
  const state = makeState(config);
  state.disk.turn.awaiting = { "call-1": { name: toolName, arguments: {} } };

  expect(kinds(reduce(endpointMessage("s1"), state, config))).toEqual([
    "queue-notice",
    "enqueue-inbound",
  ]);
});

test("a matching chat delta folds and streams", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";

  const effects = reduce(chatDelta("gen-1", { content: "hi" }), state, config);

  expect(kinds(effects)).toEqual(["fold-chat-delta", "stream-endpoint-delta"]);
  expect(effects[1]).toMatchObject({ delta: { content: "hi" } });
});

test("a chat delta while compacting only folds the summary", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.summary = "";

  expect(
    kinds(reduce(chatDelta("gen-1", { content: "s" }), state, config)),
  ).toEqual(["fold-chat-delta"]);
});

test("a chat delta from another generation is dropped", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";

  expect(
    kinds(reduce(chatDelta("gen-2", { content: "hi" }), state, config)),
  ).toEqual(["noop"]);
});

test("chat end streams the finish reason and clears the generation", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";

  const effects = reduce(chatEnd("gen-1"), state, config);

  expect(kinds(effects)).toEqual(["stream-endpoint-delta", "clear-generation"]);
  expect(effects[0]).toMatchObject({ delta: { finishReason: "stop" } });
});

test("chat end retries a tool call written as text", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.active = [
    assistantMessage(
      'see <tool_call>{"name":"echo"}</tool_call>',
      undefined,
      [],
      config,
    ),
  ];

  const effects = reduce(chatEnd("gen-1"), state, config);

  expect(kinds(effects)).toEqual([
    "retry-text-tool-call",
    "clear-generation",
    "start-chat-generation",
  ]);
});

test("chat end finishes once the text retry is exhausted", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.toolCallRetries = 3;
  state.disk.window.active = [
    assistantMessage(
      'see <tool_call>{"name":"echo"}</tool_call>',
      undefined,
      [],
      config,
    ),
  ];

  expect(kinds(reduce(chatEnd("gen-1"), state, config))).toEqual([
    "stream-endpoint-delta",
    "clear-generation",
  ]);
});

test("chat end invokes the owned tool calls", () => {
  const state = makeState(config);
  state.disk.window.tools = [{ name: toolName }];
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [{ id: "call-1", name: toolName, arguments: "{}" }],
      config,
    ),
  ];
  state.memory.subscriptions.generation = "gen-1";

  const effects = reduce(chatEnd("gen-1"), state, config);

  expect(kinds(effects)).toEqual(["invoke-corm-tools"]);
  expect(effects[0]).toMatchObject({
    calls: [{ name: toolName, arguments: "{}", toolCallId: "call-1" }],
  });
});

test("chat end rejects a call corm does not offer and re-prompts", () => {
  const state = makeState(config);
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [{ id: "c1", name: "client__thing", arguments: "{}" }],
      config,
    ),
  ];
  state.memory.subscriptions.generation = "gen-1";

  const effects = reduce(chatEnd("gen-1"), state, config);

  expect(kinds(effects)).toEqual([
    "invoke-corm-tools",
    "start-chat-generation",
  ]);
  expect(effects[0]).toMatchObject({
    calls: [],
    rejected: [{ name: "client__thing", arguments: "{}", toolCallId: "c1" }],
  });
});

test("chat end gives up re-prompting after too many rejected calls", () => {
  const state = makeState(config);
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [{ id: "c1", name: "client__thing", arguments: "{}" }],
      config,
    ),
  ];
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.toolCallRetries = config.toolCallRetryLimit ?? 3;

  expect(kinds(reduce(chatEnd("gen-1"), state, config))).toEqual([
    "invoke-corm-tools",
    "stream-endpoint-delta",
  ]);
});

test("an awaited tool result appends and re-prompts", () => {
  const state = makeState(config);
  state.disk.turn.awaiting = { "call-1": { name: toolName, arguments: {} } };

  expect(kinds(reduce(toolResultEvent("call-1", "hi"), state, config))).toEqual(
    ["append-tool-result", "start-chat-generation"],
  );
});

test("a multi-tool turn awaits every result before re-prompting", () => {
  const state = makeState(config);
  state.disk.turn.awaiting = {
    "call-1": { name: toolName, arguments: {} },
    "call-2": { name: toolName, arguments: {} },
  };

  expect(kinds(reduce(toolResultEvent("call-1", "a"), state, config))).toEqual([
    "append-tool-result",
  ]);

  delete state.disk.turn.awaiting["call-1"];
  expect(kinds(reduce(toolResultEvent("call-2", "b"), state, config))).toEqual([
    "append-tool-result",
    "start-chat-generation",
  ]);
});

test("chat end invokes every owned tool call in the turn", () => {
  const state = makeState(config);
  state.disk.window.tools = [{ name: toolName }];
  state.disk.window.active = [
    assistantMessage(
      "",
      undefined,
      [
        { id: "call-1", name: toolName, arguments: '{"input":"a"}' },
        { id: "call-2", name: toolName, arguments: '{"input":"b"}' },
      ],
      config,
    ),
  ];
  state.memory.subscriptions.generation = "gen-1";

  const effects = reduce(chatEnd("gen-1"), state, config);

  expect(kinds(effects)).toEqual(["invoke-corm-tools"]);
  expect(effects[0]).toMatchObject({
    calls: [
      { name: toolName, toolCallId: "call-1" },
      { name: toolName, toolCallId: "call-2" },
    ],
  });
});

test("a repeated tool call trips the circuit breaker", () => {
  const state = makeState(baseConfig({ circuitBreakerLimit: 2 }));
  const cbConfig = baseConfig({ circuitBreakerLimit: 2 });
  state.disk.turn.awaiting = { "call-1": { name: toolName, arguments: {} } };
  state.disk.turn.toolCalls = { [`${toolName}:{}`]: 2 };

  expect(
    kinds(reduce(toolResultEvent("call-1", "hi"), state, cbConfig)),
  ).toEqual(["append-tool-result", "circuit-break", "start-chat-generation"]);
});

test("a tool result with no awaited call is dropped", () => {
  const state = makeState(config);

  expect(kinds(reduce(toolResultEvent("call-1", "hi"), state, config))).toEqual(
    ["noop"],
  );
});

test("a session end cancels the open generation", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.session = "s1";

  const event: OmwEvent = {
    id: "e",
    kind: "endpoint-session-end",
    payload: { session: "s1" },
  };

  expect(kinds(reduce(event, state, config))).toEqual(["cancel-generation"]);
});

test("a session end does not cancel a background generation", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.session = "";

  const event: OmwEvent = {
    id: "e",
    kind: "endpoint-session-end",
    payload: { session: "s1" },
  };

  expect(kinds(reduce(event, state, config))).toEqual(["noop"]);
});

test("unhandled events are dropped as a noop", () => {
  const state = makeState(config);

  expect(
    kinds(reduce({ id: "r", kind: "reload", payload: null }, state, config)),
  ).toEqual(["noop"]);
  expect(
    kinds(reduce({ id: "t", kind: "timer", payload: null }, state, config)),
  ).toEqual(["noop"]);
});

test("an over-soft ingest compacts before the turn", () => {
  const tight = baseConfig({ contextLength: 100, compactThreshold: 0.5 });
  const state = makeState(tight);
  state.disk.window.anchor = 60;

  const effects = reduce(endpointMessage("s1"), state, tight);

  expect(kinds(effects)).toEqual([
    "set-active-request",
    "append-inbound-messages",
    "start-compaction-generation",
  ]);
  expect(effects[2]).toMatchObject({ resume: true });
});

test("a recap is prepended when a re-offered message was evicted", () => {
  const state = makeState(config);
  const old = { role: "user", content: "old" } as const;
  state.disk.receipts = [[userMessage("client", "old", config).digest]];

  const effects = reduce(
    endpointMessage("s1", [old, { role: "user", content: "new" }]),
    state,
    config,
  );

  expect(kinds(effects)).toEqual([
    "set-active-request",
    "append-recap",
    "append-inbound-messages",
    "start-chat-generation",
  ]);
  expect(effects[1]).toMatchObject({ replay: [old] });
});

test("a turn crossing the hard threshold compacts mid-stream", () => {
  const tight = baseConfig({ contextLength: 100, hardThreshold: 0.9 });
  const state = makeState(tight);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.anchor = 95;

  const effects = reduce(chatDelta("gen-1", { content: "x" }), state, tight);

  expect(kinds(effects)).toEqual([
    "fold-chat-delta",
    "stream-endpoint-delta",
    "stream-endpoint-delta",
    "cancel-generation",
    "start-compaction-generation",
  ]);
});

test("an over-soft chat end compacts instead of finishing", () => {
  const tight = baseConfig({ contextLength: 100, compactThreshold: 0.5 });
  const state = makeState(tight);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.window.anchor = 60;

  const effects = reduce(chatEnd("gen-1"), state, tight);

  expect(kinds(effects)).toEqual([
    "stream-endpoint-delta",
    "clear-generation",
    "start-compaction-generation",
  ]);
  expect(effects[2]).toMatchObject({ resume: false });
});

test("a chat error finishes the turn", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";

  const effects = reduce(
    { id: "gen-1", kind: "error", payload: "boom" },
    state,
    config,
  );

  expect(kinds(effects)).toEqual(["stream-endpoint-delta", "clear-generation"]);
});

test("a compaction error retries the compaction", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.summary = "";
  state.disk.turn.resume = true;

  const effects = reduce(
    { id: "gen-1", kind: "error", payload: "boom" },
    state,
    config,
  );

  expect(kinds(effects)).toEqual([
    "cancel-generation",
    "start-compaction-generation",
  ]);
  expect(effects[1]).toMatchObject({ resume: true });
});

test("a tool error becomes a tool message and re-prompts", () => {
  const state = makeState(config);
  state.disk.turn.awaiting = { "call-1": { name: toolName, arguments: {} } };

  const effects = reduce(
    { id: "call-1", kind: "error", payload: "boom" },
    state,
    config,
  );

  expect(kinds(effects)).toEqual([
    "append-tool-result",
    "start-chat-generation",
  ]);
  expect(effects[0]).toMatchObject({
    id: "call-1",
    result: { content: [{ text: "boom" }] },
  });
});

test("an over-soft tool settle compacts before re-prompting", () => {
  const tight = baseConfig({ contextLength: 100, compactThreshold: 0.5 });
  const state = makeState(tight);
  state.disk.turn.awaiting = { "call-1": { name: toolName, arguments: {} } };
  state.disk.window.anchor = 60;

  const effects = reduce(toolResultEvent("call-1", "hi"), state, tight);

  expect(kinds(effects)).toEqual([
    "append-tool-result",
    "start-compaction-generation",
  ]);
});
