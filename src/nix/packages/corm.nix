{ self, ... }:

{
  flake.overlays.corm =
    final: prev:
    let
      pkgs = final;
      lib = pkgs.lib;

      pnpmDepsHash = "sha256-XGgPxmeJTp2jFzvwuuK/AKpTUUZpk4r2QZ1c14+NvvA=";

      flake-root = pkgs.writeShellApplication {
        name = "flake-root";
        text = ''
          current="$PWD"
          while [[ "$current" != "/" ]]; do
            if [[ -f "$current/flake.nix" ]]; then
              echo "$current"
              exit 0
            fi
            current="$(dirname "$current")"
          done
          echo "no flake.nix found" >&2
          exit 1
        '';
      };

      node = pkgs.nodejs_26;
      pnpm = pkgs.pnpm_11;

      pnpmDeps = pkgs.fetchPnpmDeps {
        pname = "corm-workspace";
        version = "0.1.0";
        src = self;
        fetcherVersion = 3;
        hash = pnpmDepsHash;
      };

      nodeModules = pkgs.stdenv.mkDerivation {
        inherit pnpmDeps;

        pname = "corm-node-modules";
        version = "0.1.0";
        src = self;

        nativeBuildInputs = [
          pkgs.autoPatchelfHook
          pkgs.jq
          pkgs.pnpmConfigHook
          pnpm
          node
        ];

        buildInputs = [
          pkgs.stdenv.cc.cc.lib
        ];

        buildPhase = ''
          pnpm install --offline --frozen-lockfile
        '';

        installPhase = ''
          mkdir -p $out/lib
          mkdir -p $out/bin

          pnpm ls -r --depth -1 --json > pkgs.json

          jq -r '.[].path' pkgs.json | while read -r path; do
            rel="''${path#$PWD}"
            mkdir -p "$out/lib/$rel"
            mkdir -p "$path/node_modules"
            cp -R "$path/node_modules" "$out/lib/$rel"

            for f in $out/lib/$rel/node_modules/.bin/*; do
              [ -e "$f" ] || continue
              name=$(basename "$f")
              cat > $out/bin/$name <<EOF
          #!/usr/bin/env bash
          export NODE_PATH="$out/lib/$rel/node_modules"
          exec "$f" "\$@"
          EOF
              chmod +x $out/bin/$name
            done
          done

          jq \
            --arg root "$PWD" \
            'map(.path |= ltrimstr($root))' \
            pkgs.json > $out/pkgs.json
        '';
      };

      symlinkNodeModules = pkgs.writeShellApplication {
        name = "symlink-node-modules";
        runtimeInputs = [
          pkgs.git
          pkgs.jq
        ];
        text = ''
          root=$(flake-root)
          jq -r '.[].path' '${nodeModules}/pkgs.json' \
            | while read -r path; do
            src="${nodeModules}/lib$path/node_modules"
            dest="$root$path/node_modules"
            rm -fr "$dest"
            ln -s "$src" "$dest"
          done
        '';
      };

      pnpmWithReload = pkgs.writeShellApplication {
        name = "pnpm-with-reload";
        runtimeInputs = [
          pnpm
          pkgs.direnv
          pkgs.jq
          pkgs.git
        ];
        text = ''
          root=$(flake-root)
          jq -r '.[].path' '${nodeModules}/pkgs.json' \
            | while read -r path; do
            dest="$root$path/node_modules"
            rm -fr "$dest"
          done
          pnpm "$@"
          direnv reload .
        '';
      };

      corm = pkgs.stdenv.mkDerivation {
        pname = "corm";
        version = "0.1.0";
        src = self;

        nativeBuildInputs = [
          pkgs.esbuild
        ];

        buildPhase = ''
          runHook preBuild
          esbuild src/corm/src/index.ts \
            --bundle \
            --platform=neutral \
            --format=iife \
            --target=esnext \
            --loader:.md=text \
            --outfile=src/corm/dist/index.js
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p $out
          cp src/corm/dist/index.js $out/index.js
          runHook postInstall
        '';

        meta = {
          description = "Corm is the brain of Morgan Fetch.";
          homepage = "https://github.com/haras-unicorn/corm";
          license = lib.licenses.mit;
        };
      };
    in
    {
      cormPackages = (prev.cormPackages or { }) // {
        inherit
          flake-root
          node
          pnpm
          pnpmDeps
          nodeModules
          symlinkNodeModules
          pnpmWithReload
          corm
          ;
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    {
      packages.corm = (pkgs.extend self.overlays.corm).cormPackages.corm;
    };
}
