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
- [x] Generate the first curated typed `api.*` capability namespaces for repo, git, web, artifact, and bounded exec work. Commit(s): `76cc8f3`, `29d8452`
- [x] Run a simple ordinary scripted task through `execute_typescript`. Commit(s): `76cc8f3`
- [x] Build a POC artifact and tracing pipeline for code-mode execution. Commit(s): `76cc8f3`
- [x] Capture code-mode logs and nested command traces as artifacts and structured command records. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Keep only `thread.start`, `thread.handoff`, and `wait` as `svvy`-native control tools while exposing Smithers workflow operations through Smithers-native bridge tools. Commit(s): `a02bd48`
- [x] Limit day-one capabilities to the curated `api.*` surface defined by the spec, including explicit `api.exec.run`. Commit(s): `76cc8f3`, `29d8452`
- [x] Expand the repo namespace to workspace-fs and search utilities with plural reads and structured listings. Commit(s): `76cc8f3`, `29d8452`
- [x] Expand the git namespace to the settled command-shaped surface, including `status`, `diff`, `log`, `show`, `branch`, `mergeBase`, `fetch`, `pull`, `push`, `add`, `commit`, `switch`, `checkout`, `restore`, `rebase`, `cherryPick`, `stash`, and `tag`. Commit(s): `76cc8f3`, `29d8452`
- [x] Persist normalized child-command facts for nested `api.*` calls while the parent `execute_typescript` attempt remains the main semantic unit. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Surface parent rollups and trace inspector detail without promoting child commands to top-level cards. Commit(s): `5b0a223`

## 3. Turn Decisions And Delegation

- [x] Persist a per-turn top-level decision for orchestrator and handler-thread surfaces, using one shared model across routing and supervision. Commit(s): `d323012`
- [x] Build a POC turn flow from message targeting to surface turn creation and command recording. Commit(s): `fff54d7`, `f53c9b8`
- [x] Implement direct surface targeting so a pane send goes to either the orchestrator surface or a handler-thread surface. Commit(s): `f53c9b8`
- [x] Add `thread.start` as the orchestrator-side delegation primitive. Commit(s): `f53c9b8`
- [x] Implement minimal orchestrator routing for local reply, local `execute_typescript`, clarification, and `thread.start`. Commit(s): `d323012`
- [x] Re-enter orchestrator control from the handler-thread latest handoff, using durable thread state plus the latest handoff episode instead of raw transcript scanning. Commit(s): `d323012`, `fdaf460`

## 4. Handler Threads

- [x] Build a POC handler-thread spawn flow with objective handoff and a dedicated backing pi session. Commit(s): `f53c9b8`
- [x] Persist handler-thread lifecycle transitions for handler-active, workflow-active, waiting, troubleshooting, and completed states without flattening workflow failure or cancellation into thread terminal state, with `completed` reserved for explicit handoff after active workflow supervision has been resolved. Commit(s): `f53c9b8`, `fdaf460`, `a02bd48`
- [x] Let handler threads receive direct user messages through the same surface model as the orchestrator. Commit(s): `f53c9b8`
- [x] Make handler-thread wait and resume happen inside the thread itself instead of bouncing through the orchestrator by default. Commit(s): `f53c9b8`
- [x] Keep handed-back handler threads directly interactive for follow-up chat without forcing a new thread. Commit(s): `ba5c3f0`
- [x] Let a handed-back thread move from completed back to the correct active state when objective work resumes, distinguishing handler-active from workflow-active supervision. Commit(s): `f53c9b8`, `a02bd48`
- [x] Preserve earlier handoff points in thread history when the same thread later returns control again. Commit(s): `d323012`
- [x] Allow the orchestrator to inspect a handler thread on demand without making that the default reconciliation path. Commit(s): `ba5c3f0`
- [x] Make `thread.handoff` the explicit handler-thread handoff path so ordinary handler replies stay interactive and multi-turn. Commit(s): `fdaf460`
- [x] Load the orchestrator and handler-thread instructions through pi's true `systemPrompt` channel before any reconstructed prompt body is composed. Commit(s): `8a41d08`
- [x] Keep handoff, resume, and transcript-rebuild prompt bodies free of duplicated system prompt text while surfacing the active system prompt as a collapsible transcript item. Commit(s): `8a41d08`
- [x] Slice generated capability declarations by actor so the orchestrator prompt receives only orchestrator-callable tools while handler-thread prompts receive only handler-callable tools. Commit(s): `a02bd48`
- [x] Teach the orchestrator prompt that workflow actions require delegation into a handler thread instead of exposing `smithers.*` directly in the orchestrator API block. Commit(s): `a02bd48`
- [x] Teach handler-thread prompts that the orchestrator owns delegation and reconciliation while omitting orchestrator-only tool declarations such as `thread.start` unless nested delegation is explicitly adopted. Commit(s): `a02bd48`

