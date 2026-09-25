{
  corm.tests.freetoken = {
    cuda = true;
    module = {
      containers.agent =
        { lib, pkgs, ... }:
        {
          corm = {
            enable = true;
            gpu-provider.enable = true;
            gpu-provider.model = pkgs.cormPackages.qwen-3-5-800M;
            gpu-provider.ctx = 8192;
            gpu-provider.kind.freetoken = {
              package = pkgs.cormPackages.freetoken-engine-dev;
              extraArgs = [
                "--reasoning-parser"
                "off"
              ];
            };
            omw.script = pkgs.writeText "corm-test-brain.js" ''
              const provider = omw.provider.get("gpu");
              const models = provider.listModels();
              omw.host.log("info", "corm test: gpu models = " + JSON.stringify(models));
              const response = provider.chat(
                models[0],
                [
                  {
                    role: "system",
                    content: "You are a helpful assistant. Please respond as the user instructs."
                  },
                  { role: "user", content: "Please say hi!" }
                ],
                []);
              omw.host.log("info", "corm test: gpu response = " + JSON.stringify(response));
              omw.host.log("info", "everything passes");
              const message = omw.host.recv();
            '';
          };
        };

      testScript = ''
        start_all()
        agent.wait_until_succeeds("""
          journalctl -u omw --no-pager | grep -q 'everything passes'
        """)
      '';
    };
  };
}
