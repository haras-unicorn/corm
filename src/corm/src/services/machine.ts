import type { CormHandles } from "./handles";
import type { CormHandler, CormHandlerRegistrar } from "./registrar";
import type { CormGlobalState } from "./types";

export interface CormMachine {
  initialize(): void;

  handle(event: OmwEvent): void;
}

export const createCormMachine = (
  handles: CormHandles,
  globalState: CormGlobalState,
  registrar: CormHandlerRegistrar,
) => new OmwCormMachine(handles, globalState, registrar) as CormMachine;

class OmwCormMachine {
  private _handles: CormHandles;
  private _state: CormGlobalState;
  private _registrar: CormHandlerRegistrar;
  private _handlers: Record<string, CormHandler>;
  private _inc: number;

  constructor(
    handles: CormHandles,
    state: CormGlobalState,
    registrar: CormHandlerRegistrar,
  ) {
    this._handles = handles;
    this._state = state;
    this._registrar = registrar;
    this._handlers = {};
    this._inc = 0;
  }

  public initialize() {}

  public handle(event: OmwEvent) {
    if (event.kind === "shutdown") {
      const generation = this._handles.subscriptions().generation;
      if (generation !== undefined) {
        this._handles.main().cancel(generation);
      }
      return;
    }

    const materializedSpec = this._registrar.should(event);
    if (materializedSpec) {
      const id = (++this._inc).toString();
      const task = {
        kind: materializedSpec.kind,
        id,
        state: materializedSpec.spec.state,
      };
      this._handlers[id] = this._registrar.create(task);
      if (materializedSpec.spec.placement === "immediate") {
        const generation = this._handles.subscriptions().generation;
        if (generation) {
          this._handles.main().cancel(generation);
        }
        this._state.immediate.push(task);
      }
      if (materializedSpec.spec.placement === "pending") {
        this._state.pending.push(task);
      }
    }

    const task = this._state.immediate[this._state.immediate.length - 1];
    if (!task) {
      return;
    }

    const handler = this._handlers[task.id];
    if (!handler) {
      throw new Error(`handler not found for task ${task.id}`);
    }

    const outcome = handler.handle(event);
    if (outcome === "complete") {
      this._state.immediate.pop();
      delete this._handlers[task.id];

      this._state.immediate.push(...this._state.pending);
      this._state.pending = [];
    }
  }
}
