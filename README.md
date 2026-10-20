# Corm

<!-- ANCHOR: body -->

Corm is a local-first [omw] agent distribution for NixOS.

It packages a JavaScript brain, preconfigured llama.cpp / FreeToken / Strata
providers, MCP tooling, a systemd service and the Nix plumbing needed to run a
single local agent. The agent itself is a configuration on top of it.

[omw]: https://github.com/haras-unicorn/omw

## Design

Corm targets constrained single-GPU, single-agent setups, and it achieves a 100%
provider KV-cache hit rate: the shared context window only ever grows, and
compaction folds old messages into a rolling summary while re-appending its
instruction at the end, so the cached prefix is never rewritten and prefill is
paid once.

## Install

To deploy Corm on a NixOS machine, add the flake as an input and import
`corm.nixosModules.corm`:

```nix
{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    corm.url = "github:haras-unicorn/corm";
  };

  nixosConfigurations.my-machine = nixpkgs.lib.nixosSystem {
    modules = [
      corm.nixosModules.corm
      {
        corm = {
          enable = true;
          remote-provider.enable = true;
        };
      }
    ];
  };
}
```

## Configure

Corm runs a single agent. `corm.settings` seeds the agent's config, the enabled
providers supply the model, and the agent name is the model name the endpoint
subscribes under. `contextLength` is required and set by the operator (the model
only caps it). Providers are tried in `gpu`, `cpu`, `remote` order:

```nix
{
  corm = {
    enable = true;
    settings.contextLength = 131072;
    settings.prompt = "You are Corm, a local-first NixOS agent.";
    settings.tools = [ "git__git_status" "filesystem__list_directory" ];

    # a local llama.cpp provider ...
    cpu-provider.enable = true;
    cpu-provider.kind.llama-cpp = { };

    # ... and/or a remote OpenAI-compatible provider
    remote-provider.enable = true;
    remote-provider.baseUrl = "https://openrouter.ai/api/v1";
    remote-provider.model = "deepseek/deepseek-v4.1-flash-1017";
  };
}
```

The enabled toolings (`nixos`, `nix`, `git`, `github`, `rss`, `plan`,
`filesystem`) run as sandboxed MCP servers under `corm.omw`.

### Daily digest

Corm can run a daily RSS/Atom digest as a background turn. The job polls the
configured feeds with the `rss` tooling (`corm__rss__get_articles`) and
summarizes what is new since the previous run:

```nix
{
  corm.settings.digestCron = "0 0 8 * * *";
  corm.settings.digestFeeds = [ "https://example.com/feed.xml" ];
}
```

`digestCron` uses a six-field cron (seconds first); set it to `true` to disable
the job. The last successful run is persisted with the agent's task state, so a
missing or stale run starts immediately at startup instead of waiting for the
next cron fire. `digestMaxAgeMs` (default 24h) is the catch-up threshold and
`digestMinGapMs` (default 12h) suppresses a duplicate fire shortly after a
catch-up. A digest is an append-only `⟦runtime⟧` turn in the shared window; an
endpoint message that arrives while it streams preempts it, is answered
immediately, and the digest then resumes.

## Secrets

The deployment reads secrets from a systemd `EnvironmentFile`: set
`corm.omw.environmentFile`.

Required:

- `OMW__PROVIDERS__REMOTE__API_KEY` — API key for the remote OpenAI-compatible
  provider; required when `corm.remote-provider.enable` is set (for example an
  OpenRouter key).
- `OMW__TOOLING__GITHUB__ENV__GITHUB_PERSONAL_ACCESS_TOKEN` — token used by the
  `github` tooling.
- `OMW__TOOLING__GIT__ENV__GIT_SSH_KEY` — private key used by the `git` tooling
  over SSH.

Optional:

- `OMW__PROVIDERS__REMOTE__BASE_URL` — override the remote provider's endpoint
  at runtime.
- `OMW__PROVIDERS__REMOTE__MODEL` — override the remote provider's model at
  runtime.
- `RUST_LOG` — log level for the omw runtime (defaults to `info`).
- `OMW__TUNABLES__ALLOW_UNLOCKED_SECRETS` — allow secret access where `mlock()`
  is unavailable (for example inside a container).

<!-- ANCHOR_END: body -->
