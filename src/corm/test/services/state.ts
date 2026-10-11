import {
  CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
} from "corm/lib/defaults";
import {
  cormStateFile,
  cormStateKey,
  cormSubscriptionsKey,
} from "corm/lib/keys";
import type { CormHandles } from "corm/services/handles";
import { createCormLogger } from "corm/services/logger";
import { createCormStateManager } from "corm/services/state";
import { expect, test } from "vitest";
import { baseConfig, makeHost } from "../common";

const makeManager = (
  options: {
    memory?: [string, string][];
    read?: string;
    noFilesystem?: boolean;
    tools?: ChatTool[];
    config?: ReturnType<typeof baseConfig>;
  } = {},
) => {
  const fake = makeHost();
  for (const [key, value] of options.memory ?? []) {
    fake.memory.set(key, value);
  }

  const writes: { tool: string; args: unknown }[] = [];
  const filesystem = {
    callToolBlocking: (tool: string, args: unknown) => {
      if (tool === "read_text_file") {
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

  const handles = {
    host: () => fake.host,
    tools: () => options.tools ?? [],
    tooling: (name: string) => {
      if (options.noFilesystem || name !== "internal-filesystem") {
        return undefined;
      }
      return filesystem;
    },
  } as unknown as CormHandles;

  const manager = createCormStateManager(
    createCormLogger(fake.host),
    handles,
    options.config ?? baseConfig(),
  );

  return { manager, fake, writes };
};

test("load creates and stores subscriptions for the model", () => {
  const { manager, fake } = makeManager();

  const state = manager.load();

  expect(state.memory.subscriptions).toEqual({
    lifecycle: "lifecycle-sub",
    endpoint: "endpoint-sub-corm",
    generation: undefined,
  });
  expect(fake.counters.lifecycle).toBe(1);
  expect(fake.subscribedEndpoints).toEqual(["corm"]);
});

test("load reuses stored subscriptions", () => {
  const { manager, fake } = makeManager({
    memory: [
      [
        cormSubscriptionsKey,
        JSON.stringify({
          subscriptions: {
            lifecycle: "stored-lifecycle",
            endpoint: "stored-endpoint",
          },
        }),
      ],
    ],
  });

  manager.load();

  expect(fake.counters.lifecycle).toBe(0);
});

test("load defaults the window with the combined system prompt", () => {
  const { manager } = makeManager();
  const state = manager.load();

  expect(state.disk.window.active).toEqual([]);
  expect(state.disk.window.session).toBe("");
  expect(
    state.disk.window.system.content.startsWith(
      CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
    ),
  ).toBe(true);
  expect(state.disk.window.system.content).toContain(
    CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  );
});

test("load restores a persisted disk state but resets the window system and turn", () => {
  const saved = {
    inbox: [],
    window: {
      system: {
        message: { role: "system", content: "stored" },
        role: "system",
        content: "stored",
        digest: "d",
        chars: 6,
        tokens: 6,
      },
      active: [],
      session: "s",
    },
    turn: { summary: "partial", awaiting: {} },
  };
  const { manager } = makeManager({
    memory: [[cormStateKey, JSON.stringify(saved)]],
  });

  const state = manager.load();

  expect(state.disk.window.session).toBe("s");
  expect(state.disk.turn.summary).toBeUndefined();
  expect(state.disk.turn.awaiting).toEqual({});
  expect(state.disk.window.system.content).toBe(
    CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT +
      "\n\n" +
      CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  );
});

test("release persists disk and subscriptions to memory on reload", () => {
  const { manager, fake } = makeManager();
  manager.load();
  manager.release({ id: "r", kind: "reload", payload: null });

  expect(fake.memory.has(cormStateKey)).toBe(true);
});

test("release persists the disk state to the filesystem on shutdown", () => {
  const { manager, writes } = makeManager();
  manager.load();
  manager.release({ id: "s", kind: "shutdown", payload: null });

  expect(writes).toHaveLength(1);
  expect(writes[0].tool).toBe("write_file");
  expect((writes[0].args as { path: string }).path).toBe(cormStateFile);
});

test("load recovers the disk state from the filesystem when memory is empty", () => {
  const saved = {
    inbox: [],
    window: { active: [], session: "recovered" },
    turn: {},
  };
  const { manager } = makeManager({ read: JSON.stringify(saved) });

  const state = manager.load();

  expect(state.disk.window.session).toBe("recovered");
});

test("load recreates subscriptions when the stored ones are malformed", () => {
  const { manager, fake } = makeManager({
    memory: [[cormSubscriptionsKey, "not json"]],
  });

  manager.load();

  expect(fake.counters.lifecycle).toBe(1);
});

test("load recomputes the derived fields of restored messages", () => {
  const saved = {
    inbox: [],
    window: {
      active: [
        {
          message: { role: "user", content: "⟦client⟧\n\nhi" },
          role: "user",
          tag: "client",
        },
      ],
    },
  };
  const { manager } = makeManager({
    memory: [[cormStateKey, JSON.stringify(saved)]],
  });

  const state = manager.load();

  expect(state.disk.window.active[0]?.digest).not.toBe("");
  expect(state.disk.window.active[0]?.tokens).toBeGreaterThan(0);
});

test("load filters the window tools by the configured subset and disabled list", () => {
  const config = baseConfig({ tools: ["filesystem__echo"] });
  const { manager } = makeManager({
    config,
    tools: [
      { name: "corm__filesystem__echo" } as ChatTool,
      { name: "corm__filesystem__read_file" } as ChatTool,
      { name: "corm__git__git_status" } as ChatTool,
    ],
  });

  const state = manager.load();

  expect(state.disk.window.tools.map((tool) => tool.name)).toEqual([
    "corm__filesystem__echo",
  ]);
});

test("load skips filesystem recovery when the tooling is unavailable", () => {
  const { manager } = makeManager({ noFilesystem: true });

  const state = manager.load();

  expect(state.disk.window.session).toBe("");
});
