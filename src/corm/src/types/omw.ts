export type CormOmwConfig = typeof import("../../e2e/omw.test.base.json");

export type CormOmw = Omw<CormOmwConfig>;

export type CormOmwEvent = OmwEvent;

export type CormOmwHost = CormOmw["host"];

export type CormOmwChatMessage = ChatMessage;

export type CormOmwToolCall = ToolCall;

export type CormOmwTool = ChatTool;

export type CormOmwChatDelta = ChatDelta;

export type CormOmwRole = Role;

export type CormProviderName = keyof CormOmwConfig["providers"] & string;

export type CormToolingName = keyof CormOmwConfig["tooling"] & string;

export type CormAnyProviderHandle = ProviderHandle<
  CormOmwConfig["providers"][CormProviderName]
>;

export type CormAnyToolingHandle = ToolingHandle<
  CormOmwConfig["tooling"][CormToolingName]
>;

export type CormProviderHandle<TName extends CormProviderName> = ProviderHandle<
  CormOmwConfig["providers"][TName]
>;

export type CormToolingHandle<TName extends CormToolingName> = ToolingHandle<
  CormOmwConfig["tooling"][TName]
>;

export const cormToolingNames = [
  "nixos",
  "nix",
  "git",
  "github",
  "rss",
  "plan",
  "filesystem",
] as const satisfies readonly CormToolingName[];

export const cormInternalToolingPrefix = "internal-";

export const cormInternalToolingNames = [
  "internal-filesystem",
] as const satisfies readonly CormToolingName[];

export const cormProviderNames = [
  "gpu",
  "remote",
  "cpu",
] as const satisfies readonly CormProviderName[];

export const isCormProviderName = (name: string): name is CormProviderName =>
  (cormProviderNames as readonly string[]).includes(name);

export const isCormToolingName = (name: string): name is CormToolingName =>
  (
    [...cormToolingNames, ...cormInternalToolingNames] as readonly string[]
  ).includes(name);
