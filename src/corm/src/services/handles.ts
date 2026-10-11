import type { ArrayTail } from "type-fest";
import { cormToolPrefix } from "../lib/keys";
import type { CormLogger } from "../services/logger";
import type { CormConfig } from "../types/config";
import {
  type CormAnyProviderHandle,
  type CormAnyToolingHandle,
  type CormOmw,
  type CormOmwHost,
  type CormOmwTool,
  type CormProviderHandle,
  type CormProviderName,
  type CormToolingHandle,
  type CormToolingName,
  cormInternalToolingNames,
  cormInternalToolingPrefix,
  cormProviderNames,
  cormToolingNames,
  isCormProviderName,
  isCormToolingName,
} from "../types/omw";

export interface CormHandlesManager {
  load(): CormHandles;
}

type ChatParameters = Parameters<CormAnyProviderHandle["chatStream"]>;
type CallParameters = Parameters<CormAnyToolingHandle["callTool"]>;

export interface CormHandles {
  host(): CormOmwHost;

  chat(...parameters: ChatParameters): string;
  call(...parameters: CallParameters): string;
  cancel(id: string): void;

  tools(): CormOmwTool[];

  provider<T extends CormProviderName>(
    provider: T,
  ): CormProviderHandle<T> | undefined;
  tooling<T extends CormToolingName>(
    tooling: T,
  ): CormToolingHandle<T> | undefined;
}

export const createCormHandlesManager = (
  omw: CormOmw,
  config: CormConfig,
  logger: CormLogger,
) => new CormOmwHandlesManager(omw, config, logger) as CormHandlesManager;

class CormOmwHandlesManager {
  private _omw: CormOmw;
  private _config: CormConfig;
  private _logger: CormLogger;
  private _handles?: CormOmwHandles;

  constructor(omw: CormOmw, config: CormConfig, logger: CormLogger) {
    this._omw = omw;
    this._config = config;
    this._logger = logger;
    this._handles = undefined;
  }

  public load(): CormHandles {
    this._handles ??= new CormOmwHandles(this._omw, this._config, this._logger);
    return this._handles;
  }
}

class CormOmwHandles {
  private _omw: CormOmw;
  private _logger: CormLogger;

  private _providers: CormAnyProviderHandle[];
  private _toolings: CormAnyToolingHandle[];
  private _tools: CormOmwTool[];

  constructor(omw: CormOmw, config: CormConfig, logger: CormLogger) {
    this._omw = omw;
    this._logger = logger;

    this._providers = (config.providers ?? cormProviderNames)
      .filter(isCormProviderName)
      .map((name) => this._get(() => this._omw.provider.get(name)))
      .filter((provider) => provider !== undefined);

    if (!this._providers.length) {
      throw new Error("at least one provider must be configured");
    }

    const toolingNames = [
      ...new Set([
        ...cormInternalToolingNames,
        ...(config.toolings ?? cormToolingNames),
      ]),
    ];
    this._toolings = toolingNames
      .filter(isCormToolingName)
      .map((name) => this._get(() => this._omw.tooling.get(name)))
      .filter((tooling) => tooling !== undefined);

    this._tools = this._toolings
      .filter((tooling) => !tooling.name.startsWith(cormInternalToolingPrefix))
      .flatMap((tooling) =>
        tooling.listTools().map((tool) => ({
          ...tool,
          name: `${cormToolPrefix}${tooling.name}__${tool.name}`,
        })),
      );

    this._logger.debug("handles loaded");
  }

  public host(): CormOmwHost {
    return this._omw.host;
  }

  public chat(...parameters: ChatParameters): string {
    const provider = this._chatProvider();
    if (provider === undefined) {
      throw new Error("no provider available");
    }

    return provider.chatStream(...parameters);
  }

  public call(...parameters: CallParameters): string {
    const [tool, ...rest] = parameters;
    const name = tool.startsWith(cormToolPrefix)
      ? tool.slice(cormToolPrefix.length)
      : tool;
    const [toolingName, toolName] = name.split("__");
    const tooling = this._toolings.find((entry) => entry.name === toolingName);
    if (tooling === undefined) {
      throw new Error(`no tooling ${toolingName}`);
    }

    return tooling.callTool(toolName, ...(rest as ArrayTail<CallParameters>));
  }

  public cancel(id: string): void {
    for (const provider of this._providers) {
      if (provider.isOpen(id)) {
        provider.cancel(id);
        this._logger.debug(
          `cancelled generation ${id} of ${provider.name} provider`,
        );
        return;
      }
    }

    for (const tooling of this._toolings) {
      if (tooling.isOpen(id)) {
        tooling.cancel(id);
        this._logger.debug(`cancelled call ${id} of ${tooling.name} tooling`);
        return;
      }
    }

    throw new Error(`could not cancel ${id}`);
  }

  public tools(): CormOmwTool[] {
    return this._tools;
  }

  private _chatProvider(): CormAnyProviderHandle | undefined {
    return (
      this.provider("gpu") ?? this.provider("cpu") ?? this.provider("remote")
    );
  }

  private _get<T>(lookup: () => T): T | undefined {
    try {
      return lookup();
    } catch {
      return undefined;
    }
  }

  public provider<T extends CormProviderName>(
    provider: T,
  ): CormProviderHandle<T> | undefined {
    return this._providers.find(({ name }) => name === provider) as
      | CormProviderHandle<T>
      | undefined;
  }

  public tooling<T extends CormToolingName>(
    tooling: T,
  ): CormToolingHandle<T> | undefined {
    return this._toolings.find(({ name }) => name === tooling) as
      | CormToolingHandle<T>
      | undefined;
  }
}
