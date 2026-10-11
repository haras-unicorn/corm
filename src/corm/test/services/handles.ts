import { createCormHandlesManager } from "corm/services/handles";
import { createCormLogger } from "corm/services/logger";
import type { CormConfig } from "corm/types/config";
import { expect, test } from "vitest";
import {
  baseConfig,
  makeHost,
  makeOmw,
  makeProvider,
  makeTooling,
} from "../common";

const setup = (
  options: Parameters<typeof makeOmw>[0],
  config: Partial<CormConfig> = {},
) => {
  const { host } = makeHost();
  const omw = makeOmw({ host, ...options });
  return createCormHandlesManager(
    omw,
    baseConfig(config),
    createCormLogger(host),
  ).load();
};

test("at least one provider is required", () => {
  expect(() => setup({})).toThrow("at least one provider");
});

test("missing providers are filtered out", () => {
  const handles = setup({ providers: { cpu: makeProvider("cpu") } });

  expect(handles.chat("model", [], [])).toBe("cpu-gen-1");
});

test("only the providers named in the config are probed", () => {
  const handles = setup(
    { providers: { gpu: makeProvider("gpu"), cpu: makeProvider("cpu") } },
    { providers: ["gpu"] },
  );

  expect(handles.provider("gpu")).toBeDefined();
  expect(handles.provider("cpu")).toBeUndefined();
});

test("an empty provider list still requires a provider", () => {
  expect(() =>
    setup({ providers: { gpu: makeProvider("gpu") } }, { providers: [] }),
  ).toThrow("at least one provider");
});

test("chat prefers gpu over cpu", () => {
  const handles = setup({
    providers: { gpu: makeProvider("gpu"), cpu: makeProvider("cpu") },
  });

  expect(handles.chat("model", [], [])).toBe("gpu-gen-1");
});

test("chat prefers cpu over remote", () => {
  const handles = setup({
    providers: { cpu: makeProvider("cpu"), remote: makeProvider("remote") },
  });

  expect(handles.chat("model", [], [])).toBe("cpu-gen-1");
});

test("chat falls back to remote", () => {
  const handles = setup({ providers: { remote: makeProvider("remote") } });

  expect(handles.chat("model", [], [])).toBe("remote-gen-1");
});

test("tools are exposed under the corm__<tooling>__<tool> name", () => {
  const handles = setup({
    providers: { cpu: makeProvider("cpu") },
    toolings: { filesystem: makeTooling("filesystem", ["read", "write"]) },
  });

  expect(handles.tools().map((tool) => tool.name)).toEqual([
    "corm__filesystem__read",
    "corm__filesystem__write",
  ]);
});

test("only the toolings named in the config are probed", () => {
  const handles = setup(
    {
      providers: { gpu: makeProvider("gpu") },
      toolings: {
        filesystem: makeTooling("filesystem", ["read"]),
        git: makeTooling("git", ["status"]),
      },
    },
    { toolings: ["filesystem"] },
  );

  expect(handles.tooling("filesystem")).toBeDefined();
  expect(handles.tooling("git")).toBeUndefined();
});

test("tooling returns undefined when the named tooling is absent", () => {
  const handles = setup({ providers: { gpu: makeProvider("gpu") } });

  expect(handles.tooling("filesystem")).toBeUndefined();
});

test("internal toolings are always probed but hidden from the model", () => {
  const handles = setup({
    providers: { gpu: makeProvider("gpu") },
    toolings: {
      "internal-filesystem": makeTooling("internal-filesystem", [
        "read_text_file",
      ]),
      filesystem: makeTooling("filesystem", ["read"]),
    },
  });

  expect(handles.tooling("internal-filesystem")).toBeDefined();
  expect(handles.tools().map((tool) => tool.name)).toEqual([
    "corm__filesystem__read",
  ]);
});

test("internal toolings are probed even with no configured toolings", () => {
  const handles = setup(
    {
      providers: { gpu: makeProvider("gpu") },
      toolings: {
        "internal-filesystem": makeTooling("internal-filesystem", ["read"]),
      },
    },
    { toolings: [] },
  );

  expect(handles.tooling("internal-filesystem")).toBeDefined();
  expect(handles.tools()).toEqual([]);
});

test("call strips the corm__ prefix and delegates to the owning tooling", () => {
  const invoked: { tool: string; args: unknown }[] = [];
  const filesystem = {
    ...makeTooling("filesystem", ["echo"]),
    callTool: (tool: string, args: unknown) => {
      invoked.push({ tool, args });
      return "uuid";
    },
  } as unknown as ToolingHandle;

  const handles = setup({
    providers: { cpu: makeProvider("cpu") },
    toolings: { filesystem },
  });

  handles.call("corm__filesystem__echo", '{"in":"hi"}');

  expect(invoked).toEqual([{ tool: "echo", args: '{"in":"hi"}' }]);
});

test("cancel closes the open generation on the owning provider", () => {
  const cancelled: string[] = [];
  const gpu = {
    ...makeProvider("gpu"),
    isOpen: (id: string) => id === "gen-1",
    cancel: (id: string) => {
      cancelled.push(id);
    },
  } as unknown as ProviderHandle;

  const handles = setup({ providers: { gpu } });
  handles.cancel("gen-1");

  expect(cancelled).toEqual(["gen-1"]);
});
