{ selfLib, ... }:

{
  flake.nixosModules.corm-gpu-provider-freetoken =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      gpu = selfLib.provider "gpu";
      cfg = config.corm.gpu-provider;
      kindCfg = cfg.kind.freetoken;

      enabled = cfg.enable && cfg.kind ? freetoken;
    in
    {
      config = {
        corm.gpu-provider.kinds.freetoken = lib.mkOption {
          description = "FreeToken GPU provider.";
          type = lib.types.submodule {
            options = {
              package = lib.mkOption {
                description = "FreeToken engine package to use.";
                type = lib.types.package;
                default = pkgs.cormPackages.freetoken-engine;
              };

              gpu = lib.mkOption {
                description = "--gpu (an nvidia-smi index or UUID) for the engine to use.";
                type = lib.types.nullOr lib.types.str;
                default = null;
              };

              memoryRatio = lib.mkOption {
                description = "--memory-ratio for the engine to use.";
                type = lib.types.float;
                default = 0.9;
              };

              moeStrategy = lib.mkOption {
                description = "--moe-strategy for the engine to use.";
                type = lib.types.nullOr (
                  lib.types.enum [
                    "fused"
                    "offload"
                    "cpu"
                    "hybrid"
                  ]
                );
                default = null;
              };

              moeCacheSize = lib.mkOption {
                description = "--moe-cache-size (in expert slots) for the engine to use.";
                type = lib.types.nullOr lib.types.ints.unsigned;
                default = null;
              };

              extraArgs = lib.mkOption {
                description = "Extra arguments passed to `ft serve`.";
                type = lib.types.listOf lib.types.str;
                default = [ ];
              };
            };
          };
          default = { };
        };

        systemd.services."corm-gpu-provider-prepare" = lib.mkIf enabled (
          gpu.prepareService
          // {
            environment = {
              HOME = gpu.statePath;
              XDG_CACHE_HOME = "${gpu.statePath}/.cache";
              HF_HOME = "${gpu.statePath}/hf";
            };
            serviceConfig = gpu.prepareService.serviceConfig // {
              ExecStart = pkgs.writeShellScript "corm-gpu-provider-prepare" ''
                set -euo pipefail

                src="${toString cfg.model}"
                out="${gpu.statePath}/model.ftw"
                stamp="${gpu.statePath}/model.path"

                if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$src" ] && [ -d "$out" ]; then
                  exit 0
                fi

                rm -rf "$out" "$stamp"

                "${lib.getExe' kindCfg.package "ft"}" checkpoint \
                  --model "$src" \
                  --out "$out"

                printf '%s' "$src" > "$stamp"
              '';
            };
          }
        );

        systemd.services."corm-gpu-provider" = lib.mkIf enabled (
          gpu.serveService
          // {
            environment = {
              HOME = gpu.statePath;
              XDG_CACHE_HOME = "${gpu.statePath}/.cache";
              HF_HOME = "${gpu.statePath}/hf";
            };
            serviceConfig = gpu.serveService.serviceConfig // {
              StateDirectory = gpu.stateDir;
              LimitMEMLOCK = "infinity";
              ExecStart = builtins.concatStringsSep " " (
                [
                  (lib.getExe' kindCfg.package "ft")
                  "serve"
                  "--model"
                  "${gpu.statePath}/model.ftw"
                  "--served-model-name"
                  cfg.model.passthru.modelName
                  "--host"
                  cfg.host
                  "--port"
                  (builtins.toString cfg.port)
                  "--max-seq-len-override"
                  (builtins.toString cfg.ctx)
                  "--memory-ratio"
                  (builtins.toString kindCfg.memoryRatio)
                ]
                ++ lib.optionals (kindCfg.gpu != null) [
                  "--gpu"
                  kindCfg.gpu
                ]
                ++ lib.optionals (kindCfg.moeStrategy != null) [
                  "--moe-strategy"
                  kindCfg.moeStrategy
                ]
                ++ lib.optionals (kindCfg.moeCacheSize != null) [
                  "--moe-cache-size"
                  (builtins.toString kindCfg.moeCacheSize)
                ]
                ++ kindCfg.extraArgs
              );
            };
          }
        );
      };
    };
}
