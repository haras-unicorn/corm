def "main" [] {
  dev -h
}

def "main format" [] {
  cd (flake-root)
  let config = (
    nix build --no-link --print-out-paths
      ".#omw-scaffold-config"
  )
  (omw scaffold $config
    --output /dev/stdout --no-resources --force
    | from toml
    | update agents.corm.script "../dist/index.js"
    | update providers.remote.models [ ]
    | update providers.gpu.models [ ]
    | update providers.cpu.models [ ]
    | to json
    | prettier --parser json
    | save -f (corm e2e test base))
  corm tools list
    | to json
    | prettier --parser json
    | save -f (corm tools path)
  curl -fsSL (corm omw types url)
    | biome format $"--stdin-file-path=(corm omw types path)"
    | save -f (corm omw types path)
  main docs
  prettier --write .
  taplo format ...(fd --glob '**/*.toml' . | lines)
  nixfmt ...(fd --glob '**/*.nix' . | lines)
  biome format --write .
  biome check --write .
}

def "main docs" [] {
  cd (flake-root)
  open --raw (nix build --no-link --print-out-paths ".#options")
    | prettier --parser markdown
    | save -f "./docs/options.md"
}

def "main lint" [] {
  cd (flake-root)
  main lint check
  main lint test
  main lint nix
}

def "main lint check" [] {
  cd (flake-root)
  if ((curl -fsSL (corm omw types url) | str trim)
    != (open --raw (corm omw types path) | str trim)) {
    error make { msg: $"(corm omw types path) is stale" }
  }
  if ((open --raw ./docs/options.md | str trim)
    != (open --raw (nix build --no-link --print-out-paths ".#options")
      | prettier --parser markdown
      | str trim)) {
    error make { msg: "./docs/options.md is stale; run `dev docs`" }
  }
  let empty_toolings = open (corm e2e test base)
    | get tooling
    | transpose key value
    | where { ($in.value.tools | length) == 0 }
  if ($empty_toolings | is-not-empty) {
    error make {
      msg: (
        "toolings "
          + ($empty_toolings | get key | str join ', ')
          + " are empty"
      )
    }
  }
  if ((open (corm tools path)) != (corm tools list)) {
    error make { msg: $"(corm tools path) is stale; run `dev format`" }
  }
  prettier --check .
  taplo check ...(fd --glob '**/*.toml' . | lines)
  nixfmt --check ...(fd --glob '**/*.nix' . | lines)
  cspell lint . --no-progress
  (markdownlint
    --ignore-path .markdownignore
    --ignore-path .gitignore
    .)
  if ($env.NIX_BUILD_TOP? | is-empty) {
    (markdown-link-check
      --config .markdown-link-check.json
      --quiet
      ...(fd '.*.md' . | lines))
  }
  biome check .
  biome lint .
}

def "main lint nix" [--all-systems] {
  cd (flake-root)
  (nix flake check --show-trace
    ...(if $all_systems { [ --all-systems ] } else { [ ] }))
}

def "main lint test" [] {
  cd (flake-root)
  main test unit
  main test e2e
}

def "main test" [] {
  cd (flake-root)
  main test unit
  main test e2e
}

def "main test unit" [filter?: string] {
  cd (flake-root)
  for esbuild in (glob **/esbuild.mjs) {
    node $esbuild
  }
  (vitest run --configLoader runner
    ...(if $filter != null { [ -t $filter ] } else { [ ] }))
}

def "main test e2e" [filter?: string] {
  for esbuild in (glob **/esbuild.mjs) {
    node $esbuild
  }
  (omw-test run ./src/corm/e2e
    --log-format pipe --all
    --dump (corm e2e test dump)
    ...(if $filter != null { [ --include $filter ] } else { [ ] }))
}

def "main test nixos" [test: string] {
  cd (flake-root)
  (nix build -L $".#checks.(corm system).test-corm-($test)")
}

def "main test nixos interactive" [test: string] {
  cd (flake-root)
  nix run $".#checks.(corm system).test-corm-($test).driverInteractive"
}

def "main release-pr" [] {
  cd (flake-root)
  (release-please release-pr
    --token $env.GITHUB_TOKEN
    --repo-url $env.GITHUB_REPOSITORY
    --config-file release-please-config.json
    --manifest-file .release-please-manifest.json)
}

