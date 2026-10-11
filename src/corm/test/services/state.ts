import { frame } from "corm/lib/framing";
import { cormStateFile, cormStateKey } from "corm/lib/keys";
import type { CormOmw } from "corm/lib/omw";
import type { CormConfig } from "corm/lib/opaque";
import { combinedRuntimePrompts } from "corm/lib/registry";
import { createCormStateManager } from "corm/services/state";
import { createCormWindow } from "corm/services/window";
import { expect, test } from "vitest";

const config: CormConfig = { model: "model", contextLength: 131072 };
const windowOf = () => createCormWindow(config);
const runtimePrompt = (): ChatMessage => ({
  role: "system",
  content: combinedRuntimePrompts(config).join("\n\n"),
});
const emptyState = '{"pending":[],"immediate":[]}';
const emptyWindow = {
  messages: [],
  sources: {},
  digests: {},
  receipts: [],
  epoch: 0,
};

function makeOmw(
  options: {
    memory?: string;
    read?: string;
    readThrows?: boolean;
    noFilesystem?: boolean;
  } = {},
) {
  const memory = new Map<string, string>();
  if (options.memory !== undefined) {
    memory.set(cormStateKey, options.memory);
  }

  const writes: { tool: string; args: unknown }[] = [];
  let reads = 0;

  const filesystem = {
    callToolBlocking: (tool: string, args: unknown) => {
      if (tool === "read_text_file") {
        reads += 1;
        if (options.readThrows) {
          throw new Error("missing file");
        }
        return {
          name: tool,
          arguments: args,
          content: [{ type: "text", text: options.read ?? "" }],
        };
      }
      writes.push({ tool, args });
      return { name: tool, arguments: args, content: [] };
    },
  };

  const omw = {
    host: {
      log: () => {},
      memoryGet: (key: string) => memory.get(key),
      memorySet: (key: string, value: string) => memory.set(key, value),
    },
    tooling: {
      get: (name: string) => {
        if (options.noFilesystem || name !== "filesystem") {
          throw new Error(`no tooling ${name}`);
        }
        return filesystem;
      },
    },
  } as unknown as CormOmw;

  return { omw, memory, writes, reads: () => reads };
}

test("load prefers the memory value and skips the filesystem", () => {
  const { omw, reads } = makeOmw({ memory: emptyState, readThrows: true });
  const manager = createCormStateManager(omw, windowOf());

  expect(manager.load()).toEqual({ pending: [], immediate: [] });
  expect(reads()).toBe(0);
});

test("load recovers from the filesystem when memory is empty", () => {
  const { omw, reads } = makeOmw({ read: emptyState });
  const manager = createCormStateManager(omw, windowOf());

  expect(manager.load()).toEqual({ pending: [], immediate: [] });
  expect(reads()).toBe(1);
});

test("load falls back to an empty state", () => {
  const { omw } = makeOmw({ noFilesystem: true });
  const manager = createCormStateManager(omw, windowOf());

  expect(manager.load()).toEqual({ pending: [], immediate: [] });
});

test("load restores the persisted window", () => {
  const window = windowOf();
  const saved = {
    pending: [],
    immediate: [],
    window: {
      messages: [{ role: "user", content: "hi" }],
      sources: { s1: { count: 1, last: "{}" } },
      epoch: 0,
    },
  };
  const { omw } = makeOmw({ memory: JSON.stringify(saved) });
  const manager = createCormStateManager(omw, window);

  manager.load();

  expect(window.input()).toEqual([
    runtimePrompt(),
    { role: "user", content: "hi" },
  ]);
});

test("load ignores a bad window but keeps the tasks", () => {
  const window = windowOf();
  const saved = { pending: [], immediate: [], window: "nonsense" };
  const { omw } = makeOmw({ memory: JSON.stringify(saved) });
  const manager = createCormStateManager(omw, window);

  expect(manager.load()).toEqual(saved);
  expect(window.input()).toEqual([runtimePrompt()]);
});

test("release persists state to memory on reload", () => {
  const { omw, memory } = makeOmw({ readThrows: true });
  const manager = createCormStateManager(omw, windowOf());

  manager.load();
  manager.release({ id: "r", kind: "reload", payload: null });

  expect(JSON.parse(memory.get(cormStateKey) as string)).toEqual({
    pending: [],
    immediate: [],
    window: emptyWindow,
  });
});

test("release persists state to the filesystem on shutdown", () => {
  const { omw, writes } = makeOmw({ readThrows: true });
  const manager = createCormStateManager(omw, windowOf());

  manager.load();
  manager.release({ id: "s", kind: "shutdown", payload: null });

  expect(writes).toEqual([
    {
      tool: "write_file",
      args: {
        path: cormStateFile,
        content: JSON.stringify({
          pending: [],
          immediate: [],
          window: emptyWindow,
        }),
      },
    },
  ]);
});

test("release snapshots the window and load restores it", () => {
  const window = windowOf();
  window.ingest("s1", [{ role: "user", content: "hi" }]);

  const first = makeOmw({ readThrows: true });
  const firstManager = createCormStateManager(first.omw, window);
  firstManager.load();
  firstManager.release({ id: "r", kind: "reload", payload: null });

  const restoredWindow = windowOf();
  const second = makeOmw({
    memory: first.memory.get(cormStateKey) as string,
  });
  const secondManager = createCormStateManager(second.omw, restoredWindow);
  secondManager.load();

  expect(restoredWindow.input()).toEqual([
    runtimePrompt(),
    { role: "user", content: frame("client", "hi") },
  ]);
});

test("release before load does nothing", () => {
  const { omw, writes, memory } = makeOmw({ readThrows: true });
  const manager = createCormStateManager(omw, windowOf());

  manager.release({ id: "r", kind: "reload", payload: null });

  expect(writes).toEqual([]);
  expect(memory.size).toBe(0);
});
