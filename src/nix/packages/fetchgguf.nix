{
  flake.overlays.fetchgguf = final: prev: {
    cormPackages = (prev.cormPackages or { }) // {
      fetchgguf =
        {
          name,
          repo,
          rev ? "main",
          include,
          hash ? final.lib.fakeHash,
          passthru ? { },
        }:
        let
          model = final.stdenvNoCC.mkDerivation {
            inherit name;

            nativeBuildInputs = [
              (final.python3.withPackages (ps: [ ps.huggingface-hub ]))
              final.cacert
            ];

            outputHashAlgo = "sha256";
            outputHashMode = "recursive";
            outputHash = hash;

            buildCommand = ''
              export HOME="$TMPDIR"
              export SSL_CERT_FILE="${final.cacert}/etc/ssl/certs/ca-bundle.crt"
              hf download ${repo} \
                --revision ${rev} \
                ${
                  final.lib.concatStringsSep " " (
                    map (pattern: "--include ${final.lib.escapeShellArg pattern}") include
                  )
                } \
                --local-dir "$out"
              rm -rf "$out/.cache"
            '';
          };
        in
        model
        // {
          passthru = {
            inherit
              name
              repo
              rev
              include
              ;
          }
          // passthru;
        };
    };
  };
}
