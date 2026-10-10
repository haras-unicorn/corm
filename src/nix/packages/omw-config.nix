{ selfLib, ... }:

{
  corm.lib.openrouter = {
    baseUrl = "https://openrouter.ai/api/v1";
    model = "deepseek/deepseek-v4.1-flash";
  };

  flake.overlays.omw-config =
    final: prev:
    let
      package = final.callPackage (
        {
          lib,
          formats,

          github-mcp-server,
          mcp-nixos,

          mcp-nix,
          mcp-rss,
          mcp-plan,

          cormPackages,

          cormName ? "corm",

          cormAgent ? "corm",

          cormStateDir ? "/var/lib/${cormName}",
          cormWorkspaceDir ? "${cormStateDir}/workspace",
          cormDataDir ? "${cormStateDir}/data",

          cormScript ? "${cormPackages.corm}/index.js",
          cormConfig ? { },
          cormMemory ? { },
          cormTunables ? { },

          cormCpuHost ? null,
          cormCpuPort ? null,
          cormCpuModel ? null,

          cormGpuHost ? null,
          cormGpuPort ? null,
          cormGpuModel ? null,

          cormRemoteBaseUrl ? null,
          cormRemoteModel ? null,

          cormEmbeddingHost ? null,
          cormEmbeddingPort ? null,
          cormEmbeddingModel ? null,

          cormEndpointHost ? null,
          cormEndpointPort ? null,

          cormOverrideSettings ? { },

          cormBwrapArgs ? null,
          ...
        }:
        let
          toml = formats.toml { };

          mcp-server-filesystem-bwrap = cormPackages.mcp-server-filesystem-bwrap.override {
            bwrapArgs = cormBwrapArgs;
          };
          git-mcp-server-ssh-agent = cormPackages.git-mcp-server-ssh-agent.override {
            bwrapArgs = cormBwrapArgs;
          };

          cormConfigModel =
            if cormGpuHost != null && cormGpuPort != null && cormGpuModel != null then
              cormGpuModel
            else if cormRemoteBaseUrl != null && cormRemoteModel != null then
              cormRemoteModel
            else
              cormCpuModel;

          settings = {
            # NOTE: secrets cannot always be mlock()ed (for example inside a
            # container), so omw is allowed to read them unlocked. The trade-off
            # is documented under "Secrets" in the README.
            tunables = {
              allow_unlocked_secrets = true;
            }
            // cormTunables;

            providers =
              lib.optionalAttrs (cormGpuHost != null && cormGpuPort != null && cormGpuModel != null) {
                gpu = {
                  kind = "openai";
                  base_url = "http://${cormGpuHost}:${builtins.toString cormGpuPort}/v1";
                  model = cormGpuModel;
                };
              }
              // lib.optionalAttrs (cormCpuHost != null && cormCpuPort != null && cormCpuModel != null) {
                cpu = {
                  kind = "openai";
                  base_url = "http://${cormCpuHost}:${builtins.toString cormCpuPort}/v1";
                  model = cormCpuModel;
                };
              }
              // lib.optionalAttrs (cormRemoteBaseUrl != null && cormRemoteModel != null) {
                remote = {
                  kind = "openai";
                  base_url = cormRemoteBaseUrl;
                  model = cormRemoteModel;
                };
              };

            tooling = {
              nixos = {
                kind = "mcp";
                transport = "stdio";
                command = lib.getExe mcp-nixos;
              };

              nix = {
                kind = "mcp";
                transport = "stdio";
                command = lib.getExe mcp-nix;
                env.MCP_NIX_SANDBOX = builtins.concatStringsSep " " (
                  [
                    "--unshare-all"
                  ]
                  ++ (if cormBwrapArgs != null then cormBwrapArgs else selfLib.bwrap.base)
                  ++ [
                    "--bind"
                    cormWorkspaceDir
                    cormWorkspaceDir
                  ]
                );
              };

              git = {
                kind = "mcp";
                transport = "stdio";
                command = lib.getExe git-mcp-server-ssh-agent;
                env = {
                  MCP_TRANSPORT_TYPE = "stdio";
                  MCP_LOG_LEVEL = "warn";
                  GIT_BASE_DIR = "${cormWorkspaceDir}/projects";
                  GIT_SSH_DIR = "${cormDataDir}/ssh";
                  GIT_SIGN_COMMITS = "false";
                };
              };

              github = {
                kind = "mcp";
                transport = "stdio";
                command = lib.getExe github-mcp-server;
                args = [ "stdio" ];
                env.GITHUB_TOOLSETS = builtins.concatStringsSep "," [
                  "context"
                  "repos"
                  "issues"
                  "labels"
                  "notifications"
                  "discussions"
                  "projects"
                  "stargazers"
                  "actions"
                  "pull_requests"
                  "users"
                ];
              };

              rss = {
                kind = "mcp";
                transport = "stdio";
                command = lib.getExe mcp-rss;
              };

              plan = {
                kind = "mcp";
                transport = "stdio";
                command = lib.getExe mcp-plan;
                env.MCP_PLAN__DATABASE__URL = "sqlite://${cormStateDir}/plan.db";
                args = [
                  "--config"
                  (toml.generate "plan.toml" {
                    runtime = {
                      tps_in = 800;
                      tps_out = 30;
                      max_task_duration_secs = 600;
                      queue_limit = 10;
                      max_retries = 3;
                    };
                    sources = [
                      {
                        id = "github";
                        title = "GitHub";
                        description = "GitHub notifications";
                        type = "poll";
                      }
                    ];
                  })
                  "run"
                ];
              };

              filesystem = {
                kind = "mcp";
                transport = "stdio";
                command = lib.getExe mcp-server-filesystem-bwrap;
                env.FS_BASE_DIR = cormWorkspaceDir;
              };
            };

            runtime.js.kind = "js";

            agents.${cormAgent} = {
              runtime = "js";
              script = cormScript;
            };

            memory = lib.optionalAttrs (cormConfigModel != null) {
              ${cormAgent} = {
                "corm_config" = {
                  model = cormConfigModel;
                }
                // cormConfig;
              }
              // cormMemory;
            };
          }
          // lib.optionalAttrs (cormEndpointHost != null && cormEndpointPort != null) {
            endpoint = {
              kind = "openai";
              listen = "${cormEndpointHost}:${builtins.toString cormEndpointPort}";
            };
          };
        in
        toml.generate "omw.toml" (lib.recursiveUpdate settings cormOverrideSettings)
        // {
          cormAttrs = {
            inherit settings;

            name = cormName;

            agent = cormAgent;

            stateDir = cormStateDir;
            workspaceDir = cormWorkspaceDir;
            dataDir = cormDataDir;

            script = cormScript;
            config = cormConfig;
            memory = cormMemory;
            tunables = cormTunables;

            gpuHost = cormGpuHost;
            gpuPort = cormGpuPort;
            gpuModel = cormGpuModel;

            cpuHost = cormCpuHost;
            cpuPort = cormCpuPort;
            cpuModel = cormCpuModel;

            remoteBaseUrl = cormRemoteBaseUrl;
            remoteModel = cormRemoteModel;

            embeddingHost = cormEmbeddingHost;
            embeddingPort = cormEmbeddingPort;
            embeddingModel = cormEmbeddingModel;

            endpointHost = cormEndpointHost;
            endpointPort = cormEndpointPort;

            overrideSettings = cormOverrideSettings;

            bwrapArgs = cormBwrapArgs;
          };
        }
      ) { };
    in
    {
      cormPackages = (prev.cormPackages or { }) // {
        omw-config = package;
        omw-scaffold-config = package.override rec {
          cormName = "corm";

          cormStateDir = "/tmp/${cormName}-scaffold";

          cormCpuHost = "127.0.0.1";
          cormCpuPort = selfLib.ports.cpu-provider;
          cormCpuModel = "model";

          cormGpuHost = "127.0.0.1";
          cormGpuPort = selfLib.ports.gpu-provider;
          cormGpuModel = "model";

          cormEmbeddingHost = "127.0.0.1";
          cormEmbeddingPort = selfLib.ports.embedding;
          cormEmbeddingModel = "model";

          cormRemoteBaseUrl = selfLib.openrouter.baseUrl;
          cormRemoteModel = selfLib.openrouter.model;

          cormEndpointHost = "127.0.0.1";
          cormEndpointPort = selfLib.ports.endpoint;

          cormOverrideSettings = {
            tooling.github.env.GITHUB_PERSONAL_ACCESS_TOKEN = builtins.readFile (
              final.runCommand "ghp" { nativeBuildInputs = [ final.openssl ]; } ''
                printf "ghp_%s" "$(openssl rand -base64 36)" > "$out"
              ''
            );
            tooling.git.env.GIT_SSH_KEY = builtins.readFile (
              final.runCommand "id_ed25519" { nativeBuildInputs = [ final.openssh ]; } ''
                ssh-keygen -f key -N ""
                mv key "$out"
              ''
            );
          };
        };
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    let
      cormPackages =
        (pkgs.extend (lib.composeManyExtensions (selfLib.overlays.inputs ++ selfLib.overlays.self)))
        .cormPackages;

    in
    {
      packages = {
        inherit (cormPackages)
          omw-config
          omw-scaffold-config
          ;
      };
    };
}
