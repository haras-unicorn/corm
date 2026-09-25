import type { CormLogger } from "corm/lib/log";
import type {
  CormGlobalState,
  CormMaterializedTaskSpec,
  CormTask,
} from "corm/lib/opaque";
import type { CormContext } from "corm/services/context";
import type { CormHandler, CormHandlerRegistrar } from "./registrar";

export interface CormMachine {
  handle(event: OmwEvent): void;
}

export const createCormMachine = (
  context: CormContext,
  globalState: CormGlobalState,
  registrar: CormHandlerRegistrar,
) => new OmwCormMachine(context, globalState, registrar) as CormMachine;

interface CormTaskMeta {
  key?: string;
  atomic?: boolean;
}

class OmwCormMachine {
  private _context: CormContext;
  private _logger: CormLogger;
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
    this._logger = context.logger;
    this._state = state;
    this._registrar = registrar;
    this._handlers = {};
    this._meta = {};
    this._inc = 0;
  }

  public handle(event: OmwEvent): void {
    this._logger.trace(`machine handling ${event.kind}`);

    if (event.kind === "shutdown") {
      const generation = this._context.handles.subscriptions().generation;
      if (generation !== undefined) {
        this._logger.info("cancelling the active generation for shutdown");
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
      this._logger.debug(
        `merging ${materialized.kind} into the active task for key ${spec.key}`,
      );
      return;
    }

    const blocked =
      spec.placement === "immediate" &&
      spec.atomic === true &&
      this._state.immediate.some(
        (task) => this._meta[task.id]?.atomic === true,
      );

    const task: CormTask = {
      kind: materialized.kind,
      id: (++this._inc).toString(),
      state: spec.state,
    };

    this._handlers[task.id] = this._registrar.create(task);
    this._meta[task.id] = { key: spec.key, atomic: spec.atomic };

    if (spec.placement === "immediate" && !blocked) {
      this._logger.info(`started ${task.kind} task ${task.id} immediately`);
      this._state.immediate.push(task);
    } else {
      if (blocked) {
        this._logger.debug(
          `atomic task active; queuing ${task.kind} task ${task.id}`,
        );
      } else {
        this._logger.debug(`queuing ${task.kind} task ${task.id}`);
      }
      this._state.pending.push(task);
    }
  }

  private _dispatch(event: OmwEvent): void {
    for (const task of [...this._state.immediate].reverse()) {
      const handler = this._handlers[task.id];
      if (handler === undefined || !handler.accepts(event)) {
        continue;
      }

      this._logger.trace(`dispatching ${event.kind} to task ${task.id}`);

      if (handler.handle(event) === "complete") {
        this._complete(task.id);
      }
      return;
    }
  }

  private _complete(id: string): void {
    this._logger.debug(`task ${id} complete`);

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
    if (pending.length > 0) {
      this._logger.info(`draining ${pending.length} pending task(s)`);
    }
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
