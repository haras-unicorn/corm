{
  corm.tests.llama-cpp.module = {
    containers.agent =
      { lib, pkgs, ... }:
      {
        corm = {
          enable = true;
          cpu-provider.enable = true;
          cpu-provider.model = pkgs.cormPackages.qwen-3-5-800M;
          cpu-provider.kind.llama-cpp = { };
          omw.script = pkgs.writeText "corm-test-brain.js" ''
            const provider = omw.provider.get("cpu");
            const models = provider.listModels();
            omw.host.log("info", "corm test: cpu models = " + JSON.stringify(models));
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
            omw.host.log("info", "corm test: cpu response = " + JSON.stringify(response));
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
}
