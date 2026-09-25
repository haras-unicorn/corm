{ self, ... }:

{
  perSystem =
    { pkgs, lib, ... }:
    let
      cormPkgs = (pkgs.extend self.overlays.corm).cormPackages;

      external = with pkgs; [
        git
        nushell
        nil
        nixfmt
        markdownlint-cli
        marksman
        mdbook
        taplo
        fd
        jq
        delta
        cachix
        gh
        docker
        markdown-link-check
        cspell
        prettier
        vscode-langservers-extracted
        yaml-language-server
        omw-js
        omw-test-js

        cormPkgs.flake-root
        cormPkgs.nodeModules
        cormPkgs.node
        cormPkgs.pnpm
        cormPkgs.pnpmWithReload
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
      };
    };
}
