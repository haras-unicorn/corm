# AGENTS.md

Corm is a local-first [omw] agent distribution for NixOS: the `omw` runtime
executes a JavaScript brain inside its embedded Boa JS engine, and the corm
service wires that brain to MCP servers and llama.cpp so the whole thing runs
anywhere. The repo contains the brain plus the Nix plumbing to build and run it;
the service and machine configuration live in the maintainer's `dot` NixOS
config. Changes land through PRs to this repo, get reviewed and merged, and are
then pulled into that config — so this repo is the one controlled path from "the
agent wants to change itself" to "the change exists in the real world."

## The one invariant

**MUST: Corm keeps a 100% provider KV-cache hit rate.** Corm targets constrained
single-GPU, single-agent setups, and it reaches that by context stacking and
compaction: the shared context window only ever grows, and every non-append call
(compaction) appends its instruction at the end so the provider reuses the
cached prefix instead of rewriting it. No change to the brain may slide,
reorder, or rewrite the prefix. This invariant overrides convenience; treat any
design that breaks it as wrong.

## Guidelines

These are maintainer-stated development rules for this repository. Everything
outside this section is pre-existing project documentation.

- Do not couple generic events to specific reducers. A generic event kind (for
  example `timer`) is not owned by a system; the system's reducer must match its
  own id/handle and drop everything else.
- Do not invent new state or config sources. New state belongs in the existing
  `disk`/`memory` state model, and new knobs belong in the existing config
  object; do not add parallel memory keys or side stores.
- Do not make synthetic events or actions. Actions are only the events omw
  delivers.
- Keep one reducer per system, with its own `disk`/`memory` state key. The
  window is shared.
- Startup and scheduling decisions belong in the dispatcher. The entry loop
  pumps once at startup and after each event; do not add a drain loop.
- Inbox messages are answered immediately. For now they preempt only a running
  digest: cancel it, answer the inbox message, then resume the digest. A
  foreground endpoint turn, a compaction or an outstanding tool call is not
  preempted.
- Follow the existing persistence model: ephemeral handles (subscriptions,
  timer ids) live in memory and do not survive shutdown; durable state lives in
  disk.
- Put default constructors next to their types (like `defaultTurn` and
  `defaultDisk`), and pass the config in so derived defaults come from it.
- Do not store data that already exists in the window (for example a digest
  history).
- Do not add helper layers around persistence; parse stored state or use the
  defaults.
- `dev test unit` and `dev test e2e` are enough to validate a change. Do not
  worry about untracked files, and leave formatting and linting to the
  maintainer.

## Structure

- `src/corm` is the TypeScript package; the pnpm workspace root is the repo
  root.
- `src/corm/src/index.ts` is the entry: it builds the config, handles and state
  managers (in that order — handles depend on the loaded config), constructs the
  dispatcher (whose constructor arms the digest or parks a catch-up run), then
  drives the event loop over `omw.host.recv()`. Each event is passed to
  `reduce(event, state, config, now)` and every returned effect to
  `dispatcher.dispatch(effect)`; after each event `pump()` starts at most one
  queued job — the next inbox endpoint request, otherwise a pending digest.
  `pump()` also runs once at startup, so restored inbox messages are answered
  first. On `reload` or `shutdown` it releases the state manager (persisting
  disk to memory or filesystem) and exits.
- `src/corm/src/types` is the data model and its zod schemas: `state.ts`
  (`CormState = { memory, disk }`, with the compiled `cormMemoryStateZod`, the
  persisted `cormStoredDiskStateZod` and `defaultDisk(config, tools, stored?)`;
  disk carries the transient `notices` queue and `digest.last`), `window.ts`
  (`CormWindow`), `turn.ts` (`CormTurn`, `defaultTurn`, including the `digest` /
  `digestSince` turn flags), `message.ts` (the `CormMessage` family),
  `config.ts` (`CormConfig` and the digest/notice knobs), `subscriptions.ts`
  (the ephemeral digest `timer` handle and `pending` job), `inbox.ts` (a queue
  of endpoint `CormAction`s), `action.ts` (`CormAction = CormOmwEvent`),
  `reducer.ts` (`CormReducer`, with the optional `now` clock input for the
  digest timer), `omw.ts` (the generated-config-bound omw aliases and the
  provider/tooling name unions) and `fns.ts`
  (`matchTaggedUnionExhaustively`).
