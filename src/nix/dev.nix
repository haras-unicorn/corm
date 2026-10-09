{ inputs, self, ... }:

{
  # NOTE: flake-parts complaining it can't determine whether
  # there is a formatter for all systems
  imports = [ inputs.flake-parts.flakeModules.touchup ];

  config = {
    # NOTE: flake-parts complaining it can't determine whether
    # there is a formatter for all systems
    touchup.attr.formatter.enable = false;

    systems = [
      "x86_64-linux"
      "aarch64-linux"
    ];

    perSystem =
      { pkgs, lib, ... }:
      let
        cormPkgs = (pkgs.extend self.overlays.corm).cormPackages;
        releasePlease = (pkgs.extend self.overlays.release-please).cormPackages.release-please;

        external = with pkgs; [
          git
          nushell
          nil
          nixfmt
          curl
          markdownlint-cli
          marksman
          mdbook
          taplo
          fd
          jq
          delta
          cachix
          gh
          markdown-link-check
          cspell
          prettier
          vscode-langservers-extracted
          yaml-language-server
          omw-js
          omw-test-js
          aichat

          cormPkgs.flake-root
          cormPkgs.nodeModules
          cormPkgs.node
          cormPkgs.pnpm
          cormPkgs.pnpmWithReload
          releasePlease
        ];

        devScript = pkgs.writeShellApplication {
          name = "dev";
          runtimeInputs = external;
          text = ''nu "$(flake-root)/src/nix/dev.nu" "$@"'';
        };

        devShell = pkgs.mkShell {
          packages = external ++ [ devScript ];
          shellHook = ''
            ${lib.getExe cormPkgs.symlinkNodeModules}
          '';
        };
      in
      {
        devShells = {
          corm = devShell;
          default = devShell;
          ci = devShell;
        };
      };
  };
}
