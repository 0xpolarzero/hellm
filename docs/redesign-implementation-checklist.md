# Redesign Implementation Checklist

This checklist is derived from the docs diff from
`683b9346478e8d984f2dc953978a9357dadd2f54` through the current working tree.
It is written for the implementation agent that ports the redesigned product
docs into the app.

The changed product docs are the source of truth. Treat this as an
implementation checklist, not a changelog. Every checked item should mean the
current implementation matches the referenced docs and obsolete behavior has
been deleted rather than kept as compatibility code.

## Source Diff Inventory

- [ ] Review the diff for all changed product docs outside `docs/references/smithers/**`; the product-relevant set includes `docs/prd.md`, `docs/features.ts`, `docs/progress.md`, `docs/execution-model.md`, `docs/optimizations.md`, `docs/todo.md`, `docs/draft-notes.md`, `docs/external-library-followups.md`, `docs/research/*`, `docs/specs/**`, and `docs/ui/**`.
- [ ] Treat `docs/vendor/smithers/smithers-0.22.0.llms-full.txt` as a pinned upstream input only for Smithers prompt-generation content, CLI command forms, and Smithers concept tests; do not treat it as product architecture to port wholesale.
- [ ] Treat `docs/references/smithers/**` as refreshed Smithers reference material, not as shipped `svvy` runtime architecture. Product requirements must come from the `svvy` docs; the pinned vendor `llms-full` document is only evidence for official Smithers CLI guidance content. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Delete or ignore old product assumptions from removed specs: `docs/specs/workflow-supervision.spec.md`, `docs/specs/workflow-inspector.spec.md`, `docs/specs/prompt-library.spec.md`, `docs/specs/web-tools.spec.md`, `docs/specs/execute-typescript.spec.md`, `docs/specs/prompt-contexts.spec.md`, and `docs/specs/project-ci.spec.md`.
- [ ] Delete obsolete POC/product-doc dependencies on `docs/pocs/structured-session-state.poc.ts` and `docs/pocs/workflow-library.poc.ts`.
- [ ] Keep product docs steady-state oriented: do not implement legacy bridges, migration aliases, dual schemas, compatibility paths, or backwards-compatible wrapper APIs unless a current spec explicitly requires them. Sources: root `AGENTS.md`, `docs/prd.md`.

## Product Architecture

- [ ] Keep `svvy` as an Electrobun desktop app over pi, with pi owning the interactive runtime seam, session substrate, provider loop, and backing conversations for orchestrator and handler surfaces. Sources: `docs/prd.md`.
- [ ] Keep one visible `svvy` orchestrator responsible for request interpretation, strategy, delegation decisions, reconciliation, and final user-facing decisions. Sources: `docs/prd.md`.
- [ ] Make delegated handler threads the only normal delegation unit; do not delegate directly to raw Smithers runs from the orchestrator. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Use one shared execution model for orchestrator turns, handler turns, tools, commands, waits, structured state, and UI projection. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Extend through pi runtime and extension APIs; do not introduce or preserve a standalone custom shell, readline loop, alternate TUI, or non-pi terminal loop. Sources: root `AGENTS.md`, `docs/prd.md`.
- [ ] Keep direct work, delegated work, waiting, extension loading, and tool projection on the same turn/tool/command/state pipeline. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.

## Actor Prompts And System Prompt Channel

- [ ] Compose each actor's prompt from the current generated agent context before every prompt-bearing turn. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Load composed instructions through pi's real `systemPrompt` channel. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Ignore pi prompt replacement/append files such as `.pi/SYSTEM.md` and `APPEND_SYSTEM.md` as behavior-changing prompt inputs. Sources: `docs/prd.md`, `docs/specs/ambient-agent-resources-baseline.spec.md`.
- [ ] Preserve discovered `AGENTS.md` and `CLAUDE.md` as visible read-only `external_instruction` extension records in the actual prompt path. Sources: `docs/prd.md`, `docs/specs/extension/external_instructions.extension.spec.md`.
- [ ] Send submitted user text as the real new user message for that surface, not as flattened transcript prose. Sources: `docs/prd.md`.
- [ ] Keep committed conversation history in pi session history; keep runtime, thread, episode, report-request, workflow, queue, and wait state in structured product state and targeted tools. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Render active system prompt/generated context as expandable surface metadata, not inline transcript prose. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Warn when a surface is bound to an older generated context fingerprint than current ready settings. Sources: `docs/prd.md`, `docs/specs/queued-messages.spec.md`.
- [ ] Slice generated tool declarations and SDK blocks by actor; no surface receives another actor's full callable API block for awareness only. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Support product-filtered inherited orchestrator history only for `thread_start.threads[].history: "forked"`, delivered as a context block in the handler's first prompt-bearing item, not as handler prior turns or system prompt content. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.

## Agents And Profiles

- [ ] Implement the Agents pane between Logs and Extensions. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Store app-global orchestrator profiles, the special `threadHandler` profile, workflow-agent profiles, provider/model/reasoning defaults, extension usage selections, profile metadata, and generated context previews. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Keep the default orchestrator profile locked, first, non-draggable, non-deletable, and editable for settings. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Allow users to create, duplicate, order, edit, and inline-single-confirm delete user-created orchestrator profiles. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Drive the New orchestrator picker order, profile-specific command-palette actions, and surface profile badges from Agents-pane orchestrator-profile order. Sources: `docs/prd.md`, `docs/specs/command-palette.spec.md`.
- [ ] Persist each top-level session's selected orchestrator profile, profile snapshot, and generated agent-context fingerprint at creation. Sources: `docs/prd.md`.
- [ ] Let profile-backed orchestrator sessions optionally save composer model/reasoning changes back to that profile for future sessions. Sources: `docs/prd.md`.
- [ ] Use `threadHandler` for delegated handler-thread surfaces. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Apply `thread_start.threads[].extensions` as creation-time partial overrides over `threadHandler` extension usage states. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Represent workflow-agent profiles as structured Workflows source records that generate `Agents.*` exports. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Use pi's normalized provider/model/reasoning metadata and runtime thinking controls for model and reasoning dropdowns; do not maintain svvy-owned provider special cases or freeform model/reasoning text. Sources: `docs/prd.md`.
- [ ] Use TanStack Form for complex provider, agent-profile, extension-env, and app-preference forms with validation, dirty state, reset/cancel, pending save, async errors, and backend-authoritative normalization. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Keep title-naming settings internal, seeded to `openai-codex` / `gpt-5.4-mini` with low reasoning effort, not exposed as a special Agents-pane profile. Sources: `docs/prd.md`, `docs/progress.md`.

## Extensions Model

- [ ] Implement Extensions as builtin, user, and external_instruction records with category, instruction source files, minimal available-loading hints, interface kind, generated clients, env/dependency readiness, reset/delete behavior, and read-only usage views. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Support extension usage states `default_loaded`, `available`, and `unavailable` per profile/actor, except fixed app-native controls such as Extension Loading. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Implement the exhaustive builtin extension inventory: `base-common`, `base-orchestrator`, `base-handler`, `base-workflow-task`, `shell`, `apply-patch`, `execute-typescript`, `extension-loading`, `extension-managing`, `request-user-input`, `thread-orchestration`, `thread-handling`, `cx`, `git`, `github`, `web`, `smithers`, `workflows`, `artifacts`, and external instructions. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Default-load `base-common`, Shell, Apply Patch, Execute TypeScript, Extension Loading, cx, Git, and Artifacts for orchestrators, handler threads, and workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Default-load `base-orchestrator` and `thread-orchestration` only for orchestrators. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Default-load `base-handler`, `thread-handling`, Smithers, and Workflows only for handler threads. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Default-load `base-workflow-task` only for workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Default-load GitHub for orchestrators and handler threads; make it available for workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Make Extension Managing available for orchestrators and handlers but unavailable to workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Make Request User Input default-loaded for orchestrators and handlers but unavailable to workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Make Smithers available, not default-loaded, for orchestrators; default-loaded for handlers; unavailable for workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Make Workflows available, not default-loaded, for orchestrators; default-loaded for handlers; unavailable for workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Default-load Web only when `networkAccess` is true; make it unavailable/no prompt guidance when `networkAccess` is false. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Build generated actor context from loaded base instruction extensions, loaded extension instructions, available minimal hints, external instructions, native tool declarations, loaded svvyx guidance, and generated TypeScript declarations. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Store generated context fingerprints for sessions, handler threads, and workflow task-agent attempts. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Automatically queue/apply `agent_context_refresh` work labelled `Update agent context` when an existing surface's binding fingerprint differs from current ready context. Sources: `docs/prd.md`, `docs/specs/queued-messages.spec.md`.
- [ ] On successful context refresh, record an `Agent context updated` product event with semantic details of what changed. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Keep `list_extensions` actor-local, read-only, limited to loaded and available records; do not expose unavailable details, secrets, fingerprints, cache keys, or global profile state. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Implement `load_extension` as actor-local session loading of an available ready extension, refreshing same-turn declarations/guidance/generated context without building, dependency approval, env configuration, or profile mutation. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Store user-named Extension Managing snapshots and durable generated context bindings so historical surfaces remain inspectable after restart. Sources: `docs/progress.md`, `docs/specs/extension/extension_managing.extension.spec.md`.

