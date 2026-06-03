# Progress

Incremental roadmap from the current baseline to the shipped PRD.

How to use this file:

- Keep items small enough to land in a focused PR.
- Treat this file as a roadmap and progress tracker, not a changelog.
- Prefer adding new items next to the closest related step instead of appending unrelated backlog at the bottom.
- Keep sections ordered by dependency: durable facts and execution before projection surfaces that depend on them.
- When an item is done, change `[ ]` to `[x]` and append the landing commit hash or hashes.
- Write the capability that should exist or now exists, not migration wording like "replace", "remove", or "rename" unless that action is itself the remaining work.
- If the design changes, rewrite affected items to the new steady-state plan instead of leaving stale unchecked items from the old plan.
- If an item starts reading like a subsystem instead of a step, split it before implementation.
- For any big lift or unclear design, add a POC step immediately before the production implementation step.
- Use POC steps to validate shape, constraints, and UX without prematurely locking the final architecture.

## Current Baseline

- [x] Bootstrap the Electrobun desktop app around a pi-backed host/runtime instead of a standalone shell. Commit(s): `c118be7`
- [x] Add provider auth/settings support with local key storage and OAuth-backed access. Commit(s): `c118be7`, `6d757dc`
- [x] Add the artifact projection panel in the desktop workbench. Commit(s): `1d9bc05`, `6d757dc`
- [x] Add workspace-scoped prompt history recall in the composer. Commit(s): `cb1b7f1`
- [x] Add multi-session workspace navigation and session switching/resume support. Commit(s): `b22a0c6`, `df1a7df`

## 1. Structured Session State

Workflow-inspector UI work remains explicitly out of scope for this section and stays under section 17.

- [x] Build a POC session overlay document and validate how it can sit above pi session data. Commit(s): `c432f4e`
- [x] Persist a minimal structured session overlay root above pi session data. Commit(s): `b510857`, `fff54d7`
- [x] Add `surfacePiSessionId` linkage on turns so orchestrator-surface and handler-thread turns use one model. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist handler-thread records with title, objective, status, wait state, backing pi session id, and latest workflow-run linkage. Commit(s): `fff54d7`, `f53c9b8`
- [x] Support workflow-run records that allow many runs under one handler thread. Commit(s): `f53c9b8`, `43a26cb`
- [x] Persist workflow-run records with run id, workflow name, workflow source, runnable entry path plus saved-entry linkage when relevant, status, summary, and timestamps. Commit(s): `8f0e4ec`
- [x] Persist artifact references independently from transcript parsing at thread, workflow-run, and command scope. Commit(s): `fff54d7`
- [x] Persist ordered handoff episode records each time a handler thread returns control to the orchestrator, while preserving earlier handoff points for later follow-up turns. Commit(s): `d323012`
- [x] Persist session wait state as a frontier-level summary derived from surface and thread wait state. Commit(s): `fff54d7`, `f53c9b8`, `43a26cb`
- [x] Drive structured session state only from explicit runtime producers or tool events. Commit(s): `fff54d7`, `59fc34e`, `43a26cb`
- [x] Reconstruct workspace and session summaries from structured state on app load. Commit(s): `b510857`, `fff54d7`

## 2. `execute_typescript`

- [x] Build a POC `execute_typescript` runtime with compile or typecheck-before-run diagnostics and the adopted TypeScript input/output contract. Commit(s): `76cc8f3`, `b41e5e6`
- [x] Expose a minimal `execute_typescript` tool with the adopted input/output contract and injected `api.*` surface. Commit(s): `76cc8f3`
- [x] Persist each attempted snippet as a file-backed artifact before execution, with SQLite metadata and path indexing. Commit(s): `76cc8f3`, `fff54d7`
- [x] Generate the typed declaration for the `execute_typescript` subset of direct tools. Commit(s): `76cc8f3`, `29d8452`
- [ ] Generate and enforce actor-specific `execute_typescript` capability profiles so orchestrators do not receive workflow or Smithers control through generated TypeScript clients, handler threads receive only clients for their loaded extensions, and workflow task agents receive only task-local generated clients.
- [x] Run a simple composed scripted task through `execute_typescript`. Commit(s): `76cc8f3`
- [x] Build a POC artifact and tracing pipeline for code-mode execution. Commit(s): `76cc8f3`
- [x] Capture code-mode logs and nested command traces as artifacts and structured command records. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Keep only `thread_start`, `thread_handoff`, and `wait` as `svvy`-native control tools while exposing Smithers workflow operations through Smithers-native bridge tools. Commit(s): `a02bd48`
- [x] Keep the `execute_typescript` API bounded to generated clients that benefit from typed composition. Commit(s): `76cc8f3`, `29d8452`
- [x] Expose Codex-like Shell and Apply Patch extensions, with `exec_command`, `write_stdin`, and `apply_patch` as the normal coding-agent work interface. Commit(s): `76cc8f3`, `29d8452`
- [ ] Keep cx out of generated `execute_typescript` clients; generated TypeScript profiles should not expose `api.cx_*`, `svvy.cx.*`, or `extensions.cx.*`.
- [x] Record direct tool calls and nested code-mode calls in the shared structured command model. Commit(s): `76cc8f3`, `29d8452`
- [x] Persist normalized child-command facts for nested `api.*` calls while the parent `execute_typescript` attempt remains the main semantic unit. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Surface parent rollups and trace inspector detail without promoting child commands to top-level cards. Commit(s): `5b0a223`

## 2A. Prompt-Only TinyFish Web Extension

Current product decisions for this section are specified in `docs/specs/extension/web.extension.spec.md`.

