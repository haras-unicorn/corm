def "main" [] {
  dev -h
}

def "main format" [] {
  cd (flake-root)
  let template = $"(flake-root)/src/corm/omw.test.template.toml"
  let config = (nix build ".#omw-scaffold-config" --no-link --print-out-paths | str trim)
  omw scaffold $config --output $template --no-resources --force
  (open $template
    | update agents.corm.script "src/corm/dist/index.js"
    | update providers.remote.models [ ]
    | collect
    | save -f $template)
  rm -rf /tmp/corm-scaffold
  corm omw-dts-sync
  prettier --write .
  taplo format ...(fd --glob '**/*.toml' . | lines)
  nixfmt ...(fd --glob '**/*.nix' . | lines)
  biome format --write .
}

def "main test" [] {
  corm test-all
}

def "main dts" [] {
  cd (flake-root)
  corm omw-dts-sync
}

def "main typecheck" [] {
  cd (flake-root)
  node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
}

def "main stage" [] {
  cd (flake-root)
  git add -A
}

def "main e2e-dump" [case: string, a: string, b?: string, c?: string] {
  cd (flake-root)
  let template = (open src/corm/omw.test.template.toml | corm strip empty arrays)
  let merged = ($template | merge deep (open $case))
  mut out = ($merged | get $a)
  if $b != null {
    $out = ($out | get $b)
  }
  if $c != null {
    $out = ($out | get $c)
  }
  $out | to json
}

def "corm test-all" [] {
  cd (flake-root)
  for esbuild in (glob **/esbuild.mjs) {
    node $esbuild
  }
  vitest run --configLoader runner
  let template = (open src/corm/omw.test.template.toml | corm strip empty arrays)
  mut failed = false
  for case in (glob "src/corm/e2e/**/*.omw.test.toml") {
    let override = (open $case)
    $template
      | merge deep (open $case)
      | to toml
      | ^omw-test run /dev/stdin --format toml
    if $env.LAST_EXIT_CODE != 0 {
      $failed = true
    }
  }
  if $failed {
    error make { msg: "e2e tests failed" }
  }
}

def "main lint" [] {
  cd (flake-root)
  corm omw-dts-check
  let template = $"(flake-root)/src/corm/omw.test.template.toml"
  let empty_toolings = open $template
    | get tooling
    | transpose key value
    | where { ($in.value.tools | length) == 0 }
  if ($empty_toolings | is-not-empty) {
    print $"toolings ($empty_toolings | get key | str join ', ') are empty"
    exit 1
  }
  prettier --check .
  taplo check ...(fd --glob '**/*.toml' . | lines)
  nixfmt --check ...(fd '.*\.nix$' . | lines)
  cspell lint . --no-progress
  markdownlint --ignore-path .markdownignore .
  if ($env.NIX_BUILD_TOP? | is-empty) {
    (markdown-link-check
      --config .markdown-link-check.json
      --quiet
      ...(fd '.*.md' . | lines))
  }
  biome lint .
  nix flake check --all-systems --show-trace
  corm test-all
}

def "main test nixos" [test: string] {
  cd (flake-root)
  (nix build -L $".#lib.tests.(corm system).($test)")
}

def "main test nixos interactive" [test: string] {
  cd (flake-root)
  nix run $".#lib.tests.(corm system).($test).driverInteractive"
}

def "corm strip empty arrays" [] {
  let value = $in
  let kind = ($value | describe)
  if ($kind | str starts-with "record") {
    $value
    | transpose key val
    | reduce -f {} {|entry, acc|
        if (($entry.val | describe | str starts-with "list") and ($entry.val | length) == 0) {
          $acc
        } else {
          $acc | upsert $entry.key ($entry.val | corm strip empty arrays)
        }
      }
  } else if (($kind | str starts-with "list") or ($kind | str starts-with "table")) {
    $value | each {|item| $item | corm strip empty arrays }
  } else {
    $value
  }
}

def "corm system" [] {
  $"(uname | get machine)-linux"
}

def "corm omw-dts-url" [] {
  let owner = (nix eval --raw ".#lib.omw.owner" | str trim)
  let repo = (nix eval --raw ".#lib.omw.repo" | str trim)
  let rev = (nix eval --raw ".#lib.omw.rev" | str trim)
  let dts = (nix eval --raw ".#lib.omw.dts" | str trim)
  $"https://raw.githubusercontent.com/($owner)/($repo)/($rev)/($dts)"
}

def "corm omw-dts-sync" [] {
  cd (flake-root)
  let url = (corm omw-dts-url)
  curl -fsSL $url -o src/corm/omw.d.ts
  open src/corm/omw.test.template.toml
    | to json
    | save -f src/corm/omw.test.template.json
}

def "corm omw-dts-check" [] {
  cd (flake-root)
  let url = (corm omw-dts-url)
  let tmp = (mktemp)
  curl -fsSL $url -o $tmp
  if ((open --raw $tmp | str trim) != (open --raw src/corm/omw.d.ts | str trim)) {
    rm $tmp
    error make { msg: "src/corm/omw.d.ts is stale; run `dev format`" }
  }
  rm $tmp
  let expected = (open src/corm/omw.test.template.toml | to json)
  let actual = (open src/corm/omw.test.template.json | to json)
  if $expected != $actual {
    error make { msg: "src/corm/omw.test.template.json is stale; run `dev format`" }
  }
}
