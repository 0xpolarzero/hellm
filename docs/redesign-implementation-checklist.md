# Implementation Acceptance Checklist

This checklist records acceptance coverage for the current product specs. It is not an independent
source of architecture; current behavior is defined by `docs/prd.md`, `docs/features.ts`,
`docs/progress.md`, and active specs.

## Product Guardrails

- [x] Review the diff for all changed product docs outside `docs/references/**` and vendor docs. Treat `docs/prd.md`, `docs/features.ts`, `docs/progress.md`, and `docs/specs/**` as source-of-truth docs; treat `docs/execution-model.md`, `docs/optimizations.md`, `docs/draft-notes.md`, `docs/external-library-followups.md`, `docs/research/*`, and `docs/ui/**` as non-authoritative inputs unless a source-of-truth doc explicitly promotes their behavior.
- [x] Treat `docs/vendor/smithers/smithers-0.22.0.llms-full.txt` as a pinned upstream input only for Smithers prompt-generation content, CLI command forms, and Smithers concept tests; do not treat it as product architecture to port wholesale.
- [x] Treat `docs/references/smithers/**` as refreshed Smithers reference material, not as shipped `svvy` runtime architecture. Product requirements must come from the `svvy` docs; the pinned vendor `llms-full` document is only evidence for official Smithers CLI guidance content. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [ ] Package-architecture acceptance rows cover the seven `@svvy/*` package roots, allowed public subpaths, app/bootstrap-owned `ManagedRuntime`, generated-package ownership, runtime-owned workspace-link repair, and the narrow Smithers `runTaskAgent` bridge.
- [x] Keep POC/product-doc dependencies out of the shipped runtime unless a current spec explicitly promotes them.
- [x] Keep product docs steady-state oriented: source-of-truth docs describe only the current resolved architecture and product surface. Sources: root `AGENTS.md`, `docs/prd.md`.

## Implementation Tracks

These tracks split unchecked acceptance rows into coherent implementation slices. A row is checked
only when the capability and its tests are present.

- [x] Agents/profile/editor forms track covers app-global profile storage, workflow-agent source
      records, pi-normalized model/reasoning selection, and TanStack Form validation for complex
      settings.
- [ ] Extension platform track covers Extension records, generated actor context completeness,
      actor-local loading, Extension Managing snapshots/storage/builds, env/secrets, CLI readiness,
      real app-owned `svvyx` CLI execution, generated `execute_typescript` facade declarations,
      builtin Artifacts/Workflows generated TypeScript facades, explicit omission of user `svvyx`
      `execute_typescript` facades, and related tests.
- [ ] Effect/package architecture track covers exact root/subpath exports for `@svvy/core`,
      `@svvy/state`, `@svvy/extensions`, `@svvy/sandbox`, `@svvy/pi-adapter`, `@svvy/runtime`,
      and `@svvy/desktop`; renderer-safe desktop DTOs with no pi-shaped bridge contracts; one
      app-owned `ManagedRuntime`; app/bootstrap-only composition; runtime startup/shutdown lifecycle;
      core-owned state-port consumption plus approved state read/command facades; exact
      app/bootstrap restricted-import boundaries; and facade-only desktop/browser/headless access.
- [ ] Approval/sandbox/execution-policy track covers approval modes, managed filesystem/network
      boundaries, sandbox packaging, exact Bun app-edge sandbox import restrictions,
      runtime-owned launch-policy acquisition for Shell/Apply Patch/Execute TypeScript,
      artifact-directory grants, and TypeScript approval routing.
- [ ] Workflows/Smithers source-library and generated-package track covers app-global workflow source roots,
      `@svvy/extensions` generated-package file production and immutable workspace-link plan
      generation, `@svvy/runtime` generated-package refresh scheduling, workspace-link repair, and
      state-fact recording, `svvyx workflows` list/save/build/models, Smithers prompt generation
      from pinned docs, and shipped packaged-app safety.
- [x] Snippets track covers product-owned Snippets alongside Agents/Extensions generated
      context, discovery, composer picker, expansion, provenance, and host-template disabling.
- [ ] Live projection/structured recovery track covers command records, live tool projection,
      child command facts, structured state derivations, durable scheduler records, targeted app
      logging, and recovery tests.
- [ ] Dockview/navigation polish track covers Dockview adapters, placement commands, drag/drop
      sources, edge/floating/popout restore, panel-location indicators, focused highlighting,
      handler row summaries, and default-workspace broad-surface verification.
- [ ] Markdown/context-budget/UI verification track covers regression verification for shipped
      assistant Markdown rendering and shipped context-budget observability, UI/e2e verification
      screenshots with `electrobun-browser-tools`, OrbStack e2e lane, and final `bun run check` for
      the Effect/package architecture acceptance surface.

## Product Architecture

- [x] Keep `svvy` as an Electrobun desktop app over pi, with pi owning the interactive runtime seam, session substrate, provider loop, and backing conversations for orchestrator, handler, and workflow task-agent attempt surfaces. Sources: `docs/prd.md`.
- [x] Keep one visible `svvy` orchestrator responsible for request interpretation, strategy, delegation decisions, reconciliation, and final user-facing decisions. Sources: `docs/prd.md`.
- [x] Make delegated handler threads the only normal delegation unit; do not delegate directly to raw Smithers runs from the orchestrator. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Use one shared execution model for orchestrator turns, handler turns, tools, commands, waits, structured state, and UI projection. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Extend through pi runtime and extension APIs; do not introduce or preserve a standalone custom shell, readline loop, alternate TUI, or non-pi terminal loop. Sources: root `AGENTS.md`, `docs/prd.md`.
- [x] Keep direct work, delegated work, waiting, extension loading, and tool projection on the same turn/tool/command/state pipeline. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.

## Actor Prompts And System Prompt Channel

- [x] Compose each actor's prompt from the current generated agent context before every prompt-bearing turn. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Load composed instructions through pi's real `systemPrompt` channel. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Ignore pi prompt replacement/append files such as `.pi/SYSTEM.md` and `APPEND_SYSTEM.md` as behavior-changing prompt inputs. Sources: `docs/prd.md`, `docs/specs/ambient-agent-resources-baseline.spec.md`.
- [x] Preserve discovered `AGENTS.md` and `CLAUDE.md` as visible read-only `external_instruction` records in the actual prompt path. Sources: `docs/prd.md`, `docs/specs/extension/external_instructions.extension.spec.md`.
- [x] Send submitted user text as the real new user message for that surface, not as flattened transcript prose. Sources: `docs/prd.md`.
- [x] Keep committed conversation history in pi session history; keep runtime, thread, episode, report-request, workflow, queue, and wait state in structured product state and targeted tools. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Render active system prompt/generated context as expandable surface metadata, not inline transcript prose. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Warn when a surface is bound to an older generated context fingerprint than current ready settings. Sources: `docs/prd.md`, `docs/specs/queued-messages.spec.md`.
- [x] Slice generated tool declarations and `execute_typescript` facade declarations by actor; no surface receives another actor's full callable API block for awareness only. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Support product-filtered inherited orchestrator history only for `thread_start.threads[].history: "forked"`, delivered as a context block in the handler's first prompt-bearing item, not as handler prior turns or system prompt content. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.

## Agents And Profiles

- [x] Implement the Agents pane between Logs and Extensions. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Store app-global orchestrator profiles, the special `threadHandler` profile, workflow-agent parameter records, provider/model/reasoning defaults, extension usage selections, profile metadata, and generated context previews. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
  - [x] Store orchestrator and special `threadHandler` profile extension usage selections as explicit `loaded`/`available`/`unavailable` profile state instead of a loaded-extension id list.
- [x] Keep the default orchestrator profile locked, first, non-draggable, non-deletable, and editable for settings. Sources: `docs/prd.md`, `docs/progress.md`.
- [x] Allow users to create, duplicate, order, edit, and inline-single-confirm delete user-created orchestrator profiles. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Drive the New orchestrator picker order, profile-specific command-palette actions, and surface profile badges from Agents-pane orchestrator-profile order. Sources: `docs/prd.md`, `docs/specs/command-palette.spec.md`.
- [x] Persist each top-level session's selected orchestrator profile, profile snapshot, and generated agent-context fingerprint at creation. Sources: `docs/prd.md`.
- [x] Let profile-backed orchestrator sessions optionally save composer model/reasoning changes back to that profile for newly created sessions using that profile. Sources: `docs/prd.md`.
- [x] Use `threadHandler` for delegated handler-thread surfaces. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Apply `thread_start.threads[].overrides` as creation-time partial overrides over `threadHandler` extension usage states. Sources: `docs/prd.md`, `docs/progress.md`.
- [x] Represent workflow-agent parameter records as structured Workflows source records that generate `Agents.*` exports. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Use pi's normalized provider/model/reasoning metadata and runtime thinking controls for model and reasoning dropdowns; do not maintain svvy-owned provider special cases or freeform model/reasoning text. Sources: `docs/prd.md`.
- [x] Use TanStack Form for complex provider, agent-profile, extension-env, and app-preference forms with validation, dirty state, reset/cancel, pending save, async errors, and state-authoritative normalization. Sources: `docs/prd.md`, `docs/progress.md`.
  - [x] Use TanStack Form for provider API key entry and app-preference settings, including validation, dirty state, reset/cancel, pending save state, async save errors, and state-normalized reset defaults.
  - [x] Use TanStack Form for agent-profile and workflow-agent parameter editors while preserving direct-save semantics and pi-normalized provider/model/reasoning constraints.
  - [x] Add Extension env forms for editable non-secret overrides and secret writes/removals through app-owned UI, with validation, redacted async errors, and runtime/state-authoritative readiness refresh.
- [x] Keep title-naming settings internal, seeded to `openai-codex` / `gpt-5.4-mini` with low reasoning effort, not exposed as a special Agents-pane profile. Sources: `docs/prd.md`, `docs/progress.md`.

## Extensions Model

- [x] Implement Extensions as builtin, user, and external_instruction records with category, instruction source files, minimal available-loading hints, interface kind, generated `execute_typescript` facade declarations only for app-owned builtin TypeScript-enabled `svvyx` extensions, env/dependency readiness, reset/delete behavior, and read-only usage views. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Support extension usage states `loaded`, `available`, and `unavailable` per profile/actor, except fixed app-native controls such as Extension Loading. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Implement the exhaustive builtin extension inventory: `base-common`, `base-orchestrator`, `base-handler`, `base-workflow-task`, `shell`, `apply-patch`, `execute-typescript`, `extension-loading`, `extension-managing`, `request-user-input`, `thread-orchestration`, `thread-handling`, `cx`, `git`, `github`, `web`, `smithers`, `workflows`, `artifacts`, and external instructions. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Load by default `base-common`, Shell, Apply Patch, Execute TypeScript, Extension Loading, cx, Git, and Artifacts for orchestrators, handler threads, and workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Load by default `base-orchestrator` and `thread-orchestration` only for orchestrators. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Load by default `base-handler`, `thread-handling`, Smithers, and Workflows only for handler threads. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Load by default `base-workflow-task` only for workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Load by default GitHub for orchestrators and handler threads; make it available for workflow task agents. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Make Extension Managing available for orchestrators and handlers, configured off for workflow task agents, and still configurable through profile overrides. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Make Request User Input loaded for orchestrators and handlers, configured off for workflow task agents, and still configurable through profile overrides. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Make Smithers available, not loaded, for orchestrators; loaded for handlers; configured off for workflow task agents; and still configurable through profile overrides. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Make Workflows available, not loaded, for orchestrators; loaded for handlers; configured off for workflow task agents; and still configurable through profile overrides. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Load by default Web only when `networkAccess` is true; make it unavailable/no prompt guidance when `networkAccess` is false. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
- [x] Build generated actor context from loaded base instruction extensions, loaded extension instructions, available minimal hints, external instructions, native tool declarations, loaded svvyx guidance, and generated TypeScript declarations. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
  - [x] Compose resolved loaded extension full instruction files into actor context with file-boundary headings, while omitting instruction files configured as bypassed. Sources: `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Use resolved available extension records for minimal hints, including user extensions, without exposing full instruction sources for available records. Sources: `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Wire resolved user and builtin-source extension records into session prompt previews, prompt binding generation, `list_extensions`, and `load_extension` refreshed context. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
  - [x] Keep generated TypeScript declarations for user `svvyx` extension builds out of generated actor context and Execute TypeScript declarations; user `svvyx` extensions do not contribute `execute_typescript` facades. Sources: `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
  - [x] Emit generated TypeScript declarations for builtin Artifacts and Workflows facades with schema-backed command metadata, generated `Run.Result` declarations, and output-control input fields.
  - [ ] Cover streaming response projection and CTA command runner execution through the shared child-command recording path for `Run.StreamResponse` and `Cta.run()` executions.
- [x] Store generated context fingerprints for sessions, handler threads, and workflow task-agent attempts. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Mark existing surfaces stale only when their binding fingerprint differs from current ready context, show the Extensions-changed banner with checked-by-default update-before-next-turn intent, and refresh automatically before prompt-bearing dispatch when enabled. Sources: `docs/prd.md`, `docs/specs/queued-messages.spec.md`.
- [x] On successful context refresh, commit generated-context binding facts in state, return after-commit descriptors, and have runtime publish the read-model invalidations needed for affected surfaces and extension panes. Sources: `docs/prd.md`, `docs/progress.md`.
- [x] Keep `list_extensions` actor-local, read-only, limited to loaded and available records; do not expose unavailable details, secrets, fingerprints, cache keys, or global profile state. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Implement `load_extension` as actor-local session loading of an available ready extension that records the actor-local binding and schedules generated declarations/guidance/context refresh for the next safe pre-dispatch boundary, without building, dependency approval, env configuration, profile mutation, or mid-turn mutation of active pi declarations. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Store user-named Extension Managing snapshots and durable generated context bindings so historical surfaces remain inspectable after restart. Sources: `docs/progress.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Persist local user-named Extension Managing snapshot metadata and snapshot payloads for save/list/rename/delete, excluding generated/build/node_modules internals and keeping command output path-free.
  - [x] Persist session and handler-thread loaded/available extension ids plus generated agent-context fingerprints, and persist workflow task-attempt generated context fingerprints.
  - [x] Add durable generated-context binding records that preserve the bound context payload across app/runtime restarts and later source changes, then render historical bound context from those records instead of rebuilding it only from current sources.
  - [x] Implement `svvyx extensions snapshots load` for local source/config/package restore, immediate same-pipeline build attempts, and durable dependency approval pauses.
  - [x] Preserve local snapshot secret state through app-managed secret storage during snapshot save/load/delete, exposing only coarse preservation and restore status.
  - [x] Mark existing orchestrator, handler, and workflow task-agent attempt surfaces stale by fingerprint after successful snapshot load, and reconcile stored loaded/available extension ids so only extension ids present in the restored source set remain eligible before the next opted-in safe prompt-bearing pre-dispatch refresh.
  - [x] Add dependency-approval resume/install completion after snapshot load, with conflict protection for restored state that changes while approval is pending.

