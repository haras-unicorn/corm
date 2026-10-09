{ self, selfLib, ... }:

{
  flake.overlays.strata =
    final: prev:
    let
      pkgs = final;
      lib = prev.lib;
      cuda = prev.config.cudaSupport;

      version = "0.1.38";

      # NOTE: the Strata engine is built from source; the pinned llama.cpp commit
      # is the one Strata's own setup.py fetches (`STRATA_GGML_DIR` / `LLAMA_DIR`),
      # used both for the embedded ggml CPU library and the CUDA MMQ sources.
      strataSrc = pkgs.fetchFromGitHub {
        owner = "Niko1221";
        repo = "Strata";
        rev = "v${version}";
        hash = "sha256-9tawklXlF98yolRTVgeonVcyrob8HiNG3xSQ7V5v+94=";
      };

      llamaCppSrc = pkgs.fetchFromGitHub {
        owner = "ggml-org";
        repo = "llama.cpp";
        rev = "3cf03257f219afbe7334045ff7c6a06ac68c627d";
        hash = "sha256-SRGoXa+4ACBCB3eaG9XFYhMN1i0FyPEy9Rrer+dFGYI=";
      };

      strataMtpSrc = pkgs.callPackage (
        {
          strataTools,

          lib,
          stdenvNoCC,
          python3,
          cacert,
        }:
        stdenvNoCC.mkDerivation {
          name = "qwen3.8-flash-next-mtp-src";

          outputHashAlgo = "sha256";
          outputHashMode = "recursive";
          outputHash = "sha256-WEXOkxd2WpwTpW4/gsxDZFJLfHt+kMZ47NV9CteykzI=";

          nativeBuildInputs = [
            (python3.withPackages (ps: [
              ps.numpy
              ps.pyyaml
              ps.regex
            ]))
            cacert
          ];

          STRATA_GGUF_PY = "${strataTools}/share/strata/third_party/llama.cpp/gguf-py";

          buildCommand = ''
            export HOME="$TMPDIR"
            export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
            python3 ${strataTools}/share/strata/tools/mtp_fetch.py fetch --out "$out"
          '';

          meta = {
            description = "Qwen3.8-Flash-Next MTP tensors from the BF16 checkpoint";
            license = lib.licenses.mit;
            platforms = [ "x86_64-linux" ];
          };
        }
      ) { inherit strataTools; };

      # NOTE: CMake options that target the user's hardware are exposed as
      # arguments of a `callPackage` expression so a NixOS option can override
      # them.  `cudaArchitectures` is the GPU compute capabilities to compile
      # SASS for (the repo defaults to 120; we default to the common consumer
      # set and let the provider narrow it), `march` pins the CPU level instead
      # of ggml's `-march=native`.
      strataEngine = pkgs.callPackage (
        {
          strataSrc,
          llamaCppSrc,

          lib,
          stdenv,
          cmake,
          ninja,
          autoAddDriverRunpath,
          cudaPackages_13_2,

          cudaArchitectures ? [
            "75"
            "80"
            "86"
            "89"
            "120"
          ],
          portable ? true,
          march ? "",
          vision ? true,
          visionCuda ? true,
        }:
        let
          cuda = cudaPackages_13_2;

          archs = lib.concatStringsSep ";" cudaArchitectures;

          # NOTE: `STRATA_PORTABLE=ON` turns ggml's `-march=native` off and
          # enables a fixed AVX2/FMA/F16C/BMI2 baseline, which keeps the build
          # deterministic (substitutable) instead of host-dependent.  `march`
          # extends that baseline with a declared CPU level.
          usePortable = portable || march != "";

          marchFlags = lib.optionals (march != "") [
            "-DCMAKE_C_FLAGS=-march=${march}"
            "-DCMAKE_CXX_FLAGS=-march=${march}"
          ];

          baseFlags = [
            "-DCMAKE_BUILD_TYPE=Release"
          ]
          ++ lib.optional usePortable "-DSTRATA_PORTABLE=ON"
          ++ marchFlags;

          cudaFlags = [
            "-DCMAKE_CUDA_ARCHITECTURES=${archs}"
            "-DCMAKE_CUDA_COMPILER=${cuda.cuda_nvcc}/bin/nvcc"
            "-DCUDAToolkit_ROOT=${cuda.cudatoolkit}"
          ];

          engineFlags =
            baseFlags
            ++ cudaFlags
            ++ [
              "-DSTRATA_ENABLE_CUDA=ON"
              "-DSTRATA_BUILD_TESTS=OFF"
              "-DSTRATA_GGML_DIR=${llamaCppSrc}"
            ];

          visionFlags =
            baseFlags
            ++ [
              "-DLLAMA_DIR=${llamaCppSrc}"
              "-DSTRATA_VISION_CUDA=${if visionCuda then "ON" else "OFF"}"
            ]
            ++ lib.optionals visionCuda cudaFlags;

          engineFlagsShell = lib.escapeShellArgs engineFlags;

          visionFlagsShell = lib.escapeShellArgs visionFlags;
        in
        stdenv.mkDerivation {
          pname = "strata-engine";
          inherit version;

          src = strataSrc;

          nativeBuildInputs = [
            cmake
            ninja
            cuda.cuda_nvcc
            autoAddDriverRunpath
          ];

          buildInputs = [
            cuda.cudatoolkit
            cuda.cuda_cudart
            cuda.libcublas
            cuda.cuda_cccl
          ];

          dontConfigure = true;

          buildPhase = ''
            runHook preBuild

            cmake -G Ninja -S . -B build ${engineFlagsShell}
            cmake --build build --target strata -j "''${NIX_BUILD_CORES:-1}"

            ${lib.optionalString vision ''
              cmake -G Ninja -S tools/vision -B build-vision ${visionFlagsShell}
              cmake --build build-vision --target strata-vision -j "''${NIX_BUILD_CORES:-1}"
            ''}

            runHook postBuild
          '';

          installPhase = ''
            runHook preInstall

            mkdir -p $out/bin
            install -Dm755 build/strata $out/bin/strata
            ${lib.optionalString vision "install -Dm755 build-vision/bin/strata-vision $out/bin/strata-vision"}

            echo '{ "source": "nix", "version": "${version}", "archs": ${builtins.toJSON cudaArchitectures} }' \
              > $out/bin/BUILD.json

            runHook postInstall
          '';

          meta = {
            description = "Strata: single-model local inference engine for Qwen3.8-Flash-Next";
            homepage = "https://github.com/Niko1221/Strata";
            license = lib.licenses.mit;
            mainProgram = "strata";
            platforms = [ "x86_64-linux" ];
          };
        }
      ) { inherit strataSrc llamaCppSrc; };

      # NOTE: the engine-independent half of the server: the Python program,
      # the pack tools, the `data/` files and the vendored llama.cpp `gguf-py`.
      # The pack and MTP derivations depend only on this, not on the engine.
      strataTools =
        pkgs.callPackage
          (
            {
              strataSrc,
              llamaCppSrc,

              lib,
              stdenvNoCC,
            }:
            stdenvNoCC.mkDerivation {
              pname = "strata-tools";
              inherit version;

              src = strataSrc;

              dontConfigure = true;
              dontBuild = true;

              installPhase = ''
                runHook preInstall

                share=$out/share/strata
                mkdir -p $share/third_party/llama.cpp

                cp -r serve $share/serve
                cp -r tools $share/tools
                cp -r data $share/data
                cp -r ${llamaCppSrc}/gguf-py $share/third_party/llama.cpp/gguf-py

                runHook postInstall
              '';

              meta = {
                description = "Strata server, pack tools and data (engine-independent)";
                homepage = "https://github.com/Niko1221/Strata";
                license = lib.licenses.mit;
                platforms = [ "x86_64-linux" ];
              };
            }
          )
          {
            inherit strataSrc llamaCppSrc;
          };

      # NOTE: `serve/server.py` resolves its root from `__file__`, so wrapping
      # it out of the read-only tools tree works from any cwd.  The engine has
      # no data search of its own (it only `fopen`s `--expert-profile`), so the
      # wrapper re-exports the tools tree under `$out/share/strata` to be the
      # single distribution root the provider points at.
      strataServer =
        pkgs.callPackage
          (
            {
              strataTools,
              strataEngine,

              lib,
              stdenvNoCC,
              makeWrapper,
              python3,
            }:
            let
              python = python3.withPackages (
                ps: with ps; [
                  numpy
                  jinja2
                  regex
                  pyyaml
                  tqdm
                  requests
                  pillow
                  psutil
                ]
              );
            in
            stdenvNoCC.mkDerivation {
              pname = "strata";
              inherit version;

              src = strataSrc;

              nativeBuildInputs = [ makeWrapper ];

              dontConfigure = true;
              dontBuild = true;

              installPhase = ''
                runHook preInstall

                share=${strataTools}/share/strata
                mkdir -p $out/bin

                makeWrapper ${python}/bin/python3 $out/bin/strata-server \
                  --add-flags "$share/serve/server.py" \
                  --add-flags "--engine strata" \
                  --prefix PATH : ${strataEngine}/bin \
                  --set STRATA_GGUF_PY "$share/third_party/llama.cpp/gguf-py" \
                  --set STRATA_ROOT "$share"

                mkdir -p $out/share
                ln -s ${strataTools}/share/strata $out/share/strata

                runHook postInstall
              '';

              meta = {
                description = "Strata OpenAI/Anthropic-compatible server";
                homepage = "https://github.com/Niko1221/Strata";
                license = lib.licenses.mit;
                mainProgram = "strata-server";
                platforms = [ "x86_64-linux" ];
              };
            }
          )
          {
            inherit strataTools strataEngine;
          };

      # NOTE: `iq_pack.py` turns the GGUF into the pack the engine loads. It is
      # offline (numpy + the vendored gguf-py) and reads the GGUF straight from
      # the model package, so this is an ordinary derivation.
      strataPack =
        model:
        pkgs.callPackage
          (
            {
              strataTools,

              lib,
              stdenvNoCC,
              python3,
              model,
            }:
            stdenvNoCC.mkDerivation {
              name = "strata-pack-${model.name}";

              nativeBuildInputs = [
                (python3.withPackages (ps: [
                  ps.numpy
                  ps.pyyaml
                  ps.regex
                ]))
              ];

              STRATA_GGUF_PY = "${strataTools}/share/strata/third_party/llama.cpp/gguf-py";

              buildCommand = ''
                mkdir -p "$out"
                python3 ${strataTools}/share/strata/tools/iq_pack.py \
                  --gguf ${model}/${model.passthru.shard1} \
                  --out "$out"
              '';

              meta = {
                description = "Strata pack for ${model.name}";
                license = lib.licenses.mit;
                platforms = [ "x86_64-linux" ];
              };
            }
          )
          {
            inherit model strataTools;
          };

      strataMtp =
        pkgs.callPackage
          (
            {
              strataTools,
              strataMtpSrc,

              lib,
              stdenvNoCC,
              python3,
            }:
            stdenvNoCC.mkDerivation {
              name = "qwen3.8-flash-next-mtp";

              nativeBuildInputs = [
                (python3.withPackages (ps: [
                  ps.numpy
                  ps.pyyaml
                  ps.regex
                ]))
              ];

              STRATA_GGUF_PY = "${strataTools}/share/strata/third_party/llama.cpp/gguf-py";

              buildCommand = ''
                mkdir -p "$TMPDIR/mtp"
                cp -a ${strataMtpSrc}/. "$TMPDIR/mtp/"
                chmod -R u+w "$TMPDIR/mtp"

                python3 ${strataTools}/share/strata/tools/mtp_pack.py \
                  --src "$TMPDIR/mtp" \
                  --experts q2_0 \
                  --out "$TMPDIR/mtp/mtp-q2_0.gguf"

                python3 ${strataTools}/share/strata/tools/mtp_rt.py \
                  --gguf "$TMPDIR/mtp/mtp-q2_0.gguf" \
                  --out "$out"

                cp ${strataTools}/share/strata/data/draft_vocab_en.bin "$out/draft_vocab.bin"
              '';

              meta = {
                description = "Qwen3.8-Flash-Next MTP draft layer (q2_0, English draft vocab)";
                license = lib.licenses.mit;
                platforms = [ "x86_64-linux" ];
              };
            }
          )
          {
            inherit strataMtpSrc strataTools;
          };
    in
    lib.optionalAttrs cuda {
      cormPackages = (prev.cormPackages or { }) // {
        strata-engine = strataEngine;
        strata-tools = strataTools;
        strata-pack = strataPack;
        strata-mtp = strataMtp;
        strata = strataServer;
      };
    };

  perSystem =
    {
      lib,
      system,
      ...
    }:
    let
      cormPackages =
        (
          (selfLib.makePkgs {
            inherit system;
            cuda = true;
          }).extend
            self.overlays.strata
        ).cormPackages;
    in
    lib.optionalAttrs (system == "x86_64-linux") {
      packages.strata-engine = cormPackages.strata-engine;
      packages.strata-tools = cormPackages.strata-tools;
      packages.strata-mtp = cormPackages.strata-mtp;
      packages.strata = cormPackages.strata;

      apps.strata = {
        type = "app";
        program = lib.getExe cormPackages.strata;
        meta.description = "Strata OpenAI/Anthropic-compatible server";
      };
    };
}
