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

## 1. Structured Session State

- [x] Build a POC session overlay document and validate how it can sit above pi session data. Commit(s): `c432f4e`
- [x] Persist a minimal structured session overlay root above pi session data. Commit(s): `b510857`, `fff54d7`
- [x] Add `surfacePiSessionId` linkage on turns so orchestrator-surface and handler-thread turns use one model. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist handler-thread records with title, objective, objective state, backing pi session id, and durable thread linkage. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist artifact references independently from transcript parsing at thread and command scope. Commit(s): `fff54d7`
- [ ] Store artifacts under the configured artifact directory as per-session files, with mutable artifacts
  directly under `<artifactDir>/<sessionId>/`, immutable artifacts under
  `<artifactDir>/<sessionId>/immutable/`, exact stored filenames, immutable metadata, refreshed
  file-backed byte/digest facts, and no reliance on OS-level file flags for immutability.
- [x] Persist ordered update and conclusion episode records each time a handler thread reports to the orchestrator, while preserving earlier episodes for later follow-up turns. Commit(s): `d323012`
- [x] Persist session wait state as a frontier-level summary derived from surface, workflow, request-user-input, and session wait projection. Commit(s): `fff54d7`, `f53c9b8`, `43a26cb`
- [x] Drive structured session state only from explicit runtime producers or tool events. Commit(s): `fff54d7`, `59fc34e`, `43a26cb`
- [x] Reconstruct workspace and session summaries from structured state on app load. Commit(s): `b510857`, `fff54d7`
- [ ] Build a POC Codex-like live tool projection stream for one surface, covering tool item start,
  streamed argument snapshots, command output deltas, structured file-change patch snapshots,
  approval or wait state, final command facts, and renderer recovery after reload.
- [ ] Persist and render live tool projection across native direct tools, thread-control tools,
  extension loading, `execute_typescript`, command-family `exec_command` surfaces such as
  `svvyx ...`, and prompt-only CLI usage such as Smithers without introducing a workflow-specific
  rendering or recovery path.

## 2. `execute_typescript`

- [x] Build a POC `execute_typescript` runtime with compile or typecheck-before-run diagnostics and the adopted TypeScript input/output contract. Commit(s): `76cc8f3`, `b41e5e6`
- [ ] Expose the resolved `execute_typescript` runtime surface with no global `svvy` client and no injected `api` object.
- [x] Persist each attempted snippet as a file-backed artifact before execution, with SQLite metadata and path indexing. Commit(s): `76cc8f3`, `fff54d7`
- [ ] Route the top-level `execute_typescript` action through the same approval-boundary path as other approval-gated native actions before executing submitted code.
- [ ] Generate actor-specific `execute_typescript` declarations containing only the current actor's loaded TypeScript-enabled `svvyx` extension clients under `extensions["<id>"]`, plus only those extensions' command map types.
- [ ] Make `incur/client` importable in `execute_typescript` snippets for public Incur types and `Client.ClientError`.
- [x] Run a simple composed scripted task through `execute_typescript`. Commit(s): `76cc8f3`
- [x] Build a POC artifact and tracing pipeline for code-mode execution. Commit(s): `76cc8f3`
- [x] Capture code-mode logs and nested command traces as artifacts and structured command records. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Keep thread orchestration, thread handling, extension loading, and request-user-input as small `svvy`-native control surfaces while Smithers workflow operations use official CLI commands through Shell. Commit(s): `a02bd48`
- [ ] Expose generated `svvyx` extension clients as Incur-compatible `extensions["<id>"].run(commandId, input)` clients, with `MemoryClient` and local Incur actions kept internal.
- [x] Expose Codex-like Shell and Apply Patch extensions, with `exec_command`, `write_stdin`, and `apply_patch` as the normal coding-agent work interface. Commit(s): `76cc8f3`, `29d8452`
- [ ] Vendor a Codex-derived native Rust sandbox helper that preserves Codex filesystem policy
  semantics for `Read`, `Write`, and `None` entries, most-specific path precedence, writable roots
  with read-only subpaths, protected metadata carveouts, macOS Seatbelt generation through
  `/usr/bin/sandbox-exec`, and fail-closed behavior when carveouts cannot be enforced.
