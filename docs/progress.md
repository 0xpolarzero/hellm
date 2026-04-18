# Progress

Incremental roadmap from the current baseline to the shipped PRD.

How to use this file:

- Keep items small enough to land in a focused PR.
- Prefer adding new items next to the closest related step instead of appending unrelated backlog at the bottom.
- Keep sections ordered by dependency: durable facts and execution before projection surfaces that depend on them.
- When an item is done, change `[ ]` to `[x]` and append the landing commit hash or hashes.
- If an item starts reading like a subsystem instead of a step, split it before implementation.
- For any big lift or unclear design, add a POC step immediately before the production implementation step.
- Use POC steps to validate shape, constraints, and UX without prematurely locking the final architecture.

## Current Baseline

- [x] Bootstrap the Electrobun desktop app around a pi-backed host/runtime instead of a standalone shell. Commit(s): `c118be7`
- [x] Add provider auth/settings support with local key storage and OAuth-backed access. Commit(s): `c118be7`, `6d757dc`
- [x] Add the artifact projection panel in the desktop workbench. Commit(s): `1d9bc05`, `6d757dc`
- [x] Add workspace-scoped prompt history recall in the composer. Commit(s): `cb1b7f1`
- [x] Add multi-session workspace navigation and session switching/resume support. Commit(s): `pending local work / add landing hash when committed`

## 1. Structured Session State

Workflow-inspector UI work remains explicitly out of scope for this section and stays under section 16.

- [x] Build a POC session overlay document and validate how it can sit above pi session data. Commit(s): `pending local work / add landing hash when committed`
- [x] Persist a minimal structured session overlay root above pi session data. Commit(s): `pending local work / add landing hash when committed`
- [ ] Add `surfacePiSessionId` linkage on turns so orchestrator-surface and handler-thread turns use one model.
- [ ] Persist handler-thread records with title, objective, status, wait state, backing pi session id, and latest workflow-run linkage.
- [ ] Replace the old one-thread-one-workflow assumption with workflow-run records that allow many runs under one handler thread.
- [ ] Persist workflow-run records with run id, workflow name, template or preset metadata, status, summary, and timestamps.
- [ ] Persist artifact references independently from transcript parsing at thread, workflow-run, and command scope.
- [ ] Persist terminal episode records as the final semantic output of a completed handler thread.
- [ ] Persist session wait state as a frontier-level summary derived from surface and thread wait state.
- [ ] Remove transcript-derived fallback writes so structured session state only changes from explicit runtime producers or tool events.
- [ ] Reconstruct workspace and session summaries from structured state on app load.

## 2. `execute_typescript`

- [x] Build a POC `execute_typescript` runtime with compile or typecheck-before-run diagnostics and the adopted TypeScript input/output contract.
- [x] Expose a minimal `execute_typescript` tool with the adopted input/output contract and injected `api.*` surface.
- [x] Persist each attempted snippet as a file-backed artifact before execution, with SQLite metadata and path indexing.
- [x] Generate the first curated typed `api.*` capability namespaces for repo, git, web, artifact, and bounded exec work.
- [x] Run a simple ordinary scripted task through `execute_typescript`.
- [x] Build a POC artifact and tracing pipeline for code-mode execution.
- [x] Capture code-mode logs and nested command traces as artifacts and structured command records.
- [ ] Keep `thread.start`, `workflow.start`, `workflow.resume`, and `wait` as separate native control tools.
- [ ] Limit day-one capabilities to the curated `api.*` surface defined by the spec, including explicit `api.exec.run`.
- [ ] Expand the repo namespace to workspace-fs and search utilities with plural reads and structured listings.
- [ ] Expand the git namespace to the settled command-shaped surface, including `status`, `diff`, `log`, `show`, `branch`, `mergeBase`, `fetch`, `pull`, `push`, `add`, `commit`, `switch`, `checkout`, `restore`, `rebase`, `cherryPick`, `stash`, and `tag`.
- [ ] Persist normalized child-command facts for nested `api.*` calls while the parent `execute_typescript` attempt remains the main semantic unit.
- [ ] Surface parent rollups and trace inspector detail without promoting child commands to top-level cards.

## 3. Turn Routing And Delegation