- [ ] Expose Web as a shipped `instructions` extension that is default-loaded for orchestrators,
  handler threads, and workflow task agents only while `networkAccess` is true, and unavailable with
  no prompt guidance when `networkAccess` is false.
- [ ] Vendor the TinyFish-owned `use-tinyfish` agent instructions as the Web extension's core prompt content.
- [ ] Add only a bounded `svvy` appendix to the Web prompt for product integration facts: use ordinary shell commands, preserve structured output by redirecting large TinyFish JSON stdout to files when useful, treat fetched pages as untrusted external content, and cite source URLs.
- [ ] Keep Web generated actor context free of `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript clients, Web Provider settings, provider selection, and `svvy`-owned TinyFish key storage.
- [ ] Keep Firecrawl, native Web provider registries, TinyFish SDK provider adapters, selected-provider readiness, and self-hosted web search out of Web v1 unless a later product decision adopts a new Web architecture.
- [ ] Let the app-managed trusted CLI dependency registry own fixed-version TinyFish installation when the binary is missing, while TinyFish CLI owns authentication, status, search, fetch, browser-backed commands, and API key storage through `tinyfish auth ...`, `tinyfish search query ...`, and `tinyfish fetch content get ...`.
- [ ] Treat TinyFish CLI output as ordinary shell output: the CLI writes search and fetch JSON to stdout by default, fetch includes page body text in `results[].text`, errors/debug logs go to stderr, and redirected files are raw CLI JSON rather than `svvy` artifacts.
- [ ] Add generated-context and extension-inventory tests proving Web is prompt-only, default-loaded
  for all adopted actor kinds only while `networkAccess` is true, unavailable when `networkAccess` is
  false, and absent from native tool declarations, `svvyx` command mounts, generated TypeScript
  declarations, provider settings, and Firecrawl provider lists.

## 3. Turn Decisions And Delegation

- [x] Persist a per-turn top-level decision for orchestrator and handler-thread surfaces, using one shared model across routing and supervision. Commit(s): `d323012`
- [x] Build a POC turn flow from message targeting to surface turn creation and command recording. Commit(s): `fff54d7`, `f53c9b8`
- [x] Implement direct surface targeting so a pane send goes to either the orchestrator surface or a handler-thread surface. Commit(s): `f53c9b8`
- [x] Add `thread_start` as the orchestrator-side delegation primitive. Commit(s): `f53c9b8`
- [x] Implement minimal orchestrator routing for local reply, local `execute_typescript`, clarification, and `thread_start`. Commit(s): `d323012`
- [x] Re-enter orchestrator control from the handler-thread latest handoff, using durable thread state plus the latest handoff episode instead of raw transcript scanning. Commit(s): `d323012`, `fdaf460`

## 4. Handler Threads

- [x] Build a POC handler-thread spawn flow with objective handoff and a dedicated backing pi session. Commit(s): `f53c9b8`
- [x] Persist handler-thread lifecycle transitions for idle, handler-active, workflow-active, waiting, troubleshooting, and completed states without flattening workflow failure or cancellation into thread terminal state, with `completed` reserved for explicit handoff after active workflow supervision has been resolved. Commit(s): `f53c9b8`, `fdaf460`, `a02bd48`
- [x] Let handler threads receive direct user messages through the same surface model as the orchestrator. Commit(s): `f53c9b8`
- [x] Make handler-thread wait and resume happen inside the thread itself instead of bouncing through the orchestrator by default. Commit(s): `f53c9b8`
- [x] Keep handed-back handler threads directly interactive for follow-up chat without forcing a new thread. Commit(s): `ba5c3f0`
- [x] Let a handed-back thread move from completed back to the correct active state when objective work resumes, including explicit orchestrator re-engagement through `thread_resume`, distinguishing handler-active from workflow-active supervision. Commit(s): `f53c9b8`, `a02bd48`
- [x] Preserve earlier handoff points in thread history when the same thread later returns control again. Commit(s): `d323012`
- [x] Allow the orchestrator to inspect a handler thread on demand without making that the default reconciliation path. Commit(s): `ba5c3f0`
- [x] Make `thread_handoff` the explicit handler-thread handoff path so ordinary handler replies stay interactive and multi-turn. Commit(s): `fdaf460`
- [x] Load the orchestrator and handler-thread instructions through pi's true `systemPrompt` channel before sending each real user message. Commit(s): `8a41d08`
- [x] Surface the active system prompt as a collapsible transcript item while keeping committed conversation history in pi session history rather than role-labelled prompt reconstruction. Commit(s): `8a41d08`
- [x] Slice generated capability declarations by actor so the orchestrator prompt receives only orchestrator-callable tools while handler-thread prompts receive only handler-callable tools. Commit(s): `a02bd48`
- [x] Teach the orchestrator prompt that workflow actions require delegation into a handler thread instead of exposing `smithers_*` directly in the orchestrator API block. Commit(s): `a02bd48`
- [x] Teach handler-thread prompts that the orchestrator owns delegation and reconciliation while omitting orchestrator-only tool declarations such as `thread_start` unless nested delegation is explicitly adopted. Commit(s): `a02bd48`

## 5. Workflow Supervision Foundations

- [x] Define the packaged-app Smithers runtime boundary so shipped product workflows are configured saved or artifact entries under `.svvy/` rather than repo-root `workflows/` authoring assets. Commit(s): `a02bd48`
- [x] Build handler-thread supervision for Smithers runs started from explicit runnable entries, with deterministic test workflows registered only inside tests. Commit(s): `a02bd48`
- [x] Define the workflow-run request envelope from a handler thread to Smithers. Commit(s): `f53c9b8`
- [x] Persist workflow-run supervision metadata for svvy product binding and projection, including Smithers run id, product attention kind, reconnect cursor, handler-attention delivery state, and lineage reference, as soon as the supervising handler thread has a concrete Smithers run id. Commit(s): `a02bd48`
- [x] Build a POC one-task workflow under a handler thread that returns to the thread and then emits a handoff episode. Commit(s): `f8557d9`
- [x] Let handler threads call the generated per-workflow Smithers run-launch surface through the Bun bridge for both new and resumed runs. Commit(s): `4674e67`
- [x] Extend the Smithers-native supervision surface beyond the shipped Step 5 handler-thread/runtime coverage for blocker diagnosis, approvals, signals, cancellation, node detail, artifacts, transcripts, event history, frames, and DevTools inspection, focusing on the remaining operator-only and richer troubleshooting controls. Commit(s): `f8557d9`
- [x] Define workflow task agents as a lower-level Smithers agent kind distinct from orchestrator and handler-thread surfaces. Commit(s): `a02bd48`
- [x] Adopt PI-backed svvy workflow task agents with a dedicated task prompt, task-local prompt-only cx CLI guidance, direct tools, and `execute_typescript` for typed composition. Commit(s): `a02bd48`
- [x] Keep Smithers workflow approval gates and hijack as Smithers runtime or operator controls around workflow task agents rather than exposing them as ordinary task-agent tools. Commit(s): `a02bd48`
- [x] Build workflow task execution that runs the svvy workflow-task PI configuration with task-local prompt-only cx CLI guidance, direct tools, and code mode. Commit(s): `a02bd48`
- [x] Wake the supervising handler thread in a background turn only when a workflow run reaches a terminal outcome, an actionable wait, a continuation boundary, or a supervision fault that requires handler judgment, while keeping duplicate terminal reconciliation idempotent after a valid handoff. Commit(s): `a02bd48`
- [x] Support multiple workflow runs under one handler thread. Commit(s): `f53c9b8`, `43a26cb`
- [x] Derive active and latest workflow summaries from workflow-run state without a persisted thread-level latest pointer. Commit(s): `a02bd48`
- [x] Persist durable reconnect cursors plus pending-versus-delivered handler-attention state on workflow runs so restart recovery and wake-up dedupe do not depend on process memory. Commit(s): `2f874a7`
- [x] Emit explicit Smithers bridge lifecycle events for workflow projection, reconnect bootstrap, and handler-attention delivery. Commit(s): `2f874a7`
- [x] Bootstrap workflow supervision from durable run state on session restore, rebuilding runtime ownership from workflow-run records and replaying only undelivered handler attention. Commit(s): `2f874a7`
- [x] Keep `thread_handoff`, Smithers read APIs, selectors, and renderer reads free of lifecycle repair writes. Commit(s): `2f874a7`
- [x] Guarantee that a workflow-run failure or cancellation moves the handler thread into troubleshooting before any later user-directed closure or handoff. Commit(s): `a02bd48`
- [x] Derive workflow-run execution status, wait kind, heartbeat, finished timestamp, and summary from Smithers durable run state for runtime policy, handler tools, and workspace read models, while keeping `workflow_run` as the svvy ownership, cursor, attention, and product-link binding row. Commit(s): 59d7daf01f

## 6. Workflow Authoring And Saved Workflow Files

- [x] Define the generated workflow-authoring contract plus curated Smithers authoring guide and example bundle injected into every handler-thread context. Commit(s): `0b2d1ff`
- [x] Build an end-to-end handler-thread flow that checks direct work, saved runnable entries, and reusable assets, then authors and runs a short-lived workflow artifact when needed. Commit(s): `dc1da8c`
- [x] Persist every authored short-lived workflow under `.svvy/artifacts/workflows/<artifact_workflow_id>/` with `definitions/`, `prompts/`, `components/`, `entries/`, and `metadata.json`. Commit(s): `dc1da8c`
- [x] Define the saved workflow library layout under `.svvy/workflows/definitions/`, `.svvy/workflows/prompts/`, `.svvy/workflows/components/`, and `.svvy/workflows/entries/`. Commit(s): `37afcb3`, `4515233`
- [x] Define the discovery metadata contract compiled from JSDoc headers in `ts` or `tsx` files and frontmatter in `mdx` prompt files. Commit(s): `37afcb3`, `4515233`
- [x] Expose saved workflow asset metadata through the Workflows library read model and handler-readable file paths. Commit(s): `4515233`
- [x] Expose workflow-agent model choices, provider readiness, and supported reasoning values through the handler-only `workflow_list_models` authoring tool backed by pi-normalized model metadata. Commit(s): `4515233`
- [x] Build a POC saved definition plus saved entry that are reused by a new short-lived artifact entry with different prompts or config bound at authoring time. Commit(s): `37afcb3`
- [x] Keep authored workflows artifact-only by default until the handler explicitly writes reusable files into `.svvy/workflows/`. Commit(s): `0b2d1ff`
- [x] Run automatic saved-workflow validation after direct `write` or `edit` operations under `.svvy/workflows/...`, surfacing diagnostics through structured command records. Commit(s): `0b2d1ff`
- [x] Surface all runnable saved and artifact entries through `smithers_list_workflows` and `smithers_run_workflow({ workflowId, input, runId? })`, with `smithers_list_workflows` returning each entry's explicit launch contract, `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, and `workflowId` filter support rather than relying on inferred import graphs. Commit(s): `4515233`, `dc1da8c`
- [x] Persist workflow agent files as ordinary saved workflow components that handlers discover by path and inspect through file reads. Commit(s): `4515233`

