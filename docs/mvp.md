# Corm MVP

This document captures the ideas, the decisions that were made while planning the
MVP, the implementation details we settled on, and the ordered implementation
plan. It is a working document: no formatting or linting is needed.

---

## High-level ideas

- **Corm is the brain of Morgan Fetch, but it should read as an opinionated,
  agent-agnostic distribution of the `omw` runtime.** Think "omw
  distribution": it ships the JavaScript brain, preconfigured llama.cpp /
  FreeToken providers, MCP tooling, a systemd service and Nix plumbing. The
  individual agent (e.g. Morgan Fetch) is a configuration on top of it.
- **Local-first, single-agent.** The target user runs everything locally, has
  one GPU (or several GPUs for one larger model), wants cache/context friendly
  defaults and preconfigured models. There is exactly one agent.
- **The repo is the one controlled path from "the agent wants to change itself"
  to "the change exists in the real world."** Changes land through PRs, get
  reviewed/merged, then get pulled into the maintainer's `dot` config.
- **The brain contract.** The compiled script runs as a plain Boa script and
  talks to the host through the global `omw` (`provider`, `tooling`, `host`).
  Source may import local modules and `.ts` / `.json` / `.md` assets that
  esbuild inlines, but must not use Node/DOM APIs or runtime module loading.
  Stay within the ECMAScript subset Boa supports; the bundle stays readable and
  unminified.
- **No blocking calls anywhere.** `callToolBlocking` and the in-band blocking
  `provider.chat` exist in omw for convenience, but they are an anti-pattern in
  corm. The one sanctioned exception is the state manager's filesystem
  recovery/persistence at startup/shutdown (so task state is not lost across a
  shutdown).
- **The brain is a task machine.** `machine.ts` owns a task stack and a pending
  queue. Long-lived, request-scoped work is a *task* (e.g. one chat turn);
  global events (lifecycle, timers, resources, agent messages) are handled at
  the machine level. Handlers live in `handlers/` and are produced by the
  `registrar`.
- **Config and tooling are first-class services**, not loose helpers. They are
  loaded lazily at startup like `handles`/`state`, are fully typed, and are
  passed to handlers through a shared context.

---

## Findings from the current tree (why this work exists)

- `AGENTS.md` is stale. It still describes the old `brain.ts` + `prompts/`
  design; the brain is now a task machine (`machine.ts` + `registrar` /
  `registry` / `handles` / `state`) with a single `chat` handler.
- `prompts/*.md` are dead code: nothing imports them, and the esbuild `.md`
  loader is unused. The maintainer will remove them; the brain is a passthrough
  of `endpoint-message.messages` to a provider.
- The vendored `omw.d.ts` is hand-written and behind upstream. omw v0.1.4's real
  binding is camelCase (`finishReason`, `toolCall`) and has `whoami`,
  `memoryGetAs`/`memorySetAs`, `params`, and `ToolResult.content` /
  `structuredContent`. The current brain still uses the older snake_case
  `finish_reason` / `tool_call` and `ToolResult.value`, so it is written against
  an older omw. Updating the d.ts is a prerequisite, not a nicety.
- Real bugs in the chat plumbing:
  - `chatStream("model", ...)` hardcodes the literal model name instead of the
    configured model.
  - overlapping immediate tasks can misroute `chat-delta` / never complete.
  - non-chat events (timer/heartbeat/resource) throw while a task is active.
  - `initialize()` is empty.
- De-brand drift: the endpoint/tenere config advertises `morgan-fetch`, while
  the brain subscribes as `corm`; the committed scaffold template says
  `morgan-fetch`, while `omw-config.nix` names the agent `corm`.
- `morgan.omw.test.toml` asserts an MCP tool call and a re-prompt, which the
  current handler cannot produce. The intended MCP tool loop is missing.
- There are basically no unit tests, the e2e suite is poor, and there are only
  two NixOS tests (`llama-cpp`, `freetoken`).
- `dev run` does not exist yet. `tenere` is in nixpkgs 26.05 (`pythops/tenere`);
  `qwen-3-5-800M` is the only model with a filled hash. Other model hashes are
  empty placeholders.

---

## Resolved questions / solutions

These are the decisions made while planning; the user confirmed each.

