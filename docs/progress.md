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
- [x] Adopt PI-backed svvy workflow task agents with a dedicated task prompt and `execute_typescript` as the default task-local tool surface. Commit(s): `a02bd48`
- [x] Keep approval gates and hijack as Smithers runtime or operator controls around workflow task agents rather than exposing them as ordinary task-agent tools. Commit(s): `a02bd48`
- [x] Build a POC bundled workflow task that runs the svvy workflow-task PI configuration with `execute_typescript` only. Commit(s): `a02bd48`
- [x] Wake the supervising handler thread in a background turn only when a workflow run reaches a terminal outcome, an actionable wait, a continuation boundary, or a supervision fault that requires handler judgment, while keeping duplicate terminal reconciliation idempotent after a valid handoff. Commit(s): `a02bd48`
- [x] Support multiple workflow runs under one handler thread. Commit(s): `f53c9b8`, `43a26cb`
- [x] Derive active and latest workflow summaries from workflow-run state without a persisted thread-level latest pointer. Commit(s): `a02bd48`
- [x] Persist durable reconnect cursors plus pending-versus-delivered handler-attention state on workflow runs so restart recovery and wake-up dedupe do not depend on process memory. Commit(s): `2f874a7`
- [x] Emit explicit Smithers bridge lifecycle events for workflow projection, reconnect bootstrap, and handler-attention delivery. Commit(s): `2f874a7`
- [x] Bootstrap workflow supervision from durable run state on session restore, rebuilding runtime ownership from workflow-run records and replaying only undelivered handler attention. Commit(s): `2f874a7`
- [x] Keep `thread.handoff`, Smithers read APIs, selectors, and renderer reads free of lifecycle repair writes. Commit(s): `2f874a7`
- [x] Guarantee that a workflow-run failure or cancellation moves the handler thread into troubleshooting before any later user-directed closure or handoff. Commit(s): `a02bd48`

## 6. Workflow Authoring And Saved Workflow Files

- [x] Define the generated workflow-authoring contract plus curated Smithers authoring guide and example bundle injected into every handler-thread context. Commit(s): `0b2d1ff`
- [x] Build an end-to-end handler-thread flow that checks direct work, saved runnable entries, and reusable assets, then authors and runs a short-lived workflow artifact when needed. Commit(s): `dc1da8c`
- [x] Persist every authored short-lived workflow under `.svvy/artifacts/workflows/<artifact_workflow_id>/` with `definitions/`, `prompts/`, `components/`, `entries/`, and `metadata.json`. Commit(s): `dc1da8c`
- [x] Define the saved workflow library layout under `.svvy/workflows/definitions/`, `.svvy/workflows/prompts/`, `.svvy/workflows/components/`, and `.svvy/workflows/entries/`. Commit(s): `37afcb3`, `4515233`
- [x] Define the discovery metadata contract compiled from JSDoc headers in `ts` or `tsx` files and frontmatter in `mdx` prompt files. Commit(s): `37afcb3`, `4515233`
- [x] Expose `api.workflow.listAssets(...)` inside `execute_typescript` so handlers can discover saved definitions, prompts, and components before reading files directly. Commit(s): `4515233`
- [x] Expose `api.workflow.listModels()` inside `execute_typescript` for the escape hatch where no saved workflow agent fits. Commit(s): `4515233`
- [x] Build a POC saved definition plus saved entry that are reused by a new short-lived artifact entry with different prompts, workflow agents, or config bound at authoring time. Commit(s): `37afcb3`
- [x] Keep authored workflows artifact-only by default until the handler explicitly writes reusable files into `.svvy/workflows/`. Commit(s): `0b2d1ff`
- [x] Run automatic saved-workflow validation after `api.repo.writeFile(...)` and `api.repo.writeJson(...)` writes under `.svvy/workflows/...`, surfacing diagnostics in the enclosing `execute_typescript` result logs. Commit(s): `0b2d1ff`
- [x] Surface all runnable saved and artifact entries through `smithers.list_workflows` and `smithers.run_workflow({ workflowId, input, runId? })`, with `smithers.list_workflows` returning each entry's explicit launch contract, `workflowId`, `label`, `summary`, `sourceScope`, `entryPath`, grouped asset refs, derived `assetPaths`, and `workflowId` filter support rather than relying on inferred import graphs. Commit(s): `4515233`, `dc1da8c`
- [x] Persist workflow agent files as ordinary saved workflow components that handlers discover by path and inspect through file reads. Commit(s): `4515233`

