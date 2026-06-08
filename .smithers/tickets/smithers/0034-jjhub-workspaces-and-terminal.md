# jjhub parity: cloud workspaces + in-browser terminal

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phase 1). The jjhub client `jjhub/workspaces.ts` and the WS/SSE ticket helper
(`jjhub/websocketTicket.ts`) already exist.

## Problem

Workspaces are jjhub's home page and primary compute unit, and the terminal is
the actual dev environment. The new UI has neither: no workspace list/create, no
PTY. This is the largest single gap.

## Goal

List / create / delete workspaces and attach an in-browser PTY (ghostty-web) over
a ticket-authenticated WebSocket.

## Scope

- New domain `workspaces/`: card + canvas + store + route + test, wired to
  `jjhub/workspaces.ts` (list/create/delete/sessions).
- New domain `terminal/`: `TerminalCanvas.tsx` (ghostty mount — a full-canvas
  xterm/PTY surface, NOT a card), `terminalStore.ts` (WS lifecycle, ticket via
  `jjhub/websocketTicket.ts`, resize), `runTerminalRoute.tsx` at
  `/t/:owner/:repo/:wsId`.
- New dep: `ghostty-web`.
- Defer suspend/resume/fork + snapshots (separate follow-up, plan Phase 12).

## Blocks / architecture

- HARD CONSTRAINT: the Cloudflare Worker strips the `upgrade` header, so the PTY
  WebSocket cannot proxy through it. Terminal must dial `wss://` straight to the
  Go backend (`workspace_terminal.go` origin check) in deployed mode, or via a
  vite WS proxy in dev. Decide this before building.
- Needs a reachable jjhub origin + a real workspace to verify.
- Depends on the route vocabulary (0031).

## Acceptance

- [ ] List/create/delete workspaces for a repo.
- [ ] Open a terminal: ticket -> wss -> PTY round-trips input/output.
- [ ] Connection status + lifecycle (connect/drop/reconnect) surfaced.
- [ ] Terminal transport decision documented (Worker bypass).
