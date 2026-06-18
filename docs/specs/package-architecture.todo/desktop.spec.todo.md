# `@svvy/desktop` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/desktop`

## Purpose

`@svvy/desktop` owns the Electrobun/Svelte desktop application.

It is the default UI over `@svvy/runtime` and `@svvy/state`.

## Owns

- Electrobun app lifecycle.
- Window and workspace tab UI.
- Dockview pane layout.
- Chat transcript rendering.
- Composer UI.
- Command palette UI.
- Session/sidebar/archive/delete UI.
- Manual title rename UI and title-freeze affordances.
- Agents pane.
- Extensions pane.
- Workflows generated-surface pane.
- Artifacts pane and preview rendering.
- Request input side panel.
- Snippets pane and composer picker.
- App logs pane.
- Settings UI.
- Approval UI.
- IPC/RPC wiring to runtime and state.
- Runtime-event subscription adapters.
- Renderer-friendly projection adapters that combine runtime events with state read models.

## Does Not Own

- Runtime queue claiming.
- Turn execution.
- pi sessions.
- Extension definitions or tool execution.
- Sandbox policy.
- Durable state invariants.
- Smithers or Workflows instruction content.
- Generated package build/link semantics.
- Prompt dispatch, queue claiming, or generated-context refresh.
- pi message-array submission as a backend package contract.

## Public API Shape

This package is primarily an app package, not a reusable SDK.

It may expose bootstrapping utilities for the product app:

```ts
import { createDesktopApp } from "@svvy/desktop";

await createDesktopApp({ runtime, state }).start();
```

## UI Rules

- UI renders authoritative read models and runtime events.
- UI may request actions; lower packages decide lifecycle outcomes.
- Panes are projections over state/runtime, not package boundaries.
- Workflows pane remains read-only generated package visibility.
- App logs are observability, not canonical state.
- Composer submission calls `runtime.messages.submit(...)` with the new user message and target. It
  must not send full pi message arrays, generated system prompts, generated context previews, or
  renderer `Agent` internals as the package boundary.
- Live transcript rendering applies `surface.stream` patches for immediate display and refetches
  read models after `workspace_read_model.changed`, `app_read_model.changed`, or `command.changed`
  events.
- Stream patches are ordered by monotonically increasing `sequence`. Desktop ignores duplicate or
  older patches, applies only the next expected sequence, and refetches/rebaselines the surface read
  model when a sequence gap is observed.
- Dockview panel focus, pane layout, and panel bindings remain desktop concerns. They must not be
  required for headless runtime use.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on `@svvy/state`.
- Depends on `@svvy/runtime`.
- May depend on Svelte, Electrobun, Dockview, Lucide, and UI-only libraries.
- Must not be imported by non-UI packages.

## Migration Sources

Initial extraction candidates:

- `src/mainview/`
- Electrobun entrypoints and app shell code
- renderer-only projection helpers after reusable selectors move to `@svvy/state`

## Tests

- Renderer unit tests.
- RPC contract tests against fake runtime.
- Browser/e2e tests through the supported OrbStack lane.
- Visual verification for high-risk panes.
