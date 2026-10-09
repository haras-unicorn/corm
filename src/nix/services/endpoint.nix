{ selfLib, ... }:

{
  flake.nixosModules.corm-endpoint =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      yaml = pkgs.formats.yaml { };

      aichat-corm-config = yaml.generate "aichat-corm-config.yaml" {
        model = "corm-endpoint:${config.corm.endpoint.model}";
        stream = true;
        repl_prelude = "session:corm";
        save_session = false;
        clients = [
          {
            type = "openai-compatible";
            name = "corm-endpoint";
            api_base = "http://${config.corm.endpoint.host}:${builtins.toString config.corm.endpoint.port}/v1";
            api_key = "corm";
            models = [ { name = config.corm.endpoint.model; } ];
          }
        ];
      };

      aichat-corm = pkgs.writeShellApplication {
        name = "aichat-corm";
        runtimeInputs = [ pkgs.aichat ];
        text = "AICHAT_CONFIG_FILE=${aichat-corm-config} exec aichat \"$@\"";
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
          default = selfLib.ports.endpoint;
          description = "Port to listen on";
        };

        model = lib.mkOption {
          type = lib.types.str;
          default = config.corm.omw.agent;
          defaultText = lib.literalExpression "config.corm.omw.agent";
          description = "The endpoint model name clients request. Defaults to the configured agent name.";
        };

        client = {
          enable = lib.mkOption {
            type = lib.types.bool;
            default = config.corm.endpoint.enable;
            defaultText = lib.literalExpression "config.corm.endpoint.enable";
            description = "Install the aichat client, pointed at the Corm endpoint.";
          };
        };
      };

      config = lib.mkIf config.corm.endpoint.client.enable {
        environment.systemPackages = [
          pkgs.aichat
          aichat-corm
        ];
      };
    };
}
