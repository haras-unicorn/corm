{ inputs, self, ... }:

{
  flake.nixosModules.corm-omw =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      cfg = config.corm.omw;

      settingsFile = pkgs.cormPackages.omw-config.override (
        {
          cormName = "corm";

          cormAgent = cfg.agent;

          cormStateDir = "/var/lib/${config.services.omw.stateDir}";
          cormWorkspaceDir = "/var/lib/${config.services.omw.stateDir}/workspace";
          cormDataDir = "/var/lib/${config.services.omw.stateDir}/data";

          cormScript = "${cfg.script}";
          cormConfig = config.corm.settings;
          cormMemory = cfg.memory;
          cormTunables = cfg.tunables;
          cormBwrapArgs = cfg.bwrapArgs;
        }
        // lib.optionalAttrs config.corm.gpu-provider.enable {
          cormGpuHost = config.corm.gpu-provider.host;
          cormGpuPort = config.corm.gpu-provider.port;
          cormGpuModel = config.corm.gpu-provider.model.passthru.modelName;
        }
        // lib.optionalAttrs config.corm.cpu-provider.enable {
          cormCpuHost = config.corm.cpu-provider.host;
          cormCpuPort = config.corm.cpu-provider.port;
          cormCpuModel = config.corm.cpu-provider.model.passthru.modelName;
        }
        // lib.optionalAttrs config.corm.remote-provider.enable {
          cormRemoteBaseUrl = config.corm.remote-provider.baseUrl;
          cormRemoteModel = config.corm.remote-provider.model;
        }
        // lib.optionalAttrs config.corm.embedding.enable {
          cormEmbeddingHost = config.corm.embedding.host;
          cormEmbeddingPort = config.corm.embedding.port;
          cormEmbeddingModel = config.corm.embedding.model.passthru.modelName;
        }
        // lib.optionalAttrs config.corm.endpoint.enable {
          cormEndpointHost = config.corm.endpoint.host;
          cormEndpointPort = config.corm.endpoint.port;
        }
      );
    in
    {
      imports = [
        inputs.omw.nixosModules.default

        self.nixosModules.corm-gpu-provider
        self.nixosModules.corm-cpu-provider
        self.nixosModules.corm-remote-provider
        self.nixosModules.corm-embedding
      ];

      options.corm.omw = {
        enable = lib.mkEnableOption "the Corm omw agent runtime";

        agent = lib.mkOption {
          type = lib.types.str;
          default = "corm";
          description = "The name of the agent the brain runs as. This is also the endpoint model name the agent subscribes under.";
        };

        variant = lib.mkOption {
          type = lib.types.enum [
            "default"
            "rhai"
            "js"
          ];
          default = "js";
          description = "Which omw runtime variant to run.";
        };

        script = lib.mkOption {
          type = lib.types.path;
          default = "${pkgs.cormPackages.corm}/index.js";
          defaultText = "corm-index.js";
          description = "The JavaScript brain script omw runs.";
        };

        memory = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { };
          description = "Extra memory keys seeded into the agent's memory before its brain first runs.";
        };

        tunables = lib.mkOption {
          type = lib.types.attrsOf lib.types.raw;
          default = { };
          description = "Extra tunables to pass to omw.";
        };

        bwrapArgs = lib.mkOption {
          type = lib.types.nullOr (lib.types.listOf lib.types.str);
          default = null;
          description = "Extra bubblewrap arguments passed to the bubblewrap MCP servers. Null keeps the platform defaults (selfLib.bwrap.base); containers use selfLib.bwrap.container.";
        };

        mode = lib.mkOption {
          type = lib.types.enum [
            "run"
            "loop"
          ];
          default = "loop";
          description = "Run the script once or loop.";
        };

        environment = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { };
          description = "Environment variables for the service.";
        };

        environmentFile = lib.mkOption {
          type = lib.types.nullOr lib.types.path;
          default = null;
          description = "Path to a systemd EnvironmentFile for the service.";
        };
      };

      config = lib.mkIf cfg.enable {
        assertions = [
          {
            assertion =
              config.corm.gpu-provider.enable
              || config.corm.cpu-provider.enable
              || config.corm.remote-provider.enable;
            message = "Corm requires at least one provider to be enabled (corm.gpu-provider, corm.cpu-provider or corm.remote-provider).";
          }
        ];

        services.omw = {
          enable = true;
          variant = cfg.variant;
          mode = cfg.mode;
          user = "corm";
          group = "corm";
          stateDir = "corm";
          environment = cfg.environment;
          environmentFile = cfg.environmentFile;
          # NOTE: setting like this so tests/benchmarks
          # can get settings from here easily
          settings = settingsFile.cormAttrs.settings;
          readOnlyPaths = [ "${cfg.script}" ];
          serviceConfig = {
            UMask = "0077";
            Restart = "on-failure";
            RestartSec = "5s";
          };
        };

        systemd.services.omw = {
          requiredBy = [ "corm.target" ];
          bindsTo = [ "corm.target" ];
          after =
            lib.optionals (config.corm.gpu-provider.enable) [
              "corm-gpu-provider-warmup.service"
            ]
            ++ lib.optionals (config.corm.cpu-provider.enable) [
              "corm-cpu-provider-warmup.service"
            ]
            ++ lib.optionals (config.corm.embedding.enable) [ "corm-embedding.service" ];
        };
      };
    };
}
