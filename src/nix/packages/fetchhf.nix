{
  flake.overlays.fetchhf = final: prev: {
    cormPackages = (prev.cormPackages or { }) // {
      fetchhf =
        {
          name,
          repo,
          rev ? "main",
          hash ? "",
        }:
        let
          model = final.stdenvNoCC.mkDerivation (
            {
              inherit name;

              nativeBuildInputs = [
                (final.python3.withPackages (ps: [ ps.huggingface-hub ]))
                final.cacert
              ];

              buildCommand = ''
                export HOME="$TMPDIR"
                export SSL_CERT_FILE="${final.cacert}/etc/ssl/certs/ca-bundle.crt"
                hf download ${repo} \
                  --revision ${rev} \
                  --local-dir "$out"
                rm -rf "$out/.cache"
              '';
            }
            // final.lib.optionalAttrs (hash != "") {
              outputHashAlgo = "sha256";
              outputHashMode = "recursive";
              outputHash = hash;
            }
          );

          config = final.lib.importJSON "${model}/config.json";

          modelName = config._name_or_path or name;
          modelType = config.model_type or null;
          architectures = config.architectures or [ ];
          contextLength = config.max_position_embeddings or null;
        in
        model
        // {
          inherit
            modelName
            modelType
            architectures
            contextLength
            ;
          passthru = {
            inherit
              name
              config
              modelName
              modelType
              architectures
              contextLength
              ;
          };
        };
    };
  };
}
