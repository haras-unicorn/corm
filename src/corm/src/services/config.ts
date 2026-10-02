import { cormConfigKey } from "./keys";
import { type CormConfig, cormConfigZod } from "./types";

export interface CormConfigManager {
  load(): CormConfig;
  release(event: OmwEvent): void;
}

export const createCormConfigManager = (omw: Omw) =>
  new OmwCormConfigManager(omw) as CormConfigManager;

class OmwCormConfigManager {
  private _omw: Omw;
  private _config?: CormConfig;

  constructor(omw: Omw) {
    this._omw = omw;
    this._config = undefined;
  }

  public load(): CormConfig {
    if (this._config === undefined) {
      const loaded = this._omw.host.memoryGetAs(cormConfigKey);
      const parsed = cormConfigZod.safeParse(loaded);
      this._config = parsed.success ? parsed.data : { model: "" };
    }

    return this._config;
  }

  public release(_event: OmwEvent): void {}
}