## 7. Project CI Lane

- [x] Build a POC typed context-pack registry with `ci` as the first key. Commit(s): `2a5dbbe`
- [x] Add the handler-only `request_context({ keys })` tool and persist loaded context keys on handler threads. Commit(s): `2a5dbbe`
- [x] Extend `thread.start` so the orchestrator can preload typed handler context with `context: ["ci"]`. Commit(s): `2a5dbbe`
- [x] Make Project CI configuration happen organically through normal handler-thread work, with `context: ["ci"]` preloaded for first-turn CI authoring or requested later through `request_context({ keys: ["ci"] })`, instead of a setup launcher or CI-specific runtime. Commit(s): `2a5dbbe`
- [x] Define the conventional Project CI saved-workflow layout under `.svvy/workflows/{definitions,prompts,components,entries}/ci/`, without implying a shipped or auto-created default CI entry. Commit(s): `2a5dbbe`
- [x] Extend runnable workflow entry discovery with optional `productKind` and `resultSchema` metadata. Commit(s): `2a5dbbe`
- [x] Validate a saved Project CI entry under the conventional `.svvy/workflows/entries/ci/project-ci.tsx` path that declares `productKind = "project-ci"` and returns output that validates against its declared CI result schema. Commit(s): `2a5dbbe`
- [x] Persist `ci_run` and `ci_check_result` records only from terminal Smithers runs launched from declared Project CI entries. Commit(s): `2a5dbbe`
- [x] Record CI check results with stable check ids, kind, status, required flag, command, exit code, summary, timestamps, and linked artifacts. Commit(s): `2a5dbbe`
- [x] Treat invalid or missing CI result output as a CI workflow troubleshooting state instead of parsing logs, node outputs, final prose, or command names. Commit(s): `2a5dbbe`
- [x] Let normal handler threads discover and run configured Project CI entries without loading the `ci` context pack, while using `request_context({ keys: ["ci"] })` before configuring or modifying CI. Commit(s): `2a5dbbe`
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
- [x] Join session summaries, focused pane, and pane-to-surface bindings in one workspace-shell read model without depending on a global active surface. Commit(s): `9a21f87`, `b0ee858`
- [x] Split workspace-summary updates from live surface transcript updates in the renderer runtime. Commit(s): `9a21f87`, `b0ee858`
- [x] Manage open live surfaces in a shared registry keyed by `surfacePiSessionId`. Commit(s): `9a21f87`, `b0ee858`
- [x] Give each live surface its own prompt lock, model state, reasoning state, and cancellation lifecycle. Commit(s): `9a21f87`, `b0ee858`
- [x] Render handler-thread lists from structured thread data in the workspace shell and focused pane. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Show thread objective, status, latest workflow-run summary, and blocked reason in pane-local thread views. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render the latest handoff episode for an inspected thread while preserving earlier handoff points in thread history. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render thread- and workflow-run-linked artifacts before relying on transcript reconstruction. Commit(s): `3855fe4`
- [x] Render the latest Project CI summary block for the focused surface or inspected thread. Commit(s): `3855fe4`
- [x] Restore focused pane, pane-to-surface bindings, and inspector selection after restart. Commit(s): `3855fe4`

## 9. Command Palette And Quick Open

Current product decisions for this section are specified in `docs/specs/command-palette.spec.md`.