## Ambient Agent Resources

- [x] Add provider-neutral Ambient Agent Resources settings for coding-agent host resources. Sources: `docs/specs/ambient-agent-resources-baseline.spec.md`, `docs/features.ts`.
- [x] Keep behavior-changing ambient resources default-off unless explicitly enabled by host, workspace, target agent/profile configuration, category, and source. Sources: `docs/prd.md`, `docs/specs/ambient-agent-resources-baseline.spec.md`.
  - [x] Persist an app-global Ambient Agent Resources category ledger with every behavior-changing category disabled by default and no prompt/tool/runtime behavior reading the ledger until host, workspace, source, and actor/profile enablement is implemented.
  - [x] Create managed pi actor sessions with the default-deny resource-loader shape: no host extensions, skills, prompt templates, themes, additional resource paths, extension factories, agent files, append prompts, built-in pi tools, prompt-template expansion, or `extendResources()` ambient paths; pass only svvy-owned custom tools and the svvy-composed system prompt.
  - [x] Persist normalized ambient enablement records keyed by host, source identity, app/workspace scope, category, and actor/profile targets without letting those records affect runtime behavior.
  - [x] Add a pure resolved-binding helper that requires category, source, scope, actor, and profile matches before returning enabled ambient candidates, while keeping runtime loading and generated context/declaration projection unwired.
  - [ ] Connect enabled ambient resources to runtime use through category-specific host/source/workspace/profile contracts.
- [x] Cover callable capabilities, extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, execution policy, and runtime state as ambient resource categories. Sources: `docs/specs/ambient-agent-resources-baseline.spec.md`.
- [x] Preserve visible external instruction files while blocking host-ambient behavior-changing resources from affecting prompts, tools, commands, UI, provider/auth behavior, or execution policy until enabled. Sources: `docs/prd.md`.
  - [x] Discover same-directory `AGENTS.md` and `CLAUDE.md` as visible external instruction records while load by defaulting only `AGENTS.md`; lone `CLAUDE.md` files remain enabled by default.
  - [x] Implement persisted per-file enablement, actor selection, and global root management for external instruction records.
    - [x] Add normalized persisted settings, discovery controls, default-off builtin global roots, custom root handling, workspace-keyed file controls, actor-selected prompt composition, and freshness fingerprints for external instruction records.
    - [x] Add user-facing Settings controls for global root management, per-file enablement, read-status display, actor chips, and external-editor actions.
    - [x] Project external instruction records and controls into the Extensions pane's distinct read-only External Instructions category, rather than leaving them only in General settings.
    - [x] Let Extension Managing inspect live `external_instruction:*` metadata and usage without exposing editable lifecycle paths, and emit normal live stale prompt-binding updates when external instruction controls change.
- [ ] Reflect enabled ambient callable resources only in actor-specific generated API declarations for the exact actor allowed to call them. Sources: `docs/prd.md`, `docs/specs/ambient-agent-resources-baseline.spec.md`.
  - [ ] Project resolved enabled ambient callable-resource bindings into actor-specific generated API declarations only for allowed actors.
- [ ] Ensure enabled prompt-affecting resources appear in generated context previews and fingerprints; enabled command resources appear in product command routing without hidden tools or invisible prompt mutation. Sources: `docs/progress.md`.
  - [ ] Project resolved enabled ambient prompt-resource bindings into generated previews/fingerprints and resolved command-resource bindings into product routing through concrete resource contracts.

## Extension Env And Secrets

- [x] Add app-global extension env declarations and app-managed values keyed by `(extensionId, envName)`. Sources: `docs/prd.md`, `docs/features.ts`, `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Persist app-global non-secret extension env overrides keyed by extension id and env name, and use them for Extension Managing readiness plus trusted `svvyx` runtime dispatch.
- [x] Let users enter, update, and remove secret values only through app-owned UI. Sources: `docs/prd.md`.
- [x] Store secrets encrypted through the app or OS keychain. Sources: `docs/prd.md`.
- [x] Support non-secret manifest defaults plus app-level overrides. Sources: `docs/features.ts`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Inject env values only into the specific trusted extension runtime invocation that needs them. Sources: `docs/prd.md`, `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [x] Never expose secret values through prompts, generated docs, tool output, logs, artifacts, transcripts, global pi env, global shell env, or `execute_typescript` snippet env. Sources: `docs/prd.md`.
- [x] Let agent-facing extension inspection report only declaration metadata and missing/configured readiness. Sources: `docs/prd.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Keep extension env values app-global per extension; workspace-scoped extension env values and
      egress-proxy credential boundaries are absent from the shipped product surface. Sources:
      `docs/prd.md`, `docs/features.ts`.

## Extension Managing And `svvyx` Runtime

- [x] Implement stable `svvyx <extension-id> ...` command interpretation through `@svvy/extensions`, with `@svvy/runtime` owning Shell command execution, command facts, approval/sandbox lifecycle, extension handler invocation, and ordered application of returned operations. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
  - [x] Route non-builtin `svvyx <extension-id> ...` commands from `exec_command` through the `@svvy/extensions` dispatch service and runtime-owned command lane, preserving builtin `svvyx artifacts`, `svvyx workflows`, and `svvyx extensions` command-family routing. App/bootstrap binds facades and host edges only.
  - [x] Reject user-extension dispatcher invocations mixed with shell control syntax so `svvyx <extension-id> ...` runtime routing remains a standalone command-family path.
- [x] Resolve extension current builds through the dispatcher and import default-exported Incur CLIs. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
  - [x] Materialize bundled user `svvyx` runtime modules into current builds, resolve current build manifests at dispatch time, and validate/import default-exported Incur CLIs without consulting editable source files as activation state.
- [x] Invoke extension CLIs through `cli.serve` with invocation-local explicit env. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
  - [x] Invoke dispatched user extension CLIs with unchanged extension argv, captured stdout/exit handling, per-extension invocation env assembled from safe defaults plus app-managed values supplied to the runtime, and secret-value redaction for returned stdout.
- [x] Validate Incur-backed extension builds so default-exported CLIs are accepted and top-level `.serve()` usage is rejected. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Bundle and import user `svvyx` build output before promotion so missing or invalid default exports fail the build, while obvious top-level `.serve()` source calls remain rejected.
- [x] Stage extension builds under `builds/.../staging/<build-run-id>/` and atomically promote successful builds to `current/`; failed builds leave the active current build unchanged. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
  - [x] Stage Extension Managing builds in unique `staging/<build-run-id>/` directories and promote successful builds to `current/` only after validation/readiness calculation succeeds; validation failure leaves the active user-extension `current/` output unchanged.
- [x] Record final `svvyx` dispatcher facts, structured runtime errors, final stdout/stderr or JSON output, and recovered command-inspector output through ordinary `exec_command` command records. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/live-tool-projection.spec.md`.
  - [x] Return dispatcher stdout, exit code, extension argv, runtime readiness, structured runtime errors, dependency runtime blockers, current-build module validation, and command facts through the existing `exec_command` result path for user `svvyx` dispatch.
  - [x] Include blocked dispatcher facts for missing/deleted extensions, missing current builds, env readiness failures, dependency blockers, and invalid current builds with `runtimeReady: false`, `errorCode`, and current-build status metadata.
  - [x] Preserve failed `svvyx workflows ...` command facts in the thrown `exec_command` JSON error payload and have the ordinary command tracker persist those facts on failed command records instead of dropping them during error handling.
  - [x] Persist final command-family `exec_command` stdout/stderr or JSON output as durable command-subject output events through the ordinary command tracker, and settle structured `{ ok: false }` `svvyx` results as failed command records without changing the returned agent-facing JSON shape.
  - [x] Expose persisted command output events through the recovered command inspector read model and render stdout/stderr sections in the ordinary command inspector instead of adding a workflow-specific recovery surface.
- [x] Record builtin generated extension-facade calls inside `execute_typescript` as parent-linked child commands with readiness, env injection, redaction, product-state validation, output, and failure semantics. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/structured-session-state.spec.md`.
  - [x] Record builtin Artifacts and Workflows extension-facade calls as parent-linked child commands with success/failure status, visibility, command facts, and `Client.ClientError` failure propagation.
  - [x] Expose loaded app-owned builtin TypeScript facades only when runtime-backed child-command execution exists, and record those calls as parent-linked child commands.
  - [x] Add tests proving user `svvyx` extensions dispatch through Shell and generated
        `@svvyx/extensions` authoring references only, with no generated `execute_typescript` facade
        declarations or runtime facade calls.
  - [ ] Cover streaming `Run.StreamResponse` projection and CTA command runner execution through the shared child-command recording path for streaming and CTA executions.
- [x] Stream `svvyx` command output/progress and recover shared live UI projection from ordinary command records without a workflow-specific renderer. Sources: `docs/specs/live-tool-projection.spec.md`.
- [x] Treat extension usage state as generated guidance/facade visibility, not as shell-level impossibility to type a command. Sources: `docs/progress.md`.
- [x] Validate extension builds for instruction source references, generated instruction fragments, CLI requirements, env declarations, TypeScript facade declarations, and Incur command schemas. Sources: `docs/specs/extensions-and-tools.spec.md`.
  - [x] Validate user-extension build inputs for unknown instruction-file config, generated-instruction output/script containment, generated-instruction CLI requirement references, exact dependency/trusted-dependency versions, env declaration defaults, default-exported `svvyx` source presence, and top-level `cli.serve()` rejection, while refusing generated-instruction activation until generator execution is implemented.
  - [x] Harden manifest schema validation for malformed optional CLI requirement fields, `installCommand` template/version coupling, generated-instruction requirement id types, duplicate generated outputs, and generated-output collisions with existing full instruction files.
  - [x] Extract and validate built user `svvyx` Incur command manifests into current build metadata, including command schemas, examples, and best-effort aliases/streaming markers when available from the CLI runtime.
  - [x] Generate and validate user `svvyx` command metadata from extracted Incur command manifests without emitting user `execute_typescript` facade declarations.
- [x] Implement Extension Managing source/storage, editable manifest schema, instruction source file lifecycle, snapshots, change history, reset, delete, revert, build, usage setting, and inspection contracts. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Materialize missing builtin local source directories during `inspect` before returning editable paths, keep packaged defaults read-only, and baseline initial source fingerprints so first materialization is not treated as a dirty build.
- [x] Store app-global extension state under `~/.config/svvy/extensions/` with `sources/user`,
      `sources/builtin`, `generated`, `builds`, `package`, `trash`, and `snapshots`;
      workspace-local extension sources are absent from the shipped product surface. Sources:
      `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Treat manifest, hand-authored instructions, generator scripts, `source/`, minimal instructions, and shared `package.json` as editable extension files. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Treat generated instructions, generated types, aggregate outputs, builds, lockfiles, `node_modules`, trash, and snapshots as non-editable generated or internal extension files. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Reject and roll back ordinary Shell and `apply_patch` writes to app-global Extension generated output, generated instruction outputs declared in manifests, generated type outputs, aggregate outputs, current/staging builds, package lockfile, `node_modules`, trash, and snapshots while leaving editable manifest, hand-authored instruction, generator script, `source/`, minimal instruction, and shared `package.json` inputs writable through direct tools.
- [x] Support manifest fields for `interface: "instructions" | "svvyx"`, exact dependencies, trusted dependencies, env declarations, CLI requirements, instruction-file bypass config, generated instruction declarations, and `typescriptApiEnabled: true` only for `svvyx`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Parse user manifest `env`, `cliRequirements`, `generatedInstructions`, `dependencies`, and `trustedDependencies` into inspect/build readiness without exposing env values or resolving/installing dependencies.
- [x] Order full instruction Markdown files lexicographically; bypassed files remain visible and generated but are omitted from loaded prompt concatenation. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Represent minimal instructions as single loading hints for available extensions. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Keep actor-local `list_extensions` available rows limited to minimal loading hints and minimal instruction paths, while loaded rows keep full instruction source paths.
- [x] Implement generated aggregate cache storage with `index.sqlite`, blob manifests, cache-key inputs, validation/regeneration, safe deletion, 256 MiB default budget, 30-day unused eligibility, and LRU eviction. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Implement aggregate cache mechanics for current prompt generation with `index.sqlite`, blob manifests, cache-key inputs, validation/regeneration, safe deletion, 256 MiB default budget, 30-day unused eligibility, LRU eviction, and `@svvy/extensions` generated-context builder and aggregate-cache integration.
  - [x] Resolve the spec tension between cache-key-only session bindings and durable generated-context binding payloads by storing the aggregate cache key plus exact bound aggregate payload files (`svvyx-guidance.md`, `commands.d.ts`, and `native-tool-schemas.json`) for historical inspection after source changes or cache deletion.
- [x] Implement `svvyx extensions inspect <id> --json` with metadata, paths, global usage, env/CLI/dependency readiness, and coarse build state/issues. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Report user manifest env/dependency/trusted-dependency declarations in inspect/build readiness output, with env status-only rows and no values, masks, encrypted blobs, keychain ids, or timestamps.
  - [x] Report builtin and user extension usage from persisted orchestrator/threadHandler profile usage state and workflow-agent source records, while keeping Extension Loading non-configurable with `fixedReason: "app_native_control"`.
- [x] Keep `inspect` output free of commandDocs/toolSchemas paths, fingerprints, aggregate keys, secret metadata, external auth detail, remote reachability probes, and secret values. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Implement `svvyx extensions create` only for user extension skeletons with `instructions` or `svvyx` interfaces; reject `native_tool` and reserved builtin/control namespaces. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Have `create` produce neutral instruction files and an Incur source skeleton with default export and no top-level `serve`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Implement instruction lifecycle commands `instructions add`, `rename`, `remove`, `reorder`, and `configure` to manage files/config only, not body text. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Implement user-extension `instructions add`, `rename`, `remove`, `reorder`, and `configure` under app-owned `sources/user/<id>/instructions/full`, with file/config-only behavior and no body editing API.
  - [x] Extend instruction lifecycle commands to builtin local source files and reset metadata without mutating packaged defaults.
