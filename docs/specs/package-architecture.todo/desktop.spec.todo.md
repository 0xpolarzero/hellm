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

## Does Not Own

- Runtime queue claiming.
- Turn execution.
- pi sessions.
- Extension definitions or tool execution.
- Sandbox policy.
- Durable state invariants.
- Smithers or Workflows instruction content.
- Generated package build/link semantics.

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

## Dependency Rules

- Depends on `@svvy/contracts`.
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

