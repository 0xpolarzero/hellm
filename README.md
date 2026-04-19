# svvy

`svvy` is a desktop coding harness built around a small strategic orchestrator and delegated execution.

The top-level orchestrator stays narrow: it owns product intent, routing, and final decisions. When work needs bounded execution, it moves into a delegated handler thread. That thread supervises one or more short-lived Smithers workflows or reusable presets, handles verification, validation, retries, and clarification without bloating orchestrator context, and then hands a durable result back to the orchestrator. Pi provides the underlying runtime.

## The Flow

1. You ask the main orchestrator to do something.
2. The orchestrator keeps its context focused on strategy and product state, not the full implementation transcript.
3. If the work is small, it answers directly. If it needs bounded execution, it opens a handler thread for that one objective.
4. The handler thread picks the lightest Smithers path that fits: reuse a template, fill a preset, or author a one-off workflow.
5. Verification and validation live in that path instead of being bolted on afterward, so build, test, lint, manual checks, and failed validations come back as structured outcomes.
6. The thread can inspect results, repair inputs, rerun, pause, resume, or ask for clarification without bloating orchestrator context.
7. When the work is ready, the thread hands the result back to the orchestrator explicitly as a bounded episode.

That keeps product-level reasoning in one place and implementation detail in the delegated surface that owns it.

## Where Smithers Fits

Smithers is not the top-level agent. It is the workflow engine that handler threads use for real bounded execution through structural templates, reusable presets, and one-off authored workflows when needed.

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
