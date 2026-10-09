{
  corm.container.strata = {
    cuda = true;
    module =
      {
        ctx ? 256 * 1024,
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
        visionReserveMib ? 1500,
        kv ? "int8",
        prefill ? "auto",
        spec ? 4,
        specMinP ? 0.5,
        gpu ? null,
        extraArgs ? [ ],
        ...
      }:
      { lib, pkgs, ... }:
      {
        corm.gpu-provider = {
          enable = lib.mkDefault true;
          model = lib.mkDefault pkgs.cormPackages.${model};
          ctx = lib.mkDefault ctx;
          kind.strata = lib.mkDefault {
            inherit
              cudaArchitectures
              portable
              march
              vision
              visionReserveMib
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
}
