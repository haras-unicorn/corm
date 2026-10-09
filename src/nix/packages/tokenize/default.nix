{ self, ... }:

{
  flake.overlays.tokenize =
    final: prev:
    let
      pkgs = final;

      python = pkgs.python3.withPackages (ps: [ ps.tokenizers ]);

      tokenizer = "${final.cormPackages.qwen-3-5-800M}/tokenizer.json";

      tokenize = pkgs.writeShellApplication {
        name = "tokenize";
        runtimeInputs = [ python ];
        text = ''
          corpus="''${1:?usage: tokenize <corpus> [tokenizer.json]}"
          exec python3 ${./script.py} "$corpus" "''${2:-${tokenizer}}"
        '';
      };
    in
    {
      cormPackages = (prev.cormPackages or { }) // {
        inherit tokenize;
      };
    };

  perSystem =
    { lib, pkgs, ... }:
    let
      cormPackages =
        (pkgs.extend (
          lib.composeManyExtensions [
            self.overlays.fetchhf
            self.overlays.fetchgguf
            self.overlays.tokenize
            self.overlays.models
          ]
        )).cormPackages;
    in
    {
      packages.tokenize = cormPackages.tokenize;

      apps.tokenize = {
        type = "app";
        program = lib.getExe cormPackages.tokenize;
        meta.description = "Count the tokens of a corpus with a HuggingFace tokenizer";
      };
    };
}
