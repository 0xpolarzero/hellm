# UI Progress

Incremental progress tracker for porting the UI from `frontend-replit/artifacts/svvy` into svvy's Svelte renderer.

Always read [ui.prd.md](ui.prd.md) before implementing any item in this roadmap, then use the relevant documentation it names. For Replit artifact parity, the primary local references are [ui.artifact-inventory.md](ui.artifact-inventory.md) and [ui.reference-screenshots/](ui.reference-screenshots/).

## Progress Maintenance

- Keep items small enough to land in a focused PR.
- Treat this file as a UI roadmap and progress tracker, not a changelog.
- Prefer adding new items next to the closest related step instead of appending unrelated backlog at the bottom.
- Keep sections ordered by dependency: source UI inventory and shell chrome before projection surfaces that depend on them.
- When an item is done, change `[ ]` to `[x]` and append the landing commit hash or hashes.
- Write the capability that should exist or now exists, not migration wording like "replace", "remove", or "rename" unless that action is itself the remaining work.
- If the source UI porting target changes, rewrite affected items to the new steady-state plan instead of leaving stale unchecked items from the old plan.
- If an item starts reading like a subsystem instead of a step, split it before implementation.
- For any big lift or unclear porting seam, add a POC step immediately before the production implementation step.
- Use POC steps to validate shape, constraints, and UX without prematurely locking the final architecture.

## Current Baseline

- [x] Ship a functional Svelte renderer around the Electrobun desktop shell and Bun-side pi runtime.
- [x] Render multi-session workspace navigation, pane bindings, transcript surfaces, composer, artifacts, workflow inspector, command palette, provider settings, and session-agent settings from svvy-owned runtime and read-model state.
- [x] Keep product runtime behavior inside pi-backed surfaces, handler threads, Smithers-backed workflow supervision, and durable workspace state rather than a standalone terminal loop or alternate UI runtime.
- [x] Capture the desktop UI reference screenshots under `docs/ui/ui.reference-screenshots/`. `c8f047f`
- [x] Capture the Replit artifact source states that the Svelte UI must match under `docs/ui/ui.reference-screenshots/`. `c8f047f`

## 1. Migration Contract

- [x] Inventory Replit artifact screens, components, interactions, and mock-only assumptions in [docs/ui/ui.artifact-inventory.md](ui.artifact-inventory.md). `7b45ec0`
- [x] Map each Replit artifact screen to the svvy product surface or fixture-only source state it represents. `aca42bd`
- [x] Classify Replit artifact routes and mock states as production svvy surfaces or fixture states for visual parity. `aca42bd`
- [x] Document the production Svelte ownership boundary: `src/mainview` owns presentation, existing runtime controllers own behavior, and shared workspace contracts own data shape. `aca42bd`
- [x] Maintain a no-runtime-regression checklist for every UI slice, including prompt targeting, pane bindings, live surface reuse, handler-thread messaging, artifact opening, and settings persistence. `aca42bd`

## 2. Source UI Foundation

- [x] Document the Replit artifact visual system in `DESIGN.md`, including density, typography, color tokens, spacing, borders, elevation, focus rings, motion, and dark/light theme behavior.
- [x] Reconcile Replit artifact context-budget colors with the product policy: neutral below 40%, orange from 40%, and red from 60%.
- [x] Port Replit artifact theme tokens into `src/mainview/app.css` as Svelte-compatible CSS variables.
- [x] Extract Replit artifact status color semantics for sessions, surfaces, handler threads, workflow runs, commands, waits, Project CI, provider auth, and context budget pressure.
- [x] Extract Replit artifact typography rules for transcript text, monospace metadata, dense rows, pane headers, cards, command entries, and settings forms.
- [x] Extract Replit artifact motion rules for pane focus, resize affordances, hover states, blinking or pulsing status points, streaming indicators, command palette entry, and reduced-motion behavior.
- [x] Add a UI fixture or preview harness for rendering migrated Svelte components against stable mock read models without touching production runtime behavior.

## 3. Svelte UI Primitives