## 5. Workflow Supervision Foundations

- [x] Define the packaged-app Smithers runtime boundary so shipped product workflows are bundled app assets under `src/bun/smithers-runtime/` rather than repo-root `workflows/` authoring assets. Commit(s): `a02bd48`
- [x] Build a POC handler thread that starts one bundled product-runtime hello-world workflow from `src/bun/smithers-runtime/`, supervises it through completion, and regains control in the same thread without relying on repo-root `workflows/`. Commit(s): `a02bd48`
- [x] Define the workflow-run request envelope from a handler thread to Smithers. Commit(s): `f53c9b8`
- [x] Persist workflow-run supervision metadata, including raw Smithers status, wait kind, reconnect cursor, handler-attention delivery state, heartbeat freshness, and lineage, as soon as the supervising handler thread has a concrete Smithers run id. Commit(s): `a02bd48`
- [x] Build a POC one-task workflow under a handler thread that returns to the thread and then emits a handoff episode. Commit(s): `f8557d9`
- [x] Let handler threads call the generated per-workflow Smithers run-launch surface through the Bun bridge for both new and resumed runs. Commit(s): `4674e67`
- [x] Extend the Smithers-native supervision surface beyond the shipped Step 5 handler-thread/runtime coverage for blocker diagnosis, approvals, signals, cancellation, node detail, artifacts, transcripts, event history, frames, and DevTools inspection, focusing on the remaining operator-only and richer troubleshooting controls. Commit(s): `f8557d9`
- [x] Define workflow task agents as a lower-level Smithers actor class distinct from orchestrator and handler-thread surfaces. Commit(s): `a02bd48`
- [x] Adopt a PI-backed svvy workflow-task agent profile with a dedicated task prompt and `execute_typescript` as the default task-local tool surface. Commit(s): `a02bd48`
- [x] Keep approval gates and hijack as Smithers runtime or operator controls around workflow task agents rather than exposing them as ordinary task-agent tools. Commit(s): `a02bd48`
- [x] Build a POC bundled workflow task that runs the svvy workflow-task PI profile with `execute_typescript` only. Commit(s): `a02bd48`
- [x] Wake the supervising handler thread in a background turn only when a workflow run reaches a terminal outcome, an actionable wait, a continuation boundary, or a supervision fault that requires handler judgment, while keeping duplicate terminal reconciliation idempotent after a valid handoff. Commit(s): `a02bd48`
- [x] Support multiple workflow runs under one handler thread. Commit(s): `f53c9b8`, `43a26cb`
- [x] Derive active and latest workflow summaries from workflow-run state without a persisted thread-level latest pointer. Commit(s): `a02bd48`
- [x] Persist durable reconnect cursors plus pending-versus-delivered handler-attention state on workflow runs so restart recovery and wake-up dedupe do not depend on process memory. Commit(s): `2f874a7`
- [x] Emit explicit Smithers bridge lifecycle events for workflow projection, reconnect bootstrap, and handler-attention delivery. Commit(s): `2f874a7`
- [x] Bootstrap workflow supervision from durable run state on session restore, rebuilding runtime ownership from workflow-run records and replaying only undelivered handler attention. Commit(s): `2f874a7`
- [x] Keep `thread.handoff`, Smithers read APIs, selectors, and renderer reads free of lifecycle repair writes. Commit(s): `2f874a7`
- [x] Guarantee that a workflow-run failure or cancellation moves the handler thread into troubleshooting before any later user-directed closure or handoff. Commit(s): `a02bd48`

