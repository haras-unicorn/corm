{
  config,
  inputs,
  lib,
  self,
  selfLib,
  ...
}:

let
  # NOTE: borrowed from nixpkgs' nspawn-container module, adapted for live
  # host-networked containers.
  # https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/virtualisation/nspawn-container/default.nix
  # https://github.com/NixOS/nixpkgs/blob/nixos-26.05/nixos/modules/virtualisation/nixos-containers.nix
  nspawnModule =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.virtualisation;
      name = config.system.name;

      envFile = if cfg.environmentFile != null then cfg.environmentFile else pkgs.emptyFile;
    in
    {
      options.virtualisation = {
        cmdline = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "Arguments passed to the container init after the init path.";
        };

        rootDir = lib.mkOption {
          type = lib.types.str;
          default = "/var/lib/corm-containers/${name}/root";
          description = "Writable root directory for the systemd-nspawn container.";
        };

        stateDir = lib.mkOption {
          type = lib.types.str;
          default = "/var/lib/corm-containers/${name}/state";
          description = "Host directory bound to /var/lib/corm inside the container.";
        };

        environmentFile = lib.mkOption {
          type = lib.types.nullOr lib.types.path;
          default = null;
          description = "Host environment file bound to /run/corm.env inside the container.";
        };

        systemd-nspawn = {
          package = lib.mkPackageOption pkgs "systemd" { };

          options = lib.mkOption {
            type = lib.types.listOf lib.types.str;
            default = [ ];
            description = "Arguments passed to systemd-nspawn.";
          };
        };
      };

      config = {
        boot.isNspawnContainer = true;
        console.enable = true;

        # Forward the journal to the console so every service's output reaches
        # the read-only nspawn console exactly once. This also covers loggers
        # that write to journald natively (e.g. omw's `JOURNAL_STREAM`-detected
        # format), which `StandardOutput=journal+console` alone would miss.
        services.journald.console = "/dev/console";

        # Read-only console: logs stream to the terminal, but input is not
        # forwarded, so Ctrl-C reaches systemd-nspawn and, via the kill signal
        # below, triggers an orderly shutdown of the guest.
        virtualisation.systemd-nspawn.options = [
          "--quiet"
          "--machine=${name}"
          "--console=read-only"
          "--notify-ready=yes"
          "--kill-signal=SIGRTMIN+3"
          "--bind-ro=/nix/store:/nix/store"
          "--bind-ro=/nix/var/nix/db:/nix/var/nix/db"
          "--bind-ro=/nix/var/nix/daemon-socket:/nix/var/nix/daemon-socket"
          "--background="
        ];

        # No interactive console; drop the auto-spawned container getty.
        systemd.services.console-getty.enable = false;

        # Test-style SSH over systemd-nspawn's unix-export socket. The container
        # documents root login with an empty password, matching the NixOS test
        # framework. systemd-ssh-generator binds /run/host/unix-export/ssh and
        # nspawn exports it to /run/systemd/nspawn/unix-export/<machine>/ssh.
        services.openssh = {
          enable = true;
          settings = {
            PermitRootLogin = "yes";
            PermitEmptyPasswords = "yes";
            UsePAM = false;
          };
        };
        users.users.root.hashedPasswordFile = "${pkgs.writeText "corm-root-hashed-password" ""}";

        # The container shares the host network namespace, so the TCP daemon
        # would clash with the host's sshd on port 22. Only the generated
        # unix-export socket is used.
        systemd.services.sshd.enable = false;

        system.build.nspawn = pkgs.writeShellApplication {
          name = "run-nspawn";
          runtimeInputs = [
            pkgs.coreutils
            cfg.systemd-nspawn.package
          ];
          text = ''
            root_dir=${lib.escapeShellArg cfg.rootDir}
            state_dir=${lib.escapeShellArg cfg.stateDir}
            env_file=${lib.escapeShellArg envFile}

            case "''${1:-}" in
              --env-file)
                env_file="$2"
                shift 2
                ;;
              --env-file=*)
                env_file="''${1#--env-file=}"
                shift
                ;;
              --root-dir)
                root_dir="$2"
                shift 2
                ;;
              --root-dir=*)
                root_dir="''${1#--root-dir=}"
                shift
                ;;
              --state-dir)
                state_dir="$2"
                shift 2
                ;;
              --state-dir=*)
                state_dir="''${1#--state-dir=}"
                shift
                ;;
            esac

            base_dir="$(dirname "$root_dir")"

            mkdir -p "$root_dir/usr/bin"
            chmod 0755 "$root_dir" "$root_dir/usr/bin"
            mkdir -p "$state_dir" "$base_dir/nix/profiles" "$base_dir/nix/gcroots"

            sudo umount -R "/run/systemd/nspawn/unix-export/${name}" 2>/dev/null || true
            sudo rm -rf "/run/systemd/nspawn/unix-export/${name}"

            exec systemd-nspawn \
              ${lib.escapeShellArgs cfg.systemd-nspawn.options} \
              --directory="$root_dir" \
              --bind="$base_dir/nix/profiles:/nix/var/nix/profiles" \
              --bind="$base_dir/nix/gcroots:/nix/var/nix/gcroots" \
              --bind="$state_dir:/var/lib/corm" \
              --bind-ro="$env_file:/run/corm.env" \
              "$@" \
              "${config.system.build.toplevel}/init" ${lib.escapeShellArgs cfg.cmdline}
          '';
        };
      };
    };