## 7. Project CI Lane

- [x] Model Project CI authoring guidance as the handler-available shipped `project-ci` extension. Commit(s): `2a5dbbe`
- [x] Use `load_extension({ extensionId: "project-ci" })` for handler-side Project CI authoring guidance and store the resulting generated agent context binding. Commit(s): `2a5dbbe`
- [x] Extend `thread_start` so the orchestrator can create a handler with `project-ci` loaded through extension overrides. Commit(s): `2a5dbbe`
- [x] Make Project CI configuration happen organically through normal handler-thread work, with the `project-ci` extension loaded when CI authoring guidance is needed, instead of a setup launcher or CI-specific runtime. Commit(s): `2a5dbbe`
- [x] Define the conventional Project CI saved-workflow layout under `.svvy/workflows/{definitions,prompts,components,entries}/ci/`, without implying a shipped or auto-created default CI entry. Commit(s): `2a5dbbe`
- [x] Extend runnable workflow entry discovery with optional `productKind` and `resultSchema` metadata. Commit(s): `2a5dbbe`
- [x] Validate a saved Project CI entry under the conventional `.svvy/workflows/entries/ci/project-ci.tsx` path that declares `productKind = "project-ci"` and returns output that validates against its declared CI result schema. Commit(s): `2a5dbbe`
- [x] Persist `ci_run` and `ci_check_result` records only from terminal Smithers runs launched from declared Project CI entries. Commit(s): `2a5dbbe`
- [x] Record CI check results with stable check ids, kind, status, required flag, command, exit code, summary, timestamps, and linked artifacts. Commit(s): `2a5dbbe`
- [x] Treat invalid CI result output as a CI workflow troubleshooting state instead of parsing logs, node outputs, final prose, or command names. Commit(s): `2a5dbbe`
- [x] Derive Project CI run/check read models through idempotent reconciliation over durable Smithers result facts and durable `svvy` workflow ownership facts, with terminal events, monitor reconnect, and app restart recovery all triggering the same derivation instead of relying on process-local terminal output memory or copied svvy output fields. Commit(s): a82abd62bc
- [x] Record missing durable Smithers terminal result output for a declared Project CI entry as a durable svvy projection failure or troubleshooting state instead of silently skipping CI projection. Commit(s): a82abd62bc
- [x] Let normal handler threads discover and run configured Project CI entries without loading the `project-ci` extension, while using `load_extension({ extensionId: "project-ci" })` before configuring or modifying CI. Commit(s): `2a5dbbe`
- [x] Render `not configured`, `configured`, `running`, `passed`, `failed`, `blocked`, and `cancelled` Project CI states in a dedicated CI status surface or panel. Commit(s): `ee850fd`
- [x] Surface the latest Project CI outcome as routing input for orchestrator and handler decisions without making CI a native control tool. Commit(s): `2a5dbbe`