- [ ] Grant the active session artifact directory as a writable root while treating that session's
  `immutable/` artifact child as a read-only subpath, without granting broad writable access to the
  configured artifact root or to artifacts owned by other sessions.
- [ ] Implement the Artifacts `svvyx` command and generated-client contract for empty artifact
  creation with exact `--name <filename.ext>`, copy creation with `--path` plus optional exact
  `--name`, `--immutable`, extension-required basename validation, collision rejection, and no
  `--kind`, implicit extension, inline content, or OS file-flag immutability.
- [ ] Keep cx out of generated `execute_typescript` clients; generated TypeScript profiles should not expose `api.cx_*` or `extensions.cx.*`.
- [x] Record direct tool calls and nested code-mode calls in the shared structured command model. Commit(s): `76cc8f3`, `29d8452`
- [ ] Persist normalized child-command facts for generated `extensions["<id>"].run(...)` calls while the parent `execute_typescript` attempt remains the main semantic unit.
- [x] Surface parent rollups and trace inspector detail without promoting child commands to top-level cards. Commit(s): `5b0a223`

## 2A. Prompt-Only TinyFish Web Extension

Current product decisions for this section are specified in `docs/specs/extension/web.extension.spec.md`.

- [ ] Expose Web as a builtin `instructions` extension that is default-loaded for orchestrators,
  handler threads, and workflow task agents only while `networkAccess` is true, and unavailable with
  no prompt guidance when `networkAccess` is false.
