# Corm

<!-- ANCHOR: body -->

Corm is a local-first [omw] agent distribution for NixOS.

It packages a JavaScript brain, preconfigured llama.cpp / FreeToken / Strata
providers, MCP tooling, a systemd service and the Nix plumbing needed to run a
single local agent. The agent itself is a configuration on top of it.

[omw]: https://github.com/haras-unicorn/omw

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

Corm runs a single agent. `corm.settings` seeds the agent's config , the enabled
providers supply the model, and the agent name is the model name the endpoint
subscribes under. Providers are tried in `gpu`, `remote`, `cpu` order:

```nix
{
  corm = {
    enable = true;
    settings.prompt = "You are Corm, a local-first NixOS agent.";

    # a local llama.cpp provider ...
    cpu-provider.enable = true;
    cpu-provider.kind.llama-cpp = { };

    # ... and/or a remote OpenAI-compatible provider
    remote-provider.enable = true;
    remote-provider.baseUrl = "https://openrouter.ai/api/v1";
    remote-provider.model = "deepseek/deepseek-v4.1-flash";
  };
}
```

The enabled toolings (`nixos`, `nix`, `git`, `github`, `rss`, `plan`,
`filesystem`) run as sandboxed MCP servers under `corm.omw`.

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
