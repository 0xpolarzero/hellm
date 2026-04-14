# Workflows

This directory is for Smithers workflows we use to build and maintain `svvy` itself.

It is intentionally separate from the product/runtime Smithers integration described in
[`docs/prd.md`](../docs/prd.md) and implemented under [`packages/smithers-bridge`](../packages/smithers-bridge).

Use this directory for authoring-time workflows such as:

- test-surface expansion
- repo maintenance
- large fan-out refactors
- focused audit or migration passes across the repo

Current workflows:


Notes:

- These workflows are source artifacts for Smithers authoring. They are not part of the app runtime.
- Running them requires a Smithers-capable environment with the Smithers workflow runtime and its dependencies available, plus the chosen coding agent CLI on `PATH`.
- Run them from the source checkout root. They do not require a separate disposable clone.
