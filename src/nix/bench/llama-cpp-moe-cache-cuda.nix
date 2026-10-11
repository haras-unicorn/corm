{
  corm.bench.llama-cpp = {
    cuda = true;
    module =
      {
        ctx,
        model ? "occamy",
        package ? "llama-cpp-moe-cache-cuda",
        ubatch ? 2048,
        fate ? 4096,
        quant ? "Q4_K_M",
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
              kind.llama-cpp = {
                inherit
                  ubatch
                  fate
                  quant
                  ;
                package = pkgs.cormPackages.${package};
              };
            };
          };
      };
  };
}
