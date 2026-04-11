# Progress

Incremental roadmap from the current baseline to the shipped PRD.

How to use this file:

- Keep items small enough to land in a focused PR.
- Prefer adding new items next to the closest related step instead of appending unrelated backlog at the bottom.
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

- [ ] Build a POC session overlay document and validate how it can sit above pi session data.
- [ ] Persist a minimal structured session overlay root above pi session data.
- [ ] Persist `ThreadRecord` entries with id, objective, status, executor, and timestamps.
- [ ] Persist thread lifecycle transitions for direct, delegated, verification, and waiting states.
- [ ] Build a POC `EpisodeRecord` and `VerificationRecord` shape against a few realistic session examples.
- [ ] Persist `EpisodeRecord` skeletons for direct-path completions.
- [ ] Persist artifact references independently from transcript parsing.
- [ ] Persist `VerificationRecord` entries with status, summary, and linked artifacts.
- [ ] Build a POC for workflow-run and waiting-state persistence before wiring full delegated execution.
- [ ] Persist workflow run references linked to their source thread.
- [ ] Persist blocked and waiting state as durable product state.
- [ ] Reconstruct workspace and session summaries from structured state on app load.

## 2. Session Navigation And Core Projection

- [ ] Drive the session sidebar entirely from durable session summaries.
- [ ] Build a POC threads-and-episodes projection from structured state in the main session view.
- [ ] Render the selected thread list from structured `ThreadRecord` data.
- [ ] Show thread objective, status, executor, and blocked reason in the main session view.
- [ ] Render a minimal episode list for the selected thread.
- [ ] Render artifact links from structured episode data before relying on transcript reconstruction.
- [ ] Render a verification summary block for the selected thread or session.
- [ ] Build a POC inspector state model that can switch cleanly between thread, episode, artifact, and verification targets.
- [ ] Let the inspector switch between thread, episode, artifact, and verification detail views.
- [ ] Show current workspace, session, and worktree context in the status strip.
- [ ] Restore selected session, selected thread, and inspector selection after restart.

## 3. Session Modes And Runtime Profiles

- [ ] Define the runtime profile ids and stored shape for orchestrator, quick, explorer, implementer, reviewer, and workflow-writer.
- [ ] Seed initial app-wide default values for those runtime profiles.
- [ ] Build a POC settings model for editing app-wide runtime profile defaults.
- [ ] Persist app-wide runtime profile defaults.
- [ ] Build a POC session creation flow with separate orchestrator-session and quick-session actions.
- [ ] Persist session mode and the main-session prompt selection.
- [ ] Persist per-session overrides for each runtime profile.
- [ ] Apply the quick-session main profile and quick-session system prompt at session creation.
- [ ] Show the current main runtime profile summary in the session chrome.
- [ ] Expand the session runtime panel to inspect all agent runtime profiles for that session.
- [ ] Route delegated subagents and Smithers workflow agents through explorer, implementer, reviewer, and workflow-writer runtime profiles.
- [ ] Prove that quick sessions only change the main-session profile by default, unless other per-session overrides are set.

## 4. Session Titles

- [ ] Define the stored title states for top-level sessions, delegated subagents, and workflows.
- [ ] Add the hidden `namer` system agent for one-shot top-level session naming.
- [ ] Seed the `namer` agent to `gpt-5.4-mini` with low reasoning effort.
- [ ] Build a POC one-shot title generation after the first real user turn for a top-level session.
- [ ] Persist generated top-level session titles and stop silent auto-retitling after the first real user turn has passed.
- [ ] Freeze auto-titling after manual rename.
- [ ] Generate deterministic task-based titles for delegated subagents and workflows without using the `namer`.

## 5. Composer Mention Targets

- [ ] Define the stored shape for symbolic file and folder mention targets in the composer.
- [ ] Build a POC `@` autocomplete picker over workspace files and folders.
- [ ] Render selected file and folder mentions as removable composer chips.
- [ ] Persist the visible mention text and resolved target paths on send.
- [ ] Resolve file and folder mentions into symbolic context targets for the orchestrator.
- [ ] Keep folder mentions symbolic by default instead of eagerly pasting or expanding contents in the composer.

## 6. Expanded Work Surfaces

- [ ] Define the stored shape for compact subagent and workflow surfaces inside the main session.
- [ ] Build a POC inline subagent card with headline, status, and lightweight live state.
- [ ] Render compact subagent cards in the main session timeline.
- [ ] Build a POC inline workflow card with minimal workflow progress.
- [ ] Render compact workflow cards in the main session timeline.
- [ ] Open a selected subagent surface in the right pane.
- [ ] Open a selected workflow surface in the right pane.
- [ ] Build a POC split-pane container that can host one expanded delegated-work surface.
- [ ] Drag a subagent or workflow surface into a split pane.
- [ ] Make expanded subagent panes fully interactive.
- [ ] Make expanded workflow panes fully interactive as workflow-level surfaces.
- [ ] Support drill-down from an expanded workflow into internal workflow boxes or agents.

## 7. Context Budget Observability

- [ ] Define the context-budget metric as an explicit percentage of the active model's max context.
- [ ] Define neutral, orange, and red thresholds for that metric.
- [ ] Build a POC full-width main-session context bar below the composer.
- [ ] Render the main-session context bar beneath the text input.
- [ ] Build a POC compact bottom-edge context indicator for collapsed delegated-work surfaces.
- [ ] Render bottom-edge context indicators on collapsed subagent and workflow surfaces.
- [ ] Render full-width context bars on expanded subagent panes.
- [ ] Render full-width context bars on expanded workflow panes.
- [ ] Surface workflow-internal agent context usage when drilling down inside an expanded workflow.

## 8. Direct Path And Reconciliation

