{ self, selfLib, ... }:

{
  flake.overlays.mcp-server-filesystem-bwrap =
    final: prev:
    let
      package = final.callPackage (
        {
          bwrapArgs ? null,
        }:
        let
          args = if bwrapArgs != null then bwrapArgs else selfLib.bwrap.base;
        in
        final.writeShellApplication {
          name = "corm-filesystem-mcp";
          runtimeInputs = [ final.bubblewrap ];
          text = ''
            mkdir -p "$FS_BASE_DIR"
            exec bwrap \
              ${final.lib.escapeShellArgs args} \
              --unshare-all \
              --bind "$FS_BASE_DIR" "$FS_BASE_DIR" \
              --chdir "$FS_BASE_DIR" \
              --setenv HOME "$FS_BASE_DIR" \
              -- ${final.lib.getExe final.mcp-server-filesystem} "$FS_BASE_DIR" "$@"
          '';
        }
      ) { };
    in
    {
      cormPackages = (prev.cormPackages or { }) // {
        mcp-server-filesystem-bwrap = package;
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    let
      package =
        (pkgs.extend self.overlays.mcp-server-filesystem-bwrap).cormPackages.mcp-server-filesystem-bwrap;
    in
    {
      packages.mcp-server-filesystem-bwrap = package;
      apps.mcp-server-filesystem-bwrap = {
        type = "app";
        program = lib.getExe package;
        meta.description = "mcp-server-filesystem with bubblewrap";
      };
    };
}