- [x] Validate instruction lifecycle basenames, collisions, ordering, and bypass booleans; record reversible changes and set `buildRequired`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Validate user-extension lifecycle Markdown basenames, existing/missing files, duplicate and omitted reorder entries, rename/reorder collisions, exact boolean bypass values, lexicographic source truth, durable before/after lifecycle change records, and dirty build state while leaving current builds active.
  - [x] Validate builtin lifecycle commands before builtin source materialization so invalid filenames, duplicate reorder inputs, and other preflight failures do not create or mutate `sources/builtin/<id>`.
  - [x] Reject instruction lifecycle commands against read-only `external_instruction:*` records with `EXTERNAL_INSTRUCTION_READONLY` instead of treating them as editable or unknown extensions.
  - [x] Wire user-extension instruction lifecycle change records through `svvyx extensions revert <change-id> --json`, with exact after-state conflict detection, `extension_files` revert output, manifest-path reporting for config-only changes, follow-up change records, and focused command tests.
  - [x] Run the existing build path after successful instruction lifecycle reverts and project success or blocked auto-build results in `extension_files` output, while preserving exact-conflict failures without building.
  - [x] Add the durable dependency approval request ledger for revert-triggered auto-build pauses.
  - [ ] Wire UI reversible change cards to the same lifecycle change records, with the Extensions inventory read model projecting recorded change ids, the Extensions pane submitting revert intent through the bootstrap-provided runtime facade's Extension Managing revert path, and the pane refreshing authoritative inventory state from `@svvy/state` read models after the runtime notification.
  - [ ] Add conversation-owned product event projection for UI-triggered extension reverts once the owning conversation surface is available to the Extensions pane route.
- [x] Split extension build result into `contextReady` and `runtimeReady`; missing required env may keep `contextReady: true` while producing `runtimeReady: false`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Make missing or unknown required CLI status fail build before dependency installation and generator scripts, while detected installed versions remain available and become the current generator version. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Keep missing/unknown required CLI requirements as structured build failures before staging promotion, dependency approval, or generator execution, while detected installed versions succeed and surface update metadata.
- [x] Keep dependency approval separate from shell approval, with DB/product-state-backed committed approval facts for exact dependency/trusted-dependency identities, exact versions only, no Bun default trusted allowlist, and lifecycle scripts disabled unless that trusted identity is approved. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Add DB/product-state-backed `@svvy/state` dependency approval facts and pending-request records for explicit `svvyx extensions build <id> --json`, keyed by exact dependency and trusted-dependency identities with package manager, source, package name, exact version, and optional integrity/resolution metadata.
  - [x] Pause explicit builds that need dependency approval before staging promotion, return the durable approval request id with `blockedOperation: "build"`, and leave the current build untouched until dependencies are approved.
  - [x] Reuse an unresolved dependency approval request for repeated explicit builds with the same unapproved identity set, project existing pending request ids through later inspect/readiness output, record approvals as committed dependency approval facts, retire pending requests whose identities are absent from the current extension dependency plan, and require a new request when a dependency or trusted-dependency identity changes.
  - [x] Resume blocked install/build work after dependency approval, install approved packages with lifecycle scripts disabled unless the exact trusted identity is approved, and report installed/missing package artifacts from the app-owned package area.
- [x] Make `set-usage` mutate persistent agent-profile extension usage, queue context refresh for affected sessions, and never directly mutate the caller's current binding. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Implement `set-usage` for orchestrator and `threadHandler` profiles with persistent tri-state usage, exact profile ids, actor-compatibility rejection, affected-surface reporting, no direct caller-binding mutation, reversible usage change records, and exact revert conflict detection.
  - [x] Support `set-usage` for workflow-agent parameter-record sparse extension usage overrides.
- [x] Make Extension Loading fixed and not user-changeable through `set-usage`. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Implement `reset`, `delete`, `revert`, and snapshots with reversible product-state and file behavior. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Implement user-extension `svvyx extensions delete <id> --json` by recording an app-global reversible change before moving local source into trash, rejecting builtin deletes, blocking stale `svvyx` runtime dispatch for deleted builds, and restoring deleted sources through `svvyx extensions revert <change-id> --json` with collision and build-required handling.
  - [x] Implement local `svvyx extensions snapshots list/save/rename/delete --json` metadata commands with path-free summaries, source/package/registry-state snapshot payloads, and exclusion of generated outputs, build outputs, `node_modules`, and unsafe path/token-bearing package files.
  - [x] Record and revert `set-usage` product-state changes with exact after-state conflict detection and context-refresh impact output.
  - [x] Implement builtin `svvyx extensions reset <id> --scope instructions --json` so instruction source files exactly match the packaged builtin instruction set, builtin bypass config and generated instruction declarations are restored, `instructions/minimal.mdx` is restored, user-extension reset fails with `NOT_BUILTIN`, unsupported scopes are rejected, and the operation records a reversible instruction reset change.
  - [x] Implement builtin reset-triggered rebuilds through the current Extension build path, surfacing successful and blocked auto-build results in reset output.
  - [x] Implement durable dependency approval requests for reset-triggered auto-build pauses.
  - [x] Implement durable dependency approval requests for snapshot-load auto-build pauses.
  - [x] Implement snapshot-load restore with rebuild/dependency-approval flow for local source/config/package state.
- [x] Keep snapshots local-only; exclude raw secret values, raw key paths, `node_modules`, builds, generated caches, and generated outputs from snapshots; loading a snapshot must trigger normal build and approval flows. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Keep saved local snapshot command output path-free and omit generated directories, build directories, `node_modules`, and unsafe path/token-bearing package files from snapshot payloads.
  - [x] Implement snapshot load rebuild/dependency-approval flow for restored local source/config/package state.
  - [x] Implement local snapshot secret-state preservation and coarse restore reporting without exposing raw secrets, keychain ids, or snapshot-secret storage ids.
  - [x] Implement dependency-approval resume/install completion.
- [x] Keep generated extension facades behind `extensions["<id>"].run(extensionCommandId, input)`; dot access only for identifier-safe ids. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
- [x] Generate `@svvyx/extensions` through `@svvy/extensions` with dependency-approved package resolution, generated Incur command-schema extraction, and generated-package output roots resolved through `GeneratedPackageRootPort`. Sources: `docs/specs/extensions-and-tools.spec.md`, `docs/specs/workflow-library.spec.md`.
  - [x] Refresh the workflow-task-safe `@svvyx/extensions` package from workflow-task-safe builtin extension ids plus file/build-eligible user `svvyx` extensions that opt into workflow task-agent reference export generation, have approved dependencies, and have successful current source/build evidence, excluding deleted source, instruction-only extensions, dependency-blocked current builds, and extensions that fail build validation.
  - [x] Preserve generated-package transactionality so refresh failure leaves the active ready generated output in service and surfaces Extension-specific diagnostics for invalid Extension build inputs.

## CLI Requirements

- [x] Let extensions declare required command providers with binary name, optional package name, default target version, version-check command, and reusable exact-version install/update command template. Sources: `docs/features.ts`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Report missing, unknown, available, detected/current/latest versions, and update-available status through Extension Managing inspect/build and the Extensions UI. Sources: `docs/features.ts`.
- [x] Fail build with ordinary structured errors when a required CLI is missing or unknown, while using the detected installed version when a global PATH binary is available. Sources: `docs/features.ts`.
- [x] Extension CLI installation/update is split by initiator: the Extensions UI has no
      user-clicked install/update admission surface without a lifecycle-complete runtime-owned
      dependency-action command path with exact contracts, approval linkage, sandbox launch policy,
      subprocess lifetime, command facts, readiness refresh, and tests; agent-initiated setup
      remains ordinary Shell work. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Declare default target CLI versions for `cx-cli@0.7.1`, `smithers-orchestrator@0.22.0` invoked through the official `bunx smithers-orchestrator ...` command path, and `@tiny-fish/cli@0.1.6`; keep Git and GitHub CLI requirements unversioned. Sources: `docs/features.ts`, `docs/specs/extension/cx.extension.spec.md`, `docs/specs/extension/web.extension.spec.md`, `docs/specs/extension/smithers.extension.spec.md`.

## Direct Tools, Shell, Apply Patch, And Sandbox

- [x] Keep Shell, Apply Patch, and Execute TypeScript as default coding-agent work interfaces. Sources: `docs/prd.md`, `docs/specs/extension/shell.extension.spec.md`, `docs/specs/extension/apply_patch.extension.spec.md`.
- [x] Expose `exec_command`, `write_stdin`, and `apply_patch` as the normal native direct tools. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Treat `svvyx ...` commands and prompt-only CLI usage such as Smithers/TinyFish/cx as ordinary `exec_command` command-family work in agent-facing projection and command facts. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
- [x] Split Shell loaded instructions into base command execution guidance plus separate Incur-backed `svvyx` CLI usage guidance. Sources: `docs/prd.md`, `docs/specs/extension/shell.extension.spec.md`.
- [x] Split Execute TypeScript loaded instructions into base TypeScript execution guidance plus separate Incur facade usage guidance. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Implement Codex-like approval modes: `auto-review`, `user`, and `full-access`. Sources: `docs/prd.md`.
  - [x] Persist app-global `approvalMode` with the documented `auto-review`, `user`, and `full-access` values, normalize invalid values back to `auto-review`, and expose the mode in General settings.
- [ ] Enforce approval boundary decisions in runtime-owned accepted native-tool lanes for
      `exec_command`, `svvyx ...`, `apply_patch`, and top-level `execute_typescript`; do not rely on
      model memory. Sources: `docs/prd.md`.
  - [ ] Runtime owns the approval-boundary seam before ordinary `exec_command`, app-owned `svvyx ...`
        command-family dispatch, `apply_patch`, and top-level `execute_typescript`, and omits that
        boundary when `approvalMode: "full-access"` is active.
  - [x] Run all agent Shell usage of `svvyx ...` command families as ordinary Shell `exec_command` input to the real app-owned Incur CLI, preserving command facts, approval, sandboxing, output streaming, and projection on the same path as other shell commands.
    - [x] Route Artifacts `create`, `inspect`, `list`, and `delete` through the real app-owned `svvyx` CLI process, with parsed CLI output returned by the process while product-state mutations are represented as ordered `ExtensionRuntimeOperation` items wrapping closed `RuntimeEffectRequest` values or immutable `ExtensionExecutionPlan` values that `@svvy/runtime` applies through runtime-owned lanes, artifact storage, and core-owned state ports.
    - [x] Route Artifacts `open`, Workflows, Extensions, and user/runtime `svvyx <extension-id> ...` dispatch through the real app-owned `svvyx` CLI process, returning declarative runtime operation items, execution plans, and command facts that desktop consumes through authoritative read models for inspector-only UI actions.
  - [ ] Accepted native-tool execution uses the runtime-owned mode-aware approval boundary for direct
        tools and top-level `execute_typescript`, with denial coverage for both surfaces.
  - [x] Wire the injected runtime approval-boundary seam to app-owned automatic reviewer and actor-local user approval request handling, with durable runtime approval records, pending user approval projection, and approve/deny RPC/UI actions.
  - [x] Settle denied and cancelled user approval requests by clearing session wait state, resolving the blocked tool call without running it, and recording cancelled command facts instead of leaving pending approval promises open.
  - [x] Use a fail-closed app-owned automatic review policy that classifies and denies unsafe approval-boundary requests without relying on prompt memory.
- [ ] In `full-access`, runtime omits the approval boundary and managed OS sandbox enforcement for
      direct tools; `networkAccess: false` still disables Web prompt guidance, but Shell egress denial
      depends on the sandbox profile and therefore is not enforced when the profile is omitted.
      Sources: `docs/prd.md`.
  - [ ] Runtime treats `approvalMode: "full-access"` as the mode that omits direct-tool and
        top-level `execute_typescript` approval-boundary admission, resolves launch policy to
        `sandboxMode: "omitted_full_access"`, and starts no managed sandbox helper/profile for that
        launch.
- [x] Default `networkAccess` to true and restrict network plus disable Web extension when false. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
  - [x] Persist default-on `networkAccess` in app preferences, expose it in General settings, keep Web generated context omitted through existing extension binding when false, and run ordinary Shell commands through a deny-network sandbox profile when disabled and `approvalMode` is not `full-access`.
- [ ] Package macOS sandboxing through runtime-owned launch-policy acquisition and a packaged
      Codex-derived native helper that enforces scoped sandbox launch facts via
      `/usr/bin/sandbox-exec` when managed sandboxing is active. Sources: `docs/prd.md`,
      `docs/progress.md`.
  - [x] Preserve the implemented Codex filesystem semantics for `Read`/`Write`/`None` entries, most-specific path precedence, equal-specific `None > Write > Read` precedence, default read access, writable roots, read-only subpaths, protected metadata carveouts, network allow/deny, full-access sandbox omission, sandbox-denial reporting, and fail-closed helper setup.
  - [ ] Route ordinary `exec_command` subprocesses through runtime-owned `SandboxLaunchFacts` and
        the packaged helper whenever managed sandboxing is active.
  - [ ] `apply_patch` file effects use runtime-owned `SandboxLaunchFacts` and Codex-derived
        sandbox-aware filesystem execution, with TypeScript target preflight limited to validation
        and diagnostics.
  - [x] Add a packaged, testable native sandbox helper seam so unit tests exercise helper behavior instead of asking the unit-test host process to launch raw nested `sandbox-exec`.
  - [ ] Native helper enforcement covers svvy managed launch facts: symbolic roots, denied-read
        paths and globs with fail-closed invalid-glob handling, normalized filesystem/network
        policy, executor-required runtime-readable roots, scoped helper/profile artifacts, and
        full-access omission represented only as `sandboxMode: "omitted_full_access"`.
- [x] Preserve Codex filesystem policy semantics: `Read`, `Write`, and `None`; most-specific path precedence; writable roots with read-only subpaths; protected metadata carveouts; fail-closed behavior. Sources: `docs/progress.md`, `docs/research/agent-sandboxing.research.md`.
  - [x] Add a tested internal managed filesystem policy model for `Read`, `Write`, and `None`, most-specific/equal-specific precedence, workspace-write roots, `/tmp`/`$TMPDIR` writable roots, full-access sandbox omission, and protected `.git`, `.agents`, and `.codex` metadata carveouts.
  - [ ] `RuntimeAcceptedNativeToolExecution` owns direct-tool approval, launch-policy acquisition,
        and command lifecycle for accepted native-tool execution; it consumes the package-private
        `RuntimeLaunchPolicyService`, and the native sandbox helper enforces scoped sandbox launch
        facts at the OS process edge. App-edge TypeScript code does not assemble product launch
        policy or helper argv.
  - [ ] Only package-private `@svvy/runtime` launch-policy services call
        `Sandbox.buildLaunchPolicy(...)`; app/bootstrap, desktop bridge, browser-tool bridge,
        headless entrypoints, and Bun tool edges provide host-support ports and facades but do not
        synthesize sandbox policy or helper argv.
  - [ ] Native helper tests cover every permission-profile feature accepted by
        `Sandbox.buildLaunchPolicy(...)`, proving TypeScript policy models are descriptive contract
        inputs rather than subprocess-edge enforcement.
