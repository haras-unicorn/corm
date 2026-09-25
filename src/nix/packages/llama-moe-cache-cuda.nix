{ self, ... }:

{
  flake.overlays.llama-cpp-moe-cache-cuda =
    final: prev:
    let
      pkgs = final;

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
    {
      cormPackages = (prev.cormPackages or { }) // {
        llama-cpp-moe-cache-cuda = package // {
          fateMoeCache = true;
        };
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    let
      package =
        (pkgs.extend self.overlays.llama-cpp-moe-cache-cuda).cormPackages.llama-cpp-moe-cache-cuda;
    in
    {
      packages.llama-cpp-moe-cache-cuda = package;
      apps.llama-cpp-moe-cache-cuda = {
        type = "app";
        program = lib.getExe package;
        meta.description = "llama.cpp with FATE MoE cache patches for CUDA";
      };
    };
}