## 8. Workspace Navigation, Live Surfaces, And Core Projection

Current product decisions for this section are specified in `docs/specs/workspace-navigation-core-projection.spec.md`.

- [x] Drive the session sidebar entirely from durable workspace session summaries. Commit(s): `9a21f87`, `b0ee858`
- [x] Define the stored shape for pinned and archived sessions, including the default collapsed state for the single Archived group. Commit(s): `3855fe4`
- [x] Persist pinned and archived session state. Commit(s): `3855fe4`
- [x] Render pinned sessions at the top of the active session list. Commit(s): `3855fe4`
- [x] Render archived sessions inside one Archived group in the session sidebar. Commit(s): `3855fe4`
- [x] Persist the Archived group collapsed state per workspace. Commit(s): `3855fe4`
- [x] Add session row actions for pin, unpin, archive, and unarchive. Commit(s): `3855fe4`
- [ ] Keep durable unread state session-level with sidebar timestamp dots, focus-to-read clearing, and session row context-menu actions for mark read or unread, pin, rename, archive, and confirmed delete; pane unread treatment, when present, reads from the same session metadata.
- [x] Join session summaries, focused panel, and panel-to-surface bindings in one workspace-shell read model without depending on a global active surface. Commit(s): `9a21f87`, `b0ee858`
- [x] Split workspace-summary updates from live surface transcript updates in the renderer runtime. Commit(s): `9a21f87`, `b0ee858`
- [x] Manage open live surfaces in a shared registry keyed by `surfacePiSessionId`. Commit(s): `9a21f87`, `b0ee858`
- [x] Give each live surface its own prompt lock, model state, reasoning state, and cancellation lifecycle. Commit(s): `9a21f87`, `b0ee858`
- [x] Render handler-thread and workflow-run rows from structured state in the workspace shell while keeping lifecycle subtitles, running indicators, open-pane treatment, and compact context rails local to the owning row. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Show thread objective, status, latest workflow-run summary, and blocked reason in panel-local thread views. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render the latest handoff episode for an inspected thread while preserving earlier handoff points in thread history. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render thread- and workflow-run-linked artifacts before relying on transcript reconstruction. Commit(s): `3855fe4`
- [x] Render the latest Project CI summary block for the focused surface or inspected thread. Commit(s): `3855fe4`
- [x] Restore focused panel, panel-to-surface bindings, and inspector selection after restart. Commit(s): `3855fe4`
- [ ] Keep open workspaces as left-aligned, horizontally scrollable, draggable app-chrome tabs with durable user-defined tab order, compact icon controls, >0-only colored status count badges, a svvy-owned default workspace runtime when no user workspace tabs restore, exactly one `Open Workspace` pane as each new default workspace tab's first surface, current-tab `Open Workspace`, `New Tab` as a new default workspace tab with no durable layout slots, and `Open Workspace in New Tab` as picker-backed user workspace tab creation; duplicate same-cwd tabs are separate chrome views over the same backend workspace runtime, session catalog, durable workspace state, live surface registry, queues, threads, workflow runs, app logs, and durable layout slots keyed by `(workspaceId, layoutId)`, while each tab stores only its selected active layout id.
- [ ] Route all workspace-scoped backend requests and renderer sync events through explicit `workspaceId` instead of process-global cwd, active workspace, focused tab, or active runtime; keep app-global settings on separate app-global APIs, and require explicit `workspaceId` for workspace-affecting settings plus generated agent-context projections and Workflows library operations.

