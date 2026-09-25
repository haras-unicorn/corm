{ self, ... }:

# NOTE: models are downloaded as raw HuggingFace repositories (safetensors) via
# the `fetchhf` overlay. Each backend converts/quantizes them on the fly into
# its own format before serving (see the `*-provider` services): llama.cpp via
# `llama-cpp-convert` + `llama-quantize` (GGUF), FreeToken via `ft checkpoint`
# (FTW).

let
  makeModels = fetchhf: {
    qwen-3-5-800M = fetchhf {
      name = "qwen-3-5-800M";
      repo = "Qwen/Qwen3.5-0.8B";
      hash = "sha256-9cGbWrK6hwlGSqtSlObzxwGiAJnGb+GcG0BEgb2XHeo=";
    };

    occamy = fetchhf {
      name = "occamy";
      repo = "Accio-Lab/occamy-1.0-FP8";
      hash = "";
    };

    gemma-4-e4b = fetchhf {
      name = "gemma-4-e4b";
      repo = "google/gemma-4-E4B-it";
      hash = "";
    };

    qwen-3-embedding = fetchhf {
      name = "qwen-3-embedding";
      repo = "Qwen/Qwen3-Embedding-0.6B";
      hash = "";
    };
  };
in
{
  flake.overlays.models = final: prev: {
    cormPackages = (prev.cormPackages or { }) // makeModels final.cormPackages.fetchhf;
  };

  perSystem =
    { lib, pkgs, ... }:
    let
      cormPackages =
        (pkgs.extend (
          lib.composeManyExtensions [
            self.overlays.fetchhf
            self.overlays.models
          ]
        )).cormPackages;

      models = builtins.attrNames (makeModels (_: null));
    in
    {
      packages = builtins.listToAttrs (
        builtins.map (model: {
          name = model;
          value = cormPackages.${model};
        }) models
      );
    };
}
