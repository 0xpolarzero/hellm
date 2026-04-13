# hellm

`hellm` is a desktop coding agent for real repositories built around visible orchestration.

It keeps strategy in one orchestrator, delegates bounded work to subagents and workflows, and makes artifacts, verification, and resumable work state first-class instead of hiding everything inside one long chat loop.

The intended product centers on:

- one strategic brain that owns routing, reconciliation, and final decisions
- bounded delegated work instead of persistent role agents
- durable sessions, episodes, artifacts, and verification state
- safe resume across interruptions, app restarts, and worktree changes

Product intent lives in [docs/prd.md](docs/prd.md), and the shipped feature surface is tracked in [docs/features.ts](docs/features.ts).

## Commands

- `bun install`
- `bun run dev`
- `bun run build`
- `bun run run`
- `bun run typecheck`
- `bun run test`
- `bun run setup:e2e`
- `bun run test:e2e`

## E2E

Use the OrbStack machine lane for end-to-end tests:

```bash
bun run setup:e2e
bun run test:e2e
```

That keeps e2e runs off the active desktop session while building and exercising the Electrobun app in the dedicated Linux machine.