## 9. Command Palette And Quick Open

Current product decisions for this section are specified in `docs/specs/command-palette.spec.md`.

- [x] Define the product-owned command/action registry shape, including stable ids, labels, aliases, categories, availability, shortcuts, and typed execution targets. Commit(s): `cb319ac`
- [x] Define the shared VS Code-style palette shell where `Cmd+Shift+P` opens with `>` prefilled and `Cmd+P` opens the same input without a prefix. Commit(s): `cb319ac`
- [x] Define `>` as the live command-mode prefix for session, surface, Project CI, handler-thread, workflow-inspector, Dockview panel, settings, Agents profile, and future product actions. Commit(s): `cb319ac`
- [x] Define unprefixed `Cmd+P` behavior as file quick-open search with placeholder or no-op behavior until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist. Commit(s): `cb319ac`
- [x] Adopt `cmdk-sv` as the Svelte command palette UI primitive while keeping product routing and command semantics owned by `svvy`. Commit(s): `cb319ac`
- [x] Build a POC command palette over static product actions. Commit(s): `cb319ac`
- [x] Expose session creation, open/switch, pin, unpin, archive, and unarchive actions through the palette. Commit(s): `cb319ac`
- [x] Show unified `Open Session` results for orchestrator, handler-thread, and workflow task-agent projection categories with visible kind badges. Commit(s): `12d89d8`
- [x] Route unmatched non-empty command-mode text after `>` into a New orchestrator initial prompt through the normal orchestrator turn model. Commit(s): `cb319ac`
- [x] Add keyboard shortcut handling for `Cmd+Shift+P`, `Cmd+P`, Enter, and command-palette `Cmd+Enter` placement once Dockview layout exists. Commit(s): `cb319ac`
- [x] Add tests for shortcut dispatch, command matching, action routing, disabled or hidden availability, and unmatched prompt-session creation. Commit(s): `cb319ac`
- [ ] Keep a product-owned shortcut registry with stable action ids, labels, platform chords, compact and readable display strings, scopes, input-typing policy, availability, and command-palette or tooltip metadata.
- [ ] Use TanStack Hotkeys as the renderer shortcut dispatch primitive for palette, quick-open, sidebar shell actions, dialog-local actions, pane placement, and future focused-pane actions.

## 10. Pane Layout, Surface Ownership, And Expanded Surfaces

Current product decisions for this section are specified in `docs/specs/pane-layout.spec.md`.

- [ ] Add `dockview-core` as the workspace layout engine and mount one Dockview workbench instance from the Svelte renderer.
- [ ] Build the Svelte renderer adapter for Dockview content, tabs, header actions, context menu items, tab-group chips, watermark, and unavailable-surface panels.
- [ ] Persist Dockview serialized layout state plus svvy panel metadata, including panel-to-surface bindings, panel-local state, chrome state, restore state, and minimum panel policy.
- [ ] Persist fixed user workspace layout slots `A`, `B`, and `C` keyed by `(workspaceId, layoutId)`, with the selected slot autosaved on pane changes and empty slots rendered as muted but selectable controls pinned at the far right of workspace chrome; keep default workspace tab pane changes ephemeral and initialize every new default workspace tab with exactly one `Open Workspace` pane.
- [ ] Keep panel-to-surface bindings separate from live surface runtime state.
- [ ] Support Dockview split, splitter resize, close, tab placement, panel and group drag placement, root-edge placement, edge groups, floating groups, and popout groups through svvy placement commands.
- [ ] Configure Dockview drag/drop overlays and `dndEdges`, with svvy policy enforced through `onWillShowOverlay`, `onWillDrop`, `onDidDrop`, and `onUnhandledDragOverEvent`.
- [ ] Manage explicit open and close semantics for live surfaces independently from Dockview panel focus.
- [ ] Allow the same interactive surface to be opened in more than one Dockview panel at once.
- [ ] Keep one underlying live surface controller per `surfacePiSessionId` regardless of panel count.
- [ ] Persist Dockview layout JSON, panel occupancy, panel-local state, tab-group state, edge-group state, floating/popout state, and panel metadata across app restart.
- [ ] Restore the focused Dockview panel on app restart.
- [ ] Show exact Dockview panel-location indicators in the sidebar for open surfaces, including tab, edge-group, floating, and popout locations.
- [ ] Show a clear highlight for the currently focused Dockview panel surface.
- [ ] Define the stored shape for compact thread and workflow-run surfaces inside the workspace shell.
- [ ] Render compact thread cards in the workspace shell timeline.
- [ ] Render compact workflow-run cards in the workspace shell timeline.
- [ ] Open a selected handler-thread surface in a chosen Dockview panel as a fully interactive surface.
- [ ] Keep duplicated panel views of the same surface synchronized while allowing independent scroll position.

## 11. Agents Pane And Agent Profiles

