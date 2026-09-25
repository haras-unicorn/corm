{
  corm.container.freetoken = {
    cuda = true;
    module =
      {
        ctx ? 256 * 1024,
        model ? "occamy",
        package ? "freetoken-engine-dev",
        gpu ? null,
        memoryRatio ? 0.9,
        moeStrategy ? null,
        moeCacheSize ? null,
        extraArgs ? [ ],
        ...
      }:
      { lib, pkgs, ... }:
      {
        corm.gpu-provider = {
          enable = lib.mkDefault true;
          model = lib.mkDefault pkgs.cormPackages.${model};
          ctx = lib.mkDefault ctx;
          kind.freetoken = lib.mkDefault {
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
}
