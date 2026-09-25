{ selfLib, ... }:

{
  flake.nixosModules.corm-gpu-provider-llama-cpp =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      gpu = selfLib.provider "gpu";
      cfg = config.corm.gpu-provider;
      kindCfg = cfg.kind.llama-cpp;

      enabled = cfg.enable && cfg.kind ? llama-cpp;
    in
    {
      config = {
        corm.gpu-provider.kinds.llama-cpp = lib.mkOption {
          description = "llama.cpp GPU provider.";
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
                out="${gpu.statePath}/model.gguf"
                stamp="${gpu.statePath}/model.path"

                if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$src" ] && [ -f "$out" ]; then
                  exit 0
                fi

                rm -f "$out" "$stamp" "${gpu.statePath}/model-f16.gguf"

                "${lib.getExe pkgs.cormPackages.llama-cpp-convert}" "$src" \
                  --outtype f16 \
                  --outfile "${gpu.statePath}/model-f16.gguf"
                "${lib.getExe' kindCfg.package "llama-quantize"}" \
                  "${gpu.statePath}/model-f16.gguf" "$out" "${kindCfg.quant}"
                rm -f "${gpu.statePath}/model-f16.gguf"

                printf '%s' "$src" > "$stamp"
              '';
            };
          }
        );

        systemd.services."corm-gpu-provider" = lib.mkIf enabled (
          gpu.serveService
          // {
            serviceConfig = gpu.serveService.serviceConfig // {
              ExecStart = builtins.concatStringsSep " " (
                [
                  (lib.getExe' kindCfg.package "llama-server")
                  "--host"
                  cfg.host
                  "--port"
                  (builtins.toString cfg.port)
                  "--model"
                  "${gpu.statePath}/model.gguf"
                  "--alias"
                  cfg.model.passthru.modelName
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
                ++ selfLib.llama.mmapArgs kindCfg.package
                ++ lib.optionals (kindCfg.package.passthru ? fateMoeCache) [
                  "--fate"
                  "--fate-cache"
                  (builtins.toString kindCfg.fate)
                ]
              );
            };
          }
        );
      };
    };
}
