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

// A tool result that reports a failure back to the model (an errored call or a
// call corm cannot serve). It carries the raw message; `appendToolResult` adds
// the tool name and call id so the model can attribute the failure.
export const errorToolResult = (
  name: string,
  arguments_: unknown,
  message: string,
): ToolResult => ({
  name,
  arguments: arguments_,
  content: [{ type: "text", text: message }],
  isError: true,
});

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
export const bareToolName = (name: string): string =>
  name.startsWith(cormToolPrefix) ? name.slice(cormToolPrefix.length) : name;

// Tools whose results have no argument that caps their output size. Their
// results bypass `messageTokenLimit` by default (via `noTruncateTools`) and,
// when an operator opts one back into truncation, get the fixed-output hint.
export const cormFixedOutputTools: readonly string[] = [
  // filesystem
  "filesystem__edit_file",
  "filesystem__list_directory",
  "filesystem__list_directory_with_sizes",
  "filesystem__read_media_file",
  "filesystem__read_multiple_files",

  // git
  "git__git_add",
  "git__git_checkout",
  "git__git_cherry_pick",
  "git__git_clean",
  "git__git_commit",
  "git__git_fetch",
  "git__git_merge",
  "git__git_pull",
  "git__git_push",
  "git__git_rebase",
  "git__git_remote",
  "git__git_reset",
  "git__git_wrapup_instructions",
  "git__git_worktree",

  // github
  "github__actions_get",
  "github__get_discussion",
  "github__get_file_contents",
  "github__get_latest_release",
  "github__get_me",
  "github__get_notification_details",
  "github__get_release_by_tag",
  "github__get_tag",
  "github__get_team_members",
  "github__get_teams",
  "github__issue_read",
  "github__list_label",
  "github__projects_get",
  "github__pull_request_read",

  // nix
  "nix__nix_check",

  // plan
  "plan__children",
  "plan__complete",
  "plan__escalate",
  "plan__fail",
  "plan__queue",
  "plan__ready",
  "plan__source",
  "plan__sources",
  "plan__task",

  // rss
  "rss__fetch_article",
  "rss__get_articles",
];

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

// Fold one delta's tool-call fragments into the accumulated calls. A fragment
// carries an `index`; `id` and `name` arrive on the call's first fragment and
// `arguments` is a raw JSON fragment to concatenate across every fragment that
// shares the index.
export const foldToolCalls = (
  previous: ToolCall[] | undefined,
  fragments: ToolCallDelta[] | undefined,
): ToolCall[] => {
  if (fragments === undefined || fragments.length === 0) {
    return previous ?? [];
  }

  const calls = [...(previous ?? [])];
  for (const fragment of fragments) {
    const existing = calls[fragment.index];
    calls[fragment.index] = {
      id: fragment.id ?? existing?.id ?? "",
      name: fragment.name ?? existing?.name ?? "",
      arguments: mergeToolArguments(existing?.arguments, fragment.arguments),
    };
  }

  return calls.filter((call): call is ToolCall => call !== undefined);
};

// omw hands a fragment over either as its raw string or, when the fragment is
// valid JSON on its own (a whole number, boolean, object, ...), as the parsed
// value. Recover the wire text either way: `JSON.stringify` of a parsed value is
// exactly the fragment's JSON, so it can still be concatenated in order.
const fragmentText = (fragment: unknown): string => {
  if (fragment === undefined) {
    return "";
  }

  if (typeof fragment === "string") {
    return fragment;
  }

  const text = JSON.stringify(fragment);
  return text === undefined ? "" : text;
};

// A wire tool-call fragment is raw and non-overlapping, so the reconstructed
// arguments are the concatenation of the fragments' JSON in order. Always
// returns text; a call with no argument fragments stores "".
export const mergeToolArguments = (previous: unknown, next: unknown): string =>
  fragmentText(previous) + fragmentText(next);

// Parse the reconstructed argument text into the value `callTool` expects (omw
// serializes whatever value it is given, so a string would be double-encoded).
// Empty or malformed text becomes `{}` so the call still carries an argument
// object.
export const parseToolArguments = (arguments_: unknown): unknown => {
  if (typeof arguments_ !== "string") {
    return arguments_ ?? {};
  }

  const text = arguments_.trim();
  if (text === "") {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};