## Ambient Agent Resources

- [ ] Add provider-neutral Ambient Agent Resources settings for coding-agent host resources. Sources: `docs/specs/ambient-agent-resources-baseline.spec.md`, `docs/features.ts`.
- [ ] Keep behavior-changing ambient resources default-off unless explicitly enabled by host, workspace, target agent/profile configuration, category, and source. Sources: `docs/prd.md`, `docs/specs/ambient-agent-resources-baseline.spec.md`.
- [ ] Cover extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, execution policy, and runtime state as ambient resource categories. Sources: `docs/specs/ambient-agent-resources-baseline.spec.md`.
- [ ] Preserve visible external instruction files while blocking host-ambient behavior-changing resources from affecting prompts, tools, commands, UI, provider/auth behavior, or execution policy until enabled. Sources: `docs/prd.md`.
- [ ] Reflect enabled ambient callable resources only in actor-specific generated API declarations for the exact actor allowed to call them. Sources: `docs/prd.md`, `docs/specs/ambient-agent-resources-baseline.spec.md`.
- [ ] Ensure enabled prompt-affecting resources appear in generated context previews and fingerprints; enabled command resources appear in product command routing without hidden tools or invisible prompt mutation. Sources: `docs/progress.md`.

## Extension Env And Secrets

- [ ] Add app-global extension env declarations and app-managed values keyed by `(extensionId, envName)`. Sources: `docs/prd.md`, `docs/features.ts`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Let users enter, update, and remove secret values only through app-owned UI. Sources: `docs/prd.md`.
- [ ] Store secrets encrypted through the app or OS keychain. Sources: `docs/prd.md`.
- [ ] Support non-secret manifest defaults plus app-level overrides. Sources: `docs/features.ts`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Inject env values only into the specific trusted extension runtime invocation that needs them. Sources: `docs/prd.md`, `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [ ] Never expose secret values through prompts, generated docs, tool output, logs, artifacts, transcripts, global pi env, global shell env, or `execute_typescript` snippet env. Sources: `docs/prd.md`.
- [ ] Let agent-facing extension inspection report only declaration metadata and missing/configured readiness. Sources: `docs/prd.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Defer workspace-scoped extension env values and egress-proxy credential boundaries; do not implement them in v1. Sources: `docs/prd.md`, `docs/features.ts`.

## Extension Managing And `svvyx` Runtime

- [ ] Implement a stable app-owned `svvyx <extension-id> ...` dispatcher. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [ ] Resolve extension current builds through the dispatcher and import default-exported Incur CLIs. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [ ] Invoke extension CLIs through `cli.serve` with invocation-local explicit env. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [ ] Validate Incur-backed extension builds so default-exported CLIs are accepted and top-level `.serve()` usage is rejected. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Stage extension builds under `builds/.../staging/<build-run-id>/` and atomically promote successful builds to `current/`; failed builds must leave the previous current build in place. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [ ] Record `svvyx` command facts, errors, child-command links, output, progress, and UI projection through ordinary command records. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/live-tool-projection.spec.md`.
- [ ] Treat extension usage state as generated guidance/client visibility, not as shell-level impossibility to type a command. Sources: `docs/progress.md`.
- [ ] Validate extension builds for instruction source references, generated instruction fragments, CLI requirements, env declarations, TypeScript client declarations, and Incur command schemas. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Implement Extension Managing source/storage, editable manifest schema, instruction source file lifecycle, snapshots, change history, reset, delete, revert, build, usage setting, and inspection contracts. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Store app-global extension state under `~/.config/svvy/extensions/` with `sources/user`, `sources/builtin-overlays`, `generated`, `builds`, `package`, `trash`, and `snapshots`; do not implement workspace-local extensions in v1. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Treat manifest, hand-authored instructions, generator scripts, `source/`, minimal instructions, and shared `package.json` as editable extension files. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Treat generated instructions, generated types, aggregate outputs, builds, lockfiles, `node_modules`, trash, and snapshots as non-editable generated or internal extension files. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Support manifest fields for `interface: "instructions" | "svvyx"`, exact dependencies, trusted dependencies, env declarations, CLI requirements, instruction-file bypass config, generated instruction declarations, and `typescriptApiEnabled: true` only for `svvyx`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Order full instruction Markdown files lexicographically; bypassed files remain visible and generated but are skipped in loaded prompt concatenation. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Represent minimal instructions as single loading hints for available extensions. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Implement generated aggregate cache storage with `index.sqlite`, blob manifests, cache-key inputs, validation/regeneration, safe deletion, 256 MiB default budget, 30-day unused eligibility, and LRU eviction. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Implement `svvyx extensions inspect <id> --json` with metadata, paths, global usage, env/CLI/dependency readiness, and coarse build state/issues. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Keep `inspect` output free of commandDocs/toolSchemas paths, fingerprints, aggregate keys, secret metadata, external auth detail, remote reachability probes, and secret values. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Implement `svvyx extensions create` only for user extension skeletons with `instructions` or `svvyx` interfaces; reject `native_tool` and reserved builtin/control namespaces. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Have `create` produce neutral instruction files and an Incur source skeleton with default export and no top-level `serve`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Implement instruction lifecycle commands `instructions add`, `rename`, `remove`, `reorder`, and `configure` to manage files/config only, not body text. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Validate instruction lifecycle basenames, collisions, ordering, and bypass booleans; record reversible changes and set `buildRequired`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Split extension build result into `contextReady` and `runtimeReady`; missing required env may keep `contextReady: true` while producing `runtimeReady: false`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Make missing, wrong-version, or unknown required CLI status fail build before dependency installation and generator scripts. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Keep dependency approval separate from shell approval, with exact dependency/trusted-dependency identities, an approval ledger, exact versions only, no Bun default trusted allowlist, and lifecycle scripts disabled unless that trusted identity is approved. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Make `set-usage` mutate persistent agent-profile extension usage, queue context refresh for affected sessions, and never directly mutate the caller's current binding. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Make Extension Loading fixed and not user-changeable through `set-usage`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Implement `reset`, `delete`, `revert`, and snapshots with reversible product-state and file behavior. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Keep snapshots local-only; exclude raw secret values, raw key paths, `node_modules`, builds, generated caches, and generated outputs from snapshots; loading a snapshot must trigger normal build and approval flows. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Keep generated extension clients behind `extensions["<id>"].run(commandId, input)`; dot access only for identifier-safe ids. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [ ] Generate `@svvy/extensions` as part of Extension build before Workflows build consumes extension references. Sources: `docs/specs/extensions-and-tools.spec.md`, `docs/specs/workflow-library.spec.md`.

## CLI Requirements

- [ ] Let extensions declare required shell CLIs with binary name, optional exact version, optional version-check command, and optional reusable install-command template. Sources: `docs/features.ts`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Report missing, wrong-version, unknown, and available status through Extension Managing inspect/build. Sources: `docs/features.ts`.
- [ ] Fail build with ordinary structured errors when a required CLI is missing, wrong-version, or unknown. Sources: `docs/features.ts`.
- [ ] Keep CLI installation as ordinary `exec_command` work under sandbox, network, approval-mode, and auto-review policy. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Pin exact CLI requirements for `cx-cli@0.7.1`, `smithers-orchestrator@0.22.0`, and `@tiny-fish/cli@0.1.6`; keep Git and GitHub CLI unversioned. Sources: `docs/features.ts`, `docs/specs/extension/cx.extension.spec.md`, `docs/specs/extension/web.extension.spec.md`, `docs/specs/extension/smithers.extension.spec.md`.

## Direct Tools, Shell, Apply Patch, And Sandbox

- [ ] Keep Shell, Apply Patch, and Execute TypeScript as default coding-agent work interfaces. Sources: `docs/prd.md`, `docs/specs/extension/shell.extension.spec.md`, `docs/specs/extension/apply_patch.extension.spec.md`.
- [ ] Expose `exec_command`, `write_stdin`, and `apply_patch` as the normal native direct tools. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Treat `svvyx ...` commands and prompt-only CLI usage such as Smithers/TinyFish/cx as ordinary `exec_command` command-family work. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
- [ ] Split Shell loaded instructions into base command execution guidance plus separate Incur-backed `svvyx` CLI usage guidance. Sources: `docs/prd.md`, `docs/specs/extension/shell.extension.spec.md`.
- [ ] Split Execute TypeScript loaded instructions into base TypeScript execution guidance plus separate Incur generated-client usage guidance. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Implement Codex-like approval modes: `auto-review`, `user`, and `full-access`. Sources: `docs/prd.md`.
- [ ] Enforce approval boundary decisions in runtime for `exec_command`, `svvyx ...`, `apply_patch`, and top-level `execute_typescript`; do not rely on model memory. Sources: `docs/prd.md`.
- [ ] In `full-access`, disable the approval boundary and managed filesystem sandbox. Sources: `docs/prd.md`.
- [ ] Default `networkAccess` to true and restrict network plus disable Web extension when false. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Package macOS sandboxing through `/usr/bin/sandbox-exec` plus a Codex-derived native sandbox helper. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Preserve Codex filesystem policy semantics: `Read`, `Write`, and `None`; most-specific path precedence; writable roots with read-only subpaths; protected metadata carveouts; fail-closed behavior. Sources: `docs/progress.md`, `docs/research/agent-sandboxing.research.md`.
- [ ] Grant the active session artifact directory as writable while making that session's `immutable/` child read-only; do not grant broad artifact-root or other-session artifact writes. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Keep extension package dependency installation as explicit user-confirmation because it can download and execute third-party code. Sources: `docs/prd.md`.

## Execute TypeScript

- [ ] Replace old `docs/specs/execute-typescript.spec.md` assumptions with `docs/specs/extension/execute_typescript.extension.spec.md`. Sources: docs diff.
- [ ] Expose no global `svvy` client and no injected broad `api` helper in snippets. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Expose actor-specific `extensions` containing only loaded TypeScript-enabled `svvyx` clients callable by the current actor. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Generate declarations only for loaded clients and those extensions' command map types. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Support `extensions["<id>"].run(commandId, input)` and dot access for identifier-safe ids. Sources: `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Make `incur/client` importable for public Incur types and `Client.ClientError`. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Keep `MemoryClient`, local Incur actions, and broad internal client APIs out of agent-authored snippets. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Keep the default orchestrator Execute TypeScript extension set free of Workflows generated clients, Smithers runtime control, and any `workflow`/`smithers` namespace. Sources: `docs/prd.md`.
- [ ] Keep workflow task-agent Execute TypeScript clients limited to task-local loaded extensions; no Workflows source-library, Smithers runtime, handler, or orchestrator controls by default. Sources: `docs/prd.md`.
- [ ] Persist every submitted snippet attempt as a file-backed artifact before execution. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Compile or typecheck every snippet before execution and block invalid snippets with structured diagnostics. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Route top-level `execute_typescript` through the same approval-boundary path as approval-gated native actions before running arbitrary TypeScript. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Record generated extension-client calls inside approved snippets as child commands with readiness, env injection, redaction, product-state validation, and failure semantics. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Keep the top-level `execute_typescript` attempt as the parent semantic unit and roll child facts under it. Sources: `docs/features.ts`, `docs/specs/live-tool-projection.spec.md`.
- [ ] Render streamed source, persisted artifact, diagnostics, nested child commands, runtime progress, and final parent command facts through shared live tool projection. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
- [ ] Keep cx out of generated Execute TypeScript clients; do not expose `api.cx_*` or `extensions.cx.*`. Sources: `docs/progress.md`, `docs/specs/extension/cx.extension.spec.md`.

