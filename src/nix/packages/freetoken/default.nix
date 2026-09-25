{ self, inputs, ... }:

{
  flake.overlays.freetoken =
    final: prev:
    let
      pkgs = final;
      lib = prev.lib;
      system = prev.stdenv.hostPlatform.system;

      # NOTE: pinned to the immutable per-version release tag; the rolling
      # `beta` tag clobbers its assets on every publish, so it cannot be hashed.
      version = "0.1.3";

      src = pkgs.fetchurl {
        pname = "freetoken-desktop";
        inherit version;
        url = "https://github.com/FlashML-org/FreeToken-Web/releases/download/v${version}/freetoken-desktop-x86_64.AppImage";
        hash = "";
      };

      desktop = pkgs.appimageTools.wrapType2 {
        pname = "freetoken";
        inherit version src;

        meta = {
          description = "Run local LLMs on your own machine";
          homepage = "https://www.flashml.ai/";
          platforms = [ "x86_64-linux" ];
        };
      };

      # NOTE: the uv.lock lives next to this file as `default.nix.lock` (matching
      # the packages/git-mcp-server convention) and is passed explicitly, so no
      # file literally named `uv.lock` needs to exist.
      workspace = inputs.uv2nix.lib.workspace.loadWorkspace {
        workspaceRoot = ./.;
        uvLock = lib.importTOML ./default.nix.lock;
        pyproject = lib.importTOML ./pyproject.toml;
      };

      # NOTE: the project in pyproject.toml is a virtual lock-only root; these are
      # the engine's direct dependencies that get pulled into the environment.
      dependencies = {
        freetoken = [ "accel" ];
        freetoken-kernel-cache = [ ];
        flashinfer-python = [ ];
        flashinfer-cubin = [ ];
        flashinfer-jit-cache = [ ];
      };

      python = pkgs.python312;

      # NOTE: the CUDA-native wheels link against libraries that are either
      # shipped inside a sibling package (`libtorch`, `libcudart`), provided by
      # the NVIDIA driver at runtime, or merely optional (`libcufile`'s RDMA
      # back end). Keep patching the ordinary system libs but ignore those, so
      # `autoPatchelfHook` does not reject the whole environment.
      autoPatchelfPackages = [
        "freetoken"
        "freetoken-kernel-cache"
        "sglang-kernel"
        "flashinfer-python"
        "flashinfer-cubin"
        "flashinfer-jit-cache"
        "torch"
        "torchvision"
        "triton"
        "numba"
        "nccl4py"
        "cuda-bindings"
        "cuda-core"
        "cuda-pathfinder"
        "cuda-python"
        "cuda-tile"
        "cuda-toolkit"
        "nvidia-cublas"
        "nvidia-cuda-cupti"
        "nvidia-cuda-nvrtc"
        "nvidia-cuda-runtime"
        "nvidia-cudnn-cu13"
        "nvidia-cudnn-frontend"
        "nvidia-cufft"
        "nvidia-cufile"
        "nvidia-curand"
        "nvidia-cusolver"
        "nvidia-cusparse"
        "nvidia-cusparselt-cu13"
        "nvidia-cutlass-dsl"
        "nvidia-cutlass-dsl-libs-base"
        "nvidia-cutlass-dsl-libs-core"
        "nvidia-cutlass-dsl-libs-cu12"
        "nvidia-cutlass-dsl-libs-cu13"
        "nvidia-ml-py"
        "nvidia-nccl-cu13"
        "nvidia-nvjitlink"
        "nvidia-nvshmem-cu13"
        "nvidia-nvtx"
      ];

      pythonSet =
        (pkgs.callPackage inputs.pyproject-nix.build.packages { inherit python; }).overrideScope
          (
            lib.composeManyExtensions [
              inputs.pyproject-build-systems.overlays.wheel
              (workspace.mkPyprojectOverlay {
                sourcePreference = "wheel";
                inherit dependencies;
              })
              (
                _final: prev:
                lib.mergeAttrsList (
                  map (
                    name:
                    lib.optionalAttrs (prev ? ${name}) {
                      ${name} = prev.${name}.overrideAttrs (old: {
                        autoPatchelfIgnoreMissingDeps = true;
                        autoPatchelfFlags = [ "--preserve-origin" ];
                        # NOTE: bake /run/opengl-driver/lib into the runtime search
                        # path of the CUDA shared objects, exactly like nixpkgs'
                        # `torch-bin`, so the driver libraries are found without a
                        # global LD_LIBRARY_PATH. Appended after the build system's
                        # autoPatchelfHook so auto-patchelf does not overwrite it.
                        nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [
                          pkgs.autoAddDriverRunpath
                        ];
                      });
                    }
                  ) autoPatchelfPackages
                )
              )
            ]
          );

      engineVenv = pythonSet.mkVirtualEnv "freetoken-engine-env" dependencies;

      # NOTE: FreeToken's prebuilt kernel-cache wheel does not cover every model
      # (e.g. Qwen/Qwen3.5-0.8B's hidden_size is below the AOT table). For shapes
      # it misses, Freetoken falls back to a runtime `tvm_ffi.cpp.load_inline`,
      # which shells out to nvcc + ninja + a target arch. Wrap `ft` with that
      # toolchain so the JIT path works on NixOS without leaking the env into
      # every caller. TODO: precompile the missing kernels at build time and
      # drop all of this (see the runtime kernel-cache override).
      cuda = pkgs.cudaPackages_13_2;

      nvcc = pkgs.writeShellScript "nvcc" ''
        exec ${cuda.cuda_nvcc}/bin/nvcc \
          -I${cuda.cuda_crt}/include \
          -I${cuda.cuda_cudart}/include \
          -I${cuda.cuda_cccl}/include \
          "$@"
      '';

      # tvm-ffi expects a classic CUDA toolkit: ${CUDA_HOME}/bin/nvcc and
      # ${CUDA_HOME}/lib64/libcudart.so. Build that layout over the split pkgs.
      cudaHome = pkgs.runCommand "cuda-home" { } ''
        mkdir -p $out/bin $out/lib64
        ln -s ${nvcc} $out/bin/nvcc
        for f in ${cuda.cuda_cudart}/lib/*.so*; do
          ln -s "$f" $out/lib64/
        done
      '';

      # NOTE: ship just the `ft` entry point instead of the whole virtualenv
      # (Python interpreter, activation scripts, site-packages, ...). The venv
      # stays in the runtime closure; only the application symlinks are exposed.
      engine =
        ((pkgs.callPackages inputs.pyproject-nix.build.util { }).mkApplication {
          venv = engineVenv;
          package = pythonSet.freetoken;
        }).overrideAttrs
          (old: {
            meta = (old.meta or { }) // {
              description = "FreeToken local MoE-offload LLM inference runtime (the `ft` CLI)";
              homepage = "https://github.com/FlashML-org/FreeToken";
              mainProgram = "ft";
              platforms = [ "x86_64-linux" ];
            };
          });

      # The dev engine wraps `ft` with a runtime CUDA toolchain so FreeToken's JIT
      # fallback (`tvm_ffi.cpp.load_inline` -> nvcc + ninja + arch) works for any
      # checkpoint the prebuilt AOT kernel cache does not cover (e.g.
      # Qwen3.5-0.8B's hidden_size). Testing/dev only: it drags nvcc, ninja and a
      # host compiler into the runtime closure.
      engineDev = engine.overrideAttrs (old: {
        nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [ pkgs.makeWrapper ];
        postFixup = (old.postFixup or "") + ''
          wrapProgram $out/bin/ft \
            --prefix PATH : ${
              lib.makeBinPath [
                pkgs.ninja
                pkgs.stdenv.cc
                # nixpkgs' ninja runs rules via posix_spawnp("sh"), so `sh`
                # must be on PATH; its rules also reach for `cp`/`ld`.
                pkgs.bashInteractive
                pkgs.coreutils
                pkgs.binutils
              ]
            } \
            --set CUDA_HOME ${cudaHome} \
            --set TVM_FFI_CUDA_ARCH_LIST "8.0 8.6 8.9 9.0 10.0 12.0" \
            --set CC ${lib.getExe' pkgs.stdenv.cc "cc"} \
            --set CXX ${lib.getExe' pkgs.stdenv.cc "c++"} \
            --set TRITON_LIBCUDA_PATH /run/opengl-driver/lib
        '';
      });
    in
    {
      cormPackages =
        (prev.cormPackages or { })
        // {
          freetoken-engine = engine;
          freetoken-engine-dev = engineDev;
        }
        // lib.optionalAttrs (system == "x86_64-linux") {
          freetoken-desktop = desktop;
        };
    };

  perSystem =
    {
      lib,
      pkgs,
      system,
      ...
    }:
    let
      cormPackages = (pkgs.extend self.overlays.freetoken).cormPackages;
      # `freetoken-engine-dev` carries the (unfree) CUDA toolkit for FreeToken's
      # JIT fallback, so build it from a CUDA-enabled nixpkgs.
      devCormPackages =
        (
          (self.lib.pkgs.make {
            inherit system;
            cuda = true;
          }).extend
            self.overlays.freetoken
        ).cormPackages;
    in
    lib.optionalAttrs (system == "x86_64-linux") {
      packages.freetoken-desktop = cormPackages.freetoken-desktop;
      apps.freetoken-desktop = {
        type = "app";
        program = lib.getExe cormPackages.freetoken-desktop;
        meta.description = "Run local LLMs on your own machine";
      };
      packages.freetoken-engine = cormPackages.freetoken-engine;
      apps.freetoken-engine = {
        type = "app";
        program = lib.getExe cormPackages.freetoken-engine;
        meta.description = "FreeToken engine (the `ft` CLI)";
      };
      packages.freetoken-engine-dev = devCormPackages.freetoken-engine-dev;
      apps.freetoken-engine-dev = {
        type = "app";
        program = lib.getExe devCormPackages.freetoken-engine-dev;
        meta.description = "FreeToken engine (the `ft` CLI) with a runtime CUDA toolchain for JIT fallback";
      };
    };
}
