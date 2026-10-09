{ selfLib, ... }:

{
  flake.nixosModules.corm-gpu-provider-options =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    {
      options.corm.gpu-provider = {
        enable = lib.mkEnableOption "Corm GPU provider";

        kinds = lib.mkOption {
          type = lib.types.attrsOf lib.types.raw;
          default = { };
          internal = true;
          description = "GPU provider kinds registered by the `gpu-provider/*.nix` files; each value is an option. `kind`'s attrTag is built from this.";
        };

        kind = lib.mkOption {
          type = lib.types.attrTag config.corm.gpu-provider.kinds;
          default = {
            llama-cpp = { };
          };
          description = "Which GPU provider kind to run.";
        };

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
          default = selfLib.ports.gpu-provider;
          description = "Binding port for the GPU provider service.";
        };
      };
    };
}
