import CormChatHandler from "corm/handlers/chat";
import { createCormHandlerRegistrar } from "corm/services/registrar";
import { expect, test } from "vitest";
import { endpointMessage, makeContext, makeHandles, makeHost } from "../common";

function makeRegistrar() {
  const { host } = makeHost();
  const context = makeContext(makeHandles({ host }));

  return createCormHandlerRegistrar(context);
}

test("should materializes a chat task for an endpoint message", () => {
  const registrar = makeRegistrar();
  const event = endpointMessage("s1");

  expect(registrar.should(event)).toEqual({
    kind: "chat",
    spec: {
      placement: "immediate",
      atomic: true,
      key: "s1",
      state: event,
    },
  });
});

test("should ignores unrelated events", () => {
  const registrar = makeRegistrar();

  expect(registrar.should({ id: "t", kind: "timer", payload: null })).toBe(
    undefined,
  );
});

test("create builds the registered handler", () => {
  const registrar = makeRegistrar();
  const task = { kind: "chat", id: "1", state: endpointMessage("s1") };

  expect(registrar.create(task)).toBeInstanceOf(CormChatHandler);
});

test("create rejects unknown handler kinds", () => {
  const registrar = makeRegistrar();
  const task = { kind: "nope", id: "1", state: endpointMessage("s1") };

  expect(() => registrar.create(task)).toThrow("unknown factory kind nope");
});
