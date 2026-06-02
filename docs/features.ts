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
    status: "shipped",
    summary:
      "Runs svvy as a native desktop coding app with a Bun-side pi host and renderer shell, including a svvy-owned default workspace runtime used when no user workspace tabs restore.",
    sourceSpecs: ["docs/prd.md", "docs/specs/default-workspace-and-open-workspace.spec.md"],
  },
  {
    id: "provider-auth",
    name: "Provider Auth And Settings",
    status: "shipped",
    summary:
      "Manages app-global provider keys, OAuth-backed access, web provider selection, icon-only provider key/OAuth/remove controls with tooltip explanations and inline remove confirmation, and a General settings surface for app appearance (`system`, `light`, or `dark`) and the user's preferred external editor with backend-authoritative persistence, while leaving pi-backed agent profile configuration to the Agents pane and keeping workspace-affecting operations on explicit `workspaceId`-routed requests.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "true-system-prompt-channel",
    name: "True System Prompt Channel",
    status: "in-progress",
    summary:
      "Loads svvy's orchestrator, handler-thread, and workflow task-agent instructions through pi's real `systemPrompt` channel from the bound generated agent context, ignores pi `SYSTEM.md` and `APPEND_SYSTEM.md` prompt replacement or append files, preserves discovered `AGENTS.md` and `CLAUDE.md` files as read-only `external_instruction` extension records in the prompt path, sends new user input as real pi user messages without flattened transcript reconstruction or hidden durable state prose, slices generated capability declarations by actor so each surface sees only its own callable API, renders the active system prompt as expandable surface metadata instead of inline transcript text, fingerprints the exact generated agent context each surface received, and automatically applies ready agent context updates through durable `agent_context_refresh` queue work before later prompt-bearing turns or at the next safe active-run boundary.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/queued-messages.spec.md",
    ],
  },
  {
    id: "ambient-agent-resources",
    name: "Ambient Agent Resources",
    status: "in-progress",
    summary:
      "Defines provider-neutral ambient coding-agent resource categories for callable capabilities, executable extensions and packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, execution policy, and runtime state; preserves plain external instruction files such as `AGENTS.md` and `CLAUDE.md` as visible generated agent context through read-only extension records while keeping behavior-changing ambient resources disabled by default; and requires users to opt in by settings-scoped host, workspace, actor class, category, and source before those resources can affect prompts, generated API declarations, command routing, UI, provider/auth behavior, or execution policy.",
    sourceSpecs: ["docs/prd.md", "docs/specs/ambient-agent-resources-baseline.spec.md"],
  },
  {
    id: "snippets",
    name: "Snippets Prompt Macros",
    status: "in-progress",
    summary:
      "Defines product-owned Snippets as explicit user-inserted prompt macros, with managed and read-only discovered Markdown records, a Snippets pane, composer `@` picker insertion, argument placeholders, editable expansion before send, transcript provenance metadata, and host runtime prompt-template or slash-command expansion kept disabled so snippets never grant tools, change actor capability, alter generated agent context, or mount commands.",
    sourceSpecs: ["docs/specs/snippets.spec.md"],
  },
  {
    id: "extension-env-secrets",
    name: "Extension Env And Secrets",
    status: "in-progress",
    summary:
      "Defines app-global extension env declarations and app-managed values keyed by `(extensionId, envName)`, with user-only secret entry/update/removal, encrypted local secret storage, non-secret manifest defaults plus app-level overrides, status-only agent inspection through `list_extensions` and Extension Managing, build-time declaration validation separate from ready state, process-local runtime injection into only the specific trusted extension command or generated extension-client invocation, and redaction across prompts, generated docs, tool output, logs, artifacts, transcripts, and snapshots while deferring egress-proxy credential boundaries.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension-managing.spec.md",
      "docs/todo.md",
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
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
    ],
  },
  {
    id: "durable-artifact-storage",
    name: "Durable Artifact Storage",
    status: "in-progress",
    summary:
      "Moves artifacts into a dedicated workspace artifact directory with SQLite metadata and path indexing, including submitted `execute_typescript` source for every attempt and workflow-related logs and exports.",
    sourceSpecs: ["docs/prd.md", "docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "execute-typescript-surface",
    name: "Direct Tools And Execute TypeScript",
    status: "in-progress",
    summary:
      "Provides Codex-like native filesystem tools as the default coding-agent work interface, with `exec_command`, `write_stdin`, and `apply_patch` carrying command lifecycle, long-running session, and patch facts; keeps `execute_typescript` as an actor-local TypeScript composition tool with generated svvy and loaded-extension clients as the preferred typed interface; preserves arbitrary TypeScript side effects as opaque unless they go through svvy-owned client boundaries; produces preflight typecheck or compile diagnostics when available, stores file-backed source artifacts for every attempt, and rolls generated-client child command facts under the parent.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/execute-typescript.spec.md",
      "docs/specs/web-tools.spec.md",
    ],
  },
  {
    id: "web-tool-surface",
    name: "Provider-Backed Web Extension",
    status: "shipped",
    summary:
      "Lets users choose TinyFish or Firecrawl as the active keyed web provider in settings, store provider API keys there, expose provider-shaped `web_search` and deterministic artifact-backed `web_fetch` tools plus generated web clients only when the selected provider is ready, use TinyFish's official TypeScript SDK for TinyFish Search and Fetch contracts and runtime calls, regenerate the Web extension's generated agent context and native tool declarations cleanly on provider changes, and keep the default product state web-disabled with no no-key Local fallback.",
    sourceSpecs: ["docs/specs/web-tools.spec.md"],
  },
  {
    id: "handler-thread-surfaces",
    name: "Delegated Handler Thread Surfaces",
    status: "in-progress",
    summary:
      "Lets the orchestrator open pi-backed delegated handler threads as fully interactive conversation surfaces that supervise one delegated objective, immediately start the handler's first turn from the raw objective, explicitly resume a completed handler thread through `thread_resume` when follow-up work belongs in the same delegated context, optionally apply handler creation-time extension overrides such as loading `project-ci`, derive handler-thread titles through the configured `namer` from the supplied objective instead of exposing a separate title field to the orchestrator, stay multi-turn and directly messageable before and after handoff, expose runtime and thread state through `runtime_current`, `thread_current`, `thread_list`, and `thread_handoffs`, distinguish idle, handler-active, workflow-active, waiting, troubleshooting, and completed thread states, reject `thread_handoff` while the thread still owns a running or waiting workflow run for the current span, route workflow attention back to the owning handler surface rather than the focused Dockview panel, can be inspected on demand without becoming the default reconciliation path, and return control to the orchestrator only through explicit `thread_handoff` calls that append ordered handoff episodes over the thread's lifetime and schedule typed orchestrator reconciliation notifications.",
    sourceSpecs: ["docs/prd.md", "docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "agents-and-extensions",
    name: "Agents And Extensions Prompt Composition",
    status: "in-progress",
    summary:
      "Reframes prompt composition around Agents and Extensions: agent profiles own base instructions, model/reasoning, actor kind, and per-extension usage states, while Extensions own shipped, user, and external_instruction capability records with loaded full instructions, available minimal loading hints, generated previews, and reset/delete controls appropriate to category. Generated context previews show base instructions, loaded extension instructions, available loading hints, read-only external instruction files such as `AGENTS.md` and `CLAUDE.md` with open-external-file controls, native tool declarations, loaded svvyx guidance, and generated TypeScript client declarations; new surfaces bind to the latest ready generated agent context and existing surfaces receive durable `Update agent context` work when their fingerprint differs.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension-managing.spec.md",
      "docs/specs/web-tools.spec.md",
      "docs/specs/project-ci.spec.md",
      "docs/specs/structured-session-state.spec.md",
    ],
  },
  {
    id: "smithers-tool-surface",
    name: "Smithers-Native Extension Interface",
    status: "in-progress",
    summary:
      "Exposes Smithers-native semantic workflow control and inspection tools through the Bun bridge for handler-thread surfaces, with normal startup discovering only configured saved entries under `.svvy/workflows/entries/` and artifact entries under `.svvy/artifacts/workflows/`, a stable `smithers_run_workflow({ workflowId, input, runId? })` tool validated against each entry's real TypeScript or Zod launch schema where supplied `runId` resumes exactly that run, omitted `runId` requests a fresh launch, omitted `runId` is rejected when the same handler already owns a nonterminal run with the same `workflowId`, and different `workflowId` values can run concurrently under one handler, `smithers_list_workflows({ workflowId?, productKind? })` returning full runnable-entry contract metadata including `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, `launchInputSchema`, and optional product metadata such as Project CI `productKind` and result schema, `smithers_list_runs` returning workspace-global compact run summaries enriched with svvy `sessionId` and `threadId` ownership when known, and the rest of the handler-thread surface preserving official Smithers names such as `get_run`, `watch_run`, `explain_run`, `list_pending_approvals`, `resolve_approval`, `get_node_detail`, `list_artifacts`, `get_chat_transcript`, `get_run_events`, `runs.cancel`, `signals.send`, `frames.list`, `getDevToolsSnapshot`, and `streamDevTools` instead of inventing a parallel svvy `workflow_*` abstraction, while preserving transport and invocation metadata in command facts, returning an empty workflow list when no real entries are configured, and avoiding any dependency on the repo authoring workspace under `workflows/`.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-supervision.spec.md"],
  },
  {
    id: "workflow-task-agents",
    name: "Workflow Task Agents",
    status: "in-progress",
    summary:
      "Defines lower-level Smithers workflow task agents as a separate actor class beneath handler threads, using a PI-backed svvy task configuration with a task-local generated capability set including cx semantic navigation plus `execute_typescript`, no ambient pi built-ins or extension-tool leakage, task-root or worktree execution aligned to the active Smithers attempt, first-class svvy workflow-task-attempt UI projection rows keyed by exact Smithers attempt identity before task-local tool calls run, Smithers-owned message-native retry and hijack continuation, live task-agent activity streaming, and svvy command/artifact/usage projections linked to the Smithers attempt, while keeping attempt lifecycle, approval, wait, output, transcript, and hijack execution facts in Smithers and outside ordinary task-agent tools.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/workflow-supervision.spec.md",
      "docs/specs/execute-typescript.spec.md",
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
    id: "workflow-library",
    name: "Workflow Authoring And Artifact Workflows",
    status: "in-progress",
    summary:
      "Centers workflow execution around authored artifact workflows stored under `.svvy/artifacts/workflows/`, with handler threads using the loaded Smithers extension and generated workflow-authoring TypeScript contracts, checking saved entries and reusable assets before authoring, using `workflow_list_models` to inspect available provider/model/reasoning choices when creating fresh task-agent configuration, authoring through reusable definitions, prompts, and components when needed, and launching concrete saved or artifact entries through the Smithers-native runtime interface.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-library.spec.md"],
  },
  {
    id: "saved-workflow-library",
    name: "Workspace Workflows Library",
    status: "shipped",
    summary:
      "Stores reusable workflow source assets under `.svvy/workflows/definitions`, `prompts`, and `components`, stores launchable saved entries under `.svvy/workflows/entries`, exposes minimal asset index metadata from required JSDoc and MDX frontmatter, reserves workflow-agent component conventions for future packaged-app-safe Workflows behavior rather than repo-root `workflows/` runtime state, supports optional product metadata and result schemas on entries such as Project CI, lets handlers inspect saved asset source through `exec_command`, validates `apply_patch` writes under `.svvy/workflows/...` automatically through structured tool output, and presents a read-only Workflows surface with source previews, diagnostics, deletion controls, and open-in-editor handoff to the user's configured external editor, with all workspace-affecting Workflows operations routed by explicit `workspaceId` instead of active workspace state.",
    sourceSpecs: ["docs/prd.md", "docs/specs/workflow-library.spec.md"],
  },
  {
    id: "prompt-history",
    name: "Workspace Prompt History",
    status: "shipped",
    summary:
      "Stores non-empty submitted prompts per workspace, including failed and provider-blocked attempts, and exposes shell-like recall in the composer.",
    sourceSpecs: ["docs/specs/prompt-history.spec.md"],
  },
  {
    id: "queued-surface-messages",
    name: "Queued Surface Messages",
    status: "in-progress",
    summary:
      "Lets a user, orchestrator, or backend coordinator submit prompt-bearing and surface-control work to an orchestrator or handler-thread surface by placing it in a durable FIFO queue owned by the target `surfacePiSessionId`; ordinary sends, idle sends, `thread_resume` requests, initial handler starts, workflow-attention wake-ups, and agent context refreshes do not bypass the queue manager, while a row-level `Steer` action promotes a durable row to the front for ordered next-turn delivery rather than injecting a direct pi steering prompt; the queue is a typed surface queue where all surfaces accept `user_message`, `agent_context_refresh`, `initial_handler_start`, and `workflow_attention` items, and the orchestrator also accepts `handler_handoff` notification items created after durable `thread_handoff` recording; queued items are claimed atomically by one shared queue runner per `surfacePiSessionId`, active-surface follow-ups stay visible as editable queued rows until claimed, idle-surface items are claimed before renderer-visible queued state so their first visible state is pending or active work, committed user transcript messages expose copy plus edit-and-resend with a visible transcript highlight for the message under edit and a draft-replacement warning before overwriting non-empty composer input, then move the same pi surface back to the original message's parent state before continuing from the edited message, queue rows remain structured product state until delivered as real pi input, handoff notification, or agent context refresh, survive panel focus changes and duplicated panels, write user prompt history once at queue time only for user messages, and stay recoverable across restart, cancellation, restore-to-composer, and pre-accept delivery failure.",
    sourceSpecs: ["docs/prd.md", "docs/specs/queued-messages.spec.md"],
  },
  {
    id: "composer-mention-links",
    name: "Composer Mention Links",
    status: "shipped",
    summary:
      "Lets the composer autocomplete indexed workspace files and folders after `@` as ordinary inline `@path` text, attach picker/drop/paste files as removable chip-only attachments without mutating textarea text, render sent file, folder, and image attachments as transcript tiles without visible attachment-provenance prose, pass attachment paths through tagged agent-facing metadata, send images to pi as image content blocks while warning when model metadata does not list image input, and render sent transcript mentions as actionable workspace links that reveal files, open folders, and visibly mark missing paths without eager file reads, folder expansion, or a special context-target model.",
    sourceSpecs: ["docs/specs/composer-mention-links.spec.md", "docs/progress.md"],
  },
  {
    id: "assistant-markdown-rendering",
    name: "Assistant Markdown Rendering",
    status: "shipped",
    summary:
      "Renders streamed assistant transcript Markdown inside a TanStack Virtual transcript surface with compact prose spacing, reliable list markers, GitHub-style tables and task lists, syntax-highlighted fenced code blocks with copy actions, inline and display math through KaTeX, Mermaid diagrams rendered as SVG with source copy fallback, escaped raw HTML so assistant output cannot inject executable markup, muted collapsed-by-default reasoning blocks that render visible reasoning text as Markdown rather than preformatted code, variable-height row measurement, pane-local scroll restoration, and bottom-following only while the user is pinned there; live assistant output preserves each provider/runtime stream packet as a visible update through compact ordered stream patches, while full surface snapshots are reserved for baseline, recovery, and settled-state sync; active assistant work shows a durable elapsed clock in the composer, and completed assistant transcript messages show the persisted turn duration from structured turn start and finish timestamps.",
    sourceSpecs: ["docs/prd.md"],
  },
  {
    id: "workspace-navigation-core-projection",
    name: "Workspace Navigation And Core Projection",
    status: "shipped",
    summary:
      "Keeps each workspace tab navigable with pinned, regular Sessions, and Archived session groups in a shared sidebar band between creation/search actions and reference panes; each group uses the same collapsible accordion header style, keeps its own independently scrollable and resizable space, persists collapsed state and size across restart, and keeps Archived collapsed by default. It also provides durable session-level unread dots that appear when assistant turns finish outside the focused pane surface and clear on session-pane focus or explicit mark-read action, layered sidebar rows where orchestrator session state, handler-thread state, and workflow-run state stay local to their owning rows, session row context menus for mark read or unread, pin, rename, archive, and a menu-local Confirm delete action, normal session-row clicks that open in the focused Dockview panel with Cmd-click opening a new pane, compact running indicators, tone-aware open-pane highlighting, context-budget rails for open orchestrator and handler rows, a sidebar footer that shows the current git branch with a branch icon and opens a local-branch switcher when the workspace is a git repo, compact thread and workflow-run artifact blocks backed by durable artifact records, compact latest Project CI projection near the focused surface or relevant handler thread, and restart restoration for stable Dockview panel bindings, static inspector pane targets, focus, panel-local scroll, display preferences, durable composer drafts, and session-group layout while deliberately excluding transient UI, transcript selections, and stale live stream state.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/pane-layout.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
      "docs/specs/multi-session-support.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/project-ci.spec.md",
    ],
  },
  {
    id: "command-palette",
    name: "Command Palette And Quick Open",
    status: "in-progress",
    summary:
      "Defines a VS Code-like shared palette where `Cmd+Shift+P` opens the same input as `Cmd+P` with `>` prefilled, those launcher chords remain available while text inputs are focused and switch the focused palette between command and quick-open modes when it is already open, the leading `>` live-switches quick-open search into command/action mode, command mode discovers and executes product actions through existing session, surface, orchestrator, handler-thread, workflow task-agent projection, Project CI, Smithers-native, Dockview panel, settings, Agents profile routing, and Extensions routing, including profile-specific New orchestrator actions, a product shortcut registry backed by TanStack Hotkeys owns scoped renderer dispatch, input policy, and shared shortcut display, sidebar shell actions reveal compact shortcut hints instantly on hover or focus, New orchestrator uses `Cmd+N` for the focused pane and `Cmd+Shift+N` for a new pane, Logs, Agents, Extensions, and Workflows open from `Cmd+Shift+1/2/3/4` in sidebar order, icon-only or ambiguous action controls show faster delayed explanatory tooltips with consistent keycap chips, open-session results show visually distinct kind badges across orchestrator, handler-thread, and task-agent categories, `Cmd+P` remains a file quick-open placeholder until file surfaces exist, `cmdk-sv` is the intended Svelte UI primitive, and unmatched non-empty command-mode text creates a normal new orchestrator initial prompt without the `>` prefix or a parallel runtime, shell, terminal loop, or workflow abstraction.",
    sourceSpecs: ["docs/prd.md", "docs/specs/command-palette.spec.md"],
  },
  {
    id: "agent-profiles",
    name: "Agents Pane And Agent Profiles",
    status: "shipped",
    summary:
      "Provides an Agents pane between Logs and Extensions that owns app-wide orchestrator profiles and the current special `threadHandler` profile, persists provider, model, reasoning, base instructions, extension usage selections, and profile metadata as app-global settings, lets users create or duplicate additional orchestrator profiles, deletes user-created profiles through an inline single-confirm action, drives the New orchestrator picker order and profile badges from the orchestrator-profile order, keeps the default orchestrator profile locked, first, non-draggable, and non-deletable while still allowing settings edits, lets profile-backed orchestrator sessions optionally save composer model and reasoning changes back to their profile for future sessions, uses internal title-naming settings for top-level session titles and handler-thread titles derived from delegated objectives without exposing title naming as a special profile, uses the special `threadHandler` profile for delegated handler-thread surfaces with per-thread model, reasoning, base-instruction, and extension overrides available through `thread_start`, exposes focused-surface agent summaries in pane chrome, and uses direct-saving profile editors with connected-provider model dropdowns plus selected-model reasoning dropdowns derived from pi's normalized model metadata and runtime thinking controls rather than svvy-owned provider/model special cases. Workflow agents and extension-provided agent profiles remain future work and do not imply a repo-root `workflows/` shipped runtime.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/command-palette.spec.md",
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
      "Separates integrated app-chrome workspace tabs, shared durable workspace state, live surface runtimes, and Dockview-backed user workspace layout slots, using one backend workspace runtime per canonical cwd with explicit `workspaceId` routing for every workspace-scoped request and sync event, never active workspace routing; keeps workspace tabs as chrome state that select `workspaceId` plus active layout id instead of owning durable layouts; opens a real svvy-owned default workspace tab with exactly one `Open Workspace` pane when no user workspace tabs restore; lets `Open Workspace` retarget the current visual tab, `New Tab` create another default workspace tab with exactly one `Open Workspace` pane and no durable layout slots, and `Open Workspace in New Tab` create a selected user workspace tab; allows opening the same cwd in multiple visual workspace tabs that share the same runtime, session catalog, pi sessions, structured state, prompt queues, handler threads, workflow runs, app logs, workspace read models, and fixed durable layout slots keyed by `(workspaceId, layoutId)`; keeps workspace tabs left-aligned at the start of the main chrome, horizontally scrollable when crowded, draggable for user reordering, durably restored in user-defined order, and paired with compact icon controls plus colored running, unread, waiting, and error count badges shown only above zero with hover context; uses Dockview core for panels, groups, tabs, tab groups, splitters, drag/drop overlays, edge groups, floating groups, popouts, and serialized layout restore inside fixed user workspace layout slots A, B, and C pinned at the far right while svvy stores panel-to-surface bindings and panel-local metadata in those slots; keeps empty user workspace layout slots muted but selectable, manages live pi surfaces in a shared registry keyed by `surfacePiSessionId`, gives each surface its own prompt lock, model or reasoning lifecycle, pending user message, queued follow-up messages, and surface-owned live assistant stream state, supports explicit open and close semantics, sidebar panel-location indicators, compact thread and workflow-run projections, and lets zero, one, or multiple panels attach to the same streaming surface without duplicating or cancelling the underlying runtime while keeping panel-local scroll independent per panel.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/default-workspace-and-open-workspace.spec.md",
      "docs/specs/multi-session-support.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/pane-layout.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
    ],
  },
  {
    id: "workspace-runtime-recovery",
    name: "Workspace Runtime Recovery Coordinator",
    status: "in-progress",
    summary:
      "Defines one backend-owned recovery coordinator per acquired workspace runtime, with duplicate same-cwd tabs sharing recovery state, app-wide auth/preferences kept outside workspace recovery, Smithers durable-state bootstrap before surface work, durable scheduler records with transactional claims and idempotency keys for prompts, queues, initial handler starts, handoff notifications, waits, title jobs, workflow attention, Project CI projection, and recovery observability, while renderer layout restore remains only a consumer of backend snapshots.",
    sourceSpecs: ["docs/specs/workspace-runtime-recovery.spec.md"],
  },
  {
    id: "structured-session-state",
    name: "Structured Session State Overlay",
    status: "in-progress",
    summary:
      "Adds a workspace-scoped svvy-owned product state layer above pi and Smithers with durable session, surface composer draft, turn, handler thread, workflow-run binding/projection, workflow-task-attempt UI projection, command, episode, artifact, Project CI run/check result, attention, and lifecycle projection records, explicit surface-target identity (`workspaceSessionId`, `surfacePiSessionId`, `threadId`), exact Smithers identifiers for workflow/task projection rows, and workspace-level metadata projection that survives reload, while leaving Smithers execution facts such as run/node/attempt/wait/output/approval/timer/event state in Smithers and live-surface transcript updates separate from durable workspace read models.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "turn-command-state",
    name: "Turn And Command State",
    status: "in-progress",
    summary:
      "Tracks every turn on the orchestrator surface and handler thread surfaces, including each turn's top-level turn decision, plus every tool call including execute_typescript snippets and generated-client child command facts, as durable state with lifecycle status, ownership, linkage, attempts, and trace-versus-surface visibility.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-threads",
    name: "Structured Handler Threads",
    status: "in-progress",
    summary:
      "Tracks delegated handler threads as durable interactive surfaces keyed separately from workspace session containers and pi surface ids, with objective, handler-attention status, wait state, worktree context, explicit orchestrator re-engagement of completed threads through `thread_resume`, and linkage to multiple workflow runs and multiple handoff episodes over the thread's lifetime without flattening workflow outcome into thread terminal state.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "durable-episodes",
    name: "Durable Episodes",
    status: "in-progress",
    summary:
      "Stores reusable semantic outputs as first-class episode records, with handler threads able to emit multiple ordered handoff episodes over their lifetime through explicit `thread_handoff` calls whose success boundary is durable episode recording plus objective-span closure, including orchestrator-local episodes when substantive local work completes, while ordinary tool runs keep their own command summaries and artifacts.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "project-ci-lane",
    name: "Project CI Lane",
    status: "in-progress",
    summary:
      'Provides Project CI status and result projection over normal saved Smithers entries under `.svvy/workflows/.../ci/`, records svvy-owned CI run and CI check result rows only from entries declaring `productKind = "project-ci"` whose durable Smithers terminal result validates against the declared result schema, derives UI/read models from Smithers result facts plus svvy ownership/product-binding facts rather than process memory or copied svvy output fields, treats terminal events, reconnect, and restart recovery as idempotent triggers to re-read Smithers durable state, records missing or invalid Smithers terminal results as durable svvy projection failure or troubleshooting state, exposes latest CI status in specialized UI, and delivers CI authoring guidance only through the handler-available `project-ci` extension loaded by `thread_start` extension overrides or handler-side `load_extension({ extensionId: "project-ci" })`, without a setup launcher, CI-specific orchestrator, or shipped placeholder CI entry.',
    sourceSpecs: [
      "docs/specs/project-ci.spec.md",
      "docs/specs/extensions-and-tools.spec.md",
      "docs/specs/extension-managing.spec.md",
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
      "docs/specs/workflow-library.spec.md",
      "docs/specs/workflow-supervision.spec.md",
    ],
  },
  {
    id: "workflow-run-records",
    name: "Delegated Workflow Run Records",
    status: "in-progress",
    summary:
      "Stores one svvy-owned product-binding record for each Smithers workflow run under a handler thread, including workspace/session/thread/surface ownership, Smithers run id, workflow id, workflow source, runnable entry path plus saved-entry linkage when relevant, reconnect or snapshot cursor, pending-versus-delivered handler-attention cursors, lineage reference, product summary, timestamps, and related svvy artifact, command, Project CI, and UI links; it does not store Smithers run, node, attempt, wait, approval, timer, output, status, heartbeat, or event state, and lifecycle events or tool results trigger re-reads of Smithers durable state before svvy projection rows are updated.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-wait-state",
    name: "Session And Thread Wait State",
    status: "in-progress",
    summary:
      "Represents handler-owned blocking conditions and Smithers-derived workflow attention explicitly through surface-local wait or attention state and whole-session frontier state, preserving the product meaning of user input, approval, signal, timer, or other external dependency while leaving the authoritative Smithers wait, approval, signal, and timer records in Smithers and re-reading them by Smithers id when detail is needed.",
    sourceSpecs: ["docs/specs/structured-session-state.spec.md"],
  },
  {
    id: "session-summary-read-models",
    name: "Metadata-First Session Read Models",
    status: "in-progress",
    summary:
      "Derives orchestrator-local idle, running, waiting, and error session status, pinned and archived navigation fields, row-local handler-thread and workflow-run sidebar projections, pending attention, and compact summary data from structured state for workspace navigation and restart recovery without rolling child handler or workflow lifecycle state into the parent session row, transcript replay, transcript-file heuristics, or any global active-surface overlay.",
    sourceSpecs: [
      "docs/specs/structured-session-state.spec.md",
      "docs/specs/workspace-navigation-core-projection.spec.md",
    ],
  },
  {
    id: "workflow-inspector",
    name: "Workflow Inspector Surface",
    status: "shipped",
    summary:
      "Provides a durable tree-first Dockview panel surface for Smithers runs, modeled after React DevTools and the Smithers GUI live-run tree, with searchable expandable rows, selected and expanded node state, svvy product projection beside current Smithers status read from Smithers, launch arguments and props, Smithers DevTools snapshot and event-cursor streaming, historical frame inspection, selected-node status, output, partial output, artifact, workflow-agent, task-attempt, command, worktree, timing, wait-reason, output/diff/log/transcript/command/event/raw detail, Project CI check rows only for declared CI entries, and related handler-thread, task-agent, command, CI check, and artifact Dockview targets without forcing the orchestrator to absorb raw workflow history.",
    sourceSpecs: [
      "docs/prd.md",
      "docs/specs/workflow-supervision.spec.md",
      "docs/specs/workflow-inspector.spec.md",
    ],
  },
  {
    id: "app-logs-surface",
    name: "App Logs Surface",
    status: "shipped",
    summary:
      "Provides workspace-scoped product observability through structured, redacted, persisted app logs with monotonic sequence numbers, unread state, live renderer updates, a sidebar Logs entry with compact action-worthy unread badges for warning and error logs only, and a dense Dockview logs pane with TanStack Virtual long-scroll rendering, native end anchoring, older-page loading, level/source/search filtering, mark-read behavior, explicit Live/Frozen tail control, smooth explicit jump-to-latest with reduced-motion fallback, expandable details, normalized errors, stack traces, and related session, surface, thread, workflow, task, command, and artifact ids without making logs canonical product state.",
    sourceSpecs: ["docs/specs/app-logs.spec.md"],
  },
];
