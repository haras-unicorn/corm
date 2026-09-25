{ self, ... }:

{
  flake.nixosModules.corm-endpoint =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      toml = pkgs.formats.toml { };

      tenere-corm-config = toml.generate "tenere-corm-config.toml" {
        chatgpt = {
          openai_api_key = "";
          url = "http://${config.corm.endpoint.host}:${builtins.toString config.corm.endpoint.port}/v1/chat/completions";
          model = "morgan-fetch";
        };
      };

      tenere-corm = pkgs.writeShellApplication {
        name = "tenere-corm";
        runtimeInputs = [ pkgs.tenere ];
        text = "tenere -c ${tenere-corm-config}";
      };
    in
    {
      options.corm.endpoint = {
        enable = lib.mkEnableOption "Corm endpoint";

        host = lib.mkOption {
          type = lib.types.str;
          default = "127.0.0.1";
          description = "Host to listen on";
        };

        port = lib.mkOption {
          type = lib.types.port;
          default = self.lib.ports.endpoint;
          description = "Port to listen on";
        };

        tenere = {
          enable = lib.mkOption {
            type = lib.types.bool;
            default = config.corm.endpoint.enable;
            defaultText = lib.literalExpression "config.corm.endpoint.enable";
            description = "Install the tenere TUI client, pointed at the Corm endpoint.";
          };
        };
      };

      config = lib.mkIf config.corm.endpoint.tenere.enable {
        environment.systemPackages = [
          pkgs.tenere
          tenere-corm
        ];
      };
    };
}
