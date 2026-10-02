import { cormSubscriptionsKey } from "./keys";
import { type CormSubscriptions, cormSubscriptionsZod } from "./types";

export interface CormNamedTooling {
  name: string;
  handle: ToolingHandle;
}

export interface CormHandlesManager {
  load(): CormHandles;
  release(event: OmwEvent): void;
}

export interface CormHandles {
  host(): Host;

  providers(): ProviderHandle[];

  main(): ProviderHandle;

  toolings(): CormNamedTooling[];

  subscriptions(): CormSubscriptions;
}

export const createCormHandlesManager = (omw: Omw) =>
  new OmwCormHandlesManager(omw) as CormHandlesManager;

class OmwCormHandlesManager {
  private _omw: Omw;
  private _handles?: OmwCormHandles;

  constructor(omw: Omw) {
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
  private _omw: Omw;

  private _providers: ProviderHandle[];
  private _toolings: CormNamedTooling[];

  private _subscriptions: CormSubscriptions;

  constructor(omw: Omw) {
    this._omw = omw;

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

    this._subscriptions = this._loadSubscriptions();
  }

  public host(): Host {
    return this._omw.host;
  }

  public providers(): ProviderHandle[] {
    return this._providers;
  }

  public main(): ProviderHandle {
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
      this._omw.host.memorySet(
        cormSubscriptionsKey,
        JSON.stringify(this._subscriptions),
      );
    }
  }

  private _provider(name: string): ProviderHandle | undefined {
    try {
      const lookup = this._omw.provider as {
        get(name: string): ProviderHandle;
      };
      return lookup.get(name);
    } catch {
      return undefined;
    }
  }

  private _tooling(name: string): CormNamedTooling | undefined {
    try {
      const lookup = this._omw.tooling as {
        get(name: string): ToolingHandle;
      };
      return { name, handle: lookup.get(name) };
    } catch {
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
          return parsed.data;
        }
        if (parsed.success) {
          this._omw.host.unsubscribeEndpoint(parsed.data.endpoint);
        }
      } catch {}
    }

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
