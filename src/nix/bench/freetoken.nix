{
  corm.bench.freetoken = {
    cuda = true;
    module =
      {
        ctx,
        model ? "occamy",
        package ? "freetoken-engine-dev",
        gpu ? null,
        memoryRatio ? 0.9,
        moeStrategy ? null,
        moeCacheSize ? null,
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
              kind.freetoken = {
                inherit
                  gpu
                  memoryRatio
                  moeStrategy
                  moeCacheSize
                  extraArgs
                  ;
                package = pkgs.cormPackages.${package};
              };
            };
          };
      };
  };
}