- [x] Grant the active session artifact directory as writable while making that session's `immutable/` child read-only; do not grant broad artifact-root or other-session artifact writes. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
  - [x] Allow ordinary Shell writes to the active session's mutable artifact directory while rejecting and rolling back Shell and `apply_patch` writes to that session's `immutable/` child and other existing session artifact directories through the direct-tool protection path.
- [x] Keep extension package dependency installation as explicit user-confirmation because it can download and execute third-party code. Sources: `docs/prd.md`.

## Execute TypeScript

- [x] Execute TypeScript behavior is specified by `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Expose no global `svvy` client and no injected broad `api` helper in snippets. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Expose actor-specific `extensions` containing only loaded TypeScript-enabled `svvyx` facades callable by the current actor. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Generate declarations only for loaded facades and those extensions' command map types. Sources: `docs/prd.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Support `extensions["<id>"].run(extensionCommandId, input)` and dot access for identifier-safe ids. Sources: `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Implement the loaded Artifacts injected `execute_typescript` extension facade, including actor-local declaration visibility, dot/bracket access, `create`/`inspect`/`list`/`open`/`delete`, child command recording, `Client.ClientError` failures, and handler-thread artifact scoping. Sources: `docs/specs/extension/artifacts.extension.spec.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Make `incur/client` importable for public Incur types and `Client.ClientError`. Sources: `docs/prd.md`, `docs/progress.md`.
- [x] Keep local Incur actions, generated internals, and broad internal client APIs out of agent-authored snippets. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Keep the default orchestrator Execute TypeScript extension set free of Workflows generated TypeScript facades, Smithers runtime control, and any `workflow`/`smithers` namespace. Sources: `docs/prd.md`.
- [x] Keep workflow task-agent Execute TypeScript facades limited to task-local loaded extensions; no Workflows source-library, Smithers runtime, handler, or orchestrator controls by default. Sources: `docs/prd.md`.
- [x] Persist every submitted snippet attempt as a file-backed artifact before execution. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Compile or typecheck every snippet before execution and block invalid snippets with structured diagnostics. Sources: `docs/prd.md`, `docs/specs/extension/execute_typescript.extension.spec.md`.
- [x] Route top-level `execute_typescript` through the same approval-boundary path as approval-gated native actions before running arbitrary TypeScript. Sources: `docs/prd.md`, `docs/progress.md`.
  - [x] Keep a tested top-level `execute_typescript` approval-boundary hook that uses the shared mode-aware runtime approval request shape, persists the snippet artifact, omits the boundary in `full-access`, and stops before diagnostics or runtime when denied.
  - [ ] Runtime applies the mode-aware approval boundary for top-level `execute_typescript` and
        verifies denial through the accepted native-tool lane.
  - [ ] Runtime uses the app-owned automatic reviewer and actor-local user-approval records through
        the runtime approval service rather than a session-created tool callback.
  - [x] Launch the top-level `execute_typescript` runtime process from runtime-owned
        `SandboxLaunchFacts` acquired through `RuntimeAcceptedNativeToolExecution`, using a
        closeable app-bootstrap internal handle so the scoped launch receipt lives until the
        subprocess lane settles.
  - [x] Wire actor-scoped builtin Artifacts and Workflows facade declarations and dispatch metadata into the `execute_typescript` runtime.
- [x] Record generated extension-facade calls inside approved snippets as child commands with readiness, env injection, redaction, product-state validation, and failure semantics. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
  - [x] Record Artifacts and Workflows extension-facade calls as parent-linked child commands with success/failure status, visibility, command facts, and `Client.ClientError` failure propagation.
  - [x] Add tests proving user `svvyx` extensions dispatch through Shell and generated
        `@svvyx/extensions` authoring references only, with no generated `execute_typescript` facade
        declarations or runtime facade calls.
- [x] Keep the top-level `execute_typescript` attempt as the parent semantic unit and roll child facts under it. Sources: `docs/features.ts`, `docs/specs/live-tool-projection.spec.md`.
- [x] Render accepted source, persisted artifact, diagnostics, nested child commands, runtime progress, and final parent command facts through shared live tool projection. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
  - [x] Persist accepted `execute_typescript` source on the parent command, keep the snippet as a file-backed artifact, record extension-facade child command accepted inputs, and stream captured console output into durable command-subject output events for shared transcript/inspector recovery.
  - [x] Project blocking static `execute_typescript` diagnostics as first-class durable command diagnostic events, recover them into command rollups/inspectors, and render them through neutral transcript and inspector surfaces without parsing final tool-result prose.
  - [x] Recover durable `command.progress` events into command rollups, neutral transcript tool cards, and command inspectors so runtime progress is projected through the shared live tool model.
  - [x] Test runtime-owned generic-direct-tool argument snapshot streaming for `exec_command` and `apply_patch`, sourced from pi incremental tool-event partial argument events and committed through durable command projection.
  - [ ] Extend runtime-owned incremental projection tests to `execute_typescript` source, native-control objective/report/question arguments, in-progress `apply_patch` patch previews, and approval-state live updates.
- [x] Keep cx out of generated Execute TypeScript facades; do not expose `api.cx_*` or `extensions.cx.*`. Sources: `docs/progress.md`, `docs/specs/extension/cx.extension.spec.md`.

## Live Tool Projection And Command State

- [x] Use Codex-like turn items for all tools: show a tool card as soon as tool name is known. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
  - [x] Persist running/waiting command records at execution start for direct tools and native
        control tools through the runtime-owned accepted native-tool lane, with tests covering
        `exec_command` and blocking `request_user_input`.
- [x] Have runtime record and project large/freeform argument snapshots for generic direct tools from pi incremental tool-call argument events before accepted handler execution begins. Sources: `docs/prd.md`, `docs/specs/live-tool-projection.spec.md`.
  - [ ] Extend runtime-owned incremental argument/progress projection to `execute_typescript` source, `apply_patch` in-progress patch previews, native-control objective/report/question arguments, and approval-state live updates with full projection and reload recovery coverage.
- [x] Render `apply_patch` as structured file-change snapshots with patch facts, not as transcript-only text or many tiny tool calls. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Stream `exec_command` output deltas and runtime progress through durable command events. Sources: `docs/prd.md`, `docs/features.ts`.
  - [x] Append ordinary `exec_command` stdout/stderr chunks to durable command-subject `command.output` events while the command runs, update the original command with final continuation facts for long-running `write_stdin` sessions, and suppress duplicate final-result output events when live stream events already exist.
  - [x] Recover app-owned `svvyx` command-family `command.progress` lifecycle events into neutral transcript tool cards and command inspectors without adding a workflow-specific renderer.
  - [x] Retain oversized command-family stdout/stderr as immutable command-linked log artifacts and store retained stream metadata in command facts instead of duplicating the full retained text in facts or durable output events.
- [x] Render `execute_typescript` extension-facade calls as nested child commands under the parent. Sources: `docs/specs/live-tool-projection.spec.md`.
  - [x] Persist accepted extension-facade inputs on child command records and recover captured `execute_typescript` console output through the same `command.output` event path used by shell output.
- [x] Project native control tools through the same live tool model, including accepted objective/report/question arguments and authoritative final runtime facts. Sources: `docs/prd.md`.
  - [x] Persist accepted argument snapshots for specialized native control commands (`thread_start`, `thread_followup`, `thread_request_report`, `thread_report`, and `request_user_input`) while preserving their existing authoritative final facts.
  - [x] Persist direct command records for `list_extensions`, `load_extension`, `thread_current`, `thread_list`, `thread_episodes`, and `thread_group` executions through `@svvy/runtime` command tracking services and `RuntimeCommandStatePort`, including active-runtime validation failures, without giving native tool handlers their own command-state write path.
  - [x] Persist `request_user_input` created request/question-count progress events and final nonblocking `RequestUserInputResult` command facts through the authoritative runtime command record/progress path.
- [x] Persist command records for every tool call with workspace/session/surface/thread ownership, status, arguments snapshot or artifact, output/progress events, final facts, linked artifacts, timestamps, and optional parent command id. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Recover renderer tool projection after reload from durable command events and final facts. Sources: `docs/progress.md`, `docs/specs/live-tool-projection.spec.md`.
- [x] Avoid a workflow-specific renderer or recovery path; Smithers and Workflows CLI calls are command-family projections. Sources: `docs/progress.md`, `docs/specs/live-tool-projection.spec.md`.
  - [x] Render transcript command rollups through the neutral tool-call card path instead of adapting ordinary command-family records into `WorkflowCard`.

## Artifacts

- [x] Store artifacts in the configured artifact directory, defaulting to `~/.config/svvy/artifacts`. Sources: `docs/prd.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Store mutable artifacts under `<artifactDir>/<sessionId>/` and immutable artifacts under `<artifactDir>/<sessionId>/immutable/`. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Persist artifact metadata with id, owning session, optional thread, optional command, stored path, exact stored filename, MIME type, byte size, digest, immutable flag, and created/deleted lifecycle fields. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Do not depend on transcript parsing or OS-level file flags for artifact identity or immutability. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Treat artifacts as durable session files for outputs worth preserving, not normal project source. Sources: `docs/prd.md`.
- [x] Implement the builtin Artifacts `svvyx` extension with `create`, `inspect`, `list`, `open`, and `delete`. Sources: `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Implement the Artifacts command-family runtime for `create`, `inspect`, `list`, `open`, and `delete`, including current-session/thread ownership, facade reuse, declarative `open` intent, desktop-consumed inspector requests, missing-file inspector rows, malformed command JSON errors, and rejection of unsupported command shapes outside the current Artifacts command and TypeScript facade contracts. Sources: `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Generate the Artifacts loaded instruction block from the current command and TypeScript facade contracts instead of hand-maintaining command/facade prose. Sources: `docs/specs/extension/artifacts.extension.spec.md`, `docs/specs/extensions-and-tools.spec.md`.
- [x] Map Artifacts copy/write/delete filesystem failures to the specified structured error codes, including `COPY_FAILED` and `DELETE_FAILED`. Sources: `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Support empty artifact creation with exact `--name <filename.ext>`. Sources: `docs/features.ts`, `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Support copy creation with `--path`, optional exact `--name`, and `--immutable`. Sources: `docs/features.ts`, `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Enforce extension-required basename validation and collision rejection. Sources: `docs/progress.md`.
- [x] Do not implement `--kind`, implicit extension inference, inline content creation, or OS file-flag immutability for artifacts. Sources: `docs/progress.md`, `docs/specs/extension/artifacts.extension.spec.md`.
- [x] Render artifact inspector panes keyed by durable artifact identity and isolated sandboxed previews for HTML artifacts. Sources: `docs/features.ts`, `docs/specs/workspace-navigation-core-projection.spec.md`.

## Request User Input

- [x] Implement Request User Input as a builtin native dual-variant extension for orchestrator and handler clarification. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Expose one `request_user_input` tool whose active blocking/nonblocking variant controls loaded instructions, schema descriptions, and runtime behavior. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Require agent-authored question titles and one to three questions. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] For choice questions, require two to three mutually exclusive options with exactly one recommended option. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Support freeform questions with a default answer. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Generate request, question, and option ids internally; keep internal ids out of tool results where prohibited. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Show answerable questions in a side panel. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Default to nonblocking behavior that immediately returns the recommended/default answer and later queues user answers as `request_user_input_answer` rows that outrank ordinary `user_message` rows, stay FIFO among answer rows, and remain separate from row-level `Steer` next-delivery priority. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Support blocking behavior with a default-enabled five-minute timeout that falls back to the default answer. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Keep request-user-input tool results free of mode, timer, UI availability, and internal id fields. Sources: `docs/features.ts`, `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Persist request/wait records and restore pending clarification state after restart. Sources: `docs/specs/structured-session-state.spec.md`, `docs/progress.md`.
- [ ] Return `status: "duplicate"` with the original delivery result for duplicate normalized `clientSubmission` answers, without inserting second answer/queue rows, publishing duplicate invalidations, resolving waits again, or settling commands again. Sources: `docs/specs/package-architecture/runtime.spec.md`, `docs/progress.md`.
- [ ] Resolve blocking answers, timeout defaults, cancellation, interruption, close recovery, and startup recovery through one durable compare-and-set transition where the first terminal commit wins and losing contenders observe `stale-state`. Sources: `docs/specs/package-architecture/runtime.spec.md`, `docs/progress.md`.
- [ ] Preserve paused blocking timers across shutdown/restart without reforking timeout fibers, and resume by committing a new deadline from stored remaining duration before starting a process-local timer. Sources: `docs/specs/package-architecture/runtime.spec.md`, `docs/progress.md`.

## Thread Orchestration And Handler Threads

- [x] Expose one shared native thread-control implementation as `thread-orchestration` for orchestrators and `thread-handling` for handlers. Sources: `docs/features.ts`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Give orchestrators `thread_start`, `thread_followup`, `thread_list`, `thread_episodes`, and `thread_request_report`. Sources: `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Give handlers `thread_current`, `thread_group`, `thread_report`, and `thread_episodes`. Sources: `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Give workflow task agents no thread-control extension by default. Sources: `docs/specs/extensions-and-tools.spec.md`.
- [x] Make `thread_start` take required `threads[]`, normally with one item. Sources: `docs/features.ts`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Make `thread_start` create or append to one durable `threadGroupId`, returned at top level and not repeated on each thread row. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Default `thread_start.threads[].history` to `isolated`. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.
- [x] Allow `history: "forked"` only for explicit current-context/forking/continuity cases where compact objective text or durable files would be lossy. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.
- [x] Do not use `forked` for ordinary implementation, source-driven research, test fixing, code review, security review, independent critique, verification, durable-file-specified tasks, or stale/speculative transcript contexts. Sources: `docs/prd.md`, `docs/research/handler-thread-history-default.research.md`.
- [x] Allow multiple `threads[]` only for separate user-visible handler conversations with independent direct follow-up needs. Sources: `docs/prd.md`.
- [x] Persist handler thread records with thread id, group id, workspace session id, surface pi session id, title, objective, history mode, objective state, worktree context, generated context binding, loaded/available extension ids, report requests, latest episode summary, and timestamps. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Keep handler objective state separate from handler activity, workflow activity, waits, repair context, and raw Smithers runtime state. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Let handler threads receive direct user messages like orchestrator surfaces. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Let handler threads wait, resume, rerun, clarify, and repair internally instead of bouncing through the orchestrator by default. Sources: `docs/prd.md`.
  - [x] Keep handler-thread clarification, waiting, request-user-input answer resume, follow-up delivery, workflow failure, troubleshooting, and repaired workflow state local to the handler surface unless the handler explicitly emits `thread_report`.
  - [x] Add focused runtime tests proving handler-local command or Smithers failure can continue or rerun on the handler surface without an orchestrator turn unless the handler explicitly calls `thread_report`.
- [x] Let `thread_followup` send corrections, clarifications, or later instructions to exact `threadIds` or one `threadGroupId`. Sources: `docs/prd.md`, `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Implement `thread_followup({ activate: true })` to reactivate concluded objectives when the context is right; active targets receiving the same follow-up keep their current objective. Sources: `docs/prd.md`.
- [x] Implement `thread_request_report` for one-handler update requests without changing that handler objective. Sources: `docs/prd.md`.
- [x] Implement `thread_group` as topology and addressing only, not shared memory or peer messaging. Sources: `docs/prd.md`.
- [x] Implement `thread_report` without `outcome` as an intermediate update episode. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Implement `thread_report` with `outcome` as a conclusion episode that marks the current objective concluded. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] After every durable episode, queue a typed orchestrator reconciliation notification; dismissal must not roll back the episode or return a handler tool error. Sources: `docs/prd.md`, `docs/specs/queued-messages.spec.md`.
- [x] Keep ordinary handler replies, tool calls, command summaries, and artifacts out of episodes unless `thread_report` creates one. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Keep handler surfaces open after conclusion for inspection, direct follow-up chat, and explicit reactivation. Sources: `docs/prd.md`.
- [x] Generate handler-thread titles with the same internal namer flow from the delegated objective; do not accept an orchestrator-supplied title field. Sources: `docs/prd.md`, `docs/progress.md`.