## Live Tool Projection And Command State

- [ ] Use Codex-like turn items for all tools: show a tool card as soon as tool name is known. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
- [ ] Stream large/freeform argument snapshots before runtime execution. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
- [ ] Render `apply_patch` as structured file-change snapshots with patch facts, not as transcript-only text or many tiny tool calls. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Stream `exec_command` output deltas and runtime progress through durable command events. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Render `execute_typescript` generated-client calls as nested child commands under the parent. Sources: `docs/specs/live-tool-projection.spec.md`.
- [ ] Project native control tools through the same live tool model, including streamed objective/report/question arguments and authoritative final runtime facts. Sources: `docs/prd.md`.
- [ ] Persist command records for every tool call with workspace/session/surface/thread ownership, status, arguments snapshot or artifact, output/progress events, final facts, linked artifacts, timestamps, and optional parent command id. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Recover renderer tool projection after reload from durable command events and final facts. Sources: `docs/progress.md`, `docs/specs/live-tool-projection.spec.md`.
- [ ] Avoid a workflow-specific renderer or recovery path; Smithers and Workflows CLI calls are command-family projections. Sources: `docs/progress.md`, `docs/specs/live-tool-projection.spec.md`.

## Artifacts

- [ ] Store artifacts in the configured artifact directory, defaulting to `~/.config/svvy/artifacts`. Sources: `docs/prd.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Store mutable artifacts under `<artifactDir>/<sessionId>/` and immutable artifacts under `<artifactDir>/<sessionId>/immutable/`. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Persist artifact metadata with id, owning session, optional thread, optional command, stored path, exact stored filename, MIME type, byte size, digest, immutable flag, and created/deleted lifecycle fields. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Do not depend on transcript parsing or OS-level file flags for artifact identity or immutability. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Treat artifacts as durable session files for outputs worth preserving, not normal project source. Sources: `docs/prd.md`.
- [ ] Implement the builtin Artifacts `svvyx` extension with `create`, `inspect`, `list`, `open`, and `delete`. Sources: `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Support empty artifact creation with exact `--name <filename.ext>`. Sources: `docs/features.ts`, `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Support copy creation with `--path`, optional exact `--name`, and `--immutable`. Sources: `docs/features.ts`, `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Enforce extension-required basename validation and collision rejection. Sources: `docs/progress.md`.
- [ ] Do not implement `--kind`, implicit extension inference, inline content creation, or OS file-flag immutability for artifacts. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [ ] Render artifact inspector panes keyed by durable artifact identity and isolated sandboxed previews for HTML artifacts. Sources: `docs/features.ts`, `docs/specs/workspace-navigation-core-projection.spec.md`.

## Request User Input

- [ ] Implement Request User Input as a builtin native dual-variant extension for orchestrator and handler clarification. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Expose one `request_user_input` tool whose active blocking/nonblocking variant controls loaded instructions, schema descriptions, and runtime behavior. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Require agent-authored question titles and one to three questions. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] For choice questions, require two to three mutually exclusive options with exactly one recommended option. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Support freeform questions with a default answer. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Generate request, question, and option ids internally; keep internal ids out of tool results where prohibited. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Show answerable questions in a side panel. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Default to nonblocking behavior that immediately returns the recommended/default answer and later queues user answers as highest-priority durable queue work. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Support blocking behavior with a default-enabled five-minute timeout that falls back to the default answer. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Keep request-user-input tool results free of mode, timer, UI availability, and internal id fields. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Persist request/wait records and restore pending clarification state after restart. Sources: `docs/specs/structured-session-state.spec.md`, `docs/progress.md`.

## Thread Orchestration And Handler Threads

