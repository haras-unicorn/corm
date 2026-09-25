import type { CormHandles } from "./handles";
import registry from "./registry";
import type {
  CormGlobalState,
  CormMaterializedTaskSpec,
  CormOutcome,
  CormTask,
  CormTaskSpec,
  CormTaskState,
} from "./types";

export interface CormHandlerRegistrar {
  should(event: OmwEvent): CormMaterializedTaskSpec | undefined;

  create(task: CormTask): CormHandler;
}

export const createCormHandlerRegistrar = (
  handles: CormHandles,
  globalState: CormGlobalState,
) =>
  new RegistryCormHandlerRegistrar(
    handles,
    globalState,
  ) as CormHandlerRegistrar;

export interface CormHandlerFactory {
  kind(): string;

  should(event: OmwEvent): CormTaskSpec | undefined;

  new (
    handles: CormHandles,
    globalState: CormGlobalState,
    id: string,
    taskState: CormTaskState,
  ): CormHandler;
}

export interface CormHandler {
  handle(event: OmwEvent): CormOutcome;
}

class RegistryCormHandlerRegistrar {
  private _factories: CormHandlerFactory[];
  private _handles: CormHandles;
  private _globalState: CormGlobalState;

  constructor(handles: CormHandles, globalState: CormGlobalState) {
    this._factories = [...registry];
    this._handles = handles;
    this._globalState = globalState;
  }

  public should(event: OmwEvent) {
    return this._factories
      .map((factory) => ({ spec: factory.should(event), kind: factory.kind() }))
      .filter((materializedSpec) => materializedSpec.spec !== undefined)[0];
  }

  public create(task: CormTask) {
    const factory = this._factories.filter(
      (factory) => factory.kind() === task.kind,
    )[0];
    if (factory === undefined) {
      throw new Error(`unknown factory kind ${task.kind}`);
    }

    return new factory(this._handles, this._globalState, task.id, task.state);
  }
}
