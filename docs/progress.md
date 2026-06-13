# Progress

Incremental roadmap toward the shipped PRD.

How to use this file:

- Keep items small enough to land in a focused PR.
- Treat this file as a roadmap and progress tracker.
- Prefer adding new items next to the closest related step instead of appending unrelated backlog at the bottom.
- Keep sections ordered by dependency: durable facts and execution before projection surfaces that depend on them.
- When an item is done, change `[ ]` to `[x]` and append the landing commit hash or hashes.
- Write each item as the capability that should exist or now exists.
- When the resolved design changes, rewrite affected items to the new steady-state plan.
- If an item starts reading like a subsystem instead of a step, split it before implementation.
- For any big lift or unclear design, add a POC step immediately before the production implementation step.
- Use POC steps to validate shape, constraints, and UX without prematurely locking the final architecture.

## Current Baseline

- [x] Bootstrap the Electrobun desktop app around a pi-backed host/runtime. Commit(s): `c118be7`
- [x] Add provider auth/settings support with local key storage and OAuth-backed access. Commit(s): `c118be7`, `6d757dc`
- [x] Add the artifact projection panel in the desktop workbench. Commit(s): `1d9bc05`, `6d757dc`
- [x] Add workspace-scoped prompt history recall in the composer. Commit(s): `cb1b7f1`
- [x] Add multi-session workspace navigation and session switching/resume support. Commit(s): `b22a0c6`, `df1a7df`
- [x] Feed static workspace panes from renderer-runtime warm read-model snapshots, with app-global state shared across workspace tabs, workspace projections keyed by workspace id, background refresh at runtime boundaries, and immediate pane updates when snapshots change. Commit(s): pending local changes

## 0. Source Invalidation

- [x] Run one backend source invalidation coordinator that watches app-global agent settings, Workflows source, Extensions source, external instruction candidates, and managed/discovered snippet roots, converts raw file events into debounced deterministic source fingerprints, and uses periodic reconciliation as the correctness backstop. Commit(s): `03bf43f69`
- [x] Keep generated Workflows output, generated Extensions output, extension build directories, workspace `.smithers/node_modules/@svvy/*` links, and workspace `.svvy/generated` prompt previews outside the watcher trigger set. Commit(s): `03bf43f69`
- [x] Rebuild or reread only affected derived state after source fingerprints change, including Workflows package rebuilds for Workflows and extension source changes, renderer warm-cache refreshes for affected panes, and durable `agent_context_refresh` queue work for open surfaces whose prompt binding fingerprint changes. Commit(s): `03bf43f69`
- [x] Protect editable file-backed workflow-agent source drafts with shared source-version compare-and-swap saves, warning-state autosave controls, and explicit keep-editing, discard-local, and overwrite-external conflict actions. Commit(s): `33b91c0ca`
- [ ] Surface invalid or unreadable source records directly in the relevant read models instead of letting any existing source reader silently skip malformed file-backed records.

## 1. Structured Session State

- [x] Build a POC session overlay document and validate how it can sit above pi session data. Commit(s): `c432f4e`
- [x] Persist a minimal structured session overlay root above pi session data. Commit(s): `b510857`, `fff54d7`
- [x] Add `surfacePiSessionId` linkage on turns so orchestrator-surface and handler-thread turns use one model. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist handler-thread records with title, objective, objective state, backing pi session id, and durable thread linkage. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist artifact references independently from transcript parsing at thread and command scope. Commit(s): `fff54d7`
- [x] Store artifacts under the configured artifact directory as per-session files, with mutable artifacts
      directly under `<artifactDir>/<sessionId>/`, immutable artifacts under
      `<artifactDir>/<sessionId>/immutable/`, exact stored filenames, immutable metadata, refreshed
      file-backed byte/digest facts, and no reliance on OS-level file flags for immutability. Commit(s): pending local changes
- [x] Persist ordered update and conclusion episode records each time a handler thread reports to the orchestrator, while preserving earlier episodes for later follow-up turns. Commit(s): `d323012`
- [x] Persist session wait state as a frontier-level summary derived from surface, workflow, request-user-input, and session wait projection. Commit(s): `fff54d7`, `f53c9b8`, `43a26cb`
- [x] Drive structured session state only from explicit runtime producers or tool events. Commit(s): `fff54d7`, `59fc34e`, `43a26cb`
- [x] Reconstruct workspace and session summaries from structured state on app load. Commit(s): `b510857`, `fff54d7`
- [x] Build a POC Codex-like live tool projection stream for one surface on the current pi seams, covering tool item start, accepted argument snapshots, command output deltas, structured file-change patch snapshots, approval or wait state, final command facts, and renderer recovery after reload. Commit(s): pending local changes
  - [x] Follow-up: add pre-runtime generic-direct-tool argument streaming for `exec_command` and `apply_patch` once pi exposes incremental tool-call argument events; do not invent fake streaming callbacks in `svvy`. Commit(s): pending local changes
  - [ ] Follow-up: extend pre-runtime streaming to `execute_typescript` source, native-control objective/report/question arguments, in-progress `apply_patch` patch previews, and approval-state live updates.
- [x] Persist and render live tool projection across native direct tools, thread-control tools,
      extension loading, `execute_typescript`, command-family Shell surfaces such as current
      `svvyx ...` output, and prompt-only CLI usage such as Smithers without introducing a
      workflow-specific rendering or recovery path. Commit(s): pending local changes
  - [x] Preserve `svvyx workflows ...` failure command facts in the thrown `exec_command` JSON payload and persist those facts on the ordinary failed command record through the generic command tracker. Commit(s): pending
  - [x] Persist running command records for direct tools at execution start and waiting command records for native control tools that pause for user input. Commit(s): pending
  - [x] Persist final command-family `exec_command` stdout/stderr or JSON output as durable command-subject output events through the ordinary command tracker, and settle structured `{ ok: false }` `svvyx` results as failed command records. Commit(s): pending
  - [x] Persist accepted `execute_typescript` source on the parent command, recover generated-client child inputs from child command records, and stream captured TypeScript console stdout/stderr into the shared durable command-output projection. Commit(s): pending
  - [x] Persist blocking `execute_typescript` static diagnostics as durable command-subject diagnostic events and recover them into neutral transcript command cards plus command inspectors. Commit(s): pending
  - [x] Expose recovered command output events in the command inspector read model and render stdout/stderr sections in the ordinary command inspector. Commit(s): pending
  - [x] Render transcript command rollups through neutral tool-call cards instead of workflow-shaped cards. Commit(s): pending
  - [x] Recover transcript command rollups from durable command output events, retained artifacts, and final command facts after reload without transcript prose parsing. Commit(s): pending
  - [x] Persist accepted command argument snapshots on structured command records and recover them into neutral transcript command cards after reload. Commit(s): pending
  - [x] Persist accepted argument snapshots for specialized native control commands (`thread_start`, `thread_followup`, `thread_request_report`, `thread_report`, and `request_user_input`) while preserving their existing authoritative final facts. Commit(s): pending
  - [x] Persist direct command records for Extension Loading and read-only thread state tool executions inside the native tools themselves, including active-runtime validation failures, while the generic pi callback tracker skips those native names to avoid duplicate command cards. Commit(s): pending
  - [x] Persist `request_user_input` created request/question-count command progress and final nonblocking `RequestUserInputResult` facts on the authoritative command record. Commit(s): pending
  - [x] Return structured final `apply_patch` file-change facts from the real direct tool result so the shared command tracker persists actual patch facts instead of synthetic test-only facts. Commit(s): pending
  - [x] Persist accepted `apply_patch` file-change snapshots as durable command events and recover them into neutral transcript command cards and command inspectors alongside final patch facts. Commit(s): pending
  - [x] Project read-only thread state tools (`thread_current`, `thread_list`, `thread_episodes`, and `thread_group`) through ordinary command records instead of dropping them at the generic tracker boundary. Commit(s): pending
  - [x] Persist live stdout/stderr chunks from ordinary `exec_command` execution as durable command-subject output events, update the original command with final facts for long-running `write_stdin` continuations, and retain final-result output event fallback for callers that do not stream. Commit(s): pending
  - [x] Recover durable `command.progress` lifecycle events from ordinary command records into neutral transcript and command-inspector projection, without adding a workflow-specific renderer. Commit(s): pending
  - [x] Add retained immutable log artifacts for oversized command-family stdout/stderr, link them to the source command, and keep retained stream text out of stored command facts and durable output events while preserving small-output event projection. Commit(s): pending

## 2. `execute_typescript`