def "main release" [] {
  cd (flake-root)
  (release-please release-pr
    --token $env.GITHUB_TOKEN
    --repo-url $env.GITHUB_REPOSITORY
    --config-file release-please-config.json
    --manifest-file .release-please-manifest.json)
  (release-please github-release
    --token $env.GITHUB_TOKEN
    --repo-url $env.GITHUB_REPOSITORY
    --config-file release-please-config.json
    --manifest-file .release-please-manifest.json)
}

def "main container start" [
  name: string
  args?: record
  --eval-only
  --build-only
] {
  cd (flake-root)
  let root = (flake-root)
  let args = if $args == null {
    if (".corm.container.json" | path exists) {
      open ".corm.container.json" | get --optional $name | default { }
    } else {
      { }
    }
  } else { $args }
  let json = ($args | to json)
  let apply = (
    $"container: container \"(corm system)\" \"($name)\""
    + $" \(builtins.fromJSON ''($json)'')"
  )
  let result = (nix eval --json --apply $apply ".#lib.container" | from json)
  if $eval_only {
    $result.container
  } else {
    let built = (
      nix build
        --no-link
        --show-trace
        --json
        $"($result.nspawn)^*"
      | from json
      | get 0
    )
    let nspawn = ($built | get outputs | get out)
    if $build_only {
      $nspawn
    } else {
      let env_file = ($root | path join ".env")
      let env_args = if ($env_file | path exists) {
        [ $"--env-file=($env_file)" ]
      } else {
        [ ]
      }
      (sudo ($nspawn | path join "bin" "run-nspawn") ...$env_args)
    }
  }
}

def "main container client" [] {
  cd (flake-root)
  {
    model: "corm-endpoint:corm"
    stream: true
    repl_prelude: "session:corm-dev"
    save_session: false
    compress_threshold: 0
    clients: [
      {
        type: "openai-compatible"
        name: "corm-endpoint"
        api_base: "http://127.0.0.1:43371/v1"
        api_key: "corm"
        models: [ { name: "corm" } ]
      }
    ]
  }
    | to yaml
    | save -f ".corm-aichat.yaml"
  with-env { AICHAT_CONFIG_FILE: ".corm-aichat.yaml" } { aichat }
}

def "main bench" [name: string, args?: record, --eval-only] {
  cd (flake-root)
  let args = if $args == null {
    if (".corm-bench-config.toml" | path exists) {
      open ".corm-bench-config.toml" | get --optional $name | default { }
    } else {
      { }
    }
  } else { $args }
  let seed = (random chars)
  let json = ($args | upsert seed $seed | to json)
  let apply = (
    $"bench: let test = bench \"(corm system)\" \"($name)\""
    + $" \(builtins.fromJSON ''($json)''); in test.drvPath"
  )
  let drv = (nix eval --raw --apply $apply ".#lib.bench" | str trim)
  if $eval_only {
    $drv
  } else {
    let result = (
      nix build
        --print-build-logs
        --show-trace
        --json
        $"($drv)^*"
      | from json
      | get 0
    )
    print -e $"bench result: ($result | to json)"
    let out = ($result | get outputs | get out)
    open ($out | path join "bench.json")
      | save .corm-bench-result.toml
  }
}

def "corm e2e test base" [] {
  $"(flake-root)/src/corm/e2e/omw.test.base.json"
}

def "corm e2e test dump" [] {
  $"(flake-root)/src/corm/e2e/omw.test.dump.json"
}

def "corm omw types path" [] {
  $"(flake-root)/src/corm/omw.d.ts"
}

def "corm omw types url" [] {
  let lock = (open --raw ((flake-root) | path join "flake.lock") | from json)
  let rev = ($lock | get nodes.omw.locked.rev)
  ("https://raw.githubusercontent.com"
    + $"/haras-unicorn/omw/($rev)"
    + "/src/wasm/omw-wasm-js-interpreter/omw.all.d.ts")
}

def "corm tools list" [] {
  open (corm e2e test base)
    | get tooling
    | transpose key value
    | each { |row|
      $row.value.tools
        | get --optional name
        | each { |name| $"($row.key)__($name)" }
    }
    | flatten
    | compact
    | where { |name| not ($name in (
        open ((flake-root) | path join "src/corm/src/lib/disabled-tools.json")
      )) }
    | sort
    | uniq
}

def "corm tools path" [] {
  $"(flake-root)/src/nix/services/tools.json"
}

def "corm system" [] {
  $"(uname | get machine)-linux"
}
