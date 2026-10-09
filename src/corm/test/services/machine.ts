import type {
  CormGlobalState,
  CormMaterializedTaskSpec,
  CormOutcome,
  CormTask,
} from "corm/lib/opaque";
import { createCormMachine } from "corm/services/machine";
import type {
  CormHandler,
  CormHandlerRegistrar,
} from "corm/services/registrar";
import { expect, test } from "vitest";
import {
  endpointMessage,
  makeContext,
  makeHandles,
  makeHost,
  makeProvider,
} from "../common";

class FakeHandler implements CormHandler {
  public handled: OmwEvent[] = [];

  constructor(
    public readonly task: CormTask,
    public accept: (event: OmwEvent) => boolean,
    public outcome: (event: OmwEvent) => CormOutcome,
  ) {}

  public accepts(event: OmwEvent): boolean {
    return this.accept(event);
  }

  public handle(event: OmwEvent): CormOutcome {
    this.handled.push(event);
    return this.outcome(event);
  }
}

function makeRegistrar(
  should: (event: OmwEvent) => CormMaterializedTaskSpec | undefined,
) {
  const created: FakeHandler[] = [];
  const acceptQueue: ((event: OmwEvent) => boolean)[] = [];
  const outcomeQueue: ((event: OmwEvent) => CormOutcome)[] = [];

  const registrar = {
    should,
    create(task: CormTask) {
      const handler = new FakeHandler(
        task,
        acceptQueue.shift() ?? (() => true),
        outcomeQueue.shift() ?? (() => "running"),
      );
      created.push(handler);
      return handler;
    },
    created,
    acceptQueue,
    outcomeQueue,
  };

  return registrar as unknown as CormHandlerRegistrar & {
    created: FakeHandler[];
    acceptQueue: ((event: OmwEvent) => boolean)[];
    outcomeQueue: ((event: OmwEvent) => CormOutcome)[];
  };
}

function chatSpec(event: OmwEvent): CormMaterializedTaskSpec | undefined {
  if (event.kind !== "endpoint-message") {
    return undefined;
  }

  return {
    kind: "chat",
    spec: {
      placement: "immediate",
      atomic: true,
      key: event.payload.session,
      state: event,
    },
  };
}

function makeMachine(registrar: CormHandlerRegistrar) {
  const provider = makeProvider("gpu");
  const { host } = makeHost();
  const handles = makeHandles({ host, providers: [provider] });
  const context = makeContext(handles);
  const state: CormGlobalState = { pending: [], immediate: [] };

  return {
    machine: createCormMachine(context, state, registrar),
    state,
    provider,
    handles,
  };
}

test("materializes a task and dispatches its start event", () => {
  const registrar = makeRegistrar(chatSpec);
  registrar.outcomeQueue.push(() => "complete");
  const { machine, state } = makeMachine(registrar);

  const start = endpointMessage("s1");
  machine.handle(start);

  expect(registrar.created).toHaveLength(1);
  expect(registrar.created[0].handled).toEqual([start]);
  expect(state.immediate).toEqual([]);
  expect(state.pending).toEqual([]);
});

test("merges a same-session message into the active task", () => {
  const registrar = makeRegistrar(chatSpec);
  const { machine, state } = makeMachine(registrar);

  const first = endpointMessage("s1");
  const second = endpointMessage("s1");
  machine.handle(first);
  machine.handle(second);

  expect(registrar.created).toHaveLength(1);
  expect(registrar.created[0].handled).toEqual([first, second]);
  expect(state.immediate).toHaveLength(1);
});

test("queues a different session while an atomic task is active", () => {
  const registrar = makeRegistrar(chatSpec);
  registrar.acceptQueue.push((event) =>
    event.kind === "endpoint-message" ? event.payload.session === "s1" : true,
  );
  registrar.outcomeQueue.push((event) =>
    event.kind === "timer" ? "complete" : "running",
  );

  const { machine, state } = makeMachine(registrar);

  machine.handle(endpointMessage("s1"));
  machine.handle(endpointMessage("s2"));

  expect(registrar.created).toHaveLength(2);
  expect(state.immediate).toHaveLength(1);
  expect(state.pending).toHaveLength(1);
  expect(registrar.created[1].handled).toEqual([]);

  machine.handle({ id: "wake", kind: "timer", payload: null });

  expect(state.pending).toEqual([]);
  expect(state.immediate).toHaveLength(1);
  expect(registrar.created[1].handled).toEqual([endpointMessage("s2")]);
});

test("routes events to the accepting task rather than the top of the stack", () => {
  const registrar = makeRegistrar((event) => {
    if (event.kind !== "endpoint-message") {
      return undefined;
    }

    return {
      kind: "chat",
      spec: {
        placement: "immediate",
        atomic: false,
        key: event.payload.session,
        state: event,
      },
    };
  });
  registrar.acceptQueue.push((event) => event.kind === "message");
  registrar.acceptQueue.push(() => false);

  const { machine, state } = makeMachine(registrar);

  machine.handle(endpointMessage("s1"));
  machine.handle(endpointMessage("s2"));
  expect(state.immediate).toHaveLength(2);

  const message: OmwEvent = { id: "m", kind: "message", payload: "ping" };
  machine.handle(message);

  expect(registrar.created[0].handled).toContainEqual(message);
  expect(registrar.created[1].handled).toEqual([]);
});

test("cancels the active generation on shutdown", () => {
  const registrar = makeRegistrar(chatSpec);
  const { machine, provider, handles } = makeMachine(registrar);

  machine.handle(endpointMessage("s1"));
  handles.subscriptions().generation = "gen-1";

  machine.handle({ id: "shutdown", kind: "shutdown", payload: null });

  expect(provider.cancelled).toEqual(["gen-1"]);
});

test("reload does not create or dispatch anything", () => {
  const registrar = makeRegistrar(chatSpec);
  const { machine } = makeMachine(registrar);

  machine.handle({ id: "reload", kind: "reload", payload: null });

  expect(registrar.created).toEqual([]);
});

test("ignores events with no matching task", () => {
  const registrar = makeRegistrar(chatSpec);
  const { machine } = makeMachine(registrar);

  expect(() =>
    machine.handle({ id: "t", kind: "timer", payload: null }),
  ).not.toThrow();
  expect(registrar.created).toEqual([]);
});
