{ self, ... }:

{
  flake.nixosModules.corm-gpu-provider = {
    imports = [
      self.nixosModules.corm-gpu-provider-options
      self.nixosModules.corm-gpu-provider-warmup
      self.nixosModules.corm-gpu-provider-llama-cpp
      self.nixosModules.corm-gpu-provider-freetoken
      self.nixosModules.corm-gpu-provider-strata
    ];
  };
}