- [ ] Expose one shared native thread-control implementation as `thread-orchestration` for orchestrators and `thread-handling` for handlers. Sources: `docs/features.ts`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Give orchestrators `thread_start`, `thread_followup`, `thread_list`, `thread_episodes`, and `thread_request_report`. Sources: `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Give handlers `thread_current`, `thread_group`, `thread_report`, and `thread_episodes`. Sources: `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Give workflow task agents no thread-control extension by default. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [ ] Make `thread_start` take required `threads[]`, normally with one item. Sources: `docs/features.ts`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Make `thread_start` create or append to one durable `threadGroupId`, returned at top level and not repeated on each thread row. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Default `thread_start.threads[].history` to `isolated`. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.
- [ ] Allow `history: "forked"` only for explicit current-context/forking/continuity cases where compact objective text or durable files would be lossy. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.
- [ ] Do not use `forked` for ordinary implementation, source-driven research, test fixing, code review, security review, independent critique, verification, durable-file-specified tasks, or stale/speculative transcript contexts. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.
- [ ] Allow multiple `threads[]` only for separate user-visible handler conversations with independent direct follow-up needs. Sources: `docs/prd.md`.
- [ ] Persist handler thread records with thread id, group id, workspace session id, surface pi session id, title, objective, history mode, objective state, worktree context, generated context binding, loaded/available extension ids, report requests, latest episode summary, and timestamps. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Keep handler objective state separate from handler activity, workflow activity, waits, repair context, and raw Smithers runtime state. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Let handler threads receive direct user messages like orchestrator surfaces. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Let handler threads wait, resume, rerun, clarify, and repair internally instead of bouncing through the orchestrator by default. Sources: `docs/prd.md`.
- [ ] Let `thread_followup` send corrections, clarifications, or later instructions to exact `threadIds` or one `threadGroupId`. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Implement `thread_followup({ activate: true })` to reactivate concluded objectives when the context is right; active targets receiving the same follow-up keep their current objective. Sources: `docs/prd.md`.
- [ ] Implement `thread_request_report` for one-handler update requests without changing that handler objective. Sources: `docs/prd.md`.
- [ ] Implement `thread_group` as topology and addressing only, not shared memory or peer messaging. Sources: `docs/prd.md`.
- [ ] Implement `thread_report` without `outcome` as an intermediate update episode. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Implement `thread_report` with `outcome` as a conclusion episode that marks the current objective concluded. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] After every durable episode, queue a typed orchestrator reconciliation notification; dismissal must not roll back the episode or return a handler tool error. Sources: `docs/prd.md`, `docs/specs/queued-messages.spec.md`.
- [ ] Keep ordinary handler replies, tool calls, command summaries, and artifacts out of episodes unless `thread_report` creates one. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Keep handler surfaces open after conclusion for inspection, direct follow-up chat, and explicit reactivation. Sources: `docs/prd.md`.
- [ ] Generate handler-thread titles with the same internal namer flow from the delegated objective; do not accept an orchestrator-supplied title field. Sources: `docs/prd.md`, `docs/progress.md`.

## Smithers Boundary

- [ ] Keep Smithers as the workflow runtime and authoring model used directly through the official Smithers CLI. Sources: `docs/prd.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Make Smithers a builtin prompt-only extension for handler-thread workflow authoring. Sources: `docs/features.ts`, `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Add no native Smithers tools, no generated Smithers TypeScript clients, and no product workflow wrapper tools. Sources: `docs/prd.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Preserve the official Smithers command form in generated prompt guidance as `bunx smithers-orchestrator ...`, including `init`, `workflow run`, `ps`, and `inspect`; do not document global installs or bare `smithers` as the svvy contract. Sources: `docs/specs/extension/smithers.extension.spec.md`, `docs/vendor/smithers/smithers-0.22.0.llms-full.txt`.
- [ ] Generate Smithers instruction content from pinned official Smithers documentation plus the bounded svvy appendix. Sources: `docs/specs/extension/smithers.extension.spec.md`, `docs/vendor/smithers/smithers-0.22.0.llms-full.txt`.
- [ ] Exclude GUI, Gateway, MCP, HTTP server, OpenTelemetry, DevTools, event-streaming, OpenAPI, Effect, and wrapper-oriented fragments not current svvy surfaces from generated Smithers prompt guidance. Sources: `docs/progress.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Keep official Smithers concepts in guidance where relevant: `.smithers/`, JSX authoring, official CLI approvals/resume, stable task ids, outputs, schemas, and render-loop behavior. Sources: `docs/specs/extension/smithers.extension.spec.md`, `docs/vendor/smithers/smithers-0.22.0.llms-full.txt`.
- [ ] Keep Smithers memory fragment generated but bypassed by default. Sources: `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Teach handler agents to author and run workflows under workspace `.smithers/` using official CLI commands through Shell. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Teach agents to import reusable svvy values from `@svvy/workflows`. Sources: `docs/prd.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Keep repo-root `workflows/` as a source-checkout authoring workspace for maintaining `svvy`, not shipped product runtime, workflow registry, or packaged-app integration path. Sources: root `AGENTS.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Ensure shipped Smithers integration works without a source checkout or repo-local authoring assets. Sources: root `AGENTS.md`, `docs/prd.md`.

## Workflows Source Library And Extension

- [ ] Implement app-global reusable source under `~/.config/svvy/workflows/agents`, `prompts`, `components`, and `workflows`. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Store generated output under `~/.config/svvy/workflows/generated/package/`. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Keep `generated/` outside the safe writable boundary; reject ordinary agent direct edits to generated package files and workspace links. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Use workspace `.smithers/` as the only workspace workflow source location. Sources: root `AGENTS.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Generate package `@svvy/workflows` with exactly four root namespace exports: `Agents`, `Components`, `Prompts`, and `Workflows`. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Put `Agents.defineTaskAgent`, type `Agents.TaskAgentParameters`, and generated task-agent parameter exports under `Agents.*`; do not export reusable values as flat root symbols. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Generate group indexes mechanically from source files so exportable runtime values are not missed by manual curation. Sources: `docs/specs/workflow-library.spec.md`.
- [ ] Idempotently link generated `@svvy/workflows` into `<workspace>/.smithers/node_modules/@svvy/workflows` on workspace open/prepare and after build. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Also link generated `@svvy/extensions` into `.smithers/node_modules` when workflow source imports extension objects. Sources: `docs/specs/workflow-library.spec.md`.
- [ ] Do not rely on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or source-checkout-relative package paths. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Implement Workflows as the only app-owned command surface for reusable source-library operations. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [ ] Implement `svvyx workflows list [--kind agent|prompt|component|workflow] --json`. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [ ] Make `list` return mechanically available export identity and source/generated paths only; do not infer titles, summaries, usefulness, recommendations, or stale diagnostics. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Implement `svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json`. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [ ] Make `save` reject overwrites unless `--overwrite` is present and run the full build pipeline after success. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] For `--kind agent`, statically extract `Agents.defineTaskAgent(...)` or resolvable `defineTaskAgent(...)` parameter literals without executing arbitrary TypeScript; reject dynamic inputs with structured diagnostics. Sources: `docs/progress.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Implement `svvyx workflows build --json` to build Extensions, generate/refresh `@svvy/extensions`, validate Workflows source, validate workflow-agent provider/model/reasoning and extension references, generate `@svvy/workflows`, and refresh workspace package links. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [ ] Implement `svvyx workflows models list --json` from pi-normalized provider/model/reasoning/auth metadata, with no live completion request by default. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [ ] Fail build explicitly when task-agent parameter records name unavailable provider/model/reasoning combinations or extension references; do not silently clamp, rewrite, or defer to runtime. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Do not implement Workflows `install`, `retrieve`, `promote`, kind-specific list subcommands, workflow run/resume/approve/inspect/debug controls, or product workflow wrapper commands. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Attach generated export metadata only internally for UI links; do not expose public metadata fields, `__exports`, public declarations, or changed agent import usage. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.

## Workflows Pane

- [ ] Render Workflows as a read-only Dockview static pane showing latest successful generated `@svvy/workflows`. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`, `docs/specs/pane-layout.spec.md`.
- [ ] Show `Agents`, `Components`, `Prompts`, and `Workflows` exports with kind, namespace, export name, qualified name, read-only generated code, generated-file link, and source-file link. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] For `Agents.*`, show the generated task-agent parameter object and a primary human action to open the corresponding Agents-pane record. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Refresh the pane after successful `svvyx workflows build` and after Agents-pane edits that trigger a build. Sources: `docs/progress.md`.
- [ ] Keep Workflows pane free of inferred titles/summaries, source editing, delete actions, validation claims beyond build output, and workflow-running controls. Sources: `docs/progress.md`, `docs/specs/workflow-library.spec.md`.

