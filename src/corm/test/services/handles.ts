import { cormSubscriptionsKey } from "corm/lib/keys";
import type { CormOmw } from "corm/lib/omw";
import { createCormHandlesManager } from "corm/services/handles";
import { expect, test } from "vitest";
import { makeHost, makeProvider, makeToolingHandle } from "../common";

function makeOmw(
  options: {
    providers?: Record<string, ProviderHandle>;
    toolings?: Record<string, ToolingHandle>;
    host?: Host;
  } = {},
) {
  const { host: defaultHost } = makeHost();
  const host = options.host ?? defaultHost;

  return {
    provider: {
      get: (name: string) => {
        const provider = options.providers?.[name];
        if (provider === undefined) {
          throw new Error(`no provider ${name}`);
        }
        return provider;
      },
    },
    tooling: {
      get: (name: string) => {
        const tooling = options.toolings?.[name];
        if (tooling === undefined) {
          throw new Error(`no tooling ${name}`);
        }
        return tooling;
      },
    },
    host,
  } as unknown as CormOmw;
}

test("providers are ordered gpu, remote, cpu", () => {
  const manager = createCormHandlesManager(
    makeOmw({
      providers: {
        gpu: makeProvider("gpu"),
        remote: makeProvider("remote"),
        cpu: makeProvider("cpu"),
      },
    }),
  );

  expect(
    manager
      .load()
      .providers()
      .map((provider) => provider.name),
  ).toEqual(["gpu", "remote", "cpu"]);
});

test("missing providers are filtered out", () => {
  const manager = createCormHandlesManager(
    makeOmw({ providers: { cpu: makeProvider("cpu") } }),
  );

  expect(
    manager
      .load()
      .providers()
      .map((provider) => provider.name),
  ).toEqual(["cpu"]);
});

test("at least one provider is required", () => {
  const manager = createCormHandlesManager(makeOmw());

  expect(() => manager.load()).toThrow("at least one provider");
});

test("configured toolings are enumerated", () => {
  const manager = createCormHandlesManager(
    makeOmw({
      providers: { cpu: makeProvider("cpu") },
      toolings: {
        git: makeToolingHandle("git", ["git_add"]),
        filesystem: makeToolingHandle("filesystem", ["read"]),
      },
    }),
  );

  expect(
    manager
      .load()
      .toolings()
      .map((tooling) => tooling.name),
  ).toEqual(["git", "filesystem"]);
});

test("subscribes fresh when no subscription is stored", () => {
  const fake = makeHost();
  const manager = createCormHandlesManager(
    makeOmw({ providers: { cpu: makeProvider("cpu") }, host: fake.host }),
  );

  const subscriptions = manager.load().subscriptions();

  expect(subscriptions).toEqual({
    lifecycle: "lifecycle-sub",
    endpoint: "endpoint-sub-corm",
    model: "corm",
  });
  expect(fake.counters.lifecycle).toBe(1);
  expect(fake.subscribedEndpoints).toEqual(["corm"]);
  expect(fake.memory.has(cormSubscriptionsKey)).toBe(true);
});

test("reuses a stored subscription for the same model", () => {
  const fake = makeHost();
  fake.memory.set(
    cormSubscriptionsKey,
    JSON.stringify({ lifecycle: "l", endpoint: "e", model: "corm" }),
  );

  const manager = createCormHandlesManager(
    makeOmw({ providers: { cpu: makeProvider("cpu") }, host: fake.host }),
  );

  expect(manager.load().subscriptions()).toEqual({
    lifecycle: "l",
    endpoint: "e",
    model: "corm",
  });
  expect(fake.counters.lifecycle).toBe(0);
  expect(fake.subscribedEndpoints).toEqual([]);
});

test("resubscribes when the stored model no longer matches", () => {
  const fake = makeHost();
  fake.memory.set(
    cormSubscriptionsKey,
    JSON.stringify({ lifecycle: "l", endpoint: "old", model: "other" }),
  );

  const manager = createCormHandlesManager(
    makeOmw({ providers: { cpu: makeProvider("cpu") }, host: fake.host }),
  );

  expect(manager.load().subscriptions().model).toBe("corm");
  expect(fake.unsubscribedEndpoints).toEqual(["old"]);
  expect(fake.subscribedEndpoints).toEqual(["corm"]);
});

test("release persists subscriptions on reload", () => {
  const fake = makeHost();
  const manager = createCormHandlesManager(
    makeOmw({ providers: { cpu: makeProvider("cpu") }, host: fake.host }),
  );

  manager.load();
  manager.release({ id: "r", kind: "reload", payload: null });

  expect(fake.memory.get(cormSubscriptionsKey)).toContain('"model":"corm"');
});
