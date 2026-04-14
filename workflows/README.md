# Workflows

This directory is for Smithers workflows we use to build and maintain `svvy` itself.

It is intentionally separate from the product/runtime Smithers integration described in
[`docs/prd.md`](../docs/prd.md).

Use this directory for authoring-time workflows such as:

- test-surface expansion
- repo maintenance
- large fan-out refactors
- focused audit or migration passes across the repo

Current workflows:

- [`definitions/implement-feature.tsx`](./definitions/implement-feature.tsx)
  Runs one spec-and-POC-driven feature implementation flow in a dedicated worktree: exhaustive `docs/features.ts` inventory with Codex `gpt-5.4` `xhigh`, a separate `test-coverage-plan` pass that maps feature ids to unit/integration/e2e obligations and scenario-grouped e2e journeys, TDD test and e2e authoring with Codex `gpt-5.3-codex` `high`, implementation with Codex `gpt-5.3-codex` `xhigh`, a post-implementation feature-surface reconciliation pass, then a Codex `gpt-5.4` `xhigh` review loop with Codex `gpt-5.3-codex` `xhigh` address-review passes until `LGTM` or a real block. Prompts live under [`workflows/prompts/implement-feature/`](./prompts/implement-feature).

Notes:

- These workflows are source artifacts for Smithers authoring. They are not part of the app runtime.
- [`package.json`](./package.json), [`tsconfig.json`](./tsconfig.json), and [`bunfig.toml`](./bunfig.toml) make this directory a minimal Smithers authoring workspace without changing the product runtime.
- Running them requires a Smithers-capable environment with the Smithers workflow runtime and its dependencies available, plus the chosen coding agent CLI on `PATH`.
- Run them from the source checkout root. They do not require a separate disposable clone.
