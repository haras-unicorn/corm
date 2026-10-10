{
  corm.bench.strata = {
    cuda = true;
    module =
      {
        ctx,
        model ? "qwen-3-8-flash-next-iq2-xs",
        package ? "strata",
        cudaArchitectures ? [
          "75"
          "80"
          "86"
          "89"
          "120"
        ],
        portable ? true,
        march ? "",
        vision ? "none",
        vramReserveMib ? null,
        kv ? "int8",
        prefill ? "auto",
        spec ? 4,
        specMinP ? 0.5,
        gpu ? null,
        extraArgs ? [ ],
        ...
      }:
      {
        containers.agent =
          { pkgs, lib, ... }:
          {
            corm.gpu-provider = {
              inherit ctx;
              enable = true;
              model = pkgs.cormPackages.${model};
              kind.strata = {
                inherit
                  cudaArchitectures
                  portable
                  march
                  vision
                  vramReserveMib
                  kv
                  prefill
                  spec
                  specMinP
                  gpu
                  extraArgs
                  ;
                package = pkgs.cormPackages.${package};
              };
            };
          };
      };
  };
}
