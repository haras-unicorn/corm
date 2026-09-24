{
  self,
  inputs,
  lib,
  ...
}:

# NOTE: the service reads its secrets from a env file at
# /etc/corm/env with
# OMW__PROVIDERS__OPENROUTER__API_KEY
# GITHUB_PERSONAL_ACCESS_TOKEN
# GIT_SSH_KEY

# NOTE: keeping allowlist when a web fetch mcp arrives
# "https://opencode.ai"
# "https://en.wikipedia.org"
# "https://wiki.archlinux.org"
# "https://omarchy.org"
# "https://developer.mozilla.org"
# "https://huggingface.co"
# "https://github.com"
# "https://githubusercontent.com"
# "https://flakehub.com"
# "https://codeberg.org"
# "https://sr.ht"
# "https://nixos.org"
# "https://docs.rs"
# "https://crates.io"
# "https://npmjs.com"
# "https://pypi.org"

# NOTE: adding bwrap args for use later
# nvidia = [
#   "--ro-bind-try"
#   "/run/opengl-driver"
#   "/run/opengl-driver"
#   "--dev-bind-try"
#   "/dev/dri"
#   "/dev/dri"
#   "--dev-bind-try"
#   "/dev/nvidia0"
#   "/dev/nvidia0"
#   "--dev-bind-try"
#   "/dev/nvidiactl"
#   "/dev/nvidiactl"
#   "--dev-bind-try"
#   "/dev/nvidia-modeset"
#   "/dev/nvidia-modeset"
#   "--dev-bind-try"
#   "/dev/nvidia-uvm"
#   "/dev/nvidia-uvm"
#   "--dev-bind-try"
#   "/dev/nvidia-uvm-tools"
#   "/dev/nvidia-uvm-tools"
# ];
# base = [
#   "--die-with-parent"
#   "--unshare-all"
#   "--ro-bind-try"
#   "/nix/store"
#   "/nix/store"
#   "--ro-bind"
#   "/usr"
#   "/usr"
#   "--ro-bind"
#   "/bin"
#   "/bin"
#   "--ro-bind-try"
#   "/sbin"
#   "/sbin"
#   "--ro-bind-try"
#   "/lib"
#   "/lib"
#   "--ro-bind-try"
#   "/lib64"
#   "/lib64"
#   "--tmpfs"
#   "/tmp"
#   "--proc"
#   "/proc"
#   "--dev"
#   "/dev"
# ];

