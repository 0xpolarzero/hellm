# UI Reference Screenshots

Reference captures from `frontend-replit/artifacts/svvy`, used as the source UI for the Svelte port.

Captured against the Vite dev app on `http://localhost:5177`.

## Route Inventory

- `01-workspace-launcher.png`: `/`
- `02-new-session.png`: `/new`
- `03-session-default.png`: `/session`
- `04-session-active.png`: `/session/active`
- `05-session-waiting.png`: `/session/waiting`
- `06-session-failed.png`: `/session/failed`
- `07-session-inspector.png`: `/session/inspector`
- `08-session-multipane.png`: `/session/multipane`
- `09-session-subagent.png`: `/session/subagent`
- `10-workflow-inspector-source-graph.png`: `/workflow`
- `11-artifacts-browser.png`: `/artifacts`
- `12-settings-auth.png`: `/settings/auth`
- `13-settings-profiles.png`: `/settings/profiles`
- `14-not-found.png`: unknown route fallback

## Notes

- These screenshots capture the Replit artifact's desktop route-level pages and fixture states.
- The workflow inspector screenshot records the Replit artifact's graph-oriented source page. The shipped svvy workflow inspector remains tree-first, so graph-oriented workflow pieces are not ported directly.
- Production Svelte UI work should match the relevant visual treatment while consuming svvy's real runtime controllers and workspace read models.