- `src/corm/src/effects` is the effect vocabulary. `index.ts` defines
  `CormEffect`, the per-kind rule map, and
  `approveEffects(state, action, ...effects)`: it type-checks a sequence by
  threading each rule's `next` state through the chain (so an illegal pairing
  fails to compile) and returns it as `CormApprovedEffect`. `generation.ts`
  (start-chat-generation, start-compaction-generation, commit-compaction,
  cancel-generation, clear-generation, invoke-corm-tools, retry-text-tool-call,
  circuit-break, plus the `isGenerationFree` / `Active` / `Compacting`
  predicates), `digest.ts` (arm-digest-timer, start-digest, queue-digest,
  commit-digest), `window.ts`
  (set-active-request, append-inbound-messages, enqueue-inbound,
  append-runtime-message, append-recap, append-tool-result, queue-notice,
  flush-notices), `stream.ts` (fold-chat-delta, stream-endpoint-delta) and
  `noop.ts` (the deliberate-drop marker).
- `src/corm/src/reducers` holds the pure decisions, one per event family, each
  `(action, state, config) => CormApprovedEffect[]`. `index.ts` routes by event
  kind (`error` goes to `toolReducer` when the id owns an awaited call, else
  `chatReducer`; `timer` goes to `digestReducer` with the clock). `digest.ts`
  owns only the digest's own `timer` id: start when idle, queue when busy, skip
  and re-arm a fire within `digestMinGapMs`, and drop every other timer.
  `endpoint.ts` owns `endpoint-message` / `endpoint-session-end` (queue-while-
  busy with a runtime notice, preempt a streaming digest, recap with the
  endpoint notice, ingest, and start chat or compact); `chat.ts` owns
  `chat-delta` / `chat-end` /
  `error` (the turn protocol: delta folding, mid-stream hard-threshold
  compaction, text-tool-call retry, unavailable-tool rejection, digest
  commit/re-arm, digest resume notice, soft-threshold compaction on completion);
  `tool.ts` owns `tool-result` / `error` (a failed tool becomes a `tool`
  message, the circuit breaker trips on repeats, and parked notices flush before
  a re-prompt); `dropped.ts` is the shared "meaningless here" reducer returning
  a single `noop`.
- `src/corm/src/services` is the impure, class-based layer (classes live only
  here): `handles.ts` (the loaded providers and toolings: it probes only the
  `config.providers` / `config.toolings` names plus the always-present
  `internal-` toolings (`cormInternalToolingNames`), tolerating a lookup miss so
  a deployment that enables a subset never crashes on the rest — `provider` /
  `tooling` return `undefined` for an absent name — with a `gpu → cpu → remote`
  chat fallback for providers; the `nixos` / `nix` / `git` / `github` / `rss` /
  `plan` / `filesystem` toolings are exposed to the model as
  `corm__<tooling>__<tool>`, while `internal-` toolings are probed but their
  tools are kept out of that list), `config.ts` (the lazy `CormConfig`: it seeds
  from the `corm_config` object, overlays each flat `corm_config_<field>` key —
  JSON-parsed when it parses — then `.parse()` + `validateConfig`, so a bad
  config is a hard startup fail; it reads memory through `omw.host` directly, so
  it does not depend on the handles), `state.ts` (memory subscriptions plus disk
  task-state load and persist, seeding `window.tools` from the handles' tools
  filtered by `config.tools` and the disabled list; it uses the private
  `internal-filesystem` tooling for the sanctioned blocking state read/write and
  skips it when that tooling is absent; it resets the ephemeral generation and
  digest subscriptions),
  `logger.ts` (`CormLogger` over `host.log`) and `dispatch.ts` (the single
  impure dispatcher, one method per effect kind, performing the host call and
  mutating `CormState`; its constructor arms the digest or parks a catch-up,
  `startPendingDigest()` starts or resumes a parked job, and an empty
  `window.session` makes streaming a no-op).
