{
  inputs,
  lib,
  selfLib,
  ...
}:

{
  corm.lib = {
    makePkgs =
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
        # NOTE: https://applicative.systems/nixos-test-driver-manual/tutorials/cuda-tests/
        overlays = selfLib.overlays.inputs ++ [
          (_: prev: {
            nixos-test-driver = prev.nixos-test-driver.overrideAttrs (old: {
              patches = old.patches or [ ] ++ [ ./nixos-test-driver-gpu.patch ];
            });
          })
        ];
      };

    # NOTE: https://applicative.systems/nixos-test-driver-manual/tutorials/cuda-tests/
    cudaNixosModule = { pkgs, options, ... }: {
      nixpkgs.config = {
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
        (
          if options ? testing then
            "--bind=/host/run/opengl-driver:/run/opengl-driver"
          else
            "--bind=/run/opengl-driver:/run/opengl-driver"
        )
        "--bind=/dev/dri:/dev/dri"

        "--bind=/dev/nvidia-modeset:/dev/nvidia-modeset"
        "--bind=/dev/nvidia-uvm-tools:/dev/nvidia-uvm-tools"
        "--bind=/dev/nvidiactl:/dev/nvidiactl"
        "--bind=/dev/nvidia-uvm:/dev/nvidia-uvm"
        "--bind=/dev/nvidia0:/dev/nvidia0"
        "--bind=/dev/nvidiactl:/dev/nvidiactl"
      ];
    };

    cudaTestModule = { lib, ... }: {
      node.pkgsReadOnly = lib.mkForce false;

      requiredFeatures = {
        cuda = true;
        nvidia-gpu = true;
      };

      defaults = selfLib.cudaNixosConfigModule;
    };
  };

  perSystem = { system, ... }: {
    _module.args.pkgs = selfLib.makePkgs { inherit system; };
  };
}
