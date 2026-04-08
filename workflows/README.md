# Workflows

This directory is for Smithers workflows we use to build and maintain `hellm` itself.

It is intentionally separate from the product/runtime Smithers integration described in
[`docs/prd.md`](../docs/prd.md) and implemented under [`packages/smithers-bridge`](../packages/smithers-bridge).

Use this directory for authoring-time workflows such as:

- test-surface expansion
- repo maintenance
- large fan-out refactors
- focused audit or migration passes across the repo

Current workflows:

- [`feature-test-fanout.tsx`](./feature-test-fanout.tsx)
  Imports `ALL_HELLM_FEATURES` from [`docs/features.ts`](../docs/features.ts), creates one isolated worktree-backed worker task per feature, verifies and workflow-commits each feature branch, serially merges successful branches back into the main checkout batch-by-batch, and only cleans up clean merged/no-op worktrees afterward.

Notes:

- These workflows are source artifacts for Smithers authoring. They are not part of the app runtime.
- Running them requires a Smithers-capable environment with the Smithers workflow runtime and its dependencies available, plus the chosen coding agent CLI on `PATH`.
- Run them from the source checkout root. They do not require a separate disposable clone.
- The workflow uses per-feature worktrees so workers can operate in parallel without sharing one mutable checkout.
- Worker agents are not expected to create commits; the workflow commits verified worktrees itself.
- Merge-conflicted, verification-blocked, or still-dirty branches are retained by default for manual follow-up instead of being silently deleted.