in
{
  options.corm.container = lib.mkOption {
    default = { };
    description = "Corm live NixOS container configurations.";
    type = lib.types.attrsOf (
      lib.types.submodule (
        { name, ... }:
        {
          options = {
            name = lib.mkOption {
              type = lib.types.strMatching "[a-z0-9][a-z0-9-]*";
              default = name;
              description = "Container name, used for the container and state directory.";
            };

            cuda = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether CUDA support is enabled in the container.";
            };

            module = lib.mkOption {
              type = lib.types.functionTo lib.types.deferredModule;
              description = "Function from provider preset args to a NixOS module.";
            };
          };
        }
      )
    );
  };

  config.corm.lib.container = {
    _cormFlakeLib = true;
    __functor =
      _: system: name:
      {
        debug ? false,
        ...
      }@args:
      let
        container = config.corm.container.${name};

        module =
          { pkgs, ... }:
          {
            boot.isContainer = true;

            system.name = "corm-${container.name}";
            networking.hostName = "corm-${container.name}";
            networking.firewall.enable = false;

            environment.systemPackages = lib.mkIf debug [
              pkgs.elfutils
              pkgs.gdb
            ];
            services.omw.package = lib.mkIf debug (
              pkgs.omw-js-unwrapped.overrideAttrs (old: {
                dontStrip = true;
                env = (old.env or { }) // {
                  RUSTFLAGS = "-C force-frame-pointers=yes";
                  CARGO_PROFILE_RELEASE_DEBUG = "1";
                  CARGO_PROFILE_RELEASE_STRIP = "false";
                };
              })
            );

            corm = {
              enable = true;
              omw.environment.RUST_LOG = lib.mkIf debug "omw=trace,hyper=debug,reqwest=debug";
              omw.environmentFile = "/run/corm.env";
              omw.bwrapArgs = selfLib.bwrap.container;
              omw.memory."corm-config-prompt" = ''
                You are Corm, a local-first agent running inside a
                systemd-nspawn container in a development environment. Your
                JavaScript brain is executed by the omw runtime, the agent
                runtime corm is built on.

                This container is a live test setup: you are being used to
                exercise omw and corm while they are under active development,
                so treat the conversation as part of testing them.

                Act as a helpful, friendly testing assistant. Be nice, and keep
                your replies to the user brief.
              '';
            };

            system.stateVersion = "26.05";
          };

        build = inputs.nixpkgs.lib.nixosSystem {
          inherit system;
          specialArgs = { inherit selfLib self inputs; };
          modules = [
            self.nixosModules.corm
            nspawnModule
            (container.module args)
            module
          ]
          ++ lib.optional container.cuda selfLib.cudaNixosModule;
        };
      in
      {
        container = build.config.system.build.toplevel.drvPath;
        nspawn = build.config.system.build.nspawn.drvPath;
      };
  };
}
