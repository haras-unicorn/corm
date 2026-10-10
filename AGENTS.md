# AGENTS.md

Corm is a local-first [omw] agent distribution for NixOS: the `omw` runtime
executes a JavaScript brain inside its embedded Boa JS engine, and the corm
service wires that brain to MCP servers and llama.cpp so the whole thing runs
anywhere. The repo contains the brain plus the Nix plumbing to build and run it;
the service and machine configuration live in the maintainer's `dot` NixOS
config. Changes land through PRs to this repo, get reviewed and merged, and are
then pulled into that config — so this repo is the one controlled path from "the
agent wants to change itself" to "the change exists in the real world."

## Structure

- `src/corm` is the TypeScript package; the pnpm workspace root is the repo
  root.
- `src/corm/src/index.ts` is the entry: it builds the handle/state/config
  managers and the shared context (wiring the configured `tools` subset into the
  tooling layer), creates the handler registrar and the machine, then drives the
  event loop over `omw.host.recv()`. On `reload` or `shutdown` it releases every
  manager and exits.
- `src/corm/src/services` holds the machine-level services:
  - `handles.ts` — the loaded providers (`gpu`, `remote`, `cpu`, in that
    fallback order), toolings (`nixos`, `nix`, `git`, `github`, `rss`, `plan`,
    `filesystem`), and the endpoint/lifecycle subscriptions (persisted in memory
    under `corm-subscriptions` and reused when the model still matches).
  - `config.ts` — the zod-validated `CormConfig` (`{ model, prompt?, tools? }`),
    loaded lazily from memory: it seeds from the nested `corm_config` object
    (seeded per-agent by `omw-config.nix`) then overlays one flat
    `corm_config_<field>` key per `cormConfigZod.shape` field, which is how the
    `OMW__` environment layering reaches the brain. `tools` is the
    `<tooling>__<tool>` subset the tooling layer exposes.
  - `tooling.ts` — the machine-level tooling layer: enumerates every tooling's
    `listTools()`, filters them against the configured `CormConfig.tools` subset
    and the internal always-disabled list (`lib/disabled-tools.json`) — both
    matched as `<tooling>__<tool>` — exposes the survivors as
    `corm__<tooling>__<tool>`, resolves ownership, and runs the async `callTool`
    / `tool-result` / `error` lifecycle. An absent subset exposes everything, an
    empty one exposes nothing; a configured name that matches no tooling logs a
    warning. This is the seam for future high-entropy token redaction (not
    implemented).
  - `state.ts` — the task-state manager. Its startup filesystem read and
    shutdown filesystem write via `callToolBlocking` are the single sanctioned
    blocking calls in corm (see below).
  - `machine.ts` — the task stack and pending queue. It handles lifecycle events
    at the machine level, routes stream events by owning generation/UUID, and
    applies the scheduling policy: a same-session `endpoint-message` merges into
    the active chat task, a different session while an atomic task is active is
    queued `pending`, otherwise it is `immediate`.
  - `registrar.ts` / `registry.ts` — the handler factory registry.
  - `context.ts`, `opaque.ts`, `keys.ts` — the shared `CormContext`, the zod
    schemas for opaque stored data (subscriptions, task state/specs, config),
    and the memory/state keys.
- `src/corm/src/lib` holds shared helpers: `omw.ts` binds the generated test
  config into the `CormOmw` alias (and the provider/tooling name unions) so no
  source uses the unconstrained global `Omw`, `tools.ts` extracts text from
  `ToolResult` content, and `disabled-tools.json` is the always-disabled tool
  list shared with the Nix tooling list.
- `src/corm/src/handlers/chat.ts` is the one handler: the async MCP tool loop.
  It selects a provider with fallback (gpu → remote → cpu), reads the model from
  the config service (falling back to `provider.listModels()[0]`), trims the
  stored `_messages` to the last 32 before each turn, injects the configured
  `prompt` as the leading system message on every `_beginTurn` (the stored
  `_messages` stays prompt-free, so it survives a merge and is never
  duplicated), streams text/reasoning/usage/tool-call deltas to the endpoint,
  executes `corm__*` calls via the tooling layer and re-prompts, and forwards
  unknown/client tool calls to the endpoint without executing them.
- `src/corm/esbuild.mjs` holds the esbuild config and bundles the brain into the
  single unminified `src/corm/dist/index.js` Boa script (platform `neutral`,
  format `iife`, target `esnext`).