- [x] Build a POC `execute_typescript` runtime with compile or typecheck-before-run diagnostics and the adopted TypeScript input/output contract. Commit(s): `76cc8f3`, `b41e5e6`
- [x] Expose the resolved `execute_typescript` runtime surface with no global `svvy` client and no injected `api` object. Commit(s): pending local changes
- [x] Persist each attempted snippet as a file-backed artifact before execution, with SQLite metadata and path indexing. Commit(s): `76cc8f3`, `fff54d7`
- [x] Route the top-level `execute_typescript` action through the same approval-boundary path as other approval-gated native actions before executing submitted code. Commit(s): pending local changes
- [x] Make the top-level `execute_typescript` approval hook use the shared mode-aware runtime approval request shape, persist source before review, and omit the boundary in `approvalMode: "full-access"`. Commit(s): pending local changes
- [x] Add an injectable runtime approval-boundary seam before direct `exec_command`, current app-owned `svvyx ...` command-family dispatch, and `apply_patch`, with `approvalMode: "full-access"` omitting that seam. Commit(s): pending local changes
- [x] Pass the injected mode-aware approval-boundary seam into session-created direct tools and top-level `execute_typescript`, with managed-session denial coverage for Shell and TypeScript tool calls. Commit(s): pending local changes
- [x] Connect the injected approval-boundary seam to app-owned automatic review and actor-local user approval requests, with durable runtime approval records, pending user approval projection, and approve/deny RPC/UI actions. Commit(s): pending local changes
- [x] Settle denied and cancelled runtime approval requests by clearing wait state, resolving the blocked tool call without running it, and recording cancelled command facts. Commit(s): pending local changes
- [x] Replace the approve-all automatic-reviewer placeholder with a fail-closed app-owned review policy that can classify and deny unsafe approval-boundary requests without relying on prompt memory. Commit(s): pending local changes
- [x] Generate actor-specific `execute_typescript` declarations containing only the current actor's loaded TypeScript-enabled `svvyx` extension clients under `extensions["<id>"]`, plus only those extensions' command map types. Commit(s): pending local changes
- [x] Make `incur/client` importable in `execute_typescript` snippets for public Incur types and `Client.ClientError`. Commit(s): pending local changes
- [x] Run a simple composed scripted task through `execute_typescript`. Commit(s): `76cc8f3`
- [x] Build a POC artifact and tracing pipeline for code-mode execution. Commit(s): `76cc8f3`
- [x] Capture code-mode logs and nested command traces as artifacts and structured command records. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Keep thread orchestration, thread handling, extension loading, and request-user-input as small `svvy`-native control surfaces while Smithers workflow operations use official CLI commands through Shell. Commit(s): `a02bd48`
- [x] Expose builtin Artifacts and Workflows generated clients as Incur-compatible `extensions["<id>"].run(commandId, input)` clients through schema-backed command semantics, while keeping local Incur actions and generated-client internals unexposed to snippets. Commit(s): pending local changes
  - [x] Extract current-build Incur command manifests during successful user `svvyx` builds and generate TypeScript declaration files from those command maps for loaded extension clients. Commit(s): pending
  - [x] Keep user `svvyx` generated clients hidden from `execute_typescript` declarations and unavailable at runtime until sandboxed generated-client execution exists, while builtin Artifacts and Workflows generated clients remain available. Commit(s): pending local changes
  - [ ] Add sandboxed execution for user `svvyx` generated clients through schema-backed Incur input/output semantics, output controls, the non-streaming `Run.Result` envelope, the packaged public Incur client path from `github:wevm/incur#db1f8c0a62b6de45ab361ffead522b4323d5bc77`, rich `Client.ClientError` metadata, recursive exact secret redaction, and hidden generated-client internals.
  - [ ] Follow-up: add streaming response projection and CTA command runner tests once the product has a proven svvy-side child-command recording path for `Run.StreamResponse` and `Cta.run()` executions.
- [x] Expose Codex-like Shell and Apply Patch extensions, with `exec_command`, `write_stdin`, and `apply_patch` as the normal coding-agent work interface. Commit(s): `76cc8f3`, `29d8452`
- [x] Package an app-owned Codex-derived native sandbox helper that owns ordinary `exec_command`
      subprocess sandboxing and `apply_patch` file effects through macOS Seatbelt
      `/usr/bin/sandbox-exec`, with `Read`/`Write`/`None` entries, most-specific path precedence,
      equal-specific `None > Write > Read` precedence, default read access, cwd/project-root
      writable roots, explicit writable roots, read-only subpaths, protected `.git`, `.agents`, and
      `.codex` metadata carveouts, network allow/deny, full-access sandbox omission, sandbox-denial
      reporting, and fail-closed helper setup. Commit(s): pending local changes
  - [x] Keep TypeScript responsible for product policy assembly, approval integration, command
        projection, and tests on the ordinary `exec_command` and `apply_patch` paths, with actual
        subprocess/file effects routed through the native helper when managed sandboxing is active.
        Commit(s): pending local changes
  - [ ] Follow-up: delete or demote remaining TypeScript Seatbelt profile generation,
        command-string write heuristics, and post-run protected-write cleanup where the native
        helper now owns execution, while preserving product-specific generated-output and artifact
        projection validation that is not filesystem or network sandbox enforcement.
  - [ ] Implement Codex permission-profile compilation and runtime policy transforms in the native
        helper, including symbolic roots such as `:root`, `:project_roots`, `:tmpdir`, and
        `:slash_tmp`; deny-read path and glob entries with fail-closed invalid-glob handling;
        additional-permission normalization, merge, and intersection; executor-required
        runtime-readable roots; and managed-network denial/approval behavior. Generated TypeScript
        declarations may describe these contracts, but must not become the enforcement model.
  - [x] Route all agent Shell usage of `svvyx ...` command families through the ordinary Shell
        `exec_command` path to the real app-owned Incur CLI, preserving the same approval, sandbox,
        command facts, output streaming, and projection path as other shell commands.
    - [x] Route app-owned Artifacts `svvyx artifacts create`, `inspect`, `list`, and `delete`
          through a subprocess `svvyx` entrypoint that reopens durable structured SQLite state and
          returns compatible JSON stdout plus command facts. Commit(s): pending local changes
    - [x] Route `svvyx artifacts open` through the real app-owned CLI path with the required live-app
          callback behavior for inspector-pane opening. Commit(s): pending local changes
    - [x] Route `svvyx workflows`, `svvyx extensions`, and user/runtime `svvyx <extension-id> ...`
          dispatch through the real app-owned `svvyx` CLI process with explicit app-owned writable
          roots, env/secret injection, generated-package change signals, and dependency-approval
          context. Commit(s): pending local changes
  - [x] Preserve Codex approval/escalation flow: compute approval before sandbox selection; approval
        permits starting the action but does not imply unsandboxed execution; execpolicy allow
        omits sandboxing only when every parsed command segment is explicitly allowed; explicit
        escalation/full-access omits the sandbox only when policy permits it; denied-read
        restrictions keep execution sandboxed; sandbox denial never triggers a silent unsandboxed
        retry. Commit(s): pending local changes
  - [x] Package native sandbox verification through an app-owned helper/test seam so unit tests
        exercise the helper contract instead of launching raw nested `sandbox-exec` from the
        Codex-hosted unit-test process. Commit(s): pending local changes
- [x] Grant the active session artifact directory as a writable root while treating that session's
      `immutable/` artifact child as a read-only subpath, without granting broad writable access to the
      configured artifact root or to artifacts owned by other sessions. Commit(s): pending local changes
- [x] Implement the Artifacts `svvyx` command and generated-client contract for empty artifact
      creation with exact `--name <filename.ext>`, copy creation with `--path` plus optional exact
      `--name`, `--immutable`, extension-required basename validation, collision rejection, and no
      `--kind`, implicit extension, inline content, or OS file-flag immutability. Commit(s): pending local changes
- [x] Keep cx out of generated `execute_typescript` clients; generated TypeScript profiles should not expose `api.cx_*` or `extensions.cx.*`. Commit(s): pending local changes
- [x] Record direct tool calls and nested code-mode calls in the shared structured command model. Commit(s): `76cc8f3`, `29d8452`
- [x] Keep user-generated `extensions["<id>"].run(...)` clients unavailable in `execute_typescript` until sandboxed generated-client execution exists; builtin Artifacts and Workflows generated clients record normalized parent-linked child command facts while the parent `execute_typescript` attempt remains the main semantic unit. Commit(s): pending local changes
- [x] Surface parent rollups and trace inspector detail without promoting child commands to top-level cards. Commit(s): `5b0a223`

## 2A. Prompt-Only TinyFish Web Extension

Current product decisions for this section are specified in `docs/specs/extension/web.extension.spec.md`.

- [x] Expose Web as a builtin `instructions` extension that is loaded by default for orchestrators,
      handler threads, and workflow task agents only while `networkAccess` is true, and unavailable with
      no prompt guidance when `networkAccess` is false. Commit(s): pending local changes