## Smithers Boundary

- [x] Keep Smithers as the workflow runtime and authoring model used directly through the official Smithers CLI. Sources: `docs/prd.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [x] Make Smithers a builtin prompt-only extension for handler-thread workflow authoring. Sources: `docs/features.ts`, `docs/specs/extension/smithers.extension.spec.md`.
- [x] Add no native Smithers tools, no generated Smithers TypeScript facades, and no product workflow wrapper tools. Sources: `docs/prd.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [x] Preserve upstream Smithers `bunx smithers-orchestrator ...` examples as the official generated prompt guidance, including `init`, `workflow run`, `ps`, `inspect`, `logs`, approvals, and resume; do not rewrite them to a global `smithers` binary. Sources: `docs/specs/extension/smithers.extension.spec.md`, `docs/vendor/smithers/smithers-0.22.0.llms-full.txt`.
- [x] Generate Smithers instruction content from Extension Managing-selected official Smithers documentation plus the bounded svvy appendix. Sources: `docs/specs/extension/smithers.extension.spec.md`, `docs/vendor/smithers/smithers-0.22.0.llms-full.txt`.
- [x] Exclude GUI, Gateway, MCP, HTTP server, OpenTelemetry, DevTools, event-streaming, OpenAPI, Effect, and wrapper-oriented fragments not current svvy surfaces from generated Smithers prompt guidance. Sources: `docs/progress.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [x] Keep official Smithers concepts in guidance where relevant: `.smithers/`, JSX authoring, official CLI approvals/resume, stable task ids, outputs, schemas, and render-loop behavior. Sources: `docs/specs/extension/smithers.extension.spec.md`, `docs/vendor/smithers/smithers-0.22.0.llms-full.txt`.
- [x] Keep Smithers memory fragment generated but bypassed by default. Sources: `docs/specs/extension/smithers.extension.spec.md`.
- [x] Teach handler agents to author and run workflows under workspace `.smithers/` using official CLI commands through Shell. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Teach reusable svvy `@svvyx/workflows` imports through Workflows extension guidance; Smithers guidance may only point agents to Workflows-extension material. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`, `docs/specs/extension/smithers.extension.spec.md`.
- [x] Keep repo-root `workflows/` as a source-checkout authoring workspace for maintaining `svvy`, not shipped product runtime, workflow registry, or packaged-app integration path. Sources: root `AGENTS.md`, `docs/specs/workflow-library.spec.md`.
- [x] Ensure shipped Smithers integration works without a source checkout or repo-local authoring assets. Sources: root `AGENTS.md`, `docs/prd.md`.

## Workflows Source Library And Extension

- [x] Implement app-global reusable source under `~/.config/svvy/workflows/agents`, `prompts`, `components`, and `workflows`. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Store generated `@svvyx/workflows` and `@svvyx/extensions` package output in app-owned generated roots resolved through `GeneratedPackageRootPort`; `@svvy/extensions` writes generated files/build evidence through refresh and returns immutable workspace-link plans only through the separate link-planning operation, while `@svvy/runtime` schedules refresh/link repair and records generated-package facts through state ports. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Keep generated package roots outside the safe writable boundary; reject ordinary agent direct edits to generated package files and workspace links. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Use workspace `.smithers/` as the only workspace workflow source location. Sources: root `AGENTS.md`, `docs/specs/workflow-library.spec.md`.
- [x] Generate package `@svvyx/workflows` with exactly four root namespace exports: `Agents`, `Components`, `Prompts`, and `Workflows`. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Put `Agents.defineTaskAgent`, type `Agents.TaskAgentParametersSource`, and generated task-agent parameter exports under `Agents.*`; do not export reusable values as flat root symbols. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Specify that generated `Agents.*` exports are persisted `TaskAgentParametersSource` records, `Agents.defineTaskAgent(parametersOrAgentsExport)` returns the Smithers-compatible `AgentLike` for `<Task agent={...}>`, and the returned AgentLike calls svvy through the narrow authenticated `runTaskAgent` workflow task-agent bridge. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Generate group indexes mechanically from source files so exportable runtime values are not missed by manual curation. Sources: `docs/specs/workflow-library.spec.md`.
- [ ] Runtime applies immutable workspace-link plans for `@svvyx/workflows` on workspace open/prepare and after successful generated-package fact commits. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [ ] Runtime applies immutable workspace-link plans for `@svvyx/extensions` whenever current generated-package facts exist, without deciding link creation by scanning workflow imports. Sources: `docs/specs/workflow-library.spec.md`.
- [x] Do not rely on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or source-checkout-relative package paths. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
  - [x] Resolve `@svvyx/workflows` through generated-package symlinks under workspace `.smithers/node_modules`, not ambient globals, parent `node_modules`, or source-checkout paths.
  - [x] Resolve `@svvyx/extensions` through generated-package symlinks under workspace `.smithers/node_modules`, not ambient globals, parent `node_modules`, or source-checkout paths.
- [x] Implement Workflows as the only app-owned command surface for reusable source-library operations. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [x] Implement `svvyx workflows list [--kind agent|prompt|component|workflow] --json`. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [x] Make `list` return mechanically available export identity and source/generated paths only; do not infer titles, summaries, usefulness, recommendations, or stale diagnostics. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Implement `svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json`. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
  - [x] Make non-agent `--export` behavior explicit: reject prompt `--export`, extract selected component/workflow exports when safe, and fail closed for unsafe runtime top-level dependencies, relative-import relocation, self-renames, and default exports.
- [x] Make `save` reject overwrites unless `--overwrite` is present, return a model-facing result plus an ordered `generated_packages.refresh` runtime operation, then have runtime call `@svvy/extensions` to produce generated files/build evidence, record generated-package facts through state ports, and schedule runtime-owned workspace-link repair. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
  - [x] Make `save` reject overwrites unless `--overwrite` is present, preserve the saved source with diagnostics when refresh fails, leave the active ready generated package in service, and handle workspace-link repair as separate runtime-owned recovery/fact work.
- [x] For `--kind agent`, statically extract `Agents.defineTaskAgent(...)` parameter literals without executing arbitrary TypeScript; reject dynamic inputs with structured diagnostics. Sources: `docs/progress.md`, `docs/specs/workflow-library.spec.md`.
  - [x] Extract literal `Agents.defineTaskAgent(...)` records, including `Extensions.<id>.id` and `Extensions["<id>"].id` references, without executing TypeScript; reject dynamic required fields and bare extension references that are not namespace-qualified through `Extensions.<id>.id` or `Extensions["<id>"].id`.
  - [x] Resolve accepted static spreads from known saved `Agents.*` records and reject unresolved spreads.
- [ ] Implement `svvyx workflows build --json` so `@svvy/extensions` produces generated-package files/build evidence through refresh, while `@svvy/runtime` commits generated-package facts, separately requests immutable workspace-link plans, and applies workspace-link repair through core-owned state ports. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
  - [x] Implement the Workflows source validation and `@svvyx/workflows` generation portion of `svvyx workflows build --json`.
  - [x] Generate and refresh the current workflow-task-safe `@svvyx/extensions` package before `@svvyx/workflows`, including workflow-task-safe builtin ids plus file/build-eligible user `svvyx` extensions that opt into workflow task-agent reference export generation, have approved dependencies, and have successful current source/build evidence, emit generated agent imports from `@svvyx/extensions`, refresh generated packages through the generated-package refresh lane, and repair workspace links through the separate runtime-owned workspace-link repair lane.
  - [x] Rebuild dirty or unbuilt TypeScript-enabled user `svvyx` Extensions through the Extension build command before Workflows source validation, forward CLI/env/secret/build-root inputs through `svvyx workflows build` and `save`, and fail closed on Extension build errors before workflow-agent extension override diagnostics.
  - [x] Generate `@svvyx/extensions` through the full Extension build/approval pipeline with dependency-approved package resolution and generated Incur command-schema extraction.
- [x] Implement `svvyx workflows models list --json` from pi-normalized provider/model/reasoning/auth metadata, with no live completion request by default. Sources: `docs/prd.md`, `docs/specs/extension/workflows.extension.spec.md`.
- [x] Fail build explicitly when task-agent parameter records name unavailable provider/model/reasoning combinations or invalid extension usage overrides; do not silently clamp, rewrite, or defer to runtime. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
  - [x] Fail the current Workflows generation step on unavailable provider/model/reasoning, unauthenticated provider, and invalid extension usage override ids.
  - [x] Validate workflow-agent extension override ids against the generated `@svvyx/extensions` export set, including eligible user extension reference exports produced by the `@svvy/extensions` generated-package service, and preserve extension ids through generated read-model parsing.
- [x] Do not implement Workflows `install`, `retrieve`, `promote`, kind-specific list subcommands, workflow run/resume/approve/inspect/debug controls, or product workflow wrapper commands. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Store Workflows export metadata in generated-package facts/read models for UI links; generated runtime export values carry no app metadata, public metadata fields, `__exports`, private metadata symbols, public declarations, or changed agent import usage. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.

## Workflows Pane

- [x] Render Workflows as a read-only Dockview static pane showing latest successful generated `@svvyx/workflows`. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`, `docs/specs/pane-layout.spec.md`.
- [x] Show `Agents`, `Components`, `Prompts`, and `Workflows` exports with kind, namespace, export name, qualified name, read-only generated code, generated-file link, and source-file link. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] For `Agents.*`, show the generated task-agent parameter object and a primary human action to open the corresponding Agents-pane record. Sources: `docs/prd.md`, `docs/specs/workflow-library.spec.md`.
- [x] Refresh the pane after successful `svvyx workflows build` and after Agents-pane edits that trigger a build. Sources: `docs/progress.md`.
  - [x] After successful direct `svvyx workflows build` or `svvyx workflows save`, runtime records generated-package facts through `@svvy/state` and publishes typed read-model invalidations; the Workflows pane refetches the generated-package read model.
  - [x] After Agents-pane workflow-agent edits trigger runtime-owned generated-package refresh, the Workflows pane updates only from committed generated-package facts and runtime-published read-model invalidations.
- [x] Keep Workflows pane free of inferred titles/summaries, source editing, delete actions, validation claims beyond build output, and workflow-running controls. Sources: `docs/progress.md`, `docs/specs/workflow-library.spec.md`.

## Web, cx, Git, And GitHub Prompt-Only Extensions

- [x] Keep Web as prompt-only TinyFish CLI guidance with no native Web tools, `svvyx web`, Web provider registry, or generated Web TypeScript facades. Sources: `docs/features.ts`, `docs/specs/extension/web.extension.spec.md`.
- [x] Use TinyFish-owned `@tiny-fish/cli@0.1.6` package instructions as the Web extension core prompt content, without fetching mutable TinyFish skill URLs as generated source. Sources: `docs/progress.md`, `docs/specs/extension/web.extension.spec.md`.
- [x] Generate Web instruction content from exact `@tiny-fish/cli@0.1.6` package artifacts; do not fetch mutable TinyFish skill URLs as generated source. Sources: `docs/specs/extension/web.extension.spec.md`.
- [x] Require TinyFish CLI binary `tinyfish`, Node `>=24`, and install template `npm install -g @tiny-fish/cli@{{version}}`. Sources: `docs/specs/extension/web.extension.spec.md`.
- [x] Make TinyFish missing/wrong/unknown CLI status fail build but not add native/generated Web surfaces. Sources: `docs/specs/extension/web.extension.spec.md`.
- [x] Add only a bounded svvy appendix for ordinary shell usage, redirecting large TinyFish JSON stdout to files, untrusted external content, and source URL citation. Sources: `docs/progress.md`, `docs/specs/extension/web.extension.spec.md`.
- [x] Teach `tinyfish auth`, `tinyfish search query`, `tinyfish fetch content get`, and TinyFish agent/browser commands as ordinary shell commands. Sources: `docs/specs/extension/web.extension.spec.md`.
- [x] Do not add `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript facades, Web Provider settings, provider selection, Firecrawl, TinyFish SDK provider adapters, or svvy-owned TinyFish key storage. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
- [x] Web has no local provider registry, native tool runtime, `svvyx web`, or generated Web TypeScript facade. Sources: `docs/specs/extension/web.extension.spec.md`.
- [x] Let TinyFish own CLI install, auth, search, fetch, browser-backed commands, stdout/stderr behavior, and API key storage through TinyFish CLI commands. Sources: `docs/features.ts`, `docs/specs/extension/web.extension.spec.md`.
- [x] Treat TinyFish JSON stdout and redirected files as raw CLI output, not svvy artifacts by default. Sources: `docs/progress.md`, `docs/specs/extension/web.extension.spec.md`.
- [x] Implement cx as prompt-only official CLI guidance with no native `cx_*` tools, no `svvyx cx`, and no generated `execute_typescript` facade declarations or generated TypeScript facades. Sources: `docs/prd.md`, `docs/specs/extension/cx.extension.spec.md`.
- [x] Require exact `cx-cli@0.7.1` with install template `cargo install cx-cli --version {{version}}`. Sources: `docs/specs/extension/cx.extension.spec.md`.
- [x] Generate cx instructions from the crates.io `cx-cli-0.7.1` artifact by extracting `src/skill.md` byte-for-byte and validating package identity, checksum, markers, and yanked status. Sources: `docs/specs/extension/cx.extension.spec.md`.
- [x] Do not use latest cx docs, GitHub, default local binary output, or local installed binary output as the primary generated cx source. Sources: `docs/specs/extension/cx.extension.spec.md`.
- [x] Teach the code inspection ladder `cx overview -> cx symbols -> cx definition / cx references -> exec_command with rg/sed/cat/ls/find`. Sources: `docs/prd.md`, `docs/specs/extension/cx.extension.spec.md`.
- [x] Implement Git and GitHub as prompt-only CLI guidance; no wrapper tools unless a current extension spec defines them. Sources: `docs/specs/extension/git.extension.spec.md`, `docs/specs/extension/github.extension.spec.md`.
- [x] Keep Git CLI requirements unpinned and loaded by default for all actors. Sources: `docs/specs/extension/git.extension.spec.md`.
- [x] Keep GitHub prompt-only guidance loaded by default for orchestrators/handlers and available for workflow task agents, with unpinned `git` and `gh` requirements. Sources: `docs/specs/extension/github.extension.spec.md`.

