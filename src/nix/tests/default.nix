{
  config,
  lib,
  self,
  selfLib,
  ...
}:

{
  options.corm.tests = lib.mkOption {
    type = lib.types.attrsOf (
      lib.types.submodule (
        { name, config, ... }: {
          options = {
            name = lib.mkOption {
              type = lib.types.str;
              default = name;
              description = "Test name.";
            };

            cuda = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether the test requires CUDA.";
            };

            module = lib.mkOption {
              type = lib.types.deferredModule;
              description = "Test module.";
            };
          };
        }
      )
    );
    default = { };
    description = "Corm NixOS module tests.";
  };

  config.perSystem =
    { pkgs, system, ... }:
    {
      checks = lib.mapAttrs' (_: test: {
        name = "test-corm-${test.name}";
        value =
          let
            pkgs = selfLib.makePkgs {
              inherit system;
              cuda = test.cuda;
            };
          in
          pkgs.testers.runNixOSTest {
            imports = [
              test.module
              {
                name = "corm-${test.name}";
                # NOTE: CI can take its sweet time
                globalTimeout = 3600;

                node.pkgsReadOnly = lib.mkForce false;

                defaults = {
                  imports = [ self.nixosModules.corm ];

                  systemd.targets.corm.after = lib.mkForce [ ];

                  system.stateVersion = "26.05";
                };
              }
            ]
            ++ lib.optional test.cuda selfLib.cudaTestModule;
          };
      }) config.corm.tests;
    };
}