{
  flake.nixosModules.corm =
    { pkgs, ... }:
    let
      system = pkgs.stdenv.hostPlatform.system;

      name = "corm";
      user = name;
      stateDir = "/var/lib/${name}";
      workspaceDir = "${stateDir}/workspace";
      envFile = "/etc/${name}/env";
      endpointHost = "127.0.0.1";
      gpuPort = 8080;
      cpuPort = 8081;
      embeddingPort = 8082;

      corm = self.packages.${system}.corm;
      llama = self.packages.${system}.llama-moe-cache-cuda;

      models = {
        gpu = pkgs.fetchurl {
          name = "qwen-3-35b-a3b.gguf";
          url = "https://huggingface.co/bartowski/Qwen_Qwen3.6-35B-A3B-GGUF/resolve/main/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf";
          hash = "sha256-tG/t0z4L+wyuMIqjwVjQpLLEodIYWh7W8JPNrzkGR3I=";
        };

        cpu = {
          model = pkgs.fetchurl {
            name = "gemma-4-e4b.gguf";
            url = "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf";
            hash = "sha256-haiWoEdVPoQvJSl+5bAx1k/zAUfZxK8XseSzlM0fq4c=";
          };

          mmproj = pkgs.fetchurl {
            name = "gemma-4-e4b-mmproj.gguf";
            url = "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/mmproj-F16.gguf";
            hash = "sha256-3fRsIdcHjpUzjPwiMGsZsnaimlrQiQI0Sd1U1LYXClE=";
          };
        };

        embedding = pkgs.fetchurl {
          name = "qwen-3-embedding.gguf";
          url = "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf";
          hash = "sha256-BlB8e0JohGnE5ymLCh4W3v8GyvKRzwpbJ4wwgknD5Dk=";
        };
      };

      llamaServer = lib.getExe' llama "llama-server";

      filesystemMcp = pkgs.writeShellApplication {
        name = "corm-filesystem-mcp";
        runtimeInputs = [ pkgs.bubblewrap ];
        text = ''
          root="$1"
          shift

          exec bwrap \
            --die-with-parent \
            --unshare-all \
            --ro-bind-try /nix/store /nix/store \
            --ro-bind /usr /usr \
            --ro-bind /bin /bin \
            --ro-bind-try /sbin /sbin \
            --ro-bind-try /lib /lib \
            --ro-bind-try /lib64 /lib64 \
            --tmpfs /tmp \
            --proc /proc \
            --dev /dev \
            --bind "$root" "$root" \
            --chdir "$root" \
            --setenv HOME "$root" \
            -- ${lib.getExe pkgs.mcp-server-filesystem} "$root" "$@"
        '';
      };

      gitSshCommand = pkgs.writeShellApplication {
        name = "corm-git-ssh-command";
        runtimeInputs = [ pkgs.openssh ];
        text = ''
          mkdir -p "${stateDir}/.ssh"
          exec ssh \
            -o "StrictHostKeyChecking=accept-new" \
            -o "UserKnownHostsFile=${stateDir}/.ssh/known_hosts" \
            "$@"
        '';
      };

      gitMcpServerUnwrapped = pkgs.writeShellApplication {
        name = "corm-git-mcp-server-unwrapped";
        runtimeInputs = [
          pkgs.openssh
          self.packages.${system}.git-mcp-server
        ];
        text = ''
          printf "%s" "$GIT_SSH_KEY" | sed 's/\\n/\n/g' | ssh-add -
          unset GIT_SSH_KEY
          exec git-mcp-server
        '';
      };

      gitMcpServer = pkgs.writeShellApplication {
        name = "corm-git-mcp-server";
        runtimeInputs = [
          pkgs.openssh
          gitMcpServerUnwrapped
        ];
        text = "exec ssh-agent corm-git-mcp-server-unwrapped";
      };

      planConfig = (pkgs.formats.toml { }).generate "corm-plan-config.toml" {
        runtime = {
          tps_in = 800;
          tps_out = 30;
          max_task_duration_secs = 600;
          queue_limit = 10;
          max_retries = 3;
        };
        sources = [
          {
            id = "github";
            title = "GitHub";
            description = ''Run the `github` SOP with `sop_execute("github")`'';
            type = "poll";
          }
        ];
      };

      llamaHardening = {
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

      settings = {
        providers = {
          gpu = {
            kind = "openai";
            base_url = "http://${endpointHost}:${builtins.toString gpuPort}/v1";
            model = "qwen-3-35b-a3b";
          };

          cpu = {
            kind = "openai";
            base_url = "http://${endpointHost}:${builtins.toString cpuPort}/v1";
            model = "gemma-4-e4b";
          };

          openrouter = {
            kind = "openai";
            base_url = "https://openrouter.ai/api/v1";
            model = "deepseek/deepseek-v4.1-flash";
          };
        };

        tooling = {
          nixos = {
            kind = "mcp";
            transport = "stdio";
            command = lib.getExe pkgs.mcp-nixos;
          };

          nix = {
            kind = "mcp";
            transport = "stdio";
            command = lib.getExe pkgs.mcp-nix;
          };

          git = {
            kind = "mcp";
            transport = "stdio";
            command = lib.getExe gitMcpServer;
            env = {
              MCP_TRANSPORT_TYPE = "stdio";
              MCP_LOG_LEVEL = "warn";
              GIT_SSH_COMMAND = lib.getExe gitSshCommand;
              GIT_BASE_DIR = "${workspaceDir}/projects";
            };
          };

          github = {
            kind = "mcp";
            transport = "stdio";
            command = lib.getExe pkgs.github-mcp-server;
            args = [ "stdio" ];
            env.GITHUB_TOOLSETS = builtins.concatStringsSep "," [
              "context"
              "repos"
              "issues"
              "labels"
              "notifications"
              "discussions"
              "projects"
              "stargazers"
              "actions"
              "pull_requests"
              "users"
            ];
          };

          rss = {
            kind = "mcp";
            transport = "stdio";
            command = lib.getExe inputs.mcp-rss.packages.${system}.mcp-rss;
          };

          plan = {
            kind = "mcp";
            transport = "stdio";
            command = lib.getExe pkgs.mcp-plan;
            args = [
              "--config"
              planConfig
              "run"
            ];
            env.MCP_PLAN__DATABASE__URL = "sqlite://${stateDir}/plan.db";
          };

          filesystem = {
            kind = "mcp";
            transport = "stdio";
            command = lib.getExe filesystemMcp;
            args = [ workspaceDir ];
          };
        };

        runtime.js.kind = "js";

        agents = [
          {
            name = "morgan";
            runtime = "js";
            script = "${corm}/index.js";
          }
        ];

        endpoint = {
          kind = "openai";
          listen = "${endpointHost}:42617";
        };
      };
    in
    {
      imports = [ inputs.omw.nixosModules.default ];

      nixpkgs.overlays = [
        inputs.mcp-nix.overlays.default
        inputs.mcp-plan.overlays.default
      ];

      users.groups.${user} = { };

      users.users.${user} = {
        group = user;
        isSystemUser = true;
        home = stateDir;
        extraGroups = [ "video" ];
      };

      systemd.services.llama-gpu = {
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ];
        serviceConfig = llamaHardening // {
          ExecStart = [
            llamaServer
            "--model"
            models.gpu
            "--sleep-idle-seconds"
            "900"
            "--host"
            endpointHost
            "--port"
            (builtins.toString gpuPort)
            "--load-mode"
            "mmap"
            "--flash-attn"
            "on"
            "--gpu-layers"
            "all"
            "--cache-type-k"
            "q8_0"
            "--cache-type-v"
            "q8_0"
            "--ubatch-size"
            "2048"
            "--fate"
            "--fate-cache"
            "4096"
            "--ctx-size"
            "196608"
          ];
          Restart = "on-failure";
          RestartSec = 5;
        };
      };

      systemd.services.llama-cpu = {
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ];
        environment.CUDA_VISIBLE_DEVICES = "";
        serviceConfig = llamaHardening // {
          ExecStart = [
            llamaServer
            "--model"
            models.cpu.model
            "--mmproj"
            models.cpu.mmproj
            "--sleep-idle-seconds"
            "900"
            "--host"
            endpointHost
            "--port"
            (builtins.toString cpuPort)
            "--load-mode"
            "mmap"
            "--cache-type-k"
            "q8_0"
            "--cache-type-v"
            "q8_0"
            "--ubatch-size"
            "2048"
            "--ctx-size"
            "131072"
          ];
          Restart = "on-failure";
          RestartSec = 5;
        };
      };

      systemd.services.llama-embedding = {
        wantedBy = [ "multi-user.target" ];
        after = [ "network-online.target" ];
        environment.CUDA_VISIBLE_DEVICES = "";
        serviceConfig = llamaHardening // {
          ExecStart = [
            llamaServer
            "--model"
            models.embedding
            "--embeddings"
            "--pooling"
            "last"
            "--sleep-idle-seconds"
            "900"
            "--host"
            endpointHost
            "--port"
            (builtins.toString embeddingPort)
            "--load-mode"
            "mmap"
            "--cache-type-k"
            "q8_0"
            "--cache-type-v"
            "q8_0"
            "--ubatch-size"
            "2048"
            "--ctx-size"
            "32768"
          ];
          Restart = "on-failure";
          RestartSec = 5;
        };
      };

      services.omw = {
        enable = true;
        variant = "js";
        mode = "loop";
        inherit user;
        group = user;
        stateDir = name;
        environmentFile = envFile;
        settings = settings;
        readOnlyPaths = [
          "${corm}/index.js"
          planConfig
        ];
        serviceConfig = {
          UMask = "0077";
          Restart = "on-failure";
          RestartSec = "5s";
        };
      };
    };
}