## Snippets Prompt Macros

- [x] Add product-owned Snippets as explicit user-inserted prompt macros, not host runtime prompt-template or slash-command expansion. Sources: `docs/features.ts`, `docs/specs/snippets.spec.md`.
  - [x] Add tested managed `svvy` Snippet records in `@svvy/state`, runtime discovery/expansion/invalidation, and runtime/state facade-backed managed Snippet commands plus read models consumed by desktop for create, edit/rename, delete, and merged managed/discovered listing without invoking host runtimes.
- [x] Expose prompt composition through Agents/Extensions generated context plus separate Snippets. Sources: `docs/specs/snippets.spec.md`, `docs/specs/extensions-and-tools.spec.md`.
  - [x] Generated agent context is surfaced through Agents/Extensions surfaces, without a Prompt Library/Context Library pane, Dockview chrome, header snapshot controls, or shell open path.
  - [x] Internal prompt-resource state and edit contracts use generated agent-context and Snippets-native contracts through the runtime facade plus state read/command facades for Snippets storage, picker expansion, and provenance records.
- [x] Add a Snippets pane with managed snippets, read-only discovered Markdown snippets, source badges, previews, external-editor actions, and managed create/edit/rename/delete controls. Sources: `docs/progress.md`, `docs/specs/snippets.spec.md`.
  - [x] The Snippets pane is backed by durable managed Snippet CRUD plus a combined read model that keeps discovered external snippets read-only.
- [x] Discover Claude command snippets recursively from `~/.claude/commands/**/*.md` and workspace `.claude/commands/**/*.md`. Sources: `docs/specs/snippets.spec.md`.
  - [x] Add tested source discovery for user and workspace Claude command Markdown files, preserving recursive namespace titles and read-only external records.
- [x] Discover pi prompt-template snippets non-recursively from `~/.pi/agent/prompts/*.md` and workspace `.pi/prompts/*.md`. Sources: `docs/specs/snippets.spec.md`.
  - [x] Add tested source discovery for user and workspace pi prompt-template Markdown files, limited to non-recursive prompt directories.
- [x] Do not discover Codex skills/plugins as Snippets. Sources: `docs/specs/snippets.spec.md`.
  - [x] Cover Codex `SKILL.md` and plugin-like paths as ignored by the Snippet discovery contract.
- [x] Support snippet Markdown plus `description` and `argument-hint`; ignore behavior-changing metadata. Sources: `docs/specs/snippets.spec.md`.
  - [x] Add shared Markdown/frontmatter parsing that returns only `description` and `argument-hint` metadata while dropping behavior-changing fields.
- [x] Substitute only supported positional/arguments placeholders and never execute host commands during snippet expansion. Sources: `docs/specs/snippets.spec.md`.
  - [x] Add shared placeholder expansion for `$1`, higher positional args, `$@`, `$ARGUMENTS`, `${@:N}`, and `${@:N:L}` as pure text substitution, preserving host command-looking text as inert prompt text.
- [x] Add composer `@` picker Snippet results with argument fields, mention chips, explicit expand-to-text behavior, and clean prompt-text expansion before sending to pi. Sources: `docs/progress.md`, `docs/specs/snippets.spec.md`.
  - [x] Add a structured Snippet mention model that keeps file/folder mentions as ordinary textarea `@path` text while Snippet selections render chips, edit arguments, expand to editable text, and resolve before send.
  - [x] Implement Snippet argument keyboard progression where `Tab`, `Enter`, and final `Enter` move through inline argument fields and return focus to composer text entry.
  - [x] Commit a full typed Snippet mention with a space into the structured Snippet mention model instead of requiring picker selection.
- [x] Mix files, folders, and Snippets in one composer `@` picker while preserving their distinct semantics. Sources: `docs/specs/snippets.spec.md`.
  - [x] Extend the existing file/folder mention search to include Snippet results with separate result metadata and accept behavior.
- [x] Persist sent Snippet provenance in product metadata while keeping the agent-facing message ordinary prompt text. Sources: `docs/progress.md`, `docs/specs/snippets.spec.md`.
  - [x] Store sent-message Snippet provenance metadata with Snippet id, source, path, content hash, arguments, and resolved content while sending only expanded prompt text.
  - [x] Promote Snippet provenance from message text signatures into explicit durable product metadata.
- [x] Render Snippet provenance as product metadata/transcript chips while sending only clean expanded inline text to pi. Sources: `docs/specs/snippets.spec.md`.
  - [x] Render sent Snippet provenance chips from durable message metadata instead of inferring them from prompt text or pane state.
- [x] For pi-backed actors, disable host prompt-template/slash expansion via the available pi controls such as `noPromptTemplates`, empty paths, override empty prompts, or disabled submit expansion. Sources: `docs/specs/snippets.spec.md`.
- [x] Keep pi, Claude, Codex, plugin, MCP, and host slash-command expansion disabled so Snippets never grant tools, alter generated context, mount commands, or change execution policy. Sources: `docs/features.ts`, `docs/specs/snippets.spec.md`.

## Structured Session State

- [x] Persist a workspace-scoped svvy product state layer above pi transcript state. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Model workspace sessions, live surface bindings, turns, commands, thread groups, handler threads, request-user-input records, surface queue items, episodes, artifacts, generated context bindings, saved Workflows metadata, waits, and lifecycle events as first-class records. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Keep `workspaceSessionId`, `surfacePiSessionId`, `threadId`, and `panelId` distinct and explicit in APIs; do not overload `session.id`. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Persist a top-level turn decision for every orchestrator, handler, and workflow task-agent attempt surface turn. Sources: `docs/prd.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Use current `TurnDecision` values: `pending`, `reply`, `exec_command`, `write_stdin`, `apply_patch`, `execute_typescript`, `list_extensions`, `load_extension`, `thread_start`, `thread_followup`, `thread_request_report`, `thread_group`, `thread_report`, `thread_episodes`, and `request_user_input`. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Represent Smithers CLI usage and `svvyx workflows ...` shell usage as `exec_command`. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Represent Workflows facade usage as generated extension-facade child commands when loaded in Execute TypeScript. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Store Workflows generated export metadata for kind, namespace, export name, qualified name, source path, generated path, and UI-only link metadata. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Keep Workflows generated export metadata internal and absent from generated import examples or public declarations. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Derive session navigation summaries, handler summaries, command summaries, artifact links, episode lists, Workflows export lists, wait indicators, and unread indicators from structured state. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Do not repair lifecycle state from transcript replay, ad hoc refresh loops, renderer polling, Smithers workflow/run lifecycle projection, or workspace-local workflow wrapper state. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Keep Dockview layout state, panel focus, and panel-to-surface bindings out of structured session state. Sources: `docs/specs/structured-session-state.spec.md`, `docs/specs/pane-layout.spec.md`.

## Queued Surface Messages

- [x] Persist durable surface queue items as structured state keyed by `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`, kind, and FIFO position. Sources: `docs/specs/queued-messages.spec.md`, `docs/progress.md`.
- [x] Queue ownership must be by `surfacePiSessionId`, not focused panel, active workspace tab, or parent session row. Sources: `docs/specs/queued-messages.spec.md`.
- [x] Support queue item kinds `user_message`, `initial_handler_start`, `thread_followup`, `report_request`, `thread_report_notification`, and `request_user_input_answer`; generated-context refresh is enforced before prompt-bearing dispatch rather than stored as queue work. Sources: `docs/specs/queued-messages.spec.md`.
- [x] If a surface is idle, commit queue insertion first and let the dispatcher claim the next item in a separate durable transition; panels render queued, dispatching, pending, or active state from authoritative read models after notifications. Sources: `docs/specs/queued-messages.spec.md`.
- [x] If a surface is active, keep prompt-bearing work queued until the prompt lock releases. Sources: `docs/specs/queued-messages.spec.md`.
- [x] Deliver queued work as the next real pi user/control message for the same `surfacePiSessionId`, creating a normal turn and never steering an active turn or starting a concurrent turn. Sources: `docs/specs/queued-messages.spec.md`.
- [x] Write prompt history once at queue time for user messages. Sources: `docs/features.ts`, `docs/specs/queued-messages.spec.md`.
- [x] Let queued user messages be removed, restored to composer, or reordered before delivery; keep drag reorder previews local until drop and persist only final changes. Sources: `docs/progress.md`.
- [x] Project blocked queue items near the owning surface composer with count, order, remove, restore-to-composer, and duplicated-panel consistency. Sources: `docs/progress.md`.
  - [x] Add an explicit composer-strip delivery-failure state for delivery failures that remain queue-row-local instead of surfacing as normal failed turns or queue restoration/cancellation.
- [x] Implement row-level `Steer` as durable promotion to the front for the next safe delivery boundary, not direct pi steering prompt injection. Sources: `docs/features.ts`.
- [x] Keep active-surface follow-ups visible as editable queued rows until claimed. Sources: `docs/features.ts`.
- [x] Recover queued work after restart through durable queue state and transactional claims, not renderer state, transcript parsing, or focused panel identity. Sources: `docs/specs/queued-messages.spec.md`.
- [x] Let committed user transcript messages be copied or edited/resubmitted, with visible selected-message highlight and draft-replacement warning. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Resend edited committed user messages by moving the same pi surface back to the original message's parent state before continuing from the edited message. Sources: `docs/features.ts`, `docs/progress.md`.

## Workspace Runtime, Tabs, And Default Workspace

- [x] Use one workspace runtime scope per canonical cwd inside the single app-owned runtime graph, with explicit `workspaceId` addressing for every workspace-scoped request and sync event that is not already identified by a durable surface, command, queue, session, or layout id. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Keep app-global auth/preferences outside workspace recovery and workspace routing. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [x] Keep workspace tabs as chrome selectors for `workspaceId` and active layout id, not durable layout owners. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Use stable `workspaceTabId` separate from `workspaceId`. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Allow duplicate same-cwd tabs as separate visual tabs sharing one workspace runtime scope, session catalog, pi sessions, structured state, queues, handler threads, app logs, Workflows metadata, and fixed layout slots. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Restore workspace tabs in durable user-defined order, left-aligned, horizontally scrollable when crowded, and draggable for reorder. Sources: `docs/prd.md`.
- [x] Render compact workspace-tab controls and status badges for running, unread, waiting, and error counts only when above zero, in stable order, with hover context. Sources: `docs/prd.md`.
- [x] On startup, restore persisted user workspace tabs; if none restore, create one real svvy-owned default workspace tab. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Store default workspace root under app-managed support data, e.g. `<svvy app data dir>/default-workspace`; create on demand and keep stable across restart. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Do not require default workspace to be a git repo, run repository discovery upward from it, place it under repo-root `workflows/`, or treat it as user source. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Give default workspace metadata `kind: "default"` and label `Default Workspace`; keep `Open Workspace` as panel/action name, not workspace label. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Initialize an empty selected default-workspace layout slot with exactly one `Open Workspace` pane. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Persist default workspace layout slots with the same A/B/C restore model as user workspaces. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Support default workspace sessions, command palette, Logs/Agents/Extensions/Settings, app logs, provider settings, prompt history, artifacts, and read-only app-global Workflows visibility. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Do not fabricate workspace-local Smithers source or runnable Workflows entries in the default workspace. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Implement `Open Workspace` as a normal Dockview workbench panel, not a modal-only or full-app empty page. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] `Open Workspace` retargets the current visual tab to the selected user workspace; preserve tab id/order, acquire runtime, load active layout slot, focus tab, and persist state. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] `New Tab` creates another default workspace tab over the shared default workspace runtime scope and selected durable layout slot. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] `Open Workspace in New Tab` creates a selected user workspace tab from the picker. Sources: `docs/prd.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Implement app menu/shortcut actions `workspace.open`, `workspace.newTab`, and `workspace.openInNewTab`. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Bind default workspace shortcuts through the shortcut registry/app-menu path: `Cmd+O` for Open Workspace, `Cmd+T` for New Tab, and `Cmd+Shift+O` for Open Workspace in New Tab. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Use the current command-palette sidebar order: `Cmd+Shift+1` Logs, `Cmd+Shift+2` Agents, `Cmd+Shift+3` Extensions, `Cmd+Shift+4` Workflows. Sources: `docs/specs/command-palette.spec.md`, `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Runtime workspace lifecycle facades expose `runtime.workspaces.acquire`, `runtime.workspaces.acquireDefault`, and `runtime.workspaces.release`; duplicate visual tabs share one canonical-cwd workspace runtime scope inside the single app-owned `ManagedRuntime`. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`, `docs/specs/package-architecture/generated-packages.spec.md`.
- [x] Open Workspace RPC accepts `{ cwd?, workspaceTabId?, placement? }`; the desktop bridge resolves and canonicalizes the requested cwd, calls `@svvy/runtime` facades to acquire or release workspace runtime-scope ownership, and uses state/runtime facades for durable tab/layout updates; the renderer owns visual placement intent and local chrome projection. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Retargeting, closing, or opening workspace tabs must not cancel running prompts or handler threads in prior/other workspace runtime scopes; keep background scopes alive while work or tabs reference them. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Persist known/recent workspaces for user workspaces only; exclude the default workspace from recents. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Restore failed user workspace tabs as default tabs with one `Open Workspace` pane plus inline restore error; do not block app startup because one tab failed. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Replacing a default workspace tab must not delete default workspace sessions or logs. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Add sidebar footer branch display with branch icon for git repos and a compact local-branch switcher through a workspace-scoped runtime facade request via the bootstrap desktop bridge; fall back to workspace label when not on a branch/git repo. Sources: `docs/prd.md`, `docs/features.ts`.

## Dockview Pane Layout And Surfaces

- [x] Add `dockview-core` as the workspace layout engine and mount one Dockview workbench instance in the Svelte renderer. Sources: `docs/progress.md`, `docs/specs/pane-layout.spec.md`.
- [x] Build Svelte adapters for Dockview content, tabs, header actions, context menus, tab-group chips, watermark, and unavailable-surface panels. Sources: `docs/progress.md`.
- [x] Support bindable surface kinds: orchestrator, handler-thread, artifact inspector, command inspector, Logs, Agents, Extensions, Workflows, Settings, and Open Workspace. Sources: `docs/specs/pane-layout.spec.md`.
  - [x] Support bindable surface kinds: orchestrator, handler-thread, artifact inspector, command inspector, Logs, Agents, Extensions, Workflows, and Open Workspace.
  - [x] Add Settings as a Dockview-bindable pane target and renderer branch.
