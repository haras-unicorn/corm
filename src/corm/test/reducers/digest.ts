import { assistantMessage } from "corm/lib/messages";
import { reduce } from "corm/reducers";
import type { CormAction } from "corm/types/action";
import { expect, test } from "vitest";
import {
  baseConfig,
  chatEnd,
  endpointMessage,
  makeState,
  toolResultEvent,
} from "../common";

const now = 1_000_000;

const kinds = (effects: { kind: string }[]): string[] =>
  effects.map((effect) => effect.kind);

const timer = (id: string): CormAction => ({
  id,
  kind: "timer",
  payload: null,
});

const digestConfig = (overrides = {}) =>
  baseConfig({
    digestCron: "0 0 8 * * *",
    digestFeeds: ["feed"],
    ...overrides,
  });

const armed = (config = digestConfig()) => {
  const state = makeState(config);
  state.memory.subscriptions.digest = { timer: "timer-1" };
  return state;
};

test("a matching digest timer starts the digest when idle", () => {
  const config = digestConfig();
  const state = armed(config);

  expect(kinds(reduce(timer("timer-1"), state, config, now))).toEqual([
    "start-digest",
  ]);
});

test("a timer that is not the digest's is dropped", () => {
  const config = digestConfig();
  const state = armed(config);
  state.memory.subscriptions.digest = { timer: "timer-2" };

  expect(kinds(reduce(timer("timer-1"), state, config, now))).toEqual(["noop"]);
});

test("the true kill switch disables the digest timer", () => {
  const config = baseConfig({ digestCron: true });
  const state = armed(config);

  expect(kinds(reduce(timer("timer-1"), state, config, now))).toEqual(["noop"]);
});

test("a fire while a digest is already running is dropped", () => {
  const config = digestConfig();
  const state = armed(config);
  state.disk.turn.digest = true;

  expect(kinds(reduce(timer("timer-1"), state, config, now))).toEqual(["noop"]);
});

test("a fire too soon after a run is skipped and re-armed", () => {
  const config = digestConfig();
  const state = armed(config);
  state.disk.digest.last = now - 60 * 1000;

  expect(kinds(reduce(timer("timer-1"), state, config, now))).toEqual([
    "arm-digest-timer",
  ]);
});

test("a fire while busy queues the digest and a notice", () => {
  const config = digestConfig();
  const state = armed(config);
  state.memory.subscriptions.generation = "gen-1";

  expect(kinds(reduce(timer("timer-1"), state, config, now))).toEqual([
    "queue-notice",
    "queue-digest",
  ]);
});

test("a completed digest commits its start time and re-arms", () => {
  const config = digestConfig();
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.digest = true;
  state.disk.turn.digestSince = 123;
  state.disk.window.active.push(
    assistantMessage("digest text", undefined, [], config),
  );

  const effects = reduce(chatEnd("gen-1"), state, config);

  expect(kinds(effects)).toEqual([
    "stream-endpoint-delta",
    "commit-digest",
    "arm-digest-timer",
    "clear-generation",
  ]);
  expect(effects[1]).toMatchObject({ at: 123 });
});

test("a compacted digest turn resumes with a digest notice", () => {
  const config = digestConfig();
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.summary = "summary";
  state.disk.turn.resume = true;
  state.disk.turn.digest = true;

  const effects = reduce(chatEnd("gen-1"), state, config);

  expect(kinds(effects)).toEqual([
    "commit-compaction",
    "clear-generation",
    "append-runtime-message",
    "start-chat-generation",
  ]);
  expect((effects[2] as { content?: string }).content).toContain(
    "resuming the daily digest",
  );
});

test("a failed digest re-arms without committing", () => {
  const config = digestConfig();
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.digest = true;

  const effects = reduce(
    { id: "gen-1", kind: "error", payload: "boom" },
    state,
    config,
  );

  expect(kinds(effects)).toEqual([
    "stream-endpoint-delta",
    "arm-digest-timer",
    "clear-generation",
  ]);
});

test("notices flush before a tool-driven re-prompt", () => {
  const config = digestConfig();
  const state = makeState(config);
  state.disk.notices = ["endpoint arrived"];
  state.disk.turn.awaiting = {
    "call-1": { name: "corm__filesystem__echo", arguments: {} },
  };

  expect(kinds(reduce(toolResultEvent("call-1"), state, config))).toEqual([
    "append-tool-result",
    "flush-notices",
    "start-chat-generation",
  ]);
});

test("an inbox message preempts a streaming digest", () => {
  const config = digestConfig();
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.digest = true;

  expect(kinds(reduce(endpointMessage("s1"), state, config))).toEqual([
    "cancel-generation",
    "queue-digest",
    "set-active-request",
    "append-inbound-messages",
    "start-chat-generation",
  ]);
});

test("an inbox message waits while the digest is awaiting a tool", () => {
  const config = digestConfig();
  const state = makeState(config);
  state.disk.turn.digest = true;
  state.disk.turn.awaiting = {
    "call-1": { name: "corm__rss__get_articles", arguments: {} },
  };

  expect(kinds(reduce(endpointMessage("s1"), state, config))).toEqual([
    "queue-notice",
    "enqueue-inbound",
  ]);
});

test("an inbox message waits while the digest is compacting", () => {
  const config = digestConfig();
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.summary = "";
  state.disk.turn.digest = true;

  expect(kinds(reduce(endpointMessage("s1"), state, config))).toEqual([
    "queue-notice",
    "enqueue-inbound",
  ]);
});
