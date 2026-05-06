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

## Agent Context Model

`svvy` uses separate agent surfaces with deliberately different context and tools:

- **Orchestrator** owns strategy, routing, and final user-facing decisions. It can inspect and edit the repo with direct tools, use `execute_typescript` for typed batching, start handler threads with `thread.start`, and wait. It knows handlers can run workflows, but it does not receive `smithers.*` workflow tools.
- **Handler threads** own one delegated objective. They get the same direct repo tools plus workflow-library tools, `request_context`, `smithers.*` workflow supervision tools, `wait`, and `thread.handoff`. They can run, inspect, repair, resume, or cancel workflow runs, then hand a durable episode back to the orchestrator.
- **Workflow task agents** run inside a single Smithers task attempt. They receive only task-local repo/artifact tools plus `execute_typescript`, and they do not get orchestrator, handler, wait, or `smithers.*` control tools.
- **Namer** is a tiny no-tool agent that turns the first session prompt or handler objective into a short title.

Prompt context is loaded through the pi system-prompt channel, with actor-specific generated instructions and generated tool/API contracts. Durable surface context, such as recent handoffs or the current handler objective, is reconstructed into the prompt body only when needed. Optional context packs are explicit and persisted on the handler thread; today `ci` can be preloaded with `thread.start({ context: ["ci"] })` or requested later with `request_context({ keys: ["ci"] })`.

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
