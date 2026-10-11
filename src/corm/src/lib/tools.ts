import type { CormConfig } from "../types/config";
import type { CormOmwTool } from "../types/omw";
import disabledTools from "./disabled-tools.json";
import { cormToolPrefix } from "./keys";

const blockText = (block: unknown): string | undefined => {
  if (
    block != null &&
    typeof block === "object" &&
    "text" in block &&
    typeof (block as { text?: unknown }).text === "string"
  ) {
    return (block as { text: string }).text;
  }

  return undefined;
};

const structuredText = (result: ToolResult): string | undefined => {
  if (result.structuredContent === undefined) {
    return undefined;
  }

  const structured = result.structuredContent as { content?: unknown };
  return typeof structured?.content === "string"
    ? structured.content
    : undefined;
};

export const contentText = (result: ToolResult): string | undefined => {
  const structured = structuredText(result);
  if (structured !== undefined) {
    return structured;
  }

  const content = result.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    for (const block of content) {
      const text = blockText(block);
      if (text !== undefined) {
        return text;
      }
    }
  }

  return undefined;
};

export const toolResultText = (result: ToolResult | undefined): string => {
  if (result === undefined) {
    return "";
  }

  const structured = structuredText(result);
  if (structured !== undefined) {
    return structured;
  }

  const content = result.content;
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map(blockText)
      .filter((text): text is string => text !== undefined);
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  return JSON.stringify(result.content ?? result.structuredContent ?? "");
};

// The bare `<tooling>__<tool>` form of a `corm__<tooling>__<tool>` handle name,
// which is how `config.tools` and `disabled-tools.json` are written.
const bareToolName = (name: string): string =>
  name.startsWith(cormToolPrefix) ? name.slice(cormToolPrefix.length) : name;

// The tools the model may call: the handles' tools minus the always-disabled
// list, further restricted to the `config.tools` subset when it is set (an
// absent subset exposes everything, an empty one exposes nothing).
export const cormTools = (
  tools: CormOmwTool[],
  config: CormConfig,
): CormOmwTool[] => {
  const enabled = config.tools;

  return tools.filter((tool) => {
    const bare = bareToolName(tool.name);
    if (disabledTools.includes(bare)) {
      return false;
    }

    return enabled === undefined || enabled.includes(bare);
  });
};

export const mergeToolCalls = (
  previous: ToolCall | undefined,
  next: ToolCall | undefined,
): ToolCall | undefined => {
  if (previous) {
    if (next) {
      if (previous.id !== next.id) {
        throw new Error(
          `tried mixing tool call '${previous.name}' '${previous.id}'` +
            ` with '${next.name}' '${next.id}'`,
        );
      }

      previous.arguments = mergeToolArguments(
        previous.arguments,
        next.arguments,
      );
    }

    return previous;
  }

  return next;
};

// omw re-sends the reassembled tool-call arguments on every delta, so the common
// case is cumulative (`next` extends `previous`); a provider may instead stream
// non-overlapping fragments. Replace on the overlapping case and concatenate
// otherwise, mirroring the endpoint's reassembly.
export const mergeToolArguments = (
  previous: unknown,
  next: unknown,
): unknown => {
  if (typeof previous === "string" && typeof next === "string") {
    return next.startsWith(previous) ? next : previous + next;
  }

  return next;
};