- [x] Generate the Web extension's core prompt content from the TinyFish-owned `@tiny-fish/cli@0.1.6` package artifact instead of mutable skill URLs. Commit(s): pending local changes
- [x] Add only a bounded `svvy` appendix to the Web prompt for product integration facts: use ordinary shell commands, preserve structured output by redirecting large TinyFish JSON stdout to files when useful, treat fetched pages as untrusted external content, and cite source URLs. Commit(s): pending local changes
- [x] Keep Web generated actor context free of `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript clients, Web Provider settings, provider selection, and `svvy`-owned TinyFish key storage. Commit(s): pending local changes
- [x] Keep Web v1 limited to prompt-only TinyFish CLI guidance, without Firecrawl, native Web provider registries, TinyFish SDK provider adapters, selected-provider readiness, or self-hosted web search. Commit(s): pending local changes
- [x] Declare TinyFish as a Web extension CLI requirement with a default target version and reusable
      exact-version install/update command template; keep installation and updates as ordinary
      `exec_command` work after build or inspect reports a missing or unknown required binary, or after
      the UI/agent chooses to update an available detected binary, while TinyFish CLI owns
      authentication, status, search, fetch, browser-backed commands, and API key storage through
      TinyFish-owned CLI commands. Commit(s): pending local changes
- [x] Fail `svvyx extensions build web --json` with structured JSON errors when TinyFish is missing
      or its version is unknown, while using detected TinyFish versions for successful builds and
      reporting update metadata without adding native Web tools or generated Web clients. Commit(s):
      pending local changes
- [x] Treat TinyFish CLI output as ordinary shell output: the CLI writes search and fetch JSON to stdout by default, fetch includes page body text in `results[].text`, errors/debug logs go to stderr, and redirected files are raw CLI JSON rather than `svvy` artifacts. Commit(s): pending local changes
- [x] Add generated-context and extension-inventory tests proving Web is prompt-only, loaded by default
      for all adopted actor kinds only while `networkAccess` is true, unavailable when `networkAccess` is
      false, and absent from native tool declarations, loaded `svvyx` command guidance, generated TypeScript
      declarations, provider settings, and Firecrawl provider lists. Commit(s): pending local changes

## 3. Turn Decisions And Delegation

- [x] Persist a per-turn top-level decision for orchestrator and handler-thread surfaces, using one shared model across routing and supervision. Commit(s): `d323012`
- [x] Build a POC turn flow from message targeting to surface turn creation and command recording. Commit(s): `fff54d7`, `f53c9b8`
- [x] Implement direct surface targeting so a pane send goes to either the orchestrator surface or a handler-thread surface. Commit(s): `f53c9b8`
- [x] Add `thread_start` as the orchestrator-side delegation primitive. Commit(s): `f53c9b8`
- [x] Expose the resolved thread-control runtime surface and generated prompt text: orchestrators get `thread_start({ threadGroupId?, threads })` with per-item `history` and `overrides`, `thread_followup({ activate? })`, `thread_list`, `thread_episodes`, and `thread_request_report`; handlers get `thread_current`, `thread_group`, `thread_report`, and `thread_episodes`; agent-facing prompts and runtime tool declarations contain only that thread-control surface. Commit(s): pending local changes
- [x] Implement minimal orchestrator routing for local reply, local `execute_typescript`, clarification, and `thread_start`. Commit(s): `d323012`
- [x] Re-enter orchestrator control from durable handler-thread episodes, using durable thread objective state plus the latest episode instead of raw transcript scanning. Commit(s): `d323012`, `fdaf460`

## 4. Handler Threads

- [x] Build a POC handler-thread spawn flow with objective handoff and a dedicated backing pi session. Commit(s): `f53c9b8`
- [x] Persist handler-thread objective state separately from handler activity, workflow activity, waits, and repair context, without flattening workflow failure or cancellation into thread objective conclusion. Commit(s): `f53c9b8`, `fdaf460`, `a02bd48`
- [x] Let handler threads receive direct user messages through the same surface model as the orchestrator. Commit(s): `f53c9b8`
- [x] Make handler-thread clarification, waiting, and resume happen inside the thread itself instead of bouncing through the orchestrator by default. Commit(s): `f53c9b8`
- [x] Add runtime-level verification that handler-local command or Smithers failure can continue or rerun on the handler surface without an orchestrator turn unless the handler explicitly calls `thread_report`. Commit(s): pending local changes
- [x] Keep handed-back handler threads directly interactive for follow-up chat without forcing a new thread. Commit(s): `ba5c3f0`
- [x] Let a concluded handler objective move back to active through explicit orchestrator re-engagement with `thread_followup({ activate: true })`, preserving handler and workflow activity as derived facts. Commit(s): `f53c9b8`, `a02bd48`
- [x] Preserve earlier thread episodes when the same thread later returns control again. Commit(s): `d323012`
- [x] Allow the orchestrator to inspect a handler thread on demand without making that the default reconciliation path. Commit(s): `ba5c3f0`
- [x] Make `thread_report` the explicit handler-thread episode and conclusion path so ordinary handler replies stay interactive and multi-turn. Commit(s): `fdaf460`
- [x] Load the orchestrator and handler-thread instructions through pi's true `systemPrompt` channel before sending each real user message. Commit(s): `8a41d08`
- [x] Surface the active system prompt as a collapsible transcript item while keeping committed conversation history in pi session history rather than role-labelled prompt reconstruction. Commit(s): `8a41d08`
- [x] Slice generated capability declarations by actor so the orchestrator prompt receives only orchestrator-callable tools while handler-thread prompts receive only handler-callable tools. Commit(s): `a02bd48`
- [x] Teach the orchestrator prompt that workflow actions normally require delegation into a handler thread instead of direct Smithers guidance in the orchestrator API block. Commit(s): `a02bd48`
- [x] Teach handler-thread prompts that the orchestrator owns delegation and reconciliation while omitting orchestrator-only tool declarations such as `thread_start` unless nested delegation is explicitly adopted. Commit(s): `a02bd48`

## 5. Smithers CLI Boundary

Current product decisions for this section are specified in `docs/specs/extension/smithers.extension.spec.md`.

- [x] Keep Smithers as a builtin prompt-only extension that loads official CLI and authoring guidance for handler threads without native Smithers tools, generated TypeScript clients, product workflow wrappers, or bundled app Smithers runtime dependencies. Commit(s): pending local changes
- [x] Generate the Smithers core instruction fragment from the Extension Managing-selected `smithers-orchestrator` documentation version while excluding GUI, Gateway, MCP, HTTP server, OpenTelemetry, DevTools, event-streaming, OpenAPI, Effect, and wrapper-oriented fragments that are not current `svvy` product surfaces. Commit(s): pending local changes
- [x] Keep the svvy Smithers boundary instruction focused on workspace `.smithers/`, checked global `smithers` CLI usage through Shell, `@svvy/workflows` imports, `svvyx workflows models list`, `svvyx workflows save`, and read-only generated output. Commit(s): pending local changes
- [x] Keep orchestrators aware that workflow action normally delegates into handler threads, while handler threads load by default Smithers prompt guidance and workflow task agents do not load by default Smithers. Commit(s): pending local changes

## 6. Workflows Source, Build, And Generated Surface

Current product decisions for this section are specified in `docs/specs/workflow-library.spec.md` and `docs/specs/extension/workflows.extension.spec.md`.

- [x] Store app-global reusable Workflows source under `~/.config/svvy/workflows/agents`, `prompts`, `components`, and `workflows`, with generated output under `~/.config/svvy/workflows/generated`. Commit(s): pending local changes
- [x] Treat generated Workflows output and workspace `.smithers/node_modules/@svvy/workflows` links as read-only plumbing outside the safe writable boundary; ordinary edits target source and then build. Commit(s): pending local changes
- [x] Generate `@svvy/workflows` with only `Agents`, `Components`, `Prompts`, and `Workflows` root namespaces, and export `Agents.defineTaskAgent` plus `Agents.TaskAgentParameters` under `Agents`. Commit(s): pending local changes
- [x] Link `@svvy/workflows` and generated `@svvy/extensions` into each opened workspace's `.smithers/node_modules` without relying on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or source-checkout-relative paths. Commit(s): pending local changes
- [x] Generate `@svvy/extensions` during the Workflows build path from workflow-task-safe builtin ids plus active ready user `svvyx` extensions that opt into TypeScript API generation after Extension prebuild, including dependency-backed current builds only when their exact approved package artifacts are installed; reject workflow-agent overrides for deleted, instruction-only, dependency-missing, or build-failed extension ids. Commit(s): pending local changes
- [x] Implement `svvyx workflows list [--kind agent|prompt|component|workflow] --json` with only mechanically available export identity and source/generated paths. Commit(s): pending local changes
- [x] Implement `svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json`, with strict overwrite rejection by default and automatic build after successful save. Commit(s): pending local changes
- [x] Implement `svvyx workflows build --json` so it first builds Extensions, generates `@svvy/extensions`, validates Workflows source, validates workflow-agent provider/model/reasoning and extension usage overrides, generates `@svvy/workflows`, and repairs workspace links. Commit(s): pending local changes
  - [x] Preflight app-owned user Extension source before Workflows source validation so invalid Extension build inputs and TypeScript-enabled `svvyx` extensions that cannot rebuild fail with Extension-specific diagnostics before `@svvy/extensions` or `@svvy/workflows` package writes. Commit(s): pending
  - [x] Add automatic Extension rebuild and dependency/CLI-aware outcomes to the Workflows build pipeline before workflow-agent extension usage overrides are accepted. Commit(s): pending
- [x] Implement `svvyx workflows models list --json` from the same pi-normalized provider/model/auth/reasoning metadata used by the Agents pane, without a live completion request by default. Commit(s): pending local changes
- [x] Store reusable task-agent parameters as structured `.agent.json` source records that are bidirectionally synchronized with the Agents pane and generated as `Agents.*` exports. Commit(s): pending local changes
- [x] Save `--kind agent` by statically extracting `Agents.defineTaskAgent(...)` or resolvable `defineTaskAgent(...)` parameter literals without executing arbitrary TypeScript; reject dynamic or unresolved inputs with structured diagnostics. Commit(s): pending local changes
- [x] Attach generated export metadata internally for UI source/generated links without exposing public metadata fields, public declarations, `__exports`, or changed import usage to agents. Commit(s): pending local changes
- [x] Render the Workflows pane as read-only visibility into generated `@svvy/workflows`, with export identity, read-only generated code, generated-file link, source-file link, and Agents-pane customization links for `Agents.*`. Commit(s): pending local changes

## 8. Workspace Navigation, Live Surfaces, And Core Projection

Current product decisions for this section are specified in `docs/specs/workspace-navigation-core-projection.spec.md`.

- [x] Drive the session sidebar entirely from durable workspace session summaries. Commit(s): `9a21f87`, `b0ee858`
- [x] Define the stored shape for pinned and archived sessions, including the default collapsed state for the single Archived group. Commit(s): `3855fe4`
- [x] Persist pinned and archived session state. Commit(s): `3855fe4`
- [x] Render pinned sessions at the top of the active session list. Commit(s): `3855fe4`
- [x] Render archived sessions inside one Archived group in the session sidebar. Commit(s): `3855fe4`
- [x] Persist the Archived group collapsed state per workspace. Commit(s): `3855fe4`
- [x] Add session row actions for pin, unpin, archive, and unarchive. Commit(s): `3855fe4`
- [x] Keep durable unread state session-level with sidebar timestamp dots, focus-to-read clearing, and session row context-menu actions for mark read or unread, pin, rename, archive, and confirmed delete; pane unread treatment, when present, reads from the same session metadata. Commit(s): pending local changes
- [x] Join session summaries, focused panel, and panel-to-surface bindings in one workspace-shell read model without depending on a global active surface. Commit(s): `9a21f87`, `b0ee858`
- [x] Split workspace-summary updates from live surface transcript updates in the renderer runtime. Commit(s): `9a21f87`, `b0ee858`
- [x] Manage open live surfaces in a shared registry keyed by `surfacePiSessionId`. Commit(s): `9a21f87`, `b0ee858`
- [x] Give each live surface its own prompt lock, model state, reasoning state, and cancellation lifecycle. Commit(s): `9a21f87`, `b0ee858`
- [x] Render handler-thread rows from structured state in the workspace shell while keeping lifecycle subtitles, active command summaries, running indicators, open-pane treatment, and compact context rails local to the owning row. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`, pending
- [x] Show thread objective, objective state, and row-local derived blocked reason in panel-local thread views. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render the latest thread episode for an inspected thread while preserving earlier episodes in thread history. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render thread-linked artifacts before relying on transcript reconstruction. Commit(s): `3855fe4`
- [x] Restore focused panel, panel-to-surface bindings, and inspector selection after restart. Commit(s): `3855fe4`
- [x] Keep open workspaces as left-aligned, horizontally scrollable, draggable app-chrome tabs with durable user-defined tab order, compact icon controls, >0-only colored status count badges, a svvy-owned default workspace runtime when no user workspace tabs restore, exactly one `Open Workspace` pane as each new default workspace tab's first surface, current-tab `Open Workspace`, `New Tab` as a new default workspace tab with no durable layout slots, and `Open Workspace in New Tab` as picker-backed user workspace tab creation; duplicate same-cwd tabs are separate chrome views over the same backend workspace runtime, session catalog, durable workspace state, live surface registry, queues, threads, app logs, saved Workflows generated-state visibility, and durable layout slots keyed by `(workspaceId, layoutId)`, while each tab stores only its selected active layout id. Commit(s): pending local changes
- [x] Route all workspace-scoped backend requests and renderer sync events through explicit `workspaceId` instead of process-global cwd, active workspace, focused tab, or active runtime; keep app-global settings on separate app-global APIs, and require explicit `workspaceId` for workspace-affecting settings plus generated agent-context projections and Workflows library operations. Commit(s): pending local changes

