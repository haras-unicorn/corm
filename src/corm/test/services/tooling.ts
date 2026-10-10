import { cormToolPrefix, createCormTooling } from "corm/services/tooling";
import { expect, test } from "vitest";
import {
  makeHandles,
  makeHost,
  makeNamedToolings,
  makeToolingHandle,
  toolResult,
} from "../common";

function setup(...toolings: ReturnType<typeof makeToolingHandle>[]) {
  const { host } = makeHost();
  const handles = makeHandles({
    host,
    toolings: makeNamedToolings(toolings),
  });

  return createCormTooling(handles);
}

function setupWith(
  allowed: string[],
  ...toolings: ReturnType<typeof makeToolingHandle>[]
) {
  const { host } = makeHost();
  const handles = makeHandles({
    host,
    toolings: makeNamedToolings(toolings),
  });

  return createCormTooling(handles, allowed);
}

test("definitions expose every tool under the corm prefix", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read", "write"]));

  expect(tooling.definitions()).toEqual([
    {
      name: `${cormToolPrefix}filesystem__read`,
      description: "read tool",
      inputSchema: {},
      outputSchema: undefined,
    },
    {
      name: `${cormToolPrefix}filesystem__write`,
      description: "write tool",
      inputSchema: {},
      outputSchema: undefined,
    },
  ]);
});

test("definitions only expose the configured subset", () => {
  const tooling = setupWith(
    ["filesystem__read"],
    makeToolingHandle("filesystem", ["read", "write"]),
  );

  expect(tooling.definitions().map((definition) => definition.name)).toEqual([
    `${cormToolPrefix}filesystem__read`,
  ]);
  expect(tooling.own(`${cormToolPrefix}filesystem__read`)).toBe(true);
  expect(tooling.own(`${cormToolPrefix}filesystem__write`)).toBe(false);
  expect(() =>
    tooling.invoke(`${cormToolPrefix}filesystem__write`, {}),
  ).toThrow(`unknown corm tool ${cormToolPrefix}filesystem__write`);
});

test("an empty subset exposes no tools", () => {
  const tooling = setupWith(
    [],
    makeToolingHandle("filesystem", ["read", "write"]),
  );

  expect(tooling.definitions()).toEqual([]);
});

test("always-disabled tools are never exposed", () => {
  const handle = makeToolingHandle("git", [
    "git_set_working_dir",
    "git_status",
  ]);

  const all = setup(handle);
  expect(all.definitions().map((definition) => definition.name)).toEqual([
    `${cormToolPrefix}git__git_status`,
  ]);

  const explicit = setupWith(["git__git_set_working_dir"], handle);
  expect(explicit.definitions()).toEqual([]);
  expect(explicit.own(`${cormToolPrefix}git__git_set_working_dir`)).toBe(false);
});

test("own distinguishes corm tools from client tools", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read"]));

  expect(tooling.own(`${cormToolPrefix}filesystem__read`)).toBe(true);
  expect(tooling.own("client__thing")).toBe(false);
  expect(tooling.own("read")).toBe(false);
});

test("invoke calls the underlying tool and tracks the pending call", () => {
  const handle = makeToolingHandle("filesystem", ["read"]);
  const tooling = setup(handle);

  const call = tooling.invoke(`${cormToolPrefix}filesystem__read`, {
    path: "/a",
  });

  expect(call).toEqual({
    uuid: "filesystem-call-1",
    exposed: `${cormToolPrefix}filesystem__read`,
    name: "read",
    args: { path: "/a" },
  });
  expect(handle.invoked).toEqual([{ tool: "read", args: { path: "/a" } }]);
  expect(tooling.pending()).toEqual([call]);
});

test("invoke rejects unknown tools", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read"]));

  expect(() => tooling.invoke("nope", {})).toThrow("unknown corm tool nope");
});

test("settle completes a pending call from a tool-result", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read"]));
  const call = tooling.invoke(`${cormToolPrefix}filesystem__read`, {});

  const settled = tooling.settle(
    toolResult(call.uuid, {
      name: "read",
      arguments: {},
      content: [{ type: "text", text: "hi" }],
    }),
  );

  expect(settled?.call).toEqual(call);
  expect(settled?.result?.content).toEqual([{ type: "text", text: "hi" }]);
  expect(tooling.pending()).toEqual([]);
});

test("settle completes a pending call from an error", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read"]));
  const call = tooling.invoke(`${cormToolPrefix}filesystem__read`, {});

  const settled = tooling.settle({
    id: call.uuid,
    kind: "error",
    payload: "boom",
  });

  expect(settled).toEqual({ call, error: "boom" });
  expect(tooling.pending()).toEqual([]);
});

test("settle ignores unrelated events and unknown ids", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read"]));
  const call = tooling.invoke(`${cormToolPrefix}filesystem__read`, {});

  expect(tooling.settle({ id: "x", kind: "timer", payload: null })).toBe(
    undefined,
  );
  expect(
    tooling.settle(
      toolResult("other", { name: "read", arguments: {}, content: [] }),
    ),
  ).toBe(undefined);
  expect(tooling.pending()).toEqual([call]);
});
