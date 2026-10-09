{ self, selfLib, ... }:

{
  flake.nixosModules.corm =
    {
      pkgs,
      lib,
      config,
      ...
    }:
    let
      cfg = config.corm;

      json = pkgs.formats.json { };
    in
    {
      imports = [
        self.nixosModules.corm-omw
        self.nixosModules.corm-endpoint
      ];

      options.corm = {
        enable = lib.mkEnableOption "Corm";

        settings = lib.mkOption {
          type = json.type;
          default = { };
          description = "Corm settings passed to the agent through it's memory.";
        };
      };

      config = lib.mkMerge [
        {
          nixpkgs.overlays = selfLib.overlays.inputs ++ selfLib.overlays.self;
        }
        (lib.mkIf cfg.enable {
          systemd.targets.corm = {
            wantedBy = [ "multi-user.target" ];
            after = [ "network-online.target" ];
            wants = [ "network-online.target" ];
          };

          users.groups.corm = { };

          users.users.corm = {
            group = "corm";
            isSystemUser = true;
            home = "/var/lib/${config.services.omw.stateDir}";
            extraGroups = [ "video" ];
          };

          corm.omw.enable = lib.mkDefault true;
          corm.endpoint.enable = lib.mkDefault true;
        })
      ];
    };
}
