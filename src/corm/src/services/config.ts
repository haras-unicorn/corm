import { validateConfig } from "../lib/config";
import { cormConfigKey } from "../lib/keys";
import type { CormLogger } from "../services/logger";
import { type CormConfig, cormConfigZod } from "../types/config";
import type { CormOmw } from "../types/omw";

export interface CormConfigManager {
  load(): CormConfig;
}

export const createCormConfigManager = (logger: CormLogger, omw: CormOmw) =>
  new CormOmwConfigManager(logger, omw) as CormConfigManager;

class CormOmwConfigManager {
  private _logger: CormLogger;
  private _omw: CormOmw;
  private _config?: CormConfig;

  constructor(logger: CormLogger, omw: CormOmw) {
    this._logger = logger;
    this._omw = omw;
    this._config = undefined;
  }

  public load(): CormConfig {
    if (this._config !== undefined) {
      return this._config;
    }

    this._logger.debug("loading corm config");

    const base = this._omw.host.memoryGetAs(cormConfigKey);
    const seed =
      base !== null && typeof base === "object"
        ? { ...(base as Record<string, unknown>) }
        : {};

    for (const key of Object.keys(cormConfigZod.shape)) {
      const value = this._omw.host.memoryGet(`${cormConfigKey}_${key}`);
      if (value !== undefined) {
        this._logger.trace(`config overridden by ${cormConfigKey}_${key}`);
        seed[key] = coerce(value);
      }
    }

    const parsed = cormConfigZod.parse(seed);
    validateConfig(parsed);

    this._logger.debug(
      `loaded corm config model=${parsed.model} contextLength=${parsed.contextLength} prompt=${
        parsed.prompt !== undefined ? "set" : "unset"
      }`,
    );

    this._config = parsed;
    return this._config;
  }
}

const coerce = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};