- [x] Persist Dockview serialized layout plus svvy panel metadata, panel-to-surface bindings, focused panel, panel-local scroll/display preferences, restore state, and minimum panel policy. Sources: `docs/progress.md`, `docs/specs/pane-layout.spec.md`.
- [x] Add fixed workspace layout slots `A`, `B`, and `C` keyed by `(workspaceId, layoutId)`, pinned at the far right of workspace chrome. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.
- [x] Make empty layout slots muted but selectable, not disabled. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Autosave selected workspace layout slot after meaningful pane changes. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.
- [x] Keep panel-to-surface bindings separate from live surface runtime state. Sources: `docs/specs/pane-layout.spec.md`.
- [ ] Support split, resize, close, tab placement, panel/group drag placement, root-edge placement, edge groups, floating groups, and popouts through svvy placement commands. Sources: `docs/progress.md`, `docs/specs/pane-layout.spec.md`.
  - [x] Preserve svvy open-target placement intent for tab, root-edge, floating, and popout panes through renderer-local commands that submit durable Dockview layout and panel-binding updates to `@svvy/state`; the desktop/Dockview adapter consumes the resulting read models instead of degrading them to ordinary split panels.
  - [x] Expose command-palette placement actions for the current pane's surface into left/right/above/below splits, left/right/top/bottom root edges, floating groups, and popouts through the desktop action registry over Dockview layout state.
  - [x] Derive command-safe Dockview tab-group targets from serialized layout state and expose `pane.place-tab.<groupId>` placement commands through the desktop action registry over Dockview layout state.
  - [ ] Add explicit resize commands once the product has a stable command target-selection contract for Dockview-owned groups and splitters.
- [x] Configure Dockview drag/drop sources and `dndEdges`, with product policy through Dockview drop/source hooks. Sources: `docs/progress.md`.
- [x] Manage explicit open and close semantics for live surfaces independently from panel focus. Sources: `docs/specs/pane-layout.spec.md`.
- [x] Allow the same interactive surface to be opened in multiple panels while sharing one live controller and keeping panel-local scroll independent. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.
- [x] Closing a panel detaches it; it must not delete durable sessions, threads, commands, artifacts, or Workflows source state. Sources: `docs/specs/pane-layout.spec.md`.
- [x] Restore Dockview layout, panel bindings, focused panel, panel-local state, static pane targets, edge/floating/popout state, and display preferences after restart. Sources: `docs/specs/pane-layout.spec.md`.
  - [x] Persist and restore static-pane tab, root-edge, floating, and popout placement metadata through workspace UI restore state.
  - [x] Restore mixed runtime layout state for serialized Dockview JSON, prompt and static pane bindings, focused panel id, panel-local scroll and density, and edge/floating/popout placement metadata.
  - [x] Add mounted Dockview verification that `fromJSON` restores edge and floating groups while preserving svvy's saved focused panel state in the real Svelte adapter.
  - [ ] Add mounted popout restore verification through a harness that observes startup popout windows directly.
- [x] Exclude transient menus, selections, and stale live stream state from restore. Sources: `docs/specs/pane-layout.spec.md`.
- [x] Show exact panel-location indicators in the sidebar for open surfaces, including tab, edge-group, floating, and popout locations. Sources: `docs/progress.md`.
- [x] Show focused Dockview panel surface highlighting. Sources: `docs/progress.md`.

## Live Surface Runtime

- [x] Manage each interactive pi surface as a live runtime object keyed by `surfacePiSessionId`. Sources: `docs/prd.md`.
- [x] Keep process-local live surface resources on the runtime: active stream state, current pi turn handle, prompt lock, queue-drain fiber, provider/model/reasoning selection, and resolved prompt execution input. Durable transcript messages, command facts, queue rows, and read-model baselines remain in state. Sources: `docs/prd.md`.
- [x] Keep live surface runtime separate from durable workspace state and Dockview layout state. Sources: `docs/prd.md`.
- [x] Let surfaces continue streaming with zero, one, or many attached panels. Sources: `docs/prd.md`.
- [x] Let a panel opened mid-stream render committed transcript, pending user message, and current assistant stream from the live surface stream and state-backed read models. Sources: `docs/prd.md`.
- [x] Keep panel-local scroll independent across duplicated views of the same surface. Sources: `docs/prd.md`, `docs/specs/pane-layout.spec.md`.

## Session Navigation, Titles, Unread, And Sidebar

- [x] Keep each top-level session container as one orchestrator-led line of work containing one orchestrator surface, zero or more handler surfaces, and durable state. Sources: `docs/prd.md`.
- [x] Render fixed sidebar groups Pinned, Sessions, and Archived between orchestrator actions and reference panes. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Make each group collapsible, independently scrollable, vertically resizable, and persisted per workspace. Sources: `docs/prd.md`.
- [x] Keep Archived collapsed by default and the only archive-style grouping. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Do not implement arbitrary user-created session folders. Sources: `docs/prd.md`.
- [x] Make archive hide a session from active lists without deleting pi data, structured state, artifacts, threads, or episodes. Sources: `docs/prd.md`.
- [x] Track durable session-level unread state when assistant turns finish outside the focused pane surface. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Render unread as a small dot in place of session timestamp and clear it when a pane for that session receives focus or explicit mark-read action runs. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Provide context-menu actions for mark read/unread, pin/unpin, rename, archive/unarchive, and menu-local Confirm delete. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Keep normal session-row clicks opening in the focused Dockview panel and Cmd-click opening a new pane. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Keep top-level session rows orchestrator-local; child handler state must not make the parent row look running, waiting, or broken. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Render handler threads as nested rows with handler-local waits, active commands, recent delegated summaries, running indicators, open-pane treatment, and context rails. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Reserve row `error` state for row-local unrecoverable state needing user action. Sources: `docs/prd.md`.
- [x] Generate top-level session titles through a durable one-shot namer flow that starts concurrently with the first orchestrator turn. Sources: `docs/prd.md`, `docs/progress.md`.
- [x] Show live composer draft/first user message as provisional title until generated title lands. Sources: `docs/prd.md`, `docs/progress.md`.
- [x] Block manual rename while title generation is pending/running; freeze auto-title after manual rename or first successful generated title. Sources: `docs/prd.md`, `docs/progress.md`.
- [x] Use only the namer settings prompt as naming instruction and only the first user message context as the namer input. Sources: `docs/prd.md`.

## Command Palette, Quick Open, And Shortcuts

- [x] Implement one VS Code-like shared palette shell. Sources: `docs/prd.md`, `docs/specs/command-palette.spec.md`.
- [x] `Cmd+Shift+P` opens with `>` prefilled; `Cmd+P` opens the same input with no prefix. Sources: `docs/specs/command-palette.spec.md`.
- [x] Launcher chords remain available while text inputs are focused. Sources: `docs/specs/command-palette.spec.md`.
- [x] Leading `>` live-switches quick-open into command mode; removing it switches back. Sources: `docs/specs/command-palette.spec.md`.
- [x] Command mode discovers existing product actions for sessions, surfaces, Dockview placement, settings, Agents, Extensions, read-only Workflows, and generated context previews. Sources: `docs/specs/command-palette.spec.md`.
- [x] Do not expose Smithers-specific palette actions or make the palette an alternate execution engine, shell, terminal loop, or workflow abstraction. Sources: `docs/specs/command-palette.spec.md`.
- [x] Unmatched non-empty command-mode text creates a normal New orchestrator session using text after `>`, through normal prompt history, system prompt loading, turn state, and live runtime ownership. Sources: `docs/specs/command-palette.spec.md`.
- [x] Reserve unprefixed quick-open mode as the file quick-open entry point; until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist, keep it as a reserved entry point with no alternate file browsing path. Sources: `docs/specs/command-palette.spec.md`.
- [x] Use `cmdk-sv` as the intended Svelte UI primitive. Sources: `docs/features.ts`.
- [x] Implement a product-owned shortcut registry with stable ids, labels, platform chords, compact/readable display strings, scopes, input policy, and app-menu routing metadata, while command availability and palette result metadata stay on product action definitions. Sources: `docs/specs/command-palette.spec.md`.
- [x] Use TanStack Hotkeys as renderer shortcut binding for palette, quick-open, sidebar actions, dialogs, pane placement, and focused-pane actions. Sources: `docs/progress.md`, `docs/specs/command-palette.spec.md`.
- [x] Implement sidebar shortcuts in order: `Cmd+Shift+1` Logs, `Cmd+Shift+2` Agents, `Cmd+Shift+3` Extensions, `Cmd+Shift+4` Workflows. Sources: `docs/specs/command-palette.spec.md`.
- [x] Implement New orchestrator shortcuts: `Cmd+N` for focused pane and `Cmd+Shift+N` for new pane. Sources: `docs/features.ts`.
- [x] Add compact shortcut hints on hover/focus for sidebar app actions and consistent keycap chips in tooltips for icon-only/ambiguous controls. Sources: `docs/features.ts`.

## Composer Mentions, Attachments, Prompt History, And Markdown

- [x] Keep composer `@` file/folder mentions as ordinary inline `@path` text from autocomplete. Sources: `docs/features.ts`, `docs/specs/composer-mention-links.spec.md`.
- [x] Render picked/dropped/pasted files as removable chip-only attachments without mutating textarea text. Sources: `docs/features.ts`.
- [x] Render sent file, folder, and image attachments as transcript tiles without visible attachment-provenance prose. Sources: `docs/features.ts`.
- [x] Pass attachment paths through tagged agent-facing metadata. Sources: `docs/features.ts`.
- [x] Send images to pi as image content blocks and warn when model metadata lacks image input. Sources: `docs/features.ts`.
- [x] Render sent mentions as actionable workspace links that reveal files, open folders, and mark missing paths without eager file reads, folder expansion, or special context-target model. Sources: `docs/features.ts`.
- [x] Persist durable surface composer drafts, including text and chip-only attachments, across closing surfaces and restart. Sources: `docs/progress.md`.
- [x] Store non-empty submitted prompts per workspace, including failed/provider-blocked attempts, and expose shell-like recall. Sources: `docs/features.ts`, `docs/specs/prompt-history.spec.md`.
- [x] Render assistant Markdown with compact prose spacing, reliable lists, GitHub tables/tasks, syntax-highlighted fenced code with copy, KaTeX math, Mermaid SVG plus source copy fallback, escaped raw HTML, collapsed reasoning blocks, variable-height TanStack Virtual rows, pane-local scroll restore, bottom-following only when pinned, ordered stream patches, and persisted turn duration. Sources: `docs/features.ts`.

## App Logs

- [x] Use workspace-scoped structured app logs with monotonic sequence numbers, redaction, persistence, unread state, and live renderer updates. Sources: `docs/features.ts`, `docs/specs/app-logs.spec.md`.
- [x] Support current log levels `debug`, `info`, `warn`, and `error`; UI copy may say warning, but storage/filter contracts should use the spec's `warn` level. Sources: `docs/specs/app-logs.spec.md`, `docs/features.ts`.
- [x] Keep logs observability-only, not canonical product state. Sources: `docs/features.ts`, `docs/specs/app-logs.spec.md`.
- [x] Show a sidebar Logs entry with compact action-worthy unread badges for warning/error logs only, not info-only unread logs. Sources: `docs/progress.md`, `docs/features.ts`.
- [x] Render dense Dockview Logs pane with TanStack Virtual long-scroll, older-page loading, variable-height expanded rows, stable identity, filters by level/grouped source/search, viewport-based read marking during unfiltered browsing, persisted scroll position during live updates, explicit `New logs` affordance, smooth jump-to-latest with reduced-motion fallback, expandable details, normalized errors, stack traces, and related ids/links. Sources: `docs/features.ts`, `docs/specs/app-logs.spec.md`.
- [x] Emit targeted product logs for lifecycle, provider auth, RPC failures, sessions, title generation, surfaces, prompts, handler threads, Smithers CLI guidance, Workflows build validation, direct tools, Execute TypeScript, artifacts, external editor handoff, and renderer bridge issues. Sources: `docs/progress.md`.
  - [x] Emit `app.lifecycle` logs when workspace runtime scopes open and close, including live renderer updates and workspace runtime facts without using logs as lifecycle state.
  - [x] Emit targeted `execute_typescript` app logs for start, static-diagnostic blockers, success, and runtime failure with related session, surface, thread, command, and artifact ids while keeping command/artifact records canonical.
  - [x] Emit targeted `artifact` app logs for `svvyx artifacts` direct commands and generated Artifacts facades on success and validation failure, while keeping structured command and artifact records canonical.
  - [x] Emit targeted `direct-tool` app logs from the shared tool command tracker for generic tool start, success, failure, and cancellation, while keeping structured command records canonical.
  - [x] Emit targeted `thread` app logs for handler-thread creation success and failure from `thread_start`, while keeping durable thread and command records canonical.
  - [x] Emit targeted `smithers` app logs for Shell-routed Smithers CLI command lifecycle and failures, without adding Smithers wrapper tools or runtime state.
  - [x] Emit targeted `workflow.library` app logs for direct `svvyx workflows build/save` validation success and failure, including diagnostic counts and existing command facts.
  - [x] Emit targeted `workflow.library` app logs for Workflows extension facades used through `execute_typescript` build/save validation success and failure, including diagnostic counts and existing child-command facts.
  - [x] Emit targeted `app.rpc`, `app.bridge`, and `renderer` issue logs through explicit runtime log-source mapping, including provider OAuth RPC failures and dev browser-tools bridge mount failures.
  - [x] Cover provider auth, session, title-generation, surface, prompt, and external-editor app-log entrypoints without using logs as canonical product state.

## Settings And Provider Auth

- [x] General settings own provider auth and app preferences; the Agents pane owns orchestrator,
      handler-thread, and workflow-agent parameter-record configuration. Sources: `docs/features.ts`,
      `docs/prd.md`.
- [x] General settings own provider keys/OAuth, app appearance (`system`, `light`, `dark`, default `system`), preferred external editor, and artifact directory. Sources: `docs/prd.md`, `docs/features.ts`.
- [x] Use icon-only provider key/OAuth/remove controls with explanatory tooltips. Sources: `docs/features.ts`.
- [x] Use inline remove confirmation for provider removal. Sources: `docs/features.ts`.
- [x] Keep Web-specific TinyFish CLI auth out of General settings. Sources: `docs/prd.md`, `docs/specs/extension/web.extension.spec.md`.
- [x] Route workspace-affecting settings and operations through explicit `workspaceId`. Sources: `docs/features.ts`, `docs/prd.md`.