- [x] Define the product-owned command/action registry shape, including stable ids, labels, aliases, categories, availability, shortcuts, and typed execution targets. Commit(s): `cb319ac`
- [x] Define `Cmd+Shift+P` as the all-actions command palette for session, surface, Project CI, handler-thread, workflow-inspector, pane, settings, agent settings, and future product actions. Commit(s): `cb319ac`
- [x] Define `Cmd+P` as file quick-open with placeholder or no-op behavior until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist. Commit(s): `cb319ac`
- [x] Adopt `cmdk-sv` as the Svelte command palette UI primitive while keeping product routing and command semantics owned by `svvy`. Commit(s): `cb319ac`
- [x] Build a POC command palette over static product actions. Commit(s): `cb319ac`
- [x] Expose session creation, open/switch, pin, unpin, archive, and unarchive actions through the palette. Commit(s): `cb319ac`
- [x] Show unified `Open Session` results for orchestrator, handler-thread, and workflow task-agent projection categories with visible kind badges. Commit(s): `12d89d8`
- [x] Route unmatched non-empty `Cmd+Shift+P` text into a new session initial prompt through the normal orchestrator turn model. Commit(s): `cb319ac`
- [x] Add keyboard shortcut handling for `Cmd+Shift+P`, `Cmd+P`, Enter, and command-palette `Cmd+Enter` placement once pane layout exists. Commit(s): `cb319ac`
- [x] Add tests for shortcut dispatch, command matching, action routing, disabled or hidden availability, and unmatched prompt-session creation. Commit(s): `cb319ac`

## 10. Pane Layout, Surface Ownership, And Expanded Surfaces

Current product decisions for this section are specified in `docs/specs/pane-layout.spec.md`.

- [x] Define the stored shape for a user-driven pane grid, including ordered row and column tracks, track percentages, minimum pane constraints, deterministic pane coordinates, and pane surface bindings. Commit(s): `77681bb`
- [x] Persist pane-to-surface bindings separately from live surface runtime state. Commit(s): `77681bb`
- [x] Build a POC workspace pane-grid layout that opens one surface in a targeted pane. Commit(s): `77681bb`
- [x] Support persisted user-driven split, resize, close, and drag placement into a chosen pane. Commit(s): `902f79c`
- [x] Manage explicit open and close semantics for live surfaces independently from pane focus. Commit(s): `9a21f87`, `b0ee858`
- [x] Allow the same interactive surface to be opened in more than one pane at once. Commit(s): `9a21f87`, `b0ee858`
- [x] Keep one underlying live surface controller per `surfacePiSessionId` regardless of pane count. Commit(s): `9a21f87`, `b0ee858`
- [x] Persist pane-grid occupancy, track percentages, pane-local state, and pane geometry across app restart. Commit(s): `77681bb`
- [x] Restore the focused pane on app restart. Commit(s): `77681bb`
- [x] Show exact pane-location indicators in the sidebar for open surfaces. Commit(s): `902f79c`
- [x] Show a clear highlight for the currently focused pane surface. Commit(s): `77681bb`
- [x] Define the stored shape for compact thread and workflow-run surfaces inside the workspace shell. Commit(s): `902f79c`
- [x] Render compact thread cards in the workspace shell timeline. Commit(s): `902f79c`
- [x] Render compact workflow-run cards in the workspace shell timeline. Commit(s): `902f79c`
- [x] Open a selected handler-thread surface in a chosen pane as a fully interactive surface. Commit(s): `77681bb`
- [x] Keep duplicated views of the same surface synchronized while allowing independent scroll position. Commit(s): `902f79c`

## 11. Session Agents And Workflow Agents

- [x] Define the stored shape for session agent settings used by orchestrator/handler surfaces and quick sessions. Commit(s): `8e19462`
- [x] Keep session agent settings separate from typed handler context packs so Project CI uses normal handler-thread execution plus `context: ["ci"]`. Commit(s): `2a5dbbe`
- [x] Seed initial app-wide default values for the default session agent and quick session agent. Commit(s): `8e19462`
- [x] Build a POC settings model for editing app-wide session agent defaults. Commit(s): `8e19462`
- [x] Persist app-wide session agent defaults. Commit(s): `8e19462`
- [x] Build a POC session creation flow with separate orchestrator-session and quick-session actions. Commit(s): `8e19462`
- [x] Persist session mode and the default orchestrator-surface prompt selection. Commit(s): `8e19462`
- [x] Persist per-session overrides for the default session agent and quick session agent. Commit(s): `8e19462`
- [x] Persist per-thread overrides for handler-thread session agent settings when a delegated thread needs a specific model or reasoning level. Commit(s): `8e19462`
- [x] Apply the quick-session agent settings and quick-session system prompt at session creation. Commit(s): `8e19462`
- [x] Show the current focused-surface session agent summary in pane chrome. Commit(s): `8e19462`
- [x] Expand the session agent panel to inspect the session agent settings for the focused surface's session and thread. Commit(s): `8e19462`
- [x] Seed `.svvy/workflows/components/agents.ts` with conventional `explorer`, `implementer`, and `reviewer` workflow agent exports. Commit(s): `8e19462`
- [x] Build settings support for editing conventional workflow agents by synchronizing model, reasoning, and prompt fields with `.svvy/workflows/components/agents.ts`. Commit(s): `8e19462`
- [x] Teach handler prompts to inspect and reuse `.svvy/workflows/components/agents.ts` exports when they fit, author artifact-local workflow agents for one-off needs, and write saved workflow agent components only on explicit request. Commit(s): `92c5397`