- [ ] Persist a per-request routing or classification result for the orchestrator.
- [ ] Build a POC direct-path request flow from classification to episode normalization.
- [ ] Implement minimal direct-path routing for explanation and small read-only actions.
- [ ] Normalize direct read-only work into a completed episode.
- [ ] Normalize direct repo-modifying work into an episode with changed-file references.
- [ ] Store unresolved issues and follow-up suggestions on direct episodes.
- [ ] Re-enter the orchestrator from the latest durable episode and state instead of raw transcript scanning.

## 9. Verification As First-Class State

- [ ] Build a POC verification event model covering build, test, lint, and manual checks.
- [ ] Add explicit verification-run creation from orchestrator decisions.
- [ ] Capture build verification results with status, summary, and artifacts.
- [ ] Capture test verification results with status, summary, and artifacts.
- [ ] Capture lint verification results with status, summary, and artifacts.
- [ ] Capture manual verification checkpoints.
- [ ] Surface failed or incomplete verification as routing input for the next orchestrator step.
- [ ] Show latest verification outcome inline in the session timeline and inspector.

## 10. Layered Workflow Knowledge

- [ ] Inventory the workflow-related prompt, skill, and knowledge assets the product needs.
- [ ] Build a POC repo layout for workflow knowledge with separate orchestrator-facing and worker-facing assets.
- [ ] Define the first minimal orchestrator-facing workflow summary shape.
- [ ] Define the first richer worker-facing workflow prompt or example shape.
- [ ] Load only minimal workflow summaries into orchestrator routing context.
- [ ] Build a POC delegated workflow that receives extended workflow knowledge without expanding orchestrator context.
- [ ] Prove that workflow results still fold back into threads, episodes, and artifacts in the main session view.

## 11. Delegated Workflow Foundations

- [ ] Build a POC workflow request/response envelope between the orchestrator and Smithers.
- [ ] Define the workflow request envelope from the orchestrator to Smithers.
- [ ] Create a durable workflow-run record before delegated execution starts.
- [ ] Build a POC single-task delegated workflow that round-trips into one thread and one episode.
- [ ] Support one bounded delegated task end to end.
- [ ] Translate workflow completion back into episode and artifact records.
- [ ] Project active workflow status into thread and session UI.
- [ ] Persist workflow pause and waiting state.
- [ ] Resume a paused workflow from durable state.
- [ ] Build a POC clarification-paused delegated workflow before supporting general workflow resume.
- [ ] Persist clarification-needed markers tied to workflow runs.
- [ ] Resume clarification-paused workflows after the missing input arrives.
- [ ] Build a POC retry/loop provenance model before exposing richer workflow branching.
- [ ] Capture retry and loop branches in workflow provenance.

## 12. Worktree-Aware Execution

- [ ] Build a POC thread-to-worktree binding model and inspect how it should appear in the UI.
- [ ] Persist worktree binding on threads.
- [ ] Persist worktree binding on workflow runs.
- [ ] Show active worktree on thread and session surfaces.
- [ ] Warn when selected session context and current filesystem context diverge.
- [ ] Build a POC isolated delegated workflow run in a separate worktree.
- [ ] Let delegated workflows declare or acquire an isolated worktree when needed.
- [ ] Show which thread or workflow owns each worktree-backed run.

## 13. `execute_typescript`

- [ ] Build a POC `execute_typescript` runtime with the adopted TypeScript input/output contract.
- [ ] Expose a minimal `execute_typescript` tool with the adopted input and output contract.
- [ ] Generate the first curated `external_*` host bindings.
- [ ] Run a simple direct-path scripted task through `execute_typescript`.
- [ ] Build a POC artifact/tracing pipeline for code-mode execution.
- [ ] Capture code-mode logs and traces as artifacts.
- [ ] Normalize code-mode success and failure into episode data.
- [ ] Build a POC delegated Smithers task that calls `execute_typescript`.
- [ ] Allow delegated Smithers tasks to call `execute_typescript`.
- [ ] Limit day-one capabilities to the curated non-shell surface defined by the spec.

## 14. Repo-Local Workflow Hooks

- [ ] Discover `.hellm/` config for the current workspace.
- [ ] Build a POC preflight hook flow for one consequential delegated workflow.
- [ ] Define a first preflight hook declaration format.
- [ ] Run preflight hooks before consequential delegated workflows.
- [ ] Make preflight outputs available to downstream workflow steps.
- [ ] Build a POC validation hook flow that can fail a candidate workflow result.
- [ ] Define a first validation hook declaration format.
- [ ] Run validation hooks after candidate workflow completion.
- [ ] Convert validation failure into structured workflow outcome and state.
- [ ] Persist hook artifacts and outputs for later inspection.

## 15. Headless Surface

- [ ] Build a POC one-shot headless entrypoint that reuses desktop orchestration code.
- [ ] Define the headless one-shot input contract.
- [ ] Return structured output for a direct-path headless run.
- [ ] Return structured output for a verification-led headless run.
- [ ] Build a POC delegated headless workflow launch and result projection.
- [ ] Start a delegated workflow from headless input.
- [ ] Emit workflow, episode, and artifact references in headless results.
- [ ] Reuse the same orchestrator and state model as desktop execution.

## 16. Recovery And Test Coverage

- [ ] Build a POC restart/resume flow that restores one active thread from durable state.
- [ ] Restore active direct-path state after app restart.
- [ ] Restore active workflow state after app restart.
- [ ] Restore pending clarification and waiting state after app restart.
- [ ] Restore verification history and latest outcome after app restart.
- [ ] Add integration tests that exercise the real pi-backed runtime seam for direct work.
- [ ] Add integration tests that exercise delegated workflow execution through Smithers.
- [ ] Add integration tests that exercise restart and resume behavior across the product model.