- [x] Define the stored shape for pi-backed agent profile settings used by orchestrator and handler surfaces. Commit(s): `8e19462`
- [x] Keep agent profiles separate from session-local extension loading so Project CI uses normal handler-thread execution plus the handler-available `project-ci` extension. Commit(s): `2a5dbbe`
- [x] Seed initial app-wide values for the default orchestrator profile, the `threadHandler` profile, and internal title-naming settings. Commit(s): `8e19462`, `354db28`
- [x] Build a POC settings model for editing app-wide agent profile defaults. Commit(s): `8e19462`
- [x] Persist app-wide agent profile settings. Commit(s): `8e19462`
- [x] Build a POC New orchestrator creation flow with profile-backed orchestrator selection. Commit(s): `8e19462`
- [x] Persist the orchestrator profile snapshot and prompt selection used by created sessions. Commit(s): `8e19462`
- [x] Persist per-session orchestrator profile overrides. Commit(s): `8e19462`
- [ ] Persist handler creation-time extension-state overrides for delegated handler threads as partial overrides over the `threadHandler` profile.
- [x] Keep the Agents sidebar pane between Logs and Extensions, with orchestrator profiles plus the `threadHandler` special profile owned there instead of in General settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Drive the New orchestrator picker order, profile-specific command palette actions, and surface profile badges from Agents-pane orchestrator profile order. Commit(s): `2b97c46648`, `031510ba2b`
- [x] Keep the default orchestrator profile locked, first, non-draggable, non-deletable, and editable for settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Keep the `threadHandler` special profile available for delegated handler-thread surfaces. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Show the current focused-surface agent profile summary in pane chrome. Commit(s): `8e19462`
- [ ] Use TanStack Form for complex agent profile, provider key, and app-preference settings forms, including direct-save semantics, validation, dirty state, reset/cancel, pending submit state, async save errors, and pi-normalized provider/model/reasoning constraints.
- [ ] Expose workflow-agent profiles in the Agents pane and keep extension-provided profile surfaces as future work without coupling shipped product workflow runtime to repo-root `workflows/`.
- [ ] Define handler guidance for reusable workflow-agent components without coupling shipped product workflow runtime to repo-root `workflows/`.

## 12. Session Titles

- [x] Define the stored title states for top-level sessions and handler threads. Commit(s): `b510857`, `fe53a3b`
- [x] Add internal pi-backed title-naming settings for one-shot top-level session naming rather than a Smithers workflow agent. Commit(s): `354db28`
- [x] Seed the internal title-naming settings to `openai-codex`/`gpt-5.4-mini` with low reasoning effort and treat its settings prompt as the only naming instruction, without exposing title naming as a special profile. Commit(s): `354db28`
- [x] Build a POC event-driven title-generation flow that starts a durable one-shot naming job concurrently with the first real top-level user turn without waiting for the orchestrator response. Commit(s): `354db28`
- [x] Use the first live composer draft or first submitted user message as the provisional visible session title until the namer-generated title lands. Commit(s): `5378dcb`
- [x] Persist generated top-level session titles, title-generation lifecycle state, and the first-turn trigger so app restart cannot duplicate or lose title generation. Commit(s): `354db28`
- [x] Block manual session rename while a title-generation job is pending or running, then release the lock after success, failure, or cancellation. Commit(s): `354db28`
- [x] Freeze auto-titling after manual rename or after the first successful generated title. Commit(s): `354db28`
- [x] Generate handler-thread titles with the same internal title-naming settings used for top-level sessions, using the orchestrator-supplied `thread_start` objective as the naming input, while keeping workflow-run labels derived from the workflow's own name or entry metadata instead of adding a separate workflow-run title. Commit(s): `4d74c78`

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

- [ ] Persist durable surface queue items as structured surface-local product state keyed by `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`, kind, and FIFO queue position.
- [ ] When a composer submits to an active orchestrator or handler-thread surface, queue the message for that same surface instead of steering the current turn, interrupting tool work, starting a concurrent turn, or retargeting to the focused panel.
- [ ] Deliver queued messages as the next real pi user message after the owning surface prompt lock releases, creating a normal turn record and preserving prompt history as a single queue-time submission.
- [ ] Project blocked queue items near the owning surface composer, including count, order, remove, restore-to-composer, delivery failure, and duplicated-panel consistency, while idle-surface items first appear as pending or active work after atomic claim.
- [ ] Restore queued messages after app restart without transcript inference and resume delivery only after the owning surface runtime and prompt lock state are reconstructed.
- [x] Claim queued messages atomically through one shared queue runner per `surfacePiSessionId` and prevent duplicated panes or tabs from starting duplicate backend queue drains. Commit(s): `45bdbe8b46`
- [ ] Land idle-surface queue-manager claim before renderer-visible queued state so idle sends and idle agent context refreshes first appear as pending or active surface work.
- [x] Keep queued-message drag reorder previews local until drop, persist only final changed order, and skip no-op durable reorder writes. Commit(s): `98c73ecbb6`
- [x] Represent handler handoffs as durable episode records that schedule typed orchestrator reconciliation notifications; notification dismissal does not roll back the handoff or return a handler tool error. Commit(s): 7739c2c824
- [x] Represent generated agent context refresh as typed surface queue work, apply it before later prompt-bearing items, and expose queued, cancel, retry, and out-of-date recovery UI. Commit(s): 61ba639d6a
- [x] Let committed user transcript messages enter composer edit mode with a visible selected-message indicator and a draft-replacement warning, then resend by moving the same pi surface back to the original message's parent state before continuing from the edited user message. Commit(s): `5378dcb`

## 14. Agents, Extensions, And Generated Agent Context

