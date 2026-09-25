import { createCormLogger } from "corm/lib/log";
import type { CormConfig, CormSubscriptions } from "corm/lib/opaque";
import type { CormContext } from "corm/services/context";
import type { CormHandles, CormNamedTooling } from "corm/services/handles";
import { createCormTooling } from "corm/services/tooling";

export interface FakeHostCounters {
  lifecycle: number;
}

export interface FakeHost {
  host: Host;
  memory: Map<string, string>;
  streamed: { session: string; delta: ChatDelta }[];
  subscribedEndpoints: string[];
  unsubscribedEndpoints: string[];
  counters: FakeHostCounters;
}

export const makeHost = (overrides: Partial<Host> = {}): FakeHost => {
  const memory = new Map<string, string>();
  const streamed: { session: string; delta: ChatDelta }[] = [];
  const subscribedEndpoints: string[] = [];
  const unsubscribedEndpoints: string[] = [];
  const counters: FakeHostCounters = { lifecycle: 0 };

  const host = {
    log: () => {},
    whoami: () => "corm",
    timeNow: () => 0,
    timeFormat: () => "",
    waitUntil: () => "timer",
    waitFor: () => "wake",
    waitCron: () => "cron",
    sleepFor: () => {},
    sleepUntil: () => {},
    sleepCron: () => {},
    cancelTimer: () => {},
    subscribeAgent: () => "agent-sub",
    unsubscribeAgent: () => {},
    subscribeLifecycle: () => {
      counters.lifecycle += 1;
      return "lifecycle-sub";
    },
    unsubscribeLifecycle: () => {},
    sendAgent: () => {},
    recv: () => {
      throw new Error("recv is not faked");
    },
    tryRecv: () => undefined,
    newUuid: () => "uuid",
    base64Encode: () => "",
    base64Decode: () => [],
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
    memorySetAs: (key: string, value: unknown) => {
      memory.set(key, JSON.stringify(value));
    },
    memoryRemove: (key: string) => memory.delete(key),
    subscribeEndpoint: (model: string) => {
      subscribedEndpoints.push(model);
      return `endpoint-sub-${model}`;
    },
    unsubscribeEndpoint: (uuid: string) => {
      unsubscribedEndpoints.push(uuid);
    },
    streamEndpoint: (session: string, delta: ChatDelta) => {
      streamed.push({ session, delta });
    },
    ...overrides,
  } as unknown as Host;

  return {
    host,
    memory,
    streamed,
    subscribedEndpoints,
    unsubscribedEndpoints,
    counters,
  };
};

export interface FakeProvider extends ProviderHandle {
  calls: { model: string; messages: ChatMessage[]; tools: ChatTool[] }[];
  cancelled: string[];
}

export const makeProvider = (
  name: string,
  models: string[] = ["model"],
): FakeProvider => {
  let counter = 0;
  const calls: FakeProvider["calls"] = [];
  const cancelled: string[] = [];

  return {
    name,
    kind: () => "openai",
    listModels: () => models,
    chat: () => {
      throw new Error("blocking chat is banned");
    },
    chatStream: (model: string, messages: ChatMessage[], tools: ChatTool[]) => {
      counter += 1;
      calls.push({ model, messages, tools });
      return `${name}-gen-${counter}`;
    },
    isOpen: () => true,
    cancel: (uuid: string) => {
      cancelled.push(uuid);
    },
    calls,
    cancelled,
  } as unknown as FakeProvider;
};

export interface FakeTooling extends ToolingHandle {
  invoked: { tool: string; args: unknown }[];
}

export const makeToolingHandle = (
  name: string,
  tools: string[],
): FakeTooling => {
  let counter = 0;
  const invoked: { tool: string; args: unknown }[] = [];

  return {
    name,
    kind: () => "mcp",
    listTools: () =>
      tools.map((tool) => ({
        name: tool,
        description: `${tool} tool`,
        inputSchema: {},
      })),
    callTool: (tool: string, args: unknown) => {
      invoked.push({ tool, args });
      counter += 1;
      return `${name}-call-${counter}`;
    },
    isOpen: () => true,
    cancel: () => {},
    callToolBlocking: () => {
      throw new Error("blocking tool calls are banned");
    },
    listResources: () => [],
    readResource: () => {
      throw new Error("no resources");
    },
    subscribeResourceList: () => "",
    unsubscribeResourceList: () => {},
    subscribeResource: () => "",
    unsubscribeResource: () => {},
    invoked,
  } as unknown as FakeTooling;
};

export const makeNamedToolings = (
  toolings: ToolingHandle[],
): CormNamedTooling[] =>
  toolings.map((handle, index) => ({
    name: `t${index}`,
    handle: handle as unknown as CormNamedTooling["handle"],
  }));

export const makeHandles = (options: {
  host: Host;
  providers?: ProviderHandle[];
  toolings?: CormNamedTooling[];
  subscriptions?: CormSubscriptions;
}): CormHandles => {
  const providers = options.providers ?? [];
  const subscriptions = options.subscriptions ?? {
    lifecycle: "lifecycle-sub",
    endpoint: "endpoint-sub",
    model: "corm",
  };

  return {
    host: () => options.host,
    providers: () => providers,
    main: () => providers[0],
    toolings: () => options.toolings ?? [],
    subscriptions: () => subscriptions,
  } as unknown as CormHandles;
};

export const makeContext = (
  handles: CormHandles,
  config: CormConfig = { model: "model" },
): CormContext => ({
  handles,
  config,
  tooling: createCormTooling(handles),
  logger: createCormLogger(handles.host()),
});

export const endpointMessage = (
  session = "s1",
  messages: ChatMessage[] = [{ role: "user", content: "hi" }],
): OmwEvent & { kind: "endpoint-message" } => ({
  id: `event-${session}`,
  kind: "endpoint-message",
  payload: { session, messages, tools: [] },
});

export const chatDelta = (gen: string, payload: ChatDelta): OmwEvent => ({
  id: gen,
  kind: "chat-delta",
  payload,
});

export const chatEnd = (gen: string): OmwEvent => ({
  id: gen,
  kind: "chat-end",
  payload: null,
});

export const timerEvent = (id = "wake"): OmwEvent => ({
  id,
  kind: "timer",
  payload: null,
});

export const toolResult = (id: string, result: ToolResult): OmwEvent => ({
  id,
  kind: "tool-result",
  payload: result,
});
