# AGENTS.md

Corm is the brain of Morgan Fetch.

Morgan Fetch is a fully self-contained agent: the `omw` runtime executes a
JavaScript brain inside its embedded Boa JS engine, and the corm service wires
that brain to MCP servers and llama.cpp so the whole thing runs anywhere. This
repo only contains the brain (plus the Nix plumbing to build it); the service
and machine configuration live in the maintainer's `dot` NixOS config. Changes
land through PRs to this repo, get reviewed and merged, and are then pulled into
that config — so this repo is the one controlled path from "the agent wants to
change itself" to "the change exists in the real world."

## Structure

- `src/corm` is the TypeScript package; the pnpm workspace root is the repo
  root.
- `src/corm/src/index.ts` is the entry: it subscribes the agent to the omw
  endpoint and drives the event loop. `src/corm/src/brain.ts` holds the
  provider-fallback and MCP tool loop; `src/corm/src/identity.ts` assembles the
  system prompt from the markdown in `src/corm/identity`. `src/corm/build.mjs`
  holds the esbuild config and bundles it into the single unminified
  `src/corm/dist/index.js` Boa script (platform `neutral`, format `iife`, target
  `esnext`, `.md` files loaded as text).
- `src/corm/src/omw.d.ts` is the hand-written ambient typing for the global
  `omw` host interface; the omw docs are the source of truth.
- `src/corm/identity` holds Morgan's identity documents (`SOUL.md`,
  `IDENTITY.md`, `USER.md`, `TOOLS.md`, `morgan-fetch.json`). The markdown is
  compiled into the brain at build time.
- `src/corm/e2e/**/omw.test.toml` are `omw-test` cases. The `script` path is
  relative to the config file.
- `src/nix` is the flake-parts module tree; `flake.nix` imports it with
  `import-tree`, so every `.nix` file under `src/nix` is a module:
  - `dev.nix` — pnpm toolchain, the `corm` package + overlay, and the default
    dev shell.
  - `dev.nu` — the nushell `dev` command dispatcher.
  - `llama.nix` — the `llama-moe-cache-cuda` package (the FATE / MoE-cache
    llama.cpp fork).
  - `git-mcp-server.nix` — the bun-based `git-mcp-server` package; its
    `git-mcp-server.nix.lock` is read from `src/nix`.
  - `service.nix` — the corm NixOS module (`flake.nixosModules.corm`): it
    imports the omw module and wires the brain to the llama servers, the MCP
    servers (including a bwrap-wrapped filesystem server), and the OpenRouter
    fallback provider.

## The brain contract

- The compiled script runs as a plain Boa script and talks to the host through
  the global `omw` (`provider`, `tooling`, `host`). Source may import local
  modules and `.ts` / `.json` / `.md` assets, which esbuild inlines, but must
  not use Node or DOM APIs or rely on runtime module loading.
- Stay within the ECMAScript subset Boa supports.
- esbuild pulls local source modules together into one IIFE; the output stays
  readable and unminified.

## Development

- `dev` is the nushell dispatcher; it has `test`, `format` and `lint`.
- `dev test` builds the script, runs the Vitest unit tests, then the `omw-test`
  Boa e2e suite under `src/corm/e2e`.
- Unit tests are Vitest projects, one per package: the root `vitest.config.ts`
  globs `src/*/vitest.config.ts`, so each package carries its own config and
  `*.test.ts` files. Vitest must run with `--configLoader runner` because the
  workspace `node_modules` is a read-only store symlink (Vite would otherwise
  try to create `node_modules/.vite-temp`).
- E2e uses the `omw-test` binary (js variant) from the `omw` flake input, which
  the dev shell provides alongside `omw`.
- `dev format` / `dev lint` run Prettier, nixfmt, Biome, cspell and
  markdownlint; `dev lint` also runs `nix flake check`.

## Nix and dependencies

- The dev shell symlinks the pnpm store into the workspace
  (`symlink-node-modules`). After changing dependencies, run `pnpm-with-reload`,
  then update `pnpmDepsHash` in `src/nix/dev.nix`.
- `nix build .#corm` compiles the script and exposes it as `$out/index.js`; the
  overlay provides `pkgs.corm`. There is no app — the script is not runnable on
  its own.
- Toolchain: `nodejs_26`, `pnpm_11`, esbuild 0.28, Vitest 5.
- TypeScript must stay on 6.x. 7.x is the native (Go) port and ships no
  `tsserver.js`, which `typescript-language-server` requires.

## Adding a package

Add it under `src/<name>`, list it in `pnpm-workspace.yaml`, give it its own
`vitest.config.ts` for unit tests, and wire anything needed into
`src/nix/dev.nix`.