- [x] Consolidate button, icon button, badge, input, textarea, dialog, and surface primitives around the ported Replit artifact token system. `a868fe6`
- [x] Add dense row, section header, pane header, toolbar, divider, keyboard hint, empty state, error state, and loading state primitives. `a868fe6`
- [x] Add reusable status badge primitives for session, thread, workflow-run, command, Project CI, provider auth, and wait states. `a868fe6`
- [x] Add reusable metadata chip primitives for model, reasoning, worktree, context pack, pane location, artifact type, and command kind. `a868fe6`
- [x] Add resize-handle, pane-focus, hover, active, disabled, and keyboard-focus styling primitives. `a868fe6`
- [x] Verify primitive contrast, focus visibility, hit targets, and text overflow across desktop and narrow viewport sizes. `a868fe6`

## 4. Shell Chrome

- [x] Build a POC Svelte shell chrome that matches the Replit artifact shell over static fixture data. `4eef4c5`
- [x] Render the production app frame with the ported Replit sidebar, top bar, pane chrome, inspector chrome, and composer dock while preserving current runtime behavior. `4eef4c5`
- [x] Render session title, status, worktree, active surface target, model summary, context budget, and pane layout controls in dense pane chrome. `4eef4c5`
- [x] Render sidebar session groups, pinned sessions, active sessions, archived sessions, and pane-location indicators using the ported Replit row language. `4eef4c5`
- [x] Preserve current session actions for create, switch, rename, fork, delete, pin, unpin, archive, and unarchive. `4eef4c5`
- [x] Preserve pane actions for split, resize, close, drag placement, focus, and opening the same surface in multiple panes. `4eef4c5`
- [x] Verify restored pane layout, sidebar state, focused pane, and inspector selection after app restart. `4eef4c5`

## 5. Composer And Prompt Entry

- [ ] Build a POC Svelte composer that matches the Replit bottom composer over static fixture state.
- [ ] Render production prompt entry with the ported Replit compact composer styling while preserving prompt history, submit locking, cancellation, target selection, and provider-missing behavior.
- [ ] Render file and folder mention chips with the ported Replit visual treatment while preserving serialization as ordinary `@path` user text.
- [ ] Render mention autocomplete with dense keyboard navigation, missing-path state, and no eager file reads.
- [ ] Render target surface, worktree, model, reasoning, context budget, and submit state in composer chrome without crowding prompt text.
- [ ] Verify long prompt text, long paths, narrow viewport layout, keyboard shortcuts, and reduced-motion behavior.

## 6. Transcript And Turn Projection

- [x] Build a POC transcript projection that matches Replit message, thread, episode, verification, wait, and failure card treatments over static fixture data.
- [x] Render user, orchestrator, handler-thread, system-prompt metadata, assistant streaming, tool-call, and error transcript items with the ported Replit visual treatment.
- [x] Render turn decisions and command rollups as compact semantic blocks without promoting nested child commands to top-level cards.
- [x] Render `execute_typescript` submitted snippets, diagnostics, logs, child command summaries, and artifacts with clear parent-first hierarchy.
- [x] Render durable handoff episodes as reusable semantic outputs while preserving earlier handoff points.
- [x] Preserve transcript virtualization, pane-local scroll, copy transcript, streaming cursor, pending tool calls, and failure states.
- [x] Verify long transcripts, large code blocks, interrupted streams, failed turns, and duplicated pane views of the same surface.

## 7. Handler Threads And Delegation Projection

- [ ] Render handler-thread summaries with objective, title, lifecycle state, wait state, loaded context keys, latest handoff, latest workflow-run summary, and related artifacts.
- [ ] Render handler-active, workflow-active, waiting, troubleshooting, and completed states with distinct but restrained visual semantics.
- [ ] Render direct handler-thread surfaces with the same transcript and composer quality as orchestrator surfaces.
- [ ] Normalize Replit artifact "subagent" visual vocabulary into handler-thread and workflow task-agent labels before porting delegation surfaces.
- [ ] Render thread metadata so users can inspect active system prompt, model, reasoning, worktree, context packs, and workflow ownership.
- [ ] Preserve direct user messaging into handler threads before and after handoff.
- [ ] Verify workflow attention routes back to the owning handler surface rather than the currently focused pane.

## 8. Workflow, Artifact, And Command Inspectors

The workflow inspector remains tree-first. Replit artifact graph-oriented workflow pieces are not ported; the Svelte UI should build a consistent tree-based visual layout that fits the Replit workbench treatment.

