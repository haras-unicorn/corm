{ self, ... }:

{
  flake.nixosModules.corm-gpu-provider =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      cfg = config.corm.gpu-provider;
      kind = builtins.head (builtins.attrNames cfg.kind);
      kindCfg = cfg.kind.${kind};

      stateDir = "corm-gpu-provider";
      statePath = "/var/lib/${stateDir}";

      hardening = {
        ProtectSystem = "strict";
        ProtectHome = "read-only";
        PrivateTmp = true;
        NoNewPrivileges = true;
        LockPersonality = true;
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_NETLINK"
          "AF_UNIX"
        ];
        IPAddressDeny = "any";
        IPAddressAllow = [
          "127.0.0.0/8"
          "::1"
        ];
      };

      prepareService = {
        requiredBy = [ "corm.target" ];
        bindsTo = [ "corm.target" ];
        before = [ "corm-gpu-provider.service" ];
        serviceConfig = hardening // {
          Type = "oneshot";
          RemainAfterExit = true;
          StateDirectory = stateDir;
          Restart = "on-failure";
          RestartSec = 5;
        };
      };

      serveService = {
        requiredBy = [ "corm.target" ];
        bindsTo = [ "corm.target" ];
        after = [ "corm-gpu-provider-prepare.service" ];
        requires = [ "corm-gpu-provider-prepare.service" ];
        serviceConfig = hardening // {
          Restart = "on-failure";
          RestartSec = 5;
        };
      };
    in
    {
      options.corm.gpu-provider = {
        enable = lib.mkEnableOption "Corm GPU provider";

        model = lib.mkOption {
          type = lib.types.package;
          default = pkgs.cormPackages.occamy;
          description = "HuggingFace checkpoint to convert and run.";
        };

        ctx = lib.mkOption {
          type = lib.types.ints.unsigned;
          default = 196608;
          description = "Context size to allocate KV cache for.";
        };

        host = lib.mkOption {
          type = lib.types.str;
          default = "127.0.0.1";
          description = "Binding host for the GPU provider service.";
        };

        port = lib.mkOption {
          type = lib.types.port;
          default = self.lib.ports.gpu-provider;
          description = "Binding port for the GPU provider service.";
        };

        kind = lib.mkOption {
          default = {
            llama-cpp = { };
          };
          type = lib.types.attrTag {
            llama-cpp = lib.mkOption {
              type = lib.types.submodule {
                options = {
                  package = lib.mkOption {
                    description = "llama.cpp package to use.";
                    type = lib.types.package;
                    default =
                      if config.nixpkgs.config.cudaSupport then
                        pkgs.cormPackages.llama-cpp-moe-cache-cuda
                      else
                        pkgs.llama-cpp;
                  };

                  ubatch = lib.mkOption {
                    description = "--ubatch-size for llama.cpp to use.";
                    type = lib.types.ints.unsigned;
                    default = 2048;
                  };

                  fate = lib.mkOption {
                    description = "--fate-cache for llama.cpp to use. Only used with the FATE MoE cache llama.cpp package.";
                    type = lib.types.ints.unsigned;
                    default = 4096;
                  };

                  quant = lib.mkOption {
                    description = "llama-quantize output type to quantize the converted checkpoint to.";
                    type = lib.types.str;
                    default = "Q4_K_M";
                  };
                };
              };
            };

            freetoken = lib.mkOption {
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
            };
          };
        };
      };

      config = lib.mkIf cfg.enable (
        lib.mkMerge [
          (lib.mkIf (kind == "llama-cpp") {
            systemd.services."corm-gpu-provider-prepare" = prepareService // {
              environment = {
                HOME = statePath;
                XDG_CACHE_HOME = "${statePath}/.cache";
                HF_HOME = "${statePath}/hf";
              };
              serviceConfig = prepareService.serviceConfig // {
                ExecStart = pkgs.writeShellScript "corm-gpu-provider-prepare" ''
                  set -euo pipefail

                  src="${toString cfg.model}"
                  out="${statePath}/model.gguf"
                  stamp="${statePath}/model.path"

                  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$src" ] && [ -f "$out" ]; then
                    exit 0
                  fi

                  rm -f "$out" "$stamp" "${statePath}/model-f16.gguf"

                  "${lib.getExe pkgs.cormPackages.llama-cpp-convert}" "$src" \
                    --outtype f16 \
                    --outfile "${statePath}/model-f16.gguf"
                  "${lib.getExe' kindCfg.package "llama-quantize"}" \
                    "${statePath}/model-f16.gguf" "$out" "${kindCfg.quant}"
                  rm -f "${statePath}/model-f16.gguf"

                  printf '%s' "$src" > "$stamp"
                '';
              };
            };

            systemd.services."corm-gpu-provider" = serveService // {
              serviceConfig = serveService.serviceConfig // {
                ExecStart = builtins.concatStringsSep " " (
                  [
                    (lib.getExe' kindCfg.package "llama-server")
                    "--host"
                    cfg.host
                    "--port"
                    (builtins.toString cfg.port)
                    "--model"
                    "${statePath}/model.gguf"
                    "--alias"
                    cfg.model.modelName
                    "--ctx-size"
                    (builtins.toString cfg.ctx)
                    "--flash-attn"
                    "on"
                    "--gpu-layers"
                    "all"
                    "--cache-type-k"
                    "q8_0"
                    "--cache-type-v"
                    "q8_0"
                    "--ubatch-size"
                    (builtins.toString kindCfg.ubatch)
                  ]
                  ++ self.lib.llama.mmapArgs kindCfg.package
                  ++ lib.optionals (kindCfg.package ? fateMoeCache) [
                    "--fate"
                    "--fate-cache"
                    (builtins.toString kindCfg.fate)
                  ]
                );
              };
            };
          })

          (lib.mkIf (kind == "freetoken") {
            systemd.services."corm-gpu-provider-prepare" = prepareService // {
              environment = {
                HOME = statePath;
                XDG_CACHE_HOME = "${statePath}/.cache";
                HF_HOME = "${statePath}/hf";
              };
              serviceConfig = prepareService.serviceConfig // {
                ExecStart = pkgs.writeShellScript "corm-gpu-provider-prepare" ''
                  set -euo pipefail

                  src="${toString cfg.model}"
                  out="${statePath}/model.ftw"
                  stamp="${statePath}/model.path"

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
            };

            systemd.services."corm-gpu-provider" = serveService // {
              environment = {
                HOME = statePath;
                XDG_CACHE_HOME = "${statePath}/.cache";
                HF_HOME = "${statePath}/hf";
              };
              serviceConfig = serveService.serviceConfig // {
                StateDirectory = stateDir;
                LimitMEMLOCK = "infinity";
                ExecStart = builtins.concatStringsSep " " (
                  [
                    (lib.getExe' kindCfg.package "ft")
                    "serve"
                    "--model"
                    "${statePath}/model.ftw"
                    "--served-model-name"
                    cfg.model.modelName
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
            };
          })
        ]
      );
    };
}
