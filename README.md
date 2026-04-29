# svvy

`svvy` organizes coding work around orchestrator sessions that hold product intent, route implementation into bounded threads, and reconcile durable results from structured, inspectable workflows those threads supervise without bloating orchestrator context, while letting you steer at any layer.

## The Flow

1. You ask the main orchestrator to do something.
2. The orchestrator keeps its context focused on strategy and product state, not the full implementation transcript.
3. If the work is small, it answers directly. If it needs bounded execution, it opens a handler thread for that one objective.
4. The handler thread picks the lightest path that fits: finish the work directly, run a reusable saved workflow entrypoint, or author a short-lived artifact workflow that may import saved definitions, prompts, components, and agent profiles.
5. Verification and validation live in that path instead of being bolted on afterward, so build, test, lint, manual checks, and failed validations come back as structured outcomes.
6. The thread can inspect results, repair inputs, rerun, pause, resume, or ask for clarification without bloating orchestrator context.
7. When the work is ready, the thread hands the result back to the orchestrator explicitly as a bounded episode.

That keeps product-level reasoning in one place and implementation detail in the delegated surface that owns it.

## Docs

Product intent lives in [docs/prd.md](./docs/prd.md). The current feature inventory lives in [docs/features.ts](./docs/features.ts). The execution model is described in [docs/execution-model.md](./docs/execution-model.md). Progress is tracked in [docs/progress.md](./docs/progress.md).

## Commands

```bash
bun install
bun run dev
bun run build
bun run run
bun run typecheck
bun run test
bun run workflow:implement-feature -- --spec docs/specs/foo.spec.md --poc docs/pocs/foo.poc.ts
```

## E2E

Use the OrbStack machine lane for end-to-end tests:

```bash
bun run setup:e2e
bun run test:e2e
```