- [ ] Document how Replit graph-only workflow visuals adapt to the tree-first Svelte workflow inspector before styling tree rows and detail panes.
- [ ] Restyle workflow inspector tree, selected-node details, tabs, frame scrubber, search, keyboard navigation, and row states around the tree-first inspector model.
- [ ] Restyle artifact panel and artifact browser to match the Replit artifact treatment for source, scope, type, preview, logs, open-in-editor, and related-command affordances.
- [ ] Restyle command inspector to match the Replit artifact treatment for parent command facts, nested child command facts, logs, artifacts, errors, and raw detail without losing hierarchy.
- [ ] Restyle saved workflow library to match the Replit artifact treatment for asset groups, runnable entries, diagnostics, source previews, deletion controls, and open-in-editor handoff.
- [ ] Preserve inspector pane bindings, historical workflow inspector availability, selected-node state, artifact linkage, and restart restoration.
- [ ] Verify large workflow trees, failed descendants, waiting descendants, missing artifacts, large logs, and long source paths.

## 9. Command Palette And Quick Open

- [ ] Restyle the command palette to match the Replit artifact compact action-list treatment while preserving `cmdk-sv` and svvy-owned command semantics.
- [ ] Treat Replit artifact command-palette source as primitive-only; preserve production `cmdk-sv` command semantics and derive compact action-list styling from Svelte fixtures or production screenshots.
- [ ] Render action categories, kind badges, shortcuts, disabled states, placement hints, and unmatched prompt-session fallback clearly.
- [ ] Render `Cmd+P` quick-open placeholder or no-op state without implying a file editor surface exists before it does.
- [ ] Preserve command routing for sessions, surfaces, handler threads, workflow inspectors, Project CI, panes, settings, and agent settings.
- [ ] Verify keyboard dispatch, command matching, disabled or hidden actions, pane placement, and unmatched prompt creation.

## 10. Settings And Auth Surfaces

- [ ] Restyle provider auth settings to match the Replit artifact treatment for provider state, OAuth/key entry affordances, validation, missing-provider recovery, and destructive-action confirmation.
- [ ] Restyle session-agent settings to match the Replit artifact treatment for default session, quick session, namer, and per-surface inspection.
- [ ] Restyle workflow-agent settings to match the Replit artifact treatment for conventional saved workflow agents while preserving `.svvy/workflows/components/agents.ts` synchronization.
- [ ] Restyle app preferences such as external editor selection to match the Replit artifact settings form treatment.
- [ ] Preserve provider auth synchronization, model discovery, reasoning dropdown behavior, settings persistence, and recovery from startup provider gaps.
- [ ] Verify disconnected providers, invalid keys, OAuth cancellation, missing models, long prompt text, and narrow viewport settings layout.

## 11. Responsive And Accessibility Pass

- [ ] Extract supported viewport classes from the Replit artifact app, including full desktop, constrained desktop, and narrow shell behavior.
- [ ] Recompose the shell for narrow viewports without merely shrinking dense desktop panes.
- [ ] Verify no text overlaps or escapes buttons, badges, pane headers, cards, command rows, composer chrome, or settings controls.
- [ ] Verify keyboard navigation across sidebar, pane chrome, transcript actions, composer, command palette, inspectors, and dialogs.
- [ ] Verify focus order, focus rings, accessible names, status text, color contrast, reduced motion, and screen-reader behavior for critical controls.
- [ ] Add targeted tests or fixtures for text overflow, state rendering, shortcut behavior, and responsive layout rules where practical.

## 12. Visual Verification And Rollout

- [ ] Add a repeatable screenshot checklist for key production states: startup, normal session, active stream, waiting thread, failed command, split panes, workflow inspector, artifact panel, command palette, settings, and narrow shell.
- [ ] Use `electrobun-browser-tools` against a running svvy app for manual UI verification when product behavior or e2e failures need inspection.
- [ ] Store manually captured verification screenshots in `screenshots/`.
- [ ] Run focused unit tests for migrated render helpers, selectors, command palette behavior, pane layout behavior, and transcript projection.
- [ ] Run `bun run test:e2e` for end-to-end UI paths only through the OrbStack machine lane.
- [ ] Remove obsolete visual paths, duplicate primitives, mock-only production code, and unused styling once their production replacements fully match the ported Replit UI.
