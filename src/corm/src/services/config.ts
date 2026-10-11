import { validateConfig } from "corm/lib/config";
import { cormConfigKey } from "corm/lib/keys";
import type { CormOmw } from "corm/lib/omw";
import { type CormConfig, cormConfigZod } from "corm/lib/opaque";
import { type CormLogger, createCormLogger } from "corm/services/logger";

const coerce = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export interface CormConfigManager {
  load(): CormConfig;
  release(event: OmwEvent): void;
}

export const createCormConfigManager = (omw: CormOmw) =>
  new OmwCormConfigManager(omw) as CormConfigManager;

class OmwCormConfigManager {
  private _omw: CormOmw;
  private _logger: CormLogger;
  private _config?: CormConfig;

  constructor(omw: CormOmw) {
    this._omw = omw;
    this._logger = createCormLogger(omw.host);
    this._config = undefined;
  }

  public load(): CormConfig {
    if (this._config === undefined) {
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
    }

    return this._config;
  }

  public release(_event: OmwEvent): void {}
}
