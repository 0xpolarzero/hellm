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
- `bun run dev` for the default HMR loop
- `bun run dev:hmr` for the explicit HMR loop
- `bun run dev:watch` for the reload-only Electrobun watcher
- `bun run build`
- `bun run run`
- `bun run typecheck`
