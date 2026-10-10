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

      tools = builtins.fromJSON (builtins.readFile ./tools.json);

      toolsDescription = lib.concatMapStringsSep "\n" (tool: "- `${tool}`") tools;
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
          description =
            "Corm settings passed to the agent through it's memory.\n\n"
            + "The `tools` key restricts the agent to a subset of the tools it "
            + "may call, named `<tooling>__<tool>` (for example "
            + "`github__create_pull_request`). When `tools` is absent the agent "
            + "gets every tool; an empty list gives it none. Some tools are "
            + "always disabled and can never be re-enabled.\n\n"
            + "Available tools:\n\n"
            + toolsDescription;
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
