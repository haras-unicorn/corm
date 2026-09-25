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

          cormStateDir = "/var/lib/${config.services.omw.stateDir}";
          cormWorkspaceDir = "/var/lib/${config.services.omw.stateDir}/workspace";
          cormDataDir = "/var/lib/${config.services.omw.stateDir}/data";

          cormScript = "${cfg.script}";
        }
        // lib.optionalAttrs config.corm.gpu-provider.enable {
          cormGpuHost = config.corm.gpu-provider.host;
          cormGpuPort = config.corm.gpu-provider.port;
          cormGpuModel = config.corm.gpu-provider.model.modelName;
        }
        // lib.optionalAttrs config.corm.cpu-provider.enable {
          cormCpuHost = config.corm.cpu-provider.host;
          cormCpuPort = config.corm.cpu-provider.port;
          cormCpuModel = config.corm.cpu-provider.model.modelName;
        }
        // lib.optionalAttrs config.corm.remote-provider.enable {
          cormRemoteBaseUrl = config.corm.remote-provider.baseUrl;
          cormRemoteModel = config.corm.remote-provider.model;
        }
        // lib.optionalAttrs config.corm.embedding.enable {
          cormEmbeddingHost = config.corm.embedding.host;
          cormEmbeddingPort = config.corm.embedding.port;
          cormEmbeddingModel = config.corm.embedding.model.modelName;
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
          description = "The JavaScript brain script omw runs.";
        };

        mode = lib.mkOption {
          type = lib.types.enum [
            "run"
            "loop"
          ];
          default = "loop";
          description = "Run the script once or loop.";
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
          environmentFile = cfg.environmentFile;
          settingsFile = settingsFile;
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
            lib.optionals (config.corm.gpu-provider.enable) [ "corm-gpu-provider.service" ]
            ++ lib.optionals (config.corm.cpu-provider.enable) [ "corm-cpu-provider.service" ]
            ++ lib.optionals (config.corm.embedding.enable) [ "corm-embedding.service" ];
        };
      };
    };
}
