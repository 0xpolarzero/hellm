# UI Rollout Verification Checklist

Use this checklist before marking UI rollout work complete. Capture manual verification screenshots in repo-root `screenshots/` and keep the filename tied to the state under review.

## Production States

| State | Target coverage | Required checks |
| --- | --- | --- |
| Startup | App opens into the workspace shell with session navigation, pane chrome, and composer available. | No bootstrap error, no horizontal overflow, keyboard focus reaches primary shell controls. |
| Normal session | A settled orchestrator surface shows transcript history, pane chrome, context budget, and prompt entry. | Transcript is readable, long labels truncate or wrap inside bounds, composer target is clear. |
| Active stream | A running turn shows pending activity, streaming text or cursor, and stop affordance. | Running status is visible without layout shift, reduced-motion mode does not rely on animation alone. |
| Waiting thread | A handler-thread or orchestrator wait state asks for user input and routes reply to the owning surface. | Reply control is labelled, disabled/enabled state is obvious, focused pane does not steal the route. |
| Failed command | A failed turn, command, workflow task, or Project CI check exposes compact failure context. | Error text is contained, retry or inspection actions are discoverable, red state has text/icon backup. |
| Split panes | Multiple panes show stable pane bindings, resize affordances, close controls, and duplicated-surface behavior where relevant. | Resize handles are reachable, focused pane is visible, pane-local scroll does not bleed. |
| Workflow inspector | Tree-first workflow inspector shows rows, selected details, search/tabs, descendants, and failed/waiting states. | Active descendant is exposed, large trees scroll, selected-node details stay readable. |
| Artifact panel | Artifact panel or overlay shows grouped artifacts, preview/raw/metadata modes, missing content, and open-in-editor action. | Large logs/previews scroll, missing artifacts have clear state, paths do not overflow. |
| Command palette | `Cmd+Shift+P` opens product actions and `Cmd+P` opens the quick-open placeholder state. | Matching, disabled states, shortcuts, pane placement, and unmatched prompt creation remain correct. |
| Settings | Provider auth, session-agent settings, workflow-agent settings, and app preferences render current persisted state. | Form labels are accessible, destructive actions require confirmation, narrow width remains usable. |
| Narrow shell | At 767 px and below, the shell becomes a single-column surface with collapsed navigation and overlay inspectors. | Touch targets are usable, hidden controls are not focusable, text stays inside controls. |

## Manual Inspection Steps

1. Launch the app normally and record the printed `appId` or `bridgeUrl`.
2. Run `electrobun-browser-tools doctor`, `status`, or `tree` against the running app before taking screenshots.
3. Drive the real app with `electrobun-browser-tools page ...` commands for UI states that are already reachable.
4. Capture screenshots with `electrobun-browser-tools capture screenshot --path screenshots/<state>.png`.
5. Inspect each screenshot for horizontal overflow, clipped labels, overlapping controls, focus visibility, accessible names, color contrast, reduced-motion behavior, and screen-reader-critical state.
6. Only use fixture or preview states as supplemental visual evidence; they do not replace verification of reachable production behavior.

## Automated Verification

- Run focused unit tests for renderer helpers and selectors that changed or could regress the rollout surface.
- Run `bun run test:e2e` only through the configured OrbStack machine lane.
- Do not add retries, broad waits, selector churn, test-only behavior, or alternate desktop/Docker e2e paths to force a pass.
