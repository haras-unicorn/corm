{
  inputs,
  self,
  lib,
  config,
  ...
}:

{
  # NOTE: flake-parts complaining it can't determine whether
  # there is a formatter for all systems
  imports = [ inputs.flake-parts.flakeModules.touchup ];

  options = {
    lib = lib.mkOption {
      type = lib.types.attrsOf lib.types.raw;
      default = { };
      description = "Merged flake library.";
    };
  };

  config = {
    lib.pkgs.make =
      {
        system,
        cuda ? false,
        ...
      }:
      import inputs.nixpkgs {
        inherit system;
        config = lib.optionalAttrs cuda {
          cudaSupport = true;
          allowUnfree = true;
        };
        overlays = self.lib.overlays.inputs ++ [
          (_: prev: {
            nixos-test-driver = prev.nixos-test-driver.overrideAttrs (old: {
              patches = old.patches or [ ] ++ [ ./nixos-test-driver-gpu.patch ];
            });
          })
        ];
      };

    flake.lib = config.lib;

    touchup.attr.formatter.enable = false;

    systems = [
      "x86_64-linux"
      "aarch64-linux"
    ];

    perSystem = { system, ... }: {
      _module.args.pkgs = self.lib.pkgs.make { inherit system; };
    };
  };
}
