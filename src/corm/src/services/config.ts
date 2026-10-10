import { cormConfigKey } from "corm/lib/keys";
import { type CormLogger, createCormLogger } from "corm/lib/log";
import type { CormOmw } from "corm/lib/omw";
import { type CormConfig, cormConfigZod } from "corm/lib/opaque";

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
          seed[key] = value;
        }
      }

      const parsed = cormConfigZod.safeParse(seed);
      if (!parsed.success) {
        this._logger.error(
          "invalid corm config; falling back to the default model",
        );
        this._config = { model: "" };
        return this._config;
      }

      this._logger.debug(
        `loaded corm config model=${parsed.data.model} prompt=${
          parsed.data.prompt !== undefined ? "set" : "unset"
        }`,
      );
      this._config = parsed.data;
    }

    return this._config;
  }

  public release(_event: OmwEvent): void {}
}
