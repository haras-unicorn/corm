{ self, ... }:

# NOTE: the service reads its secrets from an env file at
# /etc/corm/env with
# OMW__PROVIDERS__OPENROUTER__API_KEY
# GITHUB_PERSONAL_ACCESS_TOKEN
# GIT_SSH_KEY

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
    in
    {
      imports = [
        self.nixosModules.corm-omw
        self.nixosModules.corm-endpoint
      ];

      options.corm = {
        enable = lib.mkEnableOption "Corm";
      };

      config = lib.mkMerge [
        {
          nixpkgs.overlays = self.lib.overlays.inputs ++ self.lib.overlays.self;
        }
        (lib.mkIf cfg.enable {
          systemd.targets.corm = {
            wantedBy = [ "multi-user.target" ];
            after = [ "network-online.target" ];
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