1. **Tool loop ownership.** The brain owns the MCP tool-use loop, but only for
   tools that corm itself has configured via MCP servers. For unknown/client
   tools, the tool call is streamed back to the endpoint client and the client
   executes it.
2. **`dev run` backend.** systemd-nspawn requires root (`assert
   os.geteuid() == 0` in the test driver). The test suite only avoids that
   because nspawn runs inside a `nix build` sandbox where the builder is root.
   So `dev run` uses **rootless podman via the Docker-compatible socket**
   (`dockerSocket.enable` + `dockerCompat`, with `docker-client` /
   `docker-compose`) and **compose**. GPU via **NVIDIA CDI**
   (`nvidia.com/gpu=all`), available because `hardware.nvidia-container-toolkit`
   is enabled. A CPU fallback is required for users without a GPU.
3. **`omw.d.ts` generation.** The full upstream `omw.all.d.ts` is vendored into
   `src/corm/omw.d.ts`. It is **curl'd**, never hand-written. The tag/rev comes
   from the flake input so the flake tag is the single source of truth.
   `dev format` regenerates it; `dev lint` curls it again and diffs, failing on
   drift.
4. **Agent-agnostic shape.** The `prompts/` removal is left to the maintainer.
   The agent name is configurable in Nix (default `corm`), and everything else
   is de-branded from "Morgan Fetch". The endpoint model is defined to always
   equal the agent name, and the brain learns its identity via `host.whoami()`.
5. **Model defaults.** `dev run` takes `--model <attr name from nix>`. The MVP
   uses the GPU provider by default and leaves cpu/remote empty for `dev run`,
   but always runs embeddings too. Model hashes cannot be computed without
   downloading the HuggingFace repos, so they stay placeholders; the maintainer
   will download and paste hashes manually. No hash helper.
6. **Typed `omw`.** Use the generic typed variant
   (`omw as Omw<typeof config>`) rather than the bare global, parameterized over
   the imported scaffolded test template (as JSON) so provider/tooling names and
   tool schemas are type-checked.
7. **Chat model source.** The chat model is read from a **static memory seed**
   in the omw config (`[memory.<agent>]`), loaded lazily on startup by a config
   service, validated with zod. Tests fix up the seed to use `"model"`.
8. **Tooling layer.** Tool calling is a dedicated, machine-level class that
   resolves and calls the appropriate tools. Corm-owned tools are exposed with a
   `corm__` prefix so they never collide with client tools. Future work (not
   this MVP): high-entropy token detection/redaction with accepted prefixes such
   as `/nix/store` and `sha256-`.
9. **No blocking.** `callToolBlocking`/blocking `chat` are banned. Tool calls
   are async: `callTool` returns a UUID and the matching `tool-result` event
   drives the loop. The one sanctioned exception is the state manager's
   filesystem read/write at startup/shutdown so task state survives a shutdown.
10. **Scheduling.** A new `endpoint-message` from the same session as the active
    chat task merges into that task (no new task; append the user message). A
    new session that wants to chat while an immediate chat task is already on
    top is placed in `pending`, so the active chat is not bombarded.
11. **Tests.** Container tests only (the existing `containers.agent` nspawn
    pattern), no VM nodes. `dev lint` should run the tests too. No model-hash
    helper.
12. **Description.** "Corm is a local-first omw agent distribution for NixOS."

---

## Implementation details

### omw version + typed d.ts

- `src/nix/lib.nix` exposes the pinned rev: `lib.omw = { rev = inputs.omw.rev; };`
  (rev comes from `flake.lock`, so updating the omw input is the only version
  bump).
- `src/nix/dev.nu`:
  - a helper to build the raw URL:
    `https://raw.githubusercontent.com/haras-unicorn/omw/<rev>/src/wasm/omw-wasm-js-interpreter/omw.all.d.ts`;
  - `dev format`: after `omw scaffold`, curl the d.ts into `src/corm/omw.d.ts`
    and write a JSON twin of the scaffolded template
    (`src/corm/omw.test.template.json`) for typing;
  - `dev lint`: curl to a temp file and `diff` against the vendored file; also
    regenerate the JSON and diff it.