## 9. Command Palette And Quick Open

Current product decisions for this section are specified in `docs/specs/command-palette.spec.md`.

- [x] Define the product-owned command/action registry shape, including stable ids, labels, aliases, categories, availability, shortcuts, and typed execution targets. Commit(s): `cb319ac`
- [x] Define the shared VS Code-style palette shell where `Cmd+Shift+P` opens with `>` prefilled and `Cmd+P` opens the same input without a prefix. Commit(s): `cb319ac`
- [x] Define `>` as the live command-mode prefix for session, surface, handler-thread, Workflows, Dockview panel, settings, Agents profile, and future product actions. Commit(s): `cb319ac`
- [x] Define unprefixed `Cmd+P` behavior as file quick-open search with placeholder or no-op behavior until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist. Commit(s): `cb319ac`
- [x] Adopt `cmdk-sv` as the Svelte command palette UI primitive while keeping product routing and command semantics owned by `svvy`. Commit(s): `cb319ac`
- [x] Build a POC command palette over static product actions. Commit(s): `cb319ac`
- [x] Expose session creation, open/switch, pin, unpin, archive, and unarchive actions through the palette. Commit(s): `cb319ac`
- [x] Show unified `Open Session` results for orchestrator, handler-thread, and workflow task-agent projection categories with visible kind badges. Commit(s): `12d89d8`
- [x] Route unmatched non-empty command-mode text after `>` into a New orchestrator initial prompt through the normal orchestrator turn model. Commit(s): `cb319ac`
- [x] Add keyboard shortcut handling for `Cmd+Shift+P`, `Cmd+P`, Enter, and command-palette `Cmd+Enter` placement once Dockview layout exists. Commit(s): `cb319ac`
- [x] Add tests for shortcut dispatch, command matching, action routing, disabled or hidden availability, and unmatched prompt-session creation. Commit(s): `cb319ac`
- [x] Keep a product-owned shortcut registry with stable action ids, labels, platform chords, compact and readable display strings, scopes, input-typing policy, and app-menu routing metadata, while command availability and palette result metadata stay on product action definitions. Commit(s): pending
- [x] Use TanStack Hotkeys as the renderer shortcut dispatch primitive for palette, quick-open, sidebar shell actions, dialog-local actions, pane placement, and future focused-pane actions. Commit(s): pending

## 10. Pane Layout, Surface Ownership, And Expanded Surfaces

Current product decisions for this section are specified in `docs/specs/pane-layout.spec.md`.

- [x] Add `dockview-core` as the workspace layout engine and mount one Dockview workbench instance from the Svelte renderer. Commit(s): pending local changes
- [x] Build the Svelte renderer adapter for Dockview content, tabs, header actions, context menu items, tab-group chips, watermark, and unavailable-surface panels. Commit(s): pending
- [x] Add Settings as a Dockview-bindable pane target and renderer branch. Commit(s): pending
- [x] Persist Dockview serialized layout state plus svvy panel metadata, including panel-to-surface bindings, panel-local state, chrome state, restore state, and minimum panel policy. Commit(s): pending local changes
- [x] Persist fixed user workspace layout slots `A`, `B`, and `C` keyed by `(workspaceId, layoutId)`, with the selected slot autosaved on pane changes and empty slots rendered as muted but selectable controls pinned at the far right of workspace chrome; keep default workspace tab pane changes ephemeral and initialize every new default workspace tab with exactly one `Open Workspace` pane. Commit(s): pending local changes
- [x] Keep panel-to-surface bindings separate from live surface runtime state. Commit(s): pending local changes
- [ ] Support Dockview split, splitter resize, close, tab placement, panel and group drag placement, root-edge placement, edge groups, floating groups, and popout groups through svvy placement commands.
  - [x] Preserve tab, root-edge, floating, and popout placement intent through runtime pane state and Dockview adapter placement options. Commit(s): pending local changes
  - [x] Expose command-palette placement actions for the current pane's surface into left/right/above/below splits, left/right/top/bottom root edges, floating groups, and popouts through the shared runtime placement target path. Commit(s): pending
  - [x] Derive command-safe Dockview tab-group targets from serialized layout state and expose `pane.place-tab.<groupId>` placement commands through the shared runtime placement target path. Commit(s): pending
  - [ ] Add explicit resize commands once the product has a stable command target-selection contract for Dockview-owned groups and splitters.
