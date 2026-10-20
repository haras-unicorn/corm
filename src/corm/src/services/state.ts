import type { CormConfig } from "corm/types/config";
import {
  cormStateFile,
  cormStateKey,
  cormSubscriptionsKey,
} from "../lib/keys";
import { contentText } from "../lib/tools";
import type { CormLogger } from "../services/logger";
import type { CormOmwEvent } from "../types/omw";
import {
  type CormMemoryState,
  type CormState,
  type CormStoredDiskState,
  cormMemoryStateZod,
  cormStoredDiskStateZod,
  defaultDisk,
} from "../types/state";
import type { CormHandles } from "./handles";

export interface CormStateManager {
  load(): CormState;
  release(event: CormOmwEvent): void;
}

export const createCormStateManager = (
  logger: CormLogger,
  handles: CormHandles,
  config: CormConfig,
) => new CormOmwStateManager(logger, handles, config) as CormStateManager;

class CormOmwStateManager {
  private _logger: CormLogger;
  private _handles: CormHandles;
  private _config: CormConfig;
  private _state?: CormState;

  constructor(logger: CormLogger, handles: CormHandles, config: CormConfig) {
    this._logger = logger;
    this._handles = handles;
    this._config = config;
    this._state = undefined;
  }

  public load(): CormState {
    this._state ??= {
      memory: this._loadMemory(),
      disk: this._loadDisk(),
    };

    this._state.memory.subscriptions.generation = undefined;
    this._state.memory.subscriptions.digest = undefined;

    return this._state;
  }

  public release(event: CormOmwEvent): void {
    this._releaseDisk(event);
    this._releaseMemory(event);
  }

  private _loadMemory(): CormMemoryState {
    const model = this._handles.host().whoami();
    const stored = this._handles.host().memoryGet(cormSubscriptionsKey);

    if (stored) {
      try {
        const parsed = cormMemoryStateZod.safeParse(JSON.parse(stored));
        if (parsed.success) {
          this._logger.debug(`reusing stored subscriptions for model ${model}`);
          return parsed.data;
        }
        this._logger.warn("stored subscriptions are invalid; recreating them");
      } catch {
        this._logger.warn(
          "stored subscriptions are unreadable; recreating them",
        );
      }
    }

    this._logger.info(`creating subscriptions for model ${model}`);

    const memory: CormMemoryState = {
      subscriptions: {
        lifecycle: this._handles.host().subscribeLifecycle(),
        endpoint: this._handles.host().subscribeEndpoint(model),
        generation: undefined,
      },
    };

    this._handles
      .host()
      .memorySet(cormSubscriptionsKey, JSON.stringify(memory));

    return memory;
  }

  private _loadDisk(): CormState["disk"] {
    this._logger.info("loading corm task state");

    let stateValue = this._handles.host().memoryGet(cormStateKey);
    if (stateValue === undefined) {
      // NOTE: this filesystem recovery is the single sanctioned blocking call
      // in corm. It runs once at startup so task state survives shutdown.
      this._logger.debug(
        "corm task state absent from memory; attempting filesystem recovery",
      );

      const filesystem = this._handles.tooling("internal-filesystem");
      if (filesystem !== undefined) {
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
          "internal filesystem tooling unavailable; skipping task state recovery",
        );
      }
    }

    let stored: CormStoredDiskState | undefined;
    try {
      stored = cormStoredDiskStateZod.parse(JSON.parse(stateValue ?? "{}"));
    } catch (error) {
      this._logger.warn(
        `stored task state is invalid; starting from defaults: ${(error as Error).message}`,
      );
    }

    const disk = defaultDisk(this._config, this._handles.tools(), stored);
    this._logger.debug("restored state");
    return disk;
  }

  private _releaseDisk(event: CormOmwEvent): void {
    if (this._state === undefined) {
      return;
    }

    if (event.kind === "reload") {
      this._logger.info("persisting corm task state to memory");
      this._handles
        .host()
        .memorySet(cormStateKey, JSON.stringify(this._state.disk));
    } else if (event.kind === "shutdown") {
      // NOTE: this filesystem persistence is the single sanctioned blocking
      // call in corm; it runs once on shutdown so task state survives.
      this._logger.info("persisting corm task state to filesystem");

      const filesystem = this._handles.tooling("internal-filesystem");
      if (filesystem !== undefined) {
        try {
          filesystem.callToolBlocking("write_file", {
            path: cormStateFile,
            content: JSON.stringify(this._state.disk),
          });
        } catch {
          this._logger.warn(
            `filesystem persistence of ${cormStateFile} failed`,
          );
        }
      } else {
        this._logger.warn(
          "internal filesystem tooling unavailable; task state not persisted",
        );
      }
    }
  }

  private _releaseMemory(event: CormOmwEvent): void {
    if (event.kind !== "reload" || this._state === undefined) {
      return;
    }

    this._logger.debug("persisting corm subscriptions to memory");
    this._handles
      .host()
      .memorySet(cormSubscriptionsKey, JSON.stringify(this._state.memory));
  }
}
