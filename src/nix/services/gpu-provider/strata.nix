{ selfLib, ... }:

{
  flake.nixosModules.corm-gpu-provider-strata =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      gpu = selfLib.provider "gpu";
      cfg = config.corm.gpu-provider;
      kindCfg = cfg.kind.strata;

      enabled = cfg.enable && cfg.kind ? strata;

      strataEngine = pkgs.cormPackages.strata-engine.override {
        inherit (kindCfg) cudaArchitectures portable march;
      };

      strataServer = kindCfg.package.override { inherit strataEngine; };

      strataConfig = pkgs.writeText "strata-config.json" (
        builtins.toJSON (
          {
            exe = lib.getExe strataEngine;

            args = [
              "--pack"
              "${pkgs.cormPackages.strata-pack cfg.model}"
              "--native"
              "${cfg.model}/${cfg.model.passthru.shard1}"
              "--ple-gguf"
              "${cfg.model}/${cfg.model.passthru.pleShard}"
              "--expert-profile"
              "${strataServer}/share/strata/data/expert-profile.bin"
              "--expert-cache"
              "auto"
              "--prefill"
              kindCfg.prefill
              "--spec"
              (builtins.toString kindCfg.spec)
              "--spec-min-p"
              (builtins.toString kindCfg.specMinP)
              "--mtp"
              "${pkgs.cormPackages.strata-mtp}"
              "--max-context"
              (builtins.toString cfg.ctx)
            ]
            ++ lib.optionals (cfg.ctx > 8192) [
              "--kv"
              kindCfg.kv
            ]
            ++ lib.optionals (cfg.ctx >= 65536) [
              "--kv-resident"
              "32768"
            ]
            ++ lib.optionals (kindCfg.vision != "none") [
              "--vision"
            ]
            ++ lib.optionals (kindCfg.vramReserveMib != null) [
              "--vram-reserve-mib"
              (builtins.toString kindCfg.vramReserveMib)
            ]
            ++ kindCfg.extraArgs;

            cwd = gpu.statePath;
            tokenizer = "${pkgs.cormPackages.strata-pack cfg.model}/tokenizer";
            model_name = cfg.model.passthru.modelName;
            log = "${gpu.statePath}/strata.log";
            lib_dirs = [ ];
            host = cfg.host;
            port = cfg.port;
          }
          // lib.optionalAttrs (kindCfg.vision != "none") {
            vision = {
              exe = "${strataEngine}/bin/strata-vision";
              mmproj = "${cfg.model}/${cfg.model.passthru.mmproj}";
              model = "${cfg.model}/${cfg.model.passthru.shard1}";
              gpu = (kindCfg.vision == "gpu");
              max_tokens = 4096;
            };
          }
          // lib.optionalAttrs (kindCfg.gpu != null) {
            gpu = kindCfg.gpu;
          }
        )
      );
    in
    {
      config = {
        corm.gpu-provider.kinds.strata = lib.mkOption {
          description = "Strata GPU provider (Qwen3.8-Flash-Next IQ2_XS).";
          type = lib.types.submodule {
            options = {
              package = lib.mkOption {
                description = "Strata server package to use.";
                type = lib.types.package;
                default = pkgs.cormPackages.strata;
              };

              cudaArchitectures = lib.mkOption {
                description = "CUDA compute capabilities to compile the engine for. Read your card's with `nvidia-smi --query-gpu=compute_cap --format=csv` (e.g. 8.6 for an RTX 3060), then use it without the dot (\"86\").";
                type = lib.types.listOf lib.types.str;
                default = [
                  "75"
                  "80"
                  "86"
                  "89"
                  "120"
                ];
              };

              portable = lib.mkOption {
                description = "Build ggml for a portable AVX2 baseline instead of the build machine's native CPU, keeping the build deterministic and substitutable.";
                type = lib.types.bool;
                default = true;
              };

              march = lib.mkOption {
                description = "Optional `-march` level for the CPU code (e.g. `x86-64-v3`, `znver4`); empty keeps the portable baseline.";
                type = lib.types.str;
                default = "";
              };

              vision = lib.mkOption {
                description = "Run the multimodal image encoder on the GPU, on the CPU, or not at all.";
                type = lib.types.enum [
                  "none"
                  "gpu"
                  "cpu"
                ];
                default = "none";
              };

              vramReserveMib = lib.mkOption {
                description = "VRAM (MiB) to leave free for other programs (`--vram-reserve-mib`); the GPU expert cache is sized to the rest. Null keeps the engine's default (700 MiB).";
                type = lib.types.nullOr lib.types.ints.unsigned;
                default = null;
              };

              kv = lib.mkOption {
                description = "KV cache type for contexts above 8192.";
                type = lib.types.enum [
                  "fp16"
                  "int8"
                ];
                default = "int8";
              };

              prefill = lib.mkOption {
                description = "Prompt prefill chunk size (`--prefill`).";
                type = lib.types.str;
                default = "auto";
              };

              spec = lib.mkOption {
                description = "MTP speculative draft tokens (`--spec`).";
                type = lib.types.ints.unsigned;
                default = 4;
              };

              specMinP = lib.mkOption {
                description = "Minimum draft acceptance probability (`--spec-min-p`).";
                type = lib.types.float;
                default = 0.5;
              };

              gpu = lib.mkOption {
                description = "Optional GPU index or UUID for the engine (`--gpu`).";
                type = lib.types.nullOr lib.types.str;
                default = null;
              };

              extraArgs = lib.mkOption {
                description = "Extra arguments passed to the Strata engine.";
                type = lib.types.listOf lib.types.str;
                default = [ ];
              };
            };
          };
          default = { };
        };

        assertions = lib.mkIf enabled [
          {
            assertion =
              cfg.model.passthru ? repo
              && cfg.model.passthru.repo == "ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF"
              && cfg.model.passthru ? quant
              && cfg.model.passthru.quant == "IQ2_XS";
            message = "corm.gpu-provider with kind.strata only supports the ISTA-DASLab IQ2_XS GGUF; set corm.gpu-provider.model = pkgs.cormPackages.qwen-3-8-flash-next-iq2-xs.";
          }
        ];

        systemd.services."corm-gpu-provider-prepare" = lib.mkIf enabled (
          gpu.prepareService
          // {
            environment = {
              HOME = gpu.statePath;
              XDG_CACHE_HOME = "${gpu.statePath}/.cache";
            };
            serviceConfig = gpu.prepareService.serviceConfig // {
              ExecStart = "${pkgs.coreutils}/bin/true";
            };
          }
        );

        systemd.services."corm-gpu-provider" = lib.mkIf enabled (
          gpu.serveService
          // {
            environment = {
              HOME = gpu.statePath;
              XDG_CACHE_HOME = "${gpu.statePath}/.cache";
            };
            serviceConfig = gpu.serveService.serviceConfig // {
              StateDirectory = gpu.stateDir;
              LimitMEMLOCK = "infinity";
              ExecStart = builtins.concatStringsSep " " [
                (lib.getExe strataServer)
                "--config"
                "${strataConfig}"
                "--port"
                (builtins.toString cfg.port)
              ];
            };
          }
        );
      };
    };
}