## Recovery And Scheduler

- [x] Implement one runtime-owned recovery coordinator per acquired workspace runtime scope; duplicate same-cwd tabs share recovery state. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [x] Use durable scheduler records with transactional claims and idempotency keys for prompts, queues, initial handler starts, thread report notifications, report requests, request-user-input records and answers, waits, title jobs, Workflows generated-package refresh, separate workspace-link repair, and recovery observability. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [x] Keep renderer layout restore as a consumer of state-backed read models, not as recovery authority. Sources: `docs/features.ts`, `docs/specs/workspace-runtime-recovery.spec.md`.
- [x] Restore pending request-user-input clarification, waiting state, thread report notifications, per-surface prompt locks, queues, title jobs, and live surface/panel bindings after restart. Sources: `docs/progress.md`.

## Context Budget

- [x] Show active context usage as a percentage of current model max for orchestrator surfaces, handler-thread surfaces, workflow task-agent attempts, and individual assistant messages where specified. Sources: `docs/features.ts`, `docs/specs/context-budget-observability.spec.md`.
- [x] Use neutral below 40%, orange from 40% through 59%, and red from 60%. Sources: `docs/features.ts`, `docs/progress.md`.
- [x] Render focused-surface bars under composer, compact bottom-edge indicators for open unfocused panes, handler pane bars, workflow task-agent attempt summaries, and hover details. Sources: `docs/features.ts`, `docs/progress.md`.

## Testing And Verification

- [x] Add boundary tests proving the current native control, Web, cx, Smithers, and Workflows surfaces expose only the active spec contracts. Sources: `docs/specs/extensions-and-tools.spec.md`, `docs/specs/structured-session-state.spec.md`.
- [x] Boundary tests prove there is no Project CI lane, prompt context, request context, command-palette action, app-log link type, workflow entry, `productKind = "project-ci"`, `ci_run`, or `ci_check_result` as current product surface. Sources: `docs/features.ts`.
- [x] Boundary tests prove there is no Project CI surface, workflow-run monitor registry, workflow inspector pane, Smithers DevTools projection, or handler wakeup path from Smithers workflow state. Sources: `docs/specs/structured-session-state.spec.md`.
- [x] Add generated-context and extension-inventory tests proving actor-specific defaults, Web gating by `networkAccess`, prompt-only boundaries, facade omissions, and unavailable extension hiding. Sources: `docs/progress.md`, `docs/specs/extensions-and-tools.spec.md`.
- [ ] Verify package-boundary tests cover exact public package exports/subpaths, allowed Effect
      imports, service ids, dependency pins, `@effect/vitest` lane placement, no unapproved
      `ManagedRuntime.make` or `Effect.run*`, facade-only desktop/browser/headless access,
      renderer-safe desktop DTOs with no pi-shaped message/session/model payloads, restricted
      state/pi/sandbox subpaths, no app/bootstrap source-relative private imports into package
      internals, runtime startup/shutdown lifecycle ownership, runtime-owned generated-package
      refresh/link repair, and generated core public-symbol index drift. Sources: `docs/prd.md`, `docs/features.ts`,
      `docs/specs/package-architecture/effect-v4.spec.md`,
      `docs/specs/package-architecture/generated-packages.spec.md`.
- [x] Add tests for Extension Managing inspect/build/create/instructions/snapshots/reset/delete/revert and CLI/env readiness. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
  - [x] Add focused Extension Managing tests for user instruction lifecycle revert, including exact revert output and conflict error details.
  - [x] Add focused Extension Managing tests for user extension delete, builtin delete rejection, delete revert, delete-revert collision handling, and stale built-runtime dispatch after delete.
  - [x] Add focused Extension Managing tests for local snapshot save/list/rename/delete summaries and generated/build/node_modules exclusion.
  - [x] Add focused Extension Managing inspect/build tests for Web/TinyFish CLI readiness, cx/Smithers generated-instruction CLI blockers, missing/unknown structured build errors, detected-version build success, update metadata, internal inspect-field omissions, and absence of Web native direct tools.
  - [x] Add focused Extension Managing create tests for app-owned user skeleton storage, create/inspect/build coherence, instructions-only vs `svvyx` source behavior, neutral generated files, Incur default export/no `serve`, direct-tool routing, and builtin/reserved/manifest-collision/duplicate/native/invalid rejection.
  - [x] Add focused user instruction lifecycle tests for add/rename/remove/configure, idempotent bypass configuration, lexicographic file-source ordering instead of manifest ordering, deterministic reorder prefix renames with content preservation, dirty build/current build state, JSON error results through `exec_command`, invalid filenames, collisions, bad reorder inputs, non-boolean bypass values, missing files, and non-editable builtin rejection.
  - [x] Add focused Extension Managing build/readiness tests for env status redaction, missing-required-env `contextReady`/`runtimeReady` split and post-build inspect state, required CLI blockers outside generated instructions, optional CLI version commands, dependency runtime blockers, staged build activation, validation failure without staging promotion, active-current retention on validation failure, non-exact dependency rejection, generated-instruction validation and non-activation, secret-default rejection, unknown instruction config rejection, and narrowed top-level `cli.serve()` rejection.
  - [x] Add focused Extension Managing tests for durable dependency approval request creation/reuse on explicit builds, no-promotion approval pauses, inspect projection of existing pending request ids, exact dependency/trusted-dependency approval recording, changed trusted identity negative coverage, stale request obsolescence, and revert-triggered auto-build dependency approval pauses.
  - [x] Add focused Extension Managing `set-usage` tests for persistent profile usage mutation, affected-surface reporting, fixed Extension Loading rejection, reversible usage changes, and exact conflict errors.
  - [x] Add focused Extension Managing builtin reset tests for instruction-source restore, builtin minimal prompt restore, generated instruction declaration restore, reversible reset conflict coverage through `revert`, user-extension `NOT_BUILTIN`, and unsupported reset scopes.
  - [x] Add focused Extension Managing snapshot-load tests for source/config/package restore, restored-extension builds, live source removal when absent from the snapshot, package `node_modules` exclusion, durable dependency approval request creation, and pending request reuse.
  - [x] Add focused Extension Managing snapshot secret-state tests for save/load restore, `exec_command` direct dispatch wiring, redacted command output, coarse status reporting, and delete cleanup.
  - [x] Add focused Extension Managing snapshot-load tests for loaded-session fingerprint staleness and loaded/available bindings matching the restored extension inventory.
  - [x] Add focused Extension Managing snapshot-load negative coverage proving failed snapshot-load rebuilds leave the active current build unchanged and do not commit generated-context refresh facts.
  - [x] Add focused Extension Managing dependency-approval resume/install tests for explicit build resume, rejection, failed install preservation, default installer package-state pruning, shared approved package-plan union, exact installed artifact validation, snapshot-load paused build resume, and snapshot resume conflict protection.
- [x] Add generated instruction builder tests for cx and Web pinned artifact identity, required markers, forbidden phrases, absent install guidance in prompts, and generated actor context inclusion only when loaded/eligible. Sources: `docs/specs/extension/cx.extension.spec.md`, `docs/specs/extension/web.extension.spec.md`.
- [x] Add tests for `svvyx` dispatcher command facts, env injection, redaction, generated `execute_typescript` TypeScript facade declarations, injected `execute_typescript` extension facade calls, and error semantics. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`.
  - [x] Add focused dispatcher tests for current-build runtime loading, unchanged argv dispatch, default/env-value injection, secret stdout redaction, missing required env errors, dependency runtime blockers, current-build module escape rejection, current-build import failures, extension command runtime failures, standalone shell-control rejection through direct runtime and `exec_command`, usage state not blocking shell-level dispatch, no-current-build JSON errors through `exec_command`, and dispatcher command facts.
- [x] Add extension readiness tests where missing required env yields `runtimeReady: false` while context can remain ready, and where blockers do not create failed context-refresh rows. Sources: `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Add redaction tests across env inspection, `svvyx` output/errors, generated `execute_typescript` TypeScript facade results, injected `execute_typescript` extension facade child-command facts, artifacts, logs, snapshots, command facts, transcripts, and TypeScript console output. Sources: `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/extension/artifacts.extension.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`.
- [x] Add Execute TypeScript tests for preflight diagnostics, artifact persistence, approval boundary, generated declarations, `incur/client` import, child command facts, and blocked invalid snippets. Sources: `docs/specs/extension/execute_typescript.extension.spec.md`.
  - [x] Add focused Execute TypeScript extension-facade tests for actor-local declarations, runtime exposure, `incur/client` import, Artifacts and Workflows child command facts, invalid dynamic input, and exposure of only current actor-local generated facade commands.
- [x] Add live tool projection tests for the implemented durable projection surface and split incremental streaming gaps into follow-up work. Sources: `docs/specs/live-tool-projection.spec.md`.
  - [x] Add focused durable projection tests for generic tool start/end records, apply_patch final facts, wait semantic blocks, nested command rollups, command inspectors, and reload recovery from structured command records rather than transcript prose.
  - [x] Add focused Execute TypeScript live-projection tests for accepted source recovery, extension-facade child input snapshots, captured console stdout/stderr output events, redaction, and neutral command inspector recovery.
  - [x] Add focused Execute TypeScript diagnostic projection tests for durable `command.diagnostics` events, selector recovery, command inspector grouping, and neutral transcript source-contract rendering.
  - [x] Add focused command-progress projection tests for durable `command.progress` selector recovery, renderer grouping, and neutral transcript source-contract rendering.
  - [x] Implement and test runtime-owned incremental argument snapshots for generic direct tools (`exec_command`, `apply_patch`), handoff from streamed pi tool-call updates to accepted handler execution, and durable recovery.
  - [ ] Wire durable `command.arg_snapshot` recovery into command rollup and inspector rendering so reload surfaces the incremental argument history.
  - [ ] Extend runtime-owned incremental projection to specialized tools (`execute_typescript` source, native-control objective/report/question arguments, in-progress `apply_patch` patch-preview updates, approval-state live updates) with full projection and reload recovery coverage.
- [x] Add Request User Input tests for blocking/nonblocking variants, defaults, generated ids, side-panel answer flow, queue delivery, timeout fallback, cancellation, and restart restore. Sources: `docs/specs/extension/request_user_input.extension.spec.md`.
- [x] Add thread-control tests for `thread_start` history modes, extension overrides, group append, followup targeting, activation, report requests, update/conclusion episodes, notifications, and actor-specific schemas. Sources: `docs/specs/extension/thread_managing.extension.spec.md`.
- [x] Add Workflows build/save/list/models tests for source roots, overwrite rejection, static agent extraction, generated namespaces, package linking, provider/model validation, extension validation dependency, and absence of runner commands. Sources: `docs/specs/workflow-library.spec.md`, `docs/specs/extension/workflows.extension.spec.md`.
  - [x] Add focused Workflows list/models/save/build-generation tests for source roots, overwrite rejection, static agent extraction, generated namespaces, provider/model/auth/reasoning validation, unavailable builtin extension ids, and absence of runner commands.
  - [x] Add focused package-linking tests for `@svvyx/workflows` build/save and workspace-open repair.
  - [x] Add focused non-agent `save --export` extraction/rejection tests for prompt, component, and workflow sources, including unsafe extraction and failed-save cleanup.
  - [x] Add focused `@svvyx/extensions` generation tests for file/build-eligible user `svvyx` extension reference exports with workflow task-agent opt-in, approved dependencies, and successful current source/build evidence, plus stale/deleted, instruction-only, dependency-blocked, build-failed, and no-current-build-evidence exclusion.
  - [x] Add focused Workflows save source-boundary tests for workspace `.smithers/`, outside-source rejection, symlink escape rejection, generated-link rejection, nested workdir resolution, facade rejection, and multi-open-workspace package refresh.
  - [x] Add focused generated-output writable-boundary tests for Apply Patch rejection, ordinary Shell rejection/cleanup, unrecognized shell writers, long-running Shell completion, workspace package-link writes, and allowed source-driven `svvyx workflows build`.
- [x] Add Smithers prompt-generation tests from pinned `smithers-orchestrator@0.22.0` docs plus svvy boundary appendix and excluded fragment list. Sources: `docs/specs/extension/smithers.extension.spec.md`.
- [x] Add Web extension tests proving TinyFish prompt-only behavior, exact CLI requirement, no Web native/generated surfaces, no Firecrawl/provider settings, and `networkAccess` gating. Sources: `docs/specs/extension/web.extension.spec.md`.
- [x] Add workspace-tab/default-workspace tests for startup restore, default workspace creation, Open Workspace retargeting, New Tab, Open Workspace in New Tab, duplicate same-cwd tab sharing, explicit `workspaceId` routing, and tab status badges. Sources: `docs/specs/default-workspace-and-open-workspace.spec.md`.
- [x] Add Dockview tests for layout slots A/B/C, persistence, duplicated surface panels, independent scroll, drag/drop placement policy, static panes, focus restore, panel-location indicators, and close detachment semantics. Sources: `docs/specs/pane-layout.spec.md`.
- [x] Add queue tests for atomic claim, active-surface enqueue, idle claim-before-visible, prompt history once, reorder/remove/restore, steer promotion, restart recovery, duplicated panels, thread notifications, report requests, request-input answers, and agent-context refresh ordering. Sources: `docs/specs/queued-messages.spec.md`.
- [x] Add command-palette/shortcut tests for launcher chords in inputs, `>` mode switching, action discovery/routing, unmatched prompt fallback, reserved quick-open no-op, sidebar shortcuts, New orchestrator pane placement, and tooltip/keycap metadata. Sources: `docs/specs/command-palette.spec.md`.
- [x] Add app-log facade/RPC/renderer/sidebar/pane/redaction/virtualization tests and representative integration coverage. Sources: `docs/specs/app-logs.spec.md`.
- [x] Verify Workflows pane coverage and failed-turn/failed-command states. Sources: `docs/ui/ui.rollout-checklist.md`, `docs/ui/ui.prd.md`.
- [x] Treat Replit artifact screenshots/routes as visual references only; product behavior and data must come from current specs, read models, and runtime contracts. Sources: `docs/ui/ui.artifact-inventory.md`.
- [x] Use `electrobun-browser-tools` for production-reachable manual UI states and save screenshots under repo-root `screenshots/`. Sources: root `AGENTS.md`, `docs/ui/ui.rollout-checklist.md`.
- [x] Run e2e only through `bun run test:e2e` on the OrbStack lane; do not reintroduce visible desktop or Docker defaults, retries, broad waits, selector churn, or test-only behavior. Sources: root `AGENTS.md`, `docs/ui/ui.rollout-checklist.md`.
- [x] Run `bun run check` as the normal preflight before handing off implementation changes. Source: root `AGENTS.md`.