Current product decisions for this section are specified in `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/extension-managing.extension.spec.md`, `docs/specs/structured-session-state.spec.md`, `docs/specs/queued-messages.spec.md`, and `docs/specs/project-ci.spec.md`.

- [x] Define shipped extensions for Shell, Apply Patch, Execute TypeScript, Extension Loading, Extension Managing, cx, Smithers, Web, Git, GitHub, External Instructions, and Project CI with default usage states for each adopted agent family. Commit(s): `673837a`
- [x] Load default Smithers extension guidance so orchestrators route workflow work, handlers supervise workflows, and workflow task agents keep the Smithers task boundary without loading handler Smithers declarations by default. Commit(s): `673837a`
- [x] Define available extensions as the on-demand product-knowledge and capability layer for specialized handler work. Commit(s): `2a5dbbe`
- [x] Render loaded and available extension bindings in surface metadata so users can see when extensions such as `project-ci` are active. Commit(s): `2a5dbbe`
- [x] Store app-wide agent profiles, base instructions, extension usage selections, generated agent-context aggregate references, extension context fingerprints, and app-global extension activation metadata. Commit(s): `118fd39c9f`
- [x] Add an `Extensions` sidebar surface below `Agents`, with shipped, user, and external-instruction records that manage reusable prompt material and capabilities rather than exposing one raw system-prompt textarea. Commit(s): `118fd39c9f`
- [x] Seed editable shipped base instructions for common, orchestrator, handler, and workflow task guidance inside agent profiles, with profile-level reset behavior where product settings allow it. Commit(s): `118fd39c9f`
- [x] Seed shipped extension records for code navigation, Smithers routing, Smithers supervision, workflow task boundary, Web, and Project CI, with per-agent usage states, non-deletable shipped rows, app-global scope, and extension reset behavior. Commit(s): `118fd39c9f`
- [x] Render generated agent-context previews for orchestrator, handler, and workflow task-agent actors, linking loaded and available extension rows back to their extension records and showing generated prompt, `svvyx` guidance, native schemas, and TypeScript declaration previews. Commit(s): `118fd39c9f`
- [ ] Store user-named Extension Managing snapshots plus durable generated agent context bindings and agent context fingerprints so historical sessions, handler threads, and workflow task-agent attempts remain inspectable after app restart.
- [ ] Add automatic generated agent context update projection for existing orchestrator and handler-thread surfaces, including grouped semantic diff details on queued, applied, failed, cancelled, and out-of-date states.
- [ ] Route `thread_start` extension overrides and handler-side `load_extension` through generated agent context bindings while preserving durable loaded and available extension ids on each affected surface.

## 14A. Ambient Agent Resources

Current product decisions for this section are specified in `docs/specs/ambient-agent-resources-baseline.spec.md`.

- [ ] Add provider-neutral Ambient Agent Resources settings that default behavior-changing coding-agent host resources off, preserve visible runtime standards, and let the user opt in by host, workspace, target agent/profile configuration, category, and source for extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, and execution-policy resources.
- [ ] Implement the pi adapter so orchestrator, handler-thread, and workflow task-agent loaders preserve `AGENTS.md`/`CLAUDE.md`, ignore `SYSTEM.md`/`APPEND_SYSTEM.md`, and load extensions, skills, prompt templates, themes, package resources, slash commands, hooks, provider adapters, and related settings only when enabled for the exact target agent/profile configuration, category, and source.
- [ ] Reflect enabled ambient callable resources in actor-specific generated API declarations, enabled prompt-affecting resources in generated agent context previews and agent context fingerprints, and enabled command resources in product command routing without hidden tools or invisible prompt mutation.

## 14B. Snippets Prompt Macros

Current product decisions for this section are specified in `docs/specs/snippets.spec.md`.

- [ ] Add the Snippets pane with managed `svvy` snippets, read-only discovered Markdown snippets, source badges, previews, open-external-editor actions, and managed snippet create/edit/rename/delete controls.
- [ ] Add composer `@` picker Snippet results with argument fields, mention chips, explicit expand-to-text behavior, and clean prompt-text expansion before sending to pi.
- [ ] Persist sent Snippet provenance in product metadata while keeping the agent-facing message as ordinary prompt text.
- [ ] Keep pi, Claude, Codex, plugin, MCP, and host slash-command expansion disabled so Snippets never grant tools, alter generated agent context, mount commands, or change execution policy.

## 15. Dedicated Workflow Inspector

Current product decisions for this section are specified in `docs/specs/workflow-inspector.spec.md`.

- [x] Define the tree-first workflow-inspector surface model, including run header state, selected node, expanded nodes, live-versus-historical mode, and Dockview panel binding. Commit(s): `ba56647`
- [x] Build a POC static inspector over one completed workflow run using a React-DevTools-like tree instead of a graph layout. Commit(s): `ba56647`
- [x] Render workflow root, sequence, parallel, loop, conditional, approval, task-agent, script, Project CI check, wait, retry, and terminal-result rows, with Project CI rows shown only for runs backed by declared Project CI entries. Commit(s): `ba56647`
- [x] Show launch arguments and node props in the selected-node inspector for workflow containers, executable tasks, approvals, and Project CI checks. Commit(s): `ba56647`
- [x] Render pending, running, waiting, retrying, completed, failed, cancelled, and skipped states clearly on rows, including collapsed-parent indicators for failed or waiting descendants. Commit(s): `ba56647`
- [x] Add search, keyboard navigation, row selection, expand/collapse, auto-expansion of active or failed paths, and preservation of user-collapsed paths during live updates. Commit(s): `ba56647`
- [x] Show selected-node details for status, objective or label, latest output, partial output, related artifacts, workflow agent, task attempt, command linkage, worktree, timing, and wait reason. Commit(s): `625cab4`
- [x] Add inspector tabs for output, diff, logs, transcript, command, events, and raw JSON when those data sources exist for the selected node. Commit(s): `ba56647`
- [x] Stream live Smithers snapshot and delta updates into the tree while a workflow is running, including latest activity previews for active leaf rows. Commit(s): `625cab4`
- [x] Add historical frame inspection with a scrubber and return-to-live behavior without making rewind or replay a default control. Commit(s): `ba56647`
- [x] Open a selected task-agent session, command record, artifact, Project CI check, or owning handler thread from the workflow inspector into another chosen Dockview panel. Commit(s): `625cab4`
- [x] Keep completed workflow inspectors available as durable historical Dockview panel surfaces after completion and app restart. Commit(s): `ba56647`

