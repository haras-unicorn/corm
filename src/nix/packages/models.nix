{ self, ... }:

# NOTE: models are downloaded as raw HuggingFace repositories via the `fetchhf`
# (safetensors) and `fetchgguf` (pre-quantized GGUF) overlays. Each backend
# converts/prepares them for its own format before serving (see the
# `*-provider` services): llama.cpp via `llama-cpp-convert` + `llama-quantize`
# (GGUF), FreeToken via `ft checkpoint` (FTW), Strata via `iq_pack.py`.

let
  makeModels = fetchhf: fetchgguf: {
    qwen-3-5-800M = fetchhf {
      name = "qwen-3-5-800M";
      repo = "Qwen/Qwen3.5-0.8B";
      hash = "sha256-9cGbWrK6hwlGSqtSlObzxwGiAJnGb+GcG0BEgb2XHeo=";
    };

    occamy = fetchhf {
      name = "occamy";
      repo = "Accio-Lab/occamy-1.0-FP8";
      hash = "sha256-+ddifnpcs3+NS2xk/csxZHMJG3wk6AZMcdVH6qYCttc=";
    };

    gemma-4-e4b = fetchhf {
      name = "gemma-4-e4b";
      repo = "google/gemma-4-E4B-it";
      hash = "sha256-f1c1UZH6wlzzixI/GpYp55Pi2ag4uxV2SgvhzGQugSg=";
    };

    qwen-3-embedding = fetchhf {
      name = "qwen-3-embedding";
      repo = "Qwen/Qwen3-Embedding-0.6B";
      hash = "sha256-6kml2X+Ha0Qg3jUP/AHiflfOtNxd1Q2ca3LzdNghvpA=";
    };

    # NOTE: the only model Strata runs (see the `strata` gpu-provider kind).
    # The `IQ2_XS` subdirectory plus the BF16 vision projector from the pinned
    # GSQ-RCO revision; `shard1`/`pleShard` match Strata's setup.py layout
    # (the PLE n-gram table is in shard 2 for the base model).
    qwen-3-8-flash-next-iq2-xs = fetchgguf {
      name = "qwen-3-8-flash-next-iq2-xs";
      repo = "ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF";
      rev = "ed59f92082b1e93c0e96d60a8b11aab089b52f09";
      include = [
        "IQ2_XS/*"
        "mmproj-Qwen3.8-Flash-Next-BF16.gguf"
      ];
      hash = "sha256-9P2TykkSZy6ByF+ZbfsS57xo+DNcua1ftgAG20j3zYM=";
      passthru = {
        quant = "IQ2_XS";
        shard1 = "IQ2_XS/Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00001-of-00002.gguf";
        pleShard = "IQ2_XS/Qwen3.8-Flash-Next-GSQ-RCO-IQ2_XS-00002-of-00002.gguf";
        mmproj = "mmproj-Qwen3.8-Flash-Next-BF16.gguf";
        modelName = "qwen3.8-flash-next";
      };
    };
  };
in
{
  flake.overlays.models = final: prev: {
    cormPackages =
      (prev.cormPackages or { }) // makeModels final.cormPackages.fetchhf final.cormPackages.fetchgguf;
  };

  perSystem =
    { lib, pkgs, ... }:
    let
      cormPackages =
        (pkgs.extend (
          lib.composeManyExtensions [
            self.overlays.fetchhf
            self.overlays.fetchgguf
            self.overlays.models
          ]
        )).cormPackages;

      models = builtins.attrNames (makeModels (_: null) (_: null));
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
