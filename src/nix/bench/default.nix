{
  config,
  lib,
  self,
  selfLib,
  ...
}:

{
  options.corm.bench = lib.mkOption {
    default = { };
    description = "Corm NixOS module benchmarks.";
    type = lib.types.attrsOf (
      lib.types.submodule (
        { name, config, ... }: {
          options = {
            name = lib.mkOption {
              type = lib.types.str;
              default = name;
              description = "Benchmark name.";
            };

            cuda = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Whether the benchmark requires CUDA.";
            };

            ctx = lib.mkOption {
              type = lib.types.ints.unsigned;
              default = 256 * 1024;
              description = "Default context size for the benchmark.";
            };

            module = lib.mkOption {
              type = lib.types.functionTo lib.types.deferredModule;
              description = "Benchmark function that evaluates to a NixOS test module";
            };
          };
        }
      )
    );
  };

  config.corm.lib.bench = {
    _cormFlakeLib = true;
    __functor =
      _: system: name:
      let
        bench = config.corm.bench.${name};
      in
      {
        seed,
        ctx ? bench.ctx,
        prompt ? builtins.readFile self.packages.${system}.war-and-peace,
        ...
      }@args:
      let
        pkgs = selfLib.makePkgs {
          inherit system;
          cuda = bench.cuda;
        };
      in
      pkgs.testers.runNixOSTest {
        imports = [
          (bench.module (args // { inherit ctx prompt; }))
          selfLib.cudaTestModule
          {
            name = "corm-bench-${bench.name}";
            globalTimeout = 3600;

            node.pkgsReadOnly = lib.mkForce false;

            defaults =
              { pkgs, config, ... }:
              let
                # NOTE: about half the context tokens
                trimmed = pkgs.writeText "bench-prompt" (builtins.substring 0 (ctx * 2) prompt);

                tokens = pkgs.runCommand "bench-tokens" { nativeBuildInputs = [ pkgs.cormPackages.tokenize ]; } ''
                  tokenize ${trimmed} > "$out"
                '';
              in
              {
                imports = [ self.nixosModules.corm ];

                corm = {
                  enable = true;

                  omw.memory = {
                    bench-provider = builtins.head (builtins.attrNames config.services.omw.settings.providers);
                    bench-prompt = builtins.readFile trimmed;
                    bench-tokens = builtins.readFile tokens;
                  };
                  # NOTE: providers can take their sweet time on prefill
                  omw.tunables.recv_timeout_secs = 3600;
                  omw.script = pkgs.writeText "corm-bench.js" ''
                    // seed ${builtins.toString seed}
                    ${builtins.readFile ./bench.js}
                  '';
                };

                systemd.targets.corm.after = lib.mkForce [ ];

                system.stateVersion = "26.05";
              };

            testScript = ''
              import re
              start_all()
              get_result = """
                journalctl -u omw --no-pager | grep 'CORM BENCH RESULT:'
              """
              agent.wait_until_succeeds(get_result, timeout=3600)
              report = re.findall(
                r'\{\{CORM BENCH RESULT:(.*)\}\}',
                agent.succeed(get_result)
              )[0].strip()
              (driver.out_dir / "bench.json").write_text(report)
              print(report)
            '';
          }
        ];
      };

  };
}
