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
        // NOTE: this filesystem recovery is the single sanctioned blocking call
        // in corm. It runs once at startup so task state survives shutdown.
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
            stateValue = OmwCormStateManager.contentText(result);
          }
        }
      }

      if (stateValue === undefined) {
        stateValue = "{}";
      }

      const state = cormStateZod.parse(
        JSON.parse(stateValue),
      ) as CormGlobalState;
      this._state = state;
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
      this._omw.host.memorySet(cormStateKey, JSON.stringify(this._state));
    } else if (event.kind === "shutdown") {
      // NOTE: this filesystem persistence is the single sanctioned blocking
      // call in corm; it runs once on shutdown so task state survives.
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

  private static contentText(result: ToolResult): string | undefined {
    if (result.structuredContent !== undefined) {
      const structured = result.structuredContent as {
        content?: unknown;
      };
      if (typeof structured?.content === "string") {
        return structured.content;
      }
    }

    const content = result.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block != null &&
          typeof block === "object" &&
          "text" in block &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          return (block as { text: string }).text;
        }
      }
    }

    return undefined;
  }
}
