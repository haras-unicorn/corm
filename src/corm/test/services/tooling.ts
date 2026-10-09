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

test("definitions expose every tool under the corm prefix", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read", "write"]));

  expect(tooling.definitions()).toEqual([
    {
      name: `${cormToolPrefix}read`,
      description: "read tool",
      inputSchema: {},
      outputSchema: undefined,
    },
    {
      name: `${cormToolPrefix}write`,
      description: "write tool",
      inputSchema: {},
      outputSchema: undefined,
    },
  ]);
});

test("own distinguishes corm tools from client tools", () => {
  const tooling = setup(makeToolingHandle("filesystem", ["read"]));

  expect(tooling.own(`${cormToolPrefix}read`)).toBe(true);
  expect(tooling.own("client__thing")).toBe(false);
  expect(tooling.own("read")).toBe(false);
});

test("invoke calls the underlying tool and tracks the pending call", () => {
  const handle = makeToolingHandle("filesystem", ["read"]);
  const tooling = setup(handle);

  const call = tooling.invoke(`${cormToolPrefix}read`, { path: "/a" });

  expect(call).toEqual({
    uuid: "filesystem-call-1",
    exposed: `${cormToolPrefix}read`,
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
  const call = tooling.invoke(`${cormToolPrefix}read`, {});

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
  const call = tooling.invoke(`${cormToolPrefix}read`, {});

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
  const call = tooling.invoke(`${cormToolPrefix}read`, {});

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
