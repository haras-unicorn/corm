def "main" [] {
  dev -h
}

def "main test" [] {
  cd (flake-root)
  node src/corm/build.mjs
  vitest run --configLoader runner
  omw-test run src/corm/e2e
}

def "main format" [] {
  cd (flake-root)
  prettier --write .
  nixfmt ...(fd '.*\.nix$' . | lines)
  biome format --write .
}

def "main lint" [] {
  cd (flake-root)
  prettier --check .
  cspell lint . --no-progress
  nixfmt --check ...(fd '.*\.nix$' . | lines)
  markdownlint --ignore-path .markdownignore .
  if ($env.NIX_BUILD_TOP? | is-empty) {
    (markdown-link-check
      --config .markdown-link-check.json
      --quiet
      ...(fd '.*.md' . | lines))
  }
  biome lint .
  nix flake check --all-systems --show-trace
}
