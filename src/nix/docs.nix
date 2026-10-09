{ self, ... }:

{
  perSystem =
    {
      lib,
      system,
      selfLib,
      ...
    }:
    lib.optionalAttrs (system == "x86_64-linux") {
      packages =
        let
          # The NixOS module defaults reference `pkgs.cormPackages.*`, including
          # CUDA-only provider packages, so document against the same
          # CUDA-enabled package set a deployment uses.
          cormPkgs =
            (selfLib.makePkgs {
              inherit system;
              cuda = true;
            }).extend
              (lib.composeManyExtensions selfLib.overlays.self);

          eval = import (cormPkgs.path + "/nixos/lib/eval-config.nix") {
            inherit system;
            pkgs = cormPkgs;
            modules = [
              lib.types.noCheckForDocsModule
              self.nixosModules.corm
              {
                nixpkgs.config = {
                  cudaSupport = true;
                  allowUnfree = true;
                };
              }
            ];
          };

          optionsDoc =
            (cormPkgs.nixosOptionsDoc {
              documentType = "mdbook";
              warningsAreErrors = false;
              options = eval.options;
              transformOptions =
                opt:
                opt
                // {
                  visible = (opt.visible or true) && (builtins.head opt.loc) == "corm";
                  declarations = [ ];
                };
            }).optionsCommonMark;
        in
        {
          options = optionsDoc;

          docs =
            cormPkgs.runCommand "corm-docs"
              {
                src = self;
                nativeBuildInputs = [ cormPkgs.mdbook ];
              }
              ''
                mdbook build -d "$out" "$src/docs"
              '';
        };
    };
}
