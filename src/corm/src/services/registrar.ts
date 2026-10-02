import type { CormContext } from "./context";
import registry from "./registry";
import type {
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

export const createCormHandlerRegistrar = (context: CormContext) =>
  new RegistryCormHandlerRegistrar(context) as CormHandlerRegistrar;

export interface CormHandlerFactory {
  kind(): string;

  should(event: OmwEvent): CormTaskSpec | undefined;

  new (context: CormContext, id: string, taskState: CormTaskState): CormHandler;
}

export interface CormHandler {
  accepts(event: OmwEvent): boolean;

  handle(event: OmwEvent): CormOutcome;
}

class RegistryCormHandlerRegistrar {
  private _factories: CormHandlerFactory[];
  private _context: CormContext;

  constructor(context: CormContext) {
    this._factories = [...registry];
    this._context = context;
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

    return new factory(this._context, task.id, task.state);
  }
}