## 6. Workflow Authoring, Saved Assets, And Artifact Promotion

- [ ] Define the bundled workflow authoring guide and curated best-practice example bundle injected into workflow-writing context.
- [ ] Build a POC handler-thread flow that authors a short-lived workflow artifact for one delegated objective instead of selecting from a tiny structural template menu.
- [ ] Persist every authored short-lived workflow under `.svvy/artifacts/workflows/<artifact_workflow_id>/` with `definitions/`, `prompts/`, `components/`, `entries/`, and provenance metadata.
- [ ] Define the saved workflow library layout under `.svvy/workflows/definitions/`, `.svvy/workflows/prompts/`, `.svvy/workflows/components/`, and `.svvy/workflows/entries/`.
- [ ] Define the discovery metadata contract compiled from JSDoc headers in `ts` or `tsx` files and frontmatter in `mdx` prompt files.
- [ ] Expose `api.workflow.listAssets(...)` inside `execute_typescript` so workflow-writing actors can discover saved definitions, prompts, components, and agent profiles before reading files directly.
- [ ] Expose `api.workflow.listModels()` inside `execute_typescript` for the escape hatch where no saved agent profile fits.
- [ ] Build a POC saved definition plus saved entry that are reused by a new short-lived artifact entry with different prompts, profiles, or config bound at authoring time.
- [ ] Keep authored workflows artifact-only by default until an explicit save action is taken.
- [ ] Add an explicit save or promotion path that copies selected reusable definitions, prompts, components, or entries out of an artifact workflow into `.svvy/workflows/` while preserving the original artifact for provenance.
- [ ] Surface all runnable saved and artifact entries through `smithers.list_workflows` and `smithers.run_workflow.<workflow_id>`, with each entry publishing an explicit launch contract and grouped asset refs rather than relying on inferred import graphs.
- [ ] Persist agent profile components as discoverable saved workflow components with explicit profile-oriented metadata.

## 7. Verification As First-Class State

- [ ] Build a POC verification workflow as a saved definition or short-lived artifact workflow that captures build, test, lint, or manual check outcomes.
- [ ] Persist verification records produced by verification-shaped workflow runs.
- [ ] Capture build verification results with status, summary, and artifacts.
- [ ] Capture test verification results with status, summary, and artifacts.
- [ ] Capture lint verification results with status, summary, and artifacts.
- [ ] Capture manual verification checkpoints.
- [ ] Surface failed or incomplete verification as routing input for later orchestrator decisions.
- [ ] Show latest verification outcome inline in session and inspector surfaces.

## 8. Workspace Navigation, Live Surfaces, And Core Projection

- [x] Drive the session sidebar entirely from durable workspace session summaries. Commit(s): `9a21f87`, `b0ee858`
- [ ] Define the stored shape for flat folder labels on sessions.
- [ ] Persist session folder membership.
- [ ] Render flat folder groupings in the session sidebar.
- [ ] Define the workspace read model for saved workflow assets and artifact workflows.
- [ ] Render a `Save workflow` action for saveable artifact workflows in the relevant thread or workflow surfaces.
- [ ] Render a saved workflow library tab in the workspace shell with separate definitions, prompts, components, and entries groupings.
- [ ] Show saved asset title, summary, kind, path, tags, and recency metadata in the saved workflow library tab, including explicit indication when a component is an agent profile and grouped asset refs for entries.
- [ ] Allow deleting a saved workflow definition, prompt, component, or entry from the library without deleting historical artifact workflows that previously used it.
- [x] Join session summaries, focused pane, and pane-to-surface bindings in one workspace-shell read model without depending on a global active surface. Commit(s): `9a21f87`, `b0ee858`
- [x] Split workspace-summary updates from live surface transcript updates in the renderer runtime. Commit(s): `9a21f87`, `b0ee858`
- [x] Manage open live surfaces in a shared registry keyed by `surfacePiSessionId`. Commit(s): `9a21f87`, `b0ee858`
- [x] Give each live surface its own prompt lock, model state, reasoning state, and cancellation lifecycle. Commit(s): `9a21f87`, `b0ee858`
- [ ] Render handler-thread lists from structured thread data in the workspace shell and focused pane.
- [ ] Show thread objective, status, latest workflow-run summary, and blocked reason in pane-local thread views.
- [ ] Render the latest handoff episode for an inspected thread while preserving earlier handoff points in thread history.
- [ ] Render thread- and workflow-run-linked artifacts before relying on transcript reconstruction.
- [ ] Render a verification summary block for the focused surface or inspected thread.
- [ ] Restore focused pane, pane-to-surface bindings, and inspector selection after restart.

