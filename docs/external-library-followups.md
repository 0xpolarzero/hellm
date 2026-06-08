# External Library Constraints

This document records external package constraints that affect `svvy` until upstream packages expose
the needed stable contract.

Keep an item here only when:

- the local dependency or type surface is shaped by an upstream package contract
- the exit condition depends on an upstream package change or release
- the expected `svvy` dependency state is clear

## Active Constraints

### Electrobun `three` type leak

- Dependency: `electrobun`
- Current `svvy` dependency: `package.json` includes `@types/three` even though `svvy` does not
  directly use `three`
- Why this exists: `electrobun` exports raw `.ts` entrypoints and its public Bun API imports and re-exports `three`; `three` itself does not ship built-in type declarations, so downstream typecheck sees `TS7016` unless consumers install `@types/three`
- Upstream tracking: [blackboardsh/electrobun#280](https://github.com/blackboardsh/electrobun/issues/280)
- Upstream root cause summary:
  - `electrobun` added `three` to its public API surface in `v1.15.1`
  - `electrobun` publishes `.ts` rather than compiled `.js` plus `.d.ts`
  - `electrobun` has an internal `declare module "three"` shim in source, but that shim is not published in the npm tarball
- Exit condition:
  - `electrobun` starts publishing compiled declarations, or
  - `electrobun` adds `@types/three` to published dependencies, or
  - `electrobun` stops leaking `three` from its public root API
- Target `svvy` state after the exit condition: `svvy` has no direct `@types/three` dependency.

### Smithers CLI subpath type exports

- Dependency: `@smithers-orchestrator/cli`
- Current `svvy` type surface: `src/types/smithers-cli-subpaths.d.ts`
- Why this exists: `svvy` imports Smithers CLI subpaths that are usable at runtime but are not exported with public TypeScript declarations, so local ambient module declarations are needed to typecheck those imports
- Upstream tracking: [smithersai/smithers#127](https://github.com/smithersai/smithers/issues/127)
- Current covered subpaths:
  - `@smithers-orchestrator/cli/chat`
  - `@smithers-orchestrator/cli/why-diagnosis`
- Exit condition:
  - Smithers exports these modules as supported public entrypoints with proper types, or
  - Smithers provides an alternate supported import path for the same functionality
- Target `svvy` state after the exit condition: imports use official Smithers exported type
  surfaces, with no local ambient declarations for these subpaths.
