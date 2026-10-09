import { cormStateFile, cormStateKey } from "corm/lib/keys";
import { type CormLogger, createCormLogger } from "corm/lib/log";
import type { CormOmw, CormToolingHandle } from "corm/lib/omw";
import { type CormGlobalState, cormStateZod } from "corm/lib/opaque";
import { contentText } from "corm/lib/tools";

export interface CormStateManager {
  load(): CormGlobalState;
  release(event: OmwEvent): void;
}

export const createCormStateManager = (omw: CormOmw) =>
  new OmwCormStateManager(omw) as CormStateManager;

class OmwCormStateManager {
  private _omw: CormOmw;
  private _logger: CormLogger;
  private _state?: CormGlobalState;

  constructor(omw: CormOmw) {
    this._omw = omw;
    this._logger = createCormLogger(omw.host);
    this._state = undefined;
  }

  public load(): CormGlobalState {
    if (this._state === undefined) {
      this._logger.info("loading corm task state");

      let stateValue = this._omw.host.memoryGet(cormStateKey);
      if (stateValue === undefined) {
        // NOTE: this filesystem recovery is the single sanctioned blocking call
        // in corm. It runs once at startup so task state survives shutdown.
        this._logger.debug(
          "corm task state absent from memory; attempting filesystem recovery",
        );

        let filesystem: CormToolingHandle<"filesystem"> | null = null;
        try {
          filesystem = this._omw.tooling.get("filesystem");
        } catch {}
        if (filesystem != null) {
          let result: null | ToolResult = null;
          try {
            result = filesystem.callToolBlocking("read_text_file", {
              path: cormStateFile,
            });
          } catch {
            this._logger.warn(
              `filesystem recovery of ${cormStateFile} failed; starting empty`,
            );
          }
          if (result != null) {
            stateValue = contentText(result);
          }
        } else {
          this._logger.warn(
            "filesystem tooling unavailable; skipping task state recovery",
          );
        }
      }

      if (stateValue === undefined) {
        stateValue = "{}";
      }

      let state: CormGlobalState | null = null;
      try {
        state = cormStateZod.parse(JSON.parse(stateValue)) as CormGlobalState;
      } catch {
        state = {
          immediate: [],
          pending: [],
        };
      }
      this._state = state;

      this._logger.debug(
        `restored task state pending=${state.pending.length} immediate=${state.immediate.length}`,
      );
      return state;
    } else {
      return this._state;
    }
  }

  public release(event: OmwEvent): void {
    if (this._state === undefined) {
      return;
    }

    if (event.kind === "reload") {
      this._logger.info("persisting corm task state to memory");
      this._omw.host.memorySet(cormStateKey, JSON.stringify(this._state));
    } else if (event.kind === "shutdown") {
      // NOTE: this filesystem persistence is the single sanctioned blocking
      // call in corm; it runs once on shutdown so task state survives.
      this._logger.info("persisting corm task state to filesystem");

      let filesystem: CormToolingHandle<"filesystem"> | null = null;
      try {
        filesystem = this._omw.tooling.get("filesystem");
      } catch {}
      if (filesystem != null) {
        try {
          filesystem.callToolBlocking("write_file", {
            path: cormStateFile,
            content: JSON.stringify(this._state),
          });
        } catch {
          this._logger.warn(
            `filesystem persistence of ${cormStateFile} failed`,
          );
        }
      } else {
        this._logger.warn(
          "filesystem tooling unavailable; task state not persisted",
        );
      }
    }
  }
}
