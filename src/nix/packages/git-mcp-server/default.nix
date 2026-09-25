{ self, inputs, ... }:

{
  flake.overlays.git-mcp-server =
    final: prev:
    let
      pkgs = final;
      lib = pkgs.lib;

      system = pkgs.stdenv.hostPlatform.system;

      bun2nixFlake = inputs.bun2nix;

      bun2nix = bun2nixFlake.packages.${system}.default;

      # NOTE: fetch git because fetchFromGitHub doesn't download tsconfig.json
      src = pkgs.fetchgit {
        url = "https://github.com/cyanheads/git-mcp-server";
        # NOTE: v2.15.1
        rev = "31dd1918500a51129f0a086ed3471527961c7572";
        hash = "sha256-zJdkkEbmXMHHnj1ISMTeUVpARL7t5RVhOnm1PIfjOqg=";
      };

      gitMcpServer =
        (bun2nix.mkDerivation {
          inherit src;

          packageJson = "${src}/package.json";

          bunDeps = bun2nix.fetchBunDeps {
            bunNix = ./default.nix.lock;
          };

          nativeBuildInputs = [
            pkgs.makeWrapper
          ];

          dontRunLifecycleScripts = true;

          buildPhase = ''
            bun run build
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib/git-mcp-server $out/bin
            cp -r dist $out/lib/git-mcp-server/dist
            cp -r node_modules $out/lib/git-mcp-server/node_modules

            makeWrapper ${lib.getExe pkgs.bun} $out/bin/git-mcp-server \
              --prefix PATH : ${
                lib.makeBinPath [
                  pkgs.git
                  pkgs.openssh
                ]
              } \
              --argv0 git-mcp-server \
              --add-flags "$out/lib/git-mcp-server/dist/index.js"

            runHook postInstall
          '';
        })
        # NOTE: bun2nix mkDerivation hardcodes it to name from package.json
        // {
          meta.mainProgram = "git-mcp-server";
        };

      gitMcpServerBwrap = pkgs.writeShellApplication {
        name = "git-mcp-server-bwrap";
        runtimeInputs = [ pkgs.bubblewrap ];
        text = ''
          mkdir -p "$GIT_BASE_DIR"
          exec bwrap \
            ${final.lib.escapeShellArgs self.lib.bwrap.base} \
            --unshare-all \
            --share-net \
            --bind "$GIT_BASE_DIR" "$GIT_BASE_DIR" \
            --chdir "$GIT_BASE_DIR" \
            --setenv HOME "$GIT_BASE_DIR" \
            -- ${pkgs.lib.getExe gitMcpServer} "$GIT_BASE_DIR" "$@"
        '';
      };

      gitMcpServerSshCommand = pkgs.writeShellApplication {
        name = "git-mcp-server-ssh-command";
        runtimeInputs = [ pkgs.openssh ];
        text = ''
          mkdir -p "$GIT_SSH_DIR"
          exec ssh \
            -o "StrictHostKeyChecking=accept-new" \
            -o "UserKnownHostsFile=$GIT_SSH_DIR/known_hosts" \
            "$@"
        '';
      };

      gitMcpServerAddSshKey = pkgs.writeShellApplication {
        name = "git-mcp-server-add-ssh-key";
        runtimeInputs = [
          pkgs.openssh
          gitMcpServerBwrap
        ];
        text = ''
          printf "%s" "$GIT_SSH_KEY" | sed 's/\\n/\n/g' | ssh-add -
          unset GIT_SSH_KEY
          exec git-mcp-server-bwrap "$@"
        '';
      };

      gitMcpServerSshAgent = pkgs.writeShellApplication {
        name = "git-mcp-server-ssh-agent";
        runtimeInputs = [
          pkgs.openssh
          gitMcpServerAddSshKey
        ];
        text = ''
          export GIT_SSH_COMMAND="${lib.getExe gitMcpServerSshCommand}"
          exec ssh-agent git-mcp-server-add-ssh-key "$@"
        '';
      };
    in
    {
      cormPackages = (prev.cormPackages or { }) // {
        git-mcp-server = gitMcpServer;
        git-mcp-server-bwrap = gitMcpServerBwrap;
        git-mcp-server-ssh-agent = gitMcpServerSshAgent;
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    let
      gitMcpServerPkgs = (pkgs.extend self.overlays.git-mcp-server).cormPackages;
    in
    {
      packages = {
        git-mcp-server = gitMcpServerPkgs.git-mcp-server;
        git-mcp-server-bwrap = gitMcpServerPkgs.git-mcp-server-bwrap;
        git-mcp-server-ssh-agent = gitMcpServerPkgs.git-mcp-server-ssh-agent;
      };
      apps = {
        git-mcp-server = {
          type = "app";
          program = lib.getExe gitMcpServerPkgs.git-mcp-server;
          meta.description = "Git MCP Server";
        };
        git-mcp-server-bwrap = {
          type = "app";
          program = lib.getExe gitMcpServerPkgs.git-mcp-server-bwrap;
          meta.description = "Git MCP Server wrapped with bubblewrap";
        };
        git-mcp-server-ssh-agent = {
          type = "app";
          program = lib.getExe gitMcpServerPkgs.git-mcp-server-ssh-agent;
          meta.description = "Git MCP Server wrapped with SSH agent and bubblewrap";
        };
      };
    };
}
