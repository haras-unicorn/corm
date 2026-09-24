const PROVIDER_NAMES = ["gpu", "cpu", "openrouter"];
const TOOLING_NAMES = [
  "nixos",
  "nix",
  "git",
  "github",
  "rss",
  "plan",
  "filesystem",
];
const MAX_TOOL_ITERATIONS = 32;

interface ToolSet {
  tools: ChatTool[];
  owners: Map<string, ToolingHandle>;
}

export type Responder = (messages: ChatMessage[]) => string;

function getProvider(name: string): ProviderHandle | undefined {
  try {
    return omw.provider.get(name);
  } catch (error) {
    omw.host.log("warn", `provider "${name}" unavailable: ${String(error)}`);
    return undefined;
  }
}

export function collectTools(): ToolSet {
  const tools: ChatTool[] = [];
  const owners = new Map<string, ToolingHandle>();

  for (const name of TOOLING_NAMES) {
    let handle: ToolingHandle;
    try {
      handle = omw.tooling.get(name);
    } catch (error) {
      omw.host.log("warn", `tooling "${name}" unavailable: ${String(error)}`);
      continue;
    }

    let listed: Tool[];
    try {
      listed = handle.listTools();
    } catch (error) {
      omw.host.log(
        "warn",
        `tooling "${name}" listTools failed: ${String(error)}`,
      );
      continue;
    }

    for (const tool of listed) {
      if (owners.has(tool.name)) {
        omw.host.log("warn", `duplicate tool "${tool.name}" on "${name}"`);
        continue;
      }
      owners.set(tool.name, handle);
      tools.push({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      });
    }
  }

  return { tools, owners };
}

function runTool(set: ToolSet, call: ToolCall): string {
  const owner = set.owners.get(call.name);
  if (owner === undefined) {
    return `error: no tool named "${call.name}"`;
  }

  let args: unknown = call.arguments;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    args = call.arguments;
  }

  try {
    return owner.callToolBlocking(call.name, args).value;
  } catch (error) {
    return `error: ${String(error)}`;
  }
}

function converse(
  handle: ProviderHandle,
  messages: ChatMessage[],
  set: ToolSet,
): string {
  const history = messages.map((message) => ({ ...message }));
  const model = handle.listModels()[0];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const reply = handle.chat(model, history, set.tools);
    const calls = reply.tool_calls ?? [];

    if (calls.length === 0) {
      return reply.content ?? "";
    }

    for (const call of calls) {
      history.push({ role: "assistant", tool_call: call });
      history.push({ role: "tool", content: runTool(set, call) });
    }
  }

  omw.host.log("warn", `tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations`);
  return "[stopped after too many tool calls]";
}

export function createResponder(set: ToolSet): Responder {
  const providers: ProviderHandle[] = [];
  for (const name of PROVIDER_NAMES) {
    const handle = getProvider(name);
    if (handle !== undefined) {
      providers.push(handle);
    }
  }

  return (messages) => {
    if (providers.length === 0) {
      return "No providers are configured.";
    }

    let lastError = "";
    for (const handle of providers) {
      try {
        return converse(handle, messages, set);
      } catch (error) {
        lastError = String(error);
        omw.host.log("warn", `provider "${handle.name}" failed: ${lastError}`);
      }
    }

    return `All providers failed. Last error: ${lastError}`;
  };
}