## 12. Session Titles

- [x] Define the stored title states for top-level sessions and handler threads. Commit(s): `b510857`, `fe53a3b`
- [x] Add `namer` as a pi-backed session-agent default, alongside `defaultSession` and `quickSession`, for one-shot top-level session naming rather than as a Smithers workflow agent. Commit(s): `354db28`
- [x] Seed the `namer` session agent to `openai-codex`/`gpt-5.4-mini` with low reasoning effort, expose it in session-agent settings for customization, and treat its settings prompt as the only naming instruction. Commit(s): `354db28`
- [x] Build a POC event-driven title-generation flow that starts a durable one-shot naming job concurrently with the first real top-level user turn without waiting for the orchestrator response. Commit(s): `354db28`
- [x] Persist generated top-level session titles, title-generation lifecycle state, and the first-turn trigger so app restart cannot duplicate or lose title generation. Commit(s): `354db28`
- [x] Block manual session rename while a title-generation job is pending or running, then release the lock after success, failure, or cancellation. Commit(s): `354db28`
- [x] Freeze auto-titling after manual rename or after the first successful generated title. Commit(s): `354db28`
- [x] Generate handler-thread titles with the same `namer` session agent used for top-level sessions, using the orchestrator-supplied `thread.start` objective as the naming input, while keeping workflow-run labels derived from the workflow's own name or entry metadata instead of adding a separate workflow-run title. Commit(s): `4d74c78`

## 13. Composer Mention Links

- [x] Define the stored shape for composer file and folder mention links.
- [x] Build a POC `@` autocomplete picker over indexed workspace files and folders.
- [x] Render selected file and folder mentions as removable composer chips.
- [x] Serialize mentions into the outgoing user message as normal workspace path links.
- [x] Render sent mentions in the transcript as actionable workspace links that reveal files, open folders, and visibly mark missing paths.
- [x] Keep mentions agent-neutral: no prompt injection, no eager file reads, no folder expansion, and no special context-target resolution.

## 14. Layered Workflow Knowledge

- [x] Inventory the workflow-related prompt, skill, and knowledge assets the product needs. Commit(s): `0b2d1ff`, `4515233`, `a02bd48`
- [x] Build a POC repo layout for workflow knowledge with separate orchestrator-facing and handler-facing assets. Commit(s): `0b2d1ff`, `4515233`
- [x] Define the first minimal orchestrator-facing workflow summary shape. Commit(s): `a02bd48`
- [x] Define the first richer handler-facing workflow prompt or example shape. Commit(s): `0b2d1ff`
- [x] Load only minimal workflow summaries into orchestrator routing context. Commit(s): `a02bd48`
- [x] Build a POC delegated workflow that receives extended workflow knowledge without expanding orchestrator context. Commit(s): `0b2d1ff`, `4515233`
- [x] Define typed handler context packs as the optional-knowledge layer between minimal handler prompts and specialized product authoring guidance. Commit(s): `2a5dbbe`
- [x] Render loaded handler context keys in thread metadata so users can see when optional context such as `ci` is active. Commit(s): `2a5dbbe`

## 15. Dedicated Workflow Inspector

Current product decisions for this section are specified in `docs/specs/workflow-inspector.spec.md`.

