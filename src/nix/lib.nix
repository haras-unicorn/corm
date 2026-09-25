{
  inputs,
  self,
  lib,
  config,
  ...
}:

let
  selfLib = config.corm.lib;

  flakeLib = lib.filterAttrsRecursive (
    _: value: !(builtins.isAttrs value) || (value ? _cormFlakeLib && value._cormFlakeLib)
  ) selfLib;

  recursiveAttrsOf =
    elemType:
    lib.types.mkOptionType {
      name = "recursiveAttrsOf";
      description = "nested attribute set of ${elemType.description or "values"}";
      descriptionClass = "noun";
      check = value: lib.isAttrs value;
      merge = loc: defs: lib.foldl' lib.recursiveUpdate { } (builtins.map (def: def.value) defs);
    };
in
{

  options.corm.lib = lib.mkOption {
    type = recursiveAttrsOf lib.types.raw;
    default = { };
    description = "Corm library.";
  };

  config = {
    flake.lib = flakeLib;

    _module.args.selfLib = selfLib;
    perSystem = { system, ... }: {
      _module.args.selfLib = selfLib;
    };

    corm.lib = {
      overlays = {
        inputs = [
          inputs.mcp-nix.overlays.default
          inputs.mcp-plan.overlays.default
          inputs.mcp-rss.overlays.default
          inputs.omw.overlays.default
        ];

        self = builtins.map (overlay: self.overlays.${overlay}) (
          builtins.filter (overlay: overlay != "default") (builtins.attrNames self.overlays)
        );
      };

      allowedDomains = [
        "opencode.ai"
        "en.wikipedia.org"
        "wiki.archlinux.org"
        "omarchy.org"
        "developer.mozilla.org"
        "huggingface.co"
        "github.com"
        "githubusercontent.com"
        "flakehub.com"
        "codeberg.org"
        "sr.ht"
        "nixos.org"
        "docs.rs"
        "crates.io"
        "npmjs.com"
        "pypi.org"
      ];

      bwrap =
        let
          base = [
            "--die-with-parent"
            "--ro-bind-try"
            "/nix/store"
            "/nix/store"
            "--ro-bind"
            "/usr"
            "/usr"
            "--ro-bind"
            "/bin"
            "/bin"
            "--ro-bind-try"
            "/sbin"
            "/sbin"
            "--ro-bind-try"
            "/lib"
            "/lib"
            "--ro-bind-try"
            "/lib64"
            "/lib64"
            "--tmpfs"
            "/tmp"
            "--proc"
            "/proc"
            "--dev"
            "/dev"
          ];
        in
        {
          inherit base;

          # NOTE: containers cannot mount a fresh /proc inside the guest, but some
          # MCP servers (for example Bun based) still require it so this is as good as it
          # gets in terms of security
          container = (builtins.filter (arg: arg != "--proc" && arg != "/proc") base) ++ [
            "--ro-bind"
            "/proc"
            "/proc"
          ];

          nvidia = [
            "--ro-bind-try"
            "/run/opengl-driver"
            "/run/opengl-driver"
            "--dev-bind-try"
            "/dev/dri"
            "/dev/dri"
            "--dev-bind-try"
            "/dev/nvidia0"
            "/dev/nvidia0"
            "--dev-bind-try"
            "/dev/nvidiactl"
            "/dev/nvidiactl"
            "--dev-bind-try"
            "/dev/nvidia-modeset"
            "/dev/nvidia-modeset"
            "--dev-bind-try"
            "/dev/nvidia-uvm"
            "/dev/nvidia-uvm"
            "--dev-bind-try"
            "/dev/nvidia-uvm-tools"
            "/dev/nvidia-uvm-tools"
          ];
        };

      ports = {
        endpoint = 43371;
        cpu-provider = 43372;
        gpu-provider = 43373;
        embedding = 43374;
      };

      llama = {
        mmapArgs =
          llamaPackage:
          (
            if (builtins.compareVersions llamaPackage.version "10105") == -1 then
              [ "--mmap" ]
            else
              [
                "--load-mode"
                "mmap"
              ]
          );
      };

      provider =
        name:
        let
          hardening = {
            ProtectSystem = "strict";
            ProtectHome = "read-only";
            PrivateTmp = true;
            NoNewPrivileges = true;
            LockPersonality = true;
            RestrictAddressFamilies = [
              "AF_INET"
              "AF_INET6"
              "AF_NETLINK"
              "AF_UNIX"
            ];
            IPAddressDeny = "any";
            IPAddressAllow = [
              "127.0.0.0/8"
              "::1"
            ];
          };

          stateDir = "corm-${name}-provider";
          statePath = "/var/lib/${stateDir}";
          serviceName = "corm-${name}-provider";

          prepareService = {
            requiredBy = [ "corm.target" ];
            bindsTo = [ "corm.target" ];
            before = [ "${serviceName}.service" ];
            serviceConfig = hardening // {
              Type = "oneshot";
              RemainAfterExit = true;
              StateDirectory = stateDir;
              Restart = "on-failure";
              RestartSec = 5;
            };
          };

          serveService = {
            requiredBy = [ "corm.target" ];
            bindsTo = [ "corm.target" ];
            after = [ "${serviceName}-prepare.service" ];
            requires = [ "${serviceName}-prepare.service" ];
            serviceConfig = hardening // {
              Restart = "on-failure";
              RestartSec = 5;
            };
          };

          warmupService =
            {
              pkgs,
              host,
              port,
              model,
            }:
            {
              requiredBy = [ "corm.target" ];
              bindsTo = [ "corm.target" ];
              after = [ "${serviceName}.service" ];
              requires = [ "${serviceName}.service" ];
              serviceConfig = hardening // {
                Type = "oneshot";
                RemainAfterExit = true;
                ExecStart = pkgs.writeShellScript "${serviceName}-warmup" ''
                  set -euo pipefail

                  url="http://${host}:${builtins.toString port}/v1/chat/completions"
                  body='{"model":"${model}","messages":[{"role":"user","content":"ping"}],"max_tokens":1}'

                  until ${pkgs.lib.getExe pkgs.curl} --silent --show-error --fail --max-time 10 \
                    --header 'Content-Type: application/json' \
                    --data "$body" \
                    "$url" > /dev/null 2>&1; do
                    sleep 1
                  done
                '';
              };
            };
        in
        {
          inherit
            hardening
            stateDir
            statePath
            serviceName
            prepareService
            serveService
            warmupService
            ;
        };
    };
  };
}