- `src/corm/omw.d.ts` is the upstream `omw.all.d.ts`, curl'd from the pinned omw
  rev (the flake input is the single source of truth); `dev format` refreshes it
  and `dev lint check` fails on drift. `src/corm/e2e/omw.test.base.json` is the
  scaffolded `omw-test` base config rendered by `dev format`; the brain imports
  it type-only (`omw as CormOmw`), which esbuild erases.
- `src/corm/e2e/<case>.omw.test.toml` are per-case override fragments layered
  over that base by `omw-test`.
- `src/nix` is the flake-parts module tree; `flake.nix` imports it with
  `import-tree`, so every `.nix` file under `src/nix` is a module:
  - `nixpkgs/default.nix` — the flake `systems` and the shared nixpkgs
    instantiation (`cudaSupport`, `allowUnfree`, the input overlays).
  - `lib.nix` — `flake.lib`: the input/self overlay lists, the openrouter
    default, allowed media domains, the bubblewrap bind sets (`base` plus a
    `container` variant that drops `--proc`), service ports, the `llama` version
    shim, and `provider` — the shared CPU/GPU provider skeleton (hardening, the
    `corm-<name>-provider` state dir/path, and the prepare/serve/warmup unit
    skeletons).
  - `dev.nix` — the dev shell (pnpm toolchain, `omw` / `omw-test`, `aichat`,
    `systemd-nspawn`, `sudo`, linters, `tokenize`) and the `dev` dispatcher
    wrapper. It exposes `default`/`corm` dev shells plus a `ci` alias the GitHub
    workflows run through `nix develop .#ci --command dev …`. Its `shellHook`
    regenerates the (gitignored) `bench/prompts` by `head -c`-ing
    `cormPackages.prompts`.
  - `dev.nu` — the nushell `dev` command dispatcher.
  - `docs.nix` — the documentation packages: `.#options` renders the NixOS
    option reference from `self.nixosModules.corm` with `pkgs.nixosOptionsDoc`
    (evaluated through `eval-config.nix` with a CUDA-enabled `pkgs`, filtered to
    `corm.*`), and `.#docs` builds the `docs/` mdBook with `mdbook build`.
  - `packages/` — one module per package: `corm.nix`, `models.nix`,
    `fetchhf.nix`, `fetchgguf.nix`, `tokenize.nix`, `prompts.nix`,
    `mcp-server-filesystem-bwrap.nix`, `llama-cpp-moe-cache-cuda.nix` (the FATE
    / MoE-cache llama.cpp fork), `llama-cpp-convert.nix` (the HuggingFace→GGUF
    converter from the fork source, since nixpkgs' `llama-cpp` ships only the
    C++ binaries), `git-mcp-server/default.nix` (bun-based, with a `bun2nix`
    lock), `freetoken/default.nix` (the FreeToken Desktop AppImage plus the `ft`
    engine built with `uv2nix` from `pyproject.toml` + `default.nix.lock`),
    `strata.nix` (the Strata engine, server and the GGUF pack/MTP derivations,
    all built from source), `release-please.nix` (the pinned release-please CLI
    the `dev` release commands run), and `omw-config.nix`. The bwrap-based MCPs
    (`mcp-server-filesystem-bwrap` and `git-mcp-server-ssh-agent`) take a
    `bwrapArgs` `callPackage` argument (null keeps `selfLib.bwrap.base`);
    `omw-config.nix` takes `cormBwrapArgs` so a deployment can swap the bind
    set. The `nix` tooling points mcp-nix's own sandbox (via `MCP_NIX_SANDBOX`,
    whitespace-split) at that same bind set, keeps its `--unshare-all`, and
    binds the agent workspace read-write so `nix_run` / `nix_develop` can work
    inside it.
    - `strata.nix` exposes `cormPackages.strata-engine` (CMake/Ninja with CUDA
      13, the pinned llama.cpp passed as `STRATA_GGML_DIR`),
      `cormPackages.strata-tools` (server, pack tools, `data/` and vendored
      `gguf-py`, engine-independent), `cormPackages.strata` (the server wrapper
      over the two), and the `strata-pack` (a function of the model) and
      `strata-mtp` builders. The hardware options (`cudaArchitectures`,
      `portable`, `march`) are `callPackage` arguments so they can be overridden
      per machine; the Strata, llama.cpp and MTP sources are pinned here.
    - `fetchhf.nix` exposes `cormPackages.fetchhf`, a fixed-output derivation
      that snapshots a raw HuggingFace repository (`hf download`, recursive
      hash) and surfaces the checkpoint's name, type, architectures and context
      length on `passthru`.
    - `fetchgguf.nix` exposes `cormPackages.fetchgguf`, the same idea for a
      pre-quantized GGUF repository but restricted to a subdirectory
      (`--include`); both fetchers also take a `passthru` argument that is
      merged over their generic `passthru`, which is how a model definition
      hands the Strata provider its shard/PLE/mmproj names.
    - `tokenize.nix` exposes `cormPackages.tokenize`, a tiny HuggingFace
      tokenizers CLI that prints the token count of a corpus file
      (`tokenize <corpus> [tokenizer.json]`, defaulting to the `qwen-3-5-800M`
      model's `tokenizer.json`).
    - `prompts.nix` exposes `cormPackages.prompts`, a plain attrset of the
      `fetchurl`ed Gutenberg corpus packages; the dev shell's `shellHook`
      concatenates them and `head -c`s the `8k`…`1024k` benchmark prompts.
    - `models.nix` uses `cormPackages.fetchhf` (raw safetensors) and
      `cormPackages.fetchgguf` (pre-quantized GGUF); each backend
      converts/prepares the checkpoint before serving.
      `qwen-3-8-flash-next-iq2-xs` (ISTA-DASLab IQ2_XS plus the vision mmproj)
      is the only model Strata runs.
  - `services/` — the corm NixOS modules. `corm.nix` is the orchestrator: it
    declares `corm.enable`, the freeform `corm.settings` (whose description
    lists the raw tool names from the generated `services/tools.json`), imports
    the provider modules, creates the `corm` user/group, and defines the
    `corm.target` unit (`wantedBy multi-user.target`,
    `after network-online.target`). Every provider service is
    `requiredBy`/`bindsTo` `corm.target`, so they come up and go down together.
    The modules are:
    - `cpu-provider.nix` — `corm.cpu-provider`, `llama-cpp` kind on nixpkgs
      `llama-cpp`, with the multimodal projector (`--mmproj`) exported too. It
      takes its hardening, state dir and prepare/serve/warmup unit skeletons
      from `selfLib.provider "cpu"`.
    - `embedding.nix` — `corm.embedding`, `llama-cpp` kind serving embeddings.
    - `remote-provider.nix` — `corm.remote-provider` (openrouter by default).
    - `endpoint.nix` — `corm.endpoint`, the OpenAI-compatible endpoint plus the
      `aichat` client; its model defaults to the configured agent name.
    - `omw.nix` — `corm.omw`, a thin wrapper over the omw flake's `services.omw`
      module (imports `inputs.omw.nixosModules.default`). It exposes `agent`,
      `variant`, `script`, `mode`, `environmentFile`, `bwrapArgs` (the
      bubblewrap arguments handed to the wrapped MCPs) and `memory` (extra
      seeded per-agent memory keys, how the benchmarks hand the brain its
      prompt), hardcodes the rest, and builds `services.omw.settingsFile` by
      overriding the `omw-config` package with the provider endpoints/models and
      the agent script (so the service and the scaffolded test config share a
      shape). Every provider runs a `<name>-prepare` oneshot before its serve
      unit: it converts the configured store checkpoint into a writable
      `StateDirectory` (`model.gguf` via `llama-cpp-convert` + `llama-quantize`,
      or `model.ftw` via `ft checkpoint`) and stamps the source path in
      `model.path`, re-converting only when that path changes. The `strata` kind
      has nothing to convert (its pack and MTP are store derivations), so its
      prepare unit is a no-op. The CPU/GPU providers then run a
      `<name>-provider-warmup` oneshot after their serve unit: it POSTs a
      minimal `/v1/chat/completions` request in a loop until the provider
      answers, then stays `RemainAfterExit` so omw starts only once the model is
      loaded.
  - `gpu-provider/` — the GPU provider, one file per kind plus `warmup.nix`.
    `options.nix` declares the generic options plus an internal `kinds` registry
    (an attrset of options) and a `kind` attrTag built from it; each kind file
    registers `corm.gpu-provider.kinds.<name>` and gates its units with `mkIf`
    (no shared merge): `llama-cpp.nix` (the FATE fork, `--fate` cache),
    `freetoken.nix` (the `ft` engine) and `strata.nix` (the Strata engine,
    pinned to the ISTA-DASLab IQ2_XS GGUF, pack and MTP as store derivations).
    `default.nix` is the `corm-gpu-provider` module importing all of them, the
    shared hardening and prepare/serve/warmup unit skeletons live in
    `selfLib.provider "gpu"`, and the kind-independent GPU warmup unit is
    declared in `warmup.nix`. The `strata` kind exposes `cudaArchitectures`,
    `portable` and `march` to target the machine's hardware.
  - `tests/` — `default.nix` turns each `corm.tests.<name>` into a
    `containers.agent` NixOS test and a `checks` entry (CUDA tests are exposed
    only via `dev test nixos`); `llama-cpp.nix` (the CPU `cpu-provider` smoke
    test) and `agent-name.nix` are the existing cases.
  - `bench/` — the parameterized benchmarks. `corm.bench.<name>` declares each
    one (`cuda`, a default `prompt`, and a `module` that is a function of the
    bench args returning a NixOS test module); `corm.lib.bench` is the functor
    `system: name: args: test` that wires the module into `runNixOSTest`, seeds
    `corm.omw.memory.bench-provider`/`bench-prompt` and the `bench.js` brain,
    and exposes the result as `$out/bench.json`. The cases (`strata.nix`,
    `freetoken.nix`, `llama-cpp.nix`) take `model`, `ctx`, `prompt`, `seed` and
    their provider options (package values are package names resolved through
    `pkgs.cormPackages`), defaulting to the current config. `bench.js` does a
    short warmup `chat` that invalidates the KV cache, then a streamed
    `chatStream` over the prompt, timing prefill/generation and logging a JSON
    report as `CORM BENCH RESULT: …`. `bench/prompts/<prompt>.md` holds the
    prompt bodies; the folder is gitignored and regenerated by the dev shell's
    `shellHook` from `cormPackages.prompts`.
  - `containers/` — live nspawn configurations. `corm.container.<name>` holds a
    CUDA setting and a function from preset args to a NixOS module;
    `corm.lib.container` builds the named guest with the existing corm module,
    the preset module, and optional `args.corm` overrides. The `llama-cpp`,
    `freetoken`, and `strata` presets mirror the benchmarks' provider options.
    The guest sets `corm.omw.bwrapArgs = selfLib.bwrap.container`, so the
    bubblewrap MCPs drop the `--proc /proc` mount nspawn cannot provide. The
    container functor injects an inline NixOS module (borrowed from nixpkgs'
    `nspawn-container`) that declares `virtualisation.rootDir`, `stateDir`,
    `environmentFile`, `cmdline` and `systemd-nspawn.{package,options}` and
    exposes `system.build.nspawn`: a wrapper that creates the guest root, state
    and nix profile/gcroot dirs, then `exec`s `systemd-nspawn` with the guest
    `init` as a positional argument. The guest runs a read-only console with the
    journal forwarded to it (`services.journald.console`), so provider, MCP and
    omw output streams to the terminal (this also covers native-journald loggers
    like omw; `Ctrl-C` triggers an orderly shutdown) and the container getty
    disabled, and enables test-style root SSH over `systemd-nspawn`'s
    unix-export socket (`/run/systemd/nspawn/unix-export/<machine>/ssh`, empty
    password) without binding TCP port 22. `dev container start <name> [args?]`
    reads defaults from the ignored root `.corm.container.json`; an explicit CLI
    record replaces that preset's stored record. It builds `system.build.nspawn`
    and runs it in the foreground. The wrapper binds persistent `/var/lib/corm`
    state, the host Nix store/database/socket and root `.env`, shares host
    networking with the endpoint restricted to loopback, and forwards omw logs
    to the terminal. `dev container client` runs the `aichat` client against
    that endpoint.

## The brain contract

- The compiled script runs as a plain Boa script and talks to the host through
  the global `omw` (`provider`, `tooling`, `host`). Source may import local
  modules and `.ts` / `.json` assets, which esbuild inlines, but must not use
  Node or DOM APIs or rely on runtime module loading.
- Stay within the ECMAScript subset Boa supports.
- esbuild pulls local source modules together into one IIFE; the output stays
  readable and unminified.
- **No blocking calls.** `callToolBlocking` and the in-band blocking
  `provider.chat` are banned; tool calls are async (`callTool` returns a UUID
  and the matching `tool-result` / `error` event drives the loop). The one
  sanctioned exception is the state manager's filesystem read/write at
  startup/shutdown so task state survives a shutdown.

## Logging

The brain logs through `omw.host.log(level, message)` (omw echoes it to the
journal). `corm/lib/log.ts` wraps that host method in a `CormLogger` with one
method per level; handlers read it from `context.logger`, and the managers build
one from their `omw.host`. Every log site picks its level from this fixed
policy:

- **Unrecoverable errors throw.** When the program cannot continue (no provider
  configured, unknown tool/factory kind, malformed restored state), throw and
  let it propagate; do not swallow it behind a log.
- **Recoverable errors log `error`.** A failure the code handles by falling back
  (an invalid config, a tool that errored but whose result is still fed back to
  the model) is surfaced at `error`.
- **Transient errors log `warn`.** Environment or timing failures that may
  resolve on their own (a failed filesystem recovery, an unavailable optional
  tooling, a provider that fell back to the next one) are `warn`.
- **Big state transitions log `info`.** Startup/ready/stop, task start and
  pending drain, a new or restarted turn, subscriptions created or recreated,
  shutdown persistence, and provider/model selection are `info`.
- **Sub-state transitions log `debug`.** Placement and dispatch decisions, queue
  merges, turn resets, stream finishes, tool registration and queuing, and
  config/subscription loading are `debug`.
- **Critical function calls log `trace`.** Entry/exit of the routing seams
  (`machine.handle`, registrar `should`/`create`, `tooling.invoke`/`settle`,
  `_beginTurn`, `_resume`) and per-event receipt are `trace`.

Keep messages concise and include the identifiers that matter for the seam (task
id, session, provider, tool, uuid). The unit-test fake host already provides a
no-op `log`, so instrumenting a manager or handler never requires a test change.

## Documentation

- `README.md` is the canonical entry point: it carries the install, configure
  and secrets sections, and its secrets section is the full index of every
  environment variable Corm reads. Keep it in sync when adding or renaming one.
- **Never edit `CONTRIBUTING.md`.** It is deliberately minimal and exists only
  to point developers at the dev shell so they can explore on their own; treat
  it as out of scope for every change.
- `docs/` is an mdBook (`book.toml`, `SUMMARY.md`); `docs/introduction.md`
  includes the README body between the `ANCHOR: body` markers. `docs/options.md`
  is generated, never hand-edited: `dev docs` rewrites it from `.#options`,
  `dev format` calls it, and `dev lint check` fails on drift. The `docs`
  workflow builds `.#docs` and deploys it to GitHub Pages.

## Releases

Merges to `main` are released by `release-please` (`release-please-config.json`,
`.release-please-manifest.json`). The `release.yaml` workflow only installs Nix
and runs `nix develop .#ci --command dev release`; `dev release` runs the
nix-packaged `release-please` (`src/nix/packages/release-please.nix`) for both
the release PR and the GitHub release, and `dev release-pr` runs just the PR.
The tracked package is `src/corm`; the version in `src/nix/packages/corm.nix`
carries the `# x-release-please-version` annotation so it is bumped alongside
`src/corm/package.json`. `check.yaml` runs the lint jobs on every pull request.

## Development

- `dev` is the nushell dispatcher:
  - `dev format` — regenerate `e2e/omw.test.base.json` (via
    `nix build .#omw-scaffold-config` + `omw scaffold`), `services/tools.json`
    (the tool names the scaffold exposes, minus the always-disabled ones), the
    vendored `omw.d.ts` and `docs/options.md`, then run Prettier, taplo, nixfmt
    and Biome.
  - `dev docs` — regenerate `docs/options.md` from `.#options`.
  - `dev tools` — regenerate `services/tools.json` from the generated
    `e2e/omw.test.base.json`.
  - `dev release` / `dev release-pr` — run the pinned `release-please` against
    `release-please-config.json` + `.release-please-manifest.json` (using
    `GITHUB_TOKEN` and `GITHUB_REPOSITORY`); the release workflow calls
    `dev release`.
  - `dev lint` — `lint check` + `lint test` + `lint nix`.
    - `dev lint check` — verify `omw.d.ts`, `docs/options.md` and
      `services/tools.json` are fresh, that no tooling in the base config is
      empty, and run
      Prettier/taplo/nixfmt/cspell/markdownlint/markdown-link-check/Biome in
      check mode.
    - `dev lint test` — `test unit` + `test e2e`.
    - `dev lint nix` — `nix flake check`.
  - `dev test` — `test unit` + `test e2e`; `dev test nixos <name>` builds one
    NixOS test, `dev test nixos interactive <name>` runs it interactively.
  - `dev bench` — build one `bench/` benchmark with a fresh random `seed` (so
    nix re-runs it) and an optional args record, applying `lib.bench` through
    `nix eval --apply` and then building its derivation, then print the
    `$out/bench.json` report. `--eval-only` evaluates the derivation without
    building it.
  - `dev container start <name> [args?]` — build the named NixOS guest's
    `system.build.nspawn` wrapper and run it with `systemd-nspawn`; Ctrl-C shuts
    it down. Preset defaults can be configured in `.corm.container.json` or by a
    CLI record. `--eval-only` evaluates the guest without building or starting
    it, and `--build-only` builds the wrapper without starting it.
  - `dev container client` — write an ignored `.corm-aichat.yaml` pointed at the
    endpoint and launch `aichat` against it.
  - `dev` also exposes `corm e2e test base`, `corm e2e test dump`,
    `corm omw types path`, `corm omw types url`, `corm tools path` and
    `corm system`.
- Unit tests live in `src/<pkg>/test/`, mirroring the source tree; each package
  carries its own `vitest.config.ts` (the root `vitest.config.ts` globs
  `src/*/vitest.config.ts`) with `include: ["test/**/*.ts"]` and the shared
  dependency-injected fakes in `test/common.ts` (excluded from discovery).
  Vitest must run with `--configLoader runner` because the workspace
  `node_modules` is a read-only store symlink (Vite would otherwise try to
  create `node_modules/.vite-temp`). Tests are dependency-injected and do not
  stub the global `omw`.
- E2e uses the `omw-test` binary (js variant) from the `omw` flake input, which
  the dev shell provides alongside `omw`. It layers each
  `e2e/<case>.omw.test.toml` over `e2e/omw.test.base.json`. `omw-test --dump`
  (trace, assertion cursor, mock snapshots) is the tool for debugging a failing
  or hanging case. Note the mock endpoint never emits `endpoint-session-end`, so
  that path is not scriptable in e2e.

## Nix and dependencies

- The dev shell symlinks the pnpm store into the workspace
  (`symlink-node-modules`). After changing dependencies, run `pnpm-with-reload`,
  then update `pnpmDepsHash` in `src/nix/packages/corm.nix`.
- `nix build .#corm` compiles the script and exposes it as `$out/index.js`; the
  overlay provides `pkgs.cormPackages.corm`. There is no app — the script is not
  runnable on its own.
- `nix build .#omw-config` renders the deployment settings to `omw.toml`; the
  TOML embeds store paths, so building it also realizes the referenced MCP
  servers.
- `corm.lib.container system name args` builds a live NixOS guest system and
  realizes its brain and MCP servers. The dev runner applies the flake library
  with `nix eval --apply` to get the guest's `container` and `nspawn`
  derivations, then builds the `nspawn` output (`$drv^*`) so CLI and
  `.corm.container.json` args can be applied without impure evaluation.
- `nix build .#llama-cpp-convert` builds the HF→GGUF converter wrapper. The
  model packages (`.#qwen-3-5-800M`, `.#occamy`, `.#gemma-4-e4b`,
  `.#qwen-3-embedding`) are `fetchhf` fixed-output derivations of raw HF repos.
- `nix build .#freetoken-engine` builds the FreeToken engine (the `ft` CLI) with
  `uv2nix`, driven by the vendored `default.nix.lock`; the output is just
  `bin/ft`, with the virtualenv in the closure. `freetoken-engine-dev` adds a
  runtime CUDA toolchain so FreeToken's JIT fallback works for checkpoints the
  prebuilt kernel cache does not cover.
- Toolchain: `nodejs_26`, `pnpm_11`, esbuild 0.28, Vitest 5.
- TypeScript must stay on 6.x. 7.x is the native (Go) port and ships no
  `tsserver.js`, which `typescript-language-server` requires.

## Adding a package

Add it under `src/<name>`, list it in `pnpm-workspace.yaml`, give it its own
`vitest.config.ts` for unit tests, and wire anything needed into
`src/nix/dev.nix`.

[omw]: https://github.com/haras-unicorn/omw
