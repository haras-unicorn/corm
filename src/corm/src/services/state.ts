import { cormStateFile, cormStateKey } from "./keys";
import { type CormGlobalState, cormStateZod } from "./types";

export interface CormStateManager {
  load(): CormGlobalState;
  release(event: OmwEvent): void;
}

export const createCormStateManager = (omw: Omw) =>
  new OmwCormStateManager(omw) as CormStateManager;

class OmwCormStateManager {
  private _omw: Omw;
  private _state?: CormGlobalState;

  constructor(omw: Omw) {
    this._omw = omw;
    this._state = undefined;
  }

  public load(): CormGlobalState {
    if (this._state === undefined) {
      let stateValue = this._omw.host.memoryGet(cormStateKey);
      if (stateValue === undefined) {
        let filesystem: ToolingHandle | null = null;
        try {
          filesystem = this._omw.tooling.get("filesystem");
        } catch {}
        if (filesystem != null) {
          let result: null | ToolResult = null;
          try {
            result = filesystem.callToolBlocking("read_text_file", {
              path: cormStateFile,
            });
          } catch {}
          if (result != null) {
            stateValue = JSON.parse(result.value).structuredContent
              .content as string;
          }
        }
      }
      if (stateValue === undefined) {
        stateValue = "{}";
      }
      const state = cormStateZod.parse(JSON.parse(stateValue)) as CormGlobalState;
      this._state = state;
      return state;
    } else {
      return this._state;
    }
  }

  public release(event: OmwEvent): void {
    if (this._state !== undefined) {
      if (event.kind === "reload") {
        this._omw.host.memorySet(cormStateKey, JSON.stringify(this._state));
      } else if (event.kind === "shutdown") {
        let filesystem: ToolingHandle | null = null;
        try {
          filesystem = this._omw.tooling.get("filesystem");
        } catch {}
        if (filesystem != null) {
          try {
            filesystem.callToolBlocking("write_file", {
              path: cormStateFile,
              content: JSON.stringify(this._state),
            });
          } catch {}
        }
      }
    }
  }
}