- [ ] Vendor the TinyFish-owned `use-tinyfish` agent instructions as the Web extension's core prompt content.
- [ ] Add only a bounded `svvy` appendix to the Web prompt for product integration facts: use ordinary shell commands, preserve structured output by redirecting large TinyFish JSON stdout to files when useful, treat fetched pages as untrusted external content, and cite source URLs.
- [ ] Keep Web generated actor context free of `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript clients, Web Provider settings, provider selection, and `svvy`-owned TinyFish key storage.
- [ ] Keep Web v1 limited to prompt-only TinyFish CLI guidance, without Firecrawl, native Web provider registries, TinyFish SDK provider adapters, selected-provider readiness, or self-hosted web search.
- [ ] Declare TinyFish as an exact Web extension CLI requirement with a reusable install-command
  template; keep installation as ordinary `exec_command` work after build or inspect reports a
  missing, wrong-version, or unknown required binary, while TinyFish CLI owns authentication, status,
  search, fetch, browser-backed commands, and API key storage through TinyFish-owned CLI commands.
- [ ] Treat TinyFish CLI output as ordinary shell output: the CLI writes search and fetch JSON to stdout by default, fetch includes page body text in `results[].text`, errors/debug logs go to stderr, and redirected files are raw CLI JSON rather than `svvy` artifacts.
- [ ] Add generated-context and extension-inventory tests proving Web is prompt-only, default-loaded
  for all adopted actor kinds only while `networkAccess` is true, unavailable when `networkAccess` is
  false, and absent from native tool declarations, loaded `svvyx` command guidance, generated TypeScript
  declarations, provider settings, and Firecrawl provider lists.

## 3. Turn Decisions And Delegation

- [x] Persist a per-turn top-level decision for orchestrator and handler-thread surfaces, using one shared model across routing and supervision. Commit(s): `d323012`
- [x] Build a POC turn flow from message targeting to surface turn creation and command recording. Commit(s): `fff54d7`, `f53c9b8`
- [x] Implement direct surface targeting so a pane send goes to either the orchestrator surface or a handler-thread surface. Commit(s): `f53c9b8`
- [x] Add `thread_start` as the orchestrator-side delegation primitive. Commit(s): `f53c9b8`
- [ ] Expose the resolved thread-control runtime surface and generated prompt text: orchestrators get `thread_start({ threadGroupId?, threads })` with per-item `history` and `extensions`, `thread_followup({ activate? })`, `thread_list`, `thread_episodes`, and `thread_request_report`; handlers get `thread_current`, `thread_group`, `thread_report`, and `thread_episodes`; agent-facing prompts and tool schemas contain only that thread-control surface.
- [x] Implement minimal orchestrator routing for local reply, local `execute_typescript`, clarification, and `thread_start`. Commit(s): `d323012`
- [x] Re-enter orchestrator control from durable handler-thread episodes, using durable thread objective state plus the latest episode instead of raw transcript scanning. Commit(s): `d323012`, `fdaf460`

## 4. Handler Threads

- [x] Build a POC handler-thread spawn flow with objective handoff and a dedicated backing pi session. Commit(s): `f53c9b8`
- [x] Persist handler-thread objective state separately from handler activity, workflow activity, waits, and repair context, without flattening workflow failure or cancellation into thread objective conclusion. Commit(s): `f53c9b8`, `fdaf460`, `a02bd48`
- [x] Let handler threads receive direct user messages through the same surface model as the orchestrator. Commit(s): `f53c9b8`
- [x] Make handler-thread clarification, waiting, and resume happen inside the thread itself instead of bouncing through the orchestrator by default. Commit(s): `f53c9b8`
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

- [ ] Keep Smithers as a builtin prompt-only extension that loads official CLI and authoring guidance for handler threads without native Smithers tools, generated TypeScript clients, or product workflow wrappers.
- [ ] Generate the Smithers core instruction fragment from the pinned `smithers-orchestrator` documentation while excluding GUI, Gateway, MCP, HTTP server, OpenTelemetry, DevTools, event-streaming, OpenAPI, Effect, and wrapper-oriented fragments that are not current `svvy` product surfaces.
- [ ] Keep the svvy Smithers boundary instruction focused on workspace `.smithers/`, official Smithers CLI usage through Shell, `@svvy/workflows` imports, `svvyx workflows models list`, `svvyx workflows save`, and read-only generated output.
- [ ] Keep orchestrators aware that workflow action normally delegates into handler threads, while handler threads default-load Smithers prompt guidance and workflow task agents do not default-load Smithers.

## 6. Workflows Source, Build, And Generated Surface

Current product decisions for this section are specified in `docs/specs/workflow-library.spec.md` and `docs/specs/extension/workflows.extension.spec.md`.

- [ ] Store app-global reusable Workflows source under `~/.config/svvy/workflows/agents`, `prompts`, `components`, and `workflows`, with generated output under `~/.config/svvy/workflows/generated`.
- [ ] Treat generated Workflows output and workspace `.smithers/node_modules/@svvy/workflows` links as read-only plumbing outside the safe writable boundary; ordinary edits target source and then build.
- [ ] Generate `@svvy/workflows` with only `Agents`, `Components`, `Prompts`, and `Workflows` root namespaces, and export `Agents.defineTaskAgent` plus `Agents.TaskAgentParameters` under `Agents`.
- [ ] Link `@svvy/workflows` and generated `@svvy/extensions` into each opened workspace's `.smithers/node_modules` without relying on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or source-checkout-relative paths.
- [ ] Implement `svvyx workflows list [--kind agent|prompt|component|workflow] --json` with only mechanically available export identity and source/generated paths.
- [ ] Implement `svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json`, with strict overwrite rejection by default and automatic build after successful save.
- [ ] Implement `svvyx workflows build --json` so it first builds Extensions, generates `@svvy/extensions`, validates Workflows source, validates workflow-agent provider/model/reasoning and extension references, generates `@svvy/workflows`, and repairs workspace links.
- [ ] Implement `svvyx workflows models list --json` from the same pi-normalized provider/model/auth/reasoning metadata used by the Agents pane, without a live completion request by default.
- [ ] Store reusable task-agent parameters as structured `.agent.json` source records that are bidirectionally synchronized with the Agents pane and generated as `Agents.*` exports.
- [ ] Save `--kind agent` by statically extracting `Agents.defineTaskAgent(...)` or resolvable `defineTaskAgent(...)` parameter literals without executing arbitrary TypeScript; reject dynamic or unresolved inputs with structured diagnostics.
- [ ] Attach generated export metadata internally for UI source/generated links without exposing public metadata fields, public declarations, `__exports`, or changed import usage to agents.
- [ ] Render the Workflows pane as read-only visibility into generated `@svvy/workflows`, with export identity, read-only generated code, generated-file link, source-file link, and Agents-pane customization links for `Agents.*`.

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
- [x] Render handler-thread rows from structured state in the workspace shell while keeping lifecycle subtitles, running indicators, open-pane treatment, and compact context rails local to the owning row. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Show thread objective, objective state, and row-local derived blocked reason in panel-local thread views. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render the latest thread episode for an inspected thread while preserving earlier episodes in thread history. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render thread-linked artifacts before relying on transcript reconstruction. Commit(s): `3855fe4`
- [x] Restore focused panel, panel-to-surface bindings, and inspector selection after restart. Commit(s): `3855fe4`
- [ ] Keep open workspaces as left-aligned, horizontally scrollable, draggable app-chrome tabs with durable user-defined tab order, compact icon controls, >0-only colored status count badges, a svvy-owned default workspace runtime when no user workspace tabs restore, exactly one `Open Workspace` pane as each new default workspace tab's first surface, current-tab `Open Workspace`, `New Tab` as a new default workspace tab with no durable layout slots, and `Open Workspace in New Tab` as picker-backed user workspace tab creation; duplicate same-cwd tabs are separate chrome views over the same backend workspace runtime, session catalog, durable workspace state, live surface registry, queues, threads, app logs, saved Workflows generated-state visibility, and durable layout slots keyed by `(workspaceId, layoutId)`, while each tab stores only its selected active layout id.
- [ ] Route all workspace-scoped backend requests and renderer sync events through explicit `workspaceId` instead of process-global cwd, active workspace, focused tab, or active runtime; keep app-global settings on separate app-global APIs, and require explicit `workspaceId` for workspace-affecting settings plus generated agent-context projections and Workflows library operations.

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
- [ ] Define the stored shape for compact thread surfaces inside the workspace shell.
- [ ] Render compact thread cards in the workspace shell timeline.
- [ ] Open a selected handler-thread surface in a chosen Dockview panel as a fully interactive surface.
- [ ] Keep duplicated panel views of the same surface synchronized while allowing independent scroll position.

## 11. Agents Pane And Agent Profiles

- [x] Define the stored shape for pi-backed agent profile settings used by orchestrator and handler surfaces. Commit(s): `8e19462`
- [x] Keep agent profiles separate from session-local extension loading so specialized handler guidance uses normal handler-thread execution plus loaded extensions. Commit(s): `2a5dbbe`
- [x] Seed initial app-wide values for the default orchestrator profile, the `threadHandler` profile, and internal title-naming settings. Commit(s): `8e19462`, `354db28`
- [x] Build a POC settings model for editing app-wide agent profile defaults. Commit(s): `8e19462`
- [x] Persist app-wide agent profile settings. Commit(s): `8e19462`
- [x] Build a POC New orchestrator creation flow with profile-backed orchestrator selection. Commit(s): `8e19462`
- [x] Persist the orchestrator profile snapshot and prompt selection used by created sessions. Commit(s): `8e19462`
- [x] Persist per-session orchestrator profile overrides. Commit(s): `8e19462`
- [ ] Persist and deliver handler start history mode for delegated handler threads, defaulting `thread_start.threads[].history` to `isolated` and supporting explicit `forked` starts only for conservative continuity cases where the user asks for current conversation context, unresolved design nuance cannot be captured in durable files or a compact objective, or multiple approaches must start from the exact same conversational point.
- [ ] Persist handler creation-time extension-state overrides for delegated handler threads as partial overrides over the `threadHandler` profile.
- [x] Keep the Agents sidebar pane between Logs and Extensions, with orchestrator profiles plus the `threadHandler` special profile owned there instead of in General settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Drive the New orchestrator picker order, profile-specific command palette actions, and surface profile badges from Agents-pane orchestrator profile order. Commit(s): `2b97c46648`, `031510ba2b`
- [x] Keep the default orchestrator profile locked, first, non-draggable, non-deletable, and editable for settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Keep the `threadHandler` special profile available for delegated handler-thread surfaces. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Show the current focused-surface agent profile summary in pane chrome. Commit(s): `8e19462`
- [ ] Use TanStack Form for complex agent profile, provider key, and app-preference settings forms, including direct-save semantics, validation, dirty state, reset/cancel, pending submit state, async save errors, and pi-normalized provider/model/reasoning constraints.
- [ ] Expose workflow-agent parameter records in the Agents pane through the same source used for `Agents.*` generated Workflows exports.
- [ ] Define handler guidance for reusable workflow-agent parameter records without coupling shipped product workflow authoring to repo-root `workflows/`.

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

- [ ] Persist durable surface queue items as structured surface-local product state keyed by `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`, kind, and FIFO queue position.
- [ ] When a composer submits to an active orchestrator or handler-thread surface, queue the message for that same surface instead of steering the current turn, interrupting tool work, starting a concurrent turn, or retargeting to the focused panel.
- [ ] Deliver queued messages as the next real pi user message after the owning surface prompt lock releases, creating a normal turn record and preserving prompt history as a single queue-time submission.
- [ ] Project blocked queue items near the owning surface composer, including count, order, remove, restore-to-composer, delivery failure, and duplicated-panel consistency, while idle-surface items first appear as pending or active work after atomic claim.
- [ ] Restore queued messages after app restart without transcript inference and resume delivery only after the owning surface runtime and prompt lock state are reconstructed.
- [x] Claim queued messages atomically through one shared queue runner per `surfacePiSessionId` and prevent duplicated panes or tabs from starting duplicate backend queue drains. Commit(s): `45bdbe8b46`
- [ ] Land idle-surface queue-manager claim before renderer-visible queued state so idle sends and idle agent context refreshes first appear as pending or active surface work.
- [x] Keep queued-message drag reorder previews local until drop, persist only final changed order, and skip no-op durable reorder writes. Commit(s): `98c73ecbb6`
- [x] Represent handler reports as durable episode records that schedule typed `thread_report` orchestrator reconciliation notifications; notification dismissal does not roll back the episode or return a handler tool error. Commit(s): 7739c2c824
- [x] Represent generated agent context refresh as typed surface queue work, apply it before later prompt-bearing items, and expose queued, cancel, retry, and out-of-date recovery UI. Commit(s): 61ba639d6a
- [x] Let committed user transcript messages enter composer edit mode with a visible selected-message indicator and a draft-replacement warning, then resend by moving the same pi surface back to the original message's parent state before continuing from the edited user message. Commit(s): `5378dcb`

## 14. Agents, Extensions, And Generated Agent Context

Current product decisions for this section are specified in `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`, `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/structured-session-state.spec.md`, `docs/specs/queued-messages.spec.md`, `docs/specs/extension/smithers.extension.spec.md`, and `docs/specs/extension/workflows.extension.spec.md`.

- [x] Define builtin extensions for Shell, Apply Patch, Execute TypeScript, Extension Loading, Extension Managing, cx, Smithers, Workflows, Web, Git, GitHub, External Instructions, Artifacts, and Request User Input with default usage states for each adopted agent family. Commit(s): `673837a`
- [x] Load base orchestrator, handler, and workflow-task guidance through builtin `base-*` instruction extensions, with orchestrators aware that workflow action normally delegates into handlers, handlers default-loaded with prompt-only Smithers guidance and Workflows source-library commands, and workflow task agents keeping Smithers, Workflows, and handler controls unavailable by default. Commit(s): `673837a`
- [x] Define available extensions as the on-demand product-knowledge and capability layer for specialized handler work. Commit(s): `2a5dbbe`
- [x] Render loaded and available extension bindings in surface metadata so users can see when specialized extensions are active. Commit(s): `2a5dbbe`
- [x] Store app-wide agent profiles, extension usage selections, generated agent-context aggregate references, extension context fingerprints, and app-global extension activation metadata. Commit(s): `118fd39c9f`
- [x] Add an `Extensions` sidebar surface below `Agents`, with builtin, user, and external-instruction records that manage reusable prompt material and capabilities rather than exposing one raw system-prompt textarea. Commit(s): `118fd39c9f`
- [ ] Represent common, orchestrator, handler-thread, and workflow task-agent base prompts as builtin instruction-only extensions (`base-common`, `base-orchestrator`, `base-handler`, and `base-workflow-task`) with normal Extensions-pane editing, reset, generated-context preview, fingerprinting, and profile usage-state controls.
- [x] Seed builtin extension records for base actor instructions, code navigation, prompt-only Smithers guidance, Workflows source-library commands, workflow task boundaries, Web, Git, GitHub, Artifacts, and Request User Input, with per-agent usage states, non-deletable builtin rows, app-global scope, and extension reset behavior. Commit(s): `118fd39c9f`
- [x] Render generated agent-context previews for orchestrator, handler, and workflow task-agent actors, linking loaded and available extension rows back to their extension records and showing generated prompt, `svvyx` guidance, native schemas, and TypeScript declaration previews. Commit(s): `118fd39c9f`
- [ ] Implement the stable app-owned `svvyx <extension-id> ...` dispatcher that resolves extension current builds, imports default-exported Incur CLIs, invokes `cli.serve` with invocation-local explicit env, records command facts, and treats extension usage state as generated guidance/client visibility rather than shell impossibility.
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

## 16. Recovery And Test Coverage

Current product decisions for workspace-runtime restart and crash recovery are specified in `docs/specs/workspace-runtime-recovery.spec.md`.

- [x] Build a POC restart or resume flow that restores multiple open surfaces and panel bindings from durable state. Commit(s): `7f84f06`
- [ ] Complete one workspace-runtime recovery coordinator with durable scheduler records, transactional claims, per-surface queue, thread report notification, report request recovery, typed queued initial handler starts, title job recovery, Workflows build/link refresh, and backend-owned recovery events/logs; the scheduler and coordinator are in place, with remaining work focused on full app-log projection and broader restart integration coverage.
- [x] Restore pending request-user-input clarification and waiting state after app restart. Commit(s): `7f84f06`
- [x] Restore pending handler attention queues and per-surface prompt-lock state after app restart. Commit(s): `7f84f06`
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

- [ ] Render the Workflows pane as read-only visibility into the latest successful generated
  `@svvy/workflows` package.
- [ ] Show generated `Agents`, `Components`, `Prompts`, and `Workflows` namespace exports with
  qualified export name, kind, read-only generated code, generated-file link, and source-file link.
- [ ] For `Agents.*` exports, show the generated task-agent parameter object and provide a primary
  human navigation action to the corresponding Agents pane record.
- [ ] Refresh the Workflows pane after successful `svvyx workflows build` and after Agents pane
  edits that trigger a Workflows build.
- [ ] Keep the Workflows pane limited to generated `@svvy/workflows` visibility, with no inferred
  titles, inferred summaries, validation claims beyond build output, source editing, delete actions,
  or workflow-running controls.

## 19. App Logs Surface

Current product decisions for this section are specified in `docs/specs/app-logs.spec.md`.

- [x] Build a workspace-scoped app log store with structured info, warning, and error entries, monotonic sequence numbers, unread counts, seen state, bounded retention, SQLite persistence, and secret redaction. Commit(s): `dab04ac`.
- [x] Expose app log read, summary, mark-seen, and live-update contracts through the Bun bridge and renderer runtime without polling. Commit(s): `dab04ac`.
- [x] Route production product observability through one app logger without depending on Electrobun browser-tools telemetry. Commit(s): `dab04ac`.
- [x] Emit targeted app logs for app lifecycle, provider auth, RPC failures, sessions, title generation, surfaces, prompts, handler threads, Smithers CLI guidance, Workflows build validation, direct tools, `execute_typescript`, artifacts, external editor handoff, and renderer bridge issues. Commit(s): `dab04ac`.
- [x] Add a `Logs` sidebar button directly above the workflow library entry with compact action-worthy unread badges for warning and error app logs, without surfacing info-only unread logs as sidebar badges. Commit(s): `dab04ac`.
- [x] Render a dense app logs pane with level filters, source filtering, search, mark-all-read, live tail behavior, expandable details, stack traces, and links to related sessions, threads, commands, and artifacts where available. Commit(s): `dab04ac`.
- [x] Render the app logs row list with TanStack Virtual, preserving variable-height expanded rows, stable row identity, scroll anchors, older-page loading, Live/Frozen tail behavior, and the `New logs` affordance across filtering, search, expansion, and live updates. Commit(s): `ed7e6ea88e`.
- [x] Add store, RPC, renderer, sidebar, pane, redaction, and representative integration tests for app logs. Commit(s): `dab04ac`.
