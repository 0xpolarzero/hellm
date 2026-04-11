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
- [ ] Build a POC for workflow-run and approval-state persistence before wiring full delegated execution.
- [ ] Persist workflow run references linked to their source thread.
- [ ] Persist approval and waiting state as durable product state.
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

## 3. Direct Path And Reconciliation

- [ ] Persist a per-request routing or classification result for the orchestrator.
- [ ] Build a POC direct-path request flow from classification to episode normalization.
- [ ] Implement minimal direct-path routing for explanation and small read-only actions.
- [ ] Normalize direct read-only work into a completed episode.
- [ ] Normalize direct repo-modifying work into an episode with changed-file references.
- [ ] Store unresolved issues and follow-up suggestions on direct episodes.
- [ ] Re-enter the orchestrator from the latest durable episode and state instead of raw transcript scanning.

## 4. Verification As First-Class State

- [ ] Build a POC verification event model covering build, test, lint, and manual checks.
- [ ] Add explicit verification-run creation from orchestrator decisions.
- [ ] Capture build verification results with status, summary, and artifacts.
- [ ] Capture test verification results with status, summary, and artifacts.
- [ ] Capture lint verification results with status, summary, and artifacts.
- [ ] Capture manual verification checkpoints.
- [ ] Surface failed or incomplete verification as routing input for the next orchestrator step.
- [ ] Show latest verification outcome inline in the session timeline and inspector.

## 5. Delegated Workflow Foundations

- [ ] Build a POC workflow request/response envelope between the orchestrator and Smithers.
- [ ] Define the workflow request envelope from the orchestrator to Smithers.
- [ ] Create a durable workflow-run record before delegated execution starts.
- [ ] Build a POC single-task delegated workflow that round-trips into one thread and one episode.
- [ ] Support one bounded delegated task end to end.
- [ ] Translate workflow completion back into episode and artifact records.
- [ ] Project active workflow status into thread and session UI.
- [ ] Persist workflow pause and waiting state.
- [ ] Resume a paused workflow from durable state.
- [ ] Build a POC approval-gated delegated workflow before supporting approval resume generally.
- [ ] Persist approval requests tied to workflow runs.
- [ ] Resume approval-gated workflows after explicit user approval.
- [ ] Build a POC retry/loop provenance model before exposing richer workflow branching.
- [ ] Capture retry and loop branches in workflow provenance.

## 6. Worktree-Aware Execution

- [ ] Build a POC thread-to-worktree binding model and inspect how it should appear in the UI.
- [ ] Persist worktree binding on threads.
- [ ] Persist worktree binding on workflow runs.
- [ ] Show active worktree on thread and session surfaces.
- [ ] Warn when selected session context and current filesystem context diverge.
- [ ] Build a POC isolated delegated workflow run in a separate worktree.
- [ ] Let delegated workflows declare or acquire an isolated worktree when needed.
- [ ] Show which thread or workflow owns each worktree-backed run.

## 7. `execute_typescript`

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

## 8. Repo-Local Workflow Hooks

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

## 9. Headless Surface

- [ ] Build a POC one-shot headless entrypoint that reuses desktop orchestration code.
- [ ] Define the headless one-shot input contract.
- [ ] Return structured output for a direct-path headless run.
- [ ] Return structured output for a verification-led headless run.
- [ ] Build a POC delegated headless workflow launch and result projection.
- [ ] Start a delegated workflow from headless input.
- [ ] Emit workflow, episode, and artifact references in headless results.
- [ ] Reuse the same orchestrator and state model as desktop execution.

## 10. Recovery And Test Coverage

- [ ] Build a POC restart/resume flow that restores one active thread from durable state.
- [ ] Restore active direct-path state after app restart.
- [ ] Restore active workflow state after app restart.
- [ ] Restore pending approval and waiting state after app restart.
- [ ] Restore verification history and latest outcome after app restart.
- [ ] Add integration tests that exercise the real pi-backed runtime seam for direct work.
- [ ] Add integration tests that exercise delegated workflow execution through Smithers.
- [ ] Add integration tests that exercise restart and resume behavior across the product model.
