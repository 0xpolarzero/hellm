export type FeatureStatus = "shipped" | "in-progress";

export interface ProductFeature {
  id: string;
  name: string;
  status: FeatureStatus;
  summary: string;
  sourceSpecs: string[];
}

export const PRODUCT_FEATURES: ProductFeature[] = [
  {
    id: "desktop-shell",
    name: "Electrobun Desktop Shell",
    status: "in-progress",
    summary:
      "Runs svvy as a native desktop coding app and targets `@svvy/desktop` as the Electrobun/Svelte consumer of renderer-safe runtime and state read/command facades injected by app/bootstrap over the single healthy app-owned ManagedRuntime, with workspace runtime scopes as runtime-owned keyed child scopes rather than separate ManagedRuntimes, `@svvy/pi-adapter` owning pi session and turn adaptation below runtime, `@svvy/runtime` providing svvy-owned default workspace-scoped resources when no user workspace tabs restore, and non-authoritative desktop warm read-model caches updated only from renderer-safe notifications/refetches after app/bootstrap subscribes to runtime events, tracks event-generation cursors, detects gaps, requests rebaseline, and fans out renderer-safe read-model invalidations plus contiguous `surface.stream` patches rather than exposing bare runtime streams to desktop.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/default-workspace-and-open-workspace.spec.md",
      "docs/specs/package-architecture/package-architecture.spec.md",
      "docs/specs/package-architecture/desktop.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
    ],
  },
  {
    id: "effect-package-architecture",
    name: "Effect Package Architecture",
    status: "in-progress",
    summary:
      "Defines the seven public `@svvy/*` packages, `@svvy/extensions` ownership of package-owned prompt/instruction assets, workflow prompt source contributors, generated actor context, and generated-package production for canonical read-only `@svvyx/extensions` / `@svvyx/workflows` outputs via `GeneratedPackageRootPort` separate from editable Workflows/Extensions source, the installed `effect@4.0.0-beta.84` API authority with exact manifest/member-gated production adoption, including service-instance member policies such as runtime-owned `Semaphore.withPermit` callsites for event publication and surface stream cursor serialization, host env reads confined to app/host edges, one app-owned `ManagedRuntime`, `Runtime.layer` as the package-owned production layer, the narrow `@svvy/runtime/bootstrap` app-composition surface with spec-named primitive host ports only, `@svvy/runtime/accepted-native-tool-execution` as the only accepted native-tool app-bootstrap Promise adapter over the app-owned runtime, `@svvy/runtime/app-log-commit-notification-adapter` as the only adapter from a real state-facade committed app-log append scope into runtime-owned invalidation mapping/publication, `@svvy/runtime/committed-state-invalidation-adapter` as the narrow app-bootstrap catalog edge that publishes exact descriptors from named state-owned mutation adapters without reporting committed writes as rolled back, `@svvy/runtime/source-invalidation-coordinator-adapter` as the only app-bootstrap source-coordinator handle adapter, package-internal `RuntimeLayerRequirements`, core-owned data-only function-style Effect `Context.Service` port tags, `@svvy/state` public `layer({ config, digest? })`, `createStateFacade(...)`, `createStateCommandsFacade(...)`, `StateReadModels`, `StateCommands`, named zero-argument state-backed port projection layers over one acquired state layer, runtime-owned scoped launch-policy acquisition through package-private `RuntimeLaunchPolicyService` over `Sandbox.buildLaunchPolicy(...)`, app/bootstrap-supplied sandbox host-support ports without app-edge policy synthesis, restricted sandbox diagnostics for direct subprocess denial facts, core-owned state-port boundaries plus read/resolve and mutation-only secret-store ports backed by app-composed layers, runtime event boundaries, package-private `RuntimeSurfaceEventPublisher` ownership of `surface.changed` and `surface.stream` construction with a target-local surface stream cursor lane keyed by durable `surfacePiSessionId`, package-private runtime event bus ownership of app-wide event sequencing, replay retention, and bounded subscriber fanout, bridge facades that adapt the app-owned runtime into Promise/async-iterator APIs with explicit readiness, error, cancellation, stream-close, and shutdown receipts, and package-boundary tests for the reusable main agentic flow below the desktop UI.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/package-architecture/package-architecture.spec.md",
      "docs/specs/package-architecture/effect-v4.spec.md",
      "docs/specs/package-architecture/core.spec.md",
      "docs/specs/package-architecture/core-public-symbol-index.generated.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/sandbox.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/desktop.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
    ],
  },
  {
    id: "source-invalidation",
    name: "Source Invalidation And File-Backed Inputs",
    status: "in-progress",
    summary:
      "Runs scoped `@svvy/runtime` source invalidation coordinators for file-backed source inputs through the named app-bootstrap source-coordinator handle adapter: one app-global coordinator watches Workflows and Extensions source roots, refreshes app-global generated `@svvyx/extensions` and `@svvyx/workflows` packages, wakes link repair for acquired workspace runtime scopes, and records repair-needed facts plus recovery work for unopened workspaces; one workspace coordinator per acquired workspace watches external instruction candidates and discovered read-only host snippet Markdown sources for that workspace. Watcher events are only hints that trigger debounced and periodically reconciled deterministic source fingerprints; generated outputs and workspace package links are excluded as triggers; app-global agent settings, profile settings, and managed svvy snippets are DB/product-state-backed writes where `@svvy/state` commits facts and returns after-commit descriptors for runtime-owned typed events; committed source-scan event descriptors are applied through runtime-owned source invalidation APIs before typed runtime events are published; refresh work rebuilds source-derived evidence through `@svvy/extensions` and rereads or commits affected state-backed facts only through core-owned state ports, keeps the last ready generated output active when validation fails, surfaces source diagnostics through app logs/read models, emits typed runtime events so app/bootstrap can fan out renderer-safe notifications and renderer read-model caches refetch affected state-backed read models, marks open surfaces stale solely by bound generated-context fingerprint mismatch, refreshes opted-in stale surfaces before the next prompt-bearing dispatch, and protects editable file-backed drafts with shared source-version compare-and-swap saves plus explicit keep-editing, discard-local, and overwrite-external conflict actions.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/source-invalidation.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
    ],
  },
  {
    id: "provider-auth",
    name: "Provider Auth And Settings",
    status: "in-progress",
    summary:
      "Manages app-global model provider keys, OAuth-backed access with explicit healthy, missing, expired, and refresh-failed credential health, icon-only provider key/OAuth/remove controls with tooltip explanations and inline remove confirmation, and a General settings surface for app appearance (`system`, `light`, or `dark`), the user's preferred external editor, the durable artifact directory, approval mode, default-on network access, and default-off ambient agent resource categories with `@svvy/state`-authoritative app-global persistence; pi provider auth uses redacted `ProviderAuthStatusStatePort` rows for model availability/status joins and exact `ProviderAuthPort` snapshots for live pi operations, mapping unusable credentials to missing, expired, or refresh-failed pi-adapter errors instead of generic runtime auth failure, while expired or refresh-failed OAuth remains visible as connected credential state but is excluded from usable model availability and pi runtime auth until reconnect or successful refresh, pi-backed agent profile configuration stays in the Agents pane, Web-specific TinyFish CLI auth stays in TinyFish CLI commands, and workspace-affecting operations stay on explicit `workspaceId`-routed requests.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/package-architecture/core.spec.md",
      "docs/specs/package-architecture/state.spec.md",
    ],
  },
  {
    id: "true-system-prompt-channel",
    name: "True System Prompt Channel",
    status: "in-progress",
    summary:
      "Loads svvy's orchestrator, handler-thread, and workflow task-agent instructions through pi's real `systemPrompt` channel from the bound generated agent context, ignores pi `SYSTEM.md` and `APPEND_SYSTEM.md` prompt replacement or append files, preserves discovered `AGENTS.md` and `CLAUDE.md` files as read-only `external_instruction` records in the prompt path, sends new user input as real pi user messages without flattened transcript reconstruction or hidden durable state prose, slices generated capability declarations by actor so each surface sees only its own callable API, renders the active system prompt as expandable surface metadata instead of inline transcript text, fingerprints the exact generated agent context each surface received, shows stale surfaces from fingerprint mismatch with a checked-by-default update-before-next-turn intent, and enforces that intent by refreshing before prompt-bearing dispatch while allowing opt-out surfaces to keep running with their bound context.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/queued-messages.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
    ],
  },
  {
    id: "ambient-agent-resources",
    name: "Ambient Agent Resources",
    status: "in-progress",
    summary:
      "Defines provider-neutral ambient coding-agent resource categories for callable capabilities, executable extensions and packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, execution policy, and runtime state; persists an app-global default-off category ledger in General settings; preserves plain external instruction files such as `AGENTS.md` and `CLAUDE.md` as visible generated agent context through read-only external instruction records while keeping behavior-changing ambient resources disabled by default; and requires users to opt in by settings-scoped host, workspace, target agent/profile configuration, category, and source before those resources can affect prompts, generated API declarations, command routing, UI, provider/auth behavior, or execution policy.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/ambient-agent-resources-baseline.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
    ],
  },
  {
    id: "snippets",
    name: "Snippets Prompt Macros",
    status: "in-progress",
    summary:
      "Defines product-owned Snippets as explicit user-inserted prompt macros, with managed and read-only discovered Markdown records, a Snippets pane with source-filtered browsing for all, managed svvy, Claude, and pi snippets, per-snippet enablement that keeps disabled snippets visible in the pane while excluding them from composer `@` picker and typed mention commits, argument placeholders, editable expansion before send, transcript provenance metadata, and host runtime prompt-template or slash-command expansion kept disabled so snippets never grant tools, change actor capability, alter generated agent context, or add command guidance.",
    sourceSpecs: ["docs/specs/snippets.spec.md"],
  },
  {
    id: "extension-env-secrets",
    name: "Extension Env And Secrets",
    status: "in-progress",
    summary:
      "Defines app-global extension env declarations and app-managed values keyed by `(extensionId, envName)`, with user-only secret entry/update/removal through encrypted or OS-protected host secret-store material via the core-owned mutation-only `SecretStoreMutationPort`, trusted invocation value resolution through the read/resolve `SecretStorePort`, state-held secret references and coarse status only, local Extension Managing snapshot secret-state preservation without secret values, non-secret manifest defaults plus app-level overrides, status-only agent inspection through `list_extensions` and Extension Managing, build-time declaration validation separate from ready state, invocation-local explicit-env injection into only the specific Incur `svvyx` command or extension-facade invocation, and redaction across prompts, generated docs, tool output, logs, artifacts, transcripts, and snapshots; egress-proxy credential boundaries are not shipped product behavior.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension/svvyx-incur-runtime.spec.md",
      "docs/specs/extension/extension_managing.extension.spec.md",
      "docs/specs/extension/execute_typescript.extension.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
    ],
  },
  {
    id: "artifacts-projection",
    name: "Artifacts Projection",
    status: "shipped",
    summary:
      "Presents generated artifacts as explicit Dockview artifact inspector panes keyed by durable artifact identity, with visible HTML previews isolated in sandboxed iframes that grant script execution only without same-origin, navigation, popup, form, or parent/app escape permissions.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/artifacts.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
    ],
  },
  {
    id: "durable-artifact-storage",
    name: "Durable Artifact Storage And Artifacts Extension API",
    status: "in-progress",
    summary:
      "Stores artifacts in the configured artifact directory, defaulting to `~/.config/svvy/artifacts`, with storage directories keyed by the owning durable `workspaceSessionId`, writable mutable files directly under that directory, an `immutable/` child directory that remains read-only to ordinary command execution, runtime-owned byte materialization/deletion/digest/recovery, state-backed metadata facts only with exact stored filename, immutable flag, stored-path indexing, MIME type, byte size, digest, materialization status, created/deleted lifecycle fields, source-command/thread/workflow linkage, submitted `execute_typescript` source for every attempt, workflow-related logs and exports, durable handoff documents intended to be read, reassessed, or modified by later agents without inheriting full conversation context, and a builtin Artifacts `svvyx` extension whose concrete `create`, `inspect`, `list`, `open`, and `delete` command family supports empty artifact creation through exact `--name <filename.ext>`, copying through `--path` with optional exact rename, and `--immutable`, available through `svvyx artifacts ...` and the generated Incur-compatible `execute_typescript` facade `extensions.artifacts.run(...)` when Artifacts is loaded.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/artifacts.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/sandbox.spec.md",
    ],
  },
  {
    id: "execute-typescript-surface",
    name: "Direct Tools And Execute TypeScript",
    status: "in-progress",
    summary:
      'Provides Codex-like native Shell, Apply Patch, and Execute TypeScript extensions as the default coding-agent work interface, with `exec_command`, model-facing `write_stdin(session_id)`, `apply_patch`, and `execute_typescript` carrying command lifecycle, long-running session, streamed command output, structured patch/file-change previews, patch facts, and Codex-like approval-boundary decisions that are distinct from filesystem and network sandbox enforcement; separately exposes desktop, browser-tool, and headless command stdin through `runtime.commands.writeStdin({ commandId, text, clientSubmission })` by durable `CommandId`, with accepted stdin receipts projected through command inspector read models and invalidations rather than transcript mutation or Shell `session_id`; targets runtime-owned scoped sandbox launch facts through package-private `RuntimeLaunchPolicyService`, which delegates to `Sandbox.buildLaunchPolicy(...)` using app/bootstrap-supplied packaged helper candidates and host-support facts; Bun app-edge modules may compose layers and use the approved diagnostics surface, but must not import launch-policy internals, synthesize sandbox policy, assemble helper argv, or own Shell/Apply Patch/Execute TypeScript launch semantics; invokes `/usr/bin/sandbox-exec` for managed macOS launches, and preserves Codex-derived filesystem policy semantics including `Read`, `Write`, and `None` entries, most-specific path precedence, equal-specific `None > Write > Read` precedence, writable roots with read-only subpaths, protected metadata carveouts, network allow/deny, full-access sandbox omission, sandbox-denial reporting, and fail-closed profile generation; exposes simple execution settings for `approvalMode` (`auto-review`, `user`, or `full-access`) and default-on `networkAccess`, treats `svvyx ...` as ordinary Shell `exec_command` input to the real app-owned Incur CLI, and splits Shell loaded instructions into base command execution guidance plus separate Incur-backed `svvyx` CLI usage guidance; keeps `execute_typescript` as an actor-local TypeScript composition tool whose entire runtime is launched through the same approval and sandbox execution lane before submitted TypeScript runs, with runtime-owned approval admission, app `approvalMode`/`networkAccess` settings, and managed sandbox settings applied through the accepted native-tool execution lane, concrete generated facade declarations wired for builtin app-owned `svvyx` TypeScript facades, loaded instructions split between base TypeScript execution guidance and separate Incur facade usage guidance, and the only TypeScript extension surface an actor-scoped `extensions` object containing only actor-specific loaded callable TypeScript-enabled builtin facades, such as Artifacts or Workflows when loaded for that actor, shaped as `extensions["<id>"].run(extensionCommandId, input)`, with dot access allowed only for identifier-safe ids, imports from `incur/client` only for public Incur types and errors, generated command map types only for emitted facades, user `svvyx` extensions contributing no `execute_typescript` facades, no global `svvy` client, no broad injected `api` helpers, no local Incur actions or generated internals in agent-facing snippets, and cx staying prompt-only with no TypeScript facade; allows TypeScript to compose app-owned facade calls, validate product contracts, and project results, but not to assemble launch policy, assemble helper argv, or enforce filesystem or network sandbox policy with TypeScript-only validation or cleanup substitutes; preserves arbitrary TypeScript side effects as opaque unless they go through app-owned facade boundaries; produces preflight typecheck or compile diagnostics when available, has runtime materialize submitted TypeScript source as artifact files and commit DB-backed artifact metadata for every attempt, and rolls extension-facade child command facts under the parent.',
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extension/shell.extension.spec.md",
      "docs/specs/extension/apply_patch.extension.spec.md",
      "docs/specs/extension/execute_typescript.extension.spec.md",
      "docs/specs/extension/svvyx-incur-runtime.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/sandbox.spec.md",
    ],
  },
  {
    id: "live-tool-projection",
    name: "Live Tool Projection",
    status: "in-progress",
    summary:
      "Uses a Codex-like turn item model for live tool rendering: show an execution-span card as soon as the tool name is known, stream large argument snapshots before runtime execution, render `apply_patch` as structured file-change snapshots rather than many tiny patch calls, stream `exec_command` output and runtime progress through durable command events, nest `execute_typescript` extension-facade child commands under the parent, expose ordered argument snapshots and linked artifacts through command rollups and inspectors, settle spans from immutable terminal command facts, render collapsed spans with action/target/status/duration/counts/outcome, render expanded spans with bounded semantic sections for arguments, command target, file changes, diagnostics, progress, grouped stdout/stderr, child commands, and artifacts, route full output/raw facts through the inspector, and keep `svvyx ...` and prompt-only CLIs such as Smithers as command-family projections over `exec_command` without a workflow-specific renderer.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "request-user-input",
    name: "Request User Input Extension",
    status: "in-progress",
    summary:
      "Defines Request User Input as a builtin native dual-variant extension for orchestrator and handler-thread user clarification, exposing one `request_user_input` tool whose active nonblocking or blocking variant controls loaded instructions and schema descriptions; requires agent-authored question titles, one to three questions, Codex-like two to three choice options with exactly one `recommended: true` or a freeform `defaultAnswer`; has the extension handler validate input, derive default answers, and return one ordered `ExtensionRuntimeOperation` item wrapping a `request_input.create` runtime-effect request; has `@svvy/runtime` apply the request through core-owned request-input state ports implemented by `@svvy/state`, which allocates request/question/option ids and creates durable request records; runtime completes command facts, owns blocking waits/timeouts, exposes `runtime.requestInput.answer` with `AnswerRequestInputInput`, returns `AnswerRequestInputResult.delivery` variants for blocking resolution, nonblocking queued delivery, or recorded-only answers, and resolves blocking answers without later queue delivery; shows answerable questions in a side panel; defaults to nonblocking behavior that immediately returns the recommended/default answer; supports blocking behavior with a default-enabled five-minute timeout that falls back to the default answer; and keeps tool results free of mode, timer, UI availability, and internal id fields.",
    sourceSpecs: [
      "docs/specs/extension/request_user_input.extension.spec.md",
      "docs/specs/queued-messages.spec.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/package-architecture/package-architecture.spec.md",
      "docs/specs/package-architecture/core.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/state.spec.md",
    ],
  },
  {
    id: "extension-cli-requirements",
    name: "Extension CLI Requirements",
    status: "in-progress",
    summary:
      "Lets extensions declare required CLIs or command providers with a binary name, optional package name, default target version, version-check command, and reusable exact-version install/update command template when that provider is installed rather than `bunx`-resolved; reports missing, unknown, available, detected version, current version, latest version, and update-available state through Extension Managing inspect/build and the Extensions UI; keeps user-clicked Extensions UI install/update admission outside the shipped public runtime facade surface; excludes dependency-action admission from the shipped public runtime facade surface unless a runtime-owned contract specifies app-global scope, immutable dependency planning, durable command and approval facts, sandboxed package-manager execution, readiness refresh, invalidation, cancellation, shutdown, and recovery; keeps `@svvy/extensions` responsible for immutable dependency command planning and normalized dependency identity interpretation while committed dependency approval facts are DB/product-state-backed `@svvy/state` facts read through `ExtensionStatePort`, with optional origin workspace identity as UI lineage only; agent-initiated installs remain ordinary Shell work; uses default versioned requirements for `cx-cli@0.7.1`, Smithers documentation generated from `smithers-orchestrator@0.22.0` while preserving official `bunx smithers-orchestrator ...` commands, and `@tiny-fish/cli@0.1.6`; and keeps Git and GitHub CLI requirements unversioned because their builtin instructions are not pinned to a specific CLI release.",
    sourceSpecs: [
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension/git.extension.spec.md",
      "docs/specs/extension/github.extension.spec.md",
      "docs/specs/extension/cx.extension.spec.md",
      "docs/specs/extension/web.extension.spec.md",
      "docs/specs/extension/extension_managing.extension.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/state.spec.md",
    ],
  },
  {
    id: "web-tool-surface",
    name: "Prompt-Only TinyFish Web Extension",
    status: "in-progress",
    summary:
      "Defines Web as a builtin loaded by default prompt-only extension while `networkAccess` is enabled, disables Web through normal extension binding when network access is off, generates TinyFish CLI instructions from selected exact-version `@tiny-fish/cli` npm package artifacts, declares a default-target `tinyfish` CLI requirement with a reusable exact-version install/update template, teaches agents to authenticate the official TinyFish CLI and use `tinyfish search query` plus `tinyfish fetch content get` through ordinary shell commands, explicitly omits mutable TinyFish skill URLs as generated sources, `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript facades, Firecrawl, Web Provider settings, and svvy-owned TinyFish key storage, and tells agents to redirect large TinyFish JSON output to files when useful because the tested CLI writes search and fetch results to stdout by default.",
    sourceSpecs: [
      "docs/specs/extension/web.extension.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
    ],
  },
  {
    id: "handler-thread-surfaces",
    name: "Delegated Handler Thread Surfaces",
    status: "in-progress",
    summary:
      "Lets the orchestrator open pi-backed delegated handler threads as fully interactive conversation surfaces that own delegated objectives, with one shared native implementation exposed as `thread-orchestration` for orchestrators (`thread_start`, `thread_followup`, `thread_list`, `thread_episodes`, `thread_request_report`) and `thread-handling` for handlers (`thread_current`, `thread_group`, `thread_report`, `thread_episodes`) while workflow task agents receive neither extension by default; `thread_start` takes a required `threads[]` array, normally with one item, validates creation intent, and returns runtime operations for `@svvy/runtime` to create or append to one durable `threadGroupId`, defaults each item's `history` to `isolated`, allows explicit `forked` starts only for conservative continuity cases, allows multiple items only for separate user-visible handler conversations, and optionally applies each item's `overrides` map over the `threadHandler` profile with `loaded`, `available`, or `unavailable` states; the thread API keeps handler-thread UI titles outside agent results, leaves threads multi-turn and directly messageable before and after objective conclusion, exposes group identity, lets the orchestrator send corrections or later work through `thread_followup`, request one-handler updates through `thread_request_report`, lets handlers emit intermediate update episodes or sibling-forwarding requests through `thread_report`, and returns control to the orchestrator only through explicit `thread_report` calls with `outcome` that append ordered conclusion episodes and schedule typed orchestrator reconciliation notifications.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
    ],
  },
  {
    id: "agents-and-extensions",
    name: "Agents And Extensions Prompt Composition",
    status: "in-progress",
    summary:
      "Defines prompt composition around Agents and Extensions: agent profiles own model/reasoning, actor kind defaults, sparse per-extension usage overrides selected from compact Agents-pane Loaded/Available/Off UI controls, underlines overridden extension names consistently in compact and expanded rows, exposes an icon-only tooltiped action for overridden orchestrator and workflow task-agent rows in compact menus and immediately before expanded Loaded/Available/Off UI controls to make that row state the default for newly created surfaces of that actor kind, and links each row to the matching Extensions inventory record. The composer footer exposes the same extension usage control beside model and reasoning for active orchestrator and handler-thread surfaces, submits a runtime-backed request through core-owned state ports to update the surface's bound loaded/available/unavailable extension state, and saves orchestrator composer extension changes back to the profile when Follow composer is enabled. Normal builtin and user extensions share one composable base: editable minimal MDX instruction source except fixed always-loaded Extension Loading may omit it, zero or more loaded instruction contributors, editable MDX loaded contributors, scripted loaded contributors made from editable TypeScript generators plus read-only last generated Markdown/plain prompt output and regenerate/build action, per-contributor bypass state, remove-to-trash behavior for editable source contributors, optional CLI requirements, optional native tool schema, optional `svvyx` command source plus generated command schema, generated `execute_typescript` facade declarations only for app-owned builtin TypeScript-enabled `svvyx` extensions, local editable sources under `~/.config/svvy/extensions/sources/...` with packaged builtin defaults used only for scaffold/reset, editable source-backed `svvyx` `source/index.ts`, generated `commands.json` command schema, `@svvy/extensions`-derived customized tags, inventory filters, reset/delete controls, and requirement readiness surfaced through `list_extensions` and Extension Managing inspection. User `svvyx` extensions do not contribute generated `execute_typescript` facades. App-owned builtin `svvyx` namespaces whose runtime is implemented directly by `svvy`, including Extension Managing, expose a read-only generated command contract instead of editable runtime source and never emit native tool schemas. Direct builtin prompt text, including base prompts and native-tool guidance, is exposed as editable loaded source contributors rather than fake generated output; scripted contributors are reserved for extensions with a real generator/source pair such as cx, Web, or Smithers. External instruction records are separate read-only discovered instruction inputs with enabled/disabled plus selected actor-kind controls, no minimal hint, no loaded/available/unavailable row state, and no source lifecycle. Extension defaults are profile policy for subsequently created orchestrator sessions and workflow task-agent attempts; the singleton handler profile stays owned by Agents and can still be customized there. New user extensions start loaded by default for new orchestrators and workflow task agents unless the user changes their per-actor defaults before use, and existing surfaces change only through the normal generated-context fingerprint refresh flow. Extension snapshots include a default saved Initial baseline when no local snapshots exist, and user snapshots remain local restore points for extension source, generated package facts, usage, ordered contributors, bypass/default state, generated-contributor source/output state, customized tags, and coarse secret-state preservation. Base actor prompts are builtin instruction-only extensions: `base-common` is loaded by default for every adopted actor kind, while `base-orchestrator`, `base-handler`, and `base-workflow-task` are loaded by default by the corresponding default profile; other actor-specific behavior is modeled as separate extension ids rather than actor-conditional loaded text inside one extension. The shared native thread-control implementation is exposed as two builtin agent-facing extension records: `thread-orchestration` loaded by default only for orchestrators and `thread-handling` loaded by default only for handler threads. Generated context previews show loaded base instruction extensions, non-bypassed loaded contributors, active extension-row token estimates in an aligned column with available rows showing available-prompt estimates plus would-be loaded-prompt estimates in parentheses and Off rows omitted from token counting, workflow-agent inline instruction live token estimates on expanded source-file metadata rows, total generated prompt token estimates in expanded Agents rows that include the current workflow-agent inline instruction draft when present, native tool declarations, loaded svvyx guidance, and emitted generated `execute_typescript` facade declarations for app-owned builtin TypeScript-enabled `svvyx` extensions; workflow-agent autosave keeps unrelated row controls visually stable instead of using transient saving state as broad disabled styling; Incur-backed extensions are built behind one stable app-owned `svvyx <extension-id> ...` CLI, with usage state controlling generated guidance while generated TypeScript extension facades are emitted only for TypeScript-facade-enabled builtin `svvyx` extensions safe for the target actor, and dependency-backed build readiness uses DB/product-state-backed committed approval facts keyed by exact dependency and trusted-dependency identities rather than shell approval, resumes blocked build and snapshot-load install work after approval, installs from a controlled app-owned package plan with lifecycle scripts disabled unless the exact trusted identity is approved, and validates exact installed package artifacts before runtime use; builtin prompt-only cx guidance is loaded by default for all adopted agent kinds and teaches official `cx` CLI use through `exec_command`, builtin prompt-only Git guidance is loaded by default for all agent kinds, builtin prompt-only GitHub guidance is loaded by default for orchestrators and handler threads and available for workflow task agents, these prompt-only CLI extensions use ordinary shell commands without wrapper tools or injected `execute_typescript` TypeScript facades, and new surfaces bind to the latest ready generated agent context while existing surfaces show the Extensions-changed banner when their fingerprint differs.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension/svvyx-incur-runtime.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/extension/extension_managing.extension.spec.md",
      "docs/specs/extension/web.extension.spec.md",
      "docs/specs/extension/cx.extension.spec.md",
      "docs/specs/extension/git.extension.spec.md",
      "docs/specs/extension/github.extension.spec.md",
      "docs/specs/extension/external_instructions.extension.spec.md",
      "docs/specs/extension/extension_loading.extension.spec.md",
      "docs/specs/extension/artifacts.extension.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/package-architecture/package-architecture.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
    ],
  },
  {
    id: "smithers-cli-guidance",
    name: "Prompt-Only Smithers CLI Guidance",
    status: "in-progress",
    summary:
      "Defines Smithers as a builtin prompt-only extension for handler-thread workflow authoring, generated from the current Extension Managing-selected Smithers documentation version with a small svvy boundary appendix; agents use official `bunx smithers-orchestrator ...` commands through Shell against workspace `.smithers/` packages, TypeScript source imports from package `smithers-orchestrator`, reusable svvy assets are documented by the Workflows extension and imported only from generated `@svvyx/workflows`, and agents do not receive product workflow wrapper tools, Smithers runtime-control APIs or broad bridge tools, Smithers TypeScript facades, or workspace-local svvy workflow source guidance.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/smithers.extension.spec.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
    ],
  },
  {
    id: "extension-loading",
    name: "Extension Loading And Actor Capability Inspection",
    status: "in-progress",
    summary:
      "Exposes actor-local Extension Loading as native control tools for orchestrators, handler threads, and workflow task agents: `list_extensions` reads only loaded and available extension records for the current actor without exposing unavailable rows, secrets, fingerprints, cache keys, global profile defaults, generated prompt bodies, or generated TypeScript declaration previews; `load_extension` accepts one available ready extension for the current surface, returns a model-facing result plus an ordered runtime operation for the actor-local binding change, and has `@svvy/runtime` apply that operation through core-owned state ports, schedule the next-safe generated-context refresh, publish typed invalidations, and keep active pi declarations stable until the next safe pre-dispatch boundary. Extension Loading never builds extensions, approves dependencies, configures env/secrets, mutates profile defaults, or performs mid-turn prompt/tool mutation.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension/extension_loading.extension.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/state.spec.md",
    ],
  },
  {
    id: "workflow-task-agent-parameters",
    name: "Reusable Workflow Task-Agent Parameters",
    status: "in-progress",
    summary:
      "Represents reusable Smithers task-agent configuration as structured `TaskAgentParametersSource` records under `~/.config/svvy/workflows/agents`, generated as `Agents.*` exports such as `Agents.defaultAgent`, `Agents.reviewerAgent`, `Agents.implementerAgent`, and `Agents.explorerAgent` in `@svvyx/workflows`, with `Agents.defineTaskAgent(parametersOrAgentsExport)` returning the Smithers-compatible `AgentLike` for `<Task agent={...}>` and `Agents.TaskAgentParametersSource` also exported under the same namespace; the generated AgentLike calls the runtime-owned `runTaskAgent` operation through the app-bound local loopback route from a handler-thread command-scoped Smithers CLI child process, and accepted bridge work runs inside the app-owned `ManagedRuntime`; transport validates auth header shape and configured request body size first, generated clients enforce configured response body size, then `@svvy/runtime` decodes `RunTaskAgentSourceInput`, validates token lineage from `workspaceSessionId` and `sourceCommandId`, and owns idempotency, queueing, task-attempt lifecycle, generated context binding, command facts, and pi turn orchestration through `@svvy/pi-adapter`; the bridge sends unbranded task-agent params, required Smithers task-attempt identity `{ runId, nodeId, iteration, attempt }`, optional observed Smithers context `{ run, node, rootDir }`, exactly one prompt source as either a prompt string or a non-empty user/assistant message list, `workspaceSessionId`, and `sourceCommandId`, and receives `{ text, usage?, output? }`; Smithers owns workflow graph execution and workflow/run state, `@svvy/state` owns durable command/task-attempt/recovery/read-model and CLI-observed Smithers facts, and `@svvy/pi-adapter` owns pi session adaptation; bridge calls are concurrent, bind one workflow-task-attempt surface each, expose no arbitrary app RPC/shell/settings/orchestrator controls, and do not duplicate Smithers workflow/run state; Agents-pane edits and `svvyx workflows save --kind agent` write the same structured source, and build validates provider/model/reasoning plus sparse extension usage overrides against pi-normalized provider metadata and generated `@svvyx/extensions` instead of accepting freeform agent code.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/extension/workflows.extension.spec.md",
      "docs/specs/package-architecture/package-architecture.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
    ],
  },
  {
    id: "context-budget-observability",
    name: "Context Budget Observability",
    status: "shipped",
    summary:
      "Shows active context usage as a percentage of the current model's maximum for orchestrator surfaces, handler-thread surfaces, workflow task-agent attempts, and individual assistant messages, with neutral below 40%, orange from 40%, red from 60%, decimal percentages, and hover details so context pressure is visible without treating any single percentage as a universal model failure point.",
    sourceSpecs: ["docs/prd.md", "docs/specs/context-budget-observability.spec.md"],
  },
  {
    id: "workflows-extension",
    name: "Workflows Source Library Extension",
    status: "in-progress",
    summary:
      "Provides the builtin `svvyx workflows ...` source-library command family owned by `@svvy/extensions` for app-global reusable Smithers source: `list` reports generated export names and source/generated paths, `save` copies or extracts reusable agents, prompts, components, or workflows from a workspace path with strict overwrite handling and returns a model-facing command result plus an ordered `ExtensionRuntimeOperation` wrapping `generated_packages.refresh`; persistent workflow source is validated so self-imports from generated `@svvyx/workflows` are rejected before generated output is written, while app-owned type-contract, Smithers authoring, and generated-package-link imports are allowed only in the exact source contexts named by the generated-package spec; generated root locations are resolved through `GeneratedPackageRootPort`, not inferred from `~/.config/svvy/workflows`, command strings, or workflow source paths, and generated-root writes occur only during explicit app-owned build/refresh work; the model-facing result must not include runtime-effect payloads, scheduler ids, recovery ids, or workspace-link status; `build` returns a model-facing command result plus one ordered `ExtensionRuntimeOperation` wrapping `generated_packages.refresh` for both canonical generated packages, and runtime then calls `Extensions.generatedPackages.refresh(...)`, records app-global generated-package facts after atomic output replacement, and schedules runtime-owned workspace-link repair through the `@svvy/runtime` generated-package link repair service for acquired workspace scopes after those facts commit; `models list` reports pi-backed provider/model/reasoning options for task-agent parameter authoring; it never runs, resumes, approves, or inspects active Smithers workflows.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/extension/workflows.extension.spec.md",
      "docs/specs/package-architecture/package-architecture.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
    ],
  },
  {
    id: "saved-workflows-generated-surface",
    name: "Workflows Generated Surface",
    status: "in-progress",
    summary:
      "Surfaces the latest successful generated `@svvyx/workflows` package in a read-only Workflows pane with namespace, export name, qualified name, generated code, generated-file link, and source-file link for `Agents`, `Components`, `Prompts`, and `Workflows`; `Agents.*` rows also show the generated parameter object and a human UI link into the Agents pane for customization.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
      "docs/specs/package-architecture/state.spec.md",
    ],
  },
  {
    id: "prompt-history",
    name: "Workspace Prompt History",
    status: "shipped",
    summary:
      "Stores non-empty `@svvy/runtime`-accepted prompts per workspace after durable surface queue acceptance, and exposes shell-like recall in the composer.",
    sourceSpecs: [
      "docs/specs/prompt-history.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/state.spec.md",
    ],
  },
  {
    id: "queued-surface-messages",
    name: "Queued Surface Messages",
    status: "in-progress",
    summary:
      "Lets users submit ordinary composer messages only to orchestrator and handler-thread surfaces, while orchestrator tools, Smithers task-agent bridge calls, and `@svvy/runtime` coordinators insert prompt-bearing or surface-control work for their allowed target surfaces, all through a durable FIFO queue owned by the target `surfacePiSessionId`; ordinary sends, idle sends, `thread_followup` requests, initial handler starts, report requests, thread report notifications, nonblocking request-input answer deliveries created by the runtime answer API, and `workflow_task_agent_start` bridge/coordinator deliveries go through the queue manager, while generated-context refresh is scheduled and enforced by `@svvy/runtime` at safe pre-dispatch boundaries instead of as a visible queue row; a row-level `Steer` action promotes a durable row to the front for ordered next-turn delivery rather than injecting a direct pi steering prompt; queued items are claimed atomically by one shared runtime-owned queue dispatcher lane per `surfacePiSessionId`, active-surface follow-ups stay visible as editable queued rows until claimed, queue insertion and claiming are separate committed transitions, ordinary composer sends serialize the visible composer buffer into plain submission data, keep the visible composer draft unchanged and create no prompt-history row until `@svvy/runtime` queue acceptance, then atomically clear the durable draft and record exact workspace-scoped prompt history in `@svvy/state` before renderer refetch while invalidating stale delayed draft writes, committed user transcript messages expose copy plus edit-and-resend with a visible transcript highlight for the message under edit and a draft-replacement warning before overwriting non-empty composer input, then move the same pi surface back to the original message's parent state before continuing from the edited message, queue rows remain structured product state until delivered, survive panel focus changes and duplicated panels, and stay recoverable across restart, cancellation, restore-to-composer, and pre-accept delivery failure.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/queued-messages.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
    ],
  },
  {
    id: "composer-mention-links",
    name: "Composer Mention Links",
    status: "shipped",
    summary:
      "Lets the composer autocomplete indexed workspace files and folders after `@` as ordinary inline `@path` text, attach picker/drop/paste files as removable chip-only attachments without mutating textarea text, render sent file, folder, and image attachments as transcript tiles without visible attachment-provenance prose, pass attachment paths through tagged agent-facing metadata, send images to pi as image content blocks while warning when model metadata does not list image input, and render sent transcript mentions as actionable workspace links that reveal files, open folders, and visibly mark missing paths without eager file reads, folder expansion, or a special context-target model.",
    sourceSpecs: ["docs/prd.md", "docs/specs/composer-mention-links.spec.md"],
  },
  {
    id: "assistant-markdown-rendering",
    name: "Assistant Markdown Rendering",
    status: "shipped",
    summary:
      "Renders streamed assistant transcript Markdown inside a TanStack Virtual transcript surface with compact prose spacing, reliable list markers, GitHub-style tables and task lists, syntax-highlighted fenced code blocks with copy actions, inline and display math through KaTeX, Mermaid diagrams rendered as SVG with source copy fallback, escaped raw HTML so assistant output cannot inject executable markup, muted collapsed-by-default reasoning blocks that render visible reasoning text as Markdown rather than preformatted code, variable-height row measurement, pane-local scroll restoration, and bottom-following only while the user is pinned there; live assistant output reaches the renderer as app/bootstrap-derived, renderer-safe ordered `surface.stream` patches, while baseline, recovery, and settled views come from state-backed surface read-model fetches and rebaseline notifications; active assistant work shows a durable elapsed clock in the composer, and completed assistant transcript messages show the persisted turn duration from structured turn start and finish timestamps.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "workspace-navigation-core-projection",
    name: "Workspace Navigation And Core Projection",
    status: "in-progress",
    summary:
      "Keeps each workspace tab navigable with pinned, regular Sessions, and Archived session groups in a shared sidebar band between creation/search actions and reference panes; each group uses the same collapsible accordion header style, keeps its own independently scrollable and resizable space, persists collapsed state and size across restart, and keeps Archived collapsed by default. It also provides durable session-level unread dots that appear when assistant turns finish outside the focused pane surface and clear on session-pane focus or explicit mark-read action, layered sidebar rows where orchestrator session state and handler-thread state stay local to their owning rows, session row context menus for mark read or unread, pin, rename, archive, and a menu-local Confirm delete action, normal session-row clicks that open in the focused Dockview panel with Cmd-click opening a new pane, compact running indicators, tone-aware open-pane highlighting, context-budget rails for open orchestrator and handler rows, a sidebar footer that shows the current git branch with a branch icon and opens a local-branch switcher when the workspace is a git repo, compact thread artifact blocks backed by durable artifact records, and restart restoration for stable Dockview panel bindings, static inspector pane targets, focus, panel-local scroll, display preferences, durable composer drafts, and session-group layout while deliberately excluding transient UI, transcript selections, and stale live stream state.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/pane-layout.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
      "docs/specs/multi-session-support.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "command-palette",
    name: "Command Palette And Quick Open",
    status: "in-progress",
    summary:
      "Defines a VS Code-like shared palette where `Cmd+Shift+P` opens the same input as `Cmd+P` with `>` prefilled, those launcher chords remain available while text inputs are focused and switch the focused palette between command and quick-open modes when it is already open, the leading `>` live-switches quick-open search into command/action mode, command mode discovers and executes product actions through existing session, surface, orchestrator, handler-thread, Dockview panel, settings, Agents profile routing, Extensions routing, and read-only Workflows visibility, including profile-specific New orchestrator actions, a product shortcut registry backed by TanStack Hotkeys owns scoped renderer dispatch, input policy, and shared shortcut display, sidebar app actions reveal compact shortcut hints instantly on hover or focus, New orchestrator uses `Cmd+N` for the focused pane and `Cmd+Shift+N` for a new pane, Logs, Agents, Extensions, and Workflows open from `Cmd+Shift+1/2/3/4` in sidebar order, icon-only or ambiguous action controls show faster delayed explanatory tooltips with consistent keycap chips, open-session results show visually distinct kind badges across orchestrator and handler-thread categories, `Cmd+P` opens reserved file quick-open mode with disabled or empty results until file surfaces are part of the product contract, `cmdk-sv` is the intended Svelte UI primitive, and unmatched non-empty command-mode text creates a normal new orchestrator initial prompt without the `>` prefix or a parallel runtime, shell, terminal loop, or workflow abstraction.",
    sourceSpecs: ["docs/prd.md", "docs/specs/command-palette.spec.md"],
  },
  {
    id: "agent-profiles",
    name: "Agents Pane And Agent Profiles",
    status: "in-progress",
    summary:
      "Provides an Agents pane between Logs and Extensions for editing DB-backed app-wide orchestrator profiles and the delegated-handler `threadHandler` profile, plus workflow-agent rows whose provider, model, reasoning, instructions, extension usage overrides, and source-order metadata live in file-backed `~/.config/svvy/workflows/agents/*.agent.json` source while `@svvy/state` stores source-version, fingerprint, diagnostic, generated-package, link, and read-model/index facts for those rows and `@svvy/extensions` resolves bindings and generated actor context; uses builtin `base-*` instruction extensions for base role prompts, prevents orchestrator and handler-thread profiles from carrying profile-local instruction text, prepends workflow-agent row instructions as the only non-extension instruction input before that workflow task agent's generated extension context, lets users create or duplicate additional orchestrator profiles and workflow-agent parameter records, deletes user-created profiles or workflow-agent rows through an inline single-confirm action, drives the New orchestrator picker order and profile badges from the orchestrator-profile order, keeps the default orchestrator profile locked, first, non-draggable, and non-deletable while still allowing settings edits, keeps the default Explorer, Implementer, and Reviewer workflow agents non-deletable while still allowing edits and duplication, autosaves workflow-agent instruction textarea edits after a short debounce with an icon-only unsaved/saving/saved/failed state inside the textarea while preserving saved source whitespace and trimming only during prompt composition, links each workflow-agent row to its exact `.agent.json` source file and shows a live inline-instruction token estimate beside that link only when the row is expanded, lets profile-backed orchestrator sessions optionally save composer model and reasoning changes back to their profile for newly created sessions using that profile, uses internal title-naming settings for top-level session titles and handler-thread titles derived from delegated objectives without exposing title naming as a special profile, uses the delegated-handler `threadHandler` profile for delegated handler-thread surfaces with partial extension-state overrides available through `thread_start.threads[].overrides`, shows expanded orchestrator, handler, and workflow-agent rows as one extension list with usage controls, open-extension links, aligned active extension-row token estimates, available-row available-prompt estimates with loaded-prompt estimates in parentheses, expandable generated instruction text, Off rows at the end without token counts, drag-only active-row ordering animation, stable in-place Loaded/Available/Off state updates, reset-selection/reset-order actions, and the total generated prompt token estimate beside those reset controls while including the current workflow-agent inline instruction draft, exposes focused-surface agent summaries in pane chrome, and uses direct-saving profile editors with connected-provider model dropdowns plus selected-model reasoning dropdowns derived from pi's normalized model metadata and runtime thinking controls rather than svvy-owned provider/model special cases.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/command-palette.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/extensions.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
    ],
  },
  {
    id: "multi-session-support",
    name: "Multi-Session Workspace Navigation",
    status: "shipped",
    summary:
      "Supports creating, listing, switching, renaming, forking, pinning, archiving, and confirmed context-menu deletion for multiple pi-backed session containers from one workspace window, with archive serving as the normal hide action while preserving session history, live provisional titles from the first orchestrator composer draft or first user message until the durable one-shot namer title lands, top-level session auto-titling owned by a durable namer flow that starts concurrently with the first orchestrator turn, the namer settings prompt as the sole naming instruction, manual rename blocked while title generation is pending or running, titles frozen after manual rename or the first successful generated title, and delegated handler titles owned by the same namer flow over the handler objective rather than by an orchestrator-supplied title.",
    sourceSpecs: ["docs/specs/multi-session-support.spec.md"],
  },
  {
    id: "multi-surface-runtime",
    name: "Multi-Surface Live Runtime",
    status: "in-progress",
    summary:
      "Separates integrated app-chrome workspace tabs, shared durable workspace state, live surface runtime scopes, and Dockview-backed workspace layout slots, using one `@svvy/runtime` workspace runtime scope per durable `workspaceId` with canonical cwd as workspace acquisition input and explicit `workspaceId` routing for every workspace-scoped request and sync event, never active workspace routing; keeps workspace tabs as chrome state that select `workspaceId` plus active layout id instead of owning durable layouts; opens a real svvy-owned default workspace tab when no user workspace tabs restore, with the same durable A/B/C layout behavior as user workspaces and the only default-workspace exception that an empty selected layout slot is seeded with one `Open Workspace` pane; lets `Open Workspace` retarget the current visual tab, `New Tab` create another default workspace tab over the shared default workspace scope and selected durable layout slot, and `Open Workspace in New Tab` create a selected user workspace tab; allows opening the same cwd in multiple visual workspace tabs that share the same workspace runtime scope, session navigation read models, pi sessions, structured state, prompt queues, handler threads, app logs, workspace read models, generated Workflows export read models projected from generated-package facts, and fixed durable layout slots keyed by `(workspaceId, layoutId)`; keeps workspace tabs left-aligned at the start of the main chrome, horizontally scrollable when crowded, draggable for user reordering, durably restored in user-defined order, and paired with compact icon controls plus colored running, unread, waiting, and error count badges shown only above zero with hover context; uses Dockview core for panels, groups, tabs, tab groups, splitters, drag/drop overlays, edge groups, floating groups, popouts, and serialized layout restore inside fixed workspace layout slots A, B, and C pinned at the far right while svvy stores panel-to-surface bindings and panel-local metadata in those slots; keeps empty user workspace layout slots muted but selectable; has `@svvy/runtime` manage the shared live-surface registry keyed by `surfacePiSessionId`, per-surface prompt locks, model or reasoning lifecycle, pending user message, queued follow-up messages, and surface-owned live assistant stream state; supports explicit open and close semantics, sidebar panel-location indicators, compact thread projections, and lets zero, one, or multiple desktop panels attach to the same streaming surface without duplicating or cancelling the underlying live surface runtime scope while keeping panel-local scroll independent per panel.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/default-workspace-and-open-workspace.spec.md",
      "docs/specs/multi-session-support.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/pane-layout.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
      "docs/specs/package-architecture/package-architecture.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
      "docs/specs/package-architecture/desktop.spec.md",
    ],
  },
  {
    id: "workspace-runtime-recovery",
    name: "Workspace Runtime Recovery Coordinator",
    status: "in-progress",
    summary:
      "Defines one `@svvy/runtime` recovery coordinator per acquired workspace runtime scope, with duplicate tabs for the same durable `workspaceId` sharing recovery state, app-wide auth/preferences kept outside workspace recovery, durable runtime recovery rows with transactional claims, leases, not-before/next-attempt timestamps, and idempotency keys for prompts, queues, initial handler starts, thread report notifications, report requests, request-input records, answer records, any nonblocking queued answer deliveries, waits, title jobs, generated `@svvyx/extensions` and `@svvyx/workflows` refresh plus separate workspace-link repair, and recovery observability; startup settles active-turn recovery first, normalizes stale claims after workspace state registration, restores surviving blocking request-input waiters and timers during runtime acquisition before queue replay, routes claimed queue delivery through the runtime-owned queue wake/drain lane, and fails or retries any claimed work without a concrete owner handler, while renderer layout restore remains only a consumer of state-backed read models.",
    sourceSpecs: [
      "docs/specs/workspace-runtime-recovery.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
    ],
  },
  {
    id: "structured-session-state",
    name: "Structured Session State Overlay",
    status: "in-progress",
    summary:
      "Adds `@svvy/state`-backed durable workspace/session facts and read-model projections coordinated by `@svvy/runtime` above pi sessions adapted through `@svvy/pi-adapter`, including surface composer drafts, turns, handler threads, commands, episodes, artifacts, Workflows generated export metadata, attention, lifecycle projection records, explicit surface-target identity (`workspaceSessionId`, `surfacePiSessionId`, `threadId`), immutable terminal command facts, selector-projected argument snapshots, and workspace-level metadata projection that survives reload while leaving live-surface transcript updates separate from durable workspace read models.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
    ],
  },
  {
    id: "turn-command-state",
    name: "Turn And Command State",
    status: "in-progress",
    summary:
      "Tracks every turn on the orchestrator surface and handler thread surfaces, including each turn's top-level turn decision, plus every tool call including execute_typescript snippets, request_user_input calls, and extension-facade child command facts, as durable state with lifecycle status, ownership, linkage, attempts, trace-versus-surface visibility, ordered command projection events for argument snapshots, output, progress, patch/file-change snapshots, approvals, request-user-input waiting, generic waits, child links, workspace diff updates, and terminal facts that cannot be overwritten after a command reaches a terminal state.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/live-tool-projection.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/package-architecture/core.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
    ],
  },
  {
    id: "session-threads",
    name: "Structured Handler Threads",
    status: "in-progress",
    summary:
      "Tracks delegated handler threads as durable interactive surfaces keyed separately from workspace session containers and pi surface ids, with durable thread-group topology, objective, objective state, history mode, worktree context, explicit orchestrator follow-up and re-engagement of concluded objectives through `thread_followup({ activate: true })`, pending report requests, latest command fields, CLI-observed Smithers workflow/run/task summary fields, latest report fields projected by `@svvy/state` selectors, and multiple update or conclusion episodes over the thread's lifetime without flattening delegated-work outcome into thread objective state or replacing the objective with latest report text.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/pi-adapter.spec.md",
    ],
  },
  {
    id: "durable-episodes",
    name: "Durable Episodes",
    status: "in-progress",
    summary:
      "Stores reusable semantic outputs as first-class episode records, with handler threads able to emit multiple ordered update or conclusion episodes over their lifetime through explicit `thread_report` calls whose conclusion success boundary is durable episode recording plus objective-state conclusion, while ordinary orchestrator work and tool runs keep their own command summaries and artifacts.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/thread_managing.extension.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
    ],
  },
  {
    id: "session-wait-state",
    name: "Session Wait And User Input State",
    status: "in-progress",
    summary:
      "Represents handler-owned blocking conditions and request-user-input clarification records explicitly through surface-local request/wait state and whole-session frontier state, preserving the product meaning of user input, approval, or other external dependency while requiring user clarification waits to point at real request-user-input records.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/extension/request_user_input.extension.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
    ],
  },
  {
    id: "session-summary-read-models",
    name: "Metadata-First Session Read Models",
    status: "in-progress",
    summary:
      "Derives orchestrator-local idle, running, waiting, and error session status, pinned and archived navigation fields, row-local handler-thread projections, pending attention, generated Workflows export read models projected from generated-package facts, and compact summary data from structured state for workspace navigation and restart recovery without rolling child handler lifecycle state into the parent session row, transcript replay, transcript-file heuristics, or any global active-surface overlay.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
      "docs/specs/package-architecture/generated-packages.spec.md",
    ],
  },
  {
    id: "app-logs-surface",
    name: "App Logs Surface",
    status: "shipped",
    summary:
      "Provides workspace-scoped product observability through structured, redacted, persisted app logs with monotonic sequence numbers, unread state, and live renderer refetches driven by runtime-owned `appLogs` invalidations after app/bootstrap observes real committed app-global or workspace app-log facade appends, plus a sidebar Logs entry with compact action-worthy unread badges for warning and error logs only, and a dense Dockview logs pane with TanStack Virtual long-scroll rendering, persisted scroll position during live updates, older-page loading, level/grouped-source/search filtering, viewport-based mark-read behavior for unfiltered browsing, smooth explicit jump-to-latest with reduced-motion fallback, expandable details, normalized errors, stack traces, and related session, surface, thread, workflow, task, command, and artifact ids without making logs canonical product state.",
    sourceSpecs: [
      "docs/specs/app-logs.spec.md",
      "docs/specs/package-architecture/core.spec.md",
      "docs/specs/package-architecture/state.spec.md",
      "docs/specs/package-architecture/runtime.spec.md",
    ],
  },
];
