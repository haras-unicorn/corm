import type { CormContext } from "./context";
import type { CormHandler, CormHandlerRegistrar } from "./registrar";
import type {
  CormGlobalState,
  CormMaterializedTaskSpec,
  CormTask,
} from "./types";

export interface CormMachine {
  initialize(): void;

  handle(event: OmwEvent): void;
}

export const createCormMachine = (
  context: CormContext,
  globalState: CormGlobalState,
  registrar: CormHandlerRegistrar,
) => new OmwCormMachine(context, globalState, registrar) as CormMachine;

interface CormTaskMeta {
  key?: string;
  exclusive?: boolean;
}

class OmwCormMachine {
  private _context: CormContext;
  private _state: CormGlobalState;
  private _registrar: CormHandlerRegistrar;
  private _handlers: Record<string, CormHandler>;
  private _meta: Record<string, CormTaskMeta>;
  private _inc: number;

  constructor(
    context: CormContext,
    state: CormGlobalState,
    registrar: CormHandlerRegistrar,
  ) {
    this._context = context;
    this._state = state;
    this._registrar = registrar;
    this._handlers = {};
    this._meta = {};
    this._inc = 0;
  }

  public initialize() {}

  public handle(event: OmwEvent): void {
    if (event.kind === "shutdown") {
      const generation = this._context.handles.subscriptions().generation;
      if (generation !== undefined) {
        this._context.handles.main().cancel(generation);
      }
      return;
    }

    if (event.kind === "reload") {
      return;
    }

    const materialized = this._registrar.should(event);
    if (materialized !== undefined) {
      this._materialize(materialized);
    }

    this._dispatch(event);
  }

  private _materialize(materialized: CormMaterializedTaskSpec): void {
    const spec = materialized.spec;

    if (
      spec.key !== undefined &&
      this._immediateByKey(spec.key) !== undefined
    ) {
      return;
    }

    const blocked =
      spec.placement === "immediate" &&
      spec.exclusive === true &&
      this._state.immediate.some(
        (task) => this._meta[task.id]?.exclusive === true,
      );

    const task: CormTask = {
      kind: materialized.kind,
      id: (++this._inc).toString(),
      state: spec.state,
    };

    this._handlers[task.id] = this._registrar.create(task);
    this._meta[task.id] = { key: spec.key, exclusive: spec.exclusive };

    if (spec.placement === "immediate" && !blocked) {
      this._state.immediate.push(task);
    } else {
      this._state.pending.push(task);
    }
  }

  private _dispatch(event: OmwEvent): void {
    for (const task of [...this._state.immediate].reverse()) {
      const handler = this._handlers[task.id];
      if (handler === undefined || !handler.accepts(event)) {
        continue;
      }

      if (handler.handle(event) === "complete") {
        this._complete(task.id);
      }
      return;
    }
  }

  private _complete(id: string): void {
    this._state.immediate = this._state.immediate.filter(
      (task) => task.id !== id,
    );
    delete this._handlers[id];
    delete this._meta[id];

    if (this._state.immediate.length > 0) {
      return;
    }

    const pending = this._state.pending;
    this._state.pending = [];
    for (const task of pending) {
      this._state.immediate.push(task);
      const handler = this._handlers[task.id];
      if (handler !== undefined) {
        handler.handle(task.state as OmwEvent);
      }
    }
  }

  private _immediateByKey(key: string): CormTask | undefined {
    return this._state.immediate.find(
      (task) => this._meta[task.id]?.key === key,
    );
  }
}