## Web, cx, Git, And GitHub Prompt-Only Extensions

- [ ] Replace old `docs/specs/web-tools.spec.md` behavior with prompt-only TinyFish CLI guidance. Sources: docs diff, `docs/specs/extension/web.extension.spec.md`.
- [ ] Vendor TinyFish-owned `use-tinyfish` instructions as the Web extension core prompt content. Sources: `docs/progress.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Generate Web instruction content from exact `@tiny-fish/cli@0.1.6` package artifacts; do not fetch mutable TinyFish skill URLs as generated source. Sources: `docs/specs/extension/web.extension.spec.md`.
- [ ] Require TinyFish CLI binary `tinyfish`, Node `>=24`, and install template `npm install -g @tiny-fish/cli@{{version}}`. Sources: `docs/specs/extension/web.extension.spec.md`.
- [ ] Make TinyFish missing/wrong/unknown CLI status fail build but not add native/generated Web surfaces. Sources: `docs/specs/extension/web.extension.spec.md`.
- [ ] Add only a bounded svvy appendix for ordinary shell usage, redirecting large TinyFish JSON stdout to files, untrusted external content, and source URL citation. Sources: `docs/progress.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Teach `tinyfish auth`, `tinyfish search query`, `tinyfish fetch content get`, and TinyFish agent/browser commands as ordinary shell commands. Sources: `docs/specs/extension/web.extension.spec.md`.
- [ ] Do not add `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript clients, Web Provider settings, provider selection, Firecrawl, TinyFish SDK provider adapters, or svvy-owned TinyFish key storage. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Remove any old `src/bun/web-runtime` provider registry/tool runtime assumptions if present in implementation. Sources: `docs/specs/extension/web.extension.spec.md`.
- [ ] Let TinyFish own CLI install, auth, search, fetch, browser-backed commands, stdout/stderr behavior, and API key storage through TinyFish CLI commands. Sources: `docs/features.ts`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Treat TinyFish JSON stdout and redirected files as raw CLI output, not svvy artifacts by default. Sources: `docs/progress.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Implement cx as prompt-only official CLI guidance with no native `cx_*` tools, no `svvyx cx`, and no generated clients. Sources: `docs/prd.md`, `docs/specs/extension/cx.extension.spec.md`.
- [ ] Require exact `cx-cli@0.7.1` with install template `cargo install cx-cli --version {{version}}`. Sources: `docs/specs/extension/cx.extension.spec.md`.
- [ ] Generate cx instructions from the crates.io `cx-cli-0.7.1` artifact by extracting `src/skill.md` byte-for-byte and validating package identity, checksum, markers, and yanked status. Sources: `docs/specs/extension/cx.extension.spec.md`.
- [ ] Do not use latest cx docs, GitHub, default local binary output, or local installed binary output as the primary generated cx source. Sources: `docs/specs/extension/cx.extension.spec.md`.
- [ ] Teach the code inspection ladder `cx overview -> cx symbols -> cx definition / cx references -> exec_command with rg/sed/cat/ls/find`. Sources: `docs/prd.md`, `docs/specs/extension/cx.extension.spec.md`.
- [ ] Implement Git and GitHub as prompt-only CLI guidance; no wrapper tools unless a current extension spec defines them. Sources: `docs/specs/extension/git.extension.spec.md`, `docs/specs/extension/github.extension.spec.md`.
- [ ] Keep Git CLI requirements unpinned and default-loaded for all actors. Sources: `docs/specs/extension/git.extension.spec.md`.
- [ ] Keep GitHub prompt-only guidance default-loaded for orchestrators/handlers and available for workflow task agents, with unpinned `git` and `gh` requirements. Sources: `docs/specs/extension/github.extension.spec.md`.

## Snippets Prompt Macros

