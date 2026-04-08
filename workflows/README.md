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
  Imports `ALL_HELLM_FEATURES` from [`docs/features.ts`](../docs/features.ts), creates one isolated worktree-backed worker task per feature, verifies each feature branch, serially merges successful branches back into the main checkout, and cleans up successful or no-op worktrees afterward.

Notes:

- These workflows are source artifacts for Smithers authoring. They are not part of the app runtime.
- Running them requires a Smithers-capable environment with the Smithers workflow runtime and its dependencies available, plus the chosen coding agent CLI on `PATH`.
- The workflow uses per-feature worktrees so workers can operate in parallel without sharing one mutable checkout.
- Merge-conflicted or verification-blocked branches are retained by default for manual follow-up instead of being silently deleted.
