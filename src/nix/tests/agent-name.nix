{
  corm.tests.agent-name.module = {
    containers.agent =
      { lib, pkgs, ... }:
      {
        corm = {
          enable = true;
          cpu-provider.enable = true;
          cpu-provider.model = pkgs.cormPackages.qwen-3-5-800M;
          cpu-provider.kind.llama-cpp = { };
          omw.agent = "test-agent";
          omw.script = pkgs.writeText "corm-test-brain.js" ''
            omw.host.log("info", "corm test: whoami = " + omw.host.whoami());
            const message = omw.host.recv();
          '';
        };
      };

    testScript = ''
      start_all()
      agent.wait_until_succeeds("""
        journalctl -u omw --no-pager | grep -q 'corm test: whoami = test-agent'
      """)
    '';
  };
}
