# Smithers Studio 2

The Smithers **agent operations console**: a dark, focused desktop/web UI for
launching workflows, watching live runs, approving gates, and working hands-on in a
workspace. Built on Vite + React 19 + Zustand.

## The shell at a glance

Studio 2 replaces the original "spaceship" (25 flat views) with **progressive
disclosure** across three tiers:

- **Primary nav (always visible):** Home · Runs · Workspace · Workflows
- **More (one click / palette):** Issues · Landings · Workspaces (JJHub) · Memory · Scores · Search
- **Developer (hidden until opted in):** DevTools · SQL Browser · Logs

A command palette (Cmd-K / Cmd-P) reaches every surface. The visual language is a
dark console where saturated color means *run state* (running / waiting / failed /
approved), never decoration.

## Design docs (read these first — docs define the contract)

- [`.smithers/specs/DESIGN.md`](../../.smithers/specs/DESIGN.md) — the dark design system: color / spacing /
  typography / radius / motion tokens, plus the verbatim CSS custom-property block.
- [`.smithers/specs/UX.md`](../../.smithers/specs/UX.md) — the information architecture: primary / secondary /
  developer nav, the WELCOME → FOCUS → DETAIL model, the welcome/home flow, the
  command-palette behavior, the responsive live-run layout, and the stable e2e test
  hooks. Explains *why* this avoids the spaceship failure.

## Scripts

- `npm run dev` from the repo root starts the Smithers Gateway and Studio 2 together.
- `pnpm --filter @smithers-orchestrator/smithers-studio-2 dev`
- `pnpm --filter @smithers-orchestrator/smithers-studio-2 typecheck`
- `pnpm --filter @smithers-orchestrator/smithers-studio-2 build`
- `pnpm --filter @smithers-orchestrator/smithers-studio-2 exec playwright test` — e2e

The root dev script probes for available ports starting at `7331` for the Gateway and
`5190` for the UI. Override them with `SMITHERS_GATEWAY_PORT` and
`SMITHERS_STUDIO_2_PORT`.

## Data sources

- **`src/workspaceApi.ts`** wraps the `/__smithers_studio/api/*` HTTP endpoints
  (issues, landings, cloud workspaces, prompts, search, memory, scores, SQL, logs,
  local recents). This is the backbone for most surfaces today.
- **`@smithers-orchestrator/gateway-client`** drives live runs over WebSocket
  (`listRuns`, `listWorkflows`, `listApprovals`, `launchRun`, `streamRunEvents`,
  `streamDevTools`, …). The **Runs** surface wires to this; until it lands, Runs
  reads run history/approvals over HTTP so it is never empty.

## Packaging

Phase 2 will wrap this in an Electrobun desktop shell. The Vite web app stays the
source of truth — keep it working.

Terminal input is captured by the frontend Ghostty renderer; the PTY backend runs as
a separate service (`scripts/pty-server.ts`) over WebSocket.
