import {
  CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
  CORM_DEFAULT_PROMPT_PRELUDE,
  CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
} from "corm/lib/defaults";
import { recomputeMessage, systemMessage } from "corm/lib/messages";
import type { CormConfig } from "corm/types/config";
import { cormStateFile, cormStateKey, cormSubscriptionsKey } from "../lib/keys";
import { contentText, cormTools } from "../lib/tools";
import type { CormLogger } from "../services/logger";
import type { CormOmwEvent } from "../types/omw";
import {
  type CormDiskState,
  type CormMemoryState,
  type CormState,
  cormDiskStateZod,
  cormMemoryStateZod,
} from "../types/state";
import { defaultTurn } from "../types/turn";
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
    this._state.disk.turn = defaultTurn();

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

  private _loadDisk(): CormDiskState {
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

    const defaults = this._defaultDisk();

    let disk: CormDiskState;
    try {
      disk = cormDiskStateZod.parse(JSON.parse(stateValue ?? "{}"));
    } catch {
      disk = defaults;
    }

    disk.window.system = defaults.window.system;
    disk.window.tools = defaults.window.tools;
    disk.window.active = disk.window.active.map((message) =>
      recomputeMessage(message, this._config),
    );
    disk.turn = defaultTurn();

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

  private _defaultDisk(): CormDiskState {
    const systemContent = [
      this._config.runtimeSystemPrompt ?? CORM_DEFAULT_RUNTIME_SYSTEM_PROMPT,
      this._config.chatSystemPrompt ?? CORM_DEFAULT_CHAT_SYSTEM_PROMPT,
    ].join("\n\n");

    const content =
      this._config.prompt !== undefined && this._config.prompt !== ""
        ? `${systemContent}\n\n${
            this._config.promptPrelude ?? CORM_DEFAULT_PROMPT_PRELUDE
          }\n\n${this._config.prompt}`
        : systemContent;

    return {
      inbox: [],
      window: {
        system: systemMessage(content, this._config),
        summary: "",
        active: [],
        tools: cormTools(this._handles.tools(), this._config),
        clientTools: [],
        session: "",
        params: undefined,
        tokens: 0,
        chars: 0,
      },
      turn: defaultTurn(),
      receipts: [],
      task: 0,
    };
  }
}
