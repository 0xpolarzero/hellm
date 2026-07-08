# UI Implementation Note

## Status

- Date: 2026-06-08
- Status: non-authoritative UI implementation note
- Authority: Product behavior must be promoted to `docs/prd.md`, `docs/features.ts`,
  `docs/progress.md`, and the owning `docs/specs/**` file before implementation.

## Scope

UI scope includes sessions, handler threads, commands, artifacts, Logs, Agents,
Extensions, Settings, and read-only saved Workflows visibility.

## Workflows Pane

The Workflows pane shows the latest successful generated `@svvyx/workflows` package.

For each generated export, show:

- kind
- namespace
- export name
- qualified name
- read-only generated code
- generated-file link
- source-file link

For `Agents.*`, also show:

- generated workflow-agent parameter record
- primary human link to customize the corresponding workflow-agent parameter record in the Agents pane

The pane is read-only generated-package visibility and is not a source editor.

## General UI Rules

- Real product data must come from state-backed `svvy` read models. Desktop sends requests through
  bootstrap-provided runtime facade plus state read/command facades, listens only to
  app/bootstrap-prepared `DesktopRendererNotification` payloads including read-model invalidations,
  rebaseline notices, and bounded `surface-stream-patch` payloads derived from `surface.stream`,
  then refetches affected read models after notifications. App/bootstrap owns the runtime event
  subscription, sequencing, buffering, and renderer fanout; UI code does not subscribe to
  package-private runtime services directly.
- Mock fixtures are visual examples only.
- Preserve prompt targeting, Dockview panel bindings, live surface reuse, handler-thread messaging,
  artifact opening, settings persistence, and restart restoration.
- Do not infer product state from transcript prose or mock fixture labels.
