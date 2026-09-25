{
  flake.nixosModules.corm-remote-provider = { lib, ... }: {
    options.corm.remote-provider = {
      enable = lib.mkEnableOption "Corm remote provider";

      baseUrl = lib.mkOption {
        type = lib.types.str;
        default = "https://openrouter.ai/api/v1";
        description = "Corm remote provider OpenAI API base url";
      };

      model = lib.mkOption {
        type = lib.types.str;
        default = "deepseek/deepseek-v4.1-flash";
        description = "Corm remote provider OpenAI API model";
      };
    };
  };
}