- [x] Configure Dockview drag/drop overlays and `dndEdges`, with svvy policy enforced through `onWillShowOverlay`, `onWillDrop`, `onDidDrop`, and `onUnhandledDragOverEvent`. Commit(s): pending local changes
- [x] Manage explicit open and close semantics for live surfaces independently from Dockview panel focus. Commit(s): pending local changes
- [x] Allow the same interactive surface to be opened in more than one Dockview panel at once. Commit(s): pending local changes
- [x] Keep one underlying live surface controller per `surfacePiSessionId` regardless of panel count. Commit(s): pending local changes
- [x] Persist Dockview layout JSON, panel occupancy, panel-local state, tab-group state, edge-group state, floating/popout state, and panel metadata across app restart. Commit(s): pending local changes
  - [x] Persist and restore static-pane tab, root-edge, floating, and popout placement metadata through workspace UI restore state. Commit(s): pending local changes
  - [x] Restore mixed runtime layout state for serialized Dockview JSON, prompt and static pane bindings, focused panel id, panel-local scroll and density, and edge/floating/popout placement metadata. Commit(s): pending
  - [x] Add mounted Dockview verification that `fromJSON` restores edge and floating groups while preserving svvy's saved focused panel state in the real Svelte adapter. Commit(s): pending
  - [ ] Follow-up: add mounted popout restore verification once the app/test harness can observe or permit startup popout windows without relying on ordinary fallback panel sync; the OrbStack GTK/browser-tools lane currently reports only the main window after a seeded startup popout restore, even with a packaged Dockview popout host page.
- [x] Restore the focused Dockview panel on app restart. Commit(s): pending local changes
- [x] Show exact Dockview panel-location indicators in the sidebar for open surfaces, including tab, edge-group, floating, and popout locations. Commit(s): pending local changes
- [x] Show a clear highlight for the currently focused Dockview panel surface. Commit(s): pending local changes
- [x] Define the stored shape for compact thread surfaces inside the workspace shell. Commit(s): pending local changes
- [x] Render compact thread cards in the workspace shell timeline. Commit(s): pending local changes
- [x] Open a selected handler-thread surface in a chosen Dockview panel as a fully interactive surface. Commit(s): pending local changes
- [x] Keep duplicated panel views of the same surface synchronized while allowing independent scroll position. Commit(s): pending local changes

## 11. Agents Pane And Agent Profiles

- [x] Define the stored shape for pi-backed agent profile settings used by orchestrator and handler surfaces. Commit(s): `8e19462`
- [x] Keep agent profiles separate from session-local extension loading so specialized handler guidance uses normal handler-thread execution plus loaded extensions. Commit(s): `2a5dbbe`
- [x] Seed initial app-wide values for the default orchestrator profile, the `threadHandler` profile, and internal title-naming settings. Commit(s): `8e19462`, `354db28`
- [x] Build a POC settings model for editing app-wide agent profile defaults. Commit(s): `8e19462`
- [x] Persist app-wide agent profile settings. Commit(s): `8e19462`
- [x] Build a POC New orchestrator creation flow with profile-backed orchestrator selection. Commit(s): `8e19462`
- [x] Persist the orchestrator profile snapshot and prompt selection used by created sessions. Commit(s): `8e19462`
- [x] Persist per-session orchestrator profile overrides. Commit(s): `8e19462`
- [x] Persist and deliver handler start history mode for delegated handler threads, defaulting `thread_start.threads[].history` to `isolated` and supporting explicit `forked` starts only for conservative continuity cases where the user asks for current conversation context, unresolved design nuance cannot be captured in durable files or a compact objective, or multiple approaches must start from the exact same conversational point. Commit(s): pending local changes
- [x] Persist handler creation-time extension-state overrides for delegated handler threads as partial overrides over the `threadHandler` profile. Commit(s): pending local changes
- [x] Keep the Agents sidebar pane between Logs and Extensions, with orchestrator profiles plus the `threadHandler` special profile owned there instead of in General settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Drive the New orchestrator picker order, profile-specific command palette actions, and surface profile badges from Agents-pane orchestrator profile order. Commit(s): `2b97c46648`, `031510ba2b`
- [x] Keep the default orchestrator profile locked, first, non-draggable, non-deletable, and editable for settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Keep the `threadHandler` special profile available for delegated handler-thread surfaces. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Show the current focused-surface agent profile summary in pane chrome. Commit(s): `8e19462`
- [x] Use TanStack Form for complex settings forms where renderer-local validation and save state are needed. Commit(s): pending
  - [x] Provider API key entry and app-preference settings use TanStack Form with validation, dirty state, reset/cancel, pending submit state, async save errors, and backend-normalized reset defaults. Commit(s): pending
  - [x] Agent-profile and workflow-agent profile editors use TanStack Form while preserving direct-save semantics, workflow-agent instruction autosave status inside the textarea, and pi-normalized provider/model/reasoning constraints. Commit(s): pending
  - [x] Extension env editors cover editable non-secret overrides and secret writes/removals through app-owned UI with redacted async errors and backend-authoritative readiness refresh. Commit(s): pending
- [x] Expose workflow-agent parameter records in the Agents pane through the same source used for `Agents.*` generated Workflows exports, with create, duplicate, user-delete, non-deletable default Explorer/Implementer/Reviewer records, source-file links, and the same expanded extension selection/order editor used by other agent profiles. Commit(s): pending
- [x] Keep Agents-pane profile and workflow-agent controls visually stable during transient save/autosave states, using save indicators and action-level guards instead of dimming unrelated row controls. Commit(s): 5de117401
- [x] Define handler guidance for reusable workflow-agent parameter records without coupling shipped product workflow authoring to repo-root `workflows/`. Commit(s): pending local changes

## 12. Session Titles

- [x] Define the stored title states for top-level sessions and handler threads. Commit(s): `b510857`, `fe53a3b`
- [x] Add internal pi-backed title-naming settings for one-shot top-level session naming rather than a Smithers workflow agent. Commit(s): `354db28`
- [x] Seed the internal title-naming settings to `openai-codex`/`gpt-5.4-mini` with low reasoning effort and treat its settings prompt as the only naming instruction, without exposing title naming as a special profile. Commit(s): `354db28`
- [x] Build a POC event-driven title-generation flow that starts a durable one-shot naming job concurrently with the first real top-level user turn without waiting for the orchestrator response. Commit(s): `354db28`
- [x] Use the first live composer draft or first submitted user message as the provisional visible session title until the namer-generated title lands. Commit(s): `5378dcb`
- [x] Persist generated top-level session titles, title-generation lifecycle state, and the first-turn trigger so app restart cannot duplicate or lose title generation. Commit(s): `354db28`
- [x] Block manual session rename while a title-generation job is pending or running, then release the lock after success, failure, or cancellation. Commit(s): `354db28`
- [x] Freeze auto-titling after manual rename or after the first successful generated title. Commit(s): `354db28`
- [x] Generate handler-thread titles with the same internal title-naming settings used for top-level sessions, using the orchestrator-supplied `thread_start` objective as the naming input. Commit(s): `4d74c78`

## 13. Composer Mention Links

- [x] Define the stored shape for composer file and folder mention links.
- [x] Build a POC `@` autocomplete picker over indexed workspace files and folders.
- [x] Keep selected `@` mentions as normal inline composer text.
- [x] Render picker, dropped, and pasted files as removable chip-only composer attachments without mutating textarea text.
- [x] Store file, folder, and image attachments for composer and transcript rendering, pass attachment paths through tagged agent-facing metadata without visible transcript prose, send images to pi as image content blocks, and warn when model metadata does not list image input.
- [x] Save composer draft text and chip-only attachments live as durable surface state that survives closing the surface and app restart. Commit(s): `5378dcb`
- [x] Serialize inline mentions into the outgoing user message as normal workspace path links.
- [x] Render sent mentions in the transcript as actionable workspace links that reveal files, open folders, and visibly mark missing paths.
- [x] Keep mentions agent-neutral: no prompt injection, no eager file reads, no folder expansion, and no special context-target resolution.

