# hellm

`hellm` is now bootstrapped as an Electrobun desktop app with a Bun-side `pi` host and a Svelte renderer.

The current starting point ports the minimal `pi` desktop integration from `../acai` into this repo:

- Electrobun owns the native window and desktop packaging
- the Bun process hosts `pi` through a direct `pi-coding-agent` SDK session host
- the renderer uses `@mariozechner/pi-web-ui` for the initial chat surface
- provider auth, prompt dispatch, streamed response projection, model changes, and thinking-level changes are wired end-to-end

This is a bootstrap, not the finished product. The long-term product architecture is still tracked in [docs/prd.md](docs/prd.md), but the code in `src/` is now the source of truth for the desktop-app starting point.

## Commands

- `bun install`
- `bun run dev`
- `bun run build`
- `bun run run`
- `bun run setup:e2e`
- `bun run test:e2e`
- `bun run typecheck`

## E2E Setup

Set up the dedicated OrbStack Linux machine once:

```bash
bun run setup:e2e
```

Then run the e2e suite from macOS:

```bash
bun run test:e2e
```

That command syncs the latest repository state into the `hellm-e2e` OrbStack machine, installs dependencies there, builds the Linux Electrobun app, and runs the e2e suite under `dbus-run-session` plus `xvfb-run` so nothing appears on your active desktop session.

The shared OrbStack/Electrobun e2e infrastructure now lives in the sibling [`../electrobun-e2e`](../electrobun-e2e) package. `hellm` keeps only its app-specific harness behavior, control files, seeded fixtures, and assertions.