- [ ] Add product-owned Snippets as explicit user-inserted prompt macros, not host runtime prompt-template or slash-command expansion. Sources: `docs/features.ts`, `docs/specs/snippets.spec.md`.
- [ ] Replace old Prompt Library/Context Library implementation with Agents/Extensions generated context plus separate Snippets. Sources: removed `docs/specs/prompt-library.spec.md`, `docs/specs/snippets.spec.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Add a Snippets pane with managed snippets, read-only discovered Markdown snippets, source badges, previews, external-editor actions, and managed create/edit/rename/delete controls. Sources: `docs/progress.md`, `docs/specs/snippets.spec.md`.
- [ ] Discover Claude command snippets recursively from `~/.claude/commands/**/*.md` and workspace `.claude/commands/**/*.md`. Sources: `docs/specs/snippets.spec.md`.
- [ ] Discover pi prompt-template snippets non-recursively from `~/.pi/agent/prompts/*.md` and workspace `.pi/prompts/*.md`. Sources: `docs/specs/snippets.spec.md`.
- [ ] Do not discover Codex skills/plugins as Snippets. Sources: `docs/specs/snippets.spec.md`.
- [ ] Support snippet Markdown plus `description` and `argument-hint`; ignore behavior-changing metadata. Sources: `docs/specs/snippets.spec.md`.
- [ ] Substitute only supported positional/arguments placeholders and never execute host commands during snippet expansion. Sources: `docs/specs/snippets.spec.md`.
- [ ] Add composer `@` picker Snippet results with argument fields, mention chips, explicit expand-to-text behavior, and clean prompt-text expansion before sending to pi. Sources: `docs/progress.md`, `docs/specs/snippets.spec.md`.
- [ ] Mix files, folders, and Snippets in one composer `@` picker while preserving their distinct semantics. Sources: `docs/specs/snippets.spec.md`.
- [ ] Persist sent Snippet provenance in product metadata while keeping the agent-facing message ordinary prompt text. Sources: `docs/progress.md`, `docs/specs/snippets.spec.md`.
- [ ] Render Snippet provenance as product metadata/transcript chips while sending only clean expanded inline text to pi. Sources: `docs/specs/snippets.spec.md`.
- [ ] For pi-backed actors, disable host prompt-template/slash expansion via the available pi controls such as `noPromptTemplates`, empty paths, override empty prompts, or disabled submit expansion. Sources: `docs/specs/snippets.spec.md`.
- [ ] Keep pi, Claude, Codex, plugin, MCP, and host slash-command expansion disabled so Snippets never grant tools, alter generated context, mount commands, or change execution policy. Sources: `docs/features.ts`, `docs/specs/snippets.spec.md`.

## Structured Session State

- [ ] Persist a workspace-scoped svvy product state layer above pi transcript state. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Model workspace sessions, live surface bindings, turns, commands, thread groups, handler threads, request-user-input records, surface queue items, episodes, artifacts, generated context bindings, saved Workflows metadata, waits, and lifecycle events as first-class records. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Keep `workspaceSessionId`, `surfacePiSessionId`, `threadId`, and `panelId` distinct and explicit in APIs; do not overload `session.id`. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Persist a top-level turn decision for every orchestrator and handler surface turn. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Use current `TurnDecision` values: `pending`, `reply`, `exec_command`, `write_stdin`, `apply_patch`, `execute_typescript`, `list_extensions`, `load_extension`, `thread_start`, `thread_followup`, `thread_request_report`, `thread_group`, `thread_report`, `thread_episodes`, and `request_user_input`. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Represent Smithers CLI usage and `svvyx workflows ...` shell usage as `exec_command`. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Represent Workflows generated-client usage as generated extension-client child commands when loaded in Execute TypeScript. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Store saved Workflows generated metadata for kind, namespace, export name, qualified name, source path, generated path, and UI-only link metadata. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Keep saved Workflows metadata internal and absent from generated import examples or public declarations. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Derive session navigation summaries, handler summaries, command summaries, artifact links, episode lists, Workflows export lists, wait indicators, and unread indicators from structured state. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Do not repair lifecycle state from transcript replay, ad hoc refresh loops, renderer polling, Smithers bridge lifecycle projection, or workspace-local workflow wrapper state. Sources: `docs/specs/structured-session-state.spec.md`.
- [ ] Keep Dockview layout state, panel focus, and panel-to-surface bindings out of structured session state. Sources: `docs/specs/structured-session-state.spec.md`, `docs/specs/pane-layout.spec.md`.

## Queued Surface Messages

- [ ] Persist durable surface queue items as structured state keyed by `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`, kind, and FIFO position. Sources: `docs/specs/queued-messages.spec.md`, `docs/progress.md`.
- [ ] Queue ownership must be by `surfacePiSessionId`, not focused panel, active workspace tab, or parent session row. Sources: `docs/specs/queued-messages.spec.md`.
- [ ] Support queue item kinds `user_message`, `agent_context_refresh`, `initial_handler_start`, `thread_followup`, `report_request`, `thread_report_notification`, and `request_user_input_answer`. Sources: `docs/specs/queued-messages.spec.md`.
- [ ] If a surface is idle, atomically claim the next item before renderer-visible queued state appears so the first visible state is pending or active work. Sources: `docs/specs/queued-messages.spec.md`.
- [ ] If a surface is active, keep prompt-bearing work queued until the prompt lock releases. Sources: `docs/specs/queued-messages.spec.md`.
- [ ] Deliver queued work as the next real pi user/control message for the same `surfacePiSessionId`, creating a normal turn and never steering an active turn or starting a concurrent turn. Sources: `docs/specs/queued-messages.spec.md`.
- [ ] Write prompt history once at queue time for user messages. Sources: `docs/features.ts`, `docs/specs/queued-messages.spec.md`.
- [ ] Let queued user messages be removed, restored to composer, or reordered before delivery; keep drag reorder previews local until drop and persist only final changes. Sources: `docs/progress.md`.
- [ ] Project blocked queue items near the owning surface composer with count, order, remove, restore-to-composer, delivery failure, and duplicated-panel consistency. Sources: `docs/progress.md`.
- [ ] Implement row-level `Steer` as durable promotion to the front for the next safe delivery boundary, not direct pi steering prompt injection. Sources: `docs/features.ts`.
- [ ] Keep active-surface follow-ups visible as editable queued rows until claimed. Sources: `docs/features.ts`.
- [ ] Recover queued work after restart through durable queue state and transactional claims, not renderer state, transcript parsing, or focused panel identity. Sources: `docs/specs/queued-messages.spec.md`.
- [ ] Let committed user transcript messages be copied or edited/resubmitted, with visible selected-message highlight and draft-replacement warning. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Resend edited committed user messages by moving the same pi surface back to the original message's parent state before continuing from the edited message. Sources: `docs/features.ts`, `docs/progress.md`.

## Workspace Runtime, Tabs, And Default Workspace

- [ ] Use one backend workspace runtime per canonical cwd, with explicit `workspaceId` routing for every workspace-scoped request and sync event. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Keep app-global auth/preferences outside workspace recovery and workspace routing. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [ ] Keep workspace tabs as chrome selectors for `workspaceId` and active layout id, not durable layout owners. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Use stable `workspaceTabId` separate from `workspaceId`. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Allow duplicate same-cwd tabs as separate visual tabs sharing one backend runtime, session catalog, pi sessions, structured state, queues, handler threads, app logs, Workflows metadata, and fixed layout slots. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Restore workspace tabs in durable user-defined order, left-aligned, horizontally scrollable when crowded, and draggable for reorder. Sources: `docs/prd.md`.
- [ ] Render compact workspace-tab controls and status badges for running, unread, waiting, and error counts only when above zero, in stable order, with hover context. Sources: `docs/prd.md`.
- [ ] On startup, restore persisted user workspace tabs; if none restore, create one real svvy-owned default workspace tab. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Store default workspace root under app-managed support data, e.g. `<svvy app data dir>/default-workspace`; create on demand and keep stable across restart. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Do not require default workspace to be a git repo, run repository discovery upward from it, place it under repo-root `workflows/`, or treat it as user source. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Give default workspace metadata `kind: "default"` and label `Default Workspace`; keep `Open Workspace` as panel/action name, not workspace label. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Initialize every new default workspace tab with exactly one `Open Workspace` pane. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Make default workspace tabs ephemeral for layout slots; no durable A/B/C layout persistence for default tabs. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Support default workspace sessions, command palette, Context/Logs/Agents/Extensions/Settings, app logs, provider settings, prompt history, artifacts, and read-only app-global Workflows visibility. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Do not fabricate workspace-local Smithers source or runnable Workflows entries in the default workspace. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Implement `Open Workspace` as a normal Dockview workbench panel, not a modal-only or full-app empty page. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] `Open Workspace` retargets the current visual tab to the selected user workspace; preserve tab id/order, acquire runtime, load active layout slot, focus tab, and persist state. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] `New Tab` creates another default workspace tab with exactly one `Open Workspace` pane and no durable layout slots. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] `Open Workspace in New Tab` creates a selected user workspace tab from the picker. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Implement app menu/shortcut actions `workspace.open`, `workspace.newTab`, and `workspace.openInNewTab`. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Bind default workspace shortcuts through the shortcut registry/app-menu path: `Cmd+O` for Open Workspace, `Cmd+T` for New Tab, and `Cmd+Shift+O` for Open Workspace in New Tab. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Resolve the old Context shortcut conflict by using the current command-palette sidebar order: `Cmd+Shift+1` Logs, `Cmd+Shift+2` Agents, `Cmd+Shift+3` Extensions, `Cmd+Shift+4` Workflows; do not keep `Cmd+Shift+3` as Context. Sources: `docs/specs/command-palette.spec.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Implement runtime registry operations `openWorkspace`, `acquireWorkspace`, `releaseWorkspace`, and `getDefaultWorkspace`; duplicate visual tabs share one canonical-cwd runtime. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Implement Open Workspace RPC input with `{ cwd?, workspaceTabId?, placement? }`; Bun resolves/canonicalizes/acquires the runtime while the renderer owns visual placement and persistence. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Retargeting, closing, or opening workspace tabs must not cancel running prompts or handler threads in prior/other runtimes; keep background runtimes while work or tabs reference them. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Persist known/recent workspaces for user workspaces only; exclude the default workspace from recents. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Restore failed user workspace tabs as default tabs with one `Open Workspace` pane plus inline restore error; do not block app startup because one tab failed. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Replacing a default workspace tab must not delete default workspace sessions or logs. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Add sidebar footer branch display with branch icon for git repos and a compact local-branch switcher through workspace-scoped Bun RPC; fall back to workspace label when not on a branch/git repo. Sources: `docs/prd.md`, `docs/features.ts`.

## Dockview Pane Layout And Surfaces

- [ ] Add `dockview-core` as the workspace layout engine and mount one Dockview workbench instance in the Svelte renderer. Sources: `docs/progress.md`, `docs/specs/pane-layout.spec.md`.
- [ ] Build Svelte adapters for Dockview content, tabs, header actions, context menus, tab-group chips, watermark, and unavailable-surface panels. Sources: `docs/progress.md`.
- [ ] Support bindable surface kinds: orchestrator, handler-thread, artifact inspector, command inspector, Logs, Agents, Extensions, Workflows, Settings, and Open Workspace. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Persist Dockview serialized layout plus svvy panel metadata, panel-to-surface bindings, focused panel, panel-local scroll/display preferences, restore state, and minimum panel policy. Sources: `docs/progress.md`, `docs/specs/pane-layout.spec.md`.
- [ ] Add fixed user workspace layout slots `A`, `B`, and `C` keyed by `(workspaceId, layoutId)`, pinned at the far right of workspace chrome. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.
- [ ] Make empty layout slots muted but selectable, not disabled. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Autosave selected user workspace layout slot after meaningful pane changes. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.
- [ ] Keep panel-to-surface bindings separate from live surface runtime state. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Support split, resize, close, tab placement, panel/group drag placement, root-edge placement, edge groups, floating groups, and popouts through svvy placement commands. Sources: `docs/progress.md`, `docs/specs/pane-layout.spec.md`.
- [ ] Configure Dockview drag/drop overlays and `dndEdges`, with product policy through Dockview drop/overlay hooks. Sources: `docs/progress.md`.
- [ ] Manage explicit open and close semantics for live surfaces independently from panel focus. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Allow the same interactive surface to be opened in multiple panels while sharing one live controller and keeping panel-local scroll independent. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.
- [ ] Closing a panel detaches it; it must not delete durable sessions, threads, commands, artifacts, or Workflows source state. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Restore Dockview layout, panel bindings, focused panel, panel-local state, static pane targets, edge/floating/popout state, and display preferences after restart. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Exclude transient menus, selections, and stale live stream state from restore. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Show exact panel-location indicators in the sidebar for open surfaces, including tab, edge-group, floating, and popout locations. Sources: `docs/progress.md`.
- [ ] Show focused Dockview panel surface highlighting. Sources: `docs/progress.md`.

## Live Surface Runtime

- [ ] Manage each interactive pi surface as a live runtime object keyed by `surfacePiSessionId`. Sources: `docs/prd.md`.
- [ ] Store live transcript snapshot, streaming state, provider/model/reasoning settings, resolved system prompt, prompt execution context, one prompt lock, and surface queue manager on the live runtime. Sources: `docs/prd.md`.
- [ ] Keep live surface runtime separate from durable workspace state and Dockview layout state. Sources: `docs/prd.md`.
- [ ] Let surfaces continue streaming with zero, one, or many attached panels. Sources: `docs/prd.md`.
- [ ] Let a panel opened mid-stream render committed transcript, pending user message, and current assistant stream from the surface snapshot. Sources: `docs/prd.md`.
- [ ] Keep panel-local scroll independent across duplicated views of the same surface. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.

## Session Navigation, Titles, Unread, And Sidebar

- [ ] Keep each top-level session container as one orchestrator-led line of work containing one orchestrator surface, zero or more handler surfaces, and durable state. Sources: `docs/prd.md`.
- [ ] Render fixed sidebar groups Pinned, Sessions, and Archived between orchestrator actions and reference panes. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Make each group collapsible, independently scrollable, vertically resizable, and persisted per workspace. Sources: `docs/prd.md`.
- [ ] Keep Archived collapsed by default and the only archive-style grouping. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Do not implement arbitrary user-created session folders. Sources: `docs/prd.md`.
- [ ] Make archive hide a session from active lists without deleting pi data, structured state, artifacts, threads, or episodes. Sources: `docs/prd.md`.
- [ ] Track durable session-level unread state when assistant turns finish outside the focused pane surface. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Render unread as a small dot in place of session timestamp and clear it when a pane for that session receives focus or explicit mark-read action runs. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Provide context-menu actions for mark read/unread, pin/unpin, rename, archive/unarchive, and menu-local Confirm delete. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Keep normal session-row clicks opening in the focused Dockview panel and Cmd-click opening a new pane. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Keep top-level session rows orchestrator-local; child handler state must not make the parent row look running, waiting, or broken. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Render handler threads as nested rows with handler-local waits, active commands, recent delegated summaries, running indicators, open-pane treatment, and context rails. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Reserve row `error` state for row-local unrecoverable state needing user action. Sources: `docs/prd.md`.
- [ ] Generate top-level session titles through a durable one-shot namer flow that starts concurrently with the first orchestrator turn. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Show live composer draft/first user message as provisional title until generated title lands. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Block manual rename while title generation is pending/running; freeze auto-title after manual rename or first successful generated title. Sources: `docs/prd.md`, `docs/progress.md`.
- [ ] Use only the namer settings prompt as naming instruction and only the first user message context as the namer input. Sources: `docs/prd.md`.

## Command Palette, Quick Open, And Shortcuts

- [ ] Implement one VS Code-like shared palette shell. Sources: `docs/prd.md`, `docs/specs/command-palette.spec.md`.
- [ ] `Cmd+Shift+P` opens with `>` prefilled; `Cmd+P` opens the same input with no prefix. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Launcher chords remain available while text inputs are focused. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Leading `>` live-switches quick-open into command mode; removing it switches back. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Command mode discovers existing product actions for sessions, surfaces, Dockview placement, settings, Agents, Extensions, read-only Workflows, and generated context previews. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Do not expose Smithers-specific palette actions or make the palette an alternate execution engine, shell, terminal loop, or workflow abstraction. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Unmatched non-empty command-mode text creates a normal New orchestrator session using text after `>`, through normal prompt history, system prompt loading, turn state, and live runtime ownership. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Reserve unprefixed quick-open mode for future file quick-open; until file surfaces exist, keep it disabled/empty/no-op rather than fabricating file surfaces. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Use `cmdk-sv` as the intended Svelte UI primitive. Sources: `docs/features.ts`.
- [ ] Implement a product-owned shortcut registry with stable ids, labels, platform chords, compact/readable display strings, scopes, input policy, availability, and palette/tooltip metadata. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Use TanStack Hotkeys as renderer shortcut binding for palette, quick-open, sidebar actions, dialogs, pane placement, and future focused-pane actions. Sources: `docs/progress.md`, `docs/specs/command-palette.spec.md`.
- [ ] Implement sidebar shortcuts in order: `Cmd+Shift+1` Logs, `Cmd+Shift+2` Agents, `Cmd+Shift+3` Extensions, `Cmd+Shift+4` Workflows. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Implement New orchestrator shortcuts: `Cmd+N` for focused pane and `Cmd+Shift+N` for new pane. Sources: `docs/features.ts`.
- [ ] Add compact shortcut hints on hover/focus for sidebar shell actions and consistent keycap chips in tooltips for icon-only/ambiguous controls. Sources: `docs/features.ts`.

## Composer Mentions, Attachments, Prompt History, And Markdown

- [ ] Keep composer `@` file/folder mentions as ordinary inline `@path` text from autocomplete. Sources: `docs/features.ts`, `docs/specs/composer-mention-links.spec.md`.
- [ ] Render picked/dropped/pasted files as removable chip-only attachments without mutating textarea text. Sources: `docs/features.ts`.
- [ ] Render sent file, folder, and image attachments as transcript tiles without visible attachment-provenance prose. Sources: `docs/features.ts`.
- [ ] Pass attachment paths through tagged agent-facing metadata. Sources: `docs/features.ts`.
- [ ] Send images to pi as image content blocks and warn when model metadata lacks image input. Sources: `docs/features.ts`.
- [ ] Render sent mentions as actionable workspace links that reveal files, open folders, and mark missing paths without eager file reads, folder expansion, or special context-target model. Sources: `docs/features.ts`.
- [ ] Persist durable surface composer drafts, including text and chip-only attachments, across closing surfaces and restart. Sources: `docs/progress.md`.
- [ ] Store non-empty submitted prompts per workspace, including failed/provider-blocked attempts, and expose shell-like recall. Sources: `docs/features.ts`, `docs/specs/prompt-history.spec.md`.
- [ ] Render assistant Markdown with compact prose spacing, reliable lists, GitHub tables/tasks, syntax-highlighted fenced code with copy, KaTeX math, Mermaid SVG plus source copy fallback, escaped raw HTML, collapsed reasoning blocks, variable-height TanStack Virtual rows, pane-local scroll restore, bottom-following only when pinned, ordered stream patches, and persisted turn duration. Sources: `docs/features.ts`.

## App Logs

- [ ] Use workspace-scoped structured app logs with monotonic sequence numbers, redaction, persistence, unread state, and live renderer updates. Sources: `docs/features.ts`, `docs/specs/app-logs.spec.md`.
- [ ] Support current log levels `debug`, `info`, `warn`, and `error`; UI copy may say warning, but storage/filter contracts should use the spec's `warn` level. Sources: `docs/specs/app-logs.spec.md`, `docs/features.ts`.
- [ ] Keep logs observability-only, not canonical product state. Sources: `docs/features.ts`, `docs/specs/app-logs.spec.md`.
- [ ] Show a sidebar Logs entry with compact action-worthy unread badges for warning/error logs only, not info-only unread logs. Sources: `docs/progress.md`, `docs/features.ts`.
- [ ] Render dense Dockview Logs pane with TanStack Virtual long-scroll, older-page loading, variable-height expanded rows, stable identity, filters by level/source/search, mark-all-read, explicit Live/Frozen tail mode, `New logs` affordance, smooth jump-to-latest with reduced-motion fallback, expandable details, normalized errors, stack traces, and related ids/links. Sources: `docs/features.ts`, `docs/specs/app-logs.spec.md`.
- [ ] Emit targeted product logs for lifecycle, provider auth, RPC failures, sessions, title generation, surfaces, prompts, handler threads, Smithers CLI guidance, Workflows build validation, direct tools, Execute TypeScript, artifacts, external editor handoff, and renderer bridge issues. Sources: `docs/progress.md`.

## Settings And Provider Auth

- [ ] Keep Provider Auth and Settings shipped behavior while moving agent profile configuration to Agents pane. Sources: `docs/features.ts`, `docs/prd.md`.
- [ ] General settings own provider keys/OAuth, app appearance (`system`, `light`, `dark`, default `system`), preferred external editor, and artifact directory. Sources: `docs/prd.md`, `docs/features.ts`.
- [ ] Use icon-only provider key/OAuth/remove controls with explanatory tooltips. Sources: `docs/features.ts`.
- [ ] Use inline remove confirmation for provider removal. Sources: `docs/features.ts`.
- [ ] Keep Web-specific TinyFish CLI auth out of General settings. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Route workspace-affecting settings and operations through explicit `workspaceId`. Sources: `docs/features.ts`, `docs/prd.md`.

## Recovery And Scheduler

- [ ] Implement one backend-owned recovery coordinator per acquired workspace runtime; duplicate same-cwd tabs share recovery state. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [ ] Use durable scheduler records with transactional claims and idempotency keys for prompts, queues, initial handler starts, thread report notifications, report requests, request-user-input records and answers, waits, title jobs, Workflows build/link refresh, and recovery observability. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [ ] Keep renderer layout restore as a consumer of backend snapshots, not as recovery authority. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [ ] Restore pending request-user-input clarification, waiting state, handler attention queues, per-surface prompt locks, queues, thread notifications, title jobs, and live surface/panel bindings after restart. Sources: `docs/progress.md`.

## Context Budget

- [ ] Show active context usage as a percentage of current model max for orchestrator surfaces, handler-thread surfaces, workflow task-agent attempts, and individual assistant messages where specified. Sources: `docs/features.ts`, `docs/specs/context-budget-observability.spec.md`.
- [ ] Use neutral below 40%, orange from 40% through 59%, and red from 60%. Sources: `docs/features.ts`, `docs/progress.md`.
- [ ] Render focused-surface bars under composer, compact bottom-edge indicators for open unfocused panes, handler pane bars, workflow task-agent attempt summaries, and hover details. Sources: `docs/features.ts`, `docs/progress.md`.

## Testing And Verification

- [ ] Add negative contract tests proving removed APIs and surfaces do not exist: `thread_handoff`, `thread_resume`, old single-objective `thread_start`, `request_context`, `wait`, `runtime_current`, `thread_handoffs`, `smithers_*`, `workflow_*`, Web tools, cx tools, Git/GitHub wrapper tools, and Workflows runner commands. Sources: removed specs diff, `docs/specs/extensions-and-tools.spec.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Add Project CI removal tests or assertions where relevant: no Project CI lane, prompt context, request context, command-palette action, app-log link type, workflow entry, `productKind = "project-ci"`, `ci_run`, or `ci_check_result` as current product surface. Sources: removed `docs/specs/project-ci.spec.md`, `docs/features.ts`.
- [ ] Add workflow supervision/inspector removal tests or assertions where relevant: no workflow-run monitor registry, Smithers bridge lifecycle projection, workflow inspector pane, Smithers DevTools projection, or handler wakeups from Smithers workflow state. Sources: removed `docs/specs/workflow-supervision.spec.md`, removed `docs/specs/workflow-inspector.spec.md`, `docs/specs/structured-session-state.spec.md`.
- [ ] Add generated-context and extension-inventory tests proving actor-specific defaults, Web gating by `networkAccess`, prompt-only boundaries, generated-client omissions, and unavailable extension hiding. Sources: `docs/progress.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Add tests for Extension Managing inspect/build/create/instructions/snapshots/reset/delete/revert and CLI/env readiness. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Add generated instruction builder tests for cx and Web pinned artifact identity, required markers, forbidden phrases, absent install guidance in prompts, and generated actor context inclusion only when loaded/eligible. Sources: `docs/specs/extension/cx.extension.spec.md`, `docs/specs/extension/web.extension.spec.md`.
- [ ] Add tests for `svvyx` dispatcher command facts, env injection, redaction, generated clients, and error semantics. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [ ] Add extension readiness tests where missing required env yields `runtimeReady: false` while context can remain ready, and where blockers do not create failed context-refresh rows. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Add redaction tests across env inspection, `svvyx` output/errors, generated clients, artifacts, logs, snapshots, command facts, transcripts, and TypeScript console output. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/extension/artifacts.extension.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [ ] Add Execute TypeScript tests for preflight diagnostics, artifact persistence, approval boundary, generated declarations, `incur/client` import, child command facts, and blocked invalid snippets. Sources: `docs/specs/extension/execute_typescript.extension.spec.md`.
- [ ] Add live tool projection tests for start, streamed args, output deltas, patch snapshots, approvals/waits, final facts, nested commands, and reload recovery. Sources: `docs/specs/live-tool-projection.spec.md`.
- [ ] Add Request User Input tests for blocking/nonblocking variants, defaults, generated ids, side-panel answer flow, queue delivery, timeout fallback, cancellation, and restart restore. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [ ] Add thread-control tests for `thread_start` history modes, extension overrides, group append, followup targeting, activation, report requests, update/conclusion episodes, notifications, and actor-specific schemas. Sources: `docs/specs/extension/thread_managing.extension.spec.md`.
- [ ] Add Workflows build/save/list/models tests for source roots, overwrite rejection, static agent extraction, generated namespaces, package linking, provider/model validation, extension validation dependency, and absence of runner commands. Sources: `docs/specs/workflow-library.spec.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [ ] Add Smithers prompt-generation tests from pinned `smithers-orchestrator@0.22.0` docs plus svvy boundary appendix and excluded fragment list. Sources: `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Add Web extension tests proving TinyFish prompt-only behavior, exact CLI requirement, no Web native/generated surfaces, no Firecrawl/provider settings, and `networkAccess` gating. Sources: `docs/specs/extension/web.extension.spec.md`.
- [ ] Add workspace-tab/default-workspace tests for startup restore, default workspace creation, Open Workspace retargeting, New Tab, Open Workspace in New Tab, duplicate same-cwd tab sharing, explicit `workspaceId` routing, and tab status badges. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [ ] Add Dockview tests for layout slots A/B/C, persistence, duplicated surface panels, independent scroll, drag/drop placement policy, static panes, focus restore, panel-location indicators, and close detachment semantics. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Add queue tests for atomic claim, active-surface enqueue, idle claim-before-visible, prompt history once, reorder/remove/restore, steer promotion, restart recovery, duplicated panels, thread notifications, report requests, request-input answers, and agent-context refresh ordering. Sources: `docs/specs/queued-messages.spec.md`.
- [ ] Add command-palette/shortcut tests for launcher chords in inputs, `>` mode switching, action discovery/routing, unmatched prompt fallback, reserved quick-open no-op, sidebar shortcuts, New orchestrator pane placement, and tooltip/keycap metadata. Sources: `docs/specs/command-palette.spec.md`.
- [ ] Add app-log store/RPC/renderer/sidebar/pane/redaction/virtualization tests and representative integration coverage. Sources: `docs/specs/app-logs.spec.md`.
- [ ] For UI verification, replace old Workflow Inspector coverage with Workflows pane coverage and narrow failed-state verification to failed turns/commands. Sources: `docs/ui/ui.rollout-checklist.md`, `docs/ui/ui.prd.md`.
- [ ] Treat Replit artifact screenshots/routes as visual references only; product behavior and data must come from current specs, read models, and runtime contracts. Sources: `docs/ui/ui.artifact-inventory.md`.
- [ ] Use `electrobun-browser-tools` for production-reachable manual UI states and save screenshots under repo-root `screenshots/`. Sources: root `AGENTS.md`, `docs/ui/ui.rollout-checklist.md`.
- [ ] Run e2e only through `bun run test:e2e` on the OrbStack lane; do not reintroduce visible desktop or Docker defaults, retries, broad waits, selector churn, or test-only behavior. Sources: root `AGENTS.md`, `docs/ui/ui.rollout-checklist.md`.
- [ ] Run `bun run check` as the normal preflight before handing off implementation changes. Source: root `AGENTS.md`.