## 13A. Queued Surface Messages

Current product decisions for this section are specified in `docs/specs/queued-messages.spec.md`.

- [x] Persist durable surface queue items as structured surface-local product state keyed by `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`, kind, and FIFO queue position. Commit(s): pending
- [x] When a composer submits to an active orchestrator or handler-thread surface, queue the message for that same surface instead of steering the current turn, interrupting tool work, starting a concurrent turn, or retargeting to the focused panel. Commit(s): pending
- [x] Deliver queued messages as the next real pi user message after the owning surface prompt lock releases, creating a normal turn record and preserving prompt history as a single queue-time submission. Commit(s): pending
- [x] Project blocked queue items near the owning surface composer, including count, order, remove, restore-to-composer, and duplicated-panel consistency, while idle-surface items first appear as pending or active work after atomic claim. Commit(s): pending
  - [x] Add an explicit composer-strip delivery-failure state if failed delivery should remain queue-row-local instead of surfacing as normal failed turns or queue restoration/cancellation. Commit(s): pending
- [x] Restore queued messages after app restart without transcript inference and resume delivery only after the owning surface runtime and prompt lock state are reconstructed. Commit(s): pending
- [x] Claim queued messages atomically through one shared queue runner per `surfacePiSessionId` and prevent duplicated panes or tabs from starting duplicate backend queue drains. Commit(s): `45bdbe8b46`
- [x] Land idle-surface queue-manager claim before renderer-visible queued state so idle sends and idle agent context refreshes first appear as pending or active surface work. Commit(s): pending
- [x] Keep queued-message drag reorder previews local until drop, persist only final changed order, and skip no-op durable reorder writes. Commit(s): `98c73ecbb6`
- [x] Represent handler reports as durable episode records that schedule typed `thread_report` orchestrator reconciliation notifications; notification dismissal does not roll back the episode or return a handler tool error. Commit(s): 7739c2c824
- [x] Represent generated agent context refresh as typed surface queue work, apply it before later prompt-bearing items, and expose queued, cancel, retry, and out-of-date recovery UI. Commit(s): 61ba639d6a
- [x] Let committed user transcript messages enter composer edit mode with a visible selected-message indicator and a draft-replacement warning, then resend by moving the same pi surface back to the original message's parent state before continuing from the edited user message. Commit(s): `5378dcb`

## 14. Agents, Extensions, And Generated Agent Context

Current product decisions for this section are specified in `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`, `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/structured-session-state.spec.md`, `docs/specs/queued-messages.spec.md`, `docs/specs/extension/smithers.extension.spec.md`, and `docs/specs/extension/workflows.extension.spec.md`.

- [x] Define builtin extensions for Shell, Apply Patch, Execute TypeScript, Extension Loading, Extension Managing, cx, Smithers, Workflows, Web, Git, GitHub, External Instructions, Artifacts, and Request User Input with default usage states for each adopted agent family. Commit(s): `673837a`
- [x] Load base orchestrator, handler, and workflow-task guidance through builtin `base-*` instruction extensions, with orchestrators aware that workflow action normally delegates into handlers, handlers loaded by default with prompt-only Smithers guidance and Workflows source-library commands, and workflow task agents keeping Smithers, Workflows, and handler controls configured off by default but still configurable through profile overrides. Commit(s): `673837a`
- [x] Define available extensions as the on-demand product-knowledge and capability layer for specialized handler work. Commit(s): `2a5dbbe`
- [x] Render loaded and available extension bindings in surface metadata so users can see when specialized extensions are active. Commit(s): `2a5dbbe`
- [x] Store app-wide agent profiles, extension usage selections, generated agent-context aggregate references, extension context fingerprints, and app-global extension activation metadata. Commit(s): `118fd39c9f`
- [x] Add an `Extensions` sidebar surface below `Agents`, with builtin, user, and external-instruction records that manage reusable prompt material and capabilities rather than exposing one raw system-prompt textarea. Commit(s): `118fd39c9f`
- [x] Represent common, orchestrator, handler-thread, and workflow task-agent base prompts as builtin instruction-only extensions (`base-common`, `base-orchestrator`, `base-handler`, and `base-workflow-task`) with normal Extensions-pane editing, reset, generated-context preview, fingerprinting, and profile usage-state controls. Commit(s): pending local changes
- [x] Seed builtin extension records for base actor instructions, code navigation, prompt-only Smithers guidance, Workflows source-library commands, workflow task boundaries, Web, Git, GitHub, Artifacts, and Request User Input, with per-agent usage states, non-deletable builtin rows, app-global scope, and extension reset behavior. Commit(s): `118fd39c9f`
- [x] Render generated agent-context previews for orchestrator, handler, and workflow task-agent actors, linking loaded and available extension rows back to their extension records and showing generated prompt, `svvyx` guidance, native schemas, and TypeScript declaration previews. Commit(s): `118fd39c9f`
- [x] Show tokenx-backed generated prompt token estimates in expanded Agents rows, with active extension rows showing aligned generated instruction estimates, available rows showing available-prompt estimates plus would-be loaded-prompt estimates in parentheses, Off rows omitting counts, expanded workflow-agent inline instruction rows showing live draft estimates beside their source file link, and the total actor prompt estimate visible beside reset controls while including the current workflow-agent inline instruction draft. Commit(s): pending local changes
- [x] Create app-owned user extension skeletons through `svvyx extensions create`, with `instructions` and `svvyx` interfaces, neutral instruction files, an Incur default-export source skeleton for `svvyx`, manifest-backed inspect/build visibility under the same app-owned root, initial draft/build-required state, and rejection for builtin, reserved, manifest-collision, duplicate, invalid, and native-tool targets. Commit(s): pending local changes
- [x] Manage user extension full instruction files through `svvyx extensions instructions add`, `rename`, `remove`, `reorder`, and `configure`, with app-owned file/config-only mutations, lexicographic file ordering, skip config stored in the editable manifest, deterministic reorder prefix renames, before/after lifecycle change records, focused validation, and dirty build state that leaves the current successful build active until the next successful build. Commit(s): pending local changes
- [x] Revert recorded instruction lifecycle changes through `svvyx extensions revert <change-id> --json`, with exact current-state conflict detection, `extension_files` `revertedChangeId`/`changeId` output, reverted file facts including manifest-only config changes, a follow-up change record for the revert, and an immediate same-build-path auto-build projection that reports success, blocked build errors, or durable dependency approval pauses. Commit(s): pending local changes
- [x] Delete user extensions through `svvyx extensions delete <id> --json` by recording an app-global reversible delete change before moving local source into trash, rejecting builtin deletes, blocking stale `svvyx` runtime dispatch for deleted current builds, and restoring deleted source through `svvyx extensions revert <change-id> --json` with active-source collision and build-required handling. Commit(s): pending local changes
- [x] Manage local Extension Managing snapshots through `svvyx extensions snapshots list/save/rename/delete --json`, with path-free snapshot summaries, app-generated ids, source/package/registry-state payload capture, and exclusion of generated outputs, build outputs, `node_modules`, and unsafe path/token-bearing package files. Commit(s): pending local changes
- [x] Build user extension contexts through staged Extension Managing builds that promote successful output to `current/`, preserve the previous current build on validation failures, report manifest env/dependency/trusted-dependency declarations in inspect/build readiness, keep env output status-only and redacted, split `contextReady` from `runtimeReady` for missing required env and unapproved dependency declarations, block missing or unknown required CLI requirements before promotion, validate exact dependency versions, generated-instruction declarations, instruction config references, env defaults, and `svvyx` source shape, and refuse generated-instruction activation until generator execution is implemented. Commit(s): pending local changes
- [x] Record explicit Extension Managing build dependency approval requests in an app-global durable ledger keyed by exact dependency and trusted-dependency identities, pause those builds before staging promotion with a durable approval request id, reuse pending requests for repeated builds with the same unapproved identity set, project existing pending request ids through later inspect/readiness output, obsolete stale requests when the extension no longer requires those identities, and require new approval when the exact dependency or trusted dependency identity changes. Commit(s): pending local changes
- [x] Resume blocked Extension Managing install/build work after dependency approval, install approved extension package dependencies from the app-owned package area with lifecycle scripts disabled unless the exact trusted dependency identity is approved, preserve current builds on install failure, and project exact installed/missing package artifact status. Commit(s): pending local changes
- [x] Manage app-global extension env values with non-secret app-level overrides in agent settings plus secret entry, update, and removal through the Extensions pane backed by macOS Keychain storage; Extension Managing and inventory report only declaration metadata and configured/missing/defaulted status, while `svvyx` runtime dispatch injects values only for the trusted extension invocation and redacts secret stdout. Commit(s): pending local changes
- [x] Project builtin extension CLI readiness into the Extensions pane from the same Extension Managing inspect/build readiness facts, including missing, unknown, available, detected/current/default/latest versions, update-available status, and install/update command facts without renderer-side CLI probing. Commit(s): pending local changes
- [x] Project reversible Extension Managing change cards into the Extensions pane from the same lifecycle, usage, and delete change records used by `svvyx extensions revert <change-id> --json`, with UI-triggered reverts routed through Bun and refreshed from authoritative inventory state. Commit(s): pending local changes
- [x] Dispatch built user `svvyx` extensions through app-owned `exec_command` routing that resolves current build manifests, validates exact installed dependency package artifacts before runtime invocation, imports bundled default-exported Incur CLIs, rejects non-standalone shell-control invocations, invokes `cli.serve` with unchanged extension argv and invocation-local env, redacts returned secret env values, reports structured runtime errors with readiness or command-failure facts, and returns dispatcher command facts without treating extension usage state as a shell-level command block. Commit(s): pending local changes
- [x] Extract Incur command manifests during successful user `svvyx` extension builds, persist them in current build metadata, and reject malformed command-manifest current builds before runtime dispatch or future generated declaration consumption. Commit(s): pending local changes
- [x] Manage orchestrator and `threadHandler` profile extension usage through `svvyx extensions set-usage`, with persistent tri-state profile usage, fixed always-loaded Extension Loading, app-global reversible usage change records, exact usage-revert conflict detection, profile-backed inspect usage output, and queued `agent_context_refresh` work for affected surfaces without directly mutating the caller's current binding. Commit(s): pending local changes
- [x] Manage Extensions-pane source editing, default order, duplicate/delete/reset controls, draggable default ordering, inventory filters, customized builtin tags, composable editable minimal instructions, loaded source contributors, scripted instruction contributors with editable generator scripts plus read-only generated output, external instructions as read-only discovered sources, tooling sections for native tool schema, `svvyx` command schema, and generated TypeScript API declarations, file-backed instruction editing with conflict handling, per-contributor skip controls, add/remove/reorder loaded-source lifecycle, app-owned trash for removed instruction files, and snapshots that preserve local source, default order, and default state. Commit(s): pending local changes
- [x] Rebuild builtin local source resets through the same Extension build path used by explicit builds, surfacing successful or blocked auto-build projections in reset output and command facts. Commit(s): pending local changes
- [x] Load local Extension Managing snapshots through `svvyx extensions snapshots load <snapshot-id> --json` by restoring local source/config/package state, removing live source entries absent from the snapshot, excluding package `node_modules`, immediately attempting restored extension builds through the normal build path, and creating or reusing durable dependency approval requests with `blockedOperation: "snapshot_load"` before promotion when unapproved dependency identities are present. Commit(s): pending local changes
- [x] Preserve local Extension Managing snapshot secret state through app-managed secret storage on snapshot save/load/delete, report only coarse `hasSecretState` and restore status, and keep raw secret values plus internal snapshot secret storage ids out of command output and snapshot files. Commit(s): pending local changes
- [x] Queue `agent_context_refresh` for existing orchestrator and handler surfaces impacted by successful Extension Managing snapshot load, and drop removed user extensions from their stored loaded/available extension ids before refresh. Commit(s): pending local changes
- [x] Keep existing current builds intact when snapshot-loaded replacement source fails to bundle, report a structured blocked build result, and skip loaded-session refresh for the failed replacement. Commit(s): pending local changes
- [x] Complete the `svvyx` runtime surface with packaged executable availability, full Extension-build-owned `@svvy/extensions` generation, dependency-approved package resolution, extracted Incur command manifests for future user generated clients, hidden/unavailable user generated clients in `execute_typescript` until sandboxed execution exists, workflow-agent tri-state extension usage for `set-usage`, and live projection/recovery coverage. Commit(s): pending local changes
- [x] Extend Extension Managing lifecycle to conversation-owned UI revert events backed by durable session/thread lifecycle records and transcript semantic projection. Commit(s): pending
- [x] Store user-named Extension Managing snapshots plus durable generated agent context bindings and agent context fingerprints so historical sessions, handler threads, and workflow task-agent attempts remain inspectable after app restart. Commit(s): pending local changes
  - [x] Persist local Extension Managing snapshot save/list/rename/delete metadata and payloads, plus actor surface loaded/available extension ids and generated context fingerprints. Commit(s): pending
  - [x] Store durable generated-context binding records with aggregate cache keys plus bound prompt, `svvyx` guidance, TypeScript declarations, native tool schemas, loaded/available extension ids, and external source hashes so historical surfaces can inspect their bound context after restart even when current extension/external-instruction sources change or aggregate cache blobs are pruned. Commit(s): pending local changes
  - [x] Implement Extension snapshot load with local source/config/package restore and normal build/dependency-approval pause flow. Commit(s): pending local changes
  - [x] Implement local Extension snapshot secret-state preservation through app-managed secret storage with coarse save/load status and delete cleanup. Commit(s): pending local changes
  - [x] Implement loaded-session `agent_context_refresh` queueing and removed user-extension state cleanup after successful snapshot load. Commit(s): pending local changes
  - [x] Implement dependency-approval resume/install completion after explicit build and snapshot-load approval pauses, with installed artifact validation and snapshot resume conflict protection. Commit(s): pending local changes
