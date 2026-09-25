{ self, ... }:

{
  flake.overlays.release-please =
    final: prev:
    let
      package = final.callPackage (
        {
          lib,
          buildNpmPackage,
          fetchFromGitHub,
        }:
        buildNpmPackage rec {
          pname = "release-please";
          version = "17.11.2";

          src = fetchFromGitHub {
            owner = "googleapis";
            repo = "release-please";
            rev = "v${version}";
            hash = "sha256-OGLoO23w1hkL8vvja2B+yMsB+M+mUaIm7AigBMPPDDs=";
          };

          npmDepsHash = "sha256-zlYCIyaiHnTNfjYM0iP81E8M+6cPIhF/Z7WuCTAJ7b8=";
          npmBuildScript = "compile";

          meta = {
            description = "Generate release PRs from the conventional commits spec";
            homepage = "https://github.com/googleapis/release-please";
            license = lib.licenses.asl20;
            mainProgram = "release-please";
          };
        }
      ) { };
    in
    {
      cormPackages = (prev.cormPackages or { }) // {
        release-please = package;
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    let
      package = (pkgs.extend self.overlays.release-please).cormPackages.release-please;
    in
    {
      packages.release-please = package;
    };
}
