import type {
  CormMaterializedTaskSpec,
  CormOutcome,
  CormTask,
  CormTaskSpec,
  CormTaskState,
} from "corm/lib/opaque";
import registry from "corm/lib/registry";
import type { CormContext } from "corm/services/context";

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
    const materialized = this._factories
      .map((factory) => ({ spec: factory.should(event), kind: factory.kind() }))
      .filter((materializedSpec) => materializedSpec.spec !== undefined)[0];

    if (materialized !== undefined) {
      this._context.logger.trace(
        `registrar matched ${materialized.kind} for ${event.kind}`,
      );
    }

    return materialized;
  }

  public create(task: CormTask) {
    this._context.logger.trace(`creating ${task.kind} task ${task.id}`);

    const factory = this._factories.filter(
      (factory) => factory.kind() === task.kind,
    )[0];
    if (factory === undefined) {
      throw new Error(`unknown factory kind ${task.kind}`);
    }

    return new factory(this._context, task.id, task.state);
  }
}