## 16. Recovery And Test Coverage

Current product decisions for workspace-runtime restart and crash recovery are specified in `docs/specs/workspace-runtime-recovery.spec.md`.

- [x] Build a POC restart or resume flow that restores multiple open surfaces and panel bindings from durable state. Commit(s): `7f84f06`
- [ ] Complete one workspace-runtime recovery coordinator with durable scheduler records, transactional claims, Smithers-first projection bootstrap, per-surface queue and handoff recovery, typed queued initial handler starts, typed queued workflow-attention wake-ups, title job recovery, Project CI projection recovery, and backend-owned recovery events/logs; the scheduler and coordinator are in place, with remaining work focused on full app-log projection and broader restart integration coverage.
- [x] Restore pending clarification and waiting state after app restart. Commit(s): `7f84f06`
- [x] Restore active workflow-run state after app restart. Commit(s): `7f84f06`
- [x] Restore pending handler attention queues and per-surface prompt-lock state after app restart. Commit(s): `7f84f06`
- [x] Add integration tests that exercise the real pi-backed runtime seam for direct work. Commit(s): `b0ee858`
- [x] Expand from the current real embedded-runtime supervision coverage in `src/bun/smithers-runtime/manager.test.ts` and `src/bun/smithers-tools.test.ts` to full pi-backed handler-thread delegation and workflow-run supervision. Commit(s): `f8557d9`, `b0ee858`, `55963d9`, `097ae47`
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

This UI should land first as a read-only workflow-library browser with an external-editor handoff. Full in-app source editing, syntax highlighting, inline diagnostics, and file-tree integration remain later editor-surface work.

- [x] Render a save shortcut in relevant thread or workflow surfaces that sends a predefined save request prompt to the handler. Commit(s): `0b2d1ff`
- [x] Persist the user's preferred external editor in settings and use it for open-in-editor actions from source-backed product surfaces. Commit(s): `ab00e2c`
- [x] Define the read-only Workflows library surface with external-editor handoff instead of requiring in-app editor primitives. Commit(s): `ab00e2c`
- [x] Define the workspace read model for saved workflow assets and artifact workflows. Commit(s): `ab00e2c`
- [x] Render a Workflows library surface with separate definitions, prompts, components, entries, and artifact workflow groupings. Commit(s): `ab00e2c`
- [x] Show saved asset title, summary, kind, path, source preview, validation status, and diagnostics in the Workflows library surface. Commit(s): `ab00e2c`
- [x] Add open-in-editor actions for saved workflow source files and artifact workflow source files. Commit(s): `ab00e2c`
- [x] Allow deleting a saved workflow definition, prompt, component, or entry from the library without deleting historical artifact workflows that previously used it. Commit(s): `ab00e2c`
- [x] Keep the sidebar Workflows entry pointed at the Workflows library surface for saved workflow assets and artifact workflow groups. Commit(s): `118fd39c9f`

## 19. App Logs Surface

Current product decisions for this section are specified in `docs/specs/app-logs.spec.md`.

- [x] Build a workspace-scoped app log store with structured info, warning, and error entries, monotonic sequence numbers, unread counts, seen state, bounded retention, SQLite persistence, and secret redaction. Commit(s): `dab04ac`.
- [x] Expose app log read, summary, mark-seen, and live-update contracts through the Bun bridge and renderer runtime without polling. Commit(s): `dab04ac`.
- [x] Route production product observability through one app logger without depending on Electrobun browser-tools telemetry. Commit(s): `dab04ac`.
- [x] Emit targeted app logs for app lifecycle, provider auth, RPC failures, sessions, title generation, surfaces, prompts, handler threads, Smithers workflow supervision, saved workflow validation, direct tools, `execute_typescript`, artifacts, Project CI projection, external editor handoff, and renderer bridge issues. Commit(s): `dab04ac`.
- [x] Add a `Logs` sidebar button directly above the workflow library entry with compact action-worthy unread badges for warning and error app logs, without surfacing info-only unread logs as sidebar badges. Commit(s): `dab04ac`.
- [x] Render a dense app logs pane with level filters, source filtering, search, mark-all-read, live tail behavior, expandable details, stack traces, and links to related sessions, threads, workflow runs, commands, workflow task attempts, and artifacts where available. Commit(s): `dab04ac`.
- [x] Render the app logs row list with TanStack Virtual, preserving variable-height expanded rows, stable row identity, scroll anchors, older-page loading, Live/Frozen tail behavior, and the `New logs` affordance across filtering, search, expansion, and live updates. Commit(s): `ed7e6ea88e`.
- [x] Add store, RPC, renderer, sidebar, pane, redaction, and representative integration tests for app logs. Commit(s): `dab04ac`.
