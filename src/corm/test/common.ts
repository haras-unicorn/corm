import type { CormHandles } from "corm/services/handles";
import type { CormConfig } from "corm/types/config";
import type { CormOmw } from "corm/types/omw";
import { type CormState, defaultDisk } from "corm/types/state";

export const baseConfig = (
  overrides: Partial<CormConfig> = {},
): CormConfig => ({
  model: "model",
  contextLength: 131072,
  ...overrides,
});

export interface FakeHostCounters {
  lifecycle: number;
}

export interface FakeHost {
  host: Host;
  memory: Map<string, string>;
  streamed: { session: string; delta: ChatDelta }[];
  subscribedEndpoints: string[];
  counters: FakeHostCounters;
}

export const makeHost = (overrides: Partial<Host> = {}): FakeHost => {
  const memory = new Map<string, string>();
  const streamed: { session: string; delta: ChatDelta }[] = [];
  const subscribedEndpoints: string[] = [];
  const counters: FakeHostCounters = { lifecycle: 0 };
  let uuids = 0;
  const now = 1_000_000;

  const host = {
    timeNow: () => now,
    timeFormat: () => "",
    waitCron: (spec: string) => `timer-${spec}`,
    waitFor: (ms: number) => `timer-${ms}`,
    waitUntil: (ts: number) => `timer-${ts}`,
    cancelTimer: () => {},
    newUuid: () => {
      uuids += 1;
      return `uuid-${uuids}`;
    },
    log: () => {},
    whoami: () => "corm",
    memoryGet: (key: string) => memory.get(key),
    memoryGetAs: (key: string) => {
      const value = memory.get(key);
      if (value === undefined) {
        return undefined;
      }
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    },
    memorySet: (key: string, value: string) => {
      memory.set(key, value);
    },
    memoryRemove: (key: string) => memory.delete(key),
    subscribeLifecycle: () => {
      counters.lifecycle += 1;
      return "lifecycle-sub";
    },
    unsubscribeLifecycle: () => {},
    subscribeEndpoint: (model: string) => {
      subscribedEndpoints.push(model);
      return `endpoint-sub-${model}`;
    },
    unsubscribeEndpoint: () => {},
    streamEndpoint: (session: string, delta: ChatDelta) => {
      streamed.push({ session, delta });
    },
    ...overrides,
  } as unknown as Host;

  return { host, memory, streamed, subscribedEndpoints, counters };
};

export const makeProvider = (
  name: string,
  models: string[] = ["model"],
): ProviderHandle => {
  let counter = 0;
  return {
    name,
    kind: () => "mock",
    listModels: () => models,
    chat: () => {
      throw new Error("blocking chat is banned");
    },
    chatStream: () => {
      counter += 1;
      return `${name}-gen-${counter}`;
    },
    isOpen: () => true,
    cancel: () => {},
  } as unknown as ProviderHandle;
};

export const makeTooling = (name: string, tools: string[]): ToolingHandle =>
  ({
    name,
    kind: () => "mock",
    listTools: () =>
      tools.map((tool) => ({ name: tool, description: `${tool} tool` })),
    callTool: () => "call-uuid",
    isOpen: () => true,
    cancel: () => {},
  }) as unknown as ToolingHandle;

export const makeOmw = (options: {
  providers?: Record<string, ProviderHandle>;
  toolings?: Record<string, ToolingHandle>;
  host?: Host;
}): CormOmw => {
  const host = options.host ?? makeHost().host;
  return {
    provider: {
      get: (name: string) => {
        const provider = options.providers?.[name];
        if (provider === undefined) {
          throw new Error(`no such provider ${JSON.stringify(name)}`);
        }
        return provider;
      },
    },
    tooling: {
      get: (name: string) => {
        const tooling = options.toolings?.[name];
        if (tooling === undefined) {
          throw new Error(`no such tooling ${JSON.stringify(name)}`);
        }
        return tooling;
      },
    },
    host,
  } as unknown as CormOmw;
};

export interface FakeHandles {
  handles: CormHandles;
  chat: {
    model: string;
    messages: ChatMessage[];
    tools: ChatTool[];
    params: unknown;
  }[];
  calls: { name: string; args: unknown }[];
  cancels: string[];
}

export const makeHandles = (
  host: Host,
  tools: ChatTool[] = [],
): FakeHandles => {
  const chat: FakeHandles["chat"] = [];
  const calls: FakeHandles["calls"] = [];
  const cancels: string[] = [];
  let counter = 0;

  const handles = {
    host: () => host,
    chat: (
      model: string,
      messages: ChatMessage[],
      chatTools: ChatTool[],
      params?: unknown,
    ) => {
      chat.push({ model, messages, tools: chatTools, params });
      counter += 1;
      return `gen-${counter}`;
    },
    call: (name: string, args: unknown) => {
      calls.push({ name, args });
      return "call-uuid";
    },
    cancel: (id: string) => {
      cancels.push(id);
    },
    tools: () => tools,
    provider: () => undefined,
    tooling: () => {
      throw new Error("no tooling");
    },
  } as unknown as CormHandles;

  return { handles, chat, calls, cancels };
};

export const makeState = (config: CormConfig = baseConfig()): CormState => ({
  memory: {
    subscriptions: {
      lifecycle: "lifecycle-sub",
      endpoint: "endpoint-sub",
      generation: undefined,
    },
  },
  disk: defaultDisk(config, []),
});

export const endpointMessage = (
  session = "s1",
  messages: ChatMessage[] = [{ role: "user", content: "hi" }],
  params?: unknown,
): OmwEvent & { kind: "endpoint-message" } => ({
  id: `event-${session}`,
  kind: "endpoint-message",
  payload: { session, messages, tools: [], params },
});

export const chatDelta = (id: string, payload: ChatDelta): OmwEvent => ({
  id,
  kind: "chat-delta",
  payload,
});

export const chatEnd = (id: string): OmwEvent => ({
  id,
  kind: "chat-end",
  payload: null,
});

export const toolResultEvent = (
  id: string,
  text = "hi",
): OmwEvent & { kind: "tool-result" } => ({
  id,
  kind: "tool-result",
  payload: {
    name: "echo",
    arguments: {},
    content: [{ type: "text", text }],
    isError: false,
  },
});
