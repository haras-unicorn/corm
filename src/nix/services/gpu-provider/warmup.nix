{ selfLib, ... }:

{
  flake.nixosModules.corm-gpu-provider-warmup =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    lib.mkIf config.corm.gpu-provider.enable {
      systemd.services."corm-gpu-provider-warmup" = (selfLib.provider "gpu").warmupService {
        inherit pkgs;
        host = config.corm.gpu-provider.host;
        port = config.corm.gpu-provider.port;
        model = config.corm.gpu-provider.model.passthru.modelName;
      };
    };
}