- [x] Define the tree-first workflow-inspector surface model, including run header state, selected node, expanded nodes, live-versus-historical mode, and pane binding. Commit(s): `ba56647`
- [x] Build a POC static inspector over one completed workflow run using a React-DevTools-like tree instead of a graph layout. Commit(s): `ba56647`
- [x] Render workflow root, sequence, parallel, loop, conditional, approval, task-agent, script, Project CI check, wait, retry, and terminal-result rows, with Project CI rows shown only for runs backed by declared Project CI entries. Commit(s): `ba56647`
- [x] Show launch arguments and node props in the selected-node inspector for workflow containers, executable tasks, approvals, and Project CI checks. Commit(s): `ba56647`
- [x] Render pending, running, waiting, retrying, completed, failed, cancelled, and skipped states clearly on rows, including collapsed-parent indicators for failed or waiting descendants. Commit(s): `ba56647`
- [x] Add search, keyboard navigation, row selection, expand/collapse, auto-expansion of active or failed paths, and preservation of user-collapsed paths during live updates. Commit(s): `ba56647`
- [x] Show selected-node details for status, objective or label, latest output, partial output, related artifacts, workflow agent, task attempt, command linkage, worktree, timing, and wait reason. Commit(s): `625cab4`
- [x] Add inspector tabs for output, diff, logs, transcript, command, events, and raw JSON when those data sources exist for the selected node. Commit(s): `ba56647`
- [x] Stream live Smithers snapshot and delta updates into the tree while a workflow is running, including latest activity previews for active leaf rows. Commit(s): `625cab4`
- [x] Add historical frame inspection with a scrubber and return-to-live behavior without making rewind or replay a default control. Commit(s): `ba56647`
- [x] Open a selected task-agent session, command record, artifact, Project CI check, or owning handler thread from the workflow inspector into another chosen pane. Commit(s): `625cab4`
- [x] Keep completed workflow inspectors available as durable historical pane surfaces after completion and app restart. Commit(s): `ba56647`

## 16. Recovery And Test Coverage

- [ ] Build a POC restart or resume flow that restores multiple open surfaces and pane bindings from durable state.
- [ ] Restore pending clarification and waiting state after app restart.
- [ ] Restore active workflow-run state after app restart.
- [ ] Restore pending handler attention queues and per-surface prompt-lock state after app restart.
- [x] Add integration tests that exercise the real pi-backed runtime seam for direct work. Commit(s): `b0ee858`
- [x] Expand from the current real embedded-runtime supervision coverage in `src/bun/smithers-runtime/manager.test.ts` and `src/bun/smithers-tools.test.ts` to full pi-backed handler-thread delegation and workflow-run supervision. Commit(s): `f8557d9`, `b0ee858`, `55963d9`, `097ae47`
- [ ] Add integration tests that exercise restart and resume behavior across workspace state, live surface state, and pane bindings.

## 17. Context Budget Observability

- [ ] Define the context-budget metric as an explicit percentage of the active model's max context.
- [ ] Define neutral, orange, and red thresholds for that metric.
- [ ] Build a POC full-width focused-surface context bar below the composer.
- [ ] Render the focused-surface context bar beneath the text input.
- [ ] Build a POC compact bottom-edge context indicator for collapsed delegated-work surfaces.
- [ ] Render bottom-edge context indicators on collapsed handler-thread and workflow surfaces.
- [ ] Render full-width context bars on expanded handler-thread panes.

## 18. Saved Workflow Library Surface

This UI depends on later file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces. Keep it out of the core workspace navigation section until those primitives are ready.

- [x] Render a save shortcut in relevant thread or workflow surfaces that sends a predefined save request prompt to the handler. Commit(s): `0b2d1ff`
- [ ] Define the saved workflow library surface after the file tree, editor, syntax highlighting, typecheck, and diagnostics surfaces are designed.
- [ ] Define the workspace read model for saved workflow assets and artifact workflows.
- [ ] Render a saved workflow library surface with separate definitions, prompts, components, entries, and artifact workflow groupings.
- [ ] Show saved asset title, summary, kind, path, source, typecheck status, and diagnostics in the saved workflow library surface.
- [ ] Allow deleting a saved workflow definition, prompt, component, or entry from the library without deleting historical artifact workflows that previously used it.