- [x] Add automatic generated agent context update projection for existing orchestrator and handler-thread surfaces, including grouped semantic diff details on queued, applied, failed, cancelled, and out-of-date states. Commit(s): pending local changes
  - [x] Project queued, updating, and out-of-date `agent_context_refresh` rows with grouped semantic details for system prompt, loaded extensions, available extensions, external source hashes, revision, and superseded-fingerprint state in surface snapshots and compact queue UI. Commit(s): pending local changes
  - [x] Add a durable visible terminal-state projection for applied and cancelled generated-context updates without reintroducing transcript prose or keeping stale terminal queue rows in the active queue strip. Commit(s): pending local changes
- [x] Route `thread_start` extension overrides and handler-side `load_extension` through generated agent context bindings while preserving durable loaded and available extension ids on each affected surface. Commit(s): pending

## 14A. Ambient Agent Resources

Current product decisions for this section are specified in `docs/specs/ambient-agent-resources-baseline.spec.md`.

- [x] Add provider-neutral Ambient Agent Resources settings that default behavior-changing coding-agent host resources off, preserve visible runtime standards, and let the user opt in by host, workspace, target agent/profile configuration, category, and source for callable capabilities, extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, and execution-policy resources. Commit(s): pending local changes
  - [x] Persist the disabled-by-default category ledger without letting that ledger affect prompts, tools, commands, UI, provider/auth behavior, or execution policy until the full enablement model exists. Commit(s): pending
  - [x] Persist normalized host, source, app/workspace scope, category, and actor/profile enablement records for ambient resources without letting those records affect runtime behavior. Commit(s): pending
  - [x] Add a pure resolved-binding helper that returns enabled ambient candidates only when category, source, scope, actor, and profile all match. Commit(s): pending
- [x] Implement the baseline pi adapter so orchestrator, handler-thread, and workflow task-agent loaders preserve `AGENTS.md`/`CLAUDE.md`, ignore `SYSTEM.md`/`APPEND_SYSTEM.md`, and keep behavior-changing ambient extensions, skills, prompt templates, themes, package resources, slash commands, hooks, provider adapters, and related settings disabled until enabled through exact category/source/workspace/profile contracts. Commit(s): pending local changes
  - [x] Create managed pi actor sessions with default-deny resource loading, svvy-composed system prompts, empty agent files and append prompts, no host extensions/skills/prompt templates/themes/additional paths/factories, suppressed pi built-in tools, svvy-owned custom tools only, disabled prompt-template expansion, and no ambient `extendResources()` calls. Commit(s): pending
  - [x] Discover same-directory `AGENTS.md` and `CLAUDE.md` as visible external instruction records while load by defaulting only `AGENTS.md`; lone `CLAUDE.md` files remain enabled by default. Commit(s): pending
  - [x] Implement backend and Settings controls for external-instruction per-file enablement, actor selection, default-off builtin global roots, custom global roots, read-status visibility, and external-editor actions. Commit(s): pending local changes
  - [x] Project external-instruction records into the Extensions pane's distinct read-only External Instructions category with source group, path, read status, content, hash, per-file enablement, actor controls, Extension Managing inspect metadata, live stale prompt-binding updates, and external-editor actions. Commit(s): pending local changes
  - [ ] Connect enabled ambient resources to runtime loading only after category-specific host/source/workspace/profile contracts exist.
