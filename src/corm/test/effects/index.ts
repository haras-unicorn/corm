import { approveEffects } from "corm/effects";
import { isGenerationFree } from "corm/effects/generation";
import { expect, test } from "vitest";
import { baseConfig, endpointMessage, makeState } from "../common";

const config = baseConfig();

const generationFreeState = () => {
  const state = makeState(config);
  if (!isGenerationFree(state)) {
    throw new Error("expected the state to have no open generation");
  }
  return state;
};

test("approves a whole endpoint-message sequence in order", () => {
  const effects = approveEffects(
    generationFreeState(),
    endpointMessage("s1"),
    {
      kind: "set-active-request",
      session: "s1",
      params: undefined,
      clientTools: [],
    },
    { kind: "append-inbound-messages", messages: [] },
    { kind: "start-chat-generation" },
  );

  expect(effects.map((effect) => effect.kind)).toEqual([
    "set-active-request",
    "append-inbound-messages",
    "start-chat-generation",
  ]);
});

test("approval threads each effect's next state through the sequence", () => {
  const state = generationFreeState();
  const action = endpointMessage("s1");
  const start = { kind: "start-chat-generation" } as const;

  // The first start is legal (no generation is open); the second is not,
  // because the first leaves a generation open for the rest of the sequence.
  // @ts-expect-error the second start-chat-generation has no legal precondition
  const illegal = approveEffects(state, action, start, start);

  expect(illegal.map((effect) => effect.kind)).toEqual([
    "start-chat-generation",
    "start-chat-generation",
  ]);
});
