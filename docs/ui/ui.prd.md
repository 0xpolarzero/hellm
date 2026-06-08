# UI PRD

## Status

- Date: 2026-06-08
- Status: current UI direction

## Scope

The current UI scope includes sessions, handler threads, commands, artifacts, Logs, Agents,
Extensions, Settings, and read-only saved Workflows visibility.

## Workflows Pane

The Workflows pane shows the latest successful generated `@svvy/workflows` package.

For each generated export, show:

- kind
- namespace
- export name
- qualified name
- read-only generated code
- generated-file link
- source-file link

For `Agents.*`, also show:

- generated task-agent parameter object
- primary human link to customize the agent in the Agents pane

The pane is read-only generated-source visibility and is not a source editor.

## General UI Rules

- Real product data must come from svvy read models and runtime contracts.
- Mock fixtures are visual examples only.
- Preserve prompt targeting, Dockview panel bindings, live surface reuse, handler-thread messaging,
  artifact opening, settings persistence, and restart restoration.
- Do not infer product state from transcript prose or mock fixture labels.
