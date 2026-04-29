# UI Port Product Requirements

This document holds the durable requirements and reference rules for the svvy UI port. The active checklist and completion status live in [ui.progress.md](ui.progress.md).

## Required References

Read these before implementing any UI roadmap item:

- [../prd.md](../prd.md) for svvy product scope, runtime ownership, and non-goals.
- [../features.ts](../features.ts) for the exhaustive product feature inventory.
- [ui.artifact-inventory.md](ui.artifact-inventory.md) for the Replit artifact route, component, interaction, mock, and porting inventory.
- [ui.reference-screenshots/](ui.reference-screenshots/) for the desktop visual reference set.
- [../../frontend-replit/artifacts/svvy](../../frontend-replit/artifacts/svvy) for source React artifact code and live interaction inspection.

The Replit artifact visuals, layout, component behavior, and interaction states are the UI source. Replit routes, mock data, and React component boundaries are porting inputs only. Production UI must remain Svelte under `src/mainview` and consume svvy's existing runtime and workspace read-model contracts.

Static screenshots do not capture everything. Inspect the running Replit artifact for animated and live-state details such as blinking status dots, pulse indicators, streaming cursors, progress motion, hover states, focus states, resize affordances, and active-running emphasis before implementing matching Svelte behavior.

## Product Boundary

- Preserve svvy's existing runtime behavior inside pi-backed surfaces, handler threads, Smithers-backed workflow supervision, and durable workspace state.
- Do not infer shipped product runtime architecture from repo-root `workflows/`; that directory is an authoring workspace for maintaining svvy itself.
- Do not introduce a standalone custom shell, readline loop, alternate TUI stack, fallback renderer, or non-pi terminal path.
- Do not add legacy, backwards-compatibility, migration, compatibility, dual-path, or fallback behavior.
- Delete obsolete code, styles, components, tests, fixtures, and docs once the new Svelte UI path owns the behavior.

## UI Source Rules

- Preserve the visual language of the artifact where it improves svvy: dense workbench layout, compact pane chrome, row-based navigation, muted borders, restrained elevation, status chips, focus rings, and live-state motion.
- Treat artifact screens as one of three categories before porting: production svvy surface, fixture-only visual state, or non-portable artifact-only source.
- Treat artifact mock fixtures, fake route state, hardcoded providers, hardcoded sessions, fake workflow runs, fake thread state, and fake artifact previews as visual examples only.
- Real product data must come from svvy read models and runtime contracts: sessions, panes, handler threads, workflows, commands, artifacts, provider settings, Project CI, context budgets, prompt history, and model/reasoning choices.
- Report clearly when the source UI is incomplete, unintuitive, missing expected states, poorly adapted to svvy's product model, or weaker than the way svvy needs to show runtime state.

## Responsive And Accessibility Rules

The supported viewport classes are:

- Full desktop: 1220 px and wider. The shell keeps the dense workbench model with expanded or user-collapsed sidebar, horizontal pane grid, desktop artifact inspector split, compact header metadata, and docked composer.
- Constrained desktop: 768-1219 px. The shell keeps desktop navigation and pane semantics, but inspector artifacts use an overlay, metadata wraps, and component-level overflow rules preserve text containment.
- Narrow shell: 767 px and below. Navigation is collapsed out of the pane grid, the workbench becomes a single-column stacked pane surface, secondary pane metadata is suppressed from pane chrome, artifact inspection uses an overlay, and critical controls use touch-sized hit areas while preserving the same runtime surface bindings.

Narrow behavior is derived from viewport state inside the production Svelte renderer. The Replit artifact `/narrow` route is a source state for layout intent, not a production route or alternate runtime.

Critical interactive surfaces must remain keyboard reachable and screen-reader coherent across all viewport classes. Hidden placement controls must not remain focusable, dialogs must expose labelled modal semantics with focus containment and focus restoration, tree-style inspectors must expose the active descendant, and reduced-motion preferences must disable live-state animation.

## Workflow, Artifact, And Command Inspector Rules

The Replit workflow graph is a non-portable visual reference. Production `svvy` keeps the Svelte workflow inspector tree-first because Smithers workflow state, historical frames, search, keyboard navigation, related surfaces, and restart restoration are already shaped around a durable tree read model.

Use the graph only for compact status semantics:

- active or running nodes use the accent status dot and selected-row emphasis
- completed nodes use success tone
- waiting nodes use warning tone without implying failure
- failed descendants remain visible through compact descendant chips
- selected nodes open a dense detail pane with objective, latest output, worktree, task, command, artifact, Project CI, and raw tabs from the workflow inspector contract

Artifact surfaces use the Replit artifact browser as styling input: compact grouped rows, selected-row treatment, preview/raw/metadata modes, bordered code/log areas, missing-artifact callouts, and tiny artifact rows in command and workflow details. Real content must come from durable artifact records or the existing local artifact controller for legacy renderer artifacts.

Command inspectors use the Replit right-inspector density as a visual pattern, not its mock omniscient tab model. The product keeps command, task-attempt, artifact, Project CI, and workflow inspectors backed by their separate read models, with compact summary sections, metadata rows, child-command hierarchy, artifacts, errors, and raw details.

The saved workflow library has no direct Replit route. It uses the closest dense list patterns from the artifact nav and workflow cards while staying backed by `.svvy/workflows` saved assets and `.svvy/artifacts/workflows` artifact workflows. Replit session folders are not product workflow-library behavior.

## Implementation Rules

- Keep docs, code, and tests in sync when behavior, architecture, product surface, or UI contracts change.
- Keep or extend testing for the affected surface. Do not weaken coverage to make a port easier.
- Use focused POCs for large lifts or unclear porting seams before production implementation.
- Build production UI in `src/mainview`; presentation belongs to Svelte components, behavior belongs to existing runtime controllers, and shared workspace contracts own data shape.
- Preserve prompt targeting, pane bindings, live surface reuse, handler-thread messaging, artifact opening, settings persistence, workflow attention routing, and restart restoration.

## Verification Rules

- After a UI change lands locally, drive the app itself, capture screenshots when relevant, and inspect those screenshots for correctness before marking work complete.
- Use `electrobun-browser-tools` against a running svvy app when product behavior or e2e failures need inspection.
- Run `bun run test:e2e` only for end-to-end UI paths and only through the OrbStack machine lane.
- Do not run e2e for documentation-only work unless there is a product behavior change.
- Store manually captured verification screenshots in repo-root `screenshots/`.

For UI rollout verification, use a repeatable screenshot checklist that covers startup, a normal session, active stream, waiting handler thread, failed command, split panes, workflow inspector, artifact panel or overlay, command palette, settings, and the narrow shell. Pair screenshot review with focused checks for horizontal overflow, text containment, focus order, accessible names, color contrast, reduced motion, and screen-reader state on critical controls.

## Documentation Rules

- Treat docs and specs as source-of-truth product documents, not a changelog or journal.
- Describe the current resolved design and product surface, not what changed, what was replaced, or why an older approach existed.
- Keep [ui.progress.md](ui.progress.md) progress-focused. Put durable UI requirements, source rules, and implementation guidelines in this file.
