# UI Verification Checklist

Use this checklist for product UI verification. Capture manual verification screenshots in repo-root
`screenshots/` and keep the filename tied to the state under review.

## Production States

| State            | Target coverage                                                                                                                          | Required checks                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Startup          | App opens into the workspace app shell with session navigation, Dockview panel chrome, and composer available.                           | No bootstrap error, no horizontal overflow, keyboard focus reaches primary app-shell controls.                                                                                                                                                                                       |
| Normal session   | A settled orchestrator surface shows transcript history, Dockview panel chrome, context budget, and prompt entry.                        | Transcript is readable, long labels truncate or wrap inside bounds, composer target is clear.                                                                                                                                                                                        |
| Active stream    | A running turn shows pending activity, streaming text or cursor, and stop affordance.                                                    | Running status is visible without layout shift, reduced-motion mode does not rely on animation alone.                                                                                                                                                                                |
| Waiting thread   | A handler-thread or orchestrator wait state asks for user input and routes reply to the owning surface.                                  | Reply control is labelled, disabled/enabled state is obvious, focused panel does not steal the route.                                                                                                                                                                                |
| Failed command   | A failed turn or command exposes compact failure context.                                                                                | Error text is contained, retry or inspection actions are discoverable, red state has text/icon backup.                                                                                                                                                                               |
| Split panels     | Multiple Dockview panels show stable panel bindings, resize affordances, close controls, and duplicated-surface behavior where relevant. | Resize handles are reachable, focused panel is visible, panel-local scroll does not bleed.                                                                                                                                                                                           |
| Workflows pane   | Read-only generated Workflows visibility shows namespaces, exports, generated code, and source links.                                    | Generated code is readable, source links are visible, agent rows link to Agents pane customization, data comes from Workflows generated-package read models through renderer-safe state facades, and refresh occurs after app/bootstrap-prepared Workflows read-model invalidations. |
| Artifact panel   | Artifact panel or overlay shows grouped artifacts, preview/raw/metadata modes, missing content, and open-in-editor action.               | Large logs/previews scroll, missing artifacts have clear state, paths do not overflow.                                                                                                                                                                                               |
| Command palette  | `Cmd+Shift+P` opens product actions and `Cmd+P` opens the reserved file quick-open entry point.                                          | Matching, disabled states, shortcuts, Dockview placement, and unmatched prompt creation remain correct.                                                                                                                                                                              |
| Settings         | Provider auth, agent-profile settings, workflow-agent parameter settings, and app preferences render current persisted state.            | Form labels are accessible, destructive actions require confirmation, narrow width remains usable.                                                                                                                                                                                   |
| Narrow app shell | At 767 px and below, the app shell becomes a single-column surface with collapsed navigation and overlay inspectors.                     | Touch targets are usable, hidden controls are not focusable, text stays inside controls.                                                                                                                                                                                             |

## Manual Inspection Steps

1. Launch the app with `bun run inspect:app -- --workspace <absolute-path>` and use the printed `appId` or inspection `bridgeUrl`.
2. Run `electrobun-browser-tools doctor`, `status`, or `tree` against the inspection-enabled app before taking screenshots.
3. Drive the real app with `electrobun-browser-tools page ...` commands for production-reachable UI states.
4. Capture screenshots with `electrobun-browser-tools page screenshot --path screenshots/<state>.png` or CuaDriver when the native/physical surface is part of the check.
5. Inspect each screenshot for horizontal overflow, clipped labels, overlapping controls, focus visibility, accessible names, color contrast, reduced-motion behavior, and screen-reader-critical state.
6. Only use fixture or preview states as supplemental visual evidence; they do not replace verification of reachable production behavior.

## Automated Verification

- Run focused unit tests for affected renderer helpers and selectors.
- Run `bun run test:e2e` only through the configured OrbStack machine lane.
- Inspect retained failure evidence under `e2e-results/<runId>/`; do not discard the isolated state before the product or contract cause is understood.
- Run `bun run check:e2e-coverage:complete` before claiming exhaustive shipped-feature coverage.
- Do not add retries, broad waits, selector churn, test-only behavior, or alternate desktop/Docker e2e paths to force a pass.
