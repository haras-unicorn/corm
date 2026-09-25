import { cormStateFile, cormStateKey } from "corm/lib/keys";
import type { CormOmw } from "corm/lib/omw";
import { createCormStateManager } from "corm/services/state";
import { expect, test } from "vitest";

const emptyState = '{"pending":[],"immediate":[]}';

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
  const manager = createCormStateManager(omw);

  expect(manager.load()).toEqual({ pending: [], immediate: [] });
  expect(reads()).toBe(0);
});

test("load recovers from the filesystem when memory is empty", () => {
  const { omw, reads } = makeOmw({ read: emptyState });
  const manager = createCormStateManager(omw);

  expect(manager.load()).toEqual({ pending: [], immediate: [] });
  expect(reads()).toBe(1);
});

test("load falls back to an empty state", () => {
  const { omw } = makeOmw({ noFilesystem: true });
  const manager = createCormStateManager(omw);

  expect(manager.load()).toEqual({ pending: [], immediate: [] });
});

test("release persists state to memory on reload", () => {
  const { omw, memory } = makeOmw({ readThrows: true });
  const manager = createCormStateManager(omw);

  manager.load();
  manager.release({ id: "r", kind: "reload", payload: null });

  expect(memory.get(cormStateKey)).toBe(emptyState);
});

test("release persists state to the filesystem on shutdown", () => {
  const { omw, writes } = makeOmw({ readThrows: true });
  const manager = createCormStateManager(omw);

  manager.load();
  manager.release({ id: "s", kind: "shutdown", payload: null });

  expect(writes).toEqual([
    {
      tool: "write_file",
      args: { path: cormStateFile, content: emptyState },
    },
  ]);
});

test("release before load does nothing", () => {
  const { omw, writes, memory } = makeOmw({ readThrows: true });
  const manager = createCormStateManager(omw);

  manager.release({ id: "r", kind: "reload", payload: null });

  expect(writes).toEqual([]);
  expect(memory.size).toBe(0);
});
