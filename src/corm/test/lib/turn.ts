import {
  hasAwaitingTools,
  isTurnBusy,
  isTurnChatting,
  isTurnCompacting,
  isTurnIdling,
} from "corm/lib/turn";
import { expect, test } from "vitest";
import { baseConfig, makeState } from "../common";

const config = baseConfig();

test("an idle turn has no generation and no awaits", () => {
  const state = makeState(config);

  expect(isTurnIdling(state)).toBe(true);
  expect(isTurnChatting(state)).toBe(false);
  expect(isTurnCompacting(state)).toBe(false);
  expect(isTurnBusy(state)).toBe(false);
});

test("an open generation with no summary is chatting", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";

  expect(isTurnIdling(state)).toBe(false);
  expect(isTurnChatting(state)).toBe(true);
  expect(isTurnCompacting(state)).toBe(false);
  expect(isTurnBusy(state)).toBe(true);
});

test("an open generation with a summary is compacting", () => {
  const state = makeState(config);
  state.memory.subscriptions.generation = "gen-1";
  state.disk.turn.summary = "";

  expect(isTurnChatting(state)).toBe(false);
  expect(isTurnCompacting(state)).toBe(true);
});

test("an awaited tool call keeps the turn busy", () => {
  const state = makeState(config);
  state.disk.turn.awaiting = { "call-1": { name: "t", arguments: {} } };

  expect(isTurnIdling(state)).toBe(true);
  expect(hasAwaitingTools(state)).toBe(true);
  expect(isTurnBusy(state)).toBe(true);
});
