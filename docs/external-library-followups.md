# External Library Follow-Ups

This document tracks local workarounds or shims that exist because of current behavior in external libraries.

Only keep items here when:

- the cleanup depends on an upstream package change or release
- the local code exists mainly as a compatibility shim or packaging workaround
- we want an obvious place to revisit and remove the workaround later

## Open Follow-Ups

### Electrobun `three` type leak

- Dependency: `electrobun`
- Local workaround: `package.json` includes `@types/three` even though `svvy` does not directly use `three`
- Why this exists: `electrobun` exports raw `.ts` entrypoints and its public Bun API imports and re-exports `three`; `three` itself does not ship built-in type declarations, so downstream typecheck sees `TS7016` unless consumers install `@types/three`
- Upstream tracking: [blackboardsh/electrobun#280](https://github.com/blackboardsh/electrobun/issues/280)
- Upstream root cause summary:
  - `electrobun` added `three` to its public API surface in `v1.15.1`
  - `electrobun` publishes `.ts` rather than compiled `.js` plus `.d.ts`
  - `electrobun` has an internal `declare module "three"` shim in source, but that shim is not published in the npm tarball
- Revisit when:
  - `electrobun` starts publishing compiled declarations, or
  - `electrobun` adds `@types/three` to published dependencies, or
  - `electrobun` stops leaking `three` from its public root API
- Desired cleanup: remove `@types/three` from `svvy` once Electrobun no longer forces downstream consumers to provide the missing `three` types

### Smithers CLI subpath type exports

- Dependency: `@smithers-orchestrator/cli`
- Local workaround: `src/types/smithers-cli-subpaths.d.ts`
- Why this exists: `svvy` imports Smithers CLI subpaths that are usable at runtime but are not exported with public TypeScript declarations, so local ambient module declarations are needed to typecheck those imports
- Upstream tracking: [smithersai/smithers#127](https://github.com/smithersai/smithers/issues/127)
- Current covered subpaths:
  - `@smithers-orchestrator/cli/chat`
  - `@smithers-orchestrator/cli/why-diagnosis`
- Revisit when:
  - Smithers exports these modules as supported public entrypoints with proper types, or
  - Smithers provides an alternate supported import path for the same functionality
- Desired cleanup: delete `src/types/smithers-cli-subpaths.d.ts` and switch imports to the official exported type surface