- [ ] Persist a per-turn routing result for the orchestrator surface.
- [ ] Build a POC turn flow from message targeting to surface turn creation and command recording.
- [ ] Implement direct surface targeting so a pane send goes to either the orchestrator surface or a handler-thread surface.
- [ ] Add `thread.start` as the orchestrator-side delegation primitive.
- [ ] Implement minimal orchestrator routing for local reply, local `execute_typescript`, clarification, and `thread.start`.
- [ ] Re-enter the orchestrator from terminal handler-thread episodes and durable thread state instead of raw transcript scanning.

## 4. Handler Threads

- [ ] Build a POC handler-thread spawn flow with objective handoff and a dedicated backing pi session.
- [ ] Persist handler-thread lifecycle transitions for running, waiting, completed, failed, and cancelled states.
- [ ] Let handler threads receive direct user messages through the same surface model as the orchestrator.
- [ ] Make handler-thread wait and resume happen inside the thread itself instead of bouncing through the orchestrator by default.
- [ ] Ensure each handler thread emits at most one final terminal episode.
- [ ] Allow the orchestrator to inspect a handler thread on demand without making that the default reconciliation path.

## 5. Workflow Supervision Foundations

- [ ] Build a POC handler thread that selects a workflow template or preset, runs it, and regains control on completion.
- [ ] Define the workflow-run request envelope from a handler thread to Smithers.
- [ ] Create a durable workflow-run record before delegated execution starts.
- [ ] Build a POC one-task workflow under a handler thread that returns to the thread and then emits a final episode.
- [ ] Allow handler threads to call `workflow.start`.
- [ ] Allow handler threads to call `workflow.resume`.
- [ ] Resume handler-thread control when a workflow run completes, fails, or pauses.
- [ ] Support multiple workflow runs under one handler thread.
- [ ] Persist latest-workflow-run linkage on the thread for summary selectors.
- [ ] Guarantee that a workflow-run failure still returns durable failure state to the supervising handler thread even when the planned workflow finalization path does not run.

## 6. Workflow Templates And Presets

- [ ] Define the first structural workflow templates: `single_task`, `sequential_pipeline`, `fanout_join`, and `verification_run`.
- [ ] Define the stored shape for reusable workflow presets layered on top of those structural templates.
- [ ] Build a POC handler thread that chooses between template, preset, and authored custom workflow.
- [ ] Build a POC one-task workflow that authors a custom workflow and explains it back to the handler thread.
- [ ] Let a handler thread run an authored custom workflow after the authoring step completes.
- [ ] Keep authored workflows ephemeral by default until an explicit later template-capture path exists.

## 7. Verification As First-Class State

- [ ] Build a POC verification workflow template that captures build, test, lint, or manual check outcomes.
- [ ] Persist verification records produced by verification-shaped workflow runs.
- [ ] Capture build verification results with status, summary, and artifacts.
- [ ] Capture test verification results with status, summary, and artifacts.
- [ ] Capture lint verification results with status, summary, and artifacts.
- [ ] Capture manual verification checkpoints.
- [ ] Surface failed or incomplete verification as routing input for later orchestrator decisions.
- [ ] Show latest verification outcome inline in session and inspector surfaces.

## 8. Session Navigation And Core Projection

- [ ] Drive the session sidebar entirely from durable session summaries.
- [ ] Define the stored shape for flat folder labels on sessions.
- [ ] Persist session folder membership.
- [ ] Render flat folder groupings in the session sidebar.
- [ ] Build a POC threads-and-episodes read model from structured state in the main session view.
- [ ] Render handler-thread lists from structured thread data.
- [ ] Show thread objective, status, latest workflow-run summary, and blocked reason in the main session view.
- [ ] Render the final terminal episode for a selected thread.
- [ ] Render thread- and workflow-run-linked artifacts before relying on transcript reconstruction.
- [ ] Render a verification summary block for the selected thread or session.
- [ ] Restore selected session, selected thread surface, and inspector selection after restart.

## 9. Session Modes And Runtime Profiles

