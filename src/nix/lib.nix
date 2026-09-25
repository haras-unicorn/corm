{ inputs, self, ... }:

{
  lib = {
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

    openrouter = {
      baseUrl = "https://openrouter.ai/api/v1";
      model = "deepseek/deepseek-v4.1-flash";
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

    bwrap = {
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
  };
}