## 9. Session Modes And Runtime Profiles

- [ ] Define the runtime profile ids and stored shape for orchestrator, quick, handler, explorer, implementer, reviewer, and workflow-writer.
- [ ] Seed initial app-wide default values for those runtime profiles.
- [ ] Build a POC settings model for editing app-wide runtime profile defaults.
- [ ] Persist app-wide runtime profile defaults.
- [ ] Build a POC session creation flow with separate orchestrator-session and quick-session actions.
- [ ] Persist session mode and the default orchestrator-surface prompt selection.
- [ ] Persist per-session overrides for each runtime profile.
- [ ] Apply the quick-session main profile and quick-session system prompt at session creation.
- [ ] Show the current focused-surface runtime profile summary in pane chrome.
- [ ] Expand the session runtime panel to inspect all agent runtime profiles for the focused surface's session.

## 10. Session Titles

- [ ] Define the stored title states for top-level sessions and handler threads.
- [ ] Add the hidden `namer` system agent for one-shot top-level session naming.
- [ ] Seed the `namer` agent to `gpt-5.4-mini` with low reasoning effort.
- [ ] Build a POC one-shot title generation after the first real user turn for a top-level session.
- [ ] Persist generated top-level session titles and stop silent auto-retitling after the first real user turn has passed.
- [ ] Freeze auto-titling after manual rename.
- [ ] Generate deterministic task-based titles for handler threads and workflow runs without using the `namer`.

## 11. Composer Mention Targets

- [ ] Define the stored shape for symbolic file and folder mention targets in the composer.
- [ ] Build a POC `@` autocomplete picker over workspace files and folders.
- [ ] Render selected file and folder mentions as removable composer chips.
- [ ] Persist the visible mention text and resolved target paths on send.
- [ ] Resolve file and folder mentions into symbolic context targets for orchestrator and handler-thread prompting.
- [ ] Keep folder mentions symbolic by default instead of eagerly pasting or expanding contents in the composer.

## 12. Layered Workflow Knowledge

- [ ] Inventory the workflow-related prompt, skill, and knowledge assets the product needs.
- [ ] Build a POC repo layout for workflow knowledge with separate orchestrator-facing and handler-facing assets.
- [ ] Define the first minimal orchestrator-facing workflow summary shape.
- [ ] Define the first richer handler-facing workflow prompt or example shape.
- [ ] Load only minimal workflow summaries into orchestrator routing context.
- [ ] Build a POC delegated workflow that receives extended workflow knowledge without expanding orchestrator context.

## 13. Worktree-Aware Execution

- [ ] Build a POC thread-to-worktree binding model and inspect how it should appear in the UI.
- [ ] Persist worktree binding on threads.
- [ ] Persist worktree binding on workflow runs.
- [ ] Show active worktree on orchestrator and thread surfaces.
- [ ] Warn when the focused pane surface context and current filesystem context diverge.
- [ ] Build a POC isolated workflow run in a separate worktree.
- [ ] Let handler threads declare or acquire an isolated worktree when needed.
- [ ] Show which thread or workflow run owns each worktree-backed execution.

## 14. Headless Surface