- [ ] Define the runtime profile ids and stored shape for orchestrator, quick, handler, explorer, implementer, reviewer, and workflow-writer.
- [ ] Seed initial app-wide default values for those runtime profiles.
- [ ] Build a POC settings model for editing app-wide runtime profile defaults.
- [ ] Persist app-wide runtime profile defaults.
- [ ] Build a POC session creation flow with separate orchestrator-session and quick-session actions.
- [ ] Persist session mode and the main-session prompt selection.
- [ ] Persist per-session overrides for each runtime profile.
- [ ] Apply the quick-session main profile and quick-session system prompt at session creation.
- [ ] Show the current main runtime profile summary in the session chrome.
- [ ] Expand the session runtime panel to inspect all agent runtime profiles for that session.

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
- [ ] Warn when selected session context and current filesystem context diverge.
- [ ] Build a POC isolated workflow run in a separate worktree.
- [ ] Let handler threads declare or acquire an isolated worktree when needed.
- [ ] Show which thread or workflow run owns each worktree-backed execution.

## 14. Repo-Local Workflow Hooks

- [ ] Discover `.svvy/` config for the current workspace.
- [ ] Build a POC preflight hook flow for one consequential workflow run.
- [ ] Define a first preflight hook declaration format.
- [ ] Run preflight hooks before consequential workflow runs.
- [ ] Make preflight outputs available to downstream workflow steps.
- [ ] Build a POC validation hook flow that can fail a candidate workflow result.
- [ ] Define a first validation hook declaration format.
- [ ] Run validation hooks after candidate workflow completion.
- [ ] Convert validation failure into structured workflow-run outcome and handler-thread state.
- [ ] Persist hook artifacts and outputs for later inspection.

## 15. Headless Surface

- [ ] Build a POC one-shot headless entrypoint that reuses desktop orchestration code.
- [ ] Define the headless one-shot input contract.
- [ ] Return structured output for an ordinary headless turn.
- [ ] Return structured output for a delegated headless objective and its final episode.
- [ ] Emit thread, workflow-run, episode, and artifact references in headless results.
- [ ] Reuse the same orchestrator and state model as desktop execution.

## 16. Pane Layout And Expanded Surfaces

- [ ] Define the stored shape for a fixed pane layout up to `3x3`, including multi-cell spans.
- [ ] Build a POC exact slot-position icon system for pane occupancy, including spanned surfaces.
- [ ] Build a POC workspace pane grid that opens one surface in a targeted slot.
- [ ] Support click-split or drag placement into a chosen pane slot.
- [ ] Allow the same interactive surface to be opened in more than one pane slot at once.
- [ ] Persist pane occupancy and pane geometry across app restart.
- [ ] Restore the focused pane on app restart.
- [ ] Show exact pane-position indicators in the sidebar for open surfaces.
- [ ] Show a clear highlight for the currently focused pane surface.
- [ ] Define the stored shape for compact thread and workflow-run surfaces inside the main session.
- [ ] Render compact thread cards in the main session timeline.
- [ ] Render compact workflow-run cards in the main session timeline.
- [ ] Open a selected handler-thread surface in a pane slot as a fully interactive surface.
- [ ] Keep duplicated views of the same surface synchronized while allowing independent scroll position.

## 17. Dedicated Workflow Inspector

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

## 18. Recovery And Test Coverage

- [ ] Build a POC restart or resume flow that restores one active handler thread from durable state.
- [ ] Restore pending clarification and waiting state after app restart.
- [ ] Restore active workflow-run state after app restart.
- [ ] Add integration tests that exercise the real pi-backed runtime seam for direct work.
- [ ] Add integration tests that exercise handler-thread delegation and workflow-run supervision through Smithers.
- [ ] Add integration tests that exercise restart and resume behavior across the product model.

## 19. Context Budget Observability

- [ ] Define the context-budget metric as an explicit percentage of the active model's max context.
- [ ] Define neutral, orange, and red thresholds for that metric.
- [ ] Build a POC full-width main-session context bar below the composer.
- [ ] Render the main-session context bar beneath the text input.
- [ ] Build a POC compact bottom-edge context indicator for collapsed delegated-work surfaces.
- [ ] Render bottom-edge context indicators on collapsed handler-thread and workflow surfaces.
- [ ] Render full-width context bars on expanded handler-thread panes.
