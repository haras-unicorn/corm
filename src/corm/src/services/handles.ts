import { cormSubscriptionsKey } from "corm/lib/keys";
import { type CormLogger, createCormLogger } from "corm/lib/log";
import type {
  CormAnyProviderHandle,
  CormAnyToolingHandle,
  CormOmw,
} from "corm/lib/omw";
import { type CormSubscriptions, cormSubscriptionsZod } from "corm/lib/opaque";

export interface CormNamedTooling {
  name: string;
  handle: CormAnyToolingHandle;
}

export interface CormHandlesManager {
  load(): CormHandles;
  release(event: OmwEvent): void;
}

export interface CormHandles {
  host(): Host;

  providers(): CormAnyProviderHandle[];

  main(): CormAnyProviderHandle;

  toolings(): CormNamedTooling[];

  subscriptions(): CormSubscriptions;
}

export const createCormHandlesManager = (omw: CormOmw) =>
  new OmwCormHandlesManager(omw) as CormHandlesManager;

class OmwCormHandlesManager {
  private _omw: CormOmw;
  private _handles?: OmwCormHandles;

  constructor(omw: CormOmw) {
    this._omw = omw;
    this._handles = undefined;
  }

  public load(): CormHandles {
    if (this._handles === undefined) {
      this._handles = new OmwCormHandles(this._omw);
    }

    return this._handles;
  }

  public release(event: OmwEvent): void {
    if (this._handles !== undefined) {
      this._handles.release(event);
    }
  }
}

class OmwCormHandles {
  private _omw: CormOmw;
  private _logger: CormLogger;

  private _providers: CormAnyProviderHandle[];
  private _toolings: CormNamedTooling[];

  private _subscriptions: CormSubscriptions;

  constructor(omw: CormOmw) {
    this._omw = omw;
    this._logger = createCormLogger(omw.host);

    this._providers = [
      this._provider("gpu"),
      this._provider("remote"),
      this._provider("cpu"),
    ].filter((provider) => provider !== undefined);

    if (this._providers.length === 0) {
      throw new Error("at least one provider must be configured");
    }

    this._toolings = [
      this._tooling("nixos"),
      this._tooling("nix"),
      this._tooling("git"),
      this._tooling("github"),
      this._tooling("rss"),
      this._tooling("plan"),
      this._tooling("filesystem"),
    ].filter((tooling) => tooling !== undefined);

    this._logger.info(
      `loaded providers [${this._providers
        .map((provider) => provider.name)
        .join(", ")}]`,
    );
    this._logger.info(
      `loaded toolings [${this._toolings
        .map((tooling) => tooling.name)
        .join(", ")}]`,
    );

    this._subscriptions = this._loadSubscriptions();
  }

  public host(): Host {
    return this._omw.host;
  }

  public providers(): CormAnyProviderHandle[] {
    return this._providers;
  }

  public main(): CormAnyProviderHandle {
    return this._providers[0];
  }

  public toolings(): CormNamedTooling[] {
    return this._toolings;
  }

  public subscriptions(): CormSubscriptions {
    return this._subscriptions;
  }

  public release(event: OmwEvent): void {
    if (event.kind === "reload") {
      this._logger.debug("persisting corm subscriptions to memory");
      this._omw.host.memorySet(
        cormSubscriptionsKey,
        JSON.stringify(this._subscriptions),
      );
    }
  }

  private _provider(name: string): CormAnyProviderHandle | undefined {
    try {
      const lookup = this._omw.provider as unknown as {
        get(name: string): CormAnyProviderHandle;
      };
      return lookup.get(name);
    } catch {
      this._logger.debug(`provider ${name} is not configured`);
      return undefined;
    }
  }

  private _tooling(name: string): CormNamedTooling | undefined {
    try {
      const lookup = this._omw.tooling as unknown as {
        get(name: string): CormAnyToolingHandle;
      };
      return { name, handle: lookup.get(name) };
    } catch {
      this._logger.debug(`tooling ${name} is not configured`);
      return undefined;
    }
  }

  private _loadSubscriptions(): CormSubscriptions {
    const model = this._omw.host.whoami();

    const stored = this._omw.host.memoryGet(cormSubscriptionsKey);
    if (stored) {
      try {
        const parsed = cormSubscriptionsZod.safeParse(JSON.parse(stored));
        if (parsed.success && parsed.data.model === model) {
          this._logger.debug(`reusing stored subscriptions for model ${model}`);
          return parsed.data;
        }
        if (parsed.success) {
          this._logger.info(
            `agent model changed ${parsed.data.model} -> ${model}; resubscribing endpoint`,
          );
          this._omw.host.unsubscribeEndpoint(parsed.data.endpoint);
        } else {
          this._logger.warn(
            "stored subscriptions are invalid; recreating them",
          );
        }
      } catch {
        this._logger.warn(
          "stored subscriptions are unreadable; recreating them",
        );
      }
    }

    this._logger.info(`creating subscriptions for model ${model}`);

    const subscriptions = {
      lifecycle: this._omw.host.subscribeLifecycle(),
      endpoint: this._omw.host.subscribeEndpoint(model),
      model,
    } as CormSubscriptions;

    this._omw.host.memorySet(
      cormSubscriptionsKey,
      JSON.stringify(subscriptions),
    );

    return subscriptions;
  }
}