- [ ] Build a POC one-shot headless entrypoint that reuses desktop orchestration code.
- [ ] Define the headless one-shot input contract.
- [ ] Return structured output for an ordinary headless turn.
- [ ] Return structured output for a delegated headless objective and its latest handoff episode.
- [ ] Emit thread, workflow-run, episode, and artifact references in headless results.
- [ ] Reuse the same orchestrator and state model as desktop execution.

## 15. Pane Layout, Surface Ownership, And Expanded Surfaces

- [ ] Define the stored shape for a fixed pane layout up to `3x3`, including multi-cell spans.
- [ ] Persist pane-to-surface bindings separately from live surface runtime state.
- [ ] Build a POC workspace pane grid that opens one surface in a targeted slot.
- [ ] Support click-split or drag placement into a chosen pane slot.
- [x] Manage explicit open and close semantics for live surfaces independently from pane focus. Commit(s): `9a21f87`, `b0ee858`
- [x] Allow the same interactive surface to be opened in more than one pane slot at once. Commit(s): `9a21f87`, `b0ee858`
- [x] Keep one underlying live surface controller per `surfacePiSessionId` regardless of pane count. Commit(s): `9a21f87`, `b0ee858`
- [ ] Persist pane occupancy and pane geometry across app restart.
- [ ] Restore the focused pane on app restart.
- [ ] Show exact pane-position indicators in the sidebar for open surfaces.
- [ ] Show a clear highlight for the currently focused pane surface.
- [ ] Define the stored shape for compact thread and workflow-run surfaces inside the workspace shell.
- [ ] Render compact thread cards in the workspace shell timeline.
- [ ] Render compact workflow-run cards in the workspace shell timeline.
- [ ] Open a selected handler-thread surface in a pane slot as a fully interactive surface.
- [ ] Keep duplicated views of the same surface synchronized while allowing independent scroll position.

## 16. Dedicated Workflow Inspector

- [ ] Define the projected graph shape for a workflow inspector surface.
- [ ] Build a POC static graph view for one completed workflow run.
- [ ] Distinguish agent-task, script, verification, wait, retry, and terminal-result nodes in that graph.
- [ ] Render active, completed, failed, and waiting node states clearly.
- [ ] Add selectable workflow nodes.
- [ ] Show a detail panel for the selected workflow node.
- [ ] Surface node objective, latest output, related artifacts, runtime profile, and worktree in that detail panel.
- [ ] Stream live workflow status changes into the graph while a workflow is running.
- [ ] Render retry or loop edges without making the main path hard to read.
- [ ] Open a selected child workflow node or related thread surface from the workflow inspector into another pane slot.
- [ ] Keep completed workflow inspectors available as durable historical surfaces after completion.

## 17. Recovery And Test Coverage

- [ ] Build a POC restart or resume flow that restores multiple open surfaces and pane bindings from durable state.
- [ ] Restore pending clarification and waiting state after app restart.
- [ ] Restore active workflow-run state after app restart.
- [ ] Restore pending handler attention queues and per-surface prompt-lock state after app restart.
- [ ] Add integration tests that exercise the real pi-backed runtime seam for direct work.
- [ ] Expand from the current real embedded-runtime supervision coverage in `src/bun/smithers-runtime/manager.test.ts` and `src/bun/smithers-tools.test.ts` to full pi-backed handler-thread delegation and workflow-run supervision.
- [ ] Add integration tests that exercise restart and resume behavior across workspace state, live surface state, and pane bindings.

## 18. Context Budget Observability

- [ ] Define the context-budget metric as an explicit percentage of the active model's max context.
- [ ] Define neutral, orange, and red thresholds for that metric.
- [ ] Build a POC full-width focused-surface context bar below the composer.
- [ ] Render the focused-surface context bar beneath the text input.
- [ ] Build a POC compact bottom-edge context indicator for collapsed delegated-work surfaces.
- [ ] Render bottom-edge context indicators on collapsed handler-thread and workflow surfaces.
- [ ] Render full-width context bars on expanded handler-thread panes.
