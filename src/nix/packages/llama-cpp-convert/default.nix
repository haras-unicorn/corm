{ self, ... }:

# NOTE: llama.cpp ships its HuggingFace->GGUF converter as a Python script
# (`convert_hf_to_gguf.py`) plus the `conversion` and `gguf-py` packages, but the
# nixpkgs `llama-cpp` derivation only installs the C++ binaries. This wraps the
# converter from the same FATE fork source so services can convert raw HF
# checkpoints on the fly before `llama-quantize`ing them.

{
  flake.overlays.llama-cpp-convert =
    final: prev:
    let
      package = final.callPackage (
        {
          lib,
          stdenvNoCC,
          python3,
          makeWrapper,
          llama-cpp,
        }:
        let
          python = python3.withPackages (ps: [
            ps.numpy
            ps.sentencepiece
            ps.transformers
            ps.protobuf
            ps.torch
          ]);
        in
        stdenvNoCC.mkDerivation {
          pname = "llama-cpp-convert";
          version = "0.0.0";

          src = llama-cpp.src;

          nativeBuildInputs = [ makeWrapper ];

          dontConfigure = true;
          dontBuild = true;

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib $out/bin
            cp -r conversion gguf-py convert_hf_to_gguf.py $out/lib/

            makeWrapper ${python}/bin/python3 $out/bin/llama-convert-hf-to-gguf \
              --add-flags "$out/lib/convert_hf_to_gguf.py" \
              --prefix PYTHONPATH : "$out/lib:$out/lib/gguf-py"

            runHook postInstall
          '';

          meta = {
            description = "Convert HuggingFace checkpoints to GGUF (llama.cpp)";
            homepage = "https://github.com/ggml-org/llama.cpp";
            license = lib.licenses.mit;
            mainProgram = "llama-convert-hf-to-gguf";
          };
        }
      ) { };
    in
    {
      cormPackages = (prev.cormPackages or { }) // {
        llama-cpp-convert = package;
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    let
      cormPackages =
        (pkgs.extend (lib.composeManyExtensions (self.lib.overlays.inputs ++ self.lib.overlays.self)))
        .cormPackages;
    in
    {
      packages.llama-cpp-convert = cormPackages.llama-cpp-convert;
    };
}
