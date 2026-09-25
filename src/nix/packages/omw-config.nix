{ self, ... }:

{
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

          cormStateDir ? "/var/lib/${cormName}",
          cormWorkspaceDir ? "${cormStateDir}/workspace",
          cormDataDir ? "${cormStateDir}/data",

          cormScript ? "${cormPackages.corm}/index.js",

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
          ...
        }:
        let
          toml = formats.toml { };

          mcp-server-filesystem-bwrap = cormPackages.mcp-server-filesystem-bwrap;
          git-mcp-server-ssh-agent = cormPackages.git-mcp-server-ssh-agent;

          settings = {
            # TODO: figure out how to run without this
            tunables.allow_unlocked_secrets = true;

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

            agents.corm = {
              runtime = "js";
              script = cormScript;
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

            stateDir = cormStateDir;
            workspaceDir = cormWorkspaceDir;
            dataDir = cormDataDir;

            script = cormScript;

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
          cormCpuPort = self.lib.ports.cpu-provider;
          cormCpuModel = "model";

          cormGpuHost = "127.0.0.1";
          cormGpuPort = self.lib.ports.gpu-provider;
          cormGpuModel = "model";

          cormEmbeddingHost = "127.0.0.1";
          cormEmbeddingPort = self.lib.ports.embedding;
          cormEmbeddingModel = "model";

          cormRemoteBaseUrl = self.lib.openrouter.baseUrl;
          cormRemoteModel = self.lib.openrouter.model;

          cormEndpointHost = "127.0.0.1";
          cormEndpointPort = self.lib.ports.endpoint;

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
    {
      packages = {
        inherit
          ((pkgs.extend (lib.composeManyExtensions (self.lib.overlays.inputs ++ self.lib.overlays.self)))
            .cormPackages
          )
          omw-config
          omw-scaffold-config
          ;
      };
    };
}
