{ self, selfLib, ... }:

{
  flake.overlays.llama-cpp =
    final: prev:
    let
      pkgs = final;
      lib = prev.lib;
      cuda = prev.config.cudaSupport;

      package = pkgs.llama-cpp.overrideAttrs {
        version = "10362";
        src = pkgs.fetchFromGitHub {
          owner = "haras-unicorn";
          repo = "llama.cpp";
          rev = "4f3701bc44ec7e51b5401593c6269b8cc694fe28";
          hash = "sha256-Z2S+RBm5uBuGfuFNWhI+lOLW73k+cKEkt5FMB2nxepo=";
          leaveDotGit = true;
          postFetch = ''
            git -C "$out" rev-parse --short HEAD > $out/COMMIT
            find "$out" -name .git -print0 | xargs -0 rm -rf
          '';
        };
        npmDepsHash = "sha256-2Q7XhaLAArmviOLdQsNbYTfdyDE5pW9lR26cRHEVl9k=";
      };
    in
    (lib.optionalAttrs cuda {
      cormPackages = (prev.cormPackages or { }) // {
        llama-cpp = final.llama-cpp;
        llama-cpp-moe-cache-cuda = package // {
          passthru.fateMoeCache = true;
        };
      };
    });

  perSystem =
    {
      lib,
      pkgs,
      system,
      ...
    }:
    let
      cormPackages =
        (
          (selfLib.makePkgs {
            inherit system;
            cuda = true;
          }).extend
            self.overlays.llama-cpp
        ).cormPackages;
    in
    {
      packages.llama-cpp = cormPackages.llama-cpp;
      apps.llama-cpp = {
        type = "app";
        program = lib.getExe cormPackages.llama-cpp;
        meta.description = "llama.cpp local inference server";
      };
      packages.llama-cpp-moe-cache-cuda = cormPackages.llama-cpp-moe-cache-cuda;
      apps.llama-cpp-moe-cache-cuda = {
        type = "app";
        program = lib.getExe cormPackages.llama-cpp-moe-cache-cuda;
        meta.description = "llama.cpp with FATE MoE cache patches for CUDA";
      };
    };
}