- [ ] Reflect enabled ambient callable resources in actor-specific generated API declarations, enabled prompt-affecting resources in generated agent context previews and agent context fingerprints, and enabled command resources in product command routing without hidden tools or invisible prompt mutation.
  - [ ] Add resolved enabled ambient callable-resource bindings to actor-specific generated API declarations.
  - [ ] Add resolved enabled ambient prompt-resource generated previews/fingerprints and resolved ambient command-resource product routing.

## 14B. Snippets Prompt Macros

Current product decisions for this section are specified in `docs/specs/snippets.spec.md`.

- [x] Add the Snippets pane with managed `svvy` snippets, read-only discovered Markdown snippets, source badges, previews, open-external-editor actions, and managed snippet create/edit/rename/delete controls. Commit(s): pending.
  - [x] Add managed `svvy` Snippet storage plus workspace-scoped RPC/read-model contracts for create, edit/rename, delete, and merged managed/discovered listing while keeping discovered Snippets read-only. Commit(s): pending.
- [x] Replace old Prompt Library/Context Library implementation with Agents/Extensions generated context plus separate Snippets. Commit(s): pending.
  - [x] Remove the obsolete Prompt Library/Context Library renderer pane surface, Dockview chrome, header snapshot controls, and shell open path so generated agent context is no longer exposed through the removed prompt-library product UI. Commit(s): pending.
  - [x] Replace the remaining internal prompt-library state/edit RPC/store naming with generated agent-context and Snippets-native contracts. Commit(s): pending.
- [x] Add composer `@` picker Snippet results with argument fields, mention chips, explicit expand-to-text behavior, and clean prompt-text expansion before sending to pi. Commit(s): pending.
  - [x] Add backend Snippet discovery, metadata parsing, and pure placeholder expansion primitives for supported Claude and pi Markdown sources. Commit(s): pending.
  - [x] Add a structured Snippet mention model that keeps file/folder mentions as ordinary textarea `@path` text while Snippet selections render chips, edit arguments, expand to editable text, and resolve before send. Commit(s): pending.
  - [x] Extend the existing file/folder mention search to include Snippet results with separate result metadata and accept behavior. Commit(s): pending.
  - [x] Add Snippet argument keyboard progression where `Tab`, `Enter`, and final `Enter` move through inline argument fields and return focus to composer text entry. Commit(s): pending.
  - [x] Commit a full typed Snippet mention with a space into the structured Snippet mention model instead of requiring picker selection. Commit(s): pending.
- [x] Persist sent Snippet provenance in product metadata while keeping the agent-facing message as ordinary prompt text. Commit(s): pending.
  - [x] Store sent-message Snippet provenance metadata with Snippet id, source, path, content hash, arguments, and resolved content while sending only expanded prompt text. Commit(s): pending.
  - [x] Promote Snippet provenance from message text signatures into explicit durable product metadata. Commit(s): pending.
  - [x] Render sent Snippet provenance chips from durable message metadata after send-time expansion exists. Commit(s): pending.
- [x] Keep pi, Claude, Codex, plugin, MCP, and host slash-command expansion disabled so Snippets never grant tools, alter generated agent context, mount commands, or change execution policy.
  - [x] Keep pi-backed actor sessions on `noPromptTemplates`, empty prompt-template paths, and empty prompt-template overrides. Commit(s): pending.

## 16. Recovery And Test Coverage

Current product decisions for workspace-runtime restart and crash recovery are specified in `docs/specs/workspace-runtime-recovery.spec.md`.

- [x] Build a POC restart or resume flow that restores multiple open surfaces and panel bindings from durable state. Commit(s): `7f84f06`
- [x] Complete one workspace-runtime recovery coordinator with durable scheduler records, transactional claims, per-surface queue, thread report notification, report request recovery, typed queued initial handler starts, title job recovery, Workflows build/link refresh, and backend-owned recovery events/logs. Commit(s): pending local changes
- [x] Restore pending request-user-input clarification and waiting state after app restart. Commit(s): `7f84f06`
- [x] Restore pending thread report notifications and per-surface prompt-lock state after app restart. Commit(s): `7f84f06`
- [x] Add integration tests that exercise the real pi-backed runtime seam for direct work. Commit(s): `b0ee858`
- [x] Expand integration coverage to pi-backed handler-thread delegation and prompt-only Smithers CLI guidance. Commit(s): `f8557d9`, `b0ee858`, `55963d9`, `097ae47`
- [x] Add integration tests that exercise restart and resume behavior across workspace state, live surface state, and panel bindings. Commit(s): `7f84f06`

## 17. Context Budget Observability

Current product decisions for this section are specified in `docs/specs/context-budget-observability.spec.md`.

- [x] Define the context-budget metric as an explicit percentage of the active model's max context for orchestrator surfaces, handler-thread surfaces, and workflow task-agent attempts. Landed in `8d3e362`.
- [x] Define neutral, orange, and red thresholds for that metric: neutral below 40%, orange from 40% through 59%, and red from 60%, with orange marking the conservative context-degradation warning band and red marking the zone where summarization, handoff, or a fresh surface should be considered. Landed in `8d3e362`.
- [x] Build a POC full-width focused-surface context bar below the composer for orchestrator and handler-thread panes. Landed in `8d3e362`.
- [x] Render the focused-surface context bar beneath the text input for orchestrator and handler-thread panes. Landed in `8d3e362`.
- [x] Build a POC compact bottom-edge context indicator for open unfocused orchestrator and handler-thread panes. Landed in `8d3e362`.
- [x] Render bottom-edge context indicators on open unfocused orchestrator and handler-thread panes. Landed in `8d3e362`.
- [x] Render context bars on focused handler-thread panes and workflow task-agent attempt summaries. Landed in `8d3e362`.

## 18. Workflows Library Surface

Current product decisions for this section are specified in `docs/specs/workflow-library.spec.md`.

- [x] Render the Workflows pane as read-only visibility into the latest successful generated
      `@svvy/workflows` package. Commit(s): pending local changes
- [x] Show generated `Agents`, `Components`, `Prompts`, and `Workflows` namespace exports with
      qualified export name, kind, read-only generated code, generated-file link, and source-file link.
      Commit(s): pending local changes
- [x] For `Agents.*` exports, show the generated task-agent parameter object and provide a primary
      human navigation action to the corresponding Agents pane record. Commit(s): pending local changes
- [x] Specify generated `Agents.*` task-agent parameter exports, direct parameter usage, and the
      authenticated `runTaskAgent` bridge contract that binds Smithers task-agent calls from
      handler-thread command-scoped environments to app-owned workflow-task-attempt surfaces without
      exposing broader app or workflow controls. Commit(s): pending local changes
- [x] Refresh the Workflows pane after successful `svvyx workflows build` and after Agents pane
      edits that trigger a Workflows build. Commit(s): pending local changes
- [x] Keep the Workflows pane limited to generated `@svvy/workflows` visibility, with no inferred
      titles, inferred summaries, validation claims beyond build output, source editing, delete actions,
      or workflow-running controls. Commit(s): pending local changes

## 19. App Logs Surface

Current product decisions for this section are specified in `docs/specs/app-logs.spec.md`.

- [x] Build a workspace-scoped app log store with structured debug, info, warn, and error entries, monotonic sequence numbers, unread counts, seen state, bounded retention, SQLite persistence, and secret redaction. Commit(s): `dab04ac`.
- [x] Expose app log read, summary, mark-seen, and live-update contracts through the Bun bridge and renderer runtime without polling. Commit(s): `dab04ac`.
- [x] Route production product observability through one app logger without depending on Electrobun browser-tools telemetry. Commit(s): `dab04ac`.
- [x] Emit targeted app logs for app lifecycle, provider auth, RPC failures, sessions, title generation, surfaces, prompts, handler threads, Smithers CLI guidance, Workflows build validation, direct tools, `execute_typescript`, artifacts, external editor handoff, and renderer bridge issues. Commit(s): `dab04ac`.
- [x] Add a `Logs` sidebar button directly above the workflow library entry with compact action-worthy unread badges for warning and error app logs, without surfacing info-only unread logs as sidebar badges. Commit(s): `dab04ac`.
- [x] Render a dense app logs pane with level filters, source filtering, search, mark-all-read, live tail behavior, expandable details, stack traces, and links to related sessions, threads, commands, and artifacts where available. Commit(s): `dab04ac`.
- [x] Render the app logs row list with TanStack Virtual, preserving variable-height expanded rows, stable row identity, scroll anchors, older-page loading, Live/Frozen tail behavior, and the `New logs` affordance across filtering, search, expansion, and live updates. Commit(s): `ed7e6ea88e`.
- [x] Add representative mounted/integration coverage for the app logs pane, sidebar badges, and live-update read model. Commit(s): pending local changes
