{ self, ... }:

{
  flake.nixosModules.corm-embedding =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      cfg = config.corm.embedding;
      kind = builtins.head (builtins.attrNames cfg.kind);
      kindCfg = cfg.kind.${kind};

      stateDir = "corm-embedding";
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
        before = [ "corm-embedding.service" ];
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
        after = [ "corm-embedding-prepare.service" ];
        requires = [ "corm-embedding-prepare.service" ];
        serviceConfig = hardening // {
          Environment = [ "CUDA_VISIBLE_DEVICES=" ];
          Restart = "on-failure";
          RestartSec = 5;
        };
      };
    in
    {
      options.corm.embedding = {
        enable = lib.mkEnableOption "Corm embedding provider";

        model = lib.mkOption {
          type = lib.types.package;
          default = pkgs.cormPackages.qwen-3-embedding;
          description = "HuggingFace checkpoint to convert and run.";
        };

        ctx = lib.mkOption {
          type = lib.types.ints.unsigned;
          default = 32768;
          description = "Context size to allocate KV cache for.";
        };

        host = lib.mkOption {
          type = lib.types.str;
          default = "127.0.0.1";
          description = "Binding host for the embedding service.";
        };

        port = lib.mkOption {
          type = lib.types.port;
          default = self.lib.ports.embedding;
          description = "Binding port for the embedding service.";
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
                    default = "Q8_0";
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
            systemd.services."corm-embedding-prepare" = prepareService // {
              environment = {
                HOME = statePath;
                XDG_CACHE_HOME = "${statePath}/.cache";
                HF_HOME = "${statePath}/hf";
              };
              serviceConfig = prepareService.serviceConfig // {
                ExecStart = pkgs.writeShellScript "corm-embedding-prepare" ''
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

            systemd.services."corm-embedding" = serveService // {
              serviceConfig = serveService.serviceConfig // {
                ExecStart = builtins.concatStringsSep " " ([
                  (lib.getExe' kindCfg.package "llama-server")
                  "--model"
                  "${statePath}/model.gguf"
                  "--alias"
                  cfg.model.modelName
                  "--embeddings"
                  "--pooling"
                  "last"
                  "--sleep-idle-seconds"
                  "900"
                  "--host"
                  cfg.host
                  "--port"
                  (builtins.toString cfg.port)
                  "--load-mode"
                  "mmap"
                  "--cache-type-k"
                  "q8_0"
                  "--cache-type-v"
                  "q8_0"
                  "--ubatch-size"
                  (builtins.toString kindCfg.ubatch)
                  "--ctx-size"
                  (builtins.toString cfg.ctx)
                ]);
              };
            };
          })
        ]
      );
    };
}