- Brain typing: `import type testConfig from "corm/omw.test.template.json";`
  then `const typedOmw = omw as Omw<typeof testConfig>;`. The type-only import
  is erased by esbuild, so it never becomes a runtime dependency. `ext.d.ts` is
  unused and can be dropped.

### Configuration service (`services/config.ts`)

- `CormConfig = { model: string }` for now.
- A zod schema compiled the same way the rest of the tree does it, so the seed
  is validated when loaded.
- A manager that follows the `handles`/`state` shape: lazy `load()` reads the
  JSON from memory (`host.memoryGetAs(cormConfigKey)`), caches it, and exposes a
  typed `CormConfig`. Release is a no-op (memory persists across reloads).
- Memory key: `corm-config`, seeded per-agent in `omw-config.nix` from the
  configured provider model. e2e/test configs seed `{ model = "model" }`.

### Tooling class (`services/tooling.ts`)

- Constructed at machine level, given the loaded tooling handles.
- On init it enumerates every tooling's `listTools()` and builds a registry of
  exposed names. Corm-owned tools are exposed as `corm__<toolName>`; client
  tools keep their names untouched.
- `definitions()` returns the `ChatTool[]` to hand to the provider (corm tools
  plus any client tools).
- `resolve(name)` decides whether a name is corm-owned and which tooling/tool it
  maps to.
- `invoke(name, args)` uses the async `callTool` (returns a UUID) and tracks the
  pending call; `handle(event)` consumes `tool-result` / `error` events to
  complete a pending call and hand the result to the chat handler.
- The class is the seam for future entropy detection/redaction of arguments and
  results (accepted prefixes `/nix/store`, `sha256-`). Not implemented now.

### Machine, context and scheduling (`services/machine.ts`, `registrar.ts`)

- Introduce a shared `CormContext { handles, config, tooling }` passed to
  handler factories (plus the task id and per-task state). Avoids argument
  sprawl as more services are added.
- Machine responsibilities:
  - handle global events (lifecycle `reload`/`shutdown`, resources, agent
    messages) at the machine level so a running task never throws on them;
  - route `chat-delta` / `chat-end` / `tool-result` / `error` to the task that
    owns the generation/UUID, rather than blindly to the top of the stack;
  - drop the heartbeat subscription (`waitCron`) entirely;
  - terminate a preempted immediate task cleanly instead of leaking it;
  - placement policy for new tasks: same-session chat merges into the active
    chat task; different session while an immediate chat is active goes
    `pending`; otherwise `immediate`.

### Chat handler (`handlers/chat.ts`)

- Provider selection with fallback **gpu → remote → cpu**, retrying on provider
  error.
- Model comes from the config service (`config.model`), falling back to
  `provider.listModels()[0]` if absent. `params` from the endpoint message are
  passed through.
- Tools passed to the provider are the tooling definitions (`corm__*`) plus the
  endpoint client's tools.
- Streaming:
  - text/reasoning deltas are forwarded to the endpoint;
  - tool calls are accumulated;
  - a `corm__*` call is executed asynchronously via the tooling class, the
    result is appended as a `tool` message, and the stream is re-issued;
  - a client/unknown tool call is streamed to the endpoint without execution.
- No blocking calls.

### State (`services/state.ts`)

- Keep the filesystem read (startup) and write (shutdown) via `callToolBlocking`
  as the single sanctioned exception, so task state survives shutdown. All other
  persistence goes through omw memory.

### Tests

- Unit (Vitest, dependency-injected, no global stub): `types`, `config`,
  `tooling`, `machine` (scheduling/preemption/routing/shutdown), `registrar`,
  `state`, `handles`, `chat` (happy path, async tool loop, client-tool
  passthrough, provider fallback).
- e2e (`*.omw.test.toml`, generic, agent name from Nix): `chat`, `tool`
  (asserts `call_tool`, not `call_tool_blocking`), `client-tool`,
  `session-end`. Regenerate `omw.test.template.toml` via `dev scaffold` (picks
  up the new output schemas).
- NixOS container tests (`containers.agent`, no VM nodes): cpu-only inference,
  custom agent name, embedding; plus cheap `nixosSystem` eval checks for the
  config matrix (cpu/remote, embedding on/off, agent name, assertions, rendered
  `omw.toml` / unit `ExecStart`).
