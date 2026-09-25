import { cormSubscriptionsKey } from "./keys";
import { cormModel } from "./model";
import { type CormSubscriptions, cormSubscriptionsZod } from "./types";

export interface CormHandlesManager {
  load(): CormHandles;
  release(event: OmwEvent): void;
}

export interface CormHandles {
  host(): Host;

  main(): ProviderHandle;

  nixos(): ToolingHandle;
  nix(): ToolingHandle;
  git(): ToolingHandle;
  github(): ToolingHandle;
  rss(): ToolingHandle;
  plan(): ToolingHandle;
  filesystem(): ToolingHandle;

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
      const handles = new OmwCormHandles(this._omw);
      this._handles = handles;
      return handles;
    } else {
      return this._handles;
    }
  }

  public release(event: OmwEvent): void {
    if (this._handles !== undefined) {
      this._handles.release(event);
    }
  }
}

class OmwCormHandles {
  private _omw: Omw;

  private _gpu?: ProviderHandle;
  private _cpu?: ProviderHandle;
  private _remote?: ProviderHandle;

  private _nixos: ToolingHandle;
  private _nix: ToolingHandle;
  private _git: ToolingHandle;
  private _github: ToolingHandle;
  private _rss: ToolingHandle;
  private _plan: ToolingHandle;
  private _filesystem: ToolingHandle;

  private _subscriptions: CormSubscriptions;

  constructor(omw: Omw) {
    this._omw = omw;

    try {
      this._gpu = this._omw.provider.get("gpu");
    } catch {}

    try {
      this._cpu = this._omw.provider.get("cpu");
    } catch {}

    try {
      this._remote = this._omw.provider.get("remote");
    } catch {}

    if (
      this._gpu === undefined &&
      this._cpu === undefined &&
      this._remote === undefined
    ) {
      OmwCormHandles.throwNoProvider();
    }

    this._nixos = this._omw.tooling.get("nixos");
    this._nix = this._omw.tooling.get("nix");
    this._git = this._omw.tooling.get("git");
    this._github = this._omw.tooling.get("github");
    this._rss = this._omw.tooling.get("rss");
    this._plan = this._omw.tooling.get("plan");
    this._filesystem = this._omw.tooling.get("filesystem");

    const subscriptionsText = this._omw.host.memoryGet(cormSubscriptionsKey);
    let subscriptionsJson: unknown | null = null;
    if (subscriptionsText) {
      try {
        subscriptionsJson = JSON.parse(subscriptionsText);
      } catch {}
    }
    let subscriptions: CormSubscriptions | null = null;
    if (subscriptionsJson) {
      const subscriptionsParsed =
        cormSubscriptionsZod.safeParse(subscriptionsJson);
      if (subscriptionsParsed.success) {
        subscriptions = subscriptionsParsed.data;
      }
    }
    if (subscriptions) {
      this._subscriptions = subscriptions;
    } else {
      const subscriptions = {
        lifecycle: this._omw.host.subscribeLifecycle(),
        endpoint: this._omw.host.subscribeEndpoint(cormModel),
        heartbeat: this._omw.host.waitCron("0 */1 * * * * *"),
      } as CormSubscriptions;
      this._subscriptions = subscriptions;
      this._omw.host.memorySet(
        cormSubscriptionsKey,
        JSON.stringify(subscriptions),
      );
    }
  }

  public host(): Host {
    return this._omw.host;
  }

  public main(): ProviderHandle {
    if (this._gpu !== undefined) {
      return this._gpu;
    }

    if (this._remote !== undefined) {
      return this._remote;
    }

    if (this._cpu !== undefined) {
      return this._cpu;
    }

    OmwCormHandles.throwNoProvider();
  }

  public nixos(): ToolingHandle {
    return this._nixos;
  }

  public nix(): ToolingHandle {
    return this._nix;
  }

  public git(): ToolingHandle {
    return this._git;
  }

  public github(): ToolingHandle {
    return this._github;
  }

  public rss(): ToolingHandle {
    return this._rss;
  }

  public plan(): ToolingHandle {
    return this._plan;
  }

  public filesystem(): ToolingHandle {
    return this._filesystem;
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

  private static throwNoProvider(): never {
    throw new Error("at least one provider must be configured");
  }
}
