# Optimization Notes

## Status

- Date: 2026-06-08
- Status: non-authoritative performance note; product behavior must be promoted to `docs/prd.md`, `docs/features.ts`, `docs/progress.md`, and the owning `docs/specs/**` file before implementation

## Durable State

Optimize around explicit product records instead of transcript replay:

- sessions
- handler threads
- turns
- commands
- episodes
- artifacts
- generated agent-context bindings
- Workflows generated export metadata
- app logs

## Workflows

Workflows visibility comes from the latest successful generated `@svvyx/workflows` package facts
persisted in `@svvy/state`.

The Workflows pane reads the state-backed generated-package and Workflows read models for generated
export metadata and source/generated file links. `@svvy/extensions` owns the generated output files,
`@svvy/state` returns after-commit descriptors after generated-package facts commit, and
`@svvy/runtime` publishes notifications, schedules generated-package refresh, and separately
coordinates workspace-link repair.

Workspace `.smithers/` authoring remains ordinary repository source when it is real source:
`.smithers/workflows/**`, `.smithers/prompts/**`, `.smithers/components/**`,
`.smithers/agents/**`, `.smithers/package.json`, `.smithers/tsconfig.json`,
`.smithers/bunfig.toml`, and `.smithers/preload.ts` may be indexed when needed. Exclude
`.smithers/node_modules/**`, generated `@svvyx/*` links, Smithers execution state/databases, run
artifacts, and generated package-resolution plumbing from source indexing.

## UI

Use metadata-first read models for navigation and panes.

Avoid:

- reconstructing thread state from transcript prose
- repeatedly reading whole command logs into renderer state
- scanning generated Workflows files on every render
- treating generated package links as editable workspace source

## Logs

App logs are observability, not product truth. Use them for debugging and operator inspection, not as
the source of state reconstruction.
