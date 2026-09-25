{ selfLib, ... }:

{
  flake.nixosModules.corm-cpu-provider =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      cfg = config.corm.cpu-provider;
      kind = builtins.head (builtins.attrNames cfg.kind);
      kindCfg = cfg.kind.${kind};

      provider = selfLib.provider "cpu";
    in
    {
      options.corm.cpu-provider = {
        enable = lib.mkEnableOption "Corm CPU provider";

        model = lib.mkOption {
          type = lib.types.package;
          default = pkgs.cormPackages.gemma-4-e4b;
          description = "HuggingFace checkpoint to convert and run.";
        };

        mmproj = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Export and serve the multimodal projector from the checkpoint.";
        };

        ctx = lib.mkOption {
          type = lib.types.ints.unsigned;
          default = 131072;
          description = "Context size to allocate KV cache for.";
        };

        host = lib.mkOption {
          type = lib.types.str;
          default = "127.0.0.1";
          description = "Binding host for the CPU provider service.";
        };

        port = lib.mkOption {
          type = lib.types.port;
          default = selfLib.ports.cpu-provider;
          description = "Binding port for the CPU provider service.";
        };

        kind = lib.mkOption {
          description = "Backend to run the CPU provider with.";
          default = {
            llama-cpp = { };
          };
          type = lib.types.attrTag {
            llama-cpp = lib.mkOption {
              description = "Run the provider with llama.cpp.";
              type = lib.types.submodule {
                options = {
                  package = lib.mkOption {
                    description = "llama.cpp package to use.";
                    type = lib.types.package;
                    default = pkgs.llama-cpp;
                  };

                  ubatch = lib.mkOption {
                    description = "--ubatch-size for llama.cpp to use.";
                    type = lib.types.ints.unsigned;
                    default = 2048;
                  };

                  quant = lib.mkOption {
                    description = "llama-quantize output type to quantize the converted checkpoint to.";
                    type = lib.types.str;
                    default = "Q4_K_M";
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
            systemd.services."corm-cpu-provider-prepare" = provider.prepareService // {
              environment = {
                HOME = provider.statePath;
                XDG_CACHE_HOME = "${provider.statePath}/.cache";
                HF_HOME = "${provider.statePath}/hf";
              };
              serviceConfig = provider.prepareService.serviceConfig // {
                ExecStart = pkgs.writeShellScript "corm-cpu-provider-prepare" ''
                  set -euo pipefail

                  src="${toString cfg.model}"
                  out="${provider.statePath}/model.gguf"
                  stamp="${provider.statePath}/model.path"

                  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$src" ] && [ -f "$out" ]; then
                    exit 0
                  fi

                  rm -f "$out" "$stamp" "${provider.statePath}/model-f16.gguf" "${provider.statePath}/mmproj.gguf"

                  "${lib.getExe pkgs.cormPackages.llama-cpp-convert}" "$src" \
                    --outtype f16 \
                    --outfile "${provider.statePath}/model-f16.gguf"
                  "${lib.getExe' kindCfg.package "llama-quantize"}" \
                    "${provider.statePath}/model-f16.gguf" "$out" "${kindCfg.quant}"
                  rm -f "${provider.statePath}/model-f16.gguf"

                  ${
                    if cfg.mmproj then
                      ''
                        "${lib.getExe pkgs.cormPackages.llama-cpp-convert}" "$src" \
                          --mmproj \
                          --outtype f16 \
                          --outfile "${provider.statePath}/mmproj.gguf"
                        for f in "${provider.statePath}"/mmproj-*.gguf; do
                          [ -e "$f" ] || continue
                          mv -f "$f" "${provider.statePath}/mmproj.gguf"
                        done
                      ''
                    else
                      ":"
                  }

                  printf '%s' "$src" > "$stamp"
                '';
              };
            };

            systemd.services."corm-cpu-provider" = provider.serveService // {
              serviceConfig = provider.serveService.serviceConfig // {
                Environment = [ "CUDA_VISIBLE_DEVICES=" ];
                ExecStart = builtins.concatStringsSep " " (
                  [
                    (lib.getExe' kindCfg.package "llama-server")
                    "--model"
                    "${provider.statePath}/model.gguf"
                    "--alias"
                    cfg.model.passthru.modelName
                  ]
                  ++ lib.optionals cfg.mmproj [
                    "--mmproj"
                    "${provider.statePath}/mmproj.gguf"
                  ]
                  ++ [
                    "--sleep-idle-seconds"
                    "900"
                    "--host"
                    cfg.host
                    "--port"
                    (builtins.toString cfg.port)
                    "--cache-type-k"
                    "q8_0"
                    "--cache-type-v"
                    "q8_0"
                    "--ubatch-size"
                    (builtins.toString kindCfg.ubatch)
                    "--ctx-size"
                    (builtins.toString cfg.ctx)
                  ]
                  ++ selfLib.llama.mmapArgs kindCfg.package
                );
              };
            };

            systemd.services."corm-cpu-provider-warmup" = provider.warmupService {
              inherit pkgs;
              host = cfg.host;
              port = cfg.port;
              model = cfg.model.passthru.modelName;
            };
          })
        ]
      );
    };
}
