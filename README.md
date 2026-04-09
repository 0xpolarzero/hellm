# hellm

This repository starts as a planning repo for `hellm`, a Slate-like coding agent and TUI built on top of pi coding agent primitives.

Read [docs/prd.md](docs/prd.md) first.

## Workspace

- `packages/cli`: headless CLI entrypoint.
- `packages/tui`: Bun entrypoint for the interactive shell.
- `packages/orchestrator`: main orchestration boundary.
- `packages/session-model`: shared thread and episode primitives.
- `packages/pi-bridge`: placeholder pi integration boundary.
- `packages/smithers-bridge`: placeholder Smithers integration boundary.
- `packages/verification`: verification primitives.

## Commands

- `bun install`
- `bun run prepare:references`
- `bun run dev`
- `bun run check`