- `src/corm/src/lib` holds the pure helpers: `window.ts` (framing-aware ingest,
  truncation, digest classification, `windowInput`, the size thresholds,
  `commitCompaction` and recap detection), `messages.ts` (message constructors,
  `foldAssistant`, `clientDelta`, `recomputeMessage`), `turn.ts` (`isTurnIdling`
  / `isTurnChatting` / `isTurnCompacting` / `hasAwaitingTools` / `isTurnBusy`),
  `defaults.ts` (every `CORM_DEFAULT_*` constant, including the digest prompt,
  notices and schedule windows), `config.ts` (`validateConfig`, including the
  digest/feeds exclusivity and bounds), `framing.ts` (`frame` / `escapeFraming`
  / `runtimeMessage`), `tokens.ts` (`estimate*Tokens`, `messageDigest`,
  `toolCallKey`, `usageAnchor`, `truncateContent`), `tools.ts` (`contentText` /
  `toolResultText`, `cormTools`, `foldToolCalls` / `mergeToolArguments` /
  `parseToolArguments`, `errorToolResult` / `bareToolName` /
  `cormFixedOutputTools`), `static.ts` (`oneLine` / `oneLineRegex`), `keys.ts`
  (the memory/state/digest keys and `cormToolPrefix`) and `disabled-tools.json`
  (the always-disabled tool list read by `cormTools` and the Nix `tools.json`
  generation).
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
      `variant`, `script`, `mode`, `environmentFile`, `mcpServers` (the enabled
      MCP toolings, handed to `omw-config`), `bwrapArgs` (the bubblewrap
      arguments handed to the wrapped MCPs) and `memory` (extra seeded per-agent
      memory keys, how the benchmarks hand the brain its prompt), hardcodes the
      rest, and builds `services.omw.settingsFile` by overriding the
      `omw-config` package with the provider endpoints/models, the enabled MCP
      servers and the agent script (so the service and the scaffolded test
      config share a shape). `omw-config.nix` gates each MCP tooling on
      membership in `cormMcpServers`, seeds `corm_config.providers` /
      `corm_config.toolings` from the enabled provider modules and MCP servers,
      and picks the `corm_config.model` in the same `gpu → cpu → remote` order
      the brain chats through, so the model name always matches the provider
      actually used. It also always declares a private `internal-filesystem`
      tooling — never gated on `cormMcpServers` — whose filesystem MCP is bound
      to the agent data dir (`cormAgentDataDir`, default `${cormDataDir}/omw`,
      i.e. `/var/lib/corm/data/omw`); the brain uses it for state and its tools
      are hidden from the model. Every provider runs a `<name>-prepare` oneshot
      before its serve unit: it converts the configured store checkpoint into a
      writable `StateDirectory` (`model.gguf` via `llama-cpp-convert` +
      `llama-quantize`, or `model.ftw` via `ft checkpoint`) and stamps the
      source path in `model.path`, re-converting only when that path changes.
      The `strata` kind has nothing to convert (its pack and MTP are store
      derivations), so its prepare unit is a no-op. The CPU/GPU providers then
      run a `<name>-provider-warmup` oneshot after their serve unit: it POSTs a
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
    bubblewrap MCPs drop the `--proc /proc` mount nspawn cannot provide, and
    enables `nix-command`/`flakes` in its own nix config so the `nix` tooling
    works there (the guest shares the host store, database and daemon socket,
    not the host `/etc/nix/nix.conf`). The container functor injects an inline
    NixOS module (borrowed from nixpkgs' `nspawn-container`) that declares
    `virtualisation.rootDir`, `stateDir`, `environmentFile`, `cmdline` and
    `systemd-nspawn.{package,options}` and exposes `system.build.nspawn`: a
    wrapper that creates the guest root, state and nix profile/gcroot dirs, then
    `exec`s `systemd-nspawn` with the guest `init` as a positional argument. The
    guest runs a read-only console with the journal forwarded to it
    (`services.journald.console`), so provider, MCP and omw output streams to
    the terminal (this also covers native-journald loggers like omw; `Ctrl-C`
    triggers an orderly shutdown) and the container getty disabled, and enables
    test-style root SSH over `systemd-nspawn`'s unix-export socket
    (`/run/systemd/nspawn/unix-export/<machine>/ssh`, empty password) without
    binding TCP port 22. `dev container start <name> [args?]` reads defaults
    from the ignored root `.corm.container.json`; an explicit CLI record
    replaces that preset's stored record. It builds `system.build.nspawn` and
    runs it in the foreground. The wrapper binds persistent `/var/lib/corm`
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

## Context management

Corm serves one model and one KV cache, so every request shares a single global,
prompt-free context window (`disk.window`) and only one chat/compaction
generation runs at a time. The window (`lib/window.ts`, `types/window.ts`)
carries the leading `system` message, the rolling `summary`, the framed `active`
messages, the current session/params, and the size counters (`tokens`/`chars`,
measured against the provider's `anchor`).

- **Single writer.** There is no task stack: `endpointReducer` parks an
  `endpoint-message` (plus a runtime notice) in `disk.inbox` while `isTurnBusy`
  (a generation is open or `turn.awaiting` is non-empty), and `index.ts::drain`
  answers the inbox one action at a time (endpoint request or digest job) once
  the turn is idle. A `chat-delta`/`chat-end`/`error` whose id is not the open
  generation is dropped.
- **Input.** `windowInput` renders `[system][summary?][…active]`. The `system`
  message is `runtimeSystemPrompt` + `chatSystemPrompt` joined by blank lines,
  with the operator `config.prompt` appended under `promptPrelude`; it never
  enters the window, so it survives compaction and is never duplicated. The
  `summary`, when non-empty, is one leading `⟦runtime⟧` message under
  `compactPrelude`.
- **Framing.** Templates reject mid-conversation `system` messages, so only
  `user`-role messages are framed (`⟦runtime⟧`/`⟦persona⟧`/`⟦client⟧`) and sent
  as `user`; `assistant` and `tool` are sent raw under their own role. Framing
  is applied on ingest and stored; both `⟦` and `⟧` are escaped and a full
  `⟦<tag>⟧` attempt in inbound content is detected (`detectFraming`). It is not
  a security boundary.
- **Identity.** Messages are content-addressed (`messageDigest`: role +
  content + tool calls, deliberately excluding `reasoning`, which a client never
  re-sends) into the global `active` set plus bounded `disk.receipts`, so a
  re-offered message is classified `current` (already present), `compacted` (in
  a receipt) or `new`, and only `new` is appended (`appendInboundMessages`).
- **Truncation.** Every ingested user/tool body and every tool result is capped
  at `messageTokenLimit` (head + `truncationMarker` + tail) before framing; a
  cut message gets a following `⟦runtime⟧` `truncationHint`. Results whose bare
  tool name is in `noTruncateTools` (default `cormFixedOutputTools`, the tools
  whose output size the model cannot control) bypass the cap and are stored
  whole, with compaction as the backstop; a fixed-output tool opted back into
  truncation gets `fixedOutputTruncationHint` instead of the reduce-output hint.
  Assistant messages are stored verbatim.
- **Compaction.** A completed turn, a tool settle or an ingest whose
  `windowSize` (`max(anchor, tokens)`) is at/above
  `compactThreshold * contextLength` starts a compaction generation:
  `start-compaction-generation` sends `windowInput` plus `compactPrompt`
  appended **last** (never stored), collects the stream into `turn.summary`
  (capped at `compactSummaryLimit`), and on completion `commit-compaction` folds
  the evicted set into `window.summary`, records the evicted digests as a
  receipt and drops the anchor. The protected tail is the newest
  `min(protectMessages, floor(count * protectRatio))` messages (at least one).
  `compactPrompt` is always appended after the shared prefix so the KV cache is
  reused and it is not re-sent on the resumed turn. A turn that crosses
  `hardThreshold` mid-stream folds and streams the delta, streams
  `compactNotice`, cancels the generation and starts a compaction with
  `resume: true`. A failed compaction is retried (`chat.ts::onError` starts
  another compaction); it is never treated as done and never falls back.
- **Recap.** `needsRecap` examines only a request's last `requestMessages`
  messages and fires when one of those last `recapMessages` is among the
  receipts; the reducer then computes `recapReplay` (the newest `replayMessages`
  evicted messages of that tail, trimmed from the oldest to fit
  `replayRatio * contextLength`), and `append-recap` inserts a notice (filled
  with `{{NAME}}`/`{{ID}}`/`{{DESCRIPTION}}`; an endpoint request uses
  `endpointRecapNotice`, falling back to `recapNotice`), the replayed messages
  and a closing `recapEndNotice` before the new turn; interleaving alone never
  recaps.
- **The turn.** The visible answer streams into `active` as a live `assistant`
  message (`foldAssistantDelta`), which accumulates the response's parallel tool
  calls by fragment index into raw argument JSON text (`foldToolCalls`: omw may
  hand a fragment over parsed, so it is stringified back before concatenation);
  `invoke-corm-tools` parses that text back into the value `callTool` expects
  (`parseToolArguments`), since omw serializes the value it is given. Settled
  tool results are buffered for the assistant exchange and appended in the
  assistant's tool-call order once the last call settles; each is stored as a
  `tool` message (`appendToolResult`) carrying the call's `toolCallId`, so the
  model never re-answers an earlier message. Error results are labeled
  `Tool error (<name> #<id>)` so the model can attribute them even when a batch
  called the same tool twice. A turn may call several tools at once:
  `invoke-corm-tools` runs every corm-owned call and the reducer only re-prompts
  once the whole `awaiting` set has settled. A client's own tools are dropped
  (they would break the shared prefix and let a second driver write the window);
  `set-active-request` warns with their names, and a call the model made that
  corm does not offer is answered with an error `tool` message and a bounded
  re-prompt. A tool call emitted as text (matching `toolCallPattern` in the
  visible content, or the reasoning when there is no content) is retried with
  `toolCallHint` up to `toolCallRetryLimit`; the same call (name + canonical
  arguments) repeated `circuitBreakerLimit` times in one user turn trips the
  breaker, which drops the last exchange and appends `circuitBreakerHint`.
- **Jobs and notices.** The daily digest is a background turn. The dispatcher
  constructor parks a catch-up run when there is no previous run or it is older
  than `digestMaxAgeMs`, otherwise it arms the cron; `pump()` starts or resumes
  the parked job at the next safe point. `start-digest` flushes parked notices,
  appends the start notice plus the prompt as a `⟦runtime⟧` message, clears the
  endpoint session (so streaming is a no-op) and starts the chat. A completed
  digest records `disk.digest.last`; the schedule is re-armed on success or
  failure. The `turn.digest` flag survives compaction, and a compaction resume
  appends `digestResumeNotice`. An endpoint message that arrives while a digest
  is streaming preempts it: the digest is cancelled and parked for a `resume`,
  the endpoint turn runs immediately, and `pump()` continues the digest with
  `digestResumeNotice` (the prompt is not appended twice). An endpoint message
  while a foreground turn, a compaction or an outstanding tool call is active
  is parked with `endpointQueuedNotice`; parked notices are flushed at the next
  safe point (a tool settle, a completed turn, a compaction commit, or the start
  of the queued request), never while an assistant stream is live, so a notice
  cannot split the assistant message.
- **Config.** Every context knob, including the `noTruncateTools` and
  `fixedOutputTruncationHint` overrides and the digest/notice knobs
  (`digestCron` — six-field cron or `true` to disable — `digestFeeds`,
  `digestPrompt`, `digestLookbackMs`, `digestMaxAgeMs`, `digestMinGapMs`,
  `digest*Notice`, `endpointQueuedNotice`,
  `endpointRecapNotice`), is a field of `cormConfigZod` (`types/config.ts`) and
  is overlaid under `corm_config_<field>` (`corm.settings` is freeform). `model`
  and `contextLength` are required, and `validateConfig` (`lib/config.ts`)
  throws at startup on any violated bound.

## Logging

The brain logs through `omw.host.log(level, message)` (omw echoes it to the
journal). `corm/services/logger.ts` wraps that host method in a `CormLogger`
with one method per level; the managers build one from `omw.host` and the entry
loop and dispatcher take it directly. Every log site picks its level from this
fixed policy:

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
- **Critical function calls log `trace`.** Per-event receipt (`recv <kind>`) and
  each dispatched effect are `trace`.

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
  or hanging case. The endpoint mock scripts concurrent sessions with
  `session_id`, orders requests with `after`, and emits `endpoint-session-end`
  via `session_end = { close = 0 }`; the omw testing docs under `docs/testing/`
  are the reference.   The digest cases use the startup catch-up path (a cron
  string with no previous run) so they need no wall-clock wait; `digestCron =
  true` is the kill switch, and unit tests drive the digest `timer` event
  directly. Each case opens with a comment block stating what it proves and the
  crucial invariant it protects; keep that habit when adding a case.

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
