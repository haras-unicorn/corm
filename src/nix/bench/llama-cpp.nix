{
  corm.bench.llama-cpp.module =
    {
      ctx,
      model ? "qwen-3-5-800M",
      package ? "llama-cpp",
      ubatch ? 2048,
      quant ? "Q4_K_M",
      ...
    }:
    {
      containers.agent =
        { lib, pkgs, ... }:
        {
          corm.cpu-provider = {
            inherit ctx;
            enable = true;
            model = pkgs.cormPackages.${model};
            kind.llama-cpp = {
              inherit ubatch quant;
              package = pkgs.cormPackages.${package};
            };
          };
        };
    };
}
