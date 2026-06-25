# svvy

`svvy` organizes coding work around orchestrator sessions that hold product intent, route implementation into bounded threads, and reconcile durable results from structured, inspectable workflows those threads supervise without bloating orchestrator context, while letting you steer at any layer.

## The Flow

1. You ask the main orchestrator to do something.
2. The orchestrator keeps its context focused on strategy and product state, not the full implementation transcript.
3. If the work is small, it answers directly. If it needs bounded execution, it opens a handler thread for that one objective.
4. The handler thread picks the lightest path that fits: finish the work directly, run official Smithers CLI commands against workspace `.smithers/` workflow source that imports saved Workflows assets, or author short-lived workspace `.smithers/` workflow source.
5. Verification and validation live in that path instead of being bolted on afterward, so build, test, lint, manual checks, and failed validations come back as structured outcomes.
6. The thread can inspect results, repair inputs, rerun, pause, resume, or ask for clarification without bloating orchestrator context.
7. When the work is ready, the thread hands the result back to the orchestrator explicitly as a bounded episode.

That keeps product-level reasoning in one place and implementation detail in the delegated surface that owns it.

## Agent Context Model

`svvy` uses separate agent surfaces with deliberately different context and tools:

- **Orchestrator** owns strategy, routing, and final user-facing decisions. It can inspect and edit the repo with Shell and Apply Patch, use `execute_typescript` for typed loaded-extension composition, start handler threads with `thread_start({ threads: [...] })`, and wait. It knows handlers can use Smithers through Shell, but it does not receive Smithers wrapper tools.
- **Handler threads** own one delegated objective. They get the same repo tools plus Shell guidance for official Smithers CLI workflow work and report durable results back to the orchestrator.
- **Workflow task agents** run inside a single Smithers task attempt. They receive task-local repo and artifact guidance plus `execute_typescript`, and they do not get orchestrator or handler controls.
- **Namer** is a tiny no-tool agent that turns the first session prompt or handler objective into a short title.

Prompt context is loaded through pi's system-prompt channel from actor-specific generated instructions and generated tool/API contracts. Durable surface state is exposed through targeted tools, read models, queue items, and product-authored start context where the specs require it; it is not flattened into hidden transcript prose.

## Docs

Product intent lives in [docs/prd.md](./docs/prd.md). The exhaustive feature inventory lives in [docs/features.ts](./docs/features.ts). Progress is tracked in [docs/progress.md](./docs/progress.md). Owning specs in [docs/specs](./docs/specs) define accepted behavior; scratch notes and UI notes are inputs only until promoted into those authoritative docs.

## Commands

```bash
bun install
bun run dev
bun run build
bun run run
bun run typecheck
bun run test
# Source-checkout maintenance helper; not a shipped product workflow runtime.
bun run workflow:implement-feature -- --spec docs/specs/foo.spec.md --poc docs/pocs/foo.poc.ts
```

## E2E

Use the OrbStack machine lane for end-to-end tests:

```bash
bun run setup:e2e
bun run test:e2e
```
