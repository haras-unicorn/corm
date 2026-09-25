{
  corm.container.llama-cpp = {
    cuda = true;
    module =
      {
        ctx ? 256 * 1024,
        model ? "occamy",
        package ? "llama-cpp-moe-cache-cuda",
        ubatch ? 2048,
        fate ? 4096,
        quant ? "Q4_K_M",
        ...
      }:
      { lib, pkgs, ... }:
      {
        corm.gpu-provider = {
          enable = lib.mkDefault true;
          model = lib.mkDefault pkgs.cormPackages.${model};
          ctx = lib.mkDefault ctx;
          kind.llama-cpp = lib.mkDefault {
            inherit ubatch fate quant;
            package = pkgs.cormPackages.${package};
          };
        };
      };
  };
}
