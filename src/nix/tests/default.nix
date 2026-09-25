{
  config,
  lib,
  self,
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

            checked = lib.mkOption {
              type = lib.types.bool;
              default = !config.cuda;
              description = "Whether the test will be part of checks.";
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

  config = {
    lib = {
      test.make =
        system: test:
        let
          pkgs = self.lib.pkgs.make {
            inherit system;
            cuda = test.cuda;
          };
        in
        pkgs.testers.runNixOSTest {
          imports = [
            test.module
            {
              name = "corm-${test.name}";
              globalTimeout = 300;

              node.pkgsReadOnly = lib.mkForce false;

              defaults = {
                imports = [ self.nixosModules.corm ];

                systemd.targets.corm.after = lib.mkForce [ ];

                system.stateVersion = "26.05";
              };
            }
          ]
          # NOTE: https://applicative.systems/nixos-test-driver-manual/tutorials/cuda-tests/
          ++ lib.optional test.cuda {
            requiredFeatures = {
              cuda = true;
              nvidia-gpu = true;
            };

            defaults = { pkgs, ... }: {
              nixpkgs.config = lib.optionalAttrs test.cuda {
                cudaSupport = true;
                allowUnfree = true;
              };

              systemd.services.cuda-check = {
                wantedBy = [ "multi-user.target" ];
                path = [ pkgs.cudaPackages.saxpy ];
                script = "saxpy 2>&1";
                serviceConfig = {
                  Type = "oneshot";
                  RemainAfterExit = true;
                };
              };

              virtualisation.systemd-nspawn.options = [
                "--bind=/host/run/opengl-driver:/run/opengl-driver"
                "--bind=/dev/dri:/dev/dri"

                "--bind=/dev/nvidia-modeset:/dev/nvidia-modeset"
                "--bind=/dev/nvidia-uvm-tools:/dev/nvidia-uvm-tools"
                "--bind=/dev/nvidiactl:/dev/nvidiactl"
                "--bind=/dev/nvidia-uvm:/dev/nvidia-uvm"
                "--bind=/dev/nvidia0:/dev/nvidia0"
                "--bind=/dev/nvidiactl:/dev/nvidiactl"
              ];
            };
          };
        };

      tests = builtins.listToAttrs (
        builtins.map (system: {
          name = system;
          value = lib.mapAttrs' (_: test: {
            name = "corm-${test.name}";
            value = self.lib.test.make system test;
          }) config.corm.tests;
        }) config.systems
      );
    };

    perSystem =
      { pkgs, system, ... }:
      {
        checks = lib.mapAttrs' (_: test: {
          name = "test-corm-${test.name}";
          value = self.lib.test.make system test;
        }) (lib.filterAttrs (_: test: test.checked) config.corm.tests);
      };
  };
}