- `dev lint` runs `dev test` in addition to the formatting/lint checks and
  `nix flake check`.

### De-brand + docs

- Replace Morgan strings in `flake.nix`, `src/nix/packages/corm.nix` meta, both
  `cspell.yaml`s, README and the scaffold template / e2e cases. Keep the
  openrouter remote default as an opinionated, configurable default.
- Rewrite `AGENTS.md` (real architecture, omw rev/d.ts flow, `dev run`, models,
  the no-blocking rule + its single exception) and `README.md`.
- The maintainer removes `prompts/` and `CONTRIBUTING.md`; `opencode.json` gets
  updated accordingly.

### `dev run` (rootless podman compose + CDI)

- `src/nix/dev-run.nix`: `dev-run-gguf` (convert + quantize the selected model
  checkpoint to `$out/model.gguf`, cached by Nix) and `dev-run-embeddings`
  (qwen-3-embedding GGUF).
- `dev.nu run [--model <attr>]`, default `qwen-3-5-800M`:
  - resolve store paths for omw-js, the corm script, the FATE `llama-server`,
    the embeddings `llama-server`, the MCP servers and an alpine base;
  - write `compose.yaml` + `omw.toml` + a tenere config under
    `$XDG_RUNTIME_DIR/corm-run`, bind-mounting `/nix/store` read-only and
    running binaries straight from the store;
  - services: `gpu` (or `cpu` fallback), `embedding`, `omw`
    (loop + endpoint + MCPs);
  - GPU via CDI `nvidia.com/gpu=all` plus `/run/opengl-driver`; detect
    `/dev/nvidia*` + CDI and degrade to the CPU provider otherwise; if compose
    CDI proves flaky, fall back to running the providers as host subprocesses;
  - `up -d`, wait for `GET /v1/models`, `exec tenere -c <config>`, then
    `down -v` on exit.

---

## Implementation plan

Work in order; each phase should leave the tree in a buildable state.

1. **Phase 0 — omw v0.1.4 + typed d.ts.**
   - expose `lib.omw.rev`; add the curl helper to `dev.nu`.
   - vendor `omw.all.d.ts` into `src/corm/omw.d.ts`; generate
     `omw.test.template.json`; wire `dev format` / `dev lint`.
   - migrate the brain to the v0.1.4 API and the typed `Omw<...>`; drop
     `ext.d.ts`.
2. **Phase 1 — config + tooling services.**
   - `services/config.ts` with zod and lazy memory load; seed it from
     `omw-config.nix`; set up the agent-name option and endpoint-model equality.
   - `services/tooling.ts` with the `corm__` prefix registry and async call
     lifecycle; add `CormContext`.
3. **Phase 2 — machine + chat tool loop.**
   - rework `machine.ts` (global events, event routing, preemption cleanup,
     scheduling policy); drop heartbeat.
   - async MCP tool loop in `handlers/chat.ts`; provider fallback; model from
     config; params passthrough.
   - keep the state filesystem read/write exception.
4. **Phase 3 — tests.**
   - unit tests for all services and the machine/handlers.
   - regenerate the e2e template and rewrite the cases (`chat`, `tool`,
     `client-tool`, `session-end`).
   - add NixOS container tests + eval checks; make `dev lint` run `dev test`.
5. **Phase 4 — de-brand + docs.**
   - replace Morgan strings; rewrite `README.md` and `AGENTS.md`; update
     `opencode.json`; maintainer removes `prompts/` and `CONTRIBUTING.md`.
6. **Phase 5 — `dev run`.**
   - `dev-run.nix` conversions; `dev.nu run`; compose + configs + CDI/CPU
     fallback; teardown on exit.
7. **Phase 6 — verify.**
   - `dev format` and `dev lint` (which now includes tests). The maintainer
     does the `dev run` smoke test.

## Open follow-ups (explicitly out of scope for the MVP)

- High-entropy token detection and redaction in the tooling class (accepted
  prefixes `/nix/store`, `sha256-`).
- Heartbeat / scheduled wake-ups.
- Persisting task state across full process restarts (currently survives reloads
  and shutdown writes, but recovery is best-effort).
- Filling in model hashes for the non-default checkpoints.
