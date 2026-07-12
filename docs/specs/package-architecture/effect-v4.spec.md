# Effect v4 Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Scope: cross-package Effect v4 usage rules for the `svvy` package architecture

## Purpose

Effect v4 is the implementation substrate for non-UI `svvy` packages.

It gives the package architecture one typed way to express dependencies, resource lifetimes,
structured errors, validation, streams, retries, queues, cancellation, observability, and tests.

Effect does not replace pi, Smithers, SQLite product state, Electrobun, Svelte, or the extension
system. It makes those boundaries explicit and testable.

## References

The active installed Effect authority is `effect@4.0.0-beta.84`, pinned in the root manifest, every
Effect-owning non-UI `@svvy/*` package manifest, and `bun.lock`. `@svvy/desktop` remains a
renderer/app-edge consumer and does not depend on `effect`. Any Effect-owning desktop edge requires
a resolved architecture update across the PRD, feature inventory, package specs, manifests, and
package-boundary tests. The checked-in `docs/references/effect-smol`
snapshot is `effect@4.0.0-beta.84`; it is design/reference material unless the exact import path and
named API are verified against installed `node_modules/effect@4.0.0-beta.84`. The Effect test lane is
adopted: the root manifest pins `vitest@4.1.4` and `@effect/vitest@4.0.0-beta.84`, `bun.lock` records
both packages, and `bun run check` runs `bun run test:effect` between the Bun unit lane and lint.

The active lockfile must remain a coherent Effect platform stack: `effect`, every adopted
`@effect/*` package, every Effect-owning `@svvy/*` package manifest dependency on `effect`, and
every transitive `@effect/*` peer range in `bun.lock` resolve against the same adopted beta.84 stack. The
`packages/effect-installed-exports.effect.test.ts` audit proves the installed exports and concrete
usage forms explicitly covered by the manifest still exist in the active stack; audit coverage is
not production adoption. The authoritative installed-export and adopted-export inventories are
`auditedEffectInstalledExports` and `adoptedEffectRuntimeModuleExports` in
`packages/effect-adoption-manifest.ts`; the prose list here is intentionally non-exhaustive and
bucketed by authority. Production adoption is only the exact module/member set in
`adoptedEffectRuntimeModuleExports`, subject to the source-owner rules below. Installed-export audit
coverage may include production-adopted members, test-only members, conditional canaries, and
audit-only references; audit coverage alone is not permission to use a member in production.
Examples: Bun platform layers, selected Config/ConfigProvider helpers, scoped resource primitives,
Queue/Stream members, logging/metric/tracing members, and runtime runners are usable only in the
exact production/test/conditional/audit bucket named by the manifest plus this spec. `LayerMap`,
`Layer.withSpan`, `Resource`, `RcMap`, `RcRef`, `Stream.callback`, `Queue.end`,
`Queue.asEnqueue`, and `Queue.asDequeue` remain unavailable for production code unless their exact
members are promoted with manifest rows, owner policy, boundary allowlists, and focused tests.
`Queue.fail` is the narrow source-gated exception named by the manifest for
`@svvy/pi-adapter` queue-backed turn/event protocol failure; it remains unavailable everywhere else
without an exact manifest row, owner policy, boundary allowlist, and focused tests.
Any Effect upgrade is a lockstep architecture change across root/package manifests, `bun.lock`,
local references, installed-export audits, package-boundary tests, and this spec.

Installed-export audits prove exported module members only. Option-object shapes, such as fork start
options and uninterruptible mask restore forms, are not manifest members. Production use of an
option shape is permitted only when the owning spec names the exact member call, exact option keys
and values, owner/lifetime reason, and focused tests that exercise the option behavior.
Installed-export audit rows for `Effect.forkIn`, `Effect.forkScoped`, `Effect.forkChild`,
`Effect.uninterruptible`, or `Effect.uninterruptibleMask` do not by themselves approve any option
object shape.

`@effect/platform-bun@4.0.0-beta.84` is adopted only for Bun/Electrobun platform bootstrap service
layers through `@svvy/runtime/bootstrap` `layerRuntimeBunPlatform`, which provides the abstract
`FileSystem.FileSystem`, `Path.Path`, and `Crypto.Crypto` services from installed-verified
`BunFileSystem.layer`, `BunPath.layer`, and `BunCrypto.layer`. Domain services consume only abstract
Effect service tags and must not import concrete platform modules. `@effect/platform-node` and
`@effect/sql-sqlite-*` are not adopted in this architecture.

Effect SQL is also not adopted in this architecture. `@svvy/state` owns SQLite product persistence
through package-private repositories and concrete state layers that use the repository mechanism
named by `state.spec.md`; runtime, extensions, desktop, sandbox, and pi-adapter consume only
core-owned state ports plus approved state facades. Abstract `effect/unstable/sql/*` imports and
live `@effect/sql-sqlite-*` adapters are forbidden in production code. Effect SQL adoption requires
a resolved architecture update across the PRD, state spec, this spec, manifests, lockfile,
implementation, and package-boundary tests for Effect SQL production adoption.

Effect API authority is resolved by the installed `effect@4.0.0-beta.84` package and this spec.
The reference snapshots (`docs/references/effect-smol`, `docs/references/t3code`) are design and
discovery material; they do not define product architecture, staging, or alternate behavior.
`docs/references/t3code` is pattern-only for lint/testing structure and uses its own upstream
dependency-resolution setup rather than svvy's root/package manifests and `bun.lock`; it is never
authority for svvy's Effect version, Bun catalog entries, package manifest ownership, or
installed-export availability. This applies to prose examples and
checked-in reference source snippets equally: exact forms copied from reference source, such as `LayerMap.Service`,
`ManagedRuntime.make`, `Stream.callback`, `PubSub.bounded`, or `RcMap`/`LayerMap` options, require
installed-package typechecking plus production manifest adoption, package-boundary allowlists,
owner policy, and focused tests before product use. Any implementation that uses a reference-only API
must either upgrade the installed root/package manifests and lockfile to the reference version or add
a dated row to `auditedEffectInstalledExports` in `packages/effect-adoption-manifest.ts`, with
`packages/effect-installed-exports.effect.test.ts` proving that every referenced API used by svvy
exists in the installed package. This spec may summarize that row, but it is not the audit
inventory. Installed-export audit evidence alone is not production adoption. Production module
value use still requires the exact module member to be named in
`adoptedEffectRuntimeModuleExports`. `ManagedRuntime` instance methods are recorded in
`adoptedEffectInstanceMemberPolicies` and mechanically enforced by the package-boundary gate
for literal `managedRuntime.context(...)`, `managedRuntime.dispose(...)`,
`managedRuntime.runPromise(...)`, and `managedRuntime.runPromiseExit(...)` calls. Current
non-`ManagedRuntime` service-instance method policies are exactly the owner rows in
`adoptedEffectInstanceMemberPolicies`, including injected `FileSystem`, `Path`, `Crypto`, and
`Semaphore` service callsites owned by sandbox, extensions, state, and runtime source files. Those
records are production policy and package-boundary tests pin the manifest/expectation rows. The gate
is manifest-row and expected-row based; except for explicit receiver-pattern checks
such as `managedRuntime.*`, it is not general binding-aware alias analysis for arbitrary receiver
values. Adding another service-instance method requires the manifest policy, exact owner/callsite spec text,
focused tests, and a same-change package-boundary expectation update.
`ManagedRuntime.make` is an adopted module member only for app/bootstrap runtime construction in the
named owner file enforced by package-boundary tests. The manifest row proves the installed member
exists; it does not permit arbitrary package, renderer, runtime package, desktop package, or
per-request ManagedRuntime creation. Current production ownership is exactly
`src/bun/runtime-service-adapter.ts`. Any additional production callsite requires a concrete product
lifetime reason, a same-change source allowlist in package-boundary tests, and focused tests proving
there is still one app-owned runtime authority rather than a package-level, workspace-level,
surface-level, facade-owned, or per-request runtime.

Effect API authority is resolved by the installed beta.84 package,
`packages/effect-adoption-manifest.ts`, and the package-boundary gates. The import-family table,
Module Decisions Index, and detailed construct table below are explanatory summaries; exact
production adoption still requires manifest member coverage plus any source-owner policy enforced by
package-boundary tests.

| API/import family                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Installed beta.84 status                                                                                                                                                                                                                                                                                                                           | `effect-smol` beta.84 status                                                                               | Adoption state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Allowed packages                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effect` root import and direct core subpaths named in the detailed construct table below, including `effect/Effect`, `effect/Layer`, `effect/Context`, `effect/ManagedRuntime`, `effect/Scope`, `effect/LayerMap`, `effect/Stream`, `effect/Queue`, `effect/PubSub`, `effect/Deferred`, `effect/Latch`, `effect/Ref`, `effect/SynchronizedRef`, `effect/SubscriptionRef`, `effect/ScopedRef`, `effect/Semaphore`, `effect/Fiber`, `effect/FiberHandle`, `effect/FiberMap`, `effect/FiberSet`, `effect/Schedule`, `effect/Duration`, `effect/Config`, `effect/ConfigProvider`, `effect/Schema`, `effect/SchemaIssue`, `effect/SchemaAST`, `effect/SchemaRepresentation`, `effect/JsonSchema`, `effect/Clock`, `effect/DateTime`, `effect/Crypto`, `effect/Encoding`, `effect/Channel`, `effect/Sink`, `effect/Take`, `effect/Filter`, `effect/FileSystem`, `effect/Path`, `effect/PlatformError`, `effect/Logger`, `effect/Tracer`, `effect/Metric`, `effect/Cache`, `effect/ScopedCache`, `effect/Exit`, `effect/Cause`, `effect/Option`, `effect/Redacted`, and `effect/References` | Path-exported by installed `effect@4.0.0-beta.84`; each named function/type used by svvy must typecheck against the installed package before the code lands.                                                                                                                                                                                       | Reference material may show newer names or examples.                                                       | Path availability is not production permission. Production use is allowed only for members named in the Module Decisions Index and `packages/effect-adoption-manifest.ts`; owner/source policy is explicit for adopted instance-member rows, audited member policies, scoped/conditional modules, and any newly promoted module member that needs source gating. This import-family row is a summary; the module decisions index below is the enforcement source for exact module adoption and package policy. Process-local concurrency subpaths are adopted only for scoped process-local coordination named by this spec. Schema representation subpaths are installed-export audit evidence only until exact production member rows, emitter ownership, and focused tests promote them. `Cache`, `ScopedCache`, `RequestResolver`, `Resource`, `Pool`, `RcMap`, `RcRef`, `Latch`, and the other conditional modules named in `auditedEffectInstalledExportPolicies` remain audit-only or conditional unless their exact production member, owner, lifetime, invalidation/release policy, and tests are named in this spec and the adoption manifest. They are not durable state, public contracts, renderer state, or runtime facade payloads. | Only package files, app/process edge files, and facade/bridge files that are covered by `SVVY-EFFECT-001` through `SVVY-EFFECT-005` and have exact manifest member coverage. |
| `effect/testing` and `@effect/vitest`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Installed through root dev dependencies and the `test:effect` lane; Effect service/layer test files must typecheck and run against installed beta.84-compatible packages.                                                                                                                                                                          | Reference testing examples may be newer and must be checked against installed packages.                    | Adopted for `packages/**/*.effect.test.ts`. Bun integration/facade tests may manually create or run Effect runtimes only when their exact file pattern is listed in `SVVY-EFFECT-003` package-boundary allowlists; those harnesses do not use `effect/testing` or `@effect/vitest`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `packages/**/*.effect.test.ts`.                                                                                                                                              |
| `effect/unstable/sql/*` abstract SQL service imports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Not installed-export-audited or adopted in the active `effect@4.0.0-beta.84` stack. Exact paths and named APIs require installed-export evidence before any implementation use.                                                                                                                                                                    | Reference material only for SQL patterns and API discovery.                                                | Not adopted. Any use requires a coherent Effect SQL adoption record across PRD, state spec, this spec, manifests, lockfile, implementation, and package-boundary tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | None.                                                                                                                                                                        |
| `effect/unstable/process` namespace imports for `ChildProcess` and `ChildProcessSpawner`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Available in the installed `effect@4.0.0-beta.84` stack for export-audit coverage only; `import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"` exposes the value reads `ChildProcess.make` and `ChildProcessSpawner.ChildProcessSpawner`. Type-only process imports require a type-only manifest row before production use. | Reference material documents command definitions, streaming handles, and platform-provided spawner layers. | Conditional installed-export canary only. Production use requires the same change to name the command/session owner, exact members, provider layer, environment policy, fake-spawner tests, manifest rows, and boundary allowlists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | None in production. Installed-export audit tests only.                                                                                                                       |
| Unlisted `effect/unstable/*` modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Path availability is not adoption authority. Exact import paths and member reads require installed verification before use.                                                                                                                                                                                                                        | Reference material only.                                                                                   | Not adopted. Production use requires a same-patch spec row naming the exact import path, exact member reads, owner package/service, source globs, lifetime/release policy, package-boundary allowlist, manifest rows, and focused tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | None.                                                                                                                                                                        |
| `@effect/platform-bun`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Installed in the root and `@svvy/runtime` manifests and `bun.lock`; `BunFileSystem.layer`, `BunPath.layer`, and `BunCrypto.layer` are installed-verified and used by `@svvy/runtime/bootstrap` `layerRuntimeBunPlatform`.                                                                                                                          | Reference material may show newer names or examples.                                                       | Adopted only for Bun/Electrobun platform bootstrap service layers, not domain service imports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `@svvy/runtime/src/bun-platform.ts`, app/bootstrap adapters, and focused boundary tests.                                                                                     |
| `@effect/platform-node` and `@effect/sql-sqlite-*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Not installed/adopted unless the manifest and `bun.lock` entries exist in the same patch.                                                                                                                                                                                                                                                          | Reference material only.                                                                                   | Not adopted for product code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | None.                                                                                                                                                                        |

`installed-verified` means both the import path and the exact named values used by svvy are
accepted by the installed dependency during typecheck or by a dated row in
`auditedEffectInstalledExports` proved by `packages/effect-installed-exports.effect.test.ts`.
`path-exported` alone is insufficient authority for implementation when examples come from a newer
reference snapshot.

Every Effect API used by production code, normative implementation examples in this spec, or positive
implementation guidance in this spec must either typecheck in the exact source file against
installed `effect@4.0.0-beta.84`/adopted `@effect/*` packages, or have explicit installed-export
audit coverage before production use. Explicitly rejected or audit-only API names in this spec are
not production permission. Production package and Bun app value member reads are recorded
in `packages/effect-adoption-manifest.ts` as import path plus exact member names.
`packages/package-boundaries.test.ts` derives production Effect member reads from the TypeScript AST
and requires them to match that manifest exactly;
`packages/effect-installed-exports.effect.test.ts` imports the same manifest and proves every
listed runtime member exists on the installed package
namespace. Type-only Effect imports are recorded as type-only module rows and are proven by source
typecheck, not runtime `typeof` checks. Reference-only and installed-export-audited member rows live
only in `auditedEffectInstalledExports`, never in `adoptedEffectRuntimeModuleExports`, and each row
names the import path, exact audited members, verification date, owning spec section, and scope.
Module-level adoption notes live in `auditedEffectInstalledExportPolicies`; member-specific
test-only restrictions live in `auditedEffectInstalledExportMemberPolicies`. Test-only member
permissions require both an audited member row and a member-policy row naming allowed source globs;
those rows are enforced against test/harness source globs by package-boundary tests.
Package-boundary tests reject conditional member policies from production through the production
member gate, reject conditional member reads in test files through a conditional member-policy scan,
and reject test-only member reads outside their declared `allowedSourceGlobs`. Package-boundary
tests enforce production instance-member policies in two lanes: literal/alias-aware
`ManagedRuntime` receiver reads, and injected Effect service receiver reads for the currently
adopted `FileSystem`, `Path`, `Crypto`, and `Semaphore` rows. The injected-service scanner is
receiver-pattern based, not full TypeScript type-flow analysis, so new service-instance policies
must add manifest rows, exact expected package-boundary rows, owner/spec text, and focused tests in
the same change. The production member gate scans package source roots, package-root TypeScript
files, Bun app source, and shared source roots. Those rows still do not grant production import permission. A package-wide typecheck is evidence
only when the changed source file importing the symbol is included in the invoked TypeScript project
and the imported member is also covered by the required manifest or audit row. `effect-smol` beta.84
examples are reference material only; they never prove support in the installed package by themselves.

The adoption manifest is member-gated. `auditedEffectInstalledExportPolicies` rows document why an
installed module is audited, but they do not grant production import permission. Production module
specifiers and value reads are allowed only when the exact module and member are listed in
`adoptedEffectRuntimeModuleExports` or when the module is listed in the type-only manifest and used as
a type-only import. For production module value reads, `adoptedEffectRuntimeModuleExports` is
necessary but not sufficient when a package-boundary rule in this spec names an owner/source
restriction. In those cases, the exact source file must also be allowed by
`packages/package-boundaries.test.ts`, and the owning package spec must name the owner reason and
tests. `adoptionState: "adoptable-member-gated"` and
`adoptionState: "scoped-adoptable-member-gated"` mean the module has an installed-export audit and a
resolved product reason for exact-member promotion through the required same-change manifest, spec,
boundary-test, and focused-test update; they are not allowlist entries by themselves. A
`conditional` policy row is audit-only and does not permit production imports or value
reads. A member policy with `adoptionState: "test-only"` permits only the named test/harness source
globs and remains forbidden in production. Detailed sections below may describe target promotion
rules for installed-but-unadopted members, but implementation must add the exact module member to
`adoptedEffectRuntimeModuleExports`. `ManagedRuntime` instance methods must also add the exact
receiver method to `adoptedEffectInstanceMemberPolicies`,
package-boundary allowlists, and focused tests in the same change that first uses them. Current
non-`ManagedRuntime` service-instance method policies are limited to the injected-service callsites
named in `adoptedEffectInstanceMemberPolicies`, and package-boundary tests compare production
injected receiver/member reads against those rows. Any new service-instance method needs the same
manifest/spec/test owner record plus a package-boundary expected-row update; if the call shape is
outside the current scanner's receiver patterns, the same change must extend mechanical enforcement.

`LayerMap` is not a runtime workspace or surface scope ownership mechanism. Runtime scope ownership
is implemented through runtime-owned keyed child scopes and package-private scope managers inside
the single app-owned `ManagedRuntime`, not `LayerMap.Service`, `LayerMap.make`, `.get(key)`,
`.contextEffect(key)`, `.invalidate(key)`, or any other concrete `LayerMap` member. `LayerMap`
adoption requires a newly named scoped keyed resource owner that is not the workspace/surface runtime
scope manager unless the PRD, feature inventory, runtime spec, this spec, manifest, package-boundary
tests, and focused lifecycle tests are updated in the same architecture change.

Function-style `Context.Service<PortIdentifier, PortService>(id)` is mandatory for every core
data-only port and every package-local host/config port. The package-boundary test ledgers are the
mechanical inventory for the currently known ports; adding a new data-only or host/config port
requires adding the port to the relevant ledger in the same change. Package implementation services
with behavior, such as `Runtime`, `Extensions`, `PiAdapter`, and `Sandbox`, may use class-style
`Context.Service` only when their owning package spec names the service as a behavior-owning
package service.

The Effect test lane is exactly `packages/**/*.effect.test.ts` under the root `test:effect` script.
App-side `src/**.effect.test.ts` files are not covered by that script and are therefore forbidden
unless the same change updates the script, this spec, and package-boundary expectations. Bun-lane
tests may manually run Effect only when their exact file/member reads are listed by
package-boundary checks: current exceptions are SQLite-backed `@svvy/state` tests that directly or
transitively depend on the active `bun:sqlite` adapter, exact state facade/app-edge harnesses, and
named app-side integration harnesses. Those Bun-lane tests must not import `effect/testing` or
`@effect/vitest`.

Local Effect v4 reference entry points:

- `docs/references/effect-smol/LLMS.md`
- `docs/references/effect-smol/AGENTS.md`
- `docs/references/effect-smol/.patterns/effect.md`
- `docs/references/effect-smol/cookbooks/schedule.md`
- `docs/references/effect-smol/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/02_services/01_service.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/02_services/20_layer-composition.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/10_acquire-release.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/20_layer-side-effects.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/30_layer-map.ts`

The checked-in upstream v4 reference notes under `docs/references/effect-smol/migration/` are useful
only for understanding why v4 APIs have their current shape. They are not product architecture,
not staging instructions, and not production permission. When a local reference file uses a member
that is not named in `adoptedEffectRuntimeModuleExports`, the reference file is discovery material
only until the exact member is installed-audited, promoted in the adoption manifest, allowed by
package-boundary tests, and covered by an owner-package behavior test.

If a checked-in upstream reference says not to inspect `node_modules`, that upstream instruction is
not svvy policy. For svvy Effect work, installed `node_modules/effect@4.0.0-beta.84`, root/package
manifests, `bun.lock`, `packages/effect-adoption-manifest.ts`, and package-boundary tests are the
authority for API availability and production adoption.

- `docs/references/effect-smol/ai-docs/src/01_effect/05_running/10_run-main.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/05_running/20_layer-launch.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/06_pubsub/10_pubsub.ts`
- `docs/references/effect-smol/ai-docs/src/02_stream/10_creating-streams.ts`
- `docs/references/effect-smol/ai-docs/src/02_stream/20_consuming-streams.ts`
- `docs/references/effect-smol/ai-docs/src/02_stream/30_encoding.ts`
- `docs/references/effect-smol/ai-docs/src/03_integration/10_managed-runtime.ts`
- `docs/references/effect-smol/ai-docs/src/05_batching/10_request-resolver.ts`
- `docs/references/effect-smol/ai-docs/src/06_schedule/10_schedules.ts`
- `docs/references/effect-smol/ai-docs/src/07_datetime/10_creating-and-formatting.ts`
- `docs/references/effect-smol/ai-docs/src/07_datetime/20_time-zones.ts`
- `docs/references/effect-smol/ai-docs/src/08_observability/10_logging.ts`
- `docs/references/effect-smol/ai-docs/src/08_observability/20_otlp-tracing.ts`
- `docs/references/effect-smol/ai-docs/src/09_testing/10_effect-tests.ts`
- `docs/references/effect-smol/ai-docs/src/09_testing/20_layer-tests.ts`
- `docs/references/effect-smol/ai-docs/src/50_http-client/10_basics.ts`
- `docs/references/effect-smol/ai-docs/src/51_http-server/10_basics.ts`
- `docs/references/effect-smol/ai-docs/src/60_child-process/10_working-with-child-processes.ts`
- `docs/references/effect-smol/ai-docs/src/70_cli/10_basics.ts`
- `docs/references/effect-smol/packages/effect/README.md`
- `docs/references/effect-smol/packages/effect/SCHEMA.md`
- `docs/references/effect-smol/packages/effect/src/Effect.ts`
- `docs/references/effect-smol/packages/effect/src/Clock.ts`
- `docs/references/effect-smol/packages/effect/src/Config.ts`
- `docs/references/effect-smol/packages/effect/src/ConfigProvider.ts`
- `docs/references/effect-smol/packages/effect/src/Context.ts`
- `docs/references/effect-smol/packages/effect/src/Crypto.ts`
- `docs/references/effect-smol/packages/effect/src/DateTime.ts`
- `docs/references/effect-smol/packages/effect/src/Deferred.ts`
- `docs/references/effect-smol/packages/effect/src/Encoding.ts`
- `docs/references/effect-smol/packages/effect/src/FileSystem.ts`
- `docs/references/effect-smol/packages/effect/src/FiberHandle.ts`
- `docs/references/effect-smol/packages/effect/src/FiberMap.ts`
- `docs/references/effect-smol/packages/effect/src/FiberSet.ts`
- `docs/references/effect-smol/packages/effect/src/Latch.ts`
- `docs/references/effect-smol/packages/effect/src/Layer.ts`
- `docs/references/effect-smol/packages/effect/src/LayerMap.ts`
- `docs/references/effect-smol/packages/effect/src/LogLevel.ts`
- `docs/references/effect-smol/packages/effect/src/Logger.ts`
- `docs/references/effect-smol/packages/effect/src/ManagedRuntime.ts`
- `docs/references/effect-smol/packages/effect/src/Metric.ts`
- `docs/references/effect-smol/packages/effect/src/Path.ts`
- `docs/references/effect-smol/packages/effect/src/PubSub.ts`
- `docs/references/effect-smol/packages/effect/src/Queue.ts`
- `docs/references/effect-smol/packages/effect/src/Random.ts`
- `docs/references/effect-smol/packages/effect/src/Redacted.ts`
- `docs/references/effect-smol/packages/effect/src/Ref.ts`
- `docs/references/effect-smol/packages/effect/src/References.ts`
- `docs/references/effect-smol/packages/effect/src/Resource.ts`
- `docs/references/effect-smol/packages/effect/src/Request.ts`
- `docs/references/effect-smol/packages/effect/src/RequestResolver.ts`
- `docs/references/effect-smol/packages/effect/src/Schedule.ts`
- `docs/references/effect-smol/packages/effect/src/Schema.ts`
- `docs/references/effect-smol/packages/effect/src/SchemaGetter.ts`
- `docs/references/effect-smol/packages/effect/src/SchemaIssue.ts`
- `docs/references/effect-smol/packages/effect/src/SchemaTransformation.ts`
- `docs/references/effect-smol/packages/effect/src/ScopedRef.ts`
- `docs/references/effect-smol/packages/effect/src/Semaphore.ts`
- `docs/references/effect-smol/packages/effect/src/Sink.ts`
- `docs/references/effect-smol/packages/effect/src/Scope.ts`
- `docs/references/effect-smol/packages/effect/src/Stream.ts`
- `docs/references/effect-smol/packages/effect/src/SubscriptionRef.ts`
- `docs/references/effect-smol/packages/effect/src/SynchronizedRef.ts`
- `docs/references/effect-smol/packages/effect/src/Tracer.ts`
- `docs/references/effect-smol/packages/effect/src/Channel.ts`
- `docs/references/effect-smol/packages/effect/src/ChannelSchema.ts`
- `docs/references/effect-smol/packages/effect/src/Cache.ts`
- `docs/references/effect-smol/packages/effect/src/Pool.ts`
- `docs/references/effect-smol/packages/effect/src/RcMap.ts`
- `docs/references/effect-smol/packages/effect/src/RcRef.ts`
- `docs/references/effect-smol/packages/effect/src/ScopedCache.ts`
- `docs/references/effect-smol/packages/effect/src/JsonPatch.ts`
- `docs/references/effect-smol/packages/effect/src/JsonSchema.ts`
- `docs/references/effect-smol/packages/effect/src/testing/index.ts`
- `docs/references/effect-smol/packages/effect/src/testing/TestClock.ts`
- `docs/references/effect-smol/packages/effect/src/unstable/process/index.ts`
- `docs/references/effect-smol/packages/effect/src/unstable/process/ChildProcess.ts`
- `docs/references/effect-smol/packages/effect/src/unstable/process/ChildProcessSpawner.ts`
- `docs/references/effect-smol/packages/effect/src/unstable/sql/`
- `docs/references/effect-smol/packages/effect/src/`
- `docs/references/effect-smol/packages/platform-bun/src/`
- `docs/references/effect-smol/packages/platform-node/src/`
- `docs/references/effect-smol/packages/sql/sqlite-bun/src/`
- `docs/references/effect-smol/packages/sql/sqlite-node/src/`
- `docs/references/effect-smol/packages/vitest/src/`
- `docs/references/t3code/` for app/testing patterns that are not Effect API authority,
  especially `docs/references/t3code/oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts`,
  `docs/references/t3code/oxlint-plugin-t3code/rules/no-inline-schema-compile.ts`, and
  `docs/references/t3code/oxlint-plugin-t3code/rules/no-global-process-runtime.ts`.
- `docs/references/t3code-map.md` for the curated subset of `docs/references/t3code` files used
  when applying those app/testing patterns.

Use Effect v4 API patterns from `docs/references/effect-smol/`, but production use remains governed
by installed-package verification, the adoption manifest, and the adoption rules above. svvy adopts
Effect v4 names and v4 package paths only (for example `Context.Service`,
`Schema.TaggedErrorClass`, `Effect.gen`, `ManagedRuntime`).

Effect package code uses TypeScript `strict` mode and a TypeScript version compatible with Effect
v4's declaration requirements. Do not weaken compiler settings to make Effect code typecheck.

## Local Reference Pattern Notes

The following notes describe local-reference patterns used to shape this architecture. They do not
override installed-package verification, the adoption manifest, or package-boundary tests:

- Effect v4 services use `Context.Service`; package implementation services use class-style
  `Context.Service<Self, Shape>()(id)`, while core-owned data-only ports use function-style
  `Context.Service<PortIdentifier, PortService>(id)` so the environment key remains type-distinct
  from the provider object shape. Reference:
  `docs/references/effect-smol/packages/effect/src/Context.ts` for the installed
  `<Identifier, Shape = Identifier>` overload; upstream reference notes may explain the syntax but
  do not add product permissions.
- Class-style service layer providers returned from `Layer.effect(Service, ...)` use
  `Service.of({...})` as the type-shaping helper for the service implementation object. Runtime
  context binding is created by `Layer.effect(Service, ...)`, `Layer.succeed(Service, ...)`, or
  another installed-verified context/layer constructor named by this spec; `Service.of(...)` itself
  does not allocate or bind the `Context` slot. Raw object providers are reserved for
  function-style data-only ports or installed-verified owner patterns explicitly named by the
  package spec.
- Every exported `Context.Service` key string uses a stable package-qualified id such as
  `"@svvy/core/AppLogWritePort"`. Unrelated services must never reuse a key string because the key
  string is the runtime `Context` slot identity.
- Service dependencies are read inside `Effect.gen(function* () { ... })` with `yield* Service`,
  which keeps dependencies visible at the use site.
- JavaScript `try` / `catch` is not used to handle yielded Effect failures inside
  `Effect.gen(...)`, `Effect.fn(...)`, layer constructors, service methods, runtime operation
  bodies, extension handlers, repository methods, worker loops, or facade-adapter effects. Effect
  failures stay in the Effect error channel; handle them with manifest-adopted Effect recovery APIs
  such as `Effect.catch`, `Effect.catchCause`, and `Effect.mapError`, or with narrower recovery APIs
  only after exact installed-export audit, manifest promotion, package-boundary allowlists, and
  focused tests. Use `try` / `catch` only inside `Effect.try(...)` / `Effect.tryPromise(...)`
  thunks or other explicitly named foreign synchronous/Promise boundaries that immediately map
  unknown host failures to package tagged errors. Reference:
  `docs/references/effect-smol/.patterns/effect.md`.
- Reusable named functions that return effects use only the labeled form
  `Effect.fn("@svvy/<package>/<operation>")(body)` so traces, defects, and type surfaces point at
  the product operation instead of an anonymous generator. Production package source labels are
  package-qualified with the owning package id prefix, such as
  `Effect.fn("@svvy/runtime/messages.submit")`; package-boundary tests reject unqualified
  production package labels. Unlabeled `Effect.fn(body, ...)`, `Effect.fnUntraced(...)`, and
  non-package-qualified labels are not production package permissions unless a hot-path exception is
  named with benchmark evidence, manifest policy, boundary enforcement, and focused tests.
  This applies to exported service methods, runtime operation helpers, facade-adapter effects, and
  package-local functions reused across files. Inline layer construction, one-off local
  composition, and short test bodies may use `Effect.gen(...)` directly. Dependencies inside both
  forms are still acquired with `yield* Service`; wrapping a function in `Effect.fn(...)` does not
  permit hidden `Service.use(...)`, global reads, or pre-run dependency capture. Reference:
  `docs/references/effect-smol/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`.
- Service access inside service and layer implementation bodies uses `yield* Service` inside
  `Effect.gen(...)`. `Service.use(...)` and `useSync(...)` are allowed only in non-domain adapter
  edges that immediately return or run the produced effect: facade methods, bridge handlers,
  one-shot app/process entrypoints, and tests. They are forbidden inside package service
  implementations, repository methods, runtime operation bodies, extension handlers, long-lived
  worker loops, and helpers that return an Effect for later composition. In those bodies, acquire
  dependencies with `yield* Service` inside `Effect.gen(...)` so requirements remain visible.
- Layers are explicit. Effect v4 does not create package layers automatically from `make`; package
  code defines named `Layer.effect(...)` or composed package layers. If a service uses a
  `Context.Service(..., { make })` constructor, that `make` value is an implementation factory only
  unless the owning package spec names it as a public API. The package still exports an explicit
  layer such as `Layer.effect(Service, Service.make)` or a composed package layer. References:
  `docs/references/effect-smol/packages/effect/src/Context.ts` for the `Context.Service` overload
  and `docs/references/effect-smol/ai-docs/src/01_effect/02_services/20_layer-composition.ts` for
  explicit layer composition.
- Effect v4 shares layer memoization across `Effect.provide` calls through the fiber memo map. This
  is a safety net, not a substitute for explicit package layer composition or a reason to create
  multiple app runtimes. `Effect.provide(...)` is adopted only as the exact member listed in the
  manifest. Shared `layer(...)` / `it.layer(...)` blocks share the constructed context by design.
  Use per-test layer construction or avoid a shared layer block when a test must isolate database
  handles, refs, queues, pubsubs, layer maps, process spawners, clocks, or mutable fake ports.
  `Effect.provide(layer, { local: true })` is not an active test-lane permission unless the same
  change names the owning test pattern, adds an option-shape canary, and updates package-boundary
  enforcement. `Layer.fresh(...)` is unavailable until manifest and boundary tests adopt it.
  Memoization is scoped to the runtime/fiber memo map that owns the build; svvy product sharing
  comes from one app-owned `ManagedRuntime`, not from ad hoc shared memo maps across independently
  created runtimes. Tests that need isolated refs, queues, scopes, or fake ports use per-test
  provisioning or manifest-adopted local layer construction.
- Effect fact: `ManagedRuntime` runs repeated effects over one lazily acquired, cached layer context
  and releases resources on dispose. A disposed `ManagedRuntime` cannot be reused. Svvy policy:
  public `@svvy/*` package modules must not export package-level `ManagedRuntime` singletons or
  create per-request runtimes. Reference:
  `docs/references/effect-smol/packages/effect/src/ManagedRuntime.ts`.
- Resource lifetimes are scope-driven through layer scopes, `Effect.acquireRelease`, scoped forks,
  and explicit finalizers. Reference:
  `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/10_acquire-release.ts`.
- Manual bridge scopes use `Scope.make`, `Scope.close`, and
  `Effect.provideService(Scope.Scope, scope)`. Use `Scope.fork(parent, strategy)` only when the
  owning facade/bootstrap spec names a child lifetime that must close before or independently from
  the parent scope, names the finalizer strategy, and tests parent-close and child-close ordering.
  `Scope.close(scope, exit)` runs registered finalizers with the supplied `Exit`. `Scope.provide`
  and `Scope.use` are installed and covered by canary tests, but production use remains blocked
  until the same change adds them to `adoptedEffectRuntimeModuleExports`, updates package-boundary
  allowlists, and adds focused owner-package tests. Reference:
  `docs/references/effect-smol/packages/effect/src/Scope.ts`.
- `@effect/vitest` is the normal Effect service/layer test surface. Effect service/layer tests use
  `it.effect`, `layer(...)`, test layers, and the canonical
  `import { TestClock } from "effect/testing"` import instead of manual runners in Bun
  tests, except for SQLite-backed `@svvy/state` tests covered by the active `bun:sqlite` adapter
  exception and package-boundary-listed Bun integration/facade harnesses that prove non-Effect app
  edges over a caller-owned runtime.
  The direct `effect/testing/TestClock` subpath remains installed-export audited for support,
  but the normal repo import path is `effect/testing`.
  `layer(...)` creates one shared layer for the enclosing test block and tears it down after all
  tests in that block. Tests that mutate fake ports, refs, queues, clocks, temp roots, or captured
  events either allocate a fresh fixture inside each `it.effect(...)`, use a per-test layer block,
  or reset the shared service in `beforeEach`; they must not rely on accidental cross-test order.
  References:
  `docs/references/effect-smol/ai-docs/src/09_testing/10_effect-tests.ts` and
  `docs/references/effect-smol/ai-docs/src/09_testing/20_layer-tests.ts`.
- T3Code references reinforce two svvy package rules: schema compiler calls should be hoisted rather
  than compiled inside function bodies, and host/process facts should be injected rather than read
  directly from globals. References:
  `docs/references/t3code/oxlint-plugin-t3code/rules/no-inline-schema-compile.ts` and
  `docs/references/t3code/oxlint-plugin-t3code/rules/no-global-process-runtime.ts`.

The complete svvy bootstrap sequence, `ManagedRuntime.make(appLayer)`, then
`await managedRuntime.context()` for layer acquisition/cache, then the separate runtime-owned
startup readiness effect, then facade exposure, shutdown preparation, and disposal, is a svvy
product architecture contract assembled from the Effect runtime/layer/scope primitives above. It is
not copied from a single upstream reference example.

## Top-Level Decision

All non-UI public implementation packages expose Effect-native service and layer APIs as their
primary internal and package-to-package surface. The canonical `@svvy/runtime` service shape is the
complete API group list in `runtime.spec.md`; this Effect spec must not define a second
abbreviated runtime API. Syntax examples in this file demonstrate Effect v4 mechanics only and are
not package contracts unless they are explicitly tied to the package spec that owns them.

`@svvy/runtime` exposes exactly one public Effect service contract and one non-Effect facade
factory surface at the package root:

- `Runtime`: the `Context.Service` class whose service shape is the complete API group list in
  `runtime.spec.md`.
- `Runtime.layer`: the package-owned production layer for the runtime service plus the
  package-private runtime context services and app-bootstrap services named by `runtime.spec.md`,
  including startup readiness, shutdown preparation, accepted native-tool execution, and
  post-commit notification.
- `layer`: the root alias for `Runtime.layer`, with no hidden `ManagedRuntime` creation.
- `createRuntimeFacade(managedRuntime)`: the non-Effect facade factory over a
  caller-owned `ManagedRuntime`.

Public runtime facades expose the same named groups and request payloads as the runtime service,
such as `runtime.messages.submit(...)`, `runtime.messages.abort(...)`, `runtime.queues.steer(...)`,
and `runtime.requestInput.answer(...)`. They do not accept raw `RuntimeEffectRequest` envelopes,
arbitrary effect names, generic command dictionaries, or workflow task-agent bridge calls. The
authenticated `runTaskAgent` bridge is a command-scoped loopback endpoint injected only into
eligible Smithers task-agent environments. Raw `RuntimeEffectRequest` values are decoded and applied
only inside runtime-owned extension/tool result handling or runtime recovery paths.

The app and non-Effect consumers may use Promise, callback, or `AsyncIterable` facades created from
the exactly one app-owned `ManagedRuntime` for the healthy app-runtime instance after app/bootstrap
has awaited the runtime-owned startup readiness barrier. Those facades are adapters over the Effect
services. They must not contain parallel
lifecycle logic, state mutation policy, command/session lifecycle policy, readiness admission
policy, retry policy, runtime event publication, queue claiming, prompt dispatch, tool execution, or
recovery logic. The complete app bootstrap graph, including state port layers, is defined in
`package-architecture.spec.md`; this file defines the Effect rules that graph must follow.

Package layers are composed once at app/bootstrap. Facades receive the caller-owned
`ManagedRuntime`; package code must not create a runtime or rebuild this graph per request. No
public `@svvy/*` package module exports a package-level `ManagedRuntime` singleton, memoized runtime
map, or exported `runtime` value copied from reference examples. The Electrobun app process has
exactly one long-lived app-owned `ManagedRuntime` while healthy. Any other process root is a
separate one-shot process or explicit test/CLI harness outside the healthy desktop product runtime.

Runtime implementation layers follow the v4 composition pattern from the local Effect references:
package-private sublayers are composed with `Layer.mergeAll(...)` and hidden behind the exported
`Runtime.layer` with production-adopted `Layer.provide(...)` or ordinary composed layer
provisioning. `Layer.provideMerge(...)` is production-adopted only for exact manifest source gates
that need retained package-private dependency services while composing an internal service bundle;
the exported public root layer still hides that bundle with `Layer.provide(...)`. App/bootstrap
supplies only the explicit `RuntimeLayerRequirements`: direct package services, core-owned state
ports, platform services, runtime-layer config/readiness dependencies, and the spec-named primitive
host ports. Runtime-owned services such as the event bus, queue wake service, source invalidation service,
generated-package refresh service, request-input wait service, accepted native-tool execution
service, approval/wait registries, command-session service, recovery coordinators, and runtime
post-commit notification are built inside `@svvy/runtime` layers rather than handed in as broad app
callback objects.
The desktop product process must not create any additional app-global, private app-global,
per-window, per-workspace, or per-request `ManagedRuntime`. Runtime values are created only by
product app bootstrap for the single app runtime, or by narrowly named non-product harnesses whose
job is to adapt framework callbacks into package services; package entrypoints export services,
layers, contracts, and facade factories instead.

Packages may export named package-local layer bundles such as `layerRuntimeCore` or
`layerStateRepositories` to express owner-package dependency subgraphs. Those modules compose
services and layers only; they do not create `ManagedRuntime`s, launch process roots, read host
globals, or assemble per-request dependency graphs. Public svvy package layers do not use `Live`,
`Default`, or `*LayerLive` names; implementation/live status is expressed by the package owner and
dependency graph, not a suffix.

The shipped app bootstrap must compose one app runtime layer graph from package-owned bundles, then
create exactly one app-owned `ManagedRuntime` for the healthy app-runtime instance. The required
topology is:

- `@svvy/state`: database setup, migrations, repositories, read models, and state-backed port
  implementations.
- `@svvy/sandbox`: sandbox policy and launch-policy services.
- `@svvy/pi-adapter`: pi session and turn-execution services.
- `@svvy/extensions`: extension registry, prompt/source services, native tool handlers, generated
  declarations, and generated package production.
- `@svvy/runtime`: workspace/surface runtime scope services, queue dispatch services, event hubs, recovery,
  generated-context refresh, generated-package refresh coordination, command/session services, and
  facade factory.
- app/bootstrap: platform layers, app host facts/config, Electrobun bridge wiring, and the single
  `ManagedRuntime`.

Package bundles may depend on earlier package service tags, but they do not reach into another
package's implementation modules. App/bootstrap wires bundles once; request handlers and renderer
bridges call the resulting service/facade and never rebuild this topology per request.

App bootstrap must call `await managedRuntime.context()` immediately after `ManagedRuntime.make(...)`
and before exposing runtime, state, pi-adapter, extension, sandbox, desktop, browser-tool, or
headless bridge facades. This is a product bootstrap rule, not an inference from reference-source
laziness semantics: app/bootstrap treats `context()` as the explicit acquisition/readiness boundary
for the app-owned layer graph. App bootstrap then calls
`awaitRuntimeStartupReadiness(managedRuntime)` and receives a
`RuntimeStartupReadinessReceipt` before constructing or exposing facades. Facade factories assume
this bootstrap contract has completed; ordinary facade methods do not each reinvent startup
readiness admission. If a method needs a later owner-scope readiness check, such as workspace
acquire, surface open, subscription attach, or command-session acquire, that readiness belongs to the
owning runtime service method and returns a method-specific typed error or receipt. Startup effects,
migrations, source validation, generated-package recovery, and startup config validation must
complete during layer acquisition or the runtime-owned readiness barrier, or fail startup when their
successful completion is required before any facade can be exposed.

`managedRuntime.context()` proves that the app layer graph has been acquired. It does not by itself
prove that forked scoped background workers are semantically ready. If startup depends on a watcher,
recovery worker, source scan, queue wakeup loop, or surface owner being attached, initialized, or
ready to accept work, the layer construction effect must await an explicit runtime-owned
`Deferred`, adopted `Ref` / `Semaphore` coordination, receipt, or typed readiness effect after that
worker has reached the required state. `Latch` remains unavailable unless its exact members are
promoted in the manifest, boundary tests, owner policy, and focused readiness tests.
`Effect.forkScoped` ties a forked fiber to the active scope and returns a `Fiber`; it is not a
readiness probe. The local beta.84 reference exposes fork startup options such as
`{ startImmediately, uninterruptible }`. Each svvy worker must name its owner-chosen fork start
policy. When `startImmediately: true` is used for a readiness-sensitive worker, the same service
must still wait for the worker's own readiness receipt; eager scheduling is not a substitute for
initialization proof. `uninterruptible` is allowed only around short critical sections that commit
or release a resource and must never wrap long-running queue drains, protocol readers, source scans,
bridge subscriptions, or process-output loops.

`Effect.forkIn(ownerScope)` is the adopted production primitive for runtime-owned scoped workers and
appears in `packages/effect-adoption-manifest.ts`. `Effect.uninterruptible` is adopted only for the
source-gated generated-package promotion critical section in
`packages/extensions/src/generated-package-writer.ts`, where focused tests prove a failed promotion
restores the previous ready generated package root. Production use of other fork/resource members
named in this section, including `Effect.forkScoped`, `Effect.forkChild`, and
`Effect.uninterruptibleMask`, must add exact member rows to
`packages/effect-adoption-manifest.ts`, package-boundary allowlists, owner policy, and focused tests
in the same change. `Effect.onExit` exists in the local beta.84 reference but is not currently
recorded in `auditedEffectInstalledExports`; production use first requires an installed-export audit
row, then exact adoption/owner/boundary/test promotion. Candidate members such as
`Effect.scopedWith` and `Effect.scope` must first have installed-export audit rows for the active
Effect version before any production promotion. Source-file typecheck proves type-level support
only; it is not production adoption permission.

Runtime marker predicates for `ManagedRuntime` are not production APIs. If adopted, any exact marker
member is allowed only in named app/bootstrap or facade-edge files to narrow unknown edge inputs,
with an installed-export audit row, production manifest row, package-boundary allowlist, and focused
edge test in the same change. It does not prove that the runtime has acquired its context, completed
`svvy` readiness barriers, or remains undisposed. Facade factories that accept a runtime rely on the
app bootstrap readiness contract and must be called only after
`awaitRuntimeStartupReadiness(managedRuntime)` resolves. They never treat a `ManagedRuntime` marker
as a readiness or liveness check. Tests that construct a facade around a fake or manually provided
runtime must either provide a runtime whose startup readiness service has already completed or state
that they exercise only facade error mapping over a fake service.

Effect-native bootstrap code may use manifest-adopted `managedRuntime.context()` only for the same
app-bootstrap acquisition boundary.
`Layer.effectContext(...)` is not an active framework-edge wrapper pattern. The creator of the
`ManagedRuntime` remains responsible for `managedRuntime.dispose()`. `managedRuntime.disposeEffect`
is installed-reference knowledge only until the exact instance member is added to the adopted
`ManagedRuntime` member policy and boundary tests. Domain services still receive dependencies
through service requirements, not by reaching into a managed runtime.
If `managedRuntime.context()` fails, app/bootstrap treats startup as failed by `svvy` product
policy: it does not expose partial runtime/state/pi/extension facades, reports a typed startup
failure through the app-owned startup surface, and disposes the runtime before any retry. A retry
creates a new `ManagedRuntime` from the same package layer graph. Effect v4 supports lazy runtime
acquisition and explicit disposal; svvy owns the terminal behavior for bridge calls that are
pending at startup failure, shutdown, or disposal.

If `managedRuntime.context()` succeeds but any required runtime-owned startup readiness barrier
fails, app/bootstrap treats startup as failed in the same way: it exposes no facades, fails pending
bridge calls with the typed startup error, runs the startup-failure shutdown path, and disposes the
`ManagedRuntime` before retry. A retry creates a new `ManagedRuntime`; the failed runtime and its
cached context are never reused.

`@svvy/runtime` bootstrap exposes internal readiness services for app/workspace/surface runtime scope
owners. Startup effects that launch watchers, recovery workers, source scans, queue wakeups, or
surface owners run in the runtime scope with the adopted scoped-worker primitive. Production scoped
worker ownership uses `Effect.forkIn(ownerScope)`. `Effect.forkScoped`
is not production-adopted unless the same change promotes it in `packages/effect-adoption-manifest.ts`,
updates package-boundary allowlists, names owner/lifetime policy, and adds focused tests. App
bootstrap exposes no public facade until app readiness is complete. Runtime readiness gates expose
three states: pending, ready, and failed. Calls admitted during pending state either wait in a
bounded gate queue or fail immediately according to the `RuntimeStartupAdmissionPolicy` table in
`runtime.spec.md`. When startup fails, all queued work fails with the same typed startup error and no
queued effect runs.
Workspace/surface runtime scope calls validate
the relevant owner readiness through product-owned `Deferred`, adopted `Ref` / `Semaphore`, or queue
wake coordination with bounded waits and typed failure. `Latch` may be named here only after exact
production promotion. Readiness services record which runtime scope is starting, which API
groups may wait, wait capacity, terminal startup failure, and drain behavior. They never accept
unbounded work. On startup failure they fail waiting calls with the typed startup failure and close
the failed runtime scope. Readiness gates are product/runtime-owned, not inferred from renderer
mount, active workspace, provider event order, first incoming request, or direct startup-worker
races.

Desktop, browser tools, and headless automation facades use the one app-owned `ManagedRuntime`;
they must not create private, app-global, per-window, per-workspace, or per-request runtimes.
One-shot app/process entrypoints that do not expose long-lived JavaScript facades may run a root
Effect program with a platform `runMain` helper only after the corresponding platform runtime
package/subpath is explicitly adopted by this spec, manifests, lockfile, and package-boundary
gates. Local reference examples that use platform runtime helpers are reference material, not
current svvy adoption. Adopted one-shot process roots may model the root application as a scoped root
effect only after the exact layer/process-runner API is installed-export-audited, manifest-adopted,
and allowed by package-boundary gates. That resulting effect must still be executed by an adopted
platform process runner or another app-owned process runner. Layer-to-process helpers are not
themselves JavaScript process runners. Those process roots compose the same package layers once,
provide platform services only at bootstrap, and must not export reusable package-level runtimes.

The owner that creates a `ManagedRuntime` also owns shutdown. A disposed runtime must not be reused;
bridge facades fail closed or are recreated from a new runtime during app restart. Effect marks
future context acquisition on a disposed `ManagedRuntime` as a defect (`Effect.die("ManagedRuntime
disposed")`) rather than a typed failure. Reference:
`docs/references/effect-smol/packages/effect/src/ManagedRuntime.ts`. Svvy bridge/facade code must map disposed-runtime defects
or shutdown interruption into its stable typed shutdown/disposed bridge error and must not rely on
Effect returning a typed failure after disposal.

## Package Roles

### `@svvy/core`

`@svvy/core` may depend on `effect` for public schemas, branded ids, codecs, tagged errors, pure
contract helpers, Effect return types in public port contracts, and data-only cross-package
`Context.Service` tags. Core-owned service tags are contracts only: they export port identifiers,
structural service shapes, schema-backed inputs/results, and tag constants. They never export
implementations, layers, resource acquisition, host path policy, mutable refs, runtime helpers, or
facade helpers.

It owns:

- `Schema` definitions for public input, event, read-model, command fact, and persisted envelope
  contracts.
- Branded id schemas.
- `Schema.TaggedErrorClass` definitions for cross-package domain errors.
- Hoisted decode/encode functions for package boundaries.
- Effect-returning pure validation helpers when the failure channel is useful to callers.

It does not own:

- `Context.Service` implementations.
- `Layer` composition.
- `ManagedRuntime` instances.
- Runtime fibers, queues, streams, database handles, pi sessions, subprocesses, or UI bridges.

### `@svvy/state`

`@svvy/state` exposes Effect services for durable state and transactions.

It owns scoped database handles, migrations, transactional writes, row decoding, read-model
projection, and state-owned implementations/layers for the exact core-owned runtime state ports:
`RuntimeWorkspaceStatePort`, `RuntimeSurfaceLifecycleStatePort`,
`RuntimeComposerDraftStatePort`, `RuntimeQueueStatePort`, `RuntimeTranscriptStatePort`, `RuntimeTurnStatePort`,
`RuntimeCommandStatePort`, `RuntimeApprovalStatePort`,
`RuntimeActorExtensionBindingStatePort`, `RuntimeEpisodeStatePort`, `RuntimeExtensionStatePort`,
`RuntimeExtensionContextImpactStatePort`, `RuntimeGeneratedPackageStatePort`,
`RuntimeArtifactStatePort`, `RuntimePromptDefaultsStatePort`, `RuntimeRecoveryStatePort`,
`RuntimeReadModelStatePort`, `RuntimeRequestStatePort`, `RuntimeSessionWaitStatePort`,
`RuntimeSourceStatePort`, and `RuntimeThreadStatePort`, plus `ExtensionStatePort`,
`ProviderAuthStatusStatePort`, `PiSessionReferencePort`, `SandboxPolicySource`, and
`AppLogWritePort`.

`ProviderAuthPort` and `SecretStorePort` are core-owned host/live service tags supplied by
app/bootstrap host adapters. They return invocation-local credential or secret snapshots only at
trusted boundaries and do not persist product state. Durable provider status, extension env
settings, secret readiness, and user-owned secret mutation commands stay DB/product-state-backed in
`@svvy/state`.

SQLite remains the durable source of truth. Effect `Queue`, `PubSub`, `Ref`, `Deferred`, and
`LayerMap` are not substitutes for persisted queue rows, command facts, request-input rows, app log
rows, or recovery rows.

### `@svvy/sandbox`

`@svvy/sandbox` exposes Effect services for policy snapshot resolution, path checks, launch-policy
construction, native helper lookup, and sandbox-denial classification.

Sandbox effects use one immutable policy snapshot per launch. They do not read mutable state stores
or approval prompts directly.

The public sandbox root is Effect-native: `Sandbox`, root `layer`, and sandbox-owned
input/output/host-support contracts only. It does not expose Promise facades, helper-specific launch
builders, helper argv builders, profile builders, or filesystem-policy construction helpers as
product API. Product launch code reaches sandbox through runtime-owned Effect programs that consume
package-private `RuntimeLaunchPolicyService`, which delegates to `Sandbox.buildLaunchPolicy(...)`;
desktop/app bridge code never calls `Sandbox.buildLaunchPolicy(...)`, sandbox services, helper
argv/path builders, or launch builders for product launch admission. App/bootstrap may compose the
sandbox root layer and use the exact approved app-edge diagnostics surface.
`Sandbox.buildLaunchPolicy(...)` is acquired inside the same runtime command scope that owns the
subprocess lifetime, and returned
`SandboxLaunchFacts` are operation-scoped launch facts. Runtime may persist only the committed
command facts, sandbox snapshot fingerprint/digest facts, and redacted environment receipts named by
core contracts; it does not cache managed helper/profile launch facts beyond the owning command
scope.
When an app-bootstrap Promise adapter must hand scoped launch facts to an existing host-owned
process lane, it returns a closeable handle whose lifetime is explicitly tied to that process lane.
The adapter creates a `Scope`, runs the scoped acquisition with
`Effect.provideService(Scope.Scope, scope)`, returns the facts plus `close()`, and closes the scope
when the process lane finishes, is cancelled, or the adapter is disposed. It must not wrap the
acquisition in `Effect.scoped(...)` and then return the facts to a Promise caller, because Effect v4
closes that scope before the caller can use the resource. Current production usage is the
app-bootstrap internal execute TypeScript launch handle over
`RuntimeAcceptedNativeToolExecution.acquireDirectToolLaunch(...)`; public runtime facades, desktop
bridges, snippets, generated packages, and extension handlers do not receive that handle.

### `@svvy/pi-adapter`

`@svvy/pi-adapter` exposes Effect services and streams for pi session lifecycle and turn execution.

It owns scoped pi session handles, system prompt loading, real user-message delivery, custom tool
registration, pi event normalization, model metadata reads, helper jobs, and pi error conversion.

It must not leak pi-native event types, pi session objects, or pi resource loaders across the
package boundary.

Each live pi session handle, event pump, abort controller, and protocol queue is owned by
`@svvy/pi-adapter` inside an adapter-owned child scope. `@svvy/runtime` owns the durable
surface/session lifecycle and stores only opaque adapter session references plus release or
interruption effects exposed by the `@svvy/pi-adapter` service. Runtime may track runtime-owned
surface scopes with adopted scoped-worker primitives, but it must not store or expose pi-native
handles or treat a fiber/map entry as durable session truth. `LayerMap.Service` remains audit-only
and is not the current mechanism for pi sessions, runtime surface scopes, or workspace runtime
scopes; adopting `effect/LayerMap` for some other keyed resource would not by itself permit pi or
runtime-scope ownership through LayerMap. Pi-native objects remain behind `@svvy/pi-adapter`
service methods and streams.

When `@svvy/pi-adapter` adapts pi promise, event-emitter, callback, or async-iterator APIs into
Effect streams, it owns bridge cleanup. `Effect.tryPromise` thunks forward the Effect-provided
`AbortSignal` to pi or host APIs that support cancellation. Callback/event bridges use
adopted queue-backed stream forms such as `Queue.bounded(...)`, `Queue.offer(...)`,
`Queue.fail(...)`, `Queue.shutdown(...)`, `Stream.fromQueue(...)`, and
`Stream.toAsyncIterableEffect(...)` where owner policy allows them. `Stream.fromAsyncIterable`,
`Stream.callback`, `Stream.fromEventListener`, and direct `Effect.callback` are audit-only or not
production-adopted unless their exact members are adopted in the manifest with owner policy, focused
tests, and package-boundary coverage. After promotion, async-iterator bridges use a typed
`PiAdapterError` mapper and close or return the underlying iterator when the surface scope, turn
scope, abort path, or app runtime closes. Pi turn streams are lossless until runtime has persisted
or explicitly terminalized the corresponding turn and command facts; dropping or sliding buffers are
allowed only for non-authoritative pi diagnostics.

### `@svvy/extensions`

`@svvy/extensions` exposes Effect services for extension registry, actor binding, generated context,
native tool declarations, native tool handlers, `svvyx` dispatch, generated TypeScript facades,
dependency checks, redaction, and instruction generation.

Extension handlers return Effect values. They validate inputs and return closed handler results:
model-facing tool results, extension-owned projection metadata, typed command-fact payloads, and
ordered `ExtensionRuntimeOperation` items wrapping immutable command plans or typed
`RuntimeEffectRequest` values. Runtime owns durable command lifecycle recording, terminal command
facts, subprocess state, queue effects, turn scheduling, notifications, and recovery. Extension
handlers do not record public command lifecycle rows, terminalize commands, own subprocess sessions,
or publish runtime events.

### `@svvy/runtime`

`@svvy/runtime` is the primary Effect orchestration package.

It owns Effect services for workspace runtime scope lifecycle, surface runtime scope lifecycle, prompt
submission, durable queue claiming, in-memory queue wakeups, turn execution, prompt refresh,
handler-thread lifecycle, request-input answer delivery, recovery, title jobs, command tracking,
runtime event publishing, and the exported runtime facade factory. Product app bootstrap owns the
app `ManagedRuntime`, constructs facade instances, and owns their lifetime.

### `@svvy/desktop`

`@svvy/desktop` owns the Electrobun/Svelte app and uses bridge facades produced by product app
bootstrap from the exactly one app-owned `ManagedRuntime` for the healthy app-runtime instance.

Svelte components and renderer projection helpers may stay plain TypeScript. Desktop must not
reimplement runtime lifecycle rules outside Effect services.

### Generated `@svvyx/*` Packages

Generated packages are source artifacts for Workflows source-library code and Smithers workflow
source. They are not Effect service packages.

Generated `@svvyx/*` packages are plain authoring-time TypeScript outputs. They must not import
`effect` directly, expose Effect services or layers, create runtimes, depend on Effect runtime
helpers, or carry service-injection handles. If a generated workflow bridge contract needs
svvy-owned types, `@svvyx/workflows` may use only the exact type-only `@svvy/core` imports named by
`generated-packages.spec.md`; `@svvyx/extensions` imports no `@svvy/core` symbols.

## Package Fit Matrix

Effect usage is package-specific. A construct is adopted only where it makes a concrete product
boundary safer or easier to test.

| Package            | Effect-owned service boundaries                                                                                                           | Primary constructs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Not used for                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@svvy/core`       | schema-backed contracts, branded ids, tagged errors, boundary issue formatting, annotation allowlist helpers, data-only port service tags | `Effect` in port method types, `Schema`, `Schema.TaggedErrorClass`, `Schema.Redacted` for schema-level redacted payload fields, branded schemas, hoisted decoders/encoders, explicitly indexed pure validators, `Context.Service` tags for cross-package ports, `Exit`/`SchemaIssue` boundary issue helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | service implementations, layers, state, streams, queues, subprocesses, pi sessions, desktop bridges, open-ended utility/helper categories                     |
| `@svvy/state`      | SQLite store, transactions, read-model selectors, secret/artifact ports, after-commit invalidation descriptor collection                  | `Context.Service`, `Layer`, `Scope`, `Schema`, adopted `DateTime.now` / `DateTime.formatIso` or explicit injected timestamp inputs, `Cause`/`Exit` for facade error normalization, injected `FileSystem`/`Path` only for DB setup, migrations, and state-owned fingerprints. Artifact byte staging, copy, rename, stat, delete, and digest are runtime-owned file-materialization work outside state. Direct `Clock` value imports are not production-adopted unless exact members are promoted in the adoption manifest and tests.                                                                                                                                                                                                                                                                                                                                    | Effect SQL, queue delivery policy, pi turns, command subprocess execution, runtime event fanout, extension source ownership                                   |
| `@svvy/sandbox`    | immutable policy resolution, pure snapshot path checks, effectful path resolution, scoped launch-policy construction, denial parsing      | `Context.Service`, `Layer`, `Scope`, `FileSystem`, `Path`, `Schema`, `Effect.acquireRelease` for sandbox-owned scoped artifacts such as temporary profiles or helper lookup resources                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | approvals, command lifecycle, subprocess ownership, state reads outside the provided policy source                                                            |
| `@svvy/pi-adapter` | scoped pi session handles, real `systemPrompt`, turn streams, model metadata, helper jobs                                                 | `Context.Service`, `Layer`, `Scope`, `Stream`, `Effect.acquireRelease`, `Effect.acquireUseRelease`, typed errors; `FiberMap`, `FiberSet`, and `ScopedRef` only after exact manifest promotion with owner/lifetime tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | prompt composition, extension semantics, queue claiming, command fact storage, Effect AI model calls, keyed runtime-scope ownership                           |
| `@svvy/extensions` | extension registry, source edits, generated context, handlers, `svvyx`, generated packages                                                | `Context.Service`, `Layer`, `Schema`, `FileSystem`, `Path`, `Crypto`, `DateTime`, immutable command plan data, type-only `Redacted` handler contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | turn scheduling, durable queue claiming, desktop panes, raw state tables, arbitrary event publication                                                         |
| `@svvy/runtime`    | prompt submission, queue dispatch services, turn execution, runtime event stream, recovery, runtime service plus exported facade factory  | Adopted runtime constructs: `Context.Service`, `Layer`, `Scope`, `Stream` only for exact adopted members, `Queue`, `Deferred`, `Ref`, `Semaphore`, `Fiber.join`, `Fiber.interrupt`, `Schedule`, adopted `DateTime` members, adopted `Effect.clockWith(...)` callsites, `Config`, `Option`, and `SchemaIssue`; abstract `Crypto`/`FileSystem`/`Path` service tags may be provided through the runtime layer graph, but runtime-owned service-instance calls require exact `adoptedEffectInstanceMemberPolicies` rows before production use. Non-adopted live-runtime constructs such as direct `effect/Clock` value imports, `SynchronizedRef`, `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`, `PubSub`, `LayerMap`, and non-adopted `Stream` constructors require exact manifest promotion, boundary allowlist updates, and owner tests before production import. | durable storage implementation, pi-native objects, extension record definitions, UI rendering, Smithers workflow graph execution, Smithers workflow/run state |
| `@svvy/desktop`    | renderer/app-shell code that consumes renderer-safe runtime/state command/read facades injected by app/bootstrap                          | renderer-safe facade types, core schema codecs at IPC/RPC boundaries, UI cancellation/request metadata contracts; desktop does not import `effect` directly under the adopted package architecture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | runtime policy, bridge adapter ownership over `ManagedRuntime`, queue claiming, state mutation rules, pi event adaptation, Svelte stores as durable state     |

This matrix is normative. Package specs may add narrower services inside their owner package, but
they must not move an Effect responsibility into a package listed as “not used for” without first
updating the PRD, feature inventory, and this architecture spec.

The `@svvy/runtime` Smithers exclusion means runtime is not the Smithers workflow engine and does
not own Smithers workflow/run state. Runtime still owns the narrow authenticated `runTaskAgent`
bridge, workflow-task surface lifecycle, queueing into pi-backed task-agent turns, generated context
binding for those turns, and pi-adapter delivery handoff around the task-agent result.

## Agentic Flow Effect Contract

The main agentic flow is one Effect-owned runtime program exposed through facades. Each step below
names the owner, durable source of truth, allowed process-local Effect constructs, and public
boundary. Implementation that puts the same behavior in a different owner is incomplete even when it
passes local tests.

| Flow step                    | Owner service                                                                  | Durable/file-backed truth                                                                                                                                               | Effect constructs                                                                                                                                                                                                                                                                                                                                                             | Boundary contract                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Message admission            | `@svvy/runtime` `Runtime.messages.submit(...)`                                 | DB/product-state-backed queue row, submitted message row, surface state, and generated-context binding facts written through state ports                                | `Effect.fn`, hoisted schema decoders, state-port effects, `DateTime` for committed timestamps; direct `effect/Clock` value imports are not production-adopted unless manifest promotion exists                                                                                                                                                                                | Promise facade accepts only `SubmitMessageInput`, delivery intent, and optional client metadata; it does not accept pi messages, prompt text, renderer snapshots, or raw runtime-effect envelopes                                                                         |
| After-commit notification    | `@svvy/state` returns descriptors; `@svvy/runtime` publishes                   | Committed state mutation result `afterCommit` descriptors                                                                                                               | `StateMutationResult<T>`, scoped runtime event bus, replay ring, per-subscriber `Queue`, `Stream`                                                                                                                                                                                                                                                                             | Events are typed invalidation notifications; consumers refetch read models from state                                                                                                                                                                                     |
| Queue wake and claim         | `@svvy/runtime` surface/workspace runtime scope owners                         | DB/product-state-backed queue rows, leases, retries, terminal facts, recovery rows                                                                                      | Process-local `Queue` only for wake hints, `Ref` for current in-memory coalescing/wait state, `Semaphore`/prompt lock, scoped fibers, `Schedule` for recovery scans; `SynchronizedRef` is not production-adopted unless manifest promotion exists                                                                                                                             | Queue ordering, claim, retry, terminalization, and recovery are persisted state-port effects; in-memory wakeups are rebuildable hints                                                                                                                                     |
| Pre-dispatch prompt refresh  | `@svvy/runtime` coordinates; `@svvy/extensions` builds; `@svvy/state` persists | Extension/workflow/external-instruction source files plus DB generated-context facts and surface binding facts                                                          | source-owner service effects, `FileSystem`, `Path`, `Crypto`, state-port mutation results, `DateTime` for committed timestamps; direct `effect/Clock` value imports are not production-adopted unless manifest promotion exists                                                                                                                                               | Runtime refreshes only at safe pre-dispatch boundaries; UI and callers never submit prompt text outside the committed generated-context/prompt-dispatch contract                                                                                                          |
| Pi turn                      | `@svvy/pi-adapter`, called by `@svvy/runtime`                                  | pi transcript/history in pi plus persisted opaque pi session refs in state                                                                                              | scoped session/turn child scopes, `Stream<PiRuntimeEvent, PiAdapterError>`, `Effect.tryPromise` adapters with cleanup, `AbortSignal` forwarding, and direct `Effect.callback` only after manifest promotion                                                                                                                                                                   | Adapter loads true pi `systemPrompt`, sends one real user message, disables ambient pi resources, and emits pi-normalized events; it exposes no pi-native handles                                                                                                         |
| Accepted tool call           | `@svvy/runtime` command/tool lane plus `@svvy/extensions` handler lookup       | DB command rows, streamed argument snapshots, command events, terminal command facts                                                                                    | `Effect.fn`, typed handler effects, redaction effects, state-port mutation results                                                                                                                                                                                                                                                                                            | Extension handler receives only a decoded invocation for a tool that was declared for the active actor binding and returns one model-facing result plus ordered `ExtensionRuntimeOperation` items                                                                         |
| `runtime_effect` operation   | `@svvy/runtime` operation applier                                              | The state rows or file/package evidence named by the closed request kind                                                                                                | ordered effect lane, state-port mutation results, service calls to state/extensions/pi/sandbox as required by the request kind                                                                                                                                                                                                                                                | Only runtime applies `RuntimeEffectRequest` values. Public facades do not accept them. Extensions do not write state or publish events directly                                                                                                                           |
| `execution_plan` operation   | `@svvy/runtime` command/process/file/approval lanes                            | DB command facts, approval rows, artifact rows/files, sandbox launch facts, child-command facts                                                                         | `Sandbox.buildLaunchPolicy(...)`, runtime-owned command launch adapters, scoped command/session resources, bounded stdout/stderr streams, stdin queues, and `Schedule` for bounded retries/timeouts; `ChildProcessSpawner.ChildProcessSpawner` is candidate-only until an owning architecture change updates the manifest, boundary allowlists, host spawner layer, and tests | Runtime owns approval, sandbox, subprocess, file, stdin, artifact, and child-command lifecycle. Extension plans are immutable data                                                                                                                                        |
| Request-input wait           | `@svvy/runtime` request-input lifecycle                                        | DB request/question/option/answer/deadline/wait facts                                                                                                                   | `Deferred`, scoped wait registry, `Effect.timeoutOrElse` or `Effect.sleep` with `Duration`, `Effect.clockWith(...)` for injected-clock comparisons against persisted deadlines, state-port mutation results; direct `effect/Clock` value imports are not production-adopted unless manifest promotion exists                                                                  | Blocking waits resolve from committed answers or committed timeout defaulting. Nonblocking answers are delivered by queued follow-up rows, and queued-answer wake targets come from committed state-port answer handoff data rather than a post-answer request-input read |
| Runtime events               | `@svvy/runtime` event service                                                  | Durable read-model truth is DB/product-state-backed; runtime event generation/sequence and live fanout are runtime-owned delivery metadata, not persisted product state | app-scoped replay ring, bounded per-subscriber `Queue.dropping(capacity)`, `Queue.offer(...)` returning `false` as the overflow signal that closes the subscriber with rebaseline, `Stream`, rebaseline errors, scoped subscription finalizers                                                                                                                                | Event payloads are notifications/patches, not durable read models. Slow or overflowed matching subscribers close with a typed rebaseline result, and recovery uses persisted state facts rather than event-stream replay                                                  |
| Desktop/headless consumption | `@svvy/desktop` and alternate app edges                                        | State read models and runtime facade calls                                                                                                                              | app/bootstrap-owned bridge scopes and runtime-owned closeable subscription adapters; browser-tool, headless, and non-UI framework edges may receive `AsyncIterable` adapters, while desktop receives renderer-safe Electrobun callback/event notifications                                                                                                                    | UI renders by calling facades and refetching state. It owns no queue, prompt, pi, command, recovery, generated-package, or state mutation policy                                                                                                                          |

Runtime event fanout does not use an Effect `PubSub` as the authoritative replay or sequencing
surface. The event bus owns one app-scoped sequence counter and replay ring, writes each retained
event into that ring before fanout, and then delivers matching live events into bounded
per-subscriber `Queue`s exposed as scoped `Stream`s. A `PubSub` may be used only as an internal wake
or broadcast primitive behind that authority if the owning implementation still preserves the
replay-before-fanout, per-subscriber overflow, close receipt, and rebaseline semantics above.
Effect `PubSub`/`Queue` replay is process-local memory only; late-subscriber replay after app restart
is never inferred from those primitives. Restart recovery and read-model rebaseline always come from
DB/product-state-backed facts plus source/file fingerprints.

Every flow step with a durable write must return or collect `StateMutationResult<T>` from the
state-owned port that performed the write, publish runtime notifications only after the write
commits, and expose a focused test proving that a failed write publishes nothing. When post-commit
behavior depends on the contents of the write, the state-port committed `value` must carry the exact
handoff data the owner service needs; owner services must not issue a second state read after commit
only to reconstruct that data. Every flow step with a long-lived process-local resource must name
its owner scope, finalizer, readiness receipt, interruption behavior, and deterministic test layer in
the owning package spec before promotion. Every flow step that crosses a non-Effect boundary must
use a facade or adapter named in the owning package spec; ordinary package code must stay
Effect-native.

Runtime command sessions use a runtime-owned host process port supplied by app/bootstrap unless an
architecture change promotes `ChildProcessSpawner.ChildProcessSpawner` for this lane. That port is a primitive
launch/kill/stdin/stdout/stderr adapter behind `RuntimeCommandSessionService`; it does not own
command admission, approval, sandbox policy, durable command facts, stdin receipts, output
projection, cancellation semantics, or recovery. `ChildProcessSpawner` remains forbidden in
production imports until the same architecture patch names the owning command/session service,
exact import members, Bun provider layer, environment policy, fake spawner test layer, package
boundary allowlists, and the command-session port boundary being superseded.

## Required And Allowed Effect v4 Constructs

Use these constructs:

### Module Decisions Index

This index is the first stop when choosing an Effect primitive. The detailed rules below remain
normative; this table summarizes ownership and the hard product boundary for each module family.

| Module family                                                           | Adoption decision                                                                                                   | Primary svvy owner/use                                                                                                                                                                                                                                                                                                                                                                                              | Hard boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Effect`, `Context`, `Layer`, `Scope`, `Exit`, `Cause`, `Option`        | Member-gated adoption                                                                                               | All non-UI implementation packages for typed effects, services, layers, scopes, exits, causes, and options                                                                                                                                                                                                                                                                                                          | Public boundary errors use core-owned `Schema.TaggedErrorClass` shapes; production value reads require exact manifest rows; package code does not expose raw host errors, unchecked thrown values, or ad hoc service objects                                                                                                                                                                                                                                                                                                              |
| `Data`, `Equal`, `Hash`, `Result`, `Struct`, `LogLevel`                 | Adoptable-member-gated audited modules                                                                              | Candidate process-local data helpers, equality/hash helpers, result helpers, object projection helpers, and log-level enumeration only after exact member promotion                                                                                                                                                                                                                                                 | Installed-export audit is not production permission. No production value reads are allowed until the exact member is promoted into `adoptedEffectRuntimeModuleExports`, the owning package/spec text names the product reason, package-boundary gates allow the exact import/member, and focused tests cover the use. Audit coverage for `Data.Class`, `Data.Error`, `Data.TaggedClass`, `Data.TaggedError`, `Data.taggedEnum`, `Equal.*`, `Hash.*`, `Result.*`, `Struct.*`, or `LogLevel.values` is not production permission by itself. |
| `ManagedRuntime`                                                        | Adopted only at app/process/facade edges                                                                            | App bootstrap creates one app-owned runtime; facade factories receive a caller-owned runtime                                                                                                                                                                                                                                                                                                                        | No package-level runtime singletons, no per-request runtimes, no ordinary service tests using runtime runners                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Schema`, `SchemaIssue`                                                 | Member-gated adoption                                                                                               | `@svvy/core` contracts and generated declaration/schema emission                                                                                                                                                                                                                                                                                                                                                    | Product contracts are schema-first; emitted JSON Schema is generated output, not the source of truth; production value reads require exact manifest rows                                                                                                                                                                                                                                                                                                                                                                                  |
| `JsonSchema`                                                            | Installed-export audited only until exact production promotion                                                      | Candidate schema/declaration emitter support after exact production rows are added for the owning emitter service                                                                                                                                                                                                                                                                                                   | No production value reads until exact manifest rows, owner policy, boundary allowlists, and focused tests exist                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Redacted`, `Encoding`                                                  | Member-gated target adoption                                                                                        | Candidate process-local secret values, digest/token encoding, generated schema-safe encodings after exact value members are adopted                                                                                                                                                                                                                                                                                 | Redacted values never persist or cross JSON/product boundaries as secret values; production value reads require exact manifest rows; package code must not hand-roll encodings after the relevant `Encoding` members are promoted                                                                                                                                                                                                                                                                                                         |
| `Clock`, `DateTime`, `Random`                                           | Strict, manifest-gated adoption                                                                                     | Service-supplied time and deterministic non-security randomness in tests/jitter; production use is limited to the exact members listed in `packages/effect-adoption-manifest.ts`                                                                                                                                                                                                                                    | No direct `Math.random`, host `new Date()` in package behavior, or `Random` for secrets/ids/digests; installed-export audit rows are evidence only, not production permission                                                                                                                                                                                                                                                                                                                                                             |
| `Queue`, `Stream`                                                       | Production-adopted for process-local delivery by exact member                                                       | Runtime wake hints, live notification fanout, pi/command/bridge streams, and scoped stream adapters, limited to the production member rows in `packages/effect-adoption-manifest.ts`; `Queue.shutdown(...)` is production-adopted for scoped teardown; `Queue.fail(...)` is production-adopted only for `packages/pi-adapter/src/pi-adapter.ts`; unlisted queue failure or terminal members require exact promotion | Not durable queues, transcripts, read models, app logs, command facts, generated-package facts, or recovery ledgers; audit-only helpers such as callback/listener/async-iterable stream constructors are not production permission without manifest adoption, owner policy, and focused tests                                                                                                                                                                                                                                             |
| `PubSub`, `Take`, `Sink`, `Channel`                                     | Installed/audit-only until exact promotion                                                                          | Candidate package-local fanout, failing stream protocols, finite stream reductions, and protocol/framing machinery only after the owning spec and manifest promote exact production members                                                                                                                                                                                                                         | No production imports or value reads until the same change adds exact manifest rows, package-boundary allowlists, and an owner record naming service, source globs, scope owner, capacity/backpressure behavior, close/interruption behavior, slow-subscriber behavior where applicable, failure protocol, and deterministic tests for publish, subscribe, close, interruption, and overflow                                                                                                                                              |
| `Deferred`, `Latch`, `Semaphore`, `Ref`, `SynchronizedRef`, `ScopedRef` | Mixed: production-adopted only for exact member rows                                                                | Readiness gates, request-input waits, prompt locks, mutable live flags, replaceable scoped handles, limited to the production member rows in `packages/effect-adoption-manifest.ts`; production-adopted rows cover `Deferred`, `Ref`, and `Semaphore` only                                                                                                                                                          | Not persisted state or restartable truth; every long-lived owner names scope, finalizer, duplicate-completion behavior, and tests; installed-export audit rows for `Latch`, `SynchronizedRef`, and `ScopedRef` are not production permission                                                                                                                                                                                                                                                                                              |
| `Fiber`, `FiberHandle`, `FiberMap`, `FiberSet`                          | `Fiber.join` / `Fiber.interrupt` source-gated for runtime active prompts; handle/map/set modules remain conditional | `@svvy/runtime` retains the one actual detached prompt fiber in its surface scope, joins that same execution for queue drain, and interrupts it during forced shutdown; keyed/replacing worker handles remain targets only after separate exact promotion                                                                                                                                                           | Fiber identity is process-local and never product authority. The retained prompt fiber is installed before its start gate opens, cleared exactly once, and paired with durable turn recovery. No public fiber handles, renderer payloads, durable fiber ids, readiness inferred from fiber presence, or blanket permission for `FiberHandle`, `FiberMap`, or `FiberSet`.                                                                                                                                                                  |
| `LayerMap`                                                              | Not adopted for production code                                                                                     | Production imports are forbidden unless `effect/LayerMap` has a complete owner record, manifest entry, package-boundary allowlist, and focused tests                                                                                                                                                                                                                                                                | Installed-export evidence is not production adoption; no product ownership registry, durable fact, read model, readiness signal, or subscription contract is inferred from map presence                                                                                                                                                                                                                                                                                                                                                   |
| `Schedule`, `Duration`, `TestClock`                                     | Strict production member adoption for `Schedule`/`Duration`; test-only Effect-lane adoption for `TestClock`         | Retry/backoff, recovery cadence, timeout policies, and deterministic Effect tests; production use is limited to exact manifest rows for `Duration.millis(...)`, `Duration.min(...)`, `Schedule.exponential`, and `Schedule.modifyDelay`; `TestClock` is test-only and confined to `packages/**/*.effect.test.ts`                                                                                                    | Public/persisted contracts use finite schema-checked milliseconds or a named string schema, not raw `Duration`; any additional `Schedule` recipe remains unavailable in production unless exact members are added to the production manifest with owner/tests                                                                                                                                                                                                                                                                             |

Local `t3code` examples that use `Schedule.spaced`, `Schedule.take`, `Schedule.recurs`,
`Schedule.addDelay`, `Schedule.forever`, or similar helpers are reference-only for svvy until exact
installed-export/adoption rows, owner policy, package-boundary allowlists, and focused tests exist.
Current svvy production schedule adoption remains limited to the manifest-listed members.
| `FileSystem`, `Path` | Strict service-member adoption | Production use is limited to exact service-instance policy rows. `@svvy/sandbox` owns sandbox/helper path checks using the exact `FileSystem.FileSystem` and `Path.Path` members named in `packages/effect-adoption-manifest.ts`. `@svvy/extensions` owns source-edit file inspection, text reads, atomic saves, source-root path construction, generated-package source discovery, evidence reads, app-owned generated-package atomic replacement, and workspace-link parent-path planning using the exact extension rows. Artifact file work and additional source/workflow operations require separate owner rows before production use. | Domain packages do not import concrete platform modules. Abstract `FileSystem`/`Path` services are not blanket permission for source, generated-package, artifact, or workflow file operations; each package must add exact members, owner globs, focused tests, and package-boundary expectations before use |
| `PlatformError` | Installed-export audited only until exact production promotion | Candidate platform error classification for file/path/platform adapters | No production value reads until exact manifest rows, owner policy, boundary allowlists, and focused tests exist |
| `Crypto` | Strict service-member adoption | Production use is limited to exact service-instance policy rows. `@svvy/sandbox` owns `Crypto.Crypto.digest` for generated Seatbelt profile and packaged helper material. `@svvy/extensions` owns `Crypto.Crypto.digest` for source-version fingerprints and `Crypto.Crypto.randomUUIDv4` for source-edit atomic temp filenames. `@svvy/runtime` owns `Crypto.Crypto.digest` only in `runtime-workflow-agent-source-index.ts` for the deterministic, timestamp-independent fingerprint over sorted admitted observations and diagnostics. Secure random bytes, UUIDv7 id generation, artifact/generated-package digests, tokens, and other fingerprints require separate owner rows before production use. | Domain packages do not import host crypto directly. Abstract `Crypto` is not blanket permission for ids, tokens, signing, HMAC, fingerprints, or generated-package/artifact digests; each use must add exact members, owner globs, focused tests, and package-boundary expectations before use |
| `ChildProcess`, `ChildProcessSpawner` | Conditional installed-export canary | Candidate backing for runtime-owned durable command sessions, sandbox launch execution, and extension-owned bounded source/build/readiness helpers after an owning architecture change promotes the exact members | No production import until the owning change adds exact manifest rows, package-boundary allowlists, host adapter layer, and fake-spawner behavior tests |
| `HttpClient` family | Not adopted | Provider/OAuth/metadata probes are allowed only behind an app-owned network-policy wrapper after exact adoption | `HttpClient` family means exact imports matching `effect/unstable/http/*`, `@effect/platform*/HttpClient*`, and any `HttpClient` value member read. All are forbidden in production until an adoption row names the exact import specifier, member reads, owner adapter, network-policy source, redaction mapping, timeout/retry limits, body-size limits, and tests. |
| `SqlClient` / `SqlSchema` / `Migrator` family | Not adopted | None in the active architecture | SQLite truth stays state-owned through package-private `@svvy/state` repositories; no production import of `effect/unstable/sql/*` or `@effect/sql-sqlite-*` without a PRD, feature inventory, state spec, Effect spec, manifest, lockfile, and boundary-test update in one architecture change |
| `Config`, `ConfigProvider`, `Logger`, `Metric`, `Tracer` | Mixed: config partially adopted, observability non-adopted | App/bootstrap config provisioning and svvy-owned observability helpers. Production-adopted rows cover only the exact config members in the manifest; observability modules are installed-export audit until a package adds exact production metric/logger/tracer rows and tests | Reusable services receive explicit inputs/services; logs/spans/metrics use closed metadata and never include prompts, file contents, secrets, or provider payloads |
| `Request`, `RequestResolver`, `Cache`, `ScopedCache`, `Resource`, `Pool`, `RcMap`, `RcRef` | Not adopted for production code | Production imports are forbidden unless the same architecture change adds exact production manifest rows, package-boundary allowlists, owner package/spec record, and focused tests. Optional resource/cache modules may be adopted only for one named product operation. The adoption record names key schema, maximum entries or handles, TTL or explicit no-TTL rationale, invalidation trigger, release finalizer, stale-read behavior, failure mapping, and tests proving the value is not used as durable state, readiness, ordering, or authorization truth | Never state truth, generated-context readiness, source fingerprints, command facts, read models, app logs, recovery rows, queue ordering, authorization truth, or readiness truth |
| `ExecutionPlan`, `Effect.withExecutionPlan`, `Stream.withExecutionPlan` | Not adopted as product execution-plan contract | Only after PRD, feature inventory, this spec, and the owning package spec name exact package, owner, input/output contract, and why `@svvy/core` `ExtensionExecutionPlan` cannot model the work | Never use Effect `ExecutionPlan` as generated-extension protocol, runtime command plan data, persisted state, prompt-facing contract, or replacement for `@svvy/core` `ExtensionExecutionPlan` |
| `JsonPatch`, `Tx*`, `unstable/*` product frameworks | Not adopted by default | Only after PRD, feature inventory, this spec, owning package spec, exact production manifest rows, package-boundary allowlists, and focused tests name exact product scope | No implicit replacement for Apply Patch, state transactions, runtime events, workflows, RPC, MCP, cluster, persistence, browser platform, or UI architecture |
| `SubscriptionRef` | Installed-export-audited; not production-adopted | Candidate low-cardinality, process-local status snapshots where late subscribers need the current value plus future status changes, only after the owning package adds exact manifest rows, package-boundary allowlists, owner policy, and focused tests; installed-export canaries for `set`, `update`, and `modify` are audit evidence only | Never runtime events, command output, queue delivery, durable replay, read models, app logs, high-rate streams, or backpressured fanout; production promotion must define snapshot owner, mutation authority, scope, late-subscriber semantics, and tests |

Additional module-level policy:

- `effect/Fiber` value imports are production-adopted only for source-gated `join` and `interrupt`
  calls in the runtime surface queue dispatcher and surface scope service. They operate on the one
  actual active prompt fiber installed before prompt execution starts, so queue joins cannot rerun a
  cold Effect and forced shutdown can signal that execution before durable recovery. Effect-lane
  tests may use the same two members for lifecycle fixtures. Other Fiber members and every
  `FiberHandle`, `FiberMap`, or `FiberSet` production import remain conditional.
- `effect/Encoding` is installed-verified design vocabulary for hex, base64, and base64url
  encoding/decoding of digests, fingerprints, tokens, and compact binary identifiers. It is not
  production permission until exact `effect/Encoding` value members are added to
  `packages/effect-adoption-manifest.ts` with owner policy and focused tests. After adoption,
  decoding failures map immediately to package tagged errors, and package code must not hand-roll
  covered encodings with `Buffer`, `atob`, `btoa`, or ad hoc byte/string helpers.
  `Encoding.EncodingError` values are normalized before crossing package, persistence, RPC,
  command-fact, runtime-event, app-log, read-model, transcript, artifact, generated-declaration, or
  tool-output boundaries. The normalized error drops the raw `input` field by default and records
  only operation, expected encoding, input classification, and redacted issue text. This is
  mandatory for tokens, secret refs, fingerprints, hashes, signed payloads, and bridge credentials.
  Canonical encodings are package-owned and schema-declared: new SHA-256 digests and source/artifact
  fingerprints use lowercase hex with an explicit algorithm field or `sha256:<hex>` prefix when the
  value leaves one table; opaque random tokens and URL/id-safe byte strings use unpadded Base64Url;
  ordinary Base64 is used only for non-URL binary payload fields whose schema names Base64.
  Structured hash inputs are canonicalized by the owner before digesting: UTF-8 bytes, stable object
  key ordering, deterministic array order, normalized newlines for text sources when specified by
  the source owner, normalized path representation when paths are part of the identity, and a
  domain/version prefix such as `svvy.generated-context.v1\0`. SHA-256 is the default for new
  fingerprints and digests. SHA-1 is forbidden except for a named interoperability case that cannot
  affect security decisions. Raw SHA of a secret is forbidden; public secret fingerprints use a
  package-owned keyed HMAC/fingerprint service with domain separation, truncation length, rotation
  behavior, and tests named by the owning package spec.
- `effect/Request` and `effect/RequestResolver` remain reference-only batching machinery until a
  package spec names the exact resolver owner and request identity. A production resolver adoption
  record must define the request class/tag, deduplication key, delay/batch window, maximum batch
  size, cache capacity or TTL if `withCache`/`asCache` is used, invalidation owner, resolver
  completion and partial-failure behavior, span/annotation policy, shutdown behavior, and fake
  resolver tests. They must not batch durable queue claims, state transactions, command facts,
  generated-context readiness, runtime event replay, or recovery rows. References:
  `docs/references/effect-smol/ai-docs/src/05_batching/10_request-resolver.ts` and
  `docs/references/effect-smol/packages/effect/src/RequestResolver.ts`.
- `effect/Cache`, `effect/ScopedCache`, `effect/Resource`, `effect/Pool`, `effect/RcMap`, and
  `effect/RcRef` remain reference-only live-resource/cache primitives until the owner package spec
  names the exact key type, capacity, TTL, release/finalizer behavior, invalidation path, stale
  value semantics, and tests. They must not become public read-model caches, state mirrors,
  generated-package fact storage, extension readiness truth, prompt-binding truth, or hidden
  work-queue schedulers. A cache miss may trigger only the package-owned effect named by the
  adoption record, and callers must still recover from stale, missing, failed, or interrupted cache
  entries through the owning package's normal typed errors.
- Public ids and public persisted brands are defined through `Schema.brand(...)` on the owning
  schema. Direct `effect/Brand` helpers are allowed only behind schema-backed construction inside
  `@svvy/core`; exported ids do not use bare `Brand.nominal` surfaces. `effect/Newtype` and
  `effect/PrimaryKey` are not adopted for public contracts. Their use in public contracts requires
  the PRD, feature inventory, and owning package spec to name the product reason and
  code-generation impact.
- `Duration` values are process-local Effect inputs. Public, persisted, renderer, generated, and
  config contracts encode finite positive or finite non-negative milliseconds with schema checks, or
  a named ISO/string duration schema if explicitly specified. Do not persist `Duration`, accept
  infinite/negative durations, or accept free-form duration strings at product boundaries.
- `effect/PartitionedSemaphore` is not a default concurrency primitive. Adopt it only with an owning
  package spec that names the partition key, fairness requirement, queueing behavior, and tests.
  Ordinary keyed concurrency uses a small product-owned keyed semaphore/ref service when needed.
- A general `effect/Mailbox` primitive is not adopted for runtime queues, command streams, event
  buses, or state-backed delivery. Effect v4 does not provide a stable general mailbox module for
  this architecture; mailbox-like helpers appear only as specific APIs such as
  `SqlClient.reactiveMailbox`, persistence queues, or cluster mailboxes, and those are not product
  primitives. Use explicit `Queue`, `PubSub`, `Stream`, state tables, and runtime-owned replay rings
  named by the owning package spec.
- `Deferred` completion booleans are checked. If `Deferred.succeed` or `Deferred.fail` returns
  `false`, the implementation either proves the duplicate completion is benign in that method's
  contract or records a typed diagnostic. Code must not silently ignore a failed completion for
  request-input waits, prompt turns, queue handoff, or facade readiness.
- `Config` is app/bootstrap/test provisioning only. Reusable package services receive decoded config
  through explicit services or layer inputs and do not read a default `ConfigProvider`. `Config.redacted`
  is for process config values, not provider tokens, extension env, or secret-store payloads; product
  secrets flow through `SecretStorePort` and redacted invocation values.
- Effect `Crypto.Crypto` is not a signing or HMAC service in the checked-in v4 reference. The
  installed service exposes candidate operations for random values, UUIDs, and SHA digests, but
  production calls are limited to the exact `adoptedEffectInstanceMemberPolicies` rows that name the
  owning package, source glob, member, and tests. Package code must not imply that `Crypto` alone
  signs `svvyx` child-adapter payloads, bridge results, or loopback requests. Any signed
  child/bridge payload scheme uses a separate package-owned signing service whose host crypto
  backend, key ownership, rotation, redaction, verification failure shape, and tests are named in
  the owning package spec before use. The signed `svvyx` subprocess result path uses an HMAC-SHA256
  signer/verifier service owned by the runtime command-session boundary; that service may depend on
  a host crypto backend through app/bootstrap, but reusable package code does not call `node:crypto`,
  Bun crypto globals, WebCrypto globals, or non-adopted Effect `Crypto` members as if they were the
  signing policy.
  Transport schemes that use only bearer-token lineage and schema validation must be described as
  authenticated or authorized transport, not signed transport.
- Digest and token helpers are package-owned services over `Crypto.Crypto`, not repeated call-site
  recipes. Source, artifact, generated-package, and migration digests use the package-owned digest
  helper and encode through the schema-declared format, normally lowercase SHA-256 hex with an
  explicit algorithm field or prefix when the value leaves a single table. Bearer tokens,
  idempotency keys, and command-scoped bridge tokens use a package-owned token helper backed by
  the yielded `Crypto.Crypto` service instance only after the exact receiver methods are promoted in
  `adoptedEffectInstanceMemberPolicies` with owner globs and focused tests. Token helper
  implementations may use `crypto.randomBytes(size)` and id helper implementations may use the yielded service's
  `randomUUIDv4` / `randomUUIDv7` effects only through the owning package service. UUID ordering is
  never a durable sequencing guarantee. New product ids use the id family named by `@svvy/core` and
  are allocated only by the state/runtime/package owner that commits the corresponding row. Ids that
  need sortable display order still store explicit committed timestamps or sequence numbers; they do
  not rely on UUIDv7 monotonicity or database lexical ordering. `Crypto.randomUUIDv7` may include
  host-clock time internally, so tests must not treat it as the source of persisted product time.
  Security material uses effectful `randomBytes` or UUID methods behind an owner service. Unsafe
  random helpers are allowed only inside the crypto implementation, deterministic tests, or a named
  non-security sampling path; never for ids, tokens, secrets, approvals, bridge credentials, or
  idempotency keys. `Crypto.Crypto` itself is the Effect service tag, not the method container.
  Tests provide deterministic `Crypto.Crypto` layers for package services that consume Effect crypto
  directly, and deterministic explicit digest helpers for `@svvy/state` structured-session and
  sandbox digest paths. They prove encoded shape, redaction, uniqueness handling, and failure
  mapping. Digest, random, UUID, encoding, and
  fingerprint failures map to the owning package's typed error and fail closed before artifact
  writes, source fingerprint commits, generated-package promotion, command facts, bridge
  authorization, or id allocation proceeds.
- `Redacted` values may exist only in trusted process memory. Boundary schemas for redacted values
  use non-JSON encodable forms or explicit status/reference payloads; read models, logs, app-log
  entries, generated packages, and durable rows do not encode raw redacted values.
- Log/span/metric annotations go through `svvy` helper functions with a closed metadata vocabulary.
  Package code does not emit unbounded user prompts, file contents, secret material, generated
  source, or provider payloads as annotations. OTLP/exporter layers are app/bootstrap concerns only.
- Digest and token helpers depend on package-owned services backed by `Crypto.Crypto`, except
  synchronous `@svvy/state` structured-session and sandbox digest work, which consumes an explicit
  `StateDigestHelper` supplied by app/bootstrap or tests. Signing and HMAC helpers depend on a
  separate package-owned signer/verifier service with an explicitly named host crypto backend
  supplied by app/bootstrap; they are not backed by `Crypto.Crypto` unless exact Effect HMAC/signing
  APIs are adopted in this spec, manifests, and tests. The Bun/Electrobun live provider
  for adopted digest/token helpers is
  `@effect/platform-bun/BunCrypto.layer` supplied only by app/bootstrap through
  `layerRuntimeBunPlatform`. Reusable packages import only `effect/Crypto` and depend on the
  abstract service. `BunServices` is not the crypto contract for reusable packages, and no reusable
  package may call `node:crypto`, Bun crypto globals, WebCrypto globals, or `BunCrypto.layer`
  directly. A new crypto-backed behavior still needs its owning package spec to
  name value ownership, byte lengths or digest algorithm, encoding, redaction, failure mapping, and
  deterministic test layer before production use.
- `ErrorReporter` is not a package-level dependency. It may be adopted only at app/bootstrap or
  process entrypoints with a spec naming reporting sinks, redaction, and shutdown behavior.
- Runtime facade readiness gates are part of the public contract. Facade tests prove queued calls do
  not run before readiness, failed readiness rejects queued calls without executing domain work, and
  every readiness queue names capacity and overflow behavior.

The construct table below is constrained by `packages/effect-adoption-manifest.ts`. A row may name an
installed or target Effect member for design vocabulary, but production permission exists only for
the exact manifest member, owning package policy, boundary allowlist, and focused tests. In
particular, production use must not treat `Effect.forkScoped`, `SynchronizedRef`,
`SubscriptionRef`, `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`, `LayerMap`,
`Config.redacted`, or unmanifested `Redacted` value helpers as adopted merely because they appear in
this table. Production `Redacted` value adoption is limited to `Redacted.make(...)` at trusted
app/host secret-intake boundaries that wrap live credential strings and `Redacted.value(...)` at
trusted invocation boundaries that must hand a process-local secret to pi/provider APIs.
Conditional canary, audit-only, or test-only rows do not grant production permission until exact
promotion.

| Construct                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Direct import                                                                                                                                                                                                                                                         | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Effect.gen`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/Effect`                                                                                                                                                                                                                                                       | Required for direct multi-step programs. Direct generator effects that need `this` use `Effect.gen({ self: this }, function*() { ... })`. Generator bodies must not use JavaScript `try` / `catch` to recover from `yield*` failures; use manifest-adopted Effect recovery combinators so typed errors, interruption, defects, and causes remain visible to runtime recovery and tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Effect.fn`, `Effect.fn("name")`, source-typechecked `Effect.fn.Return`                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Effect`                                                                                                                                                                                                                                                       | Required for reusable Effect-returning functions. Use unnamed `Effect.fn(function* ...)` when generator reuse is useful without naming a trace boundary, and named `Effect.fn("@svvy/runtime/Runtime.messages.submit")` when the operation should create a trace/span boundary. `Effect.fnUntraced` is installed-export-audited but not production-adopted unless a package owner promotes it in `packages/effect-adoption-manifest.ts` and this spec. Class/object Effect methods that need `this` use `Effect.fn("Service.method")({ self: this }, function*(this: Service, ...args) { ... })`. When a generator needs an explicit return type, annotate it with `Effect.fn.Return<A, E, R>`, not a raw `Effect.Effect<...>` return type; this is a type-only namespace form proven by source typecheck, while the installed runtime export is the manifest-adopted `Effect.fn` value. `Effect.fn` may receive additional pipeable transform functions after the generator/options argument. Each transform has the shape `(effect, ...originalArgs) => Effect` and receives the suspended `Effect`, not the computed success value. For named `Effect.fn`, transforms run before the traced span wrapper. Use transforms only for operation-local Effect-level decoration such as catch/log/span annotation that replaces a thin wrapper. Do not wrap an `Effect.fn` call in a thin `Effect.gen` solely to add catch, logging, or annotation behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Effect.try`, `Effect.tryPromise`, `Effect.promise`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `effect/Effect`                                                                                                                                                                                                                                                       | Foreign synchronous and Promise boundaries. Map unknown failures immediately to package tagged errors. Use `Effect.tryPromise` when rejection is an expected domain failure and map it to the typed error channel. Use `Effect.promise` only when rejection is unexpected/defect-like or already impossible at that boundary. `Effect.tryPromise` thunks receive and forward the Effect-provided `AbortSignal` when the host API supports cancellation. Direct `Effect.callback` is installed-export-audited but not production-adopted unless a package owner promotes it in `packages/effect-adoption-manifest.ts` and this spec. Callback-shaped production bridges use adopted `Stream` and scoped resource APIs unless an exact manifest/spec promotion says otherwise. Do not leave raw thrown values, rejected promises, host callback errors, or ignored cancellation hidden behind package service methods.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Effect.mapError`, `Effect.onError`; non-adopted `Effect.tapError`, `Effect.tapErrorTag`, `Layer.tapError`                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/Effect`, `effect/Layer`                                                                                                                                                                                                                                       | Foreign and package boundaries use manifest-adopted `Effect.mapError` when host/platform/SQL/schema/process failures need to become package tagged errors. Use manifest-adopted `Effect.onError` only for compensating cleanup when an earlier step in the same effect has created process-local or scoped side effects that must be undone if a later step fails, such as partially-started runtime/session resources. The cleanup receives `Cause.Cause<E>` and must be non-failing or explicitly ignored after best-effort cleanup; do not use `Effect.onError` as a logging-only substitute for typed error mapping. `Effect.tapError`, `Effect.tapErrorTag`, and `Layer.tapError` are not production-adopted unless exact manifest rows and focused redacted diagnostic tests exist. Do not widen public service errors to `unknown`, `Error`, or host package errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Effect.sleep`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `effect/Effect`                                                                                                                                                                                                                                                       | Allowed only for one-shot non-policy delays inside an Effect service when the owning spec names the host protocol receipt/deadline being waited on, or for `TestClock`-controlled timing assertions. Retry, backoff, polling, reconciliation cadence, worker draining, and UI/bridge stabilization use `Schedule`, `Clock`, deterministic receipts, or explicit `drain(...)`/acknowledgement APIs; do not put fixed sleeps inside effects that are retried or whose correctness depends on timing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Context.Service` plus `Context.Service.Shape<T>`, `Context.Service.Identifier<T>`, `Service["Service"]`, `Service.context(self)`, `.of`, `.use`, and `.useSync`                                                                                                                                                                                                                                                                                                                                               | `effect/Context`                                                                                                                                                                                                                                                      | Package services and approved data-only port tags. Implementation services use class syntax. Approved data-only port tags use an explicit exported port identifier interface, an explicit `*Service` interface, and `Context.Service<PortIdentifier, PortService>(id)`. The approved sets are `@svvy/core` data-only cross-package ports plus every package-local and runtime-bootstrap host/config tag named by the owning package specs and enforced by package-boundary tests. Use `Context.Service.Shape<T>`, `Service["Service"]`, `Service.context(self)`, and `.of` only for class-style services. Providers and adapters for approved data-only tags implement the exported `*Service` interface and install plain service objects with `Layer.succeed(Port, service)` or `Layer.effect(Port, makeService)`, not `.of`. Use `Context.Service.Identifier<T>` only when a typed identifier is required by a helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Third-party service identifier adapters                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Context`                                                                                                                                                                                                                                                      | Third-party Effect service identifiers stay inside adapter implementations. Svvy-owned boundaries expose a named v4 `Context.Service`; do not use `Context.GenericTag`, `Context.Tag`, `Effect.Tag`, or `Effect.Service` in svvy service contracts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Layer.effect`, `Layer.succeed`, `Layer.provide`, `Layer.provideMerge`, `Layer.mergeAll`; non-adopted `Layer.sync`, `Layer.syncContext`, `Layer.succeedContext`, and `Layer.buildWithScope` require same-patch manifest adoption                                                                                                                                                                                                                                                                               | `effect/Layer`                                                                                                                                                                                                                                                        | Dependency graph construction. The currently production-adopted members are the exact value reads listed in `packages/effect-adoption-manifest.ts`: use `Layer.effect` when construction itself can fail, acquire resources, or call other services; use `Layer.succeed` for already-built service values; use `Layer.provide` to satisfy layer requirements and hide dependency services from the resulting layer output; use `Layer.provideMerge` only in the exact source-gated production file `packages/runtime/src/index.ts` when runtime root composition needs to retain package-private dependency services for sibling internal layers before a final public boundary hides the assembled internal bundle; and use `Layer.mergeAll` for ordinary composition. `Layer.sync`, selected `*Context` variants other than `Layer.effectContext`, and `Layer.buildWithScope` are candidate shapes only after the same patch adds their exact member reads to the adoption manifest, focused tests, and package-boundary coverage. When adopted, use `Layer.sync` for synchronous service implementations such as app identity, packaged path resolution, and pure config snapshots; use adopted `*Context` variants only when one acquisition naturally provides multiple services or ports from the same scoped resource; and use `Layer.buildWithScope` only at app/process bootstrap, explicit adapter edges, or named integration/e2e/facade harnesses that deliberately own and close the destination scope. Ordinary app/package composition uses layers, `ManagedRuntime`, and scoped services rather than manually built contexts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Effect.provideService`; non-adopted `Effect.provideServiceEffect`                                                                                                                                                                                                                                                                                                                                                                                                                                             | `effect/Effect`                                                                                                                                                                                                                                                       | Test-edge and facade-edge service overrides when constructing a full layer would obscure the contract being tested. Use manifest-adopted `Effect.provideService` for narrow explicit overrides of one service value in a bounded program. `Effect.provideServiceEffect` is not production-adopted unless exact manifest rows and focused tests exist. Do not use repeated `provideService` calls as the app dependency graph or as hidden per-request service assembly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Effect.provide(..., { local: true })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Effect`                                                                                                                                                                                                                                                       | Test-only explicit resource isolation when a layer subtree must not share v4's memo map. Production use is not production-adopted unless the owning package spec names the isolated resource subtree, owner, lifetime, and test proving isolation is required. `Layer.fresh(...)` is not production-adopted unless exact manifest and boundary-test adoption.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Layer.mock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/Layer`                                                                                                                                                                                                                                                        | Not adopted. Tests use explicit fake service objects with `Layer.succeed(...)`, `Layer.effect(...)`, package-local fake layers, or manifest-listed test/harness `Layer.provideMerge(...)` reads when a harness must access both the service under test and a fixture/handle service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `LayerMap.Service`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `effect/LayerMap`                                                                                                                                                                                                                                                     | `LayerMap` is conditional: installed-export canary only, not production adoption. Production imports or value reads of `LayerMap.Service` or `LayerMap.make` remain forbidden until the same change adds exact `adoptedEffectRuntimeModuleExports` rows, an owning package/spec record naming the keyed resource, key identity/serialization, acquisition layer, scope owner, invalidation/release policy, idle TTL policy, boundary allowlists, and focused tests. Until that promotion lands, all `LayerMap.Service`, `.get(key)`, `.contextEffect(key)`, `.invalidate(key)`, `layerNoDeps`, `preload`, `preloadKeys`, and `LayerMap.make` examples are non-adopted reference guidance and must not be copied into production code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Layer.effectDiscard`, `Layer.unwrap`, `Layer.suspend`, `Layer.fresh`, `Layer.effectContext`, `Layer.makeMemoMapUnsafe`                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Layer`                                                                                                                                                                                                                                                        | Non-adopted helpers. Do not use in production or test code until the same patch adds exact installed-export or adopted-export rows, package-boundary allowlists, owner policy, and focused tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Scope`, `Scope.make`, `Scope.fork`, `Scope.close`, `Effect.addFinalizer`, `Scope.addFinalizer`, `Effect.acquireRelease`, `Effect.acquireUseRelease`, `Effect.ensuring`, `Effect.forkIn`; non-adopted `Scope.makeUnsafe`, `Scope.forkUnsafe`; test-only `Effect.scoped`                                                                                                                                                                                                                                        | `effect/Scope`, `effect/Effect`                                                                                                                                                                                                                                       | Scoped resource lifetimes and v4 fiber ownership use only currently production-adopted members. Use layer scopes for service lifetimes; use `Scope.fork(parentScope, finalizerStrategy?)` for manual child scopes that must close with the parent; use explicit `Scope.make` / `Effect.provideService(Scope.Scope, scope)` / `Scope.close` only for bridge subscriptions or clients that must outlive one `runPromise`. `Scope.forkUnsafe` and `Scope.makeUnsafe` are not production-adopted. `Effect.scoped` is test-only under the current manifest and may be read only from the listed Effect test and SQLite-backed state test/support globs; production use requires exact manifest promotion, package-boundary allowlists, owner policy, and focused lifetime tests. Use `Effect.acquireRelease` for scoped resources whose release is infallible, receives the scope-close `Exit`, and catches/logs/maps close failures before returning; acquisition is uninterruptible by default, so pass `{ interruptible: true }` only when partial acquisition is safe to interrupt. Use `Effect.acquireUseRelease` for one-shot bracketed handles whose release failure belongs to the operation result, `Effect.addFinalizer` for current-scope cleanup that needs the scope-close `Exit` and must be infallible, `Scope.addFinalizer` for concrete-scope cleanup that does not need the close exit, and `Effect.ensuring` for unconditional cleanup around one effect. Do not use v3 fork names, and do not translate daemon-style work to `Effect.forkDetach` inside packages. Currently adopted scoped worker ownership uses `Effect.forkIn(ownerScope)`. `Scope.provide`, `Scope.use`, `Scope.addFinalizerExit`, `Effect.scopedWith`, `Effect.scope`, `Effect.acquireDisposable`, `Effect.forkChild`, and `Effect.abortSignal` are installed or audited v4 members only; `Effect.forkScoped` is test-only under the current manifest and may be read only from the listed Effect test globs. Production use of any of those members requires the same change to promote them in `packages/effect-adoption-manifest.ts`, update package-boundary allowlists, and add focused tests. `Effect.onExit` exists in the local beta.84 reference but is not currently recorded in `auditedEffectInstalledExports`; production use first requires an installed-export audit row, then exact adoption/owner/boundary/test promotion. svvy does not use `Effect.forkAll` / `Effect.forkWithErrorHandler`. Pass fork options such as `startImmediately` and `uninterruptible` only after the relevant option/member is adopted. |
| `ManagedRuntime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `effect/ManagedRuntime`                                                                                                                                                                                                                                               | Facades and public adapters receive a caller-owned `ManagedRuntime` and may call only instance members listed in `adoptedEffectInstanceMemberPolicies` for their exact source globs. Adopted runner permissions are `managedRuntime.runPromise` and `managedRuntime.runPromiseExit` in `packages/runtime/src/runtime-layer-config.ts`, `managedRuntime.runPromise` in `packages/runtime/src/accepted-native-tool-execution.ts` and `packages/runtime/src/app-log-commit-notification-adapter.ts`, and `managedRuntime.runPromiseExit` in `packages/runtime/src/index.ts` and `packages/state/src/state-facade.ts`. App bootstrap may use `managedRuntime.context`, `managedRuntime.runPromise`, and `managedRuntime.dispose` in `src/bun/runtime-service-adapter.ts`; `runPromise` there is limited to runtime-internal app-edge operations that are intentionally not exposed on the public Promise facade. Any use of `managedRuntime.runSync`, `runSyncExit`, `runCallback`, `runFork`, `disposeEffect`, or any other instance member requires a same-change manifest instance-member row, package-boundary allowlist, owner/spec wording, and focused tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `PubSub`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/PubSub`                                                                                                                                                                                                                                                       | Audit-only in-process fanout candidate. Production use requires exact manifest promotion and an owning package spec naming the internal hub owner, capacity, replay, shutdown, scope, and slow-subscriber behavior. Public `Runtime.events(...)` does not use PubSub as its event authority; it uses the runtime-owned replay ring plus filtered per-subscriber queues.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Stream`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Stream`                                                                                                                                                                                                                                                       | Runtime events, pi turn output, command output, source invalidation, subprocess streams.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Channel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `effect/Channel`                                                                                                                                                                                                                                                      | Package-local stream/protocol machinery only, for framing, encoding/decoding, and backpressure adapters where ordinary `Stream` combinators would obscure the protocol.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Sink`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Sink`                                                                                                                                                                                                                                                         | Finite scoped stream consumption and reduction only. Prefer named runtime services and core-owned state-port methods for product read models, command facts, transcript reconstruction, and durable projections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Effect.all`, `Effect.forEach`; non-adopted `Effect.withConcurrency`, `Effect.validate`, `Effect.partition`                                                                                                                                                                                                                                                                                                                                                                                                    | `effect/Effect`                                                                                                                                                                                                                                                       | Bounded parallel work over independent inputs currently uses manifest-adopted `Effect.all` and `Effect.forEach`: source scans, model/provider probes, extension readiness checks, generated-package validation, app-log/read-model fanout, and recovery batches. Use only adopted concurrency controls; `Effect.withConcurrency`, `Effect.validate`, and `Effect.partition` are not production-adopted unless exact manifest rows and focused validation/concurrency tests exist. `Effect.all` and `Effect.forEach` are fail-fast by default and are appropriate when the first failure should stop the operation. Do not use collection concurrency for queue claim order, per-surface prompt serialization, transaction internals, or command output ordering.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Effect.timeoutOrElse`; non-adopted `Effect.timeout`, `Effect.timeoutOption`, `Effect.race`, `Effect.raceFirst`, `Effect.raceAll`, `Effect.raceAllFirst`                                                                                                                                                                                                                                                                                                                                                       | `effect/Effect`                                                                                                                                                                                                                                                       | Deadlines currently use only manifest-adopted `Effect.timeoutOrElse` or other already-adopted primitives. `Effect.timeout`, `Effect.timeoutOption`, and `Effect.race*` members are not production-adopted unless their exact members are added to `packages/effect-adoption-manifest.ts`, package-boundary allowlists, owner policy, and focused tests. Any promoted timeout or race must record which branch won or timed out in command/recovery facts when user-visible behavior depends on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Source-gated interruption-region helpers: `Effect.uninterruptible`, `Effect.uninterruptibleMask`, `Effect.onInterrupt`; non-adopted helper: `Effect.interruptible`                                                                                                                                                                                                                                                                                                                                             | `effect/Effect`                                                                                                                                                                                                                                                       | `Effect.uninterruptible` is production-adopted only for the exact source-gated generated-package promotion section named in `packages/effect-adoption-manifest.ts`. `Effect.uninterruptibleMask` is separately adopted for `RuntimeShutdownAdmission` admission-count bookkeeping, marker leadership, the admitted-work completion barrier, release finalization, and shared receipt completion, and for the prompt dispatcher's short detached-fiber registration/start-gate handoff. It restores admitted work and the bounded shutdown drain itself to interruptible execution; prompt dispatch likewise restores prompt execution. `Effect.onInterrupt` is adopted only in `packages/extensions/src/extension-snapshots.ts`, where cancellation during the prepared source-tree rename sequence must execute the same journal rollback as an ordinary failure. Use short critical regions only where interruption would corrupt a durable lifecycle boundary. Durable cancellation facts must still be written by runtime lifecycle and recovery paths. Do not wrap pi turns, command execution, source scans, watcher loops, provider calls, user waits, or generated-package staging/build work in uninterruptible regions. `Effect.interruptible` remains non-adopted until an exact manifest row, owner policy, boundary allowlist, and focused tests promote it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Queue`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Queue`                                                                                                                                                                                                                                                        | Process-local wakeups, worker worklists, and command/event backpressure handoffs only. It never represents durable queue rows, command facts, transcript state, request-input rows, app logs, or recovery state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Deferred`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/Deferred`                                                                                                                                                                                                                                                     | Single-use readiness gates, one-shot request/response handoffs, and completion notifications. Do not use it as a reusable lock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Latch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Latch`                                                                                                                                                                                                                                                        | Conditional installed-export canary only. `Latch` is not production-adopted until exact members, owners, reusable gate semantics, boundary allowlists, and focused readiness/wakeup tests are promoted. Current production code uses adopted `Deferred`, `Queue`, `Ref`, or `Semaphore` members named by this spec; do not use `Latch` as durable queue state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Ref`, `SynchronizedRef`, `SubscriptionRef`, `Semaphore`, `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/Ref`, `effect/SynchronizedRef`, `effect/SubscriptionRef`, `effect/Semaphore`, `effect/FiberHandle`, `effect/FiberMap`, `effect/FiberSet`, `effect/ScopedRef`                                                                                                  | Prompt locks, active-turn state, concurrency limits, scoped mutable runtime state, replaceable one-active-fiber lanes, keyed fibers, and replaceable scoped resources. Production permission covers only exact manifest members such as `Ref`, `Semaphore`, and any other exact rows already present in `packages/effect-adoption-manifest.ts`; this table is not permission to import or read `SynchronizedRef`, `SubscriptionRef`, `FiberHandle`, `FiberMap`, `FiberSet`, or `ScopedRef` members. A surface prompt lock is a one-permit `Semaphore` or equivalent adopted synchronized state gate, not a `Deferred`. Target `SubscriptionRef` use is limited to low-cardinality latest-value status where late subscribers need the current value plus future changes, such as live surface, turn, worker, or bridge subscription status inside `@svvy/runtime`, after exact manifest adoption for constructors, reads, change streams, and mutation members. `SubscriptionRef` uses replay-one, unbounded PubSub semantics, so do not use it for high-rate runtime events, command output, queue delivery, durable replay, or backpressured fanout; use explicit `Ref` / adopted synchronized state plus bounded `PubSub` or `Queue` for those lanes after their exact members are adopted. Do not expose the underlying pubsub or treat `SubscriptionRef.changes` as durable event history. Do not implement lossless runtime event handoff as `SubscriptionRef.get` followed by `SubscriptionRef.changes`; `changes` is appropriate only for promoted low-cardinality latest-value status because it emits the current replay-one value plus future updates, not because it provides durable sequence replay, backpressure, or state-read high-water semantics. Target `FiberHandle` use is limited to lanes where starting a new job should interrupt/replace the prior job for the same lane after exact manifest adoption. Target `ScopedRef` use is limited to replaceable scoped values after exact manifest adoption for the constructor and replacement members; replacement must serialize acquisition and close the previous value's scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Schedule`, including `Schedule.recurs`, `Schedule.duration`, `Schedule.during`, `Schedule.spaced`, `Schedule.fixed`, `Schedule.windowed`, `Schedule.cron`, `Schedule.exponential`, `Schedule.jittered`, `Schedule.modifyDelay`, `Schedule.addDelay`, `Schedule.forever`, `Schedule.take`, `Schedule.either`, `Schedule.both`, `Schedule.bothLeft`, `Schedule.bothRight`, `Schedule.andThen`, `Schedule.setInputType`, `Schedule.while`, `Schedule.passthrough`, `Schedule.tapInput`, and `Schedule.tapOutput` | `effect/Schedule`                                                                                                                                                                                                                                                     | Target schedule vocabulary for retry, polling, debounce, reconciliation, recovery cadence, request-input timeout recovery, and long-lived background cadence. Production use is limited to exact manifest rows plus the owning package policy and tests; this table does not grant blanket `Schedule` permission. `tapInput` / `tapOutput` are allowed only after package-owned retry/recovery observability names the typed logs or metrics it publishes without changing the retry value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Duration`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/Duration`                                                                                                                                                                                                                                                     | Named durations for sleeps, timeouts, retries, kill deadlines, leases, debounce windows, and test adjustments. Public persisted contracts still store ISO timestamps or explicit millisecond fields; internal Effect code prefers `Duration` values or string duration literals over anonymous numeric milliseconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Clock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Clock`                                                                                                                                                                                                                                                        | `DateTime.now` produces persisted instants and ISO timestamps. `effect/Clock` is not production-adopted for elapsed-time, TTL, or lease arithmetic until exact manifest rows, package-boundary allowlists, owner policy, and focused timing tests name the members. Avoid host time reads on runtime paths so `TestClock` can drive timing tests through adopted time primitives only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `TestClock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `effect/testing`                                                                                                                                                                                                                                                      | Virtual time in tests for sleeps, retry schedules, queue drains, debounce, leases, and timeouts. Prefer `TestClock.adjust` / `TestClock.setTime` over broad sleeps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `DateTime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/DateTime`                                                                                                                                                                                                                                                     | Time inside Effect programs. Do not use `Date.now()`, `new Date()`, `DateTime.nowUnsafe()`, `clock.currentTimeMillisUnsafe()`, or `clock.currentTimeNanosUnsafe()` for runtime logic. Use Effect `Clock` / `DateTime` effects so runtime tests can use `TestClock`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Config`, `ConfigProvider`, `Redacted`, `Config.redacted`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `effect/Config`, `effect/ConfigProvider`, `effect/Redacted`                                                                                                                                                                                                           | Required at process/config edges and tests for configuration reads, platform env snapshots, and redacted host secrets. Domain services receive app-owned settings/secrets through explicit services or state ports; do not read global env directly. Production adoption covers only `ConfigProvider.fromEnv`, the exact `Config` members in the manifest, `Redacted.make(...)`, and `Redacted.value(...)`. `ConfigProvider.fromUnknown`, `ConfigProvider.layer`, `ConfigProvider.layerAdd`, `ConfigProvider.constantCase`, `ConfigProvider.nested`, `Config.schema`, `Config.unwrap`, and `Config.redacted` are installed-export-audited but not production-adopted unless exact manifest rows exist. Other config/redacted helpers, including dotenv/directory config providers and redacted wiping helpers, are not installed-export-audited in this repo until exact audit rows and canaries exist. Tests that need deterministic object config may use object providers only after exact test/adoption coverage. Use `Redacted.make(...)` only at trusted app/host secret-intake boundaries that receive raw secret strings. Use `Redacted.value(...)` only at the trusted invocation boundary that requires the secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Context.Reference`, `References`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `effect/Context`, `effect/References`                                                                                                                                                                                                                                 | Not production-adopted for fiber-local/default runtime settings such as current concurrency, log level, scheduler, tracing flags, and explicit app-owned bootstrap references until exact `Context.Reference` / `References` members are promoted in the adoption manifest, package-boundary allowlists, and focused tests. Product code uses ordinary services for durable product settings and explicit app-edge services/config for runtime defaults. Time-zone APIs are also not production-adopted unless exact `DateTime` zone members are adopted; do not model current time zone as a custom `Context.Reference`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Data`, `Result`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `effect/Data`, `effect/Result`                                                                                                                                                                                                                                        | Non-adopted package-internal data helpers and pure result helpers until exact members are promoted in the adoption manifest with owning package policy and tests. Boundary errors use core-owned `Schema.TaggedErrorClass` shapes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Exit`, `Cause`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/Exit`, `effect/Cause`                                                                                                                                                                                                                                         | Bridge, process, turn, command, and test boundaries that must distinguish success, typed failure, defect, and interruption.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Option`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Option`                                                                                                                                                                                                                                                       | Effect-native package internals and service APIs where absence is clearer than nullable values or exceptions. `Option` is allowed for Effect service lookups such as optional rows. Public RPC/read-model/persisted payloads encode absence as `null` or a discriminated shape, and public failures stay typed Effect errors or tagged error payloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Match`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Match`                                                                                                                                                                                                                                                        | Not production-adopted. Closed product-union dispatchers use direct `switch` statements with no broad `default` branch and a `never` exhaustiveness check until exact `effect/Match` import and member evidence exists in the installed-export audit and adoption manifest. Do not introduce match helpers for open-ended business branching or where a direct small `switch` is clearer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Filter`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Filter`                                                                                                                                                                                                                                                       | Candidate package-private predicate and refinement values for adopted APIs that accept v4 filters. Production code must not import `effect/Filter` or call `Filter.fromPredicate(...)` until the exact `Filter` members and the consuming `Effect` recovery members are adopted in `packages/effect-adoption-manifest.ts`. `Filter` values are process-local code helpers; they are not public contracts, persisted payloads, generated declarations, runtime-event payloads, app-log fields, or extension model-facing output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Non-adopted observability helpers: `Logger`, `LogLevel`, `Logger.batched`, `Logger.layer`, `Logger.tracerLogger`, `References.MinimumLogLevel`, `References.CurrentLogLevel`, `References.CurrentLogAnnotations`, `References.CurrentLogSpans`, `References.UnhandledLogLevel`                                                                                                                                                                                                                                 | `effect/Logger`, `effect/LogLevel`, `effect/References`                                                                                                                                                                                                               | App bootstrap logging layers, package diagnostics, redacted command logs, scoped log annotations/spans, and bounded Effect-log-to-app-log bridge layers require exact manifest adoption, redaction policy, and focused tests before production use. Product app-log rows still live in `@svvy/state`; Effect logs are observability output, not durable product facts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Non-adopted tracing/metric helpers: `Metric`, `Tracer`, `Effect.log*`, `Effect.withSpan`, `Effect.annotateCurrentSpan`, `Effect.annotateSpans`, `Effect.annotateLogs`, `Effect.annotateLogsScoped`, `Effect.withLogSpan`, `Effect.trackDuration`, `Layer.withSpan`, `Stream.withSpan`                                                                                                                                                                                                                          | `effect/Metric`, `effect/Tracer`, `effect/Effect`, `effect/Layer`, `effect/Stream`                                                                                                                                                                                    | Service-boundary observability for queues, turns, commands, provider/pi-adapter calls, source invalidation, recovery, stream bridges, and generated package work requires exact manifest adoption, trace/log/metric policy, and focused tests before production use. Durable product facts still live in `@svvy/state`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Schema` plus manifest-adopted members such as `Schema.Struct`, `Schema.TaggedErrorClass`, `Schema.brand`, `Schema.Redacted`; non-adopted helpers such as `Schema.TaggedStruct`, `Schema.Class`, `Schema.TaggedClass`, and `Schema.RedactedFromValue`                                                                                                                                                                                                                                                          | `effect/Schema`                                                                                                                                                                                                                                                       | Required for public contracts, persisted payloads, IPC/RPC payloads, command facts, generated package metadata, runtime event unions, tagged read-model variants, branded ids, and secret-shaped payload fields. Exact Schema value reads remain member-gated by `packages/effect-adoption-manifest.ts`; installed-audited helpers such as `Schema.TaggedStruct`, `Schema.Class`, `Schema.TaggedClass`, and `Schema.RedactedFromValue` are not production permission until their manifest rows and focused schema tests exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Non-adopted `Struct.pick`, `Struct.omit`, `Struct.map`, `Struct.assign`, `Struct.mapPick`, `Struct.mapOmit`                                                                                                                                                                                                                                                                                                                                                                                                    | `effect/Struct`                                                                                                                                                                                                                                                       | Schema field-shape modeling through `schema.mapFields(...)` with `effect/Struct` requires exact manifest adoption and focused schema-field tests before production use. Current svvy public schemas use explicitly declared fields, `Schema.optionalKey(...)` for omitted public object fields, and owner-named schema factories rather than implicit field-shape transforms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Schema.TaggedErrorClass`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `effect/Schema`                                                                                                                                                                                                                                                       | Typed domain errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Data.TaggedError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `effect/Data`                                                                                                                                                                                                                                                         | Not production-adopted unless exact `effect/Data` member rows are adopted. Package-local implementation errors that never cross a package, RPC, persistence, runtime-event, read-model, command-fact, app-log, generated-package, bridge, or transcript boundary still use public core-owned `Schema.TaggedErrorClass` where a typed error is needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SchemaIssue`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `effect/SchemaIssue`                                                                                                                                                                                                                                                  | Stable schema decode/encode issue formatting for typed boundary errors and app logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Crypto`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Crypto`                                                                                                                                                                                                                                                       | Required for security-sensitive random bytes, UUIDs, digest/hashing, source/artifact fingerprints, generated-package facts, and app-owned cryptographic helpers. Package services depend on `Crypto.Crypto` when they need secure values. The live Bun/Electrobun provider is supplied only by app/bootstrap through `layerRuntimeBunPlatform` and installed-verified `BunCrypto.layer`. Do not use `Random`, `Math.random()`, `node:crypto`, WebCrypto globals, or Bun globals directly for secrets, auth tokens, secure ids, salts, hashes, digests, or persisted fingerprints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Random`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Random`                                                                                                                                                                                                                                                       | Not production-adopted. Non-security randomness such as jittered schedules, randomized test data, deterministic tests with an explicitly provided/seeded random service, and sampling may use `Random` only after exact manifest rows, package-boundary allowlists, owner policy, and focused tests name the members. The default `Random` implementation is not cryptographically secure. Do not use `Random` for persisted ids, secrets, credentials, auth/session tokens, cryptographic salts, digests, hashes, source/artifact fingerprints, generated-package fingerprints, or user-visible uniqueness guarantees. Package runtime behavior must not call `Math.random()` directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `FileSystem`, `Path`, `PlatformError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `effect/FileSystem`, `effect/Path`, `effect/PlatformError`                                                                                                                                                                                                            | File-backed source, artifact, generated package, and sandbox helper boundaries when using Effect platform services.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `ChildProcess.make(...)` and `ChildProcessSpawner.ChildProcessSpawner` service value reads; process command/handle types only after type-only manifest adoption                                                                                                                                                                                                                                                                                                                                                | `effect/unstable/process`                                                                                                                                                                                                                                             | Conditional process adoption only. The resolved production boundary is a runtime-owned host process port supplied by app/bootstrap behind `RuntimeCommandSessionService`. Effect `ChildProcess` is outside the production boundary unless the owning spec and manifest adopt exact production members, package-boundary import allowlists, a host/app spawner layer, and fake-spawner tests for the named runtime-owned Shell/`svvyx`/Apply Patch/`execute_typescript` command sessions, sandbox helper launch, or extension-owned bounded helper work. Agent-invoked prompt-only CLI usage still enters through Shell `exec_command`; prompt-only extensions do not own durable subprocess sessions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Command`, `Argument`, `Flag`, `GlobalFlag`, `CliError`, `CliOutput`, `HelpDoc`, `Param`, `Primitive`, and all other `effect/unstable/cli/*` members                                                                                                                                                                                                                                                                                                                                                           | `effect/unstable/cli/*`                                                                                                                                                                                                                                               | Not installed-export-audited and not production-adopted. App-owned CLI parsing may adopt exact CLI subpaths and members only in the same change that adds manifest rows, installed-export tests, package-boundary allowlists, and focused process-entrypoint tests. `Prompt`, `Completions`, autosuggest, and interactive CLI UI remain banned from shipped runtime behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Ndjson`, `Msgpack` encoding channels                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `effect/unstable/encoding/Ndjson`, `effect/unstable/encoding/Msgpack`                                                                                                                                                                                                 | Allowed only inside a package-owned protocol adapter named by a package spec, for a schema-backed line or binary stream with exact request/event schemas. Candidate uses are pi-adapter stdio-style protocol adapters and the runtime-owned workflow task-agent bridge if that bridge chooses this framing. Encoded streams are not durable event history, transcript state, read models, command facts, or app logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `HttpClient`, `HttpClientRequest`, `HttpClientResponse`, `FetchHttpClient`, and selected platform client layer                                                                                                                                                                                                                                                                                                                                                                                                 | `effect/unstable/http/HttpClient`, `effect/unstable/http/HttpClientRequest`, `effect/unstable/http/HttpClientResponse`, `effect/unstable/http/FetchHttpClient`                                                                                                        | Candidate modules for service-owned provider/OAuth health, model metadata probes, optional OTLP export, and scoped helper protocols after an owner/spec adoption record lands. Reusable services would depend on `HttpClient.HttpClient`; app/bootstrap would provide an app-owned network-policy HTTP layer backed by an adopted raw client layer such as `FetchHttpClient.layer` with an explicit `FetchHttpClient.Fetch` reference or a fake raw client layer. `@effect/platform-bun/BunHttpClient` and `NodeHttpClient.layer*` remain unadopted until their own package/spec row and boundary allowlist name them. Raw platform HTTP layers are private to that policy wrapper and wrapper tests. Do not implement native `svvy` web-search or web-fetch behavior with `HttpClient`; Web remains the prompt-only TinyFish CLI path unless a separate product spec adopts a native web extension.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `HttpServer`, `HttpRouter`, selected platform server layer                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/unstable/http/HttpServer`, `effect/unstable/http/HttpRouter`                                                                                                                                                                                                  | Not adopted for the shipped workflow task-agent bridge. The shipped bridge transport is the app-bootstrap Bun loopback adapter named in `runtime.spec.md`. Effect HTTP server modules are outside the current contract. Adopting them requires a spec change that names the exact bridge layer, scope owner, routes, host platform layer, readiness gate, shutdown path, and package-boundary tests. They are never a desktop bridge replacement, generic app RPC surface, generated HTTP client surface, Scalar/OpenAPI docs surface, Shell access path, settings API, or workflow-control API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Bun platform modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `@effect/platform-bun/BunServices`, `@effect/platform-bun/BunChildProcessSpawner`, `@effect/platform-bun/BunHttpClient`, `@effect/platform-bun/BunHttpServer`, `@effect/platform-bun/BunFileSystem`, `@effect/platform-bun/BunPath`, `@effect/platform-bun/BunCrypto` | `BunFileSystem.layer`, `BunPath.layer`, and `BunCrypto.layer` are adopted only through `@svvy/runtime/bootstrap` `layerRuntimeBunPlatform`. Other Bun platform modules remain reference-only until an owning package/spec row and boundary allowlist adopt them. Reusable packages depend on abstract Effect services, not Bun modules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `SqlClient`, `Migrator`, `SqlError`, `SqlSchema`, and package-private `SqlConnection`                                                                                                                                                                                                                                                                                                                                                                                                                          | `effect/unstable/sql/SqlClient`, `effect/unstable/sql/SqlConnection`, `effect/unstable/sql/Migrator`, `effect/unstable/sql/SqlError`, `effect/unstable/sql/SqlSchema`                                                                                                 | Not adopted by the active package architecture. `@svvy/state` owns SQLite product persistence through package-private repositories and must not import these modules. Effect SQL production imports require a PRD, state package spec, manifest, lockfile, setup layer, migration layer, live adapter, and package-boundary update in the same architecture change before use. Do not use `SqlModel`, `SqlResolver`, or SQL-backed `RequestResolver` helpers for product repositories; `@svvy/state` owns explicit repositories, transaction boundaries, safe integer policy, terminal fact immutability, and after-commit invalidations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Request` and `RequestResolver`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/Request`, `effect/RequestResolver`                                                                                                                                                                                                                            | Not adopted for production code. Production imports are forbidden unless the PRD and owning package spec name a batchable external or process-local lookup, owner, batch key, backend, ordering/latency tolerance, cache/invalidation behavior, entry completion guarantee, `preCheck` false behavior, delay/batch-size limits, whether `RequestResolver.asCache` / `RequestResolver.withCache` is allowed, resolver span naming/linking, and tests. Do not use `Request` / `RequestResolver`, `RequestResolver.withCache`, or resolver delay knobs for `@svvy/state` read models, SQLite selectors, queue claims, source invalidation, runtime events, app logs, extension implementation records, or runtime facades.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Cache`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Cache`                                                                                                                                                                                                                                                        | Not adopted for production code. Production adoption requires the same change to add exact manifest member rows, package-boundary allowlists, an owner/spec record naming capacity, TTL, invalidation owner, cached failure semantics, `requireServicesAt` ownership, and focused tests. Do not cache source fingerprints, generated-context readiness, build readiness, state read models, queue or command facts, app logs, or recovery state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Resource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/Resource`                                                                                                                                                                                                                                                     | Not adopted for production code. Production `Resource.manual` adoption is allowed only for scoped, refreshable, process-local values whose latest acquisition result is safe to reread and whose owner names refresh, failure, and shutdown policy. `Resource.auto` is rejected for source invalidation, generated-context refresh, generated-package refresh, provider readiness, CLI readiness, and every loop where freshness/failure must become product state. Those paths require explicit runtime-owned worker state, committed facts, diagnostics, notifications, and recovery rows. `Resource` must not replace generated-context readiness, source fingerprints, build readiness, surface stale state, read models, command facts, app logs, or recovery records.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ScopedCache`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `effect/ScopedCache`                                                                                                                                                                                                                                                  | Not adopted for production code. Production adoption requires the same change to add exact manifest member rows, package-boundary allowlists, an owner/spec record naming the cached resource, capacity, expiry/eviction policy, invalidation owner, release semantics, `requireServicesAt` ownership, and focused tests. Do not infer a preferred future scope-manager shape from `LayerMap.Service`; any future keyed service-resource adoption must name the specific owner and must not displace the current runtime-owned keyed child scope managers without a same-change architecture update. Do not use `ScopedCache` for durable facts, generated-context readiness, source fingerprints, queue rows, command facts, read models, app logs, or transcript reconstruction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `RcMap`, `RcRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `effect/RcMap`, `effect/RcRef`                                                                                                                                                                                                                                        | Not adopted for production code. Production adoption requires the same change to add exact manifest member rows, package-boundary allowlists, an owner/spec record naming the resource, key shape when applicable, lifetime/release policy, invalidation owner, optional bounded idle TTL, and focused tests. Do not use `RcMap`, `RcRef`, or a future `LayerMap.Service` promotion as permission to model workspace/surface runtime scope maps; current workspace and surface runtime scopes are runtime-owned keyed child scopes managed by package-private runtime scope managers. Do not use reference-counted resources to model product ownership, queue claims, active turns, read models, or durable session state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Pool`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Pool`                                                                                                                                                                                                                                                         | Not adopted for product code. Production imports are forbidden unless a product spec assigns a concrete pooled resource owner, scope, size/concurrency bounds, invalidation rule, shutdown behavior, fake layer, and focused tests. `Pool.makeWithStrategy` and custom `Pool.Strategy` are rejected until a concrete owner proves why generic resizing/reclamation will not hide helper-process, pi-session, provider-client, command-session, or sandbox-helper lifecycles. Do not pool SQLite transactions, queue dispatch services, prompt turns, command sessions, pi sessions, or renderer subscriptions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `JsonPatch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `effect/JsonPatch`                                                                                                                                                                                                                                                    | Not adopted for product code. Production imports are forbidden unless a public contract explicitly defines deterministic JSON Patch operations over schema-backed JSON values. Do not use JSON Patch as the default read-model, transcript, runtime-event, command-fact, or app-log update format. It is not the code `apply_patch` model and not a substitute for typed runtime events or command facts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `JsonSchema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/JsonSchema`                                                                                                                                                                                                                                                   | Not production-adopted. Generator/adapter use for normalizing or converting JSON Schema/OpenAPI documents is eligible only after exact manifest rows, package-boundary allowlists, owning emitter specs, and focused tests name the members. `JsonSchema.resolveTopLevel$ref(...)` is installed-export audit evidence only until promoted by those rows. Product APIs remain source-of-truth Effect Schema contracts in `@svvy/core` or package-owned schemas; do not hand-author parallel JSON Schema contracts when an Effect Schema contract can generate the required declaration/tool/schema block.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ChannelSchema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/ChannelSchema`                                                                                                                                                                                                                                                | Not production-adopted. Package-owned protocol/framing adapters may use `ChannelSchema` only after exact manifest rows, package-boundary allowlists, owning spec text, and focused protocol tests name the members. Prefer format-specific helpers such as `Ndjson.decodeSchema*` / `Msgpack.decodeSchema*` when those fit. Schema failures are mapped at the protocol boundary. `ChannelSchema` is not durable event history, app-log storage, read-model persistence, command facts, transcript reconstruction, or generated-package metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `HttpClientError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `effect/unstable/http/HttpClientError`                                                                                                                                                                                                                                | Not adopted for product code. Production imports are forbidden unless an HTTP boundary adapter spec assigns ownership, classification rules, redacted diagnostic mapping, and focused tests. Do not expose `HttpClientError` through public package DTOs, command facts, app logs, renderer bridges, or extension model-facing output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `@effect/vitest`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `@effect/vitest`                                                                                                                                                                                                                                                      | Adopted for the Effect test lane. Effect service/layer tests live in `*.effect.test.ts`, import only `assert`, `describe`, `it`, and `layer` from `@effect/vitest`, and access `it.effect`, `it.effect.each`, and nested `it.layer` through the imported `it`. Tests that need `TestClock` import it from the installed `effect/testing` module, not from `@effect/vitest`. `it.effect.prop(...)` is not active repo permission unless the same patch adopts the exact manifest rows, boundary tests, and focused property-test examples. SQLite-backed `@svvy/state` tests that directly or transitively depend on the active `bun:sqlite` adapter are the named Bun-lane exception while that adapter is active. Pure schema and contract tests may remain in the Bun unit suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Package code must use direct Effect v4 module imports as a `svvy` package convention. The import
examples below are reference patterns, not a blanket package allow-list:

Current manifest-adopted utility members are part of the active design only for their named use:

- `Cause.pretty(...)` is a redacted developer diagnostic helper after typed cause classification.
  It is not a public bridge error mapper and never replaces stable `@svvy/core` error payloads.
- `Effect.clockWith(...)` is allowed only where a package needs the injected clock service inside an
  Effect program and must not read host time directly.
- `Effect.matchEffect(...)` is the adopted branch form for success/failure continuation when both
  branches remain Effectful and typed.
- `Ref.getAndSet(...)` is allowed for process-local live state handoff where the previous value must
  be atomically observed and replaced; it is not persisted state or durable ownership.
- `Schema.Boolean`, numeric/string validators such as `Schema.isFinite(...)`,
  `Schema.isGreaterThan(...)`, `Schema.isGreaterThanOrEqualTo(...)`,
  `Schema.isLessThanOrEqualTo(...)`, `Schema.isLengthBetween(...)`, and
  `Schema.makeFilter(...)` are adopted for core/package boundary schemas and hoisted validators
  only.
- `SchemaIssue.InvalidValue` is adopted only for schema issue construction at strict boundary
  decode/encode helpers. `SchemaIssue.makeFormatterStandardSchemaV1(...)` is adopted only for
  strict boundary error formatting where schema decode/encode issues become stable public issue
  payloads or redacted app-log diagnostics.
- `Stream.fromIterable(...)` is adopted for finite in-memory item streams at package/facade
  boundaries; it is not durable replay, SQL streaming, filesystem watching, command output
  streaming, or queue delivery.

These rows explain current manifest entries. They do not grant permission for nearby convenience
members from the same modules unless `packages/effect-adoption-manifest.ts` names those exact
members and package-boundary tests permit the use.

- always-adopted imports are the stable `effect/*` modules required by that package's public
  services, schemas, layers, streams, queues, metrics, logging, and tests
- package-specific imports require an owning package spec that names the concrete product reason,
  resource, policy, lifetime, and test coverage before they are used
- platform, SQL, HTTP, process, unstable CLI, encoding, cache/resource/pool/reference-counting, and
  transactional-memory imports remain conditional examples unless an owner package explicitly adopts
  them

### Reference Patterns Not Adopted By Default

Local Effect references are implementation evidence, not product policy. When a reference pattern is
valid Effect v4 but conflicts with svvy ownership, the svvy package spec wins:

- Effect `Config` is for process/bootstrap configuration, deterministic config tests, and trusted
  app-edge secret intake only. User-editable settings, workspace settings, profile settings,
  extension usage, approval policy, provider auth status, generated-context bindings, and runtime
  policy are `@svvy/state` facts and read models, not `Config` values or `Context.Reference`
  defaults. App/bootstrap owns the production `ConfigProvider`; package service implementations do
  not call `ConfigProvider.fromEnv(...)`, `ConfigProvider.fromUnknown(...)`,
  `ConfigProvider.layer(...)`, or `ConfigProvider.layerAdd(...)` directly unless the package spec
  names that bootstrap boundary and the adoption manifest covers the exact members.
- Public package layer exports expose only the root layer(s), named service layers, and test layers
  listed by the owning package spec. Reference-style `layerWithDependency`,
  `layerWithSqlClient`, or `layerNoDeps` variants remain package-private unless the public package
  contract explicitly exposes that dependency. Public layers must not leak concrete platform,
  repository, SQL, host, logger, metric, cache, pool, or process services across package
  boundaries.
- `LayerMap`, `RcMap`, `RcRef`, `Resource`, `Cache`, `ScopedCache`, and `Pool` are not shortcuts
  for durable product ownership. Any adoption must name the exact key type, owner service, capacity
  or cardinality bound, TTL or explicit invalidation owner, acquire/release owner, shutdown
  behavior, redaction policy for keys/values, metrics/log policy, fake layer, and tests proving
  release on normal close, interruption, failed acquisition, invalidation, eviction where
  applicable, and app-runtime disposal. They must not hold SQLite repositories, durable state rows,
  renderer state, command facts, app-log entries, generated-package facts, or public facade
  payloads.
- `Effect.acquireRelease(...)` inside `Layer.effect(...)` is the preferred shape for package-owned
  concrete resources. Release effects are bounded and normalized before returning; finalizers
  release resources and do not infer product-visible cancellation, shutdown cause, or user intent.
  Product-visible shutdown, interruption, and recovery facts are recorded by the owning runtime/state
  service before finalizers run or through explicit state effects.
- Reference examples using `Effect.log*`, `Logger.consolePretty()`, or direct console output do not
  grant package observability permission. Production logging, span annotations, and metrics follow
  the package observation catalog and redaction policy; `Effect.fn("package/operation")` names a
  trace boundary, not permission to emit unreviewed logs or high-cardinality metrics.

Do not copy this full block into a package file. The block is an installed-export discovery ledger:
it intentionally contains adopted modules, test-only modules, and conditional audit-only modules.
Production files may import only modules and members allowed by `packages/effect-adoption-manifest.ts`
and the package-boundary allowlists. Package files must import only the allowed modules they use:

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberHandle from "effect/FiberHandle";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Latch from "effect/Latch";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaRepresentation from "effect/SchemaRepresentation";
import * as Struct from "effect/Struct";
import * as ScopedRef from "effect/ScopedRef";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as Channel from "effect/Channel";
import * as Sink from "effect/Sink";
import * as Queue from "effect/Queue";
import * as PubSub from "effect/PubSub";
import * as Random from "effect/Random";
import * as Ref from "effect/Ref";
import * as References from "effect/References";
import * as Schedule from "effect/Schedule";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as Take from "effect/Take";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Clock from "effect/Clock";
import * as Cache from "effect/Cache";
import * as Logger from "effect/Logger";
import * as LogLevel from "effect/LogLevel";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Tracer from "effect/Tracer";
import * as Request from "effect/Request";
import * as RequestResolver from "effect/RequestResolver";
import * as Redacted from "effect/Redacted";
import * as Resource from "effect/Resource";
import * as Result from "effect/Result";
import * as ScopedCache from "effect/ScopedCache";
import * as RcMap from "effect/RcMap";
import * as RcRef from "effect/RcRef";
import * as Pool from "effect/Pool";
import * as JsonPatch from "effect/JsonPatch";
import * as JsonSchema from "effect/JsonSchema";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as ChannelSchema from "effect/ChannelSchema";
import { TestClock } from "effect/testing";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Msgpack from "effect/unstable/encoding/Msgpack";
import * as Ndjson from "effect/unstable/encoding/Ndjson";
import * as BunServices from "@effect/platform-bun/BunServices";
import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import * as BunChildProcessSpawner from "@effect/platform-bun/BunChildProcessSpawner";
import * as BunHttpClient from "@effect/platform-bun/BunHttpClient";
import * as BunHttpServer from "@effect/platform-bun/BunHttpServer";
import * as BunStream from "@effect/platform-bun/BunStream";
import { BunRuntime } from "@effect/platform-bun";
```

Barrel imports from `"effect"` are valid in upstream documentation examples. `svvy` package code
uses direct imports so import ownership stays explicit.

Imports from `@effect/platform-bun` are adopted only for
`@svvy/runtime/src/bun-platform.ts` imports of `BunFileSystem`, `BunPath`, and `BunCrypto`.
Other `@effect/platform-bun` modules, all `@effect/platform-node` modules,
`@effect/sql-sqlite-bun`, and `@effect/sql-sqlite-node` are conditional examples. Before product or
test code uses one of those package paths, the exact owning package dependency must be added to the
relevant package manifest and `bun.lock`, and the owning package/spec row must name the precise
subpath and boundary allowlist. Effect SQL imports are not adopted by the active architecture and
must not appear in product or test code without a complete architecture update. `@effect/vitest` is
already adopted as a root dev dependency for Effect-lane tests only; package-local
`devDependencies` remain forbidden.
Package-boundary checks reject product/test imports from unadopted `@effect/platform-*` and
`@effect/sql-sqlite-*` paths. The only current `@effect/platform-bun` production exception is the
allowlisted Bun/Electrobun bootstrap module that provides `BunFileSystem.layer`,
`BunPath.layer`, and `BunCrypto.layer`; all other platform imports remain rejected except inside
local reference trees or explicitly adopted owner globs.
Every direct package subpath import must be verified against the installed package's actual export
map before implementation. Local reference sources can justify product design, but implementation
uses only subpaths exported by the installed dependency version unless the same change updates every
relevant package manifest and `bun.lock`.

## Package Dependency Rules

All `@svvy/*` packages that use Effect depend on the same exact `effect` v4 version. The root
package manifests and `bun.lock` are the version source of truth; package manifests must not use
different ranges, aliases, or per-package Effect versions. Local reference snapshots may be ahead of
the installed beta; implementation uses only APIs present in the installed package version or first
updates every package manifest and the lockfile together.

The lockfile must resolve all `effect` and `@effect/*` packages to a mutually compatible version
set. No transitive `@effect/*` package may peer against a different Effect beta than the root stack
unless the same change updates the entire Effect stack or adds an explicit root override with a
dated version-alignment audit. A package manifest pin is not enough when the lockfile resolves a
transitive Effect package to a different beta.

When a platform or SQL package is adopted, the root manifest/checks pin every adopted Effect package
as one stack: `effect`, adopted `@effect/platform-*`, adopted `@effect/sql-sqlite-*`, `vitest`, and
`@effect/vitest`. Patches or overrides for this stack must be declared once at the root with a
reviewed allowlist and a reason. Individual package manifests must not introduce their own
Effect/platform/SQL/test versions, overrides, aliases, or patches.

Platform and SQL package adoption follows the installed Effect version, not the reference snapshot
version. A code slice that imports `NodeRuntime`, `NodeServices`, `BunRuntime`,
`@effect/platform-bun`, `@effect/platform-node`, or `@effect/sql-sqlite-*` first adds the exact
compatible package versions to the owning manifest(s) and `bun.lock`, then updates package-boundary
gates. `@effect/vitest` is already root-installed for Effect-lane tests and must not be used as a
production dependency. If a code slice requires an Effect API outside the installed dependency set,
the same change updates every `@svvy/*` Effect dependency and every adopted `@effect/*` package as
one manifest/lockfile change before product code uses that API.

`ChildProcessSpawner` adoption is abstract-service adoption, not Node service adoption. Every
shipped command/subprocess owner that requires it names the Bun/Electrobun provider layer, owner
package, environment policy, sandbox-helper launch contract, fake test layer, and package-boundary
import globs before using live subprocesses. NodeServices examples in local Effect references are
reference-only unless a shipped Node host is explicitly added.

Platform packages are added only where used:

- `@effect/platform-bun` is adopted for Bun/Electrobun bootstrap service layers, not for domain
  service imports. The product export is `@svvy/runtime/bootstrap` `layerRuntimeBunPlatform`,
  implemented from `BunFileSystem.layer`, `BunPath.layer`, and `BunCrypto.layer`, and it provides
  only the abstract `FileSystem.FileSystem`, `Path.Path`, and `Crypto.Crypto` services. Additional Bun
  platform layers such as `BunChildProcessSpawner.layer`, `BunHttpClient`, `BunHttpServer.layer`, or
  `BunServices.layer` still require an owning package/spec row and an exact package-boundary
  allowlist before product code may import them. Providing any Bun platform layer does not authorize
  package/domain code to import or use `effect/Terminal`, `effect/Stdio`, or `effect/Console` as
  product runtime APIs.
- `@effect/sql-sqlite-bun` belongs in `@svvy/state` if the SQLite adapter is implemented through
  Effect SQL.
- `@effect/sql-sqlite-node` is script/test-only unless a shipped Node host is explicitly
  introduced.
- `@effect/vitest` belongs in dev/test dependencies when the repo test lane includes Effect
  service/layer tests that use `it.effect`, test layers, or Effect test services.
- `@effect/platform-node` is not installed or adopted in this workspace. Node-only scripts/tests or
  an explicitly introduced Node host may use it only in the same patch that adds the exact manifest
  and lockfile entries plus package-boundary coverage. When adopted, those code paths prefer narrow
  layers such as `NodeFileSystem.layer`, `NodePath.layer`, `NodeChildProcessSpawner.layer`,
  `NodeHttpClient.layerFetch`, `NodeHttpClient.layerUndici`, `NodeHttpClient.layerNodeHttp`, and
  `NodeHttpServer.layer` unless the process edge intentionally needs the full `NodeServices.layer`.

Reusable packages that merely require `FileSystem`, `Path`, `ChildProcessSpawner`, `HttpClient`, or
`SqlClient` import Effect service modules and leave those requirements in their layer types. They do
not depend on `@effect/platform-bun` or `@effect/platform-node` unless they are the host/bootstrap
package, a package-specific live adapter, or a test harness intentionally providing real host
layers. The shipped Electrobun/Bun app provides the adopted Bun platform services at app bootstrap
through `layerRuntimeBunPlatform`; Node platform layers remain unavailable without manifest,
lockfile, and package-boundary updates that adopt them explicitly.

Bun/Electrobun app-entry adapter files under `src/bun/**` may import only the adopted Effect modules
required to adapt package services to the app bootstrap edge: `effect/Effect`,
`effect/Exit`, `effect/Cause`, `effect/Schema`, `effect/Scope`, `effect/Layer`,
`effect/ManagedRuntime`, `effect/ConfigProvider`, and the source-gated `effect/Redacted` callsites
named by `adoptedEffectInstanceMemberPolicies` / `adoptedEffectRuntimeModuleExports`. `effect/Layer` and
`effect/ManagedRuntime` remain allowed there only for the app-owned bootstrap/facade boundary that
composes package layers and constructs or consumes the single app runtime. `effect/ConfigProvider`
remains allowed there only in exact app-bootstrap/config modules that parse
decoded host configuration before package layers are exposed. Those app-entry adapter files must not
import optional Effect modules, unstable Effect modules, platform packages, SQL packages, Effect
`Runtime`, or broad service-layer helpers unless this spec and the owning package spec add an
adoption record and the package-boundary gate names the exact file glob.

`@effect/platform-browser` is not adopted for renderer, desktop bridge, browser-tool, or package
logic. Renderer/browser code receives state facades, runtime facades, bridge callbacks, and ordinary
DOM/browser APIs at the UI edge; it does not import `BrowserRuntime`, browser HTTP clients, browser
worker helpers, browser persistence, clipboard, geolocation, IndexedDB, or browser service bundles.
Introducing a browser Effect platform layer requires a PRD and package-spec update naming the exact
renderer owner, provided services, lifetime, bridge boundary, and tests.

`@effect/platform-node-shared` is an internal shared platform package, not a svvy import surface.
Node-compatible live adapters use public `@effect/platform-node` or `@effect/platform-bun` modules
only in approved host/bootstrap, test, or package-specific live-adapter modules.

In the checked-in reference, `BunFileSystem.layer`, `BunPath.layer`, and
`BunChildProcessSpawner.layer` reuse shared Node-compatible implementations; do not infer Bun-native
filesystem or child-process semantics from the `Bun*` module names. `BunServices.layer` provides
child process, crypto, filesystem, path, stdio, and terminal services for Bun-compatible hosts, but
it is not adopted by svvy product code. It does not provide HTTP. If HTTP is adopted through a named
architecture record, app bootstrap provides it explicitly through an app-owned network-policy
`HttpClient` layer backed by that record's approved raw host client. Reusable packages then depend
on the guarded `HttpClient.HttpClient`; they do not assume a platform service bundle includes HTTP
and do not receive raw platform HTTP layers. No product package receives an Effect HTTP client layer
without a named adoption record.

Optional Effect modules require a complete adoption record before production use. The owning package
spec names the product owner and behavior contract, while this Effect spec and
`packages/effect-adoption-manifest.ts` name the exact Effect module/member reads, source globs,
lifetime/capacity policy, invalidation/release path, failure behavior, deterministic test layer,
and package-boundary rule. A package-spec note without manifest rows, boundary allowlists, and
focused tests is not production permission. Without that complete record, production code must not
introduce `Request`, `RequestResolver`, `RequestResolver.withCache`, `RequestResolver.asCache`,
`RequestResolver.persisted`, `Cache`, `ScopedCache`, `Resource`, `Pool`, `RcMap`, `RcRef`,
reloadable-style APIs, `JsonPatch`, `HttpServer`, unstable encoders, or any Effect module family not
listed in the Module Decisions Index. A new module family requires a new index row plus exact
manifest rows, package-boundary allowlists, owner/lifetime/failure policy, and focused tests in the
same change. This is an adoption gate, not a blanket ban: the module is acceptable only when the
product reason and contract are concrete.
`effect/JsonSchema`, `effect/SchemaRepresentation`, and schema emitter helpers such as
`Schema.toJsonSchemaDocument(...)` are target schema-emitter APIs, not blanket production adoption.
Production use is allowed only after the exact member reads move from installed-export audit rows to
`adoptedEffectRuntimeModuleExports`, the owning schema/declaration source globs are allowlisted by
package-boundary tests, and focused emitter tests prove `$defs`, annotation filtering, encoded-side
metadata, and target support. Schema-section examples are target contract shapes and audit
evidence, not permission for arbitrary production imports.

t3code may be cited for application, lint, bridge, and test patterns only. It is not product
authority for svvy public contract style, generated schemas, package-boundary declarations, error
class choice, or DTO ownership. When t3code examples use `Data.TaggedError` or product topology
that differs from svvy, svvy keeps the schema-backed `Schema.TaggedErrorClass` and
package-boundary rules in this spec.
t3code modules that create package-level `ManagedRuntime` values are app-edge examples only; svvy
does not copy that topology into public `@svvy/*` package roots, reusable package modules, renderer
bridges, generated packages, or tests. The only long-lived svvy runtime graph is the app/bootstrap
owned `ManagedRuntime` described above, and facade factories borrow that caller-owned runtime.

If a package spec adopts `Request` / `RequestResolver`, request types use `Request.Class` or
`Request.TaggedClass` and are executed only behind package service methods that call
`Effect.request(request, resolver)`. Resolver `runAll` receives non-empty `Request.Entry` batches and
must complete every accepted entry with `Request.complete`, `entry.completeUnsafe(Exit...)`, or an
explicitly documented linked completion path. Returning from a resolver with incomplete accepted
entries is a product defect. `preCheck: false` is allowed only when the entry is completed before
the requesting fiber can wait indefinitely, or routed to another documented
completion path in the same resolver. The adoption record chooses `make`,
`makeGrouped`, `fromFunction`, `fromFunctionBatched`, or custom `makeWith`; names max batch size,
delay policy, batch-key equality/hash policy, ordering guarantees, cache/invalidation behavior, and
concurrency; names the `RequestResolver.withSpan` span prefix, batch-size annotation policy, and
request-linking policy; states whether failures are safe to cache and for how long; and includes
deterministic tests. Do not use `RequestResolver.never`. Do not use
`fromEffect` or `fromEffectTagged` without a package-named concurrency and supervision policy,
because those helpers fork per request or tag group. `RequestResolver.persisted` is banned unless
`effect/unstable/persistence` is separately adopted.

### Product Domain Decisions For Optional Effect Primitives

Optional Effect primitives that cache, refresh, reference-count, pool, or batch process-local values
are not general optimization permission. The product owner for each domain decides whether the value
is durable state, generated file evidence, a live scoped handle, or a safe process-local probe before
choosing an Effect primitive.

- Model metadata and provider availability probes are direct uncached Effect operations by default.
  A process-local `Cache` may be introduced only in `@svvy/pi-adapter` or `@svvy/runtime` after the
  owning package spec names capacity, success/failure TTL, provider-auth invalidation, failure
  poisoning behavior, and tests. A `Resource.manual` may be introduced only after the owning package
  spec names owner scope, explicit refresh triggers, whether failed refresh leaves a stale readable
  value, how stale values are labelled or rejected, provider-auth invalidation, and why the value is
  reread-safe after previous scoped resources are finalized. Cached or resource-backed model
  metadata is never the durable read model; `@svvy/state` remains authoritative for provider/model
  read models.
- Provider auth, credential health, OAuth status, and secret references are durable
  state/secret-store facts. Do not store raw credentials or credential health in `Cache`,
  `Resource`, `RcMap`, `RcRef`, or `LayerMap`. Cached provider clients must be keyed by
  provider id plus credential version and must interrupt active borrows on revoke or secret
  replacement when stale credential use is unsafe.
- Generated context fingerprints, readiness, stale surface state, generated-context bindings,
  generated-package facts, and read-model invalidations are product facts. Do not model them with
  `Cache`, `Resource`, `RequestResolver`, `RcMap`, or `RcRef`. File-backed aggregate caches are
  product-owned generated-output caches with manifests and state reconciliation, not Effect caches.
- Workspace, surface, and workflow task-attempt live runtimes are the approved product reason for
  `LayerMap.Service` production adoption. Before production use, the adoption manifest and owning
  package spec must name that owner. Until then, they use the existing runtime-owned scope records
  instead. `RcMap` and `RcRef`
  are not alternate runtime registries.
- Extension registry reads, actor binding resolution, generated context builds, and readiness
  projection remain direct operations unless the extension spec names a specific cache owner and
  invalidation source. CLI requirement probes may use caching only after the owning package spec adds
  an adoption record.
- Host capability probes are direct uncached operations unless a package spec adds a resource row.
  Sandbox helper resolution, pi runtime path resolution, provider/model metadata reads, extension
  CLI requirement probes, platform capability checks, and packaged asset lookup are not
  cache/resource owners by default.
- Renderer warm read-model caches are UI-only memory. They are invalidated and refetched from
  `@svvy/state` only after app/bootstrap-prepared renderer-safe invalidations derived from runtime
  events, and are not Effect `Cache` entries.
- `RequestResolver` is reserved for real batchable, non-authoritative backend/probe work with an
  explicit batching contract. It is not used for state repositories, queue claims, read models,
  source invalidation, runtime events, app logs, generated context readiness, or command facts.

## Modules Not Adopted As Product Architecture

The following Effect modules are outside the package architecture unless `docs/prd.md`,
`docs/features.ts`, and the relevant package spec add explicit product scope:

- `effect/unstable/workflow`: Smithers remains the workflow runtime and authoring model.
- `effect/unstable/cluster`: `svvy` is a local desktop/runtime package architecture, not a
  distributed cluster.
- `effect/unstable/persistence`: `@svvy/state` owns SQLite product persistence and schema
  migrations.
- `effect/unstable/rpc`: not used for stdio adapters, the desktop bridge, app RPC, generated
  package contracts, workflow task-agent bridge, or public package-to-package APIs. Electrobun RPC
  remains the desktop bridge. Pi-adapter and extension protocol adapters use hoisted/generated
  schemas, Effect streams/channels, scoped queues, and typed request maps instead of Effect RPC
  groups. Internal bridge experiments must not become an agent-facing generic RPC surface or
  package-private transport dependency unless the PRD, feature inventory, this spec, and the
  relevant package spec name that exact transport and package owner.
- `effect/unstable/httpapi`: not needed for the desktop app package boundary.
- `effect/unstable/workers`: background product work uses scoped Effect fibers,
  `FiberMap`/`FiberSet`, durable state rows, and command/process services. Worker transport is
  outside the active package architecture.
- `effect/unstable/socket`: bridge transport remains Electrobun/app-owned. Socket transport is
  outside the active package architecture.
- `effect/unstable/redis`: no Redis-backed cache, queue, event bus, lock, pub/sub, persistence, or
  coordination surface is part of the local desktop product architecture.
- `effect/unstable/multipart`: no public runtime, desktop bridge, task-agent bridge, command, or
  source-edit API accepts multipart payloads. File and artifact flows use package-owned typed
  contracts and state/artifact ports.
- Raw platform HTTP internals such as platform-specific request/response streams, sinks, server
  internals, and connection primitives are not product architecture. Adopt only the higher-level
  `HttpClient`/`HttpServer` services explicitly named above, and map all transport details to
  package tagged errors at the adapter boundary.
- `effect/unstable/reactivity`: not the product read-model or invalidation architecture. It may be
  used inside an Effect SQL driver, but `@svvy/state` still returns explicit after-commit
  descriptors and exposes domain read models through state ports. Runtime publishes public
  invalidation notifications from those committed descriptors.
- `effect/unstable/ai`: pi remains the agent/session/model runtime. Do not bypass pi for
  orchestrator, handler-thread, or workflow-task agent turns. Helper model jobs may use pi through
  `@svvy/pi-adapter`.
  This ban includes `McpServer`, `McpSchema`, `Toolkit`, `Tool`, `McpServer.layer`,
  `McpServer.layerStdio`, `McpServer.layerHttp`, and MCP resource/prompt/tool registration for
  runtime, extension, workflow task-agent, generated-package, or desktop bridge surfaces. Any MCP
  adoption requires PRD, feature inventory, and owning package specs to name the exact bridge owner.
- `effect/Graph`: not the Smithers workflow graph, extension execution graph, package dependency
  graph, runtime command DAG, or source/build dependency model. Use product-owned schemas and
  package services for those contracts. `Graph` use requires a package-spec adoption record naming
  the graph owner, node/edge schemas, persistence policy, and tests.
- `effect/Cron`: not adopted as a persisted scheduler, automation format, queue lease policy, or
  recovery cadence contract. A package may import `effect/Cron` only when the same package spec
  adopts a human-calendar cadence that uses `Schedule.cron`, names whether cron values are parsed at
  config/decode time or constructed in memory, and tests `Cron.CronParseError` handling.
  User-visible or persisted recurrence requires product scope first. Do not use cron values for
  retry, debounce, source reconciliation, queue leases, worker restarts, or recovery sweeps.
- `effect/unstable/eventlog`: not part of the product runtime event bus, app-log persistence,
  command-fact store, read-model invalidation path, recovery ledger, or cross-process event replay.
  Do not import `EventLog`, `EventJournal`, `EventLogServer*`, `SqlEventJournal`, or
  `SqlEventLogServer*` for svvy runtime notifications. Product event facts remain explicit
  `@svvy/state` rows, and live notification fanout remains `@svvy/runtime` replay-ring plus bounded
  per-subscriber `Queue` and `Stream` machinery with state/read-model rebaseline. `PubSub` is not the
  runtime event authority unless promoted by an exact owner record.
- `effect/unstable/devtools`: not part of the product runtime, desktop bridge, package contract, or
  test harness architecture.
- `effect/unstable/schema`: public product contracts use stable `effect/Schema` and core-owned
  schema modules; unstable schema model helpers are not a public contract source.
- `effect/unstable/encoding/Sse` and `HttpApiSchema.StreamSse`: runtime subscriptions use typed
  Effect streams plus bridge-specific `AsyncIterable` or callback adapters. SSE encoding is not the
  desktop bridge, task-agent bridge, app RPC, runtime event, transcript, or generated package
  contract format. Introducing it requires PRD and package-spec updates that name the concrete
  server/client owner, event contract, lifetime, backpressure behavior, and tests.
- `Effect.tx` and `TxRef` / `TxQueue` / `TxPubSub` / `TxSemaphore` / other `Tx*` transactional
  collections: not adopted for product code, package-private worker utilities, tests, or package
  examples. `@svvy/state` owns durable SQLite transactions, queue claims, command facts, app logs,
  recovery records, and after-commit invalidations. `Tx*` values are process-local memory and are not
  restartable product state. Introducing any `Tx*` helper requires an owning package spec update,
  import allowlist, lifecycle/failure semantics, and package-boundary tests in the same change.
- `ScopedCache`, `RcMap`, `RcRef`, `Pool`, `Cache`, or `Resource` as durable state: these are
  scoped/process-local resource or memoization helpers. They never replace SQLite rows, generated
  context bindings, source fingerprints, queue rows, command facts, app logs, read models, recovery
  records, or bridge request/response rows.
- Scoped resources and invalidation use only primitives that are adopted in the production manifest
  for the owning package and exact member. Audit-only or non-adopted primitives such as
  `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`, `SubscriptionRef`, `Resource`, `RcRef`,
  `RcMap`, or `LayerMap` remain unavailable unless the same change names the concrete scoped
  resource, owner, key, invalidation path, finalizer behavior, manifest rows, and tests.
  Reloadable-style APIs are not part of the package architecture.
- `JsonPatch` as code editing, file patching, or transcript persistence: code/file edits use the
  Apply Patch extension and command facts; transcript and read-model state remains typed product
  state. JSON Patch may appear only in a schema-backed public payload that intentionally defines JSON
  Patch as its patch format and remains refetchable from the owning read model.
- `effect/unstable/cli` as an agent-facing command architecture: app-owned binaries may use it,
  but agents continue to use explicit native tools, prompt-only official CLIs through Shell,
  `svvyx` command contracts, and generated actor-specific declarations.
- `effect/unstable/cli/Prompt`, autosuggest flows, shell completions, or interactive CLI UI in
  shipped runtime behavior. User interaction belongs to Electrobun UI, command palette, Shell
  commands, pi-backed surfaces, and `request_user_input`; do not create a second readline/TUI loop.
- `effect/Terminal`, `effect/Stdio`, and `effect/Console` as an interactive runtime, shell UI,
  transcript, or command projection architecture. App-owned CLI entrypoints may use `Stdio` or
  `Terminal` at the process edge, and tests may use test layers. Product runtime command I/O flows
  through `ChildProcessHandle` streams, command facts, runtime events, and app logs.

Effect CLI is not installed-export-audited and is not production-adopted. App-owned binaries such as
the packaged `svvyx` CLI may adopt Effect CLI only after a separate adoption record names the exact
imports, host platform layer, binary owner, and tests for `effect/unstable/cli`, `Terminal`,
`Stdio`, `ChildProcessSpawner`, and the process-edge main runner. Until that adoption record lands,
shipped binaries do not use Effect CLI, platform CLI services, `Command.run(...)`, platform
`runMain` helpers, or host-equivalent runtime-main call forms. Reference examples may describe CLI
structure at a conceptual level only: flags with names, aliases, descriptions, and examples;
explicit subcommand composition; and parent command state only when subcommands need it. Do not copy
exact CLI run or runtime-main call forms into svvy specs or product code until the same change adds
installed-export audit rows, manifest adoption, package-boundary allowlists, compatible platform
dependencies, and focused process-entrypoint tests. Those examples are not product authority. svvy
has adopted only Bun file/path/crypto platform services (`BunFileSystem.layer`, `BunPath.layer`,
`BunCrypto.layer`), so product code may not assume `BunServices.layer`, `NodeServices.layer`,
terminal, stdio, process-spawner, or runtime-main support in the runtime graph. If Effect CLI is adopted later, entrypoints
translate the parsed command into the single approved extension/runtime dispatch seam for that
subcommand. Internal `@svvy/runtime` and `@svvy/extensions` services do not depend on
`Command.Environment`, `Terminal`, `Stdio`, or `Console`; they receive typed command plans, runtime
effect requests, or service inputs from the entrypoint. CLI entrypoints must not import state
repositories, create `ManagedRuntime`s, call runtime internals directly, or expose alternate
runtime/state command surfaces. CLI parsing modules do not become agent-facing APIs, product runtime
services, or a replacement for generated native-tool/schema contracts.

## Service And Layer Rules

- Every service identifier string starts with the package name and service area/path, such as
  `"@svvy/runtime/queue/QueueDispatcher"` or
  `"@svvy/core/RuntimeQueueStatePort"`. Every svvy-owned `Context.Service` and
  `LayerMap.Service` identifier string is globally unique, stable after merge, and covered by
  package-boundary checks that reject duplicate identifier strings. The same identifier rule applies
  to `Context.Reference` only when exact reference members are adopted in the manifest.
  Reusing an identifier for unrelated services is invalid because Effect stores services by that
  string key.
- Svvy-owned services use v4 `Context.Service`, not `Context.Tag`, `Context.GenericTag`,
  `Effect.Tag`, or `Effect.Service`. Third-party service identifiers stay behind adapter
  implementations; any dependency that crosses a svvy package boundary is exposed as a named svvy
  `Context.Service`.
- `Context.Reference` is reference-only and not production-adopted. The exact constructor form below
  remains unavailable until the same patch adds exact manifest member rows,
  package-boundary allowlists, owner policy, and focused tests:

  ```ts
  import * as Context from "effect/Context";

  export const CurrentLogMode = Context.Reference<"quiet" | "normal" | "debug">(
    "@svvy/runtime/CurrentLogMode",
    { defaultValue: () => "normal" },
  );
  ```

  After adoption, svvy-owned code uses the v4 direct constructor form
  `Context.Reference<Service>(id, { defaultValue })`; the options object is required in
  `effect@4.0.0-beta.84`.
  Reference defaults are computed lazily, cached on the reference object, and shared by every
  context that does not override the reference. Future svvy-owned references use immutable defaults,
  or provide fresh mutable values through an owner/test layer. Do not rely on `defaultValue` to
  create per-context mutable state.

- Class-style service contract modules are small. They export the `Context.Service` class, service
  shape aliases derived from that class, public input/output types when those are not already in
  `@svvy/core`, and public package error types. Approved data-only port tag modules instead export
  the explicit port identifier interface, the explicit `*Service` interface, and the function-syntax
  `Context.Service<PortIdentifier, PortService>(id)` tag. Live implementation modules build
  implementations with currently adopted layer members, usually `Layer.effect` or `Layer.succeed`,
  or with package-owned layer factories that use only manifest-adopted members. `Layer.sync`
  requires same-change manifest adoption, boundary-test coverage, owner policy, and focused tests
  before production use. Facade modules adapt a caller-owned `ManagedRuntime`. Package entrypoints export approved service
  contracts, layer factories, and facade factories; they do not hide package boundaries inside one
  root layer.
- Svvy-owned implementation services use class-style `Context.Service<Self, Shape>()(id)` unless
  the service is an approved data-only port tag with no implementation class. A class service
  implementation returned from `Layer.effect(...)` or a package-owned `make` constructor returns
  `Service.of({ ... })`, not an unchecked object literal, so TypeScript checks the implementation
  against the declared service shape. The service key association is provided by
  `Layer.effect(Service, ...)` or `Layer.succeed(Service, ...)`. `Context.make` is not
  production-adopted; using it requires exact installed-export audit/adoption, package-boundary
  allowlists, owner/spec wording, and focused tests. `.of` is not a runtime branding mechanism.
  Export class-service shapes as `Service["Service"]`
  or `Context.Service.Shape<typeof Service>` instead of duplicating interfaces by hand. Do not use
  those shape helpers or `.of` for approved data-only port providers; use the exported `*Service`
  interface.
- Data-only core-owned port tags that exist only to let implementation packages provide a stable
  cross-package dependency use the v4 function-syntax service constructor, an explicit exported
  port identifier type, and exactly one structural service shape:

  ```ts
  import * as Context from "effect/Context";
  import * as Effect from "effect/Effect";

  export interface ExtensionStatePort {
    readonly _tag: "ExtensionStatePort";
  }

  export interface ExtensionStatePortService {
    readonly records: {
      readSourceFingerprint(
        input: ReadExtensionSourceFingerprintInput,
      ): Effect.Effect<string | null, StateContractError>;
    };
    readonly dependencies: {
      isApproved(
        input: ReadExtensionDependencyApprovalInput,
      ): Effect.Effect<boolean, StateContractError>;
    };
  }

  export const ExtensionStatePort = Context.Service<ExtensionStatePort, ExtensionStatePortService>(
    "@svvy/core/ExtensionStatePort",
  );
  ```

  Effect environment requirements use the explicit port identifier type, for example
  `Effect.Effect<A, E, ExtensionStatePort>`. Providers implement the structural
  `ExtensionStatePortService` shape and install it with `Layer.succeed(ExtensionStatePort, service)`
  or `Layer.effect(ExtensionStatePort, makeService)`. This keeps same-shaped ports type-distinct
  while avoiding class-service self types. Core does not export layers or implementations for these
  tags. Core-owned port tag modules may export schema-backed input/output records, the
  `*Service` interface, the port identifier interface, and the tag constant; they do not export
  `make*`, `layer*`, mutable refs, resource acquisition, or host-path policy.

  This deliberately uses the v4 two-parameter function-style overload:
  `Context.Service<PortIdentifier, PortService>(id)`. The identifier type is the Effect
  environment requirement; the yielded/provided value is the service shape. Provider code types
  values as the exported `*Service` interface. Do not use `.of`, `Service["Service"]`, or
  `Context.Service.Shape<typeof Port>` for data-only port tags, even though function-style v4 keys
  expose generic key helpers.

- Package-local data-only host/config tags use the same function-syntax shape only when the owning
  package spec names the tag and the package-boundary tests ledger it. Some tags are package-private
  implementation tags; runtime bootstrap host ports are public only through the
  `@svvy/runtime/bootstrap` app-composition subpath named by `runtime.spec.md`. The approved
  package-local and runtime-bootstrap host/config tags are:
  - `@svvy/runtime/RuntimeLayerProviderAuthPort`
  - `@svvy/runtime/RuntimeLayerModelResolverPort`
  - `@svvy/runtime/RuntimeLayerCommandStdinPort`
  - `@svvy/runtime/RuntimeLayerCommandControlPort`
  - `@svvy/runtime/RuntimeGeneratedContextRefreshHostPort`
  - `@svvy/runtime/RuntimeGeneratedPackageRefreshHostPort`
  - `@svvy/runtime/RuntimeSourceInvalidationScanPort`
  - `@svvy/extensions/ExtensionSourceRootsPort`
  - `@svvy/extensions/GeneratedPackageRootPort`
  - `@svvy/extensions/WorkspaceSourceLinkPort`
  - `@svvy/extensions/PackagedExtensionTemplatesPort`
  - `@svvy/sandbox/SandboxHelperCandidatesPort`
  - `@svvy/sandbox/HostProcessReferencePort`

  Runtime bootstrap host ports in this list are public only through the
  `@svvy/runtime/bootstrap` app-composition subpath: app/bootstrap provides structural host values
  and `@svvy/runtime` consumes them. Other package-local host/config tags in this list are consumed
  only inside their owning package. All of these tags have no behavior-bearing implementation class
  and expose one explicit `*Service` interface. Providers install structural values with
  `Layer.succeed(Tag, service)` or `Layer.effect(Tag, makeService)`; they do not call `.of(...)`.
  If an unrelated package needs one of these contracts, promote the contract to `@svvy/core` in the
  same change. Runtime post-commit lanes, `RuntimeLayerConfigService`,
  `RuntimeStartupReadiness`, `RuntimeShutdownPreparation`, `RuntimeEventBus`,
  `RuntimeSourceInvalidationCoordinator`, `Extensions`, `Sandbox`, `PiAdapter`, state facades, and
  state stores are not data-only tags and remain class-style services.

  The runtime tags in this list are allowed on the public `@svvy/runtime/bootstrap` subpath only as
  app-edge composition ports. They adapt primitive host capabilities into `Runtime.layer`; they are
  not renderer APIs, facade groups, extension APIs, generated-package APIs, state facades, or owners
  of runtime semantics. Prompt cancellation, prompt dispatch, and surface queue wake/drain are not
  public bootstrap host ports; they stay package-private runtime behavior owned by retained surface
  scopes, `RuntimeQueueWakeService`, `RuntimeSurfaceQueueDispatcherService`, and
  `RuntimePromptExecutionService`.

- Service methods are normally accessed by yielding the service in `Effect.gen`. Use
  `Service.use(...)` only in the non-domain edge cases listed above and only when the resulting
  Effect is immediately returned or run. Use `Service.useSync(...)` only for pure synchronous edge
  accessors. Multi-step service methods yield the service in `Effect.gen` so requirements remain
  visible. svvy does not use static accessor proxies; read services with `yield* Service` so
  requirements stay visible, and do not use `Service.use` in a way that hides important service
  requirements from multi-step programs.
- Use `Effect.serviceOption(Service)` only at explicit optional adapter/bootstrap seams named by an
  owning package spec. Production use is limited to `@svvy/runtime` optional
  `RuntimeHandlerThreadStartPreparationHost` lookup in runtime-effect request handling and accepted
  `thread_start` native-tool execution, where app/bootstrap may compose the host before the full
  runtime host wiring is present. Domain services keep required dependencies in their environment
  instead of probing optional services; optional lookup maps absence into an intentional
  missing-host defect or typed product capability result named by the owning service.
- Reusable Effect-returning functions use named `Effect.fn("Package.Area.operation")(...)` when the
  call is a service, repository, worker, handler, bridge, command, or other observability boundary.
  Use unnamed `Effect.fn(function* ...)` only for local generic helpers where a name adds no useful
  observability. `Effect.fnUntraced` is installed-export-audited but not production-adopted for
  package code unless it is promoted in `packages/effect-adoption-manifest.ts`; package production
  code must not call it before that promotion. Avoid plain functions whose only body is `Effect.gen`.
- Service method implementations use the curried v4 form:
  `Effect.fn("@svvy/runtime/Runtime.messages.submit")(function* (...) { ... })`. Additional
  transforms that are proven by the installed-export audit are passed as extra arguments to
  `Effect.fn(...)`; do not attach those transforms to `Effect.fn(...)` with `.pipe(...)`.
- Effect service, worker, repository, stream, queue, handler, and generated-operation code does not
  use JavaScript `async`/`await` or `try`/`catch` inside `Effect.gen` or `Effect.fn` bodies. Use
  Effect constructors and recovery APIs instead:
  `Effect.try`, `Effect.tryPromise`, installed-audited recovery APIs such as `Effect.catch` and
  `Effect.catchCause`, `Exit` values captured at bridge/facade edges, and manifest-adopted
  `Cause` helpers. `Effect.exit` is production-adopted only in `RuntimeShutdownAdmission`, where one
  shutdown outcome must be shared with concurrent and repeated callers. Narrow
  tag/reason/filter recovery APIs such as `Effect.catchTag`, `Effect.catchTags`,
  `Effect.catchReason`, `Effect.catchReasons`,
  `Effect.catchFilter`, `Effect.catchIf`, `Effect.catchCauseIf`, and
  `Effect.catchCauseFilter` may be used only after both the installed-export audit and
  `packages/effect-adoption-manifest.ts` prove the exact member on the installed `effect/Effect`
  subpath. JavaScript `try` / `catch` is
  reserved for non-Effect host-edge code that is immediately wrapped before entering an Effect
  service boundary.
- Do not use JavaScript `try` / `finally` around `yield*` inside `Effect.gen` or `Effect.fn` for
  cleanup, lock release, state reset, resource finalization, or worker bookkeeping. Use
  `Effect.ensuring`, `Effect.acquireUseRelease`, `Effect.acquireRelease`, adopted `Ref` updates,
  scoped finalizers, or an explicit transaction helper so interruption and typed failure behavior
  are visible. `Effect.uninterruptibleMask` is production-adopted only in
  `RuntimeShutdownAdmission` with `restore(...)` around the bounded drain and in the runtime prompt
  dispatcher with `restore(...)` around the actual prompt fiber;
  `SynchronizedRef.modifyEffect` is not production-adopted unless exact manifest rows and focused
  tests exist. JavaScript `try` / `finally` is allowed only in
  pure synchronous host-edge code that is wrapped before entering an Effect service boundary.
- Terminal generator branches use `return yield* ...`. Do not write bare
  `yield* Effect.fail(...)`, `yield* new TaggedError(...)`, `yield* Effect.interrupt`, or
  equivalent terminal effects and then continue the generator. This applies inside `Effect.gen` and
  `Effect.fn`.
- Generator return annotations for `Effect.fn` use `Effect.fn.Return<A, E, R>`:

  ```ts
  const submit = Effect.fn("@svvy/runtime/Runtime.messages.submit")(function* (
    input: SubmitMessageInput,
  ): Effect.fn.Return<
    SubmitMessageResult,
    RuntimeContractError,
    RuntimeQueueStatePort | RuntimeReadModelStatePort
  > {
    // ...
  });
  ```

- Class/object service methods that need `this` use the v4 self-binding form
  `Effect.fn("Service.method")({ self: this }, function*(this: Service, ...args) { ... })`. Direct
  generator effects that need `this` use `Effect.gen({ self: this }, function*() { ... })`. svvy
  passes `this` through the options object, not as the first generator argument.
- Use unnamed `Effect.fn(function* ...)` for reusable generator functions that do not need a named
  trace boundary. Use named `Effect.fn` for operations that should form an observability boundary.
  Keep `Effect.fnUntraced` out of production code until the adoption manifest promotes it from
  audit-only to production-adopted status.
- Layers are small and composable. Do not build one giant root layer that hides package boundaries.
- A service class only has a static `.layer` when the class explicitly defines one. V4
  `Context.Service` does not auto-generate `.Default` or wire a `dependencies` option. Otherwise,
  export named layer values or layer factory functions with `Layer.effect` or `Layer.succeed`.
- Use `Context.Service<Self, Shape>()(id, { make })` only when the service has one canonical
  constructor effect whose required inputs are ordinary Effect service requirements, not caller parameters.
  Keep the constructor on the class only when that locality makes the service clearer. This still
  does not create a layer automatically; define `static readonly layer = Layer.effect(Service,
Service.make)` for a zero-argument constructor and wire dependencies with `Layer.provide(...)`.
  Use an external `makeService(input?)` function when construction needs explicit parameters,
  package-local host adapters, test override input, or multiple layer factories.
  `Context.Service({ make })` never replaces a named layer export, and `Context.Service` does not
  take a `dependencies` option; layer composition is the only dependency wiring mechanism.
- Primary service layers are named `layer`. Variants use descriptive `layer<Variant>` names such as
  `layerTest`, `layerConfig`, or `layerInMemory`. svvy-owned services use these names; they do not
  use `Default` layer names or `Live` suffixes. `Context.Service(..., { make })` never implies a
  layer; every service with a `make` constructor that is used across a package boundary declares its layer
  explicitly with `Layer.effect(Service, Service.make)` or an equivalent visible layer expression.
- `Layer.provide(...)` composes an implementation with dependency layers and hides those dependency
  services from the resulting layer output. Use it for ordinary package boundaries.

Current adopted service/layer examples:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class RuntimeQueueWakeService extends Context.Service<
  RuntimeQueueWakeService,
  {
    readonly wakeSurface: (input: WakeSurfaceInput) => Effect.Effect<void, RuntimeContractError>;
  }
>("@svvy/runtime/RuntimeQueueWakeService") {}

export const layerRuntimeQueueWakeService = Layer.effect(
  RuntimeQueueWakeService,
  Effect.gen(function* () {
    const queueState = yield* RuntimeQueueStatePort;

    return RuntimeQueueWakeService.of({
      wakeSurface: (input) =>
        Effect.gen(function* () {
          yield* queueState.recordWake(input);
        }),
    });
  }),
);

export const layerRuntimeQueueWakeServiceProvided = Layer.provide(
  layerRuntimeQueueWakeService,
  layerRuntimeQueueStatePort,
);
```

Data-only port tags use the function form and `Layer.succeed(...)` when the implementation is
already a plain object:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface RuntimeReadModelStatePortService {
  readonly publishInvalidations: (
    input: PublishInvalidationsInput,
  ) => Effect.Effect<void, StateContractError>;
}

export const RuntimeReadModelStatePort = Context.Service<
  RuntimeReadModelStatePort,
  RuntimeReadModelStatePortService
>("@svvy/core/RuntimeReadModelStatePort");

export const layerRuntimeReadModelStatePortTest = Layer.succeed(RuntimeReadModelStatePort, {
  publishInvalidations: () => Effect.void,
});
```

Effect-lane tests use only the adopted `@effect/vitest` helpers:

```ts
import { assert, describe, it, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

layer(Layer.provide(layerRuntimeQueueWakeService, layerRuntimeQueueStatePortTest))(
  "RuntimeQueueWakeService",
  (it) => {
    it.effect("wakes one surface", () =>
      Effect.gen(function* () {
        const service = yield* RuntimeQueueWakeService;
        yield* service.wakeSurface({
          target: {
            workspaceSessionId: "wsess_orch_01" as WorkspaceSessionId,
            surface: "orchestrator",
            surfacePiSessionId: "pi_orch_01" as SurfacePiSessionId,
          },
          reason: "message-submitted",
        });
        assert.strictEqual(true, true);
      }),
    );
  },
);
```

- `Layer.provideMerge(...)` is production-adopted only in the exact source-gated file
  `packages/runtime/src/index.ts`, as named in `packages/effect-adoption-manifest.ts`. Its product
  use case is retaining package-private dependency services while assembling the runtime-internal
  service bundle: generated refresh, source invalidation, waits, event publication, prompt defaults,
  workspace scope, and launch-policy services are composed into one package-private
  `runtimeInternalServicesLayer`. The exported public root layer must still hide that internal
  bundle with `Layer.provide(...)`, so consumers receive only the package's public services, layers,
  ports, and facades named by the package spec. Do not use `Layer.provideMerge(...)` to expose
  dependency services across package boundaries, to let one public sibling layer accidentally satisfy
  another sibling, or to avoid naming a concrete internal layer. Test-only entrypoints may use it
  only where package-boundary checks permit local harness patterns that must access both the service
  under test and the provided fixture/handle service.
- `Layer.mergeAll(...)` composes independent or already-fully-provided sibling layers. Do not rely
  on one sibling in a `Layer.mergeAll(...)` call to satisfy another sibling's requirements. Wire
  dependencies with `Layer.provide(...)` first, then merge the fully provided outputs that the next
  package or app layer actually needs. When the same dependency layer value is intentionally reused
  in more than one provided subtree, v4 memoization shares it inside the same runtime memo map; do
  not create fresh equivalent layer expressions and expect them to share state.
- `Layer.suspend(...)` is installed but not production-adopted. Lazy layer selection or recursive
  layer definitions must use existing adopted layer factories/composition, or promote
  `Layer.suspend` through `packages/effect-adoption-manifest.ts`, package-boundary allowlists, and
  focused tests in the same change.
- When two package sublayers must share one scoped dependency, the owner constructs that dependency
  layer once in the enclosing module or layer factory scope and reuses that exact layer value in
  every `Layer.provide(...)`. Calling the same layer factory twice creates distinct layer values and
  is not a sharing contract, even if the arguments are equal. Any package layer that depends on
  shared scoped state, SQL handles, queues, pubsubs, process spawners, or fake handles has a focused
  acquisition/finalizer test proving the dependency is acquired once and finalized once per owner
  scope.
- Layer composition is explicit at package and app bootstrap boundaries even though Effect v4 shares
  layer memoization across `Effect.provide` calls that use the same current memo map. Separate
  `ManagedRuntime.make(...)` calls are not a product sharing mechanism. svvy production code creates
  one app-owned `ManagedRuntime`; explicit shared memo-map harnesses require same-patch manifest
  adoption and focused tests before use outside exact test helper globs listed by package-boundary
  checks. `Effect.provide(layer, { local: true })` is test-only unless the owning package spec names
  the isolated resource subtree, owner, lifetime, and isolation test. `Layer.fresh` requires
  manifest and boundary-test promotion before any use.
- Specs and resource matrices may use `layer-acquired` as a `svvy` lifetime label for resources
  acquired by a package/app layer and released when that layer scope closes. Do not turn that label
  into `Layer.scoped` usage. In Effect v4, layer-owned acquisition is represented by adopted
  service constructors such as `Layer.effect(...)` whose effect may require `Scope.Scope`, or by
  scoped effects promoted by exact manifest rows, with cleanup registered through
  `Effect.acquireRelease(...)` or `Effect.addFinalizer(...)`. `Layer.effectContext` remains
  unavailable for production until promoted in the manifest and boundary tests. Use
  `Scope.addFinalizer(...)` only when the implementation has explicitly acquired the target
  `Scope.Scope` and must attach cleanup to that specific scope. `Effect.scoped(...)` remains
  audit-only for production package code until promoted; do not use it inside a layer constructor
  for a resource that must live with the layer.
- State-backed port layers are zero-argument layer values that require the shared state package
  service they project from, normally `StructuredSessionState`, and provide exactly one core-owned
  port tag or an explicitly named aggregate. App/bootstrap provides those port layers with the same
  acquired `@svvy/state` layer identity. They must not call the state layer factory, SQLite client
  layers, migrator layers, secret-store construction, or database-opening helpers internally. All
  state-backed port tags in one app bootstrap share the same scoped state/database resources unless
  named test isolation uses exact test helper globs listed by package-boundary checks.
  `Layer.fresh` and explicit shared memo-map isolation require manifest and boundary-test promotion
  before production use.
- A state-port adapter layer is an ordinary layer that requires state-package services and provides a
  core-owned port tag, for example
  `Layer.effect(RuntimeQueueStatePort, Effect.gen(function* () { const state = yield*
StructuredSessionState; return runtimeQueueStatePortFromStructuredSessionState(state); }))`.
  Adapter layers do not call `Layer.build`, `ManagedRuntime.context()`, `ManagedRuntime.make`, state
  layer factories, or database-opening helpers internally.
- Long-lived resources are scoped. A workspace runtime scope, surface runtime scope, watcher, pi session,
  subprocess, and bridge subscription must have an explicit scope/finalizer.
- Product resource scopes follow one ownership hierarchy: app-global source invalidation and
  generated-package refresh live directly under the app `ManagedRuntime`, while first-open or
  acquired workspaces create only keyed child scopes for workspace-local coordination and link
  repair.

  ```text
  app ManagedRuntime layer scope
    app-global runtime scopes
      app-global source coordinator
      app-global generated-package refresh worker
      app-global recovery / event / readiness scopes
    workspace runtime scope
      workspace source coordinator
      workspace generated-package link-repair scope
      workspace recovery / queue-worker scopes
      surface runtime scope
        pi session scope
        active turn scope
          tool / command / blocking-wait child scopes
    bridge/facade subscription scopes owned by the caller
  ```

  Closing a parent scope closes every child scope. A surface runtime scope may have multiple desktop panes
  or bridge consumers, but it has one surface scope; reference counting or equivalent state lives in
  runtime, not in the UI. The last consumer release may close the surface scope only when runtime
  policy says the live surface should be disposed. If that release occurs during an active prompt,
  runtime retains the entry at zero references until the prompt finalizer clears the active fiber,
  then closes the pi session and child scope. Closing the runtime layer interrupts and joins any
  remaining active prompt before closing every remaining pi session and child scope.
  Command/process scopes live under their owning
  turn or command-session service, not directly under the UI pane that first displayed them.

- Manual runtime child scopes use `Scope.fork(parentScope, finalizerStrategy?)` so parent shutdown
  closes the child with the same `Exit`. Closing the child before the parent detaches that child
  from the parent. Use independent `Scope.make` only for bridge/facade scopes whose lifetime is
  owned outside the current parent scope and that are explicitly closed with `Scope.close`.
  `Scope.forkUnsafe` is installed but not production-adopted; production code uses `Scope.fork`
  through Effect unless the same change promotes the unsafe constructor with owner/lifetime matrix
  entries, package-boundary allowlists, and deterministic cleanup tests. Use
  `Effect.provideService(Scope.Scope, scope)` when running work in an explicit manually owned
  scope; `Scope.provide` and `Scope.use` remain audit-only until promoted through the manifest and
  package-boundary tests.
- `Scope.makeUnsafe` is installed but not production-adopted. Production code uses `Scope.make`,
  `Scope.fork`, and `Scope.close` through Effect. Unsafe scope constructors require same-patch
  manifest promotion, owner/lifetime matrix entries, package-boundary allowlists, and deterministic
  cleanup tests.
- `Scope.closeUnsafe` is installed reference vocabulary only. Production code does not call it
  because ignoring the returned Effect skips registered finalizers; use `Scope.close(scope, exit)`
  through the app-owned `ManagedRuntime` instead.
- Scope finalizer strategy is a concrete shutdown policy. `Scope.fork(parentScope, "sequential")`
  closes finalizers sequentially in reverse registration order and is the default choice when
  child resources depend on parent-provided handles or ordered shutdown matters.
  `Scope.fork(parentScope, "parallel")` is allowed only for independent resources whose finalizers
  may safely run concurrently. Package specs for app, workspace, surface, watcher, subprocess, and
  bridge scopes name which strategy they use when manual child scopes are created.
- Runtime, workspace, surface, watcher, queue-worker, and command fibers use the manifest-adopted
  `Effect.forkIn(scope)` form for scoped worker ownership. `Effect.forkScoped` is test-only under
  the current manifest and may be read only from the listed Effect test globs. `Effect.forkChild` is
  an audited v4 API only. Production use of either member requires exact manifest promotion,
  boundary tests, and focused lifecycle tests.
  `Effect.forkDetach` is not allowed in package/domain services, runtime workers, stream consumers,
  protocol loops, or bridge subscriptions. It is allowed only at an app/process edge with a named
  shutdown handle and test coverage proving the detached fiber is stopped before app runtime
  disposal. Normal owned worker lifetime uses `Effect.forkIn(ownerScope)`.
  Fork options are part of the owner contract: ordinary workers omit eager-start options unless the
  owner has named a product reason to attach before the next effect step, `startImmediately: true`
  is used only when the owner then awaits a typed attachment/readiness receipt, and
  `uninterruptible` stays limited to bounded commit/release regions.
- `Effect.acquireRelease` finalizers are infallible cleanup paths. Close/dispose failures in
  service-lifetime finalizers are converted to logs, metrics, app-log facts, or already-modeled
  typed facts before the finalizer returns; they are not leaked as finalizer failures. Use
  `Effect.acquireUseRelease` only for one-shot bracketed operations where release failure is part of
  the operation result and may fail the returned effect. Do not use `acquireUseRelease` for
  long-lived layer/service lifetime cleanup unless the package spec explicitly wants release
  failure to mask, join, or otherwise affect the use result.
- `LayerMap.Service` and `LayerMap.make` are reference-only for svvy production code. Do not
  use them for workspace runtime scopes, surface runtime scopes, pi sessions, provider instances,
  command sessions, bridge subscriptions, source coordinators, or generated-package readiness.
  Current dynamic runtime resources use runtime-owned keyed child scopes and package-private scope
  managers. If a future owner adopts `LayerMap` for a different keyed resource, that same change
  must add exact manifest members, package-boundary allowlists, owner/spec text, key
  identity/serialization rules, acquisition and release semantics, idle behavior, shutdown and
  recovery behavior, and focused tests. Until then, `.get(key)`, `.contextEffect(key)`,
  `.invalidate(key)`, `.layer`, `.layerNoDeps`, `preload`, and `preloadKeys` examples from
  `effect-smol` remain non-production reference material.
  Invalidating a key prevents reuse and affects future acquisition; it does not revoke an already
  borrowed scoped context. The reference `RcMap.invalidate` path removes the map entry and closes the
  resource only when the reference count is already zero. Active borrowers remain valid until their
  scopes close unless the owner explicitly interrupts that owner scope.
- Dynamic many-instance runtime objects are not modeled as one `Context.Service` tag per materialized
  instance. A `Context.Service` tag is singleton-per-runtime; svvy uses it for the registry/manager
  that owns a keyed map, not for each workspace runtime scope, pi session, provider instance,
  command session, bridge connection, or extension process handle. Per-instance objects are plain
  records or captured closures keyed by durable/product ids, and their lifecycle is owned by the
  registry service and its scope. This follows the local `t3code` provider driver reference:
  `ProviderDriver` and `ProviderInstance` are plain records while `ProviderInstanceRegistry` is the
  singleton Effect service that owns the live `Map<InstanceId, ProviderInstance>`; the Codex adapter
  reference keeps only a shape interface because each adapter is bundled into the captured
  per-instance driver closure.
- Package-private keyed scope-manager acquisition for per-workspace or per-surface resources must
  create or reuse the scoped child resource for that exact durable key. Do not return one shared
  mutable scoped service instance for multiple durable keys unless sharing is explicitly intended
  and named by the package spec. Shared dependencies inside keyed resources may still be memoized by
  the app/runtime memo map.
- Workspace and surface runtime scope resources are acquired only by runtime-owned
  workspace/surface owner scopes. Facade methods may borrow an already owned workspace/surface
  runtime through runtime services, but they must not acquire keyed workspace/surface scope resources
  per call unless the call is the explicit lifecycle operation that opens that owner scope. Closing
  the owner scope, invalidating the key, idle TTL, or app shutdown releases the resource. Dockview
  panes, renderer subscriptions, browser tools, and read-model refetches never call package-private
  workspace/surface scope-manager acquire, borrow, release, or invalidate methods; they attach
  through runtime facades and events so multiple panels can observe one live surface without creating
  or closing runtime resources from UI lifecycle. The only release paths are owner-scope close,
  explicit key invalidation, configured idle TTL, or app
  `ManagedRuntime` disposal; UI panes, subscriptions, refetches, and facade calls are never release
  owners.
- In the shipped product process, `ManagedRuntime` is created only by product app bootstrap, exactly
  once per healthy app-runtime instance. Explicit non-product integration/e2e harnesses and named
  edge harnesses may create their own runtimes only outside the shipped product runtime path and must
  own shutdown. Production bridge/facade modules adapt a caller-owned `ManagedRuntime`; they do not
  create one. Domain services, package facades, state repositories, runtime workers, extension
  handlers, pi-adapter services, and sandbox services do not create runtimes.
- Non-edge package code must not call any `Effect.run*` runner (`runPromise`, `runPromiseExit`,
  `runCallback`, `runFork`, `runSync`, and their `*With` / `*Exit` variants),
  `ManagedRuntime.make`, `Layer.launch`, or platform `runMain` helpers. Running effects is a product
  app-bootstrap responsibility, a bridge/facade responsibility over the caller-owned app runtime, an
  app-owned CLI/process-entry responsibility, or an approved facade/integration-test responsibility.
  The allowed runner zones are app/process bootstrap, app-owned CLI entrypoints, bridge/facade modules adapting
  a caller-provided runtime, explicit app-bootstrap or facade integration/e2e harnesses, and
  package-boundary-approved test harnesses for non-Effect framework edges. Ordinary service tests,
  package services, state repositories, runtime workers, extension handlers, pi-adapter services,
  and sandbox services do not run effects manually.
- The one product package exception is the `@svvy/pi-adapter` pi callback bridge inside
  `turns.run(...)`. When pi's native event subscription and custom-tool APIs require callback or
  Promise interop, the adapter may construct a turn-scoped callback runner from the current turn
  Effect context only for queueing normalized pi subscription events and for the Effect returned by
  `RunPiTurnInput.toolExecutor`. This runner is package-private, bound to the active turn stream
  close path, never creates or receives a `ManagedRuntime`, never runs arbitrary package effects
  outside event queueing and the tool executor, maps `Exit` into callback results, and has boundary
  tests for the exact file allowlist. This exception does not allow package-level runners,
  per-request runtimes, app-bootstrap-injected runner services, or public callback facades.
- Do not import `effect/Runtime` for service execution. Effect v4 does not provide a `Runtime<R>`
  service-execution value; code that needs to run effects uses a caller-owned `ManagedRuntime` at a
  framework edge. Advanced harness code that must fork with inherited services uses `Effect.context`
  and `Effect.runForkWith(services)` only inside that explicit edge.
- `effect/Runtime` process helpers are not production-adopted unless the same change adds an installed-export
  audit row, package-boundary allowlists for exact app/process adapter files, and focused lifecycle
  tests. If adopted, the only allowed value reads are `Runtime.makeRunMain`,
  `Runtime.defaultTeardown`, `Runtime.errorExitCode`, `Runtime.errorReported`,
  `Runtime.getErrorExitCode`, and `Runtime.getErrorReported`. Domain packages and bridge facades
  use caller-owned `ManagedRuntime` surfaces instead.
- Do not import or model `RuntimeFlags`, `FiberRef`, or `FiberRefs` as package architecture
  contracts. `Context.Reference` and `effect/References` are not production-adopted unless exact members are
  promoted in `packages/effect-adoption-manifest.ts`, boundary allowlists, and focused tests. Current
  production UTC timestamping uses adopted `DateTime.now` plus `DateTime.formatIso`, with
  `DateTime.addDuration` for persisted elapsed-duration retry instants, or explicit injected
  timestamp inputs. `DateTime.CurrentTimeZone`, `DateTime.withCurrentZone*`, and
  `DateTime.layerCurrentZone*` are not production-adopted unless exact `DateTime` members are adopted and tested.
  Other runtime defaults are ordinary explicit `svvy` services or app-edge layers/effect
  provisioning before running work. `ManagedRuntime.make(...)` options are limited to layer
  memoization.
- `Runtime` in svvy examples is a product service name, not `effect/Runtime`. Package code may choose a less ambiguous class name such as
  `RuntimeService` when local naming would otherwise confuse the product service with Effect
  internals.
- The shipped product app graph has exactly one app-bootstrap `ManagedRuntime`. Non-product
  bootstrap/facade/e2e harnesses may intentionally create more than one `ManagedRuntime` over the
  same layer graph only when the harness names why shared acquisition is under test. Shared
  `Layer.makeMemoMapUnsafe()` memo-map harnesses are not production-adopted unless the same change adds
  installed-export audit coverage, package-boundary allowlists for exact harness files, and focused
  acquisition/finalizer tests. Per-request runtimes, per-window app runtimes, and per-request memo
  maps are invalid.
- When an explicit shared memo map is passed to more than one
  `ManagedRuntime.make(..., { memoMap })` or layer-build harness, resource finalization is
  observer-counted by Effect. Disposing one observing runtime/scope detaches that observer, but
  shared resources are released only after every observing runtime/scope using that memo map is
  closed. Shared memo maps are therefore allowed only for explicit non-product harnesses that name
  all owners and close every observer in tests. Product app/bootstrap does not use shared memo maps
  to create multiple product runtimes; it owns exactly one healthy app `ManagedRuntime` at a time.
- `Layer.effectDiscard` is an installed Effect API, but it is non-adopted for svvy until the same
  patch adds installed-export audit coverage, package-boundary allowlists for exact edge files, and
  focused tests. If adopted, it is allowed only in app/bootstrap, named process entrypoints, and
  explicit integration/e2e/facade harnesses for finite construction effects or scoped worker forks
  with close receipts. Ordinary package worker startup uses a named service layer that exposes
  readiness, drain, and shutdown receipts. If an adopted edge uses `Layer.effectDiscard`, the
  effect must be finite or must fork long-lived work with the exact scoped-fork primitive adopted in
  `packages/effect-adoption-manifest.ts` and return promptly. `Effect.forkScoped` requires exact
  manifest promotion before production use. The owner documents the scope, shutdown path, and test
  that closes the scope.
- `LayerMap.Service` constructor details from `effect-smol` are not product architecture.
  Runtime-owned declarations should describe package-private keyed child scope managers, explicit
  readiness receipts, owner scopes, release paths, and recovery behavior. Do not describe
  `LayerMap` `lookup`, static `layers`, `dependencies`, `preload`, `preloadKeys`, `.layer`,
  `.layerNoDeps`, `.get(key)`, `.contextEffect(key)`, or `.invalidate(key)` as target runtime
  implementation details unless a same-change architecture update adopts LayerMap for a specific
  non-current owner.
- `Cache` and `ScopedCache` store lookup exits, including failures, according to their configured
  TTL/invalidation policy. Owners of caches used for provider metadata, CLI requirement checks, host
  probes, or scoped helper clients must specify capacity, TTL policy, and explicit invalidation
  triggers. Distinct success/failure TTL behavior must use `Cache.makeWith` or
  `ScopedCache.makeWith` and decide from the `Exit` passed to the single exit-aware
  `timeToLive(exit, key)` option; fixed-TTL `make` constructors expose only one `timeToLive`
  setting. They must also specify `requireServicesAt`: construction-time capture is
  allowed only when the owning service/layer also owns the lookup dependencies; use
  `requireServicesAt: "lookup"` when each caller scope must provide those services. Failure TTLs
  are short or actively invalidated for transient failures so one provider/network/CLI/protocol error
  cannot poison product readiness longer than intended.
- `Resource` from `effect/Resource` is not adopted for product code. Production imports are
  forbidden unless an owning package spec names a scoped, refreshable, process-local value whose
  latest acquisition result is safe to reread, such as a host capability probe or provider metadata
  probe. `Resource` values are created inside an owner scope. `Resource.get` may fail with the
  stored acquisition error. `Resource.refresh` delegates to `ScopedRef.set`, so it closes the
  previous value's scope before acquiring the replacement. If
  acquisition fails, the previous result may still be readable, but previous scoped resources have
  been finalized; use `Resource` only for reread-safe data/probes, not no-gap live clients.
  `Resource` is not durable product state and must not replace
  generated-context readiness, source fingerprints, build readiness, surface stale state, read
  models, command facts, app logs, or recovery records.
- `Resource.manual` adoption records do not name TTL or capacity because `Resource` is not a cache.
  They name owner scope, explicit refresh triggers, stale-read policy, failed-refresh behavior,
  invalidation/release owner, and deterministic tests. Use `Cache.makeWith` or
  `ScopedCache.makeWith` only when TTL, capacity, and cached failure semantics are the intended
  contract.
- Tests do not create ad hoc runtimes for ordinary service testing. Pure schema/contract tests stay
  in the Bun unit lane; Effect service/layer tests use the adopted `@effect/vitest` lane and test
  layers.

### Service, Layer, And Scope Example

The example uses one named state port. It must not be read as an umbrella runtime-state service.
This is owner-policy pseudocode for a dispatcher implementation. It intentionally avoids
naming exact Effect members that are not already adopted or audited for this lane. A production
dispatcher patch must use installed-verified members and add the matching manifest,
package-boundary, owner-spec, and focused-test rows. Until that promotion, production
implementations are limited to manifest-adopted queue/ref/scoped-fork primitives.

```ts
export class RuntimeSurfaceQueueDispatcherService extends Context.Service<
  RuntimeSurfaceQueueDispatcherService,
  {
    acceptWakeHint(input: QueueWakeup): Effect.Effect<void, RuntimeContractError>;
    drain(input: DrainSurfaceQueueInput): Effect.Effect<void, RuntimeContractError>;
  }
>()("@svvy/runtime/RuntimeSurfaceQueueDispatcherService") {
  static readonly layer = Layer.effect(
    RuntimeSurfaceQueueDispatcherService,
    Effect.gen(function* () {
      const queueState = yield* RuntimeQueueStatePort;
      const turnState = yield* RuntimeTurnStatePort;
      const surfaceScopes = yield* RuntimeSurfaceScopeManager;

      const acceptWakeHint = Effect.fn(
        "@svvy/runtime/RuntimeSurfaceQueueDispatcherService.acceptWakeHint",
      )(function* (input: QueueWakeup) {
        yield* enqueueCoalescedWakeHint(input);
      });

      const drain = Effect.fn("@svvy/runtime/RuntimeSurfaceQueueDispatcherService.drain")(
        function* (input: DrainSurfaceQueueInput) {
          const surface = yield* surfaceScopes.acquire(input.target.surfacePiSessionId);
          yield* claimAndDispatchRows({ queueState, turnState, surface, target: input.target });
        },
      );

      return RuntimeSurfaceQueueDispatcherService.of({ acceptWakeHint, drain });
    }),
  );
}
```

Workspace and surface runtime scope resources are scoped child resources inside the one app-owned
`ManagedRuntime`. Runtime scope ownership is a package-private runtime scope manager with explicit
acquire/release methods, readiness receipts, durable-id validation, shutdown behavior, and focused
lifecycle tests. It never creates `ManagedRuntime` values, never exposes public facades, and must
not be confused with the app-side `WorkspaceRuntimeRegistry` record that tracks opened desktop
workspaces.

Do not use `LayerMap.Service` examples as the target shape for workspace or surface runtime scopes.
If `effect/LayerMap` is ever adopted for a different keyed resource, include that resource's exact
owner, key type, acquisition layer, release and idle semantics, recovery behavior, manifest rows,
and boundary tests in the same change.

## Runtime Flow Phase Ownership

The main agentic flow is one package-owned Effect program with edge facades around it. Each phase
has one policy owner and one durable source of truth:

| Phase                            | Owner                                                                 | Effect surface                                                                                                                                                                          | Durable/product-state source                                                                       | Forbidden shortcut                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| App bootstrap                    | app/bootstrap                                                         | Compose package layers once, create one `ManagedRuntime`, call `context()` and complete bootstrap readiness before exposing facades                                                     | app config, packaged paths, state database path                                                    | per-request runtimes, hidden global services, package code creating the app runtime                                          |
| User prompt submission           | `@svvy/runtime`                                                       | `Runtime.messages.submit(...)` service method, Promise facade over the app runtime                                                                                                      | `@svvy/state` surface/session/profile/queue ports                                                  | renderer prompt assembly, direct pi calls, writing transcript history before delivery                                        |
| Durable queue insertion          | `@svvy/runtime` through `@svvy/state`                                 | short transaction effect plus after-commit invalidation                                                                                                                                 | SQLite queue row and composer draft/read-model rows                                                | Effect `Queue` as persisted queue, UI-owned queue state                                                                      |
| Queue wakeup and claim           | `@svvy/runtime`                                                       | `RuntimeQueueWakeService.wakeSurface({ target, reason })` for process-local wake hints; `RuntimeSurfaceQueueDispatcherService` for claim/drain; short uninterruptible claim transaction | SQLite queue row claim/lease/status                                                                | treating process-local wake hints as the source of truth, relying on every wakeup value, claiming inside pi turn transaction |
| Generated-context refresh        | `@svvy/runtime` orchestrates, `@svvy/extensions` renders              | runtime calls extension services, state persists binding facts                                                                                                                          | source fingerprints, generated-context binding rows, optional cache files                          | desktop prompt inspection payloads as source of truth, rewriting active turn context mid-turn                                |
| Pi turn setup and stream         | `@svvy/pi-adapter` for pi adaptation, `@svvy/runtime` for turn policy | scoped pi session effect and `Stream<PiRuntimeEvent, PiAdapterError>`                                                                                                                   | pi session reference rows, turn/queue/stream patch rows                                            | pi-native types crossing packages, adapter owning queue/tool policy                                                          |
| Native tool declaration          | `@svvy/extensions`                                                    | service methods return pi-free declarations and metadata                                                                                                                                | extension source, actor bindings, readiness facts                                                  | runtime hard-coded tool catalogs, desktop-provided tool schemas                                                              |
| Tool invocation routing          | `@svvy/runtime`                                                       | runtime validates accepted tool call and calls extension handler effect                                                                                                                 | command row, tool-call id, prompt execution context                                                | extension handler publishing runtime events or mutating unrelated targets                                                    |
| Extension handler semantics      | `@svvy/extensions`                                                    | typed handler effect returning `ExtensionHandlerResult` with ordered `ExtensionRuntimeOperation` items wrapping `runtime_effect` requests or `execution_plan` values                    | extension source and state-backed extension ports                                                  | extension claiming queues, creating panes, scheduling recovery, launching sandboxed long-running sessions directly           |
| Command and subprocess execution | `@svvy/runtime`                                                       | scoped command-session service, child-process services, streams, cancellation finalizers                                                                                                | command/session rows, output rows, artifact metadata                                               | raw process handles in state, shell strings where command descriptions exist, extension-owned durable command lifecycle      |
| Runtime effect application       | `@svvy/runtime`                                                       | closed algebra dispatcher using state/sandbox/pi/extensions services as needed                                                                                                          | state transactions, handler-thread episode recording/conclusion, and generated package/build facts | arbitrary `Record<string, unknown>` requests, direct runtime service calls from extensions                                   |
| Event publication                | `@svvy/runtime`                                                       | runtime replay ring plus per-subscriber `Queue` exposed through `Stream` subscriptions after commits                                                                                    | committed state rows and live scoped stream patch state                                            | treating replay buffers as durable event history                                                                             |
| UI/headless consumption          | `@svvy/desktop` or another consumer                                   | Promise/callback/`AsyncIterable` facades over one `ManagedRuntime`                                                                                                                      | state read-model facades plus runtime notifications                                                | UI-owned product lifecycle, runtime events containing read-model snapshots                                                   |
| Shutdown and recovery            | `@svvy/runtime`, state, app/bootstrap                                 | scope finalizers; target `FiberHandle`/`FiberMap`/`FiberSet` and `ScopedRef` replacement finalization only after exact manifest adoption; recovery scans and leases                     | recovery rows, terminal command/queue/turn facts                                                   | orphaned fibers, relying on pre-restart process-local `Deferred`/`Ref` state after restart                                   |

This table defines phase ownership, not the complete prompt-turn execution algorithm. The
authoritative ordering for message submission, queue claim, turn dispatch, pi stream consumption,
accepted tool execution, runtime operation application, state commit, notification, UI refetch, and
recovery is the `@svvy/runtime` main prompt-turn program. Effect primitives implement that
sequence; they do not replace the durable state and recovery boundaries named there.

`SubscriptionRef` belongs only to package-local, process-local latest-value snapshots where replaying
the current value to a late subscriber is the intended behavior. It must not be exported as a public
runtime event contract, used as durable read-model state, used as command facts or app logs, used as
queue delivery, or used as the desktop bridge contract. Public consumers receive typed runtime
notifications and then refetch state-owned read models.

A behavior is package-owned only when all of the following service, schema, error, scope, and test
contracts exist:

- the package owner, service name, service id string, public layer name, and test layer name
- exact input/output schemas or typed service-only shapes
- exact typed error channel and boundary error mapping
- whether the behavior is file-backed, DB/product-state-backed, process-local, or generated output
- scope owner and finalization behavior for every resource, stream, queue, pubsub, fiber, watcher,
  subprocess, session, or subscription
- lifetime kind for every resource-owning service or port:
  - `layer-acquired`: acquired by a package/app layer and released when that layer scope closes.
  - `keyedOwnerScoped`: acquired by a runtime-owned keyed owner scope and released by owner
    scope close, key invalidation, idle TTL, or app runtime disposal.
  - `operationScoped`: acquired for one service method or command operation and released before the
    operation completes, fails, or is interrupted.
  - `appBootstrapScoped`: created by product app/bootstrap outside the package layer graph and
    released by startup-failure or app-shutdown disposal. It owns the app layer scope rather than
    being acquired by that scope.
  - `durableGeneratedOutput`: app-owned generated package files, manifests, and generated-output
    roots produced by an operation-scoped app-global build effect and reused after the producing
    scope closes; released only by explicit replacement, cleanup, or uninstall. Layer/app runtime
    disposal closes open handles and workers, but does not delete successful generated output.
  - `workspaceGeneratedPackageLink`: workspace `.smithers/node_modules/@svvyx/*` link entries
    produced by an operation-scoped runtime-owned workspace link-repair effect from an immutable
    extension-produced link plan. They are reused after the producing scope closes and released only
    by explicit workspace-link replacement, workspace cleanup, package unlink, or workspace removal.
    They are not app-owned generated output and their successful creation does not make an
    app-global generated-package build result more or less authoritative.
  - `activeTurn`: acquired for one prompt-bearing pi turn after the durable turn claim and prompt
    lock exist, and released when that turn reaches terminal success, failure, cancellation, timeout,
    or parent surface shutdown.
  - `commandSession`: acquired for one accepted runtime command or subprocess session after command
    state has been created, and released when the command terminal fact commits, cancellation
    terminalizes it, or runtime shutdown records recovery/terminal facts.
  - `bridgeSubscriptionScoped`: acquired for one facade/bridge subscription and released when the
    iterator/callback/subscription closes.
  - `testFixtureScoped`: acquired by a test layer or test fixture and released by the test scope.
    The spec entry must name the acquiring effect/layer, release path, whether reuse across calls is
    allowed, and whether interruption closes the resource or only cancels the current operation.
- event/notification behavior, including which state transaction commits before publication
- whether a non-Effect facade is required, and if so which caller-owned `ManagedRuntime` it uses

Do not introduce broad policy categories, clever service wrappers, or preview/summary fields to
make a promotion feel complete. A service exists because a concrete product flow needs that owner,
that data contract, and that resource lifetime.

Every package spec that owns a scoped resource includes a resource-lifetime matrix with these exact
columns:

| Resource | Owner package/service | Backing kind | Lifetime kind | Acquired by | Released by | Reused across calls | Interruption behavior | Required receipts/tests |
| -------- | --------------------- | ------------ | ------------- | ----------- | ----------- | ------------------- | --------------------- | ----------------------- |

`Backing kind` is one of file-backed, DB/product-state-backed, process-local, generated output, or
host resource. `Released by` names the exact owner-scope close, key invalidation, idle TTL,
terminal fact, subscription close, or app runtime disposal path. Package specs must fill this matrix
for every concrete resource they own, including app runtime, workspace runtime scope, surface runtime scope, pi
session, active turn, command session, source coordinator, file watcher, generated-package worker,
runtime event hub, bridge subscription, protocol/helper process, provider/helper client, cache,
pool, and temporary file/directory. A resource without this row is not promoted into the Effect
package architecture.

For scoped resources, each row also states the finalizer exit source: program exit, explicit
unsubscribe `Exit.void`, typed failure/interruption exit, or app-runtime disposal `Exit.void`. When
the close exit is `Exit.void` but product behavior distinguishes shutdown, cancellation, timeout, or
forced disposal, the row names the service method or shutdown step that records those facts before
the scope is closed.

## Package-To-Package API Rules

- The primary API between public `@svvy/*` implementation packages is an Effect service method or an
  Effect stream. Promise-returning APIs are facades only.
- Package-boundary ports are Effect service contracts unless they are pure data contracts owned by
  `@svvy/core`. A package may expose a facade only at non-Effect edges, and that facade is a
  mechanical adapter over a caller-owned `ManagedRuntime`. Test doubles are layers, not ad hoc
  objects passed around call sites. Each package spec names its primary service, public layer,
  optional facade factory, typed public errors, schema-backed inputs/outputs, stream ownership, and
  test layer names before implementation is considered promoted.
- `@svvy/core` may define data-only port input/output schemas, structural request/result contracts,
  and the `Context.Service` tags for cross-package ports consumed by packages that must not import
  the implementation package. Core-owned state-port service tags are exactly
  `RuntimeWorkspaceStatePort`, `RuntimeSurfaceLifecycleStatePort`,
  `RuntimeComposerDraftStatePort`, `RuntimeQueueStatePort`, `RuntimeTranscriptStatePort`, `RuntimeTurnStatePort`,
  `RuntimeCommandStatePort`, `RuntimeApprovalStatePort`,
  `RuntimeActorExtensionBindingStatePort`, `RuntimeEpisodeStatePort`, `RuntimeExtensionStatePort`,
  `RuntimeExtensionContextImpactStatePort`, `RuntimeGeneratedPackageStatePort`,
  `RuntimeArtifactStatePort`, `RuntimePromptDefaultsStatePort`, `RuntimeRecoveryStatePort`,
  `RuntimeReadModelStatePort`, `RuntimeRequestStatePort`, `RuntimeSessionWaitStatePort`,
  `RuntimeSourceStatePort`, `RuntimeThreadStatePort`, `ExtensionStatePort`,
  `SandboxPolicySource`, `ProviderAuthStatusStatePort`, `PiSessionReferencePort`,
  `PiRuntimePathsPort`, and `AppLogWritePort`. `ProviderAuthPort` and `SecretStorePort` are
  core-owned host/live service tags. Implementations, layers, resources, store handles, host-path
  resolution, live credential resolution, secret resolution, and lifecycle policy are owned by
  `@svvy/state`, app bootstrap, or the adapter package that provides the port. State-backed ports
  come from the shared `@svvy/state` layer; host/live credential and secret ports come from
  app/bootstrap host adapters.
- Effect-native package service APIs may return `Option.Option<T>` for optional lookups when the
  caller is also Effect-native, such as `findSurface(...)`, optional provider metadata, or optional
  source records. Public Promise facades, Electrobun RPC payloads, renderer read models,
  persistence rows, generated packages, command facts, app logs, and runtime events do not expose
  `Option`; they encode absence as `null`, an omitted optional field, or a discriminated union.
  Choose one representation per contract and encode/decode it through `@svvy/core`.
- `Result.Result<A, E>` is internal to pure parse/classification helpers and reference-derived
  utilities. `Option.Option<T>` is allowed for Effect-native optional lookups. They are not public
  failure channels for package services. Convert them before crossing package, RPC, persistence,
  runtime-event, command-fact, app-log, generated-package, or UI boundaries. Production
  Option value use is limited to exact manifest-adopted helpers such as `Option.some(...)` for
  construction, `Option.isNone(...)` for absence checks, and `Option.getOrElse(...)` for converting
  Effect-native optional lookup results to explicit non-secret, contract-owned defaults before
  crossing package, facade, persistence, runtime-event, command-fact, app-log, generated-package, or
  UI boundaries. Richer helpers such as `Option.match(...)`, `Option.gen(...)`, `Result.match(...)`,
  and `Result.gen(...)` are non-adopted until their exact module/member rows, owner guidance, and
  tests exist. Do not document or rely on `.asEffect()` unless the installed Effect source exposes
  it and the manifest adopts it.
- A package may expose Promise, callback, or `AsyncIterable` facades only for non-Effect consumers:
  Electrobun RPC handlers, Svelte renderer adapters, browser tools, headless scripts, or tests that
  intentionally exercise the public non-Effect edge.
- Host callbacks supplied by app/bootstrap are allowed only when they adapt an external framework
  or operating-system boundary into an already owned package service: Electrobun bridge delivery,
  renderer notification fanout, menu/window events, browser-tool connection lifecycle, or primitive
  host capabilities named by the package spec. They are not allowed to stand in for runtime-owned
  semantic services. A dependency named after product behavior, such as queued-message dispatch,
  post-commit request-input delivery, approval resolution, source-invalidation policy,
  generated-package refresh policy, command-session lookup, event publication, or recovery, must be
  an Effect service/layer inside the owning package rather than an app callback object.
- Production facades receive the already-started app/bootstrap-owned `ManagedRuntime` and call that
  runtime's instance methods; only named facade/bootstrap tests may pass a test-owned
  `ManagedRuntime`. The
  runtime facade uses `managedRuntime.runPromiseExit(...)` and maps `Exit` / `Cause` into
  public Promise resolution, rejection, interruption, and disposal behavior explicitly. Plain
  `runPromise(...)`, callback runners, or synchronous runners are allowed only when the facade spec
  names the exact error/interruption mapping and tests cover it. Stream/subscription adapters are
  svvy facade helpers built on the same runtime, not `ManagedRuntime` instance methods. They do not
  create hidden runtimes, build layers per request, keep durable state, claim queues, execute turns,
  or apply recovery policy. Facade methods call exported runtime service operations such as
  `Runtime.workspaces.open(...)`, `Runtime.surfaces.close(...)`, or
  `Runtime.messages.submit(...)`; they do not call package-private scope-manager acquire/release
  methods, `LayerMap.Service` subclass static helpers, lower-level map instance helpers, layer
  constructors, repository ports, or worker services directly.
- Facade factories that accept `ManagedRuntime` are readiness-gated by contract. The
  `createRuntimeFacade(managedRuntime)` signature relies on app/bootstrap having already acquired
  the root app runtime context and awaited the runtime-owned startup readiness barrier before the
  facade is exposed. Any facade that admits calls before app-bootstrap readiness must include the
  readiness service in its provided runtime environment and run the readiness effect before
  each admitted service method. Facade methods must not be the first path that lazily acquires the
  app layer graph unless that same call enforces the runtime-owned startup readiness barrier before
  executing the requested service method. Facade tests cover calls made before readiness, after
  readiness failure, after explicit shutdown preparation, and after runtime disposal.
- No non-UI package may import `@svvy/desktop` or renderer modules. Renderer and bridge code may
  import package facades, public contracts, and read-model types only.
- Generated `@svvyx/*` packages are plain generated source artifacts. They do not expose Effect
  services, layers, managed runtimes, subprocess helpers, or runtime facades.

## RuntimeEffectRequest Rules

`RuntimeEffectRequest` is the closed declarative effect algebra shared by native extension handlers
and runtime. Effect v4 provides the execution substrate; it does not make extension handlers runtime
owners.

- `@svvy/core` owns the schema-backed `RuntimeEffectRequest` and `ExtensionExecutionPlan` unions,
  request/plan payload schemas, decoders, encoders, and typed validation errors.
- `@svvy/extensions` handlers may return `ExtensionRuntimeOperation` items together with their
  immediate tool result and typed fact payloads. Runtime effects are wrapped as
  `{ kind: "runtime_effect", request }`; execution plans are wrapped as
  `{ kind: "execution_plan", plan }`. Handlers validate input, construct closed operation values,
  and redact extension-owned data before returning. They do not call runtime service methods
  directly.
- `@svvy/runtime` is the only applier and execution-plan executor. It validates returned requests
  and plans again at the package boundary, attaches the owning workspace/surface/turn/command
  identity from runtime context, orders requests and plans with the owning command lifecycle, applies
  transactional state mutations through `@svvy/state`, invokes `@svvy/extensions`,
  `@svvy/pi-adapter`, or `@svvy/sandbox` only for the request kinds and execution plans that
  require those services, and publishes runtime notifications only after commits.
- Every `RuntimeEffectRequest` variant that can be returned by an extension handler must have an
  implemented runtime applier before that variant is exposed as handler-returnable. The closed union
  and the runtime dispatcher move together: `handler_thread.start`,
  `actor_extension_binding.update`, `episode.record`, queue requests, request-input requests, and
  generated refresh requests either all have typed applier behavior, or the owning spec explicitly
  removes the unimplemented variant from handler outputs. Unknown variants fail core schema decode
  as invalid input. A decoded target variant without a runtime applier is an implementation defect
  and package-boundary test failure, not a model-facing `RuntimeContractError`, product staging
  mechanism, or valid runtime status.
- `RuntimeEffectRequest` and `ExtensionExecutionPlan` dispatchers must be exhaustive. Use a direct
  `switch` with no broad `default` branch and a `never` exhaustiveness check. Match-helper adoption
  requires installed-export evidence, manifest rows, package-boundary allowlists, and focused tests.
  Do not add catch-all fallback behavior for closed product algebras.
- Runtime effect request application is an internal runtime service lane, not a desktop bridge API,
  generated package API, `execute_typescript` facade import, or Smithers workflow-control surface.
- Request payloads never carry caller-provided duplicate `workspaceId`, renderer pane ids, UI
  snapshots, generated previews, app-log summaries, or direct SQLite/pi/desktop objects. Runtime
  derives runtime identity from the active execution context.
- Queue and surface requests never execute immediately inside extension code. Runtime records the
  command lifecycle first, then applies requests at the ordered boundary defined by the runtime
  service method.
- Returned request failures are command/runtime failures with typed `RuntimeContractError` or a
  request-specific public error. They are not arbitrary thrown foreign exceptions or raw Effect
  defects at package boundaries.
- Extension handlers never publish runtime events, create desktop panes, mutate renderer state,
  claim durable queues, start pi turns, or schedule recovery directly.

## Schema Rules

- Use manifest-adopted `Schema.Struct` for data-only persisted, RPC, event, read-model,
  command-fact, and generated-package payloads. `Schema.TaggedStruct`, `Schema.Class`, and
  `Schema.TaggedClass` are not production-adopted unless exact manifest rows and focused schema
  tests exist.
  Current class-backed/yieldable error contracts use manifest-adopted `Schema.TaggedErrorClass`.
  Do not make persisted or wire payloads class-backed just for nominal typing.
- Static schema definitions and manifest-adopted compiled schema functions are hoisted at module
  scope, including `Schema.decodeUnknownEffect`, `Schema.decodeUnknownExit`,
  `Schema.decodeUnknownSync`, `Schema.encodeEffect`, `Schema.encodeExit`, and
  `Schema.encodeUnknownSync`. Other schema compiler helpers such as `Schema.is`,
  `Schema.decodeEffect`, `Schema.decodeExit`, `Schema.decodeOption`,
  `Schema.decodeUnknownOption`, `Schema.decodePromise`, `Schema.decodeUnknownPromise`,
  `Schema.encodeUnknownEffect`, `Schema.encodeUnknownExit`, `Schema.encodeOption`,
  `Schema.encodeUnknownOption`, `Schema.encodePromise`, and `Schema.encodeUnknownPromise` are
  not production-adopted unless exact manifest rows and focused tests exist. Effect v4
  `Schema.asserts(schema, input)` is
  a direct assertion call in Effect v4, while the local T3Code lint-reference rule treats
  `asserts` as a compiler-method family for its own stricter hoisting policy. svvy follows the
  stricter product rule for package boundaries: product package boundary code does not use
  `Schema.asserts(...)` as a reusable guard surface; it uses hoisted `decodeUnknown*`, `decode*`,
  `encode*`, or package-owned wrapper helpers whose manifest-adopted compiler call happens at
  module scope. Direct schema assertion calls are banned in package boundary, runtime, bridge,
  handler, read-model, and command-output code, except in named dynamic schema factory files where
  the schema cannot be known at module scope.
- `Schema.decodePromise(...)`, `Schema.decodeUnknownPromise(...)`, `Schema.encodePromise(...)`, and
  `Schema.encodeUnknownPromise(...)` are host-edge-only conveniences. Product package boundaries,
  bridge error normalization, persistence, runtime events, command facts, and app logs use Effect or
  Exit schema adapters instead.
- Effect service bodies prefer hoisted `Schema.decodeUnknownEffect(...)` and
  `Schema.encodeEffect(...)`. Use `decodeUnknownEffect` for genuinely unknown input inside Effect
  service methods, `decodeUnknownExit` only at non-Effect bridge edges that need `Exit`
  classification, and `encodeEffect` for typed schema values. `Schema.decodeEffect`,
  `Schema.decodeExit`, and `Schema.encodeUnknownEffect` are not production-adopted; typed encoded
  values that cross an Effect boundary still use the adopted unknown-input decoder unless the exact
  typed-input compiler member is promoted with focused tests. `decodeUnknownSync` is not a normal
  service-body adapter; exported sync decoders are restricted by the naming and usage rule below.
- Every public persisted/RPC/event/read-model/effect-request schema has both decode and encode
  helpers hoisted next to the schema when values cross a package, bridge, generated-contract,
  app-log, command-fact, transcript, or SQLite boundary. Timestamp fields use the
  `UtcDateTime`/`Schema.DateTimeUtcFromString` codec contract and expose encoded
  `IsoDateTimeString` values; they are not plain branded strings whose ISO validity is assumed by
  convention.
- In public persisted, RPC, bridge, generated-package, command-fact, runtime-event, read-model,
  app-log, and queue payload schemas, object fields that TypeScript would spell with `?` use
  `Schema.optionalKey(...)`. `Schema.optional(...)` is banned in public object field definitions
  unless the contract explicitly says that `undefined` is a valid decoded and encoded value. That
  exception includes focused decode/encode tests proving `{ field: undefined }` is accepted
  intentionally and omitted fields behave differently if that distinction matters.
- Non-Effect bridge edges use hoisted `Schema.decodeUnknownExit(...)` for unknown input and
  `Schema.encodeExit(...)` for already typed schema values when the bridge needs to distinguish
  schema failure, defect, and interruption before mapping into a closed stable error. These `Exit`
  adapters are usable at non-Effect bridge edges only for schemas with no decoding service
  requirements. Public
  `@svvy/core` schemas that are decoded by desktop RPC, browser tools, headless automation,
  generated command boundaries, or persistence helpers must stay service-free. If a schema genuinely
  needs decoding services, bridge code runs `Schema.decodeUnknownEffect(...)` through the
  caller-owned `ManagedRuntime` instead of pretending the schema is synchronous.
  `*Result` schema adapters are allowed only in pure, non-Effect host-edge helpers that immediately
  catch thrown defects, interruptions, or non-schema causes and map them to a closed bridge error.
  Inside Effect service methods or package boundaries, use `Schema.decodeUnknownEffect(...)` /
  `Schema.encodeEffect(...)`, or use `Schema.decodeUnknownExit(...)` / `Schema.encodeExit(...)` at
  non-Effect bridge edges.
  `Schema.decodeUnknownSync(...)` is limited to trusted bootstrap, test, and assertion edges, or
  must be wrapped in `Effect.try(...)` before crossing a product boundary.
- Boundary helper names spell out both input kind and adapter:
  `decodeUnknown<TypeName>Effect`, `decodeUnknown<TypeName>Exit`, `encode<TypeName>Effect`, and
  `encode<TypeName>Exit` where needed.
  Every public unknown-input boundary decoder exported from `@svvy/core` or package contract
  modules is named `decodeUnknown<TypeName>Effect` and/or `decodeUnknown<TypeName>Exit`.
  `decode<TypeName>Effect` / `decode<TypeName>Exit` names are reserved for a future same-change
  adoption of `Schema.decodeEffect` / `Schema.decodeExit`; they must not exist in production source
  until those exact compiler members are promoted. Sync decoders are not product-boundary helpers.
  Any exported sync decoder is named `unsafeDecode<TypeName>SyncForTestsAndBootstrap` and may be
  used only in tests, trusted bootstrap, or local assertions before entering an Effect boundary.
  Public sync outbound encoders are forbidden except for the exact request-input queue/delivery
  payload helpers named by `core.spec.md`; those helpers encode already decoded core payloads for
  immediate durable JSON queue/delivery storage and do not establish a general sync encode pattern.
- `Schema.decodeUnknownResult(...)`, `Schema.decodeResult(...)`,
  `Schema.encodeUnknownResult(...)`, and `Schema.encodeResult(...)` return `Result.fail` only for
  schema-issue failures; Effect v4 throws defects, interruptions, and non-schema causes from these
  adapters. They are therefore pure non-Effect host-edge helpers, not default product-boundary
  adapters. A host-edge wrapper that uses one must catch thrown non-schema failures immediately and
  map them into that edge's closed tagged error or stable bridge error before returning. Treat every
  `*Result` adapter as a compiled schema function: hoist it at module scope and include it in
  svvy-owned schema-compiler lint coverage.
- Do not immediately invoke schema compiler calls inside hot functions, tool handlers, event loops,
  read-model selectors, bridge handlers, or command-output handlers. Dynamic schema factory helpers
  may compile a caller-provided schema only when that schema cannot be known at module scope.
- Public ids are branded schemas, not raw string aliases. The default pattern is
  `Schema.String.pipe(Schema.brand("WorkspaceId"))` for opaque ids. When an id has a concrete
  syntax requirement, use only string checks with exact manifest rows before branding. `Schema.UUID`
  and `Schema.isUUID()` are not production-adopted.
- Durable id, token, and digest generation is owned by product services, not ad hoc call sites:
  - `@svvy/core` owns branded id schemas and encoded digest/token field shapes only. It does not
    generate process values, read clocks, read randomness, or import host crypto.
  - `@svvy/state` owns ids that are persisted as database facts and any digest/fingerprint rows it
    writes. Repository tests use deterministic generation layers or explicit supplied ids so replay,
    migration, and rollback assertions are stable.
  - `@svvy/runtime` owns runtime operation ids, queue/runtime receipts, bridge subscription ids,
    request-input wait ids, command execution ids, and command-scoped loopback tokens when those
    values identify runtime work.
  - `@svvy/extensions` owns extension source/build fingerprints, generated package evidence
    digests, generated declaration digests, and extension-owned helper tokens. It returns
    non-secret receipts to runtime/state; it does not persist facts directly.
  - `@svvy/sandbox` owns sandbox policy/helper fingerprints and scoped temp profile names through
    injected services. It does not generate durable product ids for runtime/state rows.
  - `@svvy/pi-adapter` owns only pi-adapter-local correlation ids needed to map pi sessions,
    helper jobs, and turn streams to core/runtime ids supplied by callers.
  - App/bootstrap owns app-instance, bridge, and process-edge tokens that never become domain facts.
    Renderer code does not mint durable product ids; it may mint local DOM/tab ids only when those
    ids never cross persistence, runtime, state, command, transcript, or generated-contract
    boundaries.
  - Security-sensitive bytes, auth/session tokens, salts, HMAC keys, source/artifact fingerprints,
    generated-package fingerprints, and persisted uniqueness guarantees use injected
    `Crypto.Crypto` or a package-owned generation service backed by `Crypto`. They must not call
    `Math.random()`, `Random`, `node:crypto`, WebCrypto globals, or Bun globals directly outside
    app/platform layers and explicitly documented package-boundary exceptions.
  - Non-security jitter or sampling may use `Random` only after the exact `effect/Random` members,
    owner package, source globs, and behavior tests are promoted from conditional audit evidence to
    production adoption, and only when no persisted identity, authorization, fingerprint, or
    user-visible uniqueness semantics depend on the value.
  - Digest encoding is explicit in the schema (`sha256:<hex>`, base64url token, UUID string, etc.).
    Public facts expose fingerprints, labels, status, or presence fields, never raw secret token
    bytes or signing inputs.
- Schema contract source uses v4 Schema names and shapes, with production value reads gated by
  `adoptedEffectRuntimeModuleExports`. Current adopted schema members include the exact
  `effect/Schema` rows in `packages/effect-adoption-manifest.ts`, such as
  `Schema.TaggedErrorClass`, `Schema.decodeUnknownEffect`, `Schema.encodeEffect`,
  `Schema.Literals([...])`, `Schema.Union([...])`, `Schema.Record(key, value)`,
  `Schema.String.check(...)`, `Schema.Struct`, `Schema.brand`, `Schema.Redacted`, and
  `Schema.Defect({ excludeCause: true })`. Target schema surfaces such as `Schema.TaggedStruct`,
  `Schema.Class`, `Schema.TaggedClass`, `Schema.NonEmptyString`, and
  `Schema.RedactedFromValue` are not permission to read the member in production before the
  manifest, boundary tests, and focused schema tests adopt it.
- Recursive, transformed, or externally encoded contracts declare their encoded and decoded sides
  explicitly as `Schema.Codec<Type, Encoded>`. Schema-side inspection helpers such as
  `Schema.revealCodec`, `Schema.toEncoded`, `Schema.toType`, and `Schema.toCodecJson` are not
  production guidance unless the exact value member has production adoption in
  `packages/effect-adoption-manifest.ts`. Current `Schema.toCodecJson` usage is test-only audit
  evidence for core boundary tests. Do not hand-write parallel encoded/decoded TypeScript
  interfaces when the adopted schema codec/type surface can expose those sides.
- Namespace type members such as `Schema.Codec` and `Schema.Decoder` are governed by the type-only
  `effect/Schema` manifest row. They do not grant value-member adoption and must remain in type
  positions. Schema instance `.fields` reads are allowed only on package-local schema constants to
  compose derived structs, read-model schemas, or facade DTO schemas in the same package ownership
  boundary. Do not inspect `.fields` from dynamic/runtime-provided schemas or use schema-object
  reflection for domain behavior.
- Schema annotations used for generated declarations, JSON Schema, OpenAPI, native tool schemas,
  and agent-facing schema blocks are owned by the same package that owns the source contract. The
  allowed public annotation vocabulary is explicit: stable title/name, description, examples,
  deprecation status only when a product spec still supports that field, default value only when it
  is semantically part of the contract, and product-owned extension metadata needed by generated
  tool/declaration emitters. Internal implementation notes, source file paths, debug ids, package
  private tags, prompt inspection payloads, secret hints, and arbitrary AST annotations must not leak into
  generated package files, agent prompts, native tool schemas, bridge schemas, or app logs. Avoid
  broad predicate-only schemas for public inputs when generated schema/declaration quality matters;
  prefer concrete v4 checks and structured schemas that can produce useful JSON Schema and
  StandardSchemaV1 issues.
- `PublicSchemaAnnotationSchema` is the concrete allowlist consumed by native-tool,
  command-schema, JSON Schema, and declaration emitters. Emitters use a package-owned helper that
  either traverses/copies the schema representation with only allowed public annotations or
  post-processes generated StandardSchemaV1 / JSON Schema output. Do not assume Effect provides an
  in-place "strip annotations" API. Encoded-wire annotations for transformed schemas use
  `Schema.annotateEncoded(...)`; decoded-side `.annotate(...)` metadata is not treated as wire
  metadata unless an emitter test proves the generated artifact contains it. Tests prove
  decoded-only annotations do not leak into generated tool/schema blocks.
- Developer-facing schema rendering and controlled generated-contract representation work may use
  Effect v4 schema representation APIs only after the exact representation module and value members
  are promoted from installed-export audit evidence into production adoption. Until that promotion,
  production code serializes schemas through manifest-adopted schema members and package-owned
  annotation helpers only. It must not import `effect/SchemaRepresentation` directly.

- `SchemaAST` is allowed only for the type-only `SchemaAST.ParseOptions` constants named by
  `@svvy/core` parse-option contracts. `SchemaRepresentation` is installed-export audit evidence
  only, not production permission. Domain services, state repositories, runtime workers, extension
  handlers, and renderer code do not inspect schema ASTs or schema representations for business
  behavior.
- When a schema transform crosses a generated JSON Schema, OpenAPI, native-tool-schema,
  generated-command-schema, or agent-facing declaration boundary, annotations that must appear in
  the generated encoded/wire schema are attached to the encoded side with `Schema.annotateEncoded(...)`
  or the equivalent v4 encoded-side annotation helper. Ordinary `.annotate(...)` metadata may
  describe the decoded schema side and is not assumed to propagate to generated wire contracts for
  transforms.
- Target emitter shape for generated native-tool schemas, generated `svvyx` command schemas, and
  agent-facing declaration blocks uses v4 generation APIs from the owning source schema:

  `Schema.toStandardSchemaV1(...)`, `Schema.toJsonSchemaDocument(...)`, and
  `JsonSchema.resolveTopLevel$ref(...)` require exact production manifest adoption before product
  emitters use them. Current installed-export audit coverage is not production permission for those
  members. OpenAPI input normalization helpers such as `JsonSchema.fromSchemaOpenApi3_1(...)` and
  `JsonSchema.fromSchemaOpenApi3_0(...)` are not adopted; they require a product reason involving
  external OpenAPI schema ingestion plus exact manifest rows and focused tests before use.

  The following snippet is not production-adopted unless the named emitter members move from installed-export audit coverage into production adoption:

  ```ts
  import { isPublicSchemaAnnotationKey, strictBoundaryParseOptions } from "@svvy/core";
  import * as JsonSchema from "effect/JsonSchema";

  const standard = Schema.toStandardSchemaV1(CommandInputSchema, {
    parseOptions: strictBoundaryParseOptions,
  });
  const jsonSchemaDocument = Schema.toJsonSchemaDocument(CommandInputSchema, {
    additionalProperties: false,
    includeAnnotationKey: isPublicSchemaAnnotationKey,
  });
  const resolvedDocument = JsonSchema.resolveTopLevel$ref(jsonSchemaDocument);
  const jsonSchema =
    Object.keys(resolvedDocument.definitions).length === 0
      ? resolvedDocument.schema
      : { ...resolvedDocument.schema, $defs: resolvedDocument.definitions };
  ```

  This is the target emitter shape for generated native-tool, `svvyx` command, and declaration JSON
  Schema calls after `Schema.toJsonSchemaDocument(...)` and
  `JsonSchema.resolveTopLevel$ref(...)` are promoted from installed-export audit evidence to exact
  production adoption for the owning emitter files. Examples for promoted emitters must not omit
  `additionalProperties: false` or `includeAnnotationKey: isPublicSchemaAnnotationKey`.
  Before publishing a generated schema to a model/tool bridge, declaration block, or generated
  contract artifact, promoted emitters resolve top-level `$ref` values with the adopted
  JSON-Schema resolver.
  A generator rejects schemas requiring definitions when the target bridge cannot carry `$defs`
  until the owning package spec names a tested inliner for that exact target. No emitter silently
  drops definitions, leaves dangling `$ref`, or inlines definitions as an unreviewed fallback.
  Generated-package evidence manifests and workflow task-agent bridge payloads are not JSON Schema
  emission targets; they remain Effect-Schema-decoded product contracts and generated
  TypeScript declaration/type surfaces unless their owning package spec explicitly adds a JSON
  Schema artifact with target, consumer, `$defs` policy, tests, and boundary checks.

  `Schema.toStandardSchemaV1(...)` defaults to collecting all errors but does not make excess
  object properties an error unless `parseOptions.onExcessProperty` is set. Generated
  StandardSchemaV1 validators used as product validators pass the same strict parse options as
  boundary decoders unless that contract explicitly preserves unknown keys.
  Public `@svvy/*` packages import `strictBoundaryParseOptions` from `@svvy/core` instead of
  re-declaring equivalent object literals. Local parse options are allowed only for an internal or
  explicitly documented boundary whose excess-property policy intentionally differs.

  `@svvy/core` owns the exact exported options object:

  ```ts
  import * as SchemaAST from "effect/SchemaAST";

  export const strictBoundaryParseOptions = {
    errors: "all",
    onExcessProperty: "error",
  } satisfies SchemaAST.ParseOptions;
  ```

  All boundary decoders, encoders, and generated StandardSchemaV1 validators use that exported
  value unless the contract explicitly preserves excess keys.

  Generated contracts are never hand-rewritten from prose when an Effect Schema source contract
  exists. The owning package may post-process generated output only through a documented allowlist
  for product-specific descriptions, examples, defaults that are semantically part of the contract,
  and stable extension metadata.

- svvy production schema contracts may use only exact manifest-adopted v4 schema names. Current
  adopted structured/error helpers include `Schema.TaggedErrorClass` for tagged errors and
  `Schema.Struct` for structured data. `Schema.Class`, `Schema.TaggedStruct`, and
  `Schema.TaggedClass` are not production-adopted unless their exact member rows and focused tests exist.
  Package-owned hoisted boundary helpers named `decodeUnknown<Name>Effect` and
  `decodeUnknown<Name>Exit` call the adopted static compilers
  `Schema.decodeUnknownEffect(schema)` and `Schema.decodeUnknownExit(schema)`.
  `Schema.NonEmptyString` or `Schema.String.check(Schema.isNonEmpty())` may be used only after
  exact adoption for the chosen member. Current production non-empty string checks use
  `Schema.String.check(Schema.isNonEmpty())` because both members are adopted; `Schema.NonEmptyString`
  is not adopted. UUID-shaped id helpers require exact manifest adoption before production use. svvy
  models literals with `Schema.Literals([...])`, unions with `Schema.Union([...])`, JSON strings with
  schema helpers only after exact manifest adoption, pattern strings with
  `Schema.String.check(Schema.isPattern(regex))`, literal picking with
  `Schema.Literals([...]).pick([...])`, and template literals with `Schema.TemplateLiteral([...])`.
  `Schema.UnknownFromJsonString`, `Schema.fromJsonString`, `Schema.TemplateLiteralParser`,
  `Schema.isUUID`, `Schema.isULID`, and `Schema.tagDefaultOmit` require a manifest adoption row,
  package-boundary allowlist, and focused test before production use. `Schema.refine` is adopted for
  package-owned schema refinements where a concrete product invariant cannot be expressed by the
  narrower adopted checks; each use stays next to the owning schema and has focused decode/encode
  tests for accepted and rejected values.
  Struct/class schema instance `.mapFields(...)` and `effect/Struct` helpers such as `Struct.map`,
  `Struct.pick`, `Struct.omit`, and `Struct.assign` are not production-adopted. Field-shape
  transforms must be written with adopted schema members directly or wait for exact `effect/Struct`
  and schema instance-member promotion. Finite key unions are modeled from owner-maintained literal
  tuples or object-key lists with `Schema.Literals([...])` or `Schema.Union([...])`, with package
  tests that keep the list aligned with the owning record. Non-empty arrays use
  `Schema.Array(item).check(Schema.isNonEmpty())`; `Schema.NonEmptyArray(item)` is not
  production-adopted.
- V4 field-shape contracts are explicit: use `Schema.optionalKey(...)` for exact optional object
  keys and `Schema.withDecodingDefaultKey(...)` when an absent key receives an encoded-side default.
  `Schema.optional(...)`, `Schema.withDecodingDefault(...)`,
  `Schema.withDecodingDefaultTypeKey(...)`, `Schema.withDecodingDefaultType(...)`,
  `Schema.required`, and `Schema.requiredKey` are not production-adopted. If a contract needs
  decoded-side defaults, `undefined` as a decoded value, or optional-to-required field conversion,
  that change must first promote the exact helper and add focused decode/encode tests proving the
  encoded and decoded shapes. Use `Schema.NullOr(...)` plus manifest-adopted decode/encode adapters
  for nullable wire inputs. `Schema.decodeTo(...)`, `Schema.encodeTo(...)`, `Schema.decode(...)`,
  and `Schema.encode(...)` are not production-adopted unless exact manifest rows and focused
  transform tests exist. Package-boundary checks reject non-adopted field-shape helpers.
  `SchemaGetter.transform(...)`, `SchemaGetter.transformOptional(...)`, and `SchemaTransformation`
  are not production-adopted until the Effect manifest, package-boundary tests, and focused schema
  tests name them explicitly. When decoded and encoded schemas differ, especially for persisted,
  RPC, generated-schema, or SQL row codecs, production uses manifest-adopted adapter members only.
  V4 `Schema.decode(...)` / `Schema.encode(...)` are not production-adopted; do not confuse them with
  boundary helpers such as `Schema.decodeUnknownEffect(...)` and `Schema.encodeEffect(...)`. Use
  only adopted schema transformation helpers in production code.
  Reference-only schema transformation patterns remain discovery material until the Effect manifest
  and focused tests adopt their exact modules and member reads.
- Inbound unknown payloads are decoded at package boundaries. Outbound persisted, RPC,
  generated-package, command-fact, runtime-event, read-model, and app-log payloads are encoded
  before crossing their boundary.
- Boundary decoders and encoders choose parse options explicitly. External, RPC, persisted,
  generated-command, runtime-effect, command-fact, runtime-event, read-model, app-log, and
  generated-package payloads use `{ onExcessProperty: "error", errors: "all" }` where the v4
  decoder/encoder accepts parse options unless the contract intentionally preserves unknown keys.
  Preserved excess keys require a schema-level contract note explaining why they are part of the
  payload. Encode failures map to the same package tagged contract error family as decode failures
  for that boundary.
  When the value is typed or narrowed as `Schema.SchemaError`, format `error.issue`. Generic
  host-edge `catch (unknown)` code may inspect `error.cause` only after narrowing with
  `Schema.isSchemaError(error)` or `SchemaIssue.isIssue(...)`. Do not copy reference examples that
  rely on `error instanceof Error` as product boundary policy without that narrowing.
- Public boundary, persisted, RPC, generated-package, command-fact, runtime-event, read-model,
  app-log, state-row, and generated-command schemas must not use `Schema.catchDecoding(...)` or
  `Schema.catchDecodingWithContext(...)` to recover invalid input. Boundary decode failures map to
  the owning tagged error with structured `BoundaryIssue[]` evidence. Fallback decoding is allowed
  only in owner-named internal UI/form normalization schemas that never cross package, persistence,
  bridge, runtime-event, command-fact, read-model, app-log, generated-contract, or generated-package
  boundaries.
- Decode and encode failures become typed tagged errors with enough context for app logs and command
  facts. Boundary errors include a compact stable issue summary derived from
  `SchemaIssue.makeFormatterStandardSchemaV1()(schemaError.issue).issues` after schema-level
  redaction, plus an optional `cause` field whose schema is `Schema.Defect({ excludeCause: true })`
  by default.
- Use `SchemaIssue.makeFormatterStandardSchemaV1(...)` or the equivalent v4 StandardSchemaV1 issue
  formatter for structured boundary issue payloads. Use human string formatters such as
  `makeFormatterDefault(...)` only for developer-facing diagnostics after redaction; do not persist
  those strings as the only machine-readable schema error evidence.
- `@svvy/core` owns the shared boundary issue schema used by public contract errors. The
  machine-readable issue path preserves string and numeric path segments, for example
  `["threads", 0, "objective"]`. Symbols, object-key wrappers, and other non-JSON `PropertyKey`
  segments are normalized to a stable JSON shape before crossing a public boundary. Do not stringify
  the path as the only machine-readable representation; a dotted path may be added only as a
  redacted display convenience.
- Public payload constraints that are pure, deterministic, and visible in the owning schema contract belong in
  the owning `Schema`, including cross-field and multi-issue checks where v4 Schema can express the
  invariant. IO-backed, stateful, or runtime-context validation belongs in an Effect service method
  and returns a typed `Schema.TaggedErrorClass` error using the same structured boundary issue
  shape. Tests cover multi-issue validation and array-index issue paths.
- Secret-bearing schemas and redaction wrappers define how their issue formatter hides protected
  values. Package tests prove raw secret values do not appear in formatted issues, app logs, command
  facts, runtime events, generated declarations, prompt text, artifacts, read models, or bridge
  errors.
- Public persisted, RPC, app-log, command-fact, runtime-event, read-model, and generated-package
  error payloads use `Schema.Defect({ excludeCause: true })` for unknown causes by default. Trusted
  debug-only payloads may use `Schema.Defect()` or `{ includeStack: true }` only when the contract
  explicitly says the boundary may expose that diagnostic detail.
- `Schema.Defect(...)` is a lossy JSON-boundary representation for unknown defects. It is useful
  only after schema-level redaction and normalization. Pi-native errors, SQLite errors, subprocess
  handles, provider errors, renderer objects, and host API objects are mapped to stable tagged error
  payloads before crossing package, RPC, persistence, command-fact, runtime-event, app-log,
  transcript, artifact, or generated-declaration boundaries. Do not store raw foreign objects and
  assume `Schema.Defect({ excludeCause: true })` will preserve their meaning.
- Generated TypeScript declarations must be emitted from source contracts when a source contract
  exists; hand-written prose is only valid where no source contract exists.

## Error, Exit, And Defect Rules

- Expected domain failures are typed errors in the Effect error channel.
- At foreign boundaries, wrap throwing or rejecting APIs with `Effect.try` / `Effect.tryPromise` and
  map caught unknown causes immediately into typed tagged errors carrying operation and a closed
  reason. Public boundary error schemas use
  `cause: Schema.optionalKey(Schema.Defect({ excludeCause: true }))` by default. Defects that escape
  the error channel are reserved for programming defects or impossible states; recoverable
  host/library failures must not cross package boundaries as defects.
- Boundary schema errors are mapped through the v4 `SchemaError` / `SchemaIssue` formatter path:

  ```ts
  import * as Schema from "effect/Schema";
  import * as SchemaIssue from "effect/SchemaIssue";

  const formatSchemaError = (error: Schema.SchemaError) =>
    SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues;
  ```

  Stable bridge errors may additionally include a redacted developer-facing issue string, but the
  structured issue array is the machine-readable payload.

- Public cross-package domain errors use the `@svvy/core` v4 `Schema.TaggedErrorClass` error classes
  defined for that boundary, such as `RuntimeContractError`, `StateContractError`,
  `SandboxPolicyError`, `PiAdapterError`, `ExtensionError`, and stable bridge error payloads. They
  are yielded, caught, and mapped by `_tag`. Package-local internal tagged errors may exist, but
  package facades and other public package boundaries map them to the core public error vocabulary
  before returning. `Data.TaggedError` is not production-adopted unless exact `effect/Data` member rows are
  adopted; it must not appear in public contract schemas, persisted payloads, RPC payloads, runtime
  events, read models, command facts, app logs, generated-package contracts, bridge errors, or
  transcript-derived artifacts:

  ```ts
  export class RuntimeContractError extends Schema.TaggedErrorClass<RuntimeContractError>()(
    "RuntimeContractError",
    {
      operation: Schema.Literals(["submit_message", "claim_queue_item"]),
      reason: Schema.Literals(["invalid-target", "state-conflict", "schema-error"]),
      message: Schema.String,
      issues: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
            message: Schema.String,
          }),
        ),
      ),
      cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
    },
  ) {}
  ```

- Use `Schema.TaggedErrorClass` for every recoverable domain error, package-boundary error, and
  any error that callers branch on by `_tag`. `Schema.ErrorClass` is allowed only for package-local
  implementation errors that never cross public package, persistence, bridge, runtime-event,
  command-fact, app-log, generated-contract, or transcript-derived boundaries; boundary code maps it
  to the public tagged error vocabulary first.
- Do not use `Effect.orDie`, `Effect.orDieWith`, or equivalent typed-error-to-defect conversion in
  package services, runtime workers, tool handlers, bridge handlers, or repository code. They are
  allowed only at explicitly named process or test-helper edges where the owning entrypoint
  intentionally turns a typed failure into process failure after logging or mapping the user-visible
  fact.
- The installed-audited recovery APIs are `Effect.catch` and `Effect.catchCause`.
  `Effect.catch` is allowed for general typed-error recovery in package code because
  `packages/effect-installed-exports.effect.test.ts` proves that member exists in the installed
  stack; the vendored `docs/references/effect-smol` source remains the reference for additional v4
  APIs before adoption. Use narrow recovery APIs such as `Effect.catchTag`, `Effect.catchTags`,
  `Effect.catchFilter`, `Effect.catchIf`, `Effect.catchReason`, `Effect.catchReasons`,
  `Effect.catchCauseIf`, and `Effect.catchCauseFilter` only after
  `packages/effect-adoption-manifest.ts` and `packages/effect-installed-exports.effect.test.ts`
  explicitly adopt and prove the exact member. Until then, recover with `Effect.catch` /
  `Effect.catchCause` and branch inside the recovery callback. After adoption, use `catchReason` /
  `catchReasons` only when an error has a tagged reason union such as
  `reason: Schema.Union([RateLimitError, QuotaExceededError])`. For closed string-literal `reason`
  fields, catch the parent tagged error with `catchTag` / `catchTags` and branch on `error.reason`.
  Use `Effect.catchFilter` for partial typed-error recovery and `Effect.catchCauseFilter` for
  partial cause recovery only after the exact `effect/Filter` predicate members are also adopted.
  Predicate/filter values remain package-local and must not cross public contracts. Eager Effect variants
  (`mapEager`, `mapErrorEager`, `mapBothEager`,
  `flatMapEager`, `catchEager`, `fnUntracedEager`, and eager match variants) are not default
  service primitives. Use them only in measured synchronous hot paths where eager execution is
  intentional and cannot alter error mapping, logging, interruption, tracing, or resource lifetime;
  otherwise use ordinary `Effect.map`, `Effect.flatMap`, `Effect.catch`, and only those narrow catch
  combinators that have exact manifest adoption. svvy uses manifest-adopted v4 catch combinators; it
  does not use `Effect.catchAll`, `Effect.catchAllCause`, `Effect.catchSome`, or
  `Effect.catchSomeCause`.
- At bridge/test/process boundaries, use `managedRuntime.runPromiseExit(...)`, adopted
  `Schema.*Exit` adapters, `Exit.match`, and manifest-adopted v4 `Cause` helpers when code must
  distinguish success, typed failure, defect, and interruption. `managedRuntime.runSyncExit(...)`
  and source-gated `Effect.exit` are production-adopted only where exact manifest rows exist. v4
  `Cause` is
  flattened; inspect `cause.reasons` with manifest-adopted reason-level guards such as
  `Cause.isFailReason`, `Cause.isDieReason`, and `Cause.isInterruptReason`, or use
  manifest-adopted aggregate helpers such as `Cause.hasInterruptsOnly`. svvy uses v4 cause helpers,
  not the `isFailType`, `isDieType`, `isSequentialType`, or `isParallelType` cause-tag guards.
- Use `Exit.isSuccess(...)` and `Exit.isFailure(...)` only for terminal boundary predicates in
  tests, small bridge branches, and assertion helpers when the code does not need the success value
  or failure cause. Use `Exit.match(...)` when the branch needs to map the success value, typed
  failure, defect, or interruption into a stable product result.
- `Effect.catchDefect` is not a domain-service recovery primitive. Use it only at named bridge,
  facade, shutdown, or process edges that must translate a known Effect/runtime defect, such as
  disposed-runtime use, into a stable product bridge error. Package services, repositories, workers,
  and extension handlers use typed errors, `Exit` values captured at the bridge/facade edge, and
  `Cause` inspection instead of recovering defects as normal product failures.
- Bridge/error normalization code that iterates `cause.reasons` uses reason-level guards such as
  `Cause.isFailReason`, `Cause.isDieReason`, and `Cause.isInterruptReason` rather than inspecting
  private fields. Tests and adapters that need synthetic causes must first add exact
  manifest/test-policy coverage for the constructor helpers they use. `Cause.fromReasons(...)`, the
  v4 `Cause.make*Reason(...)` constructors, and `Cause.annotate(...)` are not production permission
  unless their exact members are adopted. Durable command and app-log facts still store normalized
  product errors, not raw Effect causes.
- Cause-to-boundary classifiers inspect the complete v4 `cause.reasons` array before choosing a
  public result. Classification order is: no reasons maps to a stable unknown-defect/debug error;
  interrupts-only maps to the boundary's cancelled/interrupted shape; one or more fail reasons makes
  typed failure the primary result while setting supported interruption/defect diagnostic fields or
  recording a related app-log diagnostic; defects with no fail reasons map to the boundary's defect
  shape; mixed defects and interrupts with no fail reasons make defect primary and note interruption
  when the contract supports it.
- v4 unknown/defect wrappers such as `UnknownError` are normalized at bridge boundaries into the
  owning package's tagged error or app-log error shape before crossing public package, IPC, command
  fact, or read-model boundaries.

  ```ts
  const exit = await managedRuntime.runPromiseExit(program);
  return Exit.match(exit, {
    onSuccess: toRpcSuccess,
    onFailure: (cause) => {
      if (Cause.hasInterruptsOnly(cause)) {
        return toStableBridgeCancellation(cause);
      }
      return toStableBridgeError(classifyCauseReasons(cause.reasons));
    },
  });
  ```

  `Cause.squash(...)` is allowed only after this classification, normally as a redacted
  developer-facing detail. It is too lossy to be the primary bridge error mapper because it erases
  the distinction between typed failure, defect, interruption, and mixed causes.

- Public facts normally store stable outcome fields such as `status`, `reason`, `exitCode`,
  `signal`, `interrupted`, `timedOut`, and compact issue/cause summaries instead of storing an
  Effect `Cause` tree. `Schema.Cause(errorSchema, defectSchema)` and
  `Schema.Exit(valueSchema, errorSchema, defectSchema)` are not production-adopted unless exact manifest
  adoption and focused encoded-shape tests exist. Command facts, runtime events, app logs,
  transcripts, artifacts, and read models should not expose raw Effect cause trees when a stable
  product outcome field is sufficient.
- Package boundaries map internal errors to public `@svvy/core` tagged errors or stable bridge/RPC
  error payloads. Internal package-specific errors may stay narrower, but they must not leak
  foreign library objects, pi-native errors, SQLite errors, subprocess handles, or renderer objects.
- Platform and host error normalization is mandatory and owner-specific:
  - `PlatformError.PlatformError` from `FileSystem`, `Path`, watcher, or platform helpers is
    converted by the package that owns the file/path operation into that package's typed error.
    The normalized error includes operation, safe path label or branded path when allowed,
    classification, retryability when meaningful, and redacted diagnostic text.
  - HTTP client errors are converted by the package that owns the outbound HTTP request into an
    HTTP/provider/package error with method, redacted URL origin/path label, status when available,
    timeout/cancellation classification, retryability, and redacted response diagnostics. Raw
    request headers, auth material, response bodies, and provider secrets are never copied to public
    errors.
  - SQL errors are converted only inside `@svvy/state` repository or migration boundaries into
    state errors that name the repository operation, schema/constraint classification,
    transaction/recovery impact, and safe table/model label. Raw SQL, bound secret values, and
    driver internals do not cross state ports.
  - Child-process and subprocess failures are converted by the owner of the process boundary:
    `@svvy/runtime` for durable command sessions and `@svvy/extensions` only for bounded
    source/build/probe helpers. Normalized errors include command identity, phase, exit/signal when
    available, timeout/interruption classification, and redacted output references, not raw process
    handles.
  - Crypto, digest, token, and random generation failures are converted by the product service that
    requested the value. Public errors say which product operation failed; they do not expose secret
    material, token bytes, raw entropy buffers, signing keys, or HMAC inputs.
  - Bridge facades map typed package errors to their stable bridge/RPC error payloads with the same
    redaction rules. They do not pass through raw causes simply because the underlying Effect failed.
- Long-running runtime flows that must record cancellation or failure facts use `Exit` / `Cause`
  where the full success/failure/interruption outcome matters. Interruptions are not generic
  failures; runtime and command facts record cancelled/interrupted outcomes explicitly.

## Runtime Event And Queue Rules

- Runtime notification hubs that publish plain `RuntimeEvent` values expose
  `Stream.Stream<RuntimeEvent, never>`. Typed subscribe/setup failures such as stale `afterSequence`
  rebaseline are returned by the subscription effect or bridge facade before the stream is exposed.
  A `Stream<A, never>` can still be interrupted by scope close, unsubscribe, queue shutdown, or
  runtime disposal. Bridge helpers map expected subscription/runtime interruption to normal close or
  a stable cancellation result, not to an unknown thrown error.
- Public `Runtime.events(...)` uses the runtime-owned replay ring plus one scoped filtered
  per-subscriber queue; it does not use PubSub replay, a shared PubSub subscription, or PubSub
  publish booleans as its delivery authority.
- Failing protocol streams are not adopted. Until `PubSub`, `Take`, and `Stream.fromPubSubTake`
  have production manifest rows and an owning runtime spec section, every public runtime
  subscription is `Stream.Stream<RuntimeEvent, never>` and returns setup, rebaseline, stale sequence,
  auth, or shutdown failures before exposing the stream or through bridge close/rebaseline receipts.
  If an internal runtime stream must fail after subscription, its owner must choose a
  promoted failing-stream protocol explicitly. The reference shape is a hub of
  `Take.Take<RuntimeEvent, RuntimeEventError>` values exposed with `Stream.fromPubSubTake(pubsub)`.
  For that promoted shape, ordinary event output is published as one `Take` value whose value case is
  a non-empty readonly array, typed stream failure is `Exit.fail(error)`, and normal completion is
  only the terminal marker, normally `Exit.void` / `Exit.succeed(undefined)`. Do not publish single
  plain events or successful event payloads as `Exit.succeed(event)`, and do not document
  `Stream.fromPubSub(pubsub)` as producing `RuntimeEventError`. References:
  `docs/references/effect-smol/packages/effect/src/Take.ts` and
  `docs/references/effect-smol/packages/effect/src/Stream.ts`.
- Each runtime subscription API declares exactly one stream mode: non-failing notification stream
  backed by a runtime-owned `Queue<RuntimeEvent>` exposed as `Stream.Stream<RuntimeEvent, never>`,
  or a promoted failing protocol stream. Public runtime notification streams default to the
  non-failing mode; rebaseline, stale `afterSequence`, auth, and setup failures are returned before
  stream exposure or as bridge-level close/rebaseline results, not as hidden failures in a
  `Stream.Stream<RuntimeEvent, never>`.
- `PubSub.bounded`, `PubSub.bounded({ capacity, replay })`, `PubSub.subscribe`,
  `PubSub.publish`, `PubSub.shutdown`, `Stream.fromPubSub`, `Stream.fromPubSubTake`,
  `Stream.toPubSub`, `Stream.runIntoPubSub`, `Stream.toPubSubTake`, `Channel.toPubSub`,
  `Channel.runIntoPubSub`, and `Channel.toPubSubTake` are not production event-hub permissions.
  Promoting a package-local PubSub hub requires a same-change spec row naming capacity, replay size
  when used, publisher path, slow-subscriber behavior, scope owner, shutdown finalizer, subscriber
  close behavior, publish-failure semantics, and why the existing replay-ring plus per-subscriber
  queue design is insufficient for that internal hub. Public runtime, desktop, browser-tool, and
  headless subscriptions use the runtime replay-ring plus per-subscriber queue rule so slow consumers
  cannot block runtime publication.
- Snapshot-then-stream or otherwise lossless handoff is a `svvy` runtime policy, not a durability
  guarantee provided by Effect. APIs that promise that handoff acquire
  the subscriber queue in the consumer/API scope before the initial read, keep that subscription
  scope open until the consumer closes it, and return or record the initial read's app-runtime
  high-water sequence. The exposed stream then emits only events whose `sequence` is greater than
  that high-water mark, or documents a duplicate-safe invalidation contract where consumers de-dupe
  by sequence before refetching. A handoff that subscribes before reading but does not define the
  snapshot cursor and post-snapshot filter is incomplete.
- `Stream` is used for runtime events, pi turn output, command stdout/stderr, subprocess output, and
  source invalidation hints. It is not used as a durable read model, persisted queue,
  renderer-owned snapshot, or transcript reconstruction source.
- Use `PubSub` only after a package spec and adoption-manifest row name the internal package-local
  notification hub owner, exact members, capacity, replay behavior, and slow-subscriber policy.
  Public `Runtime.events(...)` remains the replay-ring plus per-subscriber queue design.
  `Stream.broadcast`, `Stream.broadcastN`, and `Stream.share` are not svvy permissions. They require
  installed-export audit rows, production manifest rows, package-boundary allowlists, owner policy,
  and focused tests before any production or test use outside an exact audit canary.
  Manifest-adopted `Stream` value reads are exactly the members in
  `adoptedEffectRuntimeModuleExports`. Additional stream constructors require explicit adoption:
  `Stream.fromAsyncIterable` only at Promise/bridge boundaries with typed error mapping,
  `Stream.fromEventListener` or `Stream.callback` only for host event adapters, `Stream.fromPubSub`
  only after the owning package promotes ordinary PubSub streams in the manifest,
  `Stream.fromPubSubTake` only after the owning package promotes a failing PubSub protocol stream,
  and `Stream.fromSubscription` only after the owning package promotes scoped PubSub subscriptions.
  Domain services still consume package-owned `Stream` values and must not
  import platform stream modules directly. Public facade bridges use the manifest-adopted
  `Stream.toAsyncIterableEffect` where the facade owns the conversion scope.
  `Stream.toAsyncIterableWith` is not production-adopted. svvy does not collect unbounded
  command/event streams into memory. Each target stream member that is not in the adoption manifest
  requires a manifest row, package-boundary allowlist, and focused behavior test in the same patch
  that first uses it. Reference:
  `docs/references/effect-smol/packages/effect/src/Stream.ts`. Async stream constructors require
  manifest adoption and focused tests.
- `Stream.fromEffectSchedule`, `Stream.paginate`, `Stream.fromReadableStream`, `Stream.runCollect`,
  `Stream.runDrain`, `Stream.runFold`, `Stream.runHead`, `Stream.runLast`, `Stream.scoped`,
  `Stream.unwrap`, `NodeStream.fromReadable`, and `BunStream.fromReadableStream` are not product
  adoption instructions. They require the owning package spec, Effect adoption manifest, lockfile
  dependency set where needed, package-boundary allowlist, and focused behavior tests in the same
  patch that first uses them in production. Event replay, event catch-up, polling, and
  reconciliation use currently manifest-adopted `Schedule` members with explicit scoped worker
  loops, or finite repository page effects. `Effect.repeat(...)` is audit-only and unavailable
  unless manifest rows and focused tests adopt it. `@effect/platform-node/NodeStream` is not installed or adopted in the current
  architecture.
- For snapshot-then-stream APIs where a subscription must precede an external initial read,
  `PubSub.subscribe(...)` plus `Stream.fromSubscription(...)` is the target shape only after the
  owning package promotes scoped PubSub subscriptions in the manifest. Until then, use the package's
  adopted stream/queue members or an explicit scoped service method that owns subscription lifetime.
  When `Stream.callback` and Queue terminal members are adopted for a package-owned host bridge,
  adapters model host close/completion with `Queue.end(queue)`, host errors with `Queue.fail`, and
  adapter teardown with scoped cleanup or
  `Effect.acquireRelease`. Long-lived callback streams choose `bufferSize` and `strategy`
  deliberately; svvy treats omitted `bufferSize` as unacceptable for long-lived adapters because it
  leaves backpressure capacity implicit. Omitted `bufferSize` is allowed only for finite,
  operation-scoped adapters whose maximum emission count is proven by the owning package. Long-lived
  `Stream.callback` adapters must pass an explicit `bufferSize` and `strategy`. Dropping/sliding
  callback buffers are allowed only for rebuildable, non-authoritative hints. References:
  `docs/references/effect-smol/packages/effect/src/Stream.ts` and
  `docs/references/effect-smol/packages/effect/src/Queue.ts`.
- Use `Stream.mapEffect` / `Stream.flatMap` with explicit `concurrency` only when item ordering is
  not product-significant or the chosen concurrency preserves the required order. Command output,
  tool-argument snapshots, request-input answers, and queue dispatch streams default to sequential
  processing unless a package spec names a concrete safe parallelism rule.
- Runtime events are notifications. Durable recovery uses `@svvy/state`, not event-stream replay.
- Runtime publishes notifications only after the corresponding state transaction commits or after a
  live stream patch exists in the scoped runtime state. Extension handlers do not publish arbitrary
  runtime events.
- Runtime event streams expose one app-runtime sequence cursor. Public `Runtime.events(...)` replay
  is served from the runtime-owned sequence ring/index, while scoped subscriber queues are only
  bounded live fanout.
  When a subscriber asks for `afterSequence` older than the retained runtime replay window or
  otherwise cannot be served losslessly, runtime returns a typed rebaseline error and the consumer
  refetches state read models before resubscribing. Do not add per-event-family replay cursor
  schemes or treat replay buffers as persisted event history. `surface.stream` additionally carries
  `streamSequence` as a target-local live transcript patch cursor; that cursor is for per-surface
  gap detection only and is never an `afterSequence` cursor.
- Runtime event publication uses one serialized event-bus lane per app runtime for sequence
  assignment, replay-ring append/index update, filtered offer to matching subscriber queues, and
  publication receipt recording. The production event-bus lane uses a one-permit `Semaphore` owned by the
  event-bus service; an Effect queue-based ordered publication lane or a `SynchronizedRef` state
  machine requires exact manifest promotion before production use. Concurrent state commits may enqueue
  notifications, but they must not publish sequence `2` before sequence `1` or append replay records
  in a different order from the exposed app-runtime sequence cursor.
- Authoritative event publishers check the yielded result of the runtime fanout primitive they use.
  For public `Runtime.events(...)`, a yielded `false` result from `Queue.offer(...)` on a matching
  subscriber means that subscriber is slow or closed; runtime closes that subscriber with a typed
  slow-consumer/rebaseline receipt and does not claim the event was delivered to it. For
  promoted package-local PubSub hubs, the `PubSub.publish(...)` boolean means the operation
  was accepted by the hub strategy, not that every subscriber observed the value losslessly.
  Dropping/sliding telemetry and rebuildable hint lanes may accept lossy semantics only when their
  owning package spec says loss is acceptable.
- Lossless PubSub consumers are not production-adopted. When promoted, consumers that must avoid a
  publish race acquire `const subscription = yield* PubSub.subscribe(pubsub)` in the consumer scope
  before initial sync or other publish-sensitive work, then consume the acquired subscription with
  `Stream.fromSubscription(subscription)`. Direct `PubSub.take(subscription)` loops are a
  non-adopted surface pending exact manifest/spec/test promotion. `Stream.fromPubSub(...)`
  subscribes lazily when the stream starts running, so `Stream.fromPubSub(pubsub).pipe(
Stream.runForEach(...), Effect.forkScoped)` is not readiness proof for no-missed-event consumers.
  Use lazy PubSub stream helpers only when lazy subscription at stream run time is acceptable. Do not
  fork a lazily subscribed PubSub stream and assume the subscription is active before the next state
  read or publish.
- Durable queue rows remain in `@svvy/state`.
- Use `Effect.all` and `Effect.forEach` with explicit `concurrency` for independent finite
  collections whose order does not define product behavior, such as extension readiness probes,
  provider metadata probes, source fingerprint reads, generated-package validation, app-log
  notification fanout, and recovery scans. `Effect.withConcurrency(...)` and
  `References.CurrentConcurrency` are not production-adopted unless exact manifest rows exist and tests name the
  bounded, scoped fanout default. Durable owner serialization, including prompt locks, queue claims,
  command output ordering, state transactions, and per-surface runtime scope lanes, still uses
  explicit semaphores, queues, and transactions.
- `Effect.partition` and `Effect.validate(..., { discard: true })` are not production-adopted unless exact
  manifest adoption and focused aggregate-validation tests exist. After adoption, use them for
  finite independent validation when product logic needs both accepted outputs and every diagnostic
  from the batch, or only accumulated diagnostics respectively. Boundary code maps returned error
  arrays or `NonEmptyArray<E>` into the owning package's aggregate tagged error shape before
  crossing package, facade, RPC, or persistence boundaries. This is the target shape for
  source-library validation, generated-package source validation,
  extension manifest validation, provider/model binding validation, and package-boundary contract
  audits that should report all invalid inputs together.
- Do not use collection concurrency to implement persisted queue claim order, per-surface prompt
  serialization, transaction sequencing, command stdout/stderr ordering, request-input answer
  ordering, or handler report ordering. Those use state transactions, semaphores, queues, and
  explicit runtime policy.
- Effect `Queue` is allowed only for in-memory wakeups, worker worklists, and command/event
  backpressure.
  Manifest-adopted `Queue` value reads are exactly the members in
  `adoptedEffectRuntimeModuleExports`. Additional queue helpers named below are API rules for
  approved use and require a manifest row plus focused worker tests before production use.
- `Queue.bounded` and `Queue.dropping` take numeric capacities and are the current
  production-adopted queue constructors. `Queue.sliding` is a target-only constructor until exact
  manifest adoption, boundary allowlists, owner policy, and focused tests land. Replay buffers are a
  `PubSub` / stream fanout concern, not a `Queue` feature.
- `Queue.offer(queue, value)` yields `true` when the value is accepted and `false` when the queue is
  already closed or a dropping queue rejects a full-queue offer. Callers on authoritative paths must
  check the yielded boolean or otherwise prove that `false` cannot happen before treating the
  handoff as accepted.
  `Queue.offerAll(queue, values)` is not production-adopted unless exact manifest rows exist. When
  promoted, it returns the values that were not accepted; callers must persist, retry, or
  explicitly discard those values according to the lane's data-loss policy.
- Bounded batch-drain queue helpers such as `Queue.takeBetween`, `Queue.takeAll`, `Queue.takeN`,
  `Queue.clear`, `Queue.poll`, and `Queue.collect` are not svvy permissions. Production workers use
  only manifest-adopted queue members and explicit authoritative state reread loops until exact
  installed-export audit rows, adoption rows, owner policy, and focused tests promote a specific
  helper.
- `PubSub.bounded(capacity)` and `PubSub.bounded({ capacity, replay })` are not active production
  permissions. Bounded PubSub is the only candidate shape for a promoted backpressured hub, replay is
  allowed only for bounded recent-notification convenience, and the hub must not be treated as
  durable recovery. Every promoted notification hub that uses replay names its replay count, overflow
  result, subscriber slow path, and rebaseline read model in the owning package spec.
- `PubSub.dropping`, `PubSub.sliding`, `PubSub.unbounded`, and `PubSub.publishUnsafe` are not
  adopted production members. Dropping/sliding are eligible only for explicitly rebuildable hints or
  telemetry after exact adoption, and unbounded is eligible only when producer cardinality is finite
  and documented.
  `PubSub.publishUnsafe` remains diagnostic or best-effort only and must not publish durable events,
  command facts, queue delivery, or app-log persistence.
- Current queue constructor policy: use `Queue.bounded` for lossless in-memory handoff paths and
  `Queue.dropping` only for explicitly non-authoritative hints that can be rebuilt.
  `Queue.sliding` and `Queue.unbounded` are unavailable in production until exact manifest
  promotion. Production queue value reads are limited to the exact manifest rows; additional queue
  constructors or terminal helpers require manifest adoption, boundary allowlists, and focused tests
  in the same change. Long-lived queues are shut down in their owning scope with `Queue.shutdown`.
- Every package-owned long-lived queue or PubSub lane names capacity and overflow behavior in the
  owning package spec. Command output, command lifecycle events, pi turn deltas, and tool argument
  snapshots are lossless after the durable command/session fact boundary; they use bounded
  backpressure or durable spill/replay rather than dropping. Read-model invalidations, source-watch
  hints, generated-context stale hints, and watcher wakeups may coalesce, slide, or drop because
  consumers refetch authoritative state. Telemetry and low-cardinality metrics may sample or drop
  when the owner documents that loss.
- Finalizers that call boolean-returning cleanup helpers discard the cleanup result, for example
  `Queue.shutdown(queue).pipe(Effect.asVoid)`, because `Effect.addFinalizer` finalizers return
  `Effect<void, never, R>`.
- `Queue.shutdown` is a scoped teardown primitive: it immediately clears buffered messages, resumes
  pending operations, finalizes an open queue with interruption, makes future offers return `false`,
  and makes future takes observe the terminal exit. Use it from finalizers when a service is
  stopping. After Queue terminal-member production adoption, normal graceful completion of a
  queue-backed stream uses `Queue.end(queue)`. Do not use shutdown to mean "all work was processed
  successfully."
- `Queue.end(queue)` means graceful producer completion and is not production-adopted.
  `Queue.fail(queue, error)` is source-gated: the manifest lists the member so installed-export and
  production member gates can see it, and `auditedEffectInstalledExportMemberPolicies` permits
  production calls only from `packages/pi-adapter/src/pi-adapter.ts` for typed queue-backed turn/event
  protocol failure. Any other queue owner requires a same-change member-policy row,
  package-boundary expected row, owning spec text, and focused queue protocol tests.
  `Queue.failCause(...)` exists in Effect v4 but is not adopted in this repo until the production
  Effect manifest and focused queue protocol tests name it.
  `Queue.interrupt` means graceful interruption after buffered messages drain and is not
  production-adopted. `Queue.shutdown` is production-adopted only as scope teardown and immediate
  discard.
- When a service exposes an in-memory queue to collaborators after the relevant members are
  production-adopted, expose `Queue.Enqueue<A, E>` to producers through `Queue.asEnqueue(queue)` and
  `Queue.Dequeue<A, E>` to consumers through `Queue.asDequeue(queue)` instead of handing out the full
  `Queue` unless both sides intentionally need full queue authority. This is a TypeScript capability
  boundary only; the owning service still owns scope, shutdown, capacity, and durable recovery
  semantics.
- Queue-to-stream adapters are allowed only for process-local handoff streams after the exact queue
  and stream members are production-adopted. The target form is
  `Stream.fromQueue(Queue.asDequeue(queue))` for a scoped queue consumer; `Stream.toQueue(...)` is
  allowed only when a stream-backed queue is owned by the same scope, and `Stream.runIntoQueue(...)`
  only when the consumer owns queue shutdown. Durable surface queues remain SQLite rows.
- `Channel` is audit-only low-level stream machinery. After exact promotion, it is limited to
  package-local protocol, framing, encoding/decoding, or backpressure adapters where ordinary
  `Stream` combinators would obscure the actual protocol. `Channel` implementations stay behind
  package-owned service methods or streams; they are not public package APIs, durable event logs,
  read-model stores, queue state, transcript reconstruction, or UI refetch mechanisms. Promote
  `Stream.pipeThroughChannel(...)` only when the channel intentionally owns the upstream error
  protocol. Promote `Stream.pipeThroughChannelOrFail(...)` only when upstream stream failures must
  survive alongside framing/codec failures.
- `Sink` is audit-only. After exact promotion, it is limited to scoped finite stream consumption and
  reductions such as collecting a bounded probe response, folding command-output batches before
  persistence, or test assertions over stream output. Long-lived runtime consumers should be
  explicit scoped stream loops when ordering, shutdown, or backpressure policy matters. `Sink` does
  not own durable state, app-log storage, event replay, queue claims, or renderer snapshots.

Do not use a consumer-narrowing queue/stream sample in this spec until the exact members are
adopted. Production wakeup consumers use manifest-adopted `Queue` members, `Ref`/`Semaphore`
coordination, `Effect.forkIn(ownerScope)`, and authoritative state reread loops. A sample using
queue/stream narrowing must be added only in the same change that promotes every member it uses.

- Runtime queue wakeups carry only non-authoritative keys or hints, such as workspace id,
  surface id, queue domain, or recovery lane. They are offered only after the durable transaction
  that created or changed the row commits and never while holding the state transaction. Wakeup
  consumers drain authoritative state until no eligible rows remain; correctness never depends on
  receiving every in-memory wakeup value. Use `Queue.bounded` only when producer backpressure is the
  intended and tested behavior. Rebuildable hints prefer coalescing plus `Queue.dropping`, backed by
  periodic recovery scans. `Queue.sliding` requires exact manifest promotion before production use.
  Every long-lived queue has a scoped drain fiber and a shutdown finalizer.
- Rebuildable queue wake hints update dirty-key/coalescing state before offering the wake signal. If
  the yielded `Queue.offer(...)` result is `false`, the dirty key remains recorded and the worker
  must still discover it through the next drain, explicit wake, or recovery scan. Tests set wake capacity to
  one, force a failed offer, and prove committed queue rows are still claimed.
- Lossless delivery is required for transcript stream deltas, command output needed for command
  facts, queue delivery work, and terminal command lifecycle events. Bounded queues, pubsubs, and
  streams use backpressure for those paths rather than dropping or sliding messages.
- Pi turn event streams use the package-owned `@svvy/pi-adapter` callback bridge. The bridge may use
  a bounded `Queue.dropping` queue only when every `Queue.offer(...)` result is checked; a failed
  offer must close the turn stream with a typed `PiAdapterError`, fail the queue-backed protocol
  with `Queue.fail`, and complete the turn `closed` signal consistently with that failure. This is a
  fail-closed overflow policy, not silent loss or durable recovery.
- Runtime notification fanout must not use `PubSub.dropping`, `PubSub.sliding`, `Queue.sliding`,
  `Queue.dropping`, or `SubscriptionRef` in a way that silently loses runtime events. Runtime owns
  per-subscriber sequence accounting. If a bounded subscriber buffer cannot accept the next event,
  runtime closes that subscriber with the typed slow-consumer/rebaseline result before exposing
  further events. Rebaseline-able means recoverable from state, not silently droppable.
- Command output may be batched for UI efficiency with an adopted state-owned byte/line batcher.
  `Stream.groupedWithin(maxChunks, maxLatency)` is not production-adopted unless exact manifest rows exist and
  command-output batching tests exist. Batching must preserve admitted event order and
  stdout/stderr stream identity, flush at terminal command completion, and never drop output required
  for command facts, summaries, artifacts, or inspector/read-model state. Batching reduces renderer
  patch frequency; it is not a data-loss policy.
- Dropping, sliding, throttling, or sampling is allowed only for non-authoritative UI hints,
  telemetry hints, or source-watch hints where the consumer can deterministically rebaseline from
  `@svvy/state` or a fresh fingerprint scan.
- Queue claim, ordering, retry, and delivery policy live in `@svvy/runtime`.
- Transactional row writes live in `@svvy/state`.
- `Deferred` is used for single-use readiness gates and request/response handoffs. It is not
  persisted state, not a reusable lock, and must not replace request-input rows, approval rows,
  queue rows, command terminal facts, one-permit prompt semaphores, or synchronized active-turn
  state.
- Runtime wait registries combine durable rows with process-local `Deferred`s. The durable row is
  authoritative for request-input waits, approval waits, protocol requests, continuable command
  stdin/process state, and bridge request/response state. The scoped runtime service may keep a
  `Ref`/`SynchronizedRef` map from durable wait id to one-shot `Deferred`, but it removes entries on
  success, typed failure, timeout, interruption, cancellation, row terminalization, runtime recovery,
  or scope close. Restarted runtime reconstructs wait state from durable rows and does not depend on
  pre-restart `Deferred` instances.
- Blocking wait registration is a two-source protocol. Runtime installs the process-local
  `Deferred` in the scoped wait registry, then reads the durable wait/request row in the same
  runtime operation before awaiting. If the durable row is already answered, defaulted, cancelled,
  expired, or terminal, runtime completes/removes the `Deferred` immediately and does not wait. The
  answer/timeout path commits durable state first, then resolves the registered `Deferred` when one
  is present. Recovery scans durable rows and resolves or clears missing process-local waiters.
- Complete process-local wait `Deferred`s only with currently adopted members:
  `Deferred.succeed(...)` for successful answer/readiness resolution and `Deferred.fail(...)` for
  typed terminal wait failure, including owner-scope cancellation mapped to the package typed
  cancellation error. `Deferred.interrupt`, `Deferred.interruptWith`, `Deferred.done`,
  `Deferred.isDone`, and `Deferred.poll` remain unavailable until exact manifest rows, owner policy,
  boundary allowlists, and focused tests are added.
- `Latch` remains a conditional installed-export canary, not a production primitive. Production
  readiness and wait paths use adopted `Deferred` / `Ref` / `Semaphore` patterns plus
  runtime startup readiness services. After exact production promotion, `Latch` may be used for
  reusable scoped readiness gates such as “initial source scan completed” or “event subscription is
  attached,” with owner policy, receiver/member coverage, and tests. Until then, do not model
  product readiness with `Latch` or a mutable `Deferred` replacement pattern; use the adopted package-local
  readiness service shape.
- In Effect v4, `Ref`, `Deferred`, and `Fiber` values are not Effect subtypes. For
  manifest-adopted effectful handles, sequence explicit module operations such as `Ref.get(ref)` and
  `Deferred.await(deferred)`. The runtime active-prompt owner may use the source-gated
  `Fiber.join(fiber)` and `Fiber.interrupt(fiber)` operations; `Fiber.await(fiber)` and other members
  remain unavailable. Do not `yield*` a `Ref`, `Deferred`, or `Fiber` value or pass those values to
  Effect combinators as if they were effects.
- Use `Ref` for pure atomic state reads, writes, and transformations. After exact
  `SynchronizedRef` promotion, use `SynchronizedRef.modifyEffect` /
  `SynchronizedRef.updateEffect` only for short effectful critical sections where the whole effect
  must be serialized with the in-memory state transition. Do not hold a `SynchronizedRef` semaphore
  across pi turns, subprocess execution, Smithers CLI work, user waits, stream drains, long
  filesystem scans, or unrelated database transactions. When durable state or external observations
  are needed, read the current in-memory state, perform the durable/external work outside the ref
  lock when possible, then commit the minimal synchronized handoff under the owner lane. The
  exception is a deliberately serialized owner lane such as runtime event sequence assignment, where
  the package spec names the short critical section and its backpressure behavior. Production
  coordination uses `Ref` plus `Semaphore` or explicit ordered owner lanes for these cases. Do not
  `Ref.get`, perform an effectful gap, then `Ref.set` for active-turn, wait-registry,
  prompt-lock-adjacent, subscription, or command-session state.
- Synchronous mutable Effect collections such as `MutableRef`, `MutableHashMap`, `MutableHashSet`,
  `MutableList`, and similar `Mutable*` modules are not default package state primitives. Prefer
  immutable values inside currently adopted `Ref` values, or small package-owned maps hidden behind
  a service. After exact promotion, `SynchronizedRef`, `FiberMap`, and `FiberSet` may be used for
  the owner lanes and scoped registries named by the owning package spec. A `Mutable*` module is
  allowed only inside a package-private hot path or foreign-adapter boundary when the owning package
  spec names the performance/product reason, mutation scope, concurrency assumptions, tests, and why
  `Ref` or an immutable data structure is insufficient. Mutable collections must never cross a
  public package boundary, renderer bridge, runtime event, state port, or generated package
  contract.
- `FiberHandle`, `FiberMap`, `FiberSet`, `SynchronizedRef`, and `ScopedRef` are scoped
  live-runtime machinery that requires exact manifest promotion before production use. `FiberHandle` owns one replaceable
  fiber lane such as latest scan, latest title job, or latest refresh worker. `FiberMap` and
  `FiberSet` are created inside a `Scope`, automatically remove completed fibers, and interrupt
  tracked fibers when the scope closes. `ScopedRef` owns a replaceable scoped value such as a
  protocol client, subscription, or helper handle and closes the previous value's scope on
  replacement. These values require exact manifest rows, boundary allowlists, owner specs, and
  focused tests before production code imports them. Production coordination uses only exact
  adopted members such as `Deferred`, `Ref`, and `Semaphore`.
- `Fiber.join` and `Fiber.interrupt` are source-gated to runtime active-prompt ownership. The
  surface scope may retain exactly one active prompt fiber, expose only a join Effect to its queue
  dispatcher, and interrupt and join that fiber during forced shutdown before durable recovery or
  the shutdown receipt. Fiber identity is not a separate
  product ownership model: it is never persisted, published, exposed through facades, or used in
  place of durable active-turn, command, queue, or recovery facts. Other Fiber members require exact
  manifest promotion first.
- `RcMap` owners document finite capacity or intentional unbounded capacity. Finite-capacity
  `RcMap` acquisition can fail with capacity errors; the owning package maps those failures into its
  typed error channel before crossing a package boundary. `RcMap.invalidate` and `RcRef.invalidate`
  force future borrows to acquire a fresh resource, but they do not revoke already borrowed
  resources; active borrows remain usable until their borrowing scopes close. Use explicit
  interruption/cancellation for active protocol sessions or clients that must be revoked
  immediately, such as credential rotation that invalidates in-flight use.
- `Resource`, `ScopedCache`, `RcMap`, `RcRef`, `Pool`, and `Cache` owners name invalidation
  triggers for provider credential changes, extension env changes, generated-package rebuilds, CLI
  requirement refreshes, helper/protocol version changes, and app shutdown when those triggers can
  affect the cached value. Credential revocation or extension-secret replacement must interrupt
  active borrows when continued stale use is unsafe; simple invalidation is enough only when active
  borrows are allowed to finish with the prior snapshot.
- Process-local `Cache`, `ScopedCache`, `RcMap`, and hash-collection keys are branded strings or
  numbers by default. Structured logical keys require exact production adoption for the relevant
  `Data`, `Equal`, and `Hash` members plus focused tests; do not use fresh plain object literals as
  logical keys.
- In Effect programs, allocate live coordination primitives only through exact production-adopted
  constructors. Production constructors include `Deferred.make`, `Ref.make`, and
  `Semaphore.make`; target constructors such as `Latch.make`, `SynchronizedRef.make`,
  `SubscriptionRef.make`, `FiberHandle.make`, `FiberMap.make`, `FiberSet.make`,
  `ScopedRef.fromAcquire`, and `ScopedRef.make` require exact manifest adoption first.
  `FiberHandle`, `FiberMap`, `FiberSet`, and `ScopedRef` constructors must run in the owning
  `Scope`; they are not package globals. Use `makeUnsafe` / unsafe acquire variants only at
  synchronous construction edges where the owner can prove the value is immediately installed into a
  scoped service or test fixture and will be closed by that scope.
- After exact production adoption, `FiberHandle.makeRuntime`, `FiberMap.makeRuntime`, and
  `FiberSet.makeRuntime` are allowed only inside an already scoped owning service to adapt
  callback-style or imperative registration APIs into scoped fibers. They do not replace the
  app-level `ManagedRuntime`, must not be exposed as public package facades, and must not be stored
  in product state, renderer objects, or bridge payloads. Use the Promise variants only when a
  foreign API requires Promise-returning callbacks, and map rejection or squashed causes back into
  typed package errors before crossing a svvy package boundary. Closing the owner `Scope` remains
  the lifecycle boundary that interrupts the tracked fibers.
- `Semaphore.Semaphore.withPermit` is the only production-adopted permit helper, and only for
  the exact runtime owner files named in `packages/effect-adoption-manifest.ts`: the runtime event
  bus publication lane, the runtime shutdown marker/queue-claim admission lane, the runtime surface
  event publisher target-local stream cursor lane, and retained surface prompt locks.
  `Semaphore.withPermits` and `Semaphore.withPermitsIfAvailable` are target APIs only after exact
  production manifest adoption, owner/spec text, package-boundary expected rows, and focused
  lock-release tests. Automatic permit release on effect exit is the target lock-safety rule unless a
  lower-level protocol genuinely needs manual `take` / `release`.
  `Semaphore.withPermitsIfAvailable` is allowed only when the product behavior is explicitly “skip
  or return busy if capacity is unavailable now,” such as a noncritical background probe, never for
  required queue claims or prompt turns.
- A surface prompt lock covers exactly one prompt-bearing turn from pre-dispatch generated-context
  refresh through terminal turn settlement. Blocking `request_user_input` keeps that turn and lock
  open until answer, timeout, cancellation, or interruption. Nonblocking `request_user_input`
  completes the tool call with the recommended/default answer and must not keep the prompt lock
  after the tool result has returned; later user answers enter through `request_user_input_answer`
  queue rows that outrank ordinary `user_message` rows, stay FIFO among answer rows, and remain
  separate from row-level `Steer` next-delivery priority.
- Active turn fibers are owned by runtime and keyed by `surfacePiSessionId`. `abort` interrupts the
  active turn fiber for that surface, terminalizes or releases the active queue claim, settles live
  stream state, completes or fails any process-local waiters, records cancellation facts, and releases
  the prompt lock. Runtime must not start a second prompt-bearing turn for the same surface while an
  active turn fiber still owns the lock.

Target runtime supervision form after exact keyed-fiber registry and exit-capture members are
production-adopted:

```text
const activeTurns = yield* makeActiveTurnRegistry<SurfacePiSessionId, RuntimeTurnError>();

const startTurn = Effect.fn("@svvy/runtime/SurfaceTurns.start")(function* (input: TurnInput) {
  yield* acquirePromptTurnLockOrFail(input.surfacePiSessionId);

  if (yield* activeTurns.has(input.surfacePiSessionId)) {
    yield* releasePromptTurnLock(input.surfacePiSessionId);
    return yield* Effect.fail(
      new TurnAlreadyActive({ surfacePiSessionId: input.surfacePiSessionId }),
    );
  }

  yield* activeTurns.run(input.surfacePiSessionId, runTurnAndSettleFromExit(input)).pipe(
    Effect.asVoid,
  );
});

const abortTurn = Effect.fn("@svvy/runtime/SurfaceTurns.abort")(function* (surfacePiSessionId) {
  yield* activeTurns.remove(surfacePiSessionId);
});
```

Use `FiberSet` for unkeyed sibling workers such as source scans or notification fanout, and use
`FiberMap` when product identity such as `surfacePiSessionId`, `commandSessionId`, or `workspaceId`
owns replacement, abort, and recovery behavior. Runtime shutdown paths and deterministic tests use
`FiberMap.awaitEmpty` / `FiberSet.awaitEmpty` after interruption or normal drain when the owner must
prove all tracked work has settled before releasing scopes or asserting final state.
Use `FiberMap.join`, `FiberSet.join`, `FiberHandle.join`, or the returned fiber when the owner must
observe managed-fiber failures. `awaitEmpty` is not failure supervision; it only proves tracked work
has drained or settled.

`FiberMap.run(...)` replaces and interrupts the existing fiber for the key unless
`{ onlyIfMissing: true }` is supplied. Active prompt turns therefore use the durable prompt lock and
surface active-turn state as the product acceptance guard before `FiberMap.run(...)`; the map is
supervision and abort machinery, not the lock itself. If a package uses `onlyIfMissing: true`, it
must still map the already-active case to a typed busy/turn-active result before claiming a queue
row or mutating prompt state. `FiberMap.remove(...)` is reserved for explicit abort/cancel,
terminal cleanup, owner-scope shutdown, or tests exercising those paths.

`LayerMap` production adoption is allowed only for scoped keyed resource ownership where the key has
a stable product identity and the package spec names the owner. The owning service defines the key
type, canonical key serialization/equality rule, layer factory, acquisition input, finalizer,
invalidation trigger, and tests. Callers use `.get(key)` only when they need a keyed `Layer` to
provide downstream effects; owner/internal code uses `.contextEffect(key)` only when it needs the
acquired `Context<I>` directly. `invalidate(key)` is owned by the same runtime/service that owns the
key lifecycle and is used for explicit workspace/surface/session replacement, source-fingerprint
changes, or shutdown. It is not a cache eviction API for read models, generated
context strings, provider metadata, command facts, app logs, or durable queue rows. LayerMap keys
must not be UI panel ids, arbitrary object literals, file path strings before canonicalization, or
mutable config snapshots.

`ScopedRef.set(...)` closes the previous scoped value before acquiring the replacement. Use it only
for hard replacement where downtime and failed refresh leaving no active value are acceptable and
documented. For no-gap client/protocol/provider rotation, acquire the replacement in a child scope
first, install it through a `SynchronizedRef` handoff only after successful acquisition, then close
the previous scope after the new value is live. Tests cover both failed replacement and previous-resource
finalization behavior.

Every long-lived worker, stream consumer, protocol loop, watcher, or notification fiber declares a
terminal policy in its owning package spec: catch typed item failures and continue, record a durable
failure and continue, restart with a bounded typed schedule, stop and mark the lane unhealthy,
surface an app-log fact and stop, or fail the owner readiness/scope. Recoverable per-item failures
are caught and recorded without killing the whole loop. Interrupt-only causes propagate as
shutdown/cancellation. Uncaught worker failure is allowed only when the owner tracks the fiber in a
`FiberSet`, `FiberMap`, or `FiberHandle` and observes `join` through a supervisor that records the
terminal behavior.

## Worker Utility Rules

Package-private drainable and keyed-coalescing worker helpers may copy the semantic API shape from
the local `t3code` `DrainableWorker` and `KeyedCoalescingWorker` references, not their
implementation defaults. Production worker helpers use manifest-adopted process-local
primitives such as `Queue`, `Ref`, `Deferred`, `Semaphore`, and `Schedule` only where exact manifest
rows exist; `SynchronizedRef`, `FiberMap`, and `FiberSet` require exact promotion before worker
utility implementations use them. `Effect.tx`, `Effect.txRetry`, `TxQueue`, `TxRef`, `TxPubSub`,
`TxSemaphore`, and other `Tx*` helpers remain unadopted for worker utilities until an owning package
spec adds the exact adoption record, import allowlist, failure semantics, and tests. Worker
utilities must be adapted to svvy's durable-state model:

- `enqueue(...)` accepts only process-local wakeups, hints, or bounded work items; durable work is
  represented by SQLite rows, source fingerprints, command facts, recovery rows, or generated
  package facts.
- `drain(...)` resolves only after the input queue is empty and the currently running item, if any,
  has settled or terminalized according to the worker's item-failure policy.
- `drainKey(key)` for keyed workers resolves only after no queued item and no active item remains
  for that canonical key, including one follow-up pass if the key was dirtied while active.
- Keyed workers define a canonical key schema, merge function for repeated hints, maximum
  coalescing latency, active/queued/latest state, and overflow behavior. If a sliding/dropping lane
  can lose a wakeup, the worker also runs deterministic state scans so lost hints cannot lose
  durable work.
- Item failures do not silently kill the worker. Recoverable item failures are caught, logged or
  persisted, and the worker continues. Durable item failures update the relevant row/fact with
  attempt count, last error, next attempt, terminal status, or recovery lease outcome before the
  worker observes the item as settled.
- Worker utilities expose semantic operations such as `enqueue`, `drain`, `drainKey`, `shutdown`,
  and test receipts; they never expose process-local queue/ref values or treat them as durable
  queues/state.
- Long-lived worker utilities use bounded queues by default. Unbounded queues are allowed only for
  finite producer cardinality documented by the owning package spec.

Every scoped process-local worker utility used by runtime, source invalidation, generated-package
refresh, title jobs, recovery, or app-log fanout exposes a semantic drain handle in its owner/test
surface. The drain resolves only when queued and active work for that worker is complete. Enqueue
accounting and drain accounting update atomically with the enqueue path, and worker processing
decrements outstanding work in `Effect.ensuring(...)`. Runtime worker tests must not use
`Effect.sleep`, polling, filesystem probing, or read-model polling when a worker can expose a
semantic receipt, `drain()`, or `drainKey(...)`.

Invalidation workers that process replaceable work by stable key, such as workspace source scans,
extension generated-context refresh, generated-package link repair, and CLI requirement probes, use
keyed coalescing semantics: at most one queued or active process-local item per key; new values merge
into the latest pending value; an active key processes the latest queued value immediately after the
current run; `drainKey(key)` is available to deterministic tests. Correctness still comes from
durable state, source fingerprints, or recovery rows, not from the coalescing map. Do not enqueue one
process-local worker item per watcher event or per renderer invalidation when the product work is
replaceable by key.

Durable retries are state transitions, not hidden in-memory loops. Runtime queue delivery, recovery
sweeps, title jobs, source reconciliation, request-input timeout recovery, generated-context refresh,
and generated-package refresh record every durable attempt transition through `@svvy/state`: claim
or lease, `attemptCount`, `lastError`, `nextAttemptAt`, terminal status, and any app-log/command
fact needed for user-visible behavior. `Effect.retry(...)` with `Schedule` is allowed inside one
durable attempt for a non-authoritative probe or a short host call when product state does not need
each sub-attempt. It must not hide multiple durable queue/recovery attempts behind one row claim,
one command fact, or one generated-package fact.

## Child Process Rules

Production command-like execution uses runtime-owned command/session services backed by
app-bootstrap primitive host process ports. `effect/unstable/process` is audited as a candidate
Effect-backed implementation detail only; it is not production-adopted. Promoting
`ChildProcessSpawner.ChildProcessSpawner` requires command-like execution to still use Effect-scoped
process services with the same ownership rules:

- Shell `exec_command`
- Shell `write_stdin`
- sandbox helper launch
- `execute_typescript`
- Shell-launched `svvyx ...` CLI commands
- extension CLI requirement checks
- promoted runtime-owned extension dependency actions, if and only if the dependency-action
  admission contract is specified and implemented
- prompt-only CLI guidance when invoked through Shell

Internal `Extensions.svvyx.run(...)` service calls inside `@svvy/extensions` and generated
`execute_typescript` extension facades are not automatically child-process execution. They are
extension service calls that return `ExtensionHandlerResult` values, generated declarations, or
app-owned command facts depending on the extension. Runtime-owned work is represented as ordered
`ExtensionRuntimeOperation` items on the handler result. When an extension operation actually
launches a child process, that launch follows the process rules in this section; when it is an
in-process app-owned implementation, it must not be documented or projected as shell output merely
because its agent-facing command name begins with `svvyx`.

Durable user-visible command sessions, sandboxed Shell execution, model-facing `write_stdin`
continuation and durable command stdin/control, command cancellation, stdout/stderr persistence,
and terminal command facts are runtime-owned. An
extension service may launch a short app-owned helper only when that helper is part of extension
source/build/readiness work and does not need a durable command session. Otherwise the extension
returns an `ExtensionHandlerResult` with ordered `ExtensionRuntimeOperation` items for
`@svvy/runtime` to process.

Shell-dispatched `svvyx` CLI subprocesses are ordinary command-family process edges, not
runtime-effect transport producers. A `svvyx` subprocess may perform CLI parsing, command-family
validation, sandboxed helper work, and return parsed command output, stdout/stderr, diagnostics, or
parse/build evidence for the parent command session to record. It must not emit signed
runtime-effect transport intents, including `runtime_effect.request`, and must not create
`ManagedRuntime`, call `Effect.run*`, open SQLite product databases, construct product state ports,
publish runtime/read-model events, mutate artifact/profile/session/thread state directly, or choose
the owning session, thread, source command, or surface.

Runtime-owned work from `svvyx` commands flows through the normal extension-handler result path.
The accepted command is routed back through `@svvy/runtime`, which invokes the owning trusted
extension handler in-process and applies its ordered `ExtensionRuntimeOperation` items through
runtime-owned lanes and core-owned state ports. Runtime may patch parent command facts and
model-facing output from validated handler results and command-session context, but the Bun CLI
transport does not define or carry a duplicate runtime-effect request type, signed transport-intent
validator, public applier, or replay API.

Process transport intent is not a supported `svvyx` CLI subprocess payload. Adding one requires a
product reason, PRD and feature-inventory update, a typed `@svvy/core` contract, an owning runtime
replay rule, and fail-closed tests.

Allowed extension-owned helper subprocesses are bounded source/build/readiness probes such as
exact-version CLI requirement checks, generated instruction/source builds, schema/declaration
generation, and package validation work whose stdout/stderr is consumed by the extension service
and whose result is recorded as extension/build facts. They are not durable command sessions, are
not user-visible Shell command cards, cannot be continued with `write_stdin`, and cannot be
cancelled through public `Runtime.commands.cancel(...)`. Any execution that needs user-visible
streaming, approval linkage, sandbox launch policy, runtime command stdin/control, command inspection,
artifact linkage, or terminal command facts belongs to runtime command/session services.

Extension handler effects are request-bounded. Any resource they acquire directly is
`operationScoped` and is released before the handler returns, fails, or is interrupted. Handlers do
not retain scoped handles, fibers, subprocess handles, queues, pubsubs, watchers, protocol clients,
or mutable refs for later tool calls. Long-lived command sessions, workflow task-agent bridge
attempts, source watchers, generated-package refresh workers, durable waits, and answer-delivery
work are represented as `ExtensionRuntimeOperation` items wrapping closed `RuntimeEffectRequest`
values, immutable `ExtensionExecutionPlan` values, or runtime-owned service calls.

Process execution is not part of the adopted production Effect import surface. The installed
`effect/unstable/process` exports are audited only as a canary for the candidate
`ChildProcess.make(...)` command constructor and `ChildProcessSpawner.ChildProcessSpawner` service
tag. Production
code must not import `effect/unstable/process` unless the same change introduces a real owner seam,
adds the exact value reads to `adoptedEffectRuntimeModuleExports`, updates package-boundary
allowlists, provides a host/app spawner layer, and adds fake-spawner behavior tests. Additional
process API names, handle members, spawner helpers, command option fields, direct subpath imports,
or process pipeline helpers require their own package spec update, Effect adoption-manifest row,
package-boundary allowlist, and focused behavior test before production use.

Shell `exec_command` is the only normal product boundary that accepts a user-authored shell string.
Runtime first converts that request into a canonical shell launch plan before spawning:

- `command`: the exact user-authored shell string after approval segmentation, stored for command
  facts and never reserialized from parsed argv pieces.
- `shellExecutable`: resolved from the user's configured shell or the host fallback, recorded as an
  absolute executable path when known.
- `shellArgs`: explicit shell invocation args such as `["-lc", command]` or the selected
  non-login/login equivalent. The plan names whether login semantics are enabled.
- `cwd`: runtime-admitted canonical working directory supplied to `RuntimeLaunchPolicyService`;
  sandbox policy is acquired later through scoped `SandboxLaunchFacts`, not synthesized in the
  shell launch plan.
- `env`: explicit filtered env with `extendEnv: false`.
- `approvalSegments`: the app/runtime approval-review segments derived from the shell-control
  grammar before launch.
- `sandboxLaunchFacts`: scoped `SandboxLaunchFacts` acquired by runtime through
  `RuntimeLaunchPolicyService` immediately before process launch; app/Bun code never assembles
  helper argv or policy snapshots.

Shell mode is allowed only for Shell requests, prompt-only official CLI guidance issued through
Shell, and app-owned CLI entrypoints whose spec says a shell is part of the interface. Extension
handlers, runtime services, `svvyx` in-process dispatch, dependency checks, and helper protocols use
direct executable/argument plans unless their owning package spec explicitly requires shell
execution. Do not pass `shell: true`, ambient env inheritance, or raw shell strings directly to
the platform spawner outside this launch-plan boundary.

If `ChildProcess` is promoted, the Shell launch plan is executed as a direct executable invocation:
`ChildProcess.make(shellExecutable, shellArgs, options)`. Runtime still does not use
`CommandOptions.shell: true` for Shell requests, because that delegates shell selection, argument
construction, and quoting semantics back to the host. The selected shell is represented by
`shellExecutable` plus explicit `shellArgs`; `CommandOptions.shell` remains unset unless a narrow
host adapter spec names a different platform requirement.

The adopting command/session service constructs `const command = ChildProcess.make(...)` and
executes that command inside the runtime command/session scope. That service owns the tested handle
protocol for stdin, stdout, stderr, terminal status, cancellation, child-command linkage, and
artifacts before exposing command facts. Production code must not call unmanifested process handle
members or spawner helper methods directly. `ChildProcessSpawner.spawn`, collection helpers such as
`string`, `lines`, `streamString`, and `streamLines`, handle members such as `stdin`, `stdout`,
`stderr`, `all`, `exitCode`, `kill`, `isRunning`, `pid`, `getInputFd`, `getOutputFd`, `unref`, and
pipeline helpers such as `ChildProcess.pipeTo(...)` require the owning runtime/sandbox/extension
spec to name the exact product use, projection policy, cancellation policy, manifest entries, and
tests. User-visible Shell, Apply Patch, `execute_typescript`, Smithers, and
`svvyx` command sessions use one runtime-owned command graph with explicit child-command records
instead of hiding subcommands in a process pipe.

The adopting process service depends on `ChildProcessSpawner.ChildProcessSpawner`. App bootstrap may
provide a platform spawner only after the concrete provider import path and member, such as a Bun
platform child-process layer, are installed-verified, added to the adoption manifest, and allowed by
package-boundary tests. Until then, Bun process-spawner provider names remain reference/discovery
material and are not product import permission. `@effect/platform-node` is script/test-only unless a
shipped Node host is introduced by PRD and package-spec updates. Tests for the adopting owner provide
fake `ChildProcessSpawner.ChildProcessSpawner` layers.

Subprocess environment is part of the runtime launch plan. Runtime or the owning extension service
resolves the complete effective env map before launch, including redacted extension env injection,
bridge tokens, sandbox helper variables, and any safe host variables. Package code must not pass
ambient `process.env` through by default. Runtime-owned launches set an explicit filtered `env` map
and `extendEnv: false`. Installed Effect v4 `CommandOptions` documents that `extendEnv: true` merges
`env` with `globalThis.process.env`, while `extendEnv: false` uses only `env`. Product code must not
rely on omitted-env or platform-default inheritance semantics outside approved host adapter modules.
`ChildProcess` `extendEnv` is forbidden in domain services unless the host adapter has already
filtered the inherited env through an explicit allowlist and the command plan records that
inheritance. Secret values are unwrapped only at the trusted invocation boundary and are never copied
into command facts, events, app logs, transcripts, generated declarations, artifacts, or read models.

Sandbox helper execution remains a runtime-owned command launch. `@svvy/sandbox` resolves an immutable
launch policy: helper executable path, helper arguments, temporary profile file or profile text,
filtered helper env additions, network policy, writable/read-only roots, and denial-classification
rules. The sandbox package may create scoped temporary profile files through injected
`FileSystem.FileSystem`, but it does not spawn the child process, own stdin/stdout streams,
terminalize command facts, or retry without sandboxing. When `effect/unstable/process` is adopted,
`@svvy/runtime` combines that launch policy with the approved command plan and runs the helper
through the adopted process service. `approvalMode: "full-access"` is the only normal path that
omits the sandbox helper; sandbox-denial exits or stderr are classified as sandbox denial rather
than retried as unsandboxed commands.

Subprocess effects must:

- run in a `Scope`
- stream stdout/stderr without losing ordering information required by command facts
- support interruption/cancellation
- record exit code, runtime-requested cancellation signal/force-kill facts, and
  adapter-provided structured signal details when the host adapter exposes them
- preserve sandbox and approval facts
- avoid shell mode when a direct executable invocation is required for safety

Runtime-owned command plans set `detached` explicitly. Durable Shell, Apply Patch,
`execute_typescript`, Smithers, `svvyx`, install/update, and sandbox-helper launches normally use
`detached: false` so scoped finalization, terminal watchers, and cancellation facts remain tied to
the owning command session. A detached process is allowed only when a package spec names the
supervised helper process, its parent/child shutdown behavior, recovery owner, and terminal fact
policy.

If process handling is promoted, command cancellation uses the adopted child-process handle
cancellation API, with exact handle members and option keys installed-verified and manifest-recorded
in the same change. The current beta.84 source exposes `kill(options)`, `exitCode`, and `KillOptions`
keys including `killSignal` and `forceKillAfter`, but those members remain conditional until promoted
for the owning command-session service. Runtime awaits terminal completion in the command-session
scope. Unexpected signal details are available only when the host adapter exposes them as structured
data; otherwise they appear as a platform failure. Runtime-initiated cancellation records the
requested signal, force timeout, and whether the forced path was used.

Scope cleanup and user/runtime-requested command cancellation are separate product facts. Normal
terminal process exit records a terminal exit fact. Scope finalization kills any still-running child
only as cleanup for app shutdown, owner-scope close, or interruption; that cleanup does not by itself
record a user-visible cancellation fact. Only an explicit runtime cancellation path records
requested signal, timeout, force-kill, and cancellation reason fields before or together with
terminal command settlement.

When command facts require global stdout/stderr ordering, consume one authoritative output path,
normally `handle.all`, or sequence/tag stdout and stderr in one runtime-owned consumer. `handle.all`
is merged output and is not source-attributed; if command facts or transcripts need stdout/stderr
labels, runtime consumes stdout and stderr through one sequencer and does not also consume
`handle.all`. Do not consume `handle.stdout` / `handle.stderr` and `handle.all` concurrently for the
same facts.

Conditional process-adoption requirements:

This example records the required shape for `effect/unstable/process` adoption. It is outside the
active production architecture without manifest rows, package-boundary allowlists, a host spawner
layer, and fake-spawner tests updated in the same change. The example assumes it runs inside the
runtime-owned command-session scope. A one-shot operation may use `Effect.scoped(...)` only in the
same change that promotes that exact member in the adoption manifest, updates boundary allowlists,
and adds focused owner/lifetime tests. The `Effect.forkScoped(...)` calls in the example are part of
the same non-active adoption sketch and are not production permissions; current production workers
use `Effect.forkIn(ownerScope)`.
Long-lived command sessions run in the command-session scope with the package's explicit scope
owner.

```ts
import * as Effect from "effect/Effect";
import { ChildProcess } from "effect/unstable/process";

const runDurableCommandSession = Effect.fn("@svvy/runtime/commands.runSession")(function* (
  input: RunCommandSessionInput,
) {
  const command = ChildProcess.make(input.executable, input.args, {
    cwd: input.cwd,
    env: input.env,
    extendEnv: false,
    detached: false,
  });

  const handle = yield* command;

  yield* Effect.forkScoped(
    consumeSequencedOutput({
      commandId: input.commandId,
      stdout: handle.stdout,
      stderr: handle.stderr,
    }),
  );

  yield* Effect.addFinalizer(() => cleanupRunningChildWithoutRecordingCancellation(handle));

  const exitCodeWatcher = yield* Effect.forkScoped(
    handle.exitCode.pipe(
      Effect.flatMap((exitCode) => recordTerminalExit(input.commandId, exitCode)),
    ),
  );

  return { handle, exitCodeWatcher };
});
```

The example uses one authoritative output consumer, an explicit filtered `env`, `extendEnv: false`,
an exit-code watcher, and a scope cleanup finalizer that does not record cancellation facts. It
defines the product properties required before `ChildProcessSpawner` can be adopted for this lane.
Production command sessions use the runtime-owned host process port described above. Promoting
`ChildProcessSpawner` for this lane requires installed-verified `effect/unstable/process` members,
exact manifest rows, boundary allowlists, and the product properties above.
Spawner collection helpers such as `spawner.string(command)`, `spawner.lines(command)`,
`spawner.streamString(command)`, and `spawner.streamLines(command)` are not used for user-visible
durable command facts because they collapse process lifetime, output ownership, cancellation, and
fact recording into a collection helper.

Every spawned child stream must be consumed, drained, or explicitly closed. Protocol subprocesses
that use only stdout/stdin still drain stderr in a scoped background fiber so large stderr output
cannot block the child process. Regression tests for protocol adapters include a child that writes
large stderr output while serving successful protocol responses.

Long-running interactive command sessions are scoped runtime resources keyed by durable
command/session id. The scoped command-session service owns the `ChildProcessHandle`, stdin writer,
output consumers, terminal watcher, and cancellation finalizer. `write_stdin` resolves the durable
session id through that service and never receives the raw handle. Accepted stdin chunks enter a
per-command `Queue.bounded(commandStdinQueueCapacity)` admission queue. Runtime awaits
`Queue.offer(...)` until the chunk is accepted, the caller is interrupted/cancelled, or the queue is
shut down. Shutdown or terminal-session rejection maps to a typed closed-session failure; bounded
capacity applies backpressure rather than dropping stdin. The stdin writer drains accepted chunks
losslessly and in FIFO order. Terminal command facts close the session scope. Durable state stores
command ids, session ids, output, accepted stdin write receipts, status, and facts. The accepted
stdin receipt stores the exact admitted text plus `acceptedBytes`; it is product command history,
not a process handle or writer. Durable state never stores process handles, streams, abort
controllers, stdin queues, or stdin writers.

The command-session model is pipe-backed child-process interaction, not a standalone terminal
emulator or alternate TUI runtime. `write_stdin` writes bytes/chunks to a scoped child stdin lane;
stdout/stderr are streams persisted and projected as command output. True PTY semantics are outside
this package architecture unless the PRD, feature inventory, and owning package specs define a
separate scoped PTY adapter under pi/runtime extension seams and prove it does not introduce a
second svvy-owned interactive shell outside pi.

For interactive `write_stdin`, runtime owns one ordered stdin lane per durable command session. The
preferred implementation is a scoped bounded queue of stdin chunks converted to the child stdin
stream/sink by the command-session service. `write_stdin` enqueues one chunk after durable command
session validation and returns only when the chunk has been accepted by the lane or the session is
terminal. The lane preserves write order, applies backpressure, records typed failures when the
child stdin closes, and shuts down when the command terminalizes or the session scope closes.
Runtime does not run independent concurrent sink writes against the same child stdin, does not expose
`endOnDone` to agent inputs, and closes stdin only through an explicit command/session policy such as
EOF, cancellation, terminal child exit, or scoped finalization.

Scoped stdio protocol adapters, such as pi/Codex-like JSON-RPC or line-delimited clients, use this
package pattern:

- expose one package-owned `Context.Service` with domain methods; do not expose raw process handles
  or protocol transport internals
- construct the child process or stdio handle inside `Scope`
- fork reader, writer, heartbeat, and stderr-drain loops with manifest-adopted scoped worker
  ownership; the current adopted pattern is `Effect.forkIn(ownerScope)`
- track pending requests in a scoped `Ref<Map<RequestId, Deferred<Response, ProtocolError>>>`
- remove pending entries on success, typed failure, timeout, or interruption
- fail all pending requests when the child exits, the reader loop terminates, or protocol decode
  fails
- decode inbound messages and encode outbound messages through generated or hoisted schema maps
- reject requests/events for methods whose schema is absent instead of passing unknown payloads
  through as `unknown`
- map protocol errors into package typed errors before they cross package boundaries

Every request/response bridge with process-local pending requests maintains an explicit pending map
keyed by request id. Scope close, transport termination, parser failure, process exit, and
interruption remove or fail all pending entries with a typed bridge error. A bridge may not leave a
`Deferred` awaiting after its owning scope has terminalized. Do not model bridge request completion
as "the stream will eventually end"; pending requests must be explicitly completed, failed, or
removed on every terminal path.

Every stdio/helper protocol adapter names its maximum in-flight request count per child. New
requests pass through a bounded admission path, such as a semaphore or bounded queue, and fail with a
typed backpressure error when full; the pending `Ref<Map<RequestId, Deferred<...>>>` never grows
unbounded. Request ids are generated by the adapter's injected id service, are unique per child
session, and are removed exactly once on every terminal path. Any bridge that supports both generated
typed calls and raw/extension calls must allocate disjoint request-id namespaces or otherwise prove
collision impossible. The id namespace is part of the bridge contract and has a regression test that
concurrent typed and raw calls cannot resolve each other's response. Tests cover full pending
capacity, child exit with pending requests, request timeout, interruption, duplicate response ids,
unknown response ids, and typed/raw id collision behavior when both lanes exist.

Adapter-owned early-notification buffering is allowed only for finite lifecycle notifications that
can arrive before the owning runtime handler is registered. The buffer is bounded, flushed on handler
registration, cleared on scope close, and never substitutes for durable runtime event replay or
read-model rebaseline. Do not use unbounded pending arrays for long-lived event streams, command
output, pi turn deltas, runtime notifications, or app logs.

Generated transport, RPC, and tool contracts are package-private bridge evidence unless the package
spec explicitly promotes them. Public facades keep product-shaped groups and method names, normalize
transport/protocol errors into package errors, and do not expose raw method strings, generic request
dictionaries, generated RPC group objects, or protocol error objects. Do not let generated bridge
machinery become the app-facing runtime/state/pi facade just because it is typed.

The generated Smithers task-agent `AgentLike` is the only generated-package code allowed to call
raw `fetch`. That call is not a reusable package HTTP pattern: it runs inside a handler-thread
command-scoped Smithers CLI child process, sends one JSON `runTaskAgent` request to the exact
`SVVY_WORKFLOW_AGENT_BRIDGE_URL`, includes only the command-scoped bearer token from
`SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN`, enforces the generated bridge body shape, maps non-2xx or
malformed responses to the generated bridge error contract, and never performs arbitrary outbound
HTTP, provider probing, web fetch/search, state access, or runtime facade calls. Product package
code, app bootstrap transports, and runtime-owned bridge servers continue to use injected guarded
host services or explicit app-edge adapters as specified by their owner package.

Long-lived app-owned helper processes, such as workflow task-agent bridge endpoints or provider
helpers, use a serialized reconcile/supervise service rather than ad hoc restarts. The owner keeps
desired state and active handle state in scoped `Ref`/`SynchronizedRef` values, guards reconcile with
a one-permit `Semaphore`, launches the child/resource in a child scope, forks a scoped supervisor for
terminal exit, and records whether exit should restart, terminalize, or stay stopped. Active helper
processes are closed by scope finalizers and are reconstructed from durable state plus desired
runtime state after app/runtime restart.

Schema-backed NDJSON or Msgpack channels from `effect/unstable/encoding` are allowed only inside
those protocol adapters when they remove concrete parsing/framing code. `ChannelSchema` from
`effect/ChannelSchema` is unavailable in production unless exact manifest rows, package-boundary
allowlists, owning spec text, and focused protocol tests adopt it for a protocol already modeled as
a `Channel` where the format-specific helpers do not fit; it must use the same source `Schema`
contracts as the package DTOs. Protocol adapters decode each inbound frame with the exact
method/event schema before handing it to domain logic, encode each outbound frame from typed
request/response values, map `NdjsonError`, `MsgpackError`, `ChannelSchema` schema errors, and
child-process exits into package tagged errors, and close all pending requests when the stream
fails. Encoded streams are transport details; they are never used as durable event history, queue
state, transcripts, app logs, command facts, read models, or generated package metadata.
Every long-lived helper/task-agent/protocol bridge names a maximum frame size and maximum decoded
message size. Oversized frames, malformed frames, unknown methods, schema decode failures, and
protocol version mismatches become typed protocol errors, fail or terminalize pending requests as
specified by the adapter, and are logged only through redacted protocol diagnostics. Raw frames,
tokens, secrets, prompt text, and unbounded payload excerpts are not copied into app logs, command
facts, runtime events, or bridge errors.

`effect/unstable/rpc` is not used in the package architecture for stdio protocol adapters,
desktop bridge calls, app RPC, generated package contracts, workflow task-agent bridge calls, or
public package-to-package APIs. Any spec that adopts it must name the exact protocol owner,
transport, schemas, lifecycle, and package-private boundary before implementation.

## HTTP Rules

### Standing Rule

The product architecture excludes an Effect HTTP client layer from the canonical app runtime graph.
Product packages must not require `HttpClient.HttpClient`, `HttpServer`, `HttpRouter`,
`BunHttpClient`, `FetchHttpClient`, or Node HTTP platform layers unless the owning package spec first
adds a concrete adoption record, boundary allowlist, fake test layer, operation timeouts, body-size
limits, and network-policy owner.
Existing shipped loopback transports, including the workflow task-agent bridge, are app-bootstrap
transport adapters that invoke already-acquired runtime services; they are not Effect HTTP service
dependencies.

### HTTP Adoption Requirements

When a package spec adopts outbound HTTP, services that need outbound HTTP depend on an injected
`HttpClient.HttpClient`. They do not construct global fetch clients, read auth directly from env, or
assume `BunServices.layer` provides HTTP. The app or test harness supplies the app-owned
network-policy HTTP layer, backed internally by adopted raw host layers such as
`FetchHttpClient.layer`, a fake raw client layer, or another explicit host-owned raw client layer.
`@effect/platform-bun/BunHttpClient` can back that policy layer only after its own owning spec row
and boundary allowlist exist.
`FetchHttpClient.layer` and fetch-backed platform layers are wrapped by the same app-owned policy
layer. If an adopted upstream platform HTTP layer requires overriding an upstream
`Context.Reference`, that override is a narrow app/bootstrap edge exception that must have exact
manifest/member coverage and a package-boundary allowlist before use. Reusable packages and tests do
not rely on a raw fetch-backed layer implicitly capturing `globalThis.fetch` and do not provide raw
platform HTTP layers directly.

The app-owned HTTP layer enforces product `networkAccess`. When `networkAccess` is disabled,
external outbound HTTP clients fail closed with a typed sandbox/network-disabled error before any
host request is attempted. Loopback traffic required by an app-owned bridge, such as a selected
`runTaskAgent` loopback server, is allowed only through a separately named loopback bridge client
layer that validates host, port, bearer token, workspace/session lineage, and operation shape. A
disabled external network setting does not authorize arbitrary localhost app RPC, desktop bridge
access, Shell access, or workflow mutation APIs. Packages that require HTTP declare whether they
need external network, app-loopback bridge traffic, or a fake/test client; they do not inspect the
settings store directly.

The network-policy HTTP layer obtains policy from an injected app/runtime policy service or an
immutable operation snapshot, not from `process.env`, global fetch state, or direct settings-store
reads inside reusable packages. The wrapper checks the current external-network/loopback allowance
before delegating to the raw client. Raw client layers such as `FetchHttpClient.layer` are
implementation details of that wrapper. `@effect/platform-bun/BunHttpClient`,
`NodeHttpClient.layerFetch`, `NodeHttpClient.layerUndici`, and `NodeHttpClient.layerNodeHttp` remain
reference-only unless separately adopted.
Effect HTTP rate-limiting helpers, including target `HttpClient.withRateLimiter`, are rejected until
the app-owned network-policy layer is adopted. If promoted, rate limiting lives inside that guarded
HTTP layer with named operation scope, retry/backoff interaction, diagnostics, and tests; package
services do not install provider-specific ad hoc rate limiters.

For any adopted HTTP edge, outbound request bodies use
`yield* request.pipe(HttpClientRequest.schemaBodyJson(schema)(value))`
or `yield* HttpClientRequest.schemaBodyJson(schema)(request, value)` when a request schema is
available; the helper returns an `Effect` that produces the updated request. When a schema helper is
not usable at a trusted HTTP edge, encode the value with the hoisted schema first and call
`HttpClientRequest.bodyJsonUnsafe(encoded)` only with that encoded JSON value. JSON responses are
decoded with hoisted schemas, preferably
`HttpClientResponse.schemaBodyJson(schema)`, before they cross the package boundary. Services classify
non-2xx responses by using or providing an `HttpClient.HttpClient` transformed with
`HttpClient.filterStatusOk`, by applying `HttpClientResponse.filterStatusOk` at the response boundary,
or by equivalent typed status handling. After manifest adoption, HTTP boundary code may use
`HttpClientError.isHttpClientError(...)` plus typed `error.response` / `error.reason` values to
classify transport, status, response, and decoding failures before mapping them to package tagged
errors. They map response/status/schema failures to package tagged errors and redact auth headers,
tokens, provider payloads, and secrets before command facts or app logs.

Every HTTP caller names the operation timeout and maximum response body size. JSON helpers are
allowed only for responses known to be bounded by that operation. Large or streaming responses use
the response object's `response.stream` accessor, or `HttpClientResponse.stream(responseEffect)`
when the response is still wrapped in an Effect, with a scoped consumer, byte limit, cancellation
path, and typed oversized-body error. Response bodies are consumed, drained, or explicitly abandoned
according to the host client contract before the operation scope closes. Raw response bodies are
never persisted in app logs, runtime events, command facts, bridge errors, or telemetry; diagnostics
store redacted excerpts or artifact references only when the owning spec allows them.

Retries are bounded and typed. Use retry helpers such as transient retry schedules only after the
service classifies a failure as retryable. Timing policy alone must not retry user errors,
authentication failures, schema failures, or deterministic unsupported provider/model selections. Package
tests use fake HTTP clients or local scoped test servers; they do not call real providers.

`HttpServer` / `HttpRouter` are not adopted for the shipped workflow task-agent bridge. The bridge
transport is the app-bootstrap Bun loopback adapter named in `runtime.spec.md`; it exposes
exactly `POST /runTaskAgent` and adapts that request into the runtime-owned bridge operation. Base
runtime services must not import Effect HTTP server modules. An Effect HTTP bridge is allowed only
when the PRD, feature inventory, and owning package spec name the exported layer, route table,
loopback binding, app readiness gate, shutdown owner, platform server layer, and tests proving no
docs, OpenAPI, Scalar, arbitrary app RPC, desktop bridge operations, Shell access, settings
mutation, orchestrator controls, or workflow/run-state mutation are exposed.

## Time And Scheduling Rules

- Effect programs use manifest-adopted `DateTime` and `Schedule` members. `Clock` value reads are
  installed-export-audited but not production-adopted, and `TestClock` is test-only.
- Runtime code must not use `Date.now()`, `DateTime.nowUnsafe()`,
  `clock.currentTimeMillisUnsafe()`, or `clock.currentTimeNanosUnsafe()` for claim leases, retries,
  waits, title jobs, source invalidation, command timings, or recovery. These unsafe reads bypass
  the Effect `Clock` service's testable effect surface. Unsafe current-time reads are limited to
  explicit bootstrap or diagnostic edges.
- Request-path retry and polling schedules must be bounded by the owner policy. Production
  code may use only `Schedule.exponential` plus `Schedule.modifyDelay`; non-adopted members such as
  `Schedule.recurs`, `Schedule.during`, `Schedule.while`, and `Schedule.passthrough` require exact
  manifest adoption before production use. In the target form, `Schedule.recurs(n)` means `n`
  follow-up executions after the first attempt. Classify retryable failures with
  `operation.pipe(Effect.retry({ schedule, while: (error) => error.retryable }))` or
  `Effect.retry(operation, { schedule, while: (error) => error.retryable })`, where `schedule` is a
  `Schedule<Output, Input, ScheduleError, Env>` whose `Input` type is the effect's typed failure;
  or use the builder form when inference matters:
  `Effect.retry(($) => $(schedule).pipe(Schedule.while(({ input }) => isRetryable(input))))`.
  Timing policy alone must not decide retryability. Polling that should return the latest
  successful status uses `Schedule.passthrough` only after the owning package adds the production
  manifest row and focused polling tests; until then, package code must use only the adopted
  `Schedule` members already present in `packages/effect-adoption-manifest.ts`.
- Provider, HTTP, CLI requirement, and host probe retries use capped backoff after typed retryability
  classification. Production code uses `Schedule.exponential` with `Schedule.modifyDelay` to
  cap, replace, or compare the selected delay. `Schedule.jittered` is not production-adopted unless exact
  adoption because deterministic source invalidation, queue drains, and tests must not inherit
  jitter accidentally. Use `Schedule.modifyDelay` when the policy caps, replaces, or compares the selected delay,
  including capped reconnect backoff. Use `Schedule.addDelay` only when an additional delay derived
  from schedule output should be added to the selected delay. Local reference examples that combine
  exponential backoff with `Schedule.either(Schedule.spaced(...))` are not svvy cap policy; caps are
  explicit delay policy through adopted members. Do not hide fixed sleeps in the retried effect body.
  Deterministic internal debounce, queue drains, source reconciliation, and recovery scans avoid
  jitter unless a package spec names a concrete product reason; those paths should be predictable
  under `TestClock`.
- Package specs name schedules for each product job they own: source-invalidation debounce and
  periodic reconciliation, source-recovery sweeps, request-input timeout and timeout recovery,
  provider/OAuth retries, CLI requirement probes and install/update retries, command shutdown grace,
  generated-package refresh recovery, workspace-link repair retry, and runtime startup recovery.
  Tests advance `TestClock` for these cadences and do not sleep wall-clock time.
- Product schedule recipes map to concrete lanes:
  - request-path transient retries use bounded `Effect.retry({ schedule, while })` after typed
    retryability classification and record the final success/failure in the owning command/app-log
    fact when user-visible.
  - status polling may use `Effect.repeat(...)` with `Schedule.passthrough` when callers need the
    latest successful status value, but those members are non-adopted until their exact production
    value reads are added to `packages/effect-adoption-manifest.ts` with focused behavior tests.
    `Stream.fromEffectSchedule(...)` is non-adopted until its owning package adds the
    manifest row, boundary allowlist, and focused behavior tests.
  - background cadence uses a scoped worker fiber with a named cadence policy plus a terminal worker
    policy and shutdown scope. `Schedule.spaced` / `fixed` / `windowed` are non-adopted until
    exact production manifest rows exist; owner specs may still describe these target cadences so the
    intended timing is unambiguous.
  - debounce/coalescing tests fork the worker, advance `TestClock`, then wait on drain handles,
    receipts, or readiness barriers; they do not use host timers, microtask flushing, or polling as
    completion signals.
- Target background cadence semantics are: wait-after-completion cadence, aligned interval cadence,
  fixed-window cadence, human calendar cadence, and explicit startup-then-steady cadence. The
  corresponding Effect members such as `Schedule.spaced`, `Schedule.fixed`, `Schedule.windowed`,
  `Schedule.cron`, and `Schedule.andThen` are not production-adopted and are not import permission
  until exact manifest rows, boundary allowlists, owner specs, and focused tests land.
  Package specs must name the cadence, first-run behavior, and shutdown scope for every long-lived
  background schedule. Runtime source invalidation, request-input timeouts, provider/CLI retries,
  command grace periods, generated-package refresh, workspace-link repair, and recovery sweeps are
  not calendar jobs and must not use `Schedule.cron`.
- Use `Effect.retry` for failed attempts. Once adopted for production, use `Effect.repeat` for
  polling or reconciliation based on successful status values, when a single effect should repeat
  until it returns a terminal value or fails. Until then, use only manifest-adopted `Schedule`
  members and package-local scoped worker loops. Use `Schedule.recurs(maxRetries)` for retry counts;
  do not use `Schedule.take(n)` as a retry-attempt count because it limits schedule outputs, not the
  same product concept as total effect evaluations. `Stream.fromEffectSchedule` is allowed only when
  polling or reconciliation is itself an observable stream; that adoption must document its
  initial emission before scheduled recurrences. `Schedule.forever` and other unbounded schedules
  belong only in explicitly scoped background fibers and must be named in the owning package spec.
  Use `Schedule.take(n)` only when a long-lived cadence needs a bounded startup or probe phase
  before switching to another schedule, after exact production adoption. When combining schedules and
  the output matters, adopted forms use `Schedule.bothLeft(...)` or `Schedule.bothRight(...)` instead
  of `Schedule.both(...)` so the retained schedule output is intentional; those members also require
  exact manifest rows before production use.
- Production timeout handling uses manifest-adopted `Effect.timeoutOrElse` for
  request-input blocking timeouts, provider/helper job deadlines, protocol request deadlines,
  dependency probe limits, and bounded command shutdown windows. `Effect.timeout`,
  `Effect.timeoutOption`, `Effect.race`, `Effect.raceFirst`, `Effect.raceAll`, and
  `Effect.raceAllFirst` are not production-adopted unless exact manifest rows, package-boundary allowlists,
  and focused tests promote them. Persisted timeout behavior records the deadline and the branch
  that produced the result when it affects user-visible state.
- Persisted-deadline timer fibers are an allowed `Effect.sleep(remainingMs)` use when the owning
  package spec names the deadline source, recomputes remaining time from Effect `Clock` /
  `DateTime`, stores the durable deadline, versions pause/resume changes, forks the timer in an
  owner scope, and cancels/reforks it through that scope after committed changes. Fixed sleeps
  remain forbidden for polling, retries, stabilization, queue correctness, or test synchronization.
- Target race promotion uses `Effect.race` / `Effect.raceAll` only when the first successful result
  should win and early failures should be ignored until success or total failure, and uses
  `Effect.raceFirst` / `Effect.raceAllFirst` only when the first completion, including typed
  failure, should decide the outcome. Do not race two state writes, queue claims, command fact
  writers, or prompt dispatches for the same durable owner.
- Store persisted timestamps as stable ISO strings produced from `DateTime`, normally
  `DateTime.formatIso(yield* DateTime.now)` for UTC instants.
- Time-zone conversion for user/workspace zones is not production-adopted unless exact `DateTime` zone members
  such as `DateTime.CurrentTimeZone`, `DateTime.withCurrentZone*`, and
  `DateTime.layerCurrentZone*` are promoted in the adoption manifest and focused tests. Do not model
  current time zone as a custom `Context.Reference`.

Host runtime facts such as platform, architecture, app paths, bundled helper paths, and environment
snapshots are injected as package-owned service ports, typed bootstrap config values, or one
dedicated app-owned host-process reference module. Direct reads from `process.platform`,
`process.arch`, `process.env`, `process.cwd()`, hostname APIs, `node:os` / `os` path and host facts
such as `homedir`, `tmpdir`, `userInfo`, `hostname`, `platform`, `arch`, or equivalent host globals
are banned outside allowed host-global zones. Allowed host-global zones are exact:

- app/process entrypoint modules whose job is process startup, app path resolution, platform-layer
  selection, and `ManagedRuntime` construction
- package-owned host reference modules named for that purpose, such as `host-process-reference` or
  `host-config`, that expose typed Effect services or bootstrap config values
- package-specific Bun/Node live adapter modules that provide Effect platform services
- generated `@svvyx/workflows` Smithers task-agent bridge client code, limited to reading the exact
  command-scoped `SVVY_WORKFLOW_AGENT_*` variables named by `runtime.spec.md` and
  `generated-packages.spec.md`, and only for the generated `runTaskAgent` loopback bridge call
- integration/e2e harnesses and tests that explicitly verify host-global mapping

Every other package module receives host facts through injected services or decoded bootstrap config.
The local `t3code` host-runtime rule covers platform/architecture reads; svvy extends that rule with
project-owned checks for environment, cwd, hostname, app paths, and equivalent host facts because
those values affect packaged-app behavior and must be provided through bootstrap/config services.
`Context.Reference` is not production-adopted. Production adoption is limited to fiber-local Effect
runtime defaults intentionally overridden per scope, such as log level, tracing flags, current
concurrency, or scheduler. Do not store app path, workspace, package ownership, or durable settings
in `Context.Reference`; durable product settings remain `@svvy/state` data.
Scheduler/yield references such as `References.Scheduler`, `References.MaxOpsBeforeYield`, and
`References.PreventSchedulerYield` are app-edge, test, or narrowly measured hot-path tools. Domain
and runtime services do not tune scheduler/yield references unless a package spec names the measured
hot path and its starvation/fairness tradeoff. In particular, preventing scheduler yield is banned
for ordinary runtime loops, queue drains, source scans, protocol readers, command-output consumers,
and bridge subscriptions.

Configuration rules:

- App/bootstrap config is described with production-adopted config members such as
  `Config.all`, or target schema-backed config helpers such as `Config.schema` after exact manifest
  adoption. Config is parsed against an explicit `ConfigProvider`, either through an adopted
  provider-installation path or by calling `config.parse(provider)` at the process edge. Current
  production `ConfigProvider` reads are limited to `fromEnv`; `fromUnknown`, `layer`, `layerAdd`,
  `constantCase`, and `nested` are installed-export-audited but not production-adopted unless exact manifest rows exist.
- Numeric process/bootstrap configuration uses `Config.int(...)` when the source value is an integer
  and `Config.mapOrFail(...)` for range, relationship, path-shape, and cross-field validation that
  must fail as configuration failure before any package layer is exposed. Do not parse numeric
  config through `Number(...)`, `parseInt(...)`, schema decoders over ambient env objects, or
  fallback defaults hidden in package services.
- String process/bootstrap configuration is decoded from explicit app-edge env maps or structured
  config snapshots before package-specific validation or redaction. `Config.string(...)` is not
  production-adopted.
- `Config.unwrap(...)` is the target app/bootstrap or explicit host-adapter edge shape for wrapped
  config definitions only after exact production adoption. Until then, package root layers receive
  decoded config through a package-owned config service layer or manifest-adopted config parsing
  plus `Layer.succeed(...)` / `Layer.effect(...)`. `Layer.unwrap(...)` is not active repo
  permission. Domain service methods do not call `Config.unwrap(...)`.
- Domain services do not read extension env values, provider keys, app settings, workspace
  settings, profile settings, approval policy, network policy, or sandbox policy through
  `Config`. Those are product-state, keychain, or app-managed snapshots supplied through explicit
  state ports, runtime services, or immutable launch-policy inputs. `Config` is for
  process/bootstrap host env snapshots and deterministic tests.
- Package-owned bootstrap config services such as `RuntimeLayerConfigService` may be decoded at
  app/bootstrap and provided as explicit layers when they contain only process-local cadence,
  buffer, backpressure, or test knobs. They are not durable product settings, not profile/workspace
  settings, and not a path for extension env or provider credentials.
- Tests that need deterministic object-shaped config use `ConfigProvider.fromUnknown(...)` only after
  that member is adopted for the relevant test lane; until then they provide decoded config services
  directly. Env-specific tests use `ConfigProvider.fromEnv({ env })` only when the test is
  specifically exercising environment-variable mapping.
- `ConfigProvider.fromEnv(...)` is allowed only in exact host-global zones such as the app entrypoint,
  packaged helper entrypoint, narrowly reviewed live host adapter, or tests that specifically
  exercise environment-variable mapping. Reusable package production code does not own env-provider
  reads, even with an explicit env object; app/bootstrap decodes host env snapshots and provides
  package config as explicit services/layers.
- Parsing `Config` without an explicitly installed provider is treated the same as calling ambient
  `ConfigProvider.fromEnv()` and is allowed only in those exact host-global zones. After
  `ConfigProvider.layer(...)` / `ConfigProvider.layerAdd(...)` production adoption, reusable package
  code and tests always install a deterministic provider or consume an already decoded bootstrap
  config service.
- Non-adopted `ConfigProvider.layer(...)` / `ConfigProvider.layerAdd(...)` semantics are recorded
  as non-production reference material only. They must not be used for product config behavior in production code or
  ordinary tests until the exact members are added to `adoptedEffectRuntimeModuleExports` with owner
  tests proving provider precedence, absence-only fallback, and failure behavior. The
  installed-export canary may construct those values solely to prove the Effect v4 export remains
  present. Until production adoption, process edges parse against an explicit provider with adopted
  APIs, and reusable package code consumes decoded config services.
- Custom `ConfigProvider.make(...)` providers are unavailable in production and are not part of the
  current installed-export audit set. Adding one requires an installed-export audit row, an exact
  production manifest row if used at runtime, and a narrow bootstrap adapter spec that maps only a
  concrete immutable config snapshot. Durable settings, secrets, provider auth, workspace/profile
  config, and extension env remain state/keychain/runtime services; a database, remote, or mutable
  config provider would create a second config plane that bypasses ownership and redaction.
- Host environment snapshots often arrive as `Record<string, string | undefined>`. Compact them to
  `Record<string, string>` before calling `ConfigProvider.fromEnv({ env })`; do not pass undefined
  values through the config provider boundary.
- Env providers that bridge camelCase config keys to environment variables use the target
  `ConfigProvider.constantCase` member after production adoption; apply it after target
  `ConfigProvider.nested(...)` when the prefix should also be converted. Until those members are
  adopted, package config decoding uses explicit schema-backed env key maps.
- Env-backed package config uses one canonical key mapping: package config field paths are joined
  with underscores, converted to constant-case by the adopted mapping path, and prefixed by the
  package env namespace. For example, `RuntimeLayerConfig.commandOutputBatchMaxBytes` maps to
  `SVVY_RUNTIME_COMMAND_OUTPUT_BATCH_MAX_BYTES`, and `StateLayerConfig.databasePath` maps to
  `SVVY_STATE_DATABASE_PATH`. Nested object keys use the same joined path. Arrays are not accepted
  from comma-split env strings unless the package spec names the exact delimiter, escaping policy,
  and tests; otherwise array-like config uses an adopted structured object config provider in tests
  or a typed product-state/config file contract. Two decoded config fields must never map to the
  same env key; package config tests include a collision fixture.
- `Config.withDefault` is the only currently production-adopted config fallback helper. It falls
  back only when the failure is a `Schema.SchemaError` whose issue is missing-data-only; it does
  not fall back on config-provider source errors or non-missing schema failures. `Config.orElse` is
  installed-export-audited but not production-adopted; do not use it in production until the
  manifest adds the exact member with tests proving that schema failures are not replaced with
  defaults. Boundary code that maps config failures inspects the `Config.ConfigError.cause` after
  decode failure and maps provider/source failures to `config-source-failed` and
  `Schema.SchemaError` failures to `config-schema-failed`.
- Runtime, state, sandbox, pi-adapter, and extension bootstrap config that says invalid config must
  fail startup uses `Config.withDefault` only for missing optional values. It must not use
  `Config.orElse` or catch-all fallback to replace schema validation failures with defaults. Tests
  cover missing-value defaulting separately from invalid-value startup failure.
- Config source failures normalize the source-error value carried by `Config.ConfigError.cause` at
  the bootstrap/config boundary. Do not import or name `ConfigProvider.SourceError` in production
  unless that exact member is added to the manifest. Public startup errors, app logs, command facts,
  runtime events, and read models may include the config field name, package namespace, source kind,
  and redacted reason; they must not include raw env values, raw config file contents, provider
  internals, unallowlisted host paths, stack traces by default, or secret material. Secret-bearing
  config keys are never emitted as related labels unless their field name is an allowlisted
  non-secret name.
- `Config.nonEmptyString(...)` exists in the installed beta.84 package but is not production-adopted
  unless added to `adoptedEffectRuntimeModuleExports`. `Schema.NonEmptyString` also exists in the
  installed package but is not production-adopted; use adopted
  `Schema.String.check(Schema.isNonEmpty())` patterns or add an exact manifest row before importing
  it. The production ban applies only to lowercase `Schema.nonEmptyString`, which is not exported by
  the installed package.

## File, Path, Database, And Watcher Rules

- File-backed source, artifact, generated-package, prompt-source, and extension-source operations
  use injected filesystem/path services or package-owned file-store ports. They do not read/write
  via hidden globals or source-checkout-relative paths.
- Temporary command, patch, generated-package, and sandbox-helper files use package-owned
  file-store/host-port seams or injected `FileSystem.FileSystem` methods only after the exact
  filesystem members are production-adopted for the owning package. Current sandbox production
  adoption covers `FileSystem.FileSystem.access`, `exists`, `readFile`, `realPath`, and `stat`.
  Scoped temporary-file helpers such as `makeTempFileScoped`, `makeTempDirectoryScoped`, and
  scoped `open` are not production-adopted unless promoted with owner policy and focused cleanup tests. Path
  policy and artifact/sandbox checks use injected `Path.Path` plus `fs.realPath(...)` where symlink
  or canonical-path behavior matters. Plain string concatenation and source-checkout-relative path
  resolution are not package-boundary APIs.
  Reusable services depend on abstract `Path.Path`. In the shipped Bun/Electrobun app,
  app/bootstrap provides `BunPath.layer` through `layerRuntimeBunPlatform`. `NodePath.layer` is
  allowed only in Node-only scripts/tests or after a shipped Node host is explicitly adopted with
  matching PRD, feature inventory, package spec, manifest, lockfile, and boundary tests. POSIX-only
  `effect/Path.layer` is allowed only when a package deliberately wants POSIX policy semantics and
  documents that choice; it is not the ordinary artifact, source, sandbox, or generated-package path
  layer.
  the injected `Path.Path` service's `path.resolve(...)` must be called with a trusted absolute root
  when used in package/domain code. Calling `path.resolve(relativeOnly)` or otherwise resolving only
  caller-supplied relative segments is banned because the Effect POSIX path implementation may fall
  back to `process.cwd()`.
  Workspace, artifact, generated-package, extension-source, sandbox, and command-cwd path services
  therefore accept or derive an absolute trusted root first, then resolve relative inputs beneath
  that root.

  ```text
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const exists = yield* fs.exists(path.resolve(workspaceRoot, relativePath));
  const real = yield* fs.realPath(path.resolve(workspaceRoot, relativePath));
  ```

  Workspace/worktree path policy is a named package service, not repeated ad hoc helper code.
  Runtime, state, sandbox, extensions, and command services that accept workspace-relative paths use
  that service to normalize a trusted workspace/worktree root, expand supported `~` inputs only at
  approved user-config/bootstrap edges, verify the root directory, reject caller-supplied absolute
  paths where a relative path is required, reject traversal, and return typed path errors. It owns
  command `cwd`, artifact roots, generated-package roots, source roots, and temporary work roots for
  workspace-scoped work.

  Path containment checks that protect workspace, artifact, generated-package, extension-source, or
  sandbox roots first resolve both the trusted root and candidate path through the injected
  filesystem/path services, then compare with a host-native relative path:

  ```text
  const rootReal = yield* fs.realPath(root);
  const candidateReal = yield* fs.realPath(path.resolve(rootReal, relativePath));
  const relative = path.relative(rootReal, candidateReal);
  const inside = relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  ```

  The owner package maps missing path, symlink, permission, or platform errors into a typed package
  error before returning. String-prefix checks, unresolved paths, source-checkout-relative fallbacks,
  and caller-supplied absolute paths are not containment proofs.

  For new-file writes, `fs.realPath(candidate)` cannot be the containment proof because the file may
  not exist yet. The owner resolves and realpaths the trusted root plus the nearest existing parent,
  verifies that parent remains inside the trusted root after symlink resolution, rejects symlink
  escapes and absolute/traversing relative inputs, writes to a scoped temp file under the verified
  parent when atomicity matters, and renames into place only after the parent containment proof
  succeeds.

- `@svvy/state` owns SQLite product persistence through package-private stores and repositories.
  Repository/state-port code must not import `effect/unstable/sql/*`, `SqlClient`, `SqlSchema`,
  `SqlConnection`, `@effect/sql-sqlite-bun`, or `@effect/sql-sqlite-node` without an explicit
  Effect SQL adoption record in the PRD, this spec, the state package spec, manifests, lockfile, and
  package-boundary tests.
- App/bootstrap supplies a decoded absolute state database path. The state layer validates path
  ownership, creates the parent directory through approved filesystem/path services, opens SQLite,
  verifies WAL, `foreign_keys`, busy timeout, and the repository numeric-value policy, runs
  migrations, and only then exposes repository or state-port services. Repositories are never
  visible before setup and migration success.
- Effect SQL is not part of the active state persistence architecture. State repository code wraps
  package-private SQLite access in Effect services and layers without importing
  `effect/unstable/sql/*` or `@effect/sql-sqlite-*`.
- svvy exposes no public SQLite backup, export, checkpoint, vacuum,
  load-extension, or maintenance surface. Adding database maintenance requires PRD and state-spec
  updates; it must be state-owned, adapter-aware, scoped, and exposed through typed state service
  methods rather than raw SQLite clients, database objects, connections, backup/export handles, or
  adapter-specific handles across package boundaries.
- Repository implementations decode request schemas and row/result schemas at the SQLite boundary.
  Schema failures are mapped to `StateContractError` or a narrower package typed error before
  crossing repository ports. Missing-row behavior is represented through explicit `Option`-style or
  typed-error contracts, not unchecked thrown values.
- Repository SQL uses prepared statements or parameterized repository helpers for ordinary DML
  values. Dynamic identifiers are allowed only through whitelisted table/column helpers owned by
  state repository modules. Raw SQL text is allowed only inside repository, setup, and migration
  modules and is not a general escape hatch for caller-controlled values or identifiers.
- SQLite column names stay `snake_case`; repository/domain schemas and public read-model contracts
  stay `camelCase`. Raw SQL text must explicitly alias selected columns to the camelCase result
  schema field names unless the query is built through a state-owned helper that produces the
  expected row keys. Do not mix implicit transform assumptions and ad hoc per-query naming policies.
- Repository schemas may use only exact production-adopted schema helpers. Today
  `Schema.DateTimeUtcFromString` is adopted for timestamp columns, while `Schema.decodeTo(...)` and
  `Schema.fromJsonString(...)` are not production-adopted unless their exact member reads are added to
  `packages/effect-adoption-manifest.ts` with focused schema tests. `SchemaTransformation` and
  `SchemaGetter` patterns remain reference-only until a production architecture change names their
  exact modules and members. State repositories must not smuggle unadopted schema helpers into SQL
  row codecs.
- Public state port records use branded ids and `IsoDateTimeString` fields from `@svvy/core`.
  Repository adapters may decode raw SQLite strings, but plain `string` ids/timestamps do not cross
  package ports, runtime events, command facts, app logs, or read-model boundaries.
- Queue, recovery, command, app-log, and runtime-operation failures persisted by state use the
  normalized `StateStoredError` contract. Durable rows do not store ad hoc
  `{ message }` JSON, raw foreign errors, raw `Cause`, or package-local error classes.
- Public ids remain strings. Sequence, cursor, ordering, and lease columns that are decoded as
  JavaScript numbers must stay within the safe integer range and use schema checks. Potentially
  64-bit values are stored and decoded deliberately as text or `bigint`; they are not silently
  narrowed through default numeric decoding.
- Do not design product read models around SQL driver streaming or reactive SQL handles. Product
  notifications come from committed state writes plus typed runtime notifications derived from
  after-commit descriptors. State repositories do not use Effect SQL streaming, reactive SQL, or
  resolver helpers for queues, read models, transaction ports, source invalidation, or runtime event
  fanout. State uses direct repository methods inside explicit transaction ports so batching does
  not hide product ordering or transaction boundaries.

- State-owned catch-up and rebaseline APIs may expose paged replay streams built from finite
  selector/repository reads plus an explicit state-owned pagination loop. `Stream.fromEffect` and
  `Stream.paginate` are non-adopted conveniences until the owning package adds exact Effect
  manifest rows, boundary allowlists, and focused behavior tests. Until then, use already-adopted
  finite stream constructors or expose an Effect-returning page reader behind a facade adapter. This
  is not SQL driver streaming: each page is an ordinary repository effect with an explicit
  cursor/limit, row schema, ordering, and transaction policy.
- `effect/unstable/persistence` is not the product persistence layer. Do not use Effect persisted
  queues/caches/key-value stores as substitutes for `@svvy/state` tables and migrations.
- File watchers are scoped resources. Watcher events are hints that schedule deterministic
  fingerprint scans; watcher event payloads are not authoritative state.
- The source invalidation coordinator is a scoped `@svvy/runtime` Effect service. Production
  watcher integration uses a runtime-owned primitive host watcher capability supplied by
  app/bootstrap through `SourceInvalidationHost.watch(...)`: the coordinator registers path/domain
  watchers, stores close handles inside the coordinator handle, and closes those handles when the
  coordinator closes. Watcher callbacks enqueue non-authoritative hints only; all product truth
  comes from deterministic fingerprint scans. Effect v4 beta.84 provides
  `FileSystem.FileSystem.watch(...)` and `FileSystem.WatchBackend`, but svvy does not adopt them as
  production watcher integration APIs. They may be used only after the exact member/import is added
  to the adoption manifest with owner policy, scope/finalizer tests, and package-boundary allowlists
  in the same architecture change. Package runtime/domain code must not import Node, Bun, app
  watcher APIs, `FileSystem.WatchBackend`, or unadopted stream runners directly.
- Raw watcher events enter only as non-authoritative hints and use manifest-adopted primitives.
  `Queue.dropping` is currently production-adopted. `Queue.sliding`, `Stream.debounce(...)`,
  `Effect.repeat(...)`, `Schedule.passthrough`, and direct `effect/Clock` value reads are
  not production-adopted unless exact production manifest rows and focused behavior tests exist. Cadence code may
  use adopted `Effect.sleep`, `Duration`, and adopted `Schedule` members; deterministic tests use
  `effect/testing` `TestClock` only in the test lane. Runtime source invalidation code must not use
  `setTimeout`, `setInterval`, `Date.now()`, Promise-based gates, or hidden global clocks.
- Runtime owns two source-invalidation coordinator services, not one generic watcher:
  - the app-global coordinator watches Workflows and Extensions source roots, performs one generated
    package refresh for the app-owned generated packages, records source/build facts through state
    ports, and fans out workspace-link repair work for affected workspaces;
  - each workspace-scoped coordinator watches external instruction candidates and discovered
    read-only host snippet Markdown sources for that workspace, records source fingerprints through
    state ports, and marks affected surfaces stale through runtime-owned invalidation work.
    Generated package output, workspace package links, DB-backed agent/profile settings, and managed
    svvy snippets are excluded from watcher triggers.
- One scan/build batch per coordinator/domain runs at a time, guarded by currently adopted
  primitives such as a one-permit semaphore created with `yield* Semaphore.make(1)` plus explicit
  `Ref` state for dirty-domain follow-up tracking. `SynchronizedRef` state is non-adopted until the
  exact member rows are promoted in the production manifest. `Semaphore.makeUnsafe(1)` is
  non-adopted until the production manifest adopts it; it is
  not available to product code from installed-export audit alone. If hints arrive while a scan is
  active, runtime records the dirty domains and runs one follow-up scan after the active scan
  finishes.
- The source invalidation coordinator readiness gate uses currently adopted `Deferred`/`Ref`
  service state unless exact production manifest rows, owner policy, package-boundary allowlists, and
  focused readiness tests promote `Latch` as the explicit reusable gate.
- Generated output is never watched as a source invalidation trigger. Source invalidation watches
  Workflows source, Extensions source, external instruction candidates, and discovered read-only
  host snippet Markdown sources, then records source fingerprints and build facts in `@svvy/state`.
  Agent/profile settings and managed svvy snippets are DB-backed state writes that return committed
  state results plus internal `afterCommit` invalidation descriptors rather than watcher inputs.
- `SourceInvalidationDomain` excludes agent/profile settings and managed svvy snippets. Those are
  DB-backed state writes whose returned descriptors enter runtime-owned notification publication
  after commit. Runtime is the only public notification publisher. The file watcher source set is
  limited to Workflows source, Extensions source, external instruction candidates, and discovered
  read-only host snippet Markdown sources.
- Source invalidation marks affected surfaces stale by comparing their bound generated-context
  fingerprint to the current generated-context fingerprint. It never rewrites an active surface's
  generated-context binding mid-turn. Opted-in stale surfaces refresh only at the next safe
  prompt-bearing pre-dispatch boundary; opted-out surfaces continue with their bound context and
  remain visibly stale.

## Observability Rules

- Effect observability candidate APIs are `Effect.withSpan`, `Stream.withSpan`,
  `Effect.annotateCurrentSpan`, `Effect.annotateSpans`, `Effect.annotateLogs`,
  `Effect.annotateLogsScoped`, `Effect.withLogSpan`, `Effect.withTracerEnabled`,
  `Effect.withTracerTiming`, `Layer.withSpan`, `Metric`, `Logger`,
  `LogLevel`, `Tracer`, `References.MinimumLogLevel`, `References.CurrentLogLevel`,
  `References.CurrentLogAnnotations`, `References.CurrentLogSpans`, `References.UnhandledLogLevel`,
  `References.TracerEnabled`, `References.CurrentTraceLevel`, `References.MinimumTraceLevel`,
  `References.DisablePropagation`, `Tracer.DisablePropagation`, `References.TracerSpanAnnotations`,
  `References.TracerSpanLinks`, and `References.TracerTimingEnabled` at service boundaries. Runtime
  and command flows may record these through the module APIs only after exact production adoption of
  `docs/references/effect-smol/packages/effect/src/Effect.ts`,
  `docs/references/effect-smol/packages/effect/src/Stream.ts`,
  `docs/references/effect-smol/packages/effect/src/Layer.ts`,
  `docs/references/effect-smol/packages/effect/src/Metric.ts`,
  `docs/references/effect-smol/packages/effect/src/Logger.ts`,
  `docs/references/effect-smol/packages/effect/src/Tracer.ts`, and
  `docs/references/effect-smol/packages/effect/src/References.ts`. Runtime and command flows need
  counters/timers for queue claim latency, turn duration, command duration, recovery attempts, and
  provider/pi-adapter activity, but Effect `Metric`, `Logger`, and `Tracer` members remain
  audit-only until exact production manifest rows exist. Installed-export audit proves these APIs
  exist; production use still requires the exact imported member to appear in
  `packages/effect-adoption-manifest.ts` and package-boundary tests before code imports it.
- `Stream.withSpan` and `Effect.withSpan` are not production permissions. If promoted, stream spans
  may cover runtime event subscriptions, command-output streams, pi-adapter event streams, adopted
  file-watch streams, and bridge streams; effect spans may cover one-shot acquire, publish, decode,
  persist, and command-dispatch operations. Promotion requires exact manifest rows, package-boundary
  allowlists, owner policy, and focused tests. Stream spans must carry bounded redacted annotations
  only; they do not carry raw transcript text, command output, provider payloads, or extension secret
  values.
- Ambient logging/tracing reference overrides are owner-scoped. App bootstrap owns process-wide
  defaults and exporter wiring. Tests own test-local log/trace levels, disabled propagation, and
  deterministic timing. Export, snapshot, and diagnostic code may set scoped verbosity for one
  report. Bridge adapters may add scoped bridge span annotations and links. Package service methods
  must not mutate global log or trace policy ad hoc; they add operation spans, annotations, metrics,
  and redacted logs under the caller-provided policy.
- `Effect.withTracerEnabled(...)` and `Effect.withTracerTiming(...)` are installed-verified against
  `effect@4.0.0-beta.84` but are not production-adopted. Production use requires exact manifest
  promotion and is limited to app/bootstrap trace policy setup, diagnostic/export paths, and
  one-operation troubleshooting wrappers. They are scoped policy combinators, not product state, and domain services
  must not toggle tracing or timing based on workspace, surface, provider, model, extension, or
  command data.
- Metrics use `Metric.counter` for counts, `Metric.timer` or histograms for durations after those
  constructors are production-adopted,
  `Metric.update` for recording, and `Effect.trackDuration(metric)` around service or command
  boundaries after the exact members are production-adopted. Use `Metric.value` only in metric tests,
  diagnostic endpoints, or exporter/snapshot code after exact adoption. Runtime product behavior
  must not branch on metric state. Metrics are observability data, not durable product state.
- Runtime metric controls `Metric.enableRuntimeMetricsLayer`, `Metric.disableRuntimeMetricsLayer`,
  `Metric.enableRuntimeMetrics`, `Metric.disableRuntimeMetrics`, `Metric.snapshot`, and
  `Metric.snapshotUnsafe` are installed-verified against `effect@4.0.0-beta.84`. They remain
  installed-export audit members until their exact production
  value reads are added to `packages/effect-adoption-manifest.ts` with focused observability tests.
  After that adoption, app/bootstrap may install the enable/disable layers as one process/runtime
  observability policy, tests/diagnostics/exporters use `yield* Metric.snapshot` as the default
  Effectful snapshot value, and `Metric.snapshotUnsafe` stays reserved for the narrow
  explicit-context synchronous edge where an exporter or assertion already owns the target `Context`
  and cannot run an Effect. Domain logic, runtime scheduling, queue decisions, provider selection,
  pi-adapter behavior, and UI state must not branch on runtime metric snapshots.
- Metric tests, exporter snapshot tests, and diagnostic metric assertions provide
  `Metric.MetricRegistry` with a fresh `Map` when isolation matters; they do not assert against the
  ambient default registry.
- Metric attributes stay low-cardinality, such as package, operation, status, reason class,
  extension kind, queue domain, or retry outcome. Product ids such as workspace/session/surface,
  thread, turn, command, queue item, request, artifact, and generated-package build ids belong in
  spans, logs, app-log rows, and command facts, not metric labels.
- Approved metric attributes are applied with `Metric.withAttributes(...)` before `Metric.update`,
  `Metric.value`, or `Effect.trackDuration(...)` after those members are production-adopted. Do not
  hand-roll alternate metric tagging helpers unless they only normalize the approved string pairs
  before calling `Metric.withAttributes(...)`.
- Each distinct `Metric.withAttributes(...)` value combination is a separate metric series/snapshot
  entry in Effect. Adding a high-cardinality attribute has the same operational cost as creating
  many metrics, so every allowed attribute value set must be finite enough for long-lived app
  runtime snapshots and exporters.
- Every metric has a catalog entry with metric name, unit, owner package, description, allowed
  attributes, and cardinality review. New metrics are not added ad hoc inside service bodies.
  `@svvy/core` owns the metric-catalog entry schema and every package that emits metrics owns a
  package-local `metrics.ts` catalog module. Effect `Metric` constants are created only in those
  catalog modules from catalog entries; service bodies import the constants and apply approved
  attributes. The `Metric` object alone is not the product catalog. Package-boundary tests reject
  ad hoc `Metric.counter(...)`, `Metric.timer(...)`, `Metric.histogram(...)`, and
  `Metric.withAttributes(...)` outside package metric catalog modules, exporters, diagnostics, and
  metric tests. After exact `Metric.counter(...)` and `Metric.timer(...)` production adoption, the
  baseline catalog has this shape:

  ```ts
  const SvvyObservationPackageSchema = Schema.Literals([
    "app",
    "core",
    "state",
    "runtime",
    "extensions",
    "sandbox",
    "pi-adapter",
    "desktop",
  ]);
  const SvvyObservationOperationSchema = Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isPattern(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/),
  ).pipe(Schema.brand("SvvyObservationOperation"));
  const SvvyObservationReasonClassSchema = Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/),
  ).pipe(Schema.brand("SvvyObservationReasonClass"));
  type SvvyObservationPackage = typeof SvvyObservationPackageSchema.Type;
  type SvvyObservationOperation = typeof SvvyObservationOperationSchema.Type;
  type SvvyObservationReasonClass = typeof SvvyObservationReasonClassSchema.Type;

  type SvvyMetricAttributes = {
    package: SvvyObservationPackage;
    operation: SvvyObservationOperation;
    status?: "success" | "failure" | "cancelled" | "timeout";
    reasonClass?: SvvyObservationReasonClass;
  };

  type SvvyMetricCatalogEntry = {
    name: string;
    unit: "count" | "milliseconds" | "bytes";
    ownerPackage: SvvyMetricAttributes["package"];
    description: string;
    allowedAttributes: ReadonlyArray<keyof SvvyMetricAttributes>;
    cardinality: "low";
  };

  const queueClaimLatencyCatalog = {
    name: "svvy.runtime.queue.claim_latency",
    unit: "milliseconds",
    ownerPackage: "runtime",
    description: "Time spent claiming eligible queue rows.",
    allowedAttributes: ["package", "operation", "status", "reasonClass"],
    cardinality: "low",
  } satisfies SvvyMetricCatalogEntry;

  const runtimeTurnDurationCatalog = {
    name: "svvy.runtime.turn.duration",
    unit: "milliseconds",
    ownerPackage: "runtime",
    description: "Duration of runtime-owned prompt turns.",
    allowedAttributes: ["package", "operation", "status", "reasonClass"],
    cardinality: "low",
  } satisfies SvvyMetricCatalogEntry;

  const runtimeCommandDurationCatalog = {
    name: "svvy.runtime.command.duration",
    unit: "milliseconds",
    ownerPackage: "runtime",
    description: "Duration of runtime-owned command sessions.",
    allowedAttributes: ["package", "operation", "status", "reasonClass"],
    cardinality: "low",
  } satisfies SvvyMetricCatalogEntry;

  const runtimeRecoveryAttemptsCatalog = {
    name: "svvy.runtime.recovery.attempts",
    unit: "count",
    ownerPackage: "runtime",
    description: "Recovery attempts by runtime recovery workers.",
    allowedAttributes: ["package", "operation", "status", "reasonClass"],
    cardinality: "low",
  } satisfies SvvyMetricCatalogEntry;

  const piAdapterActivityCatalog = {
    name: "svvy.pi_adapter.activity",
    unit: "count",
    ownerPackage: "pi-adapter",
    description: "Pi adapter session, turn, model, and helper activity.",
    allowedAttributes: ["package", "operation", "status", "reasonClass"],
    cardinality: "low",
  } satisfies SvvyMetricCatalogEntry;

  const RuntimeMetrics = {
    queueClaimLatency: Metric.timer(queueClaimLatencyCatalog.name, {
      description: queueClaimLatencyCatalog.description,
    }),
    turnDuration: Metric.timer(runtimeTurnDurationCatalog.name, {
      description: runtimeTurnDurationCatalog.description,
    }),
    commandDuration: Metric.timer(runtimeCommandDurationCatalog.name, {
      description: runtimeCommandDurationCatalog.description,
    }),
    recoveryAttempts: Metric.counter(runtimeRecoveryAttemptsCatalog.name),
    piAdapterActivity: Metric.counter(piAdapterActivityCatalog.name),
  };
  ```

  `SvvyMetricAttributes` governs product-supplied attributes applied with
  `Metric.withAttributes(...)`. Exporters, diagnostic readers, and boundary checks must allow or
  normalize Effect-owned intrinsic metric attributes such as the `time_unit` attribute attached by
  `Metric.timer(...)`; those intrinsic attributes are not product label authority and must not be
  treated as permission to add unreviewed product labels.

- Incoming external trace context is not part of desktop, Electrobun RPC, browser-tool, or
  headless runtime facades. Those facades do not accept `traceparent`, `tracestate`, parent span
  ids, or caller-provided span links. Any HTTP/server bridge that accepts upstream trace context has
  an app/bootstrap-owned bridge-only contract that decodes those headers and installs an adopted
  tracing layer before entering package services; the trace context still does not become a
  runtime/state/package service input. `Effect.currentParentSpan` and `Effect.withParentSpan` are
  not production-adopted unless exact manifest rows exist, trace policy, and focused bridge tests exist.
  Deliberately omit a parent span when modeling a fresh product turn, background
  recovery job, or sandboxed command whose lifecycle must stand alone. Never infer trace parents
  from user ids, command ids, queue ids, or Smithers run ids; those are span attributes or links, not
  tracing authority.
- Effect logs/spans annotate package operations with workspace/session/surface/thread/turn/command
  ids when available.
- Exported log/span annotations use a normalized allowlist:

  ```ts
  type SvvyObservationAnnotation =
    | { key: "svvy.package"; value: SvvyObservationPackage }
    | { key: "svvy.operation"; value: SvvyObservationOperation }
    | { key: "svvy.workspace_id"; value: WorkspaceId }
    | { key: "svvy.surface_pi_session_id"; value: SurfacePiSessionId }
    | { key: "svvy.thread_id"; value: ThreadId }
    | { key: "svvy.turn_id"; value: TurnId }
    | { key: "svvy.command_id"; value: CommandId }
    | { key: "svvy.reason_class"; value: SvvyObservationReasonClass };
  ```

  OTLP/log exporters receive only normalized `SvvyObservationAnnotation` values or redacted unknown
  annotations. Secret-bearing values, raw env, prompts, command output, artifact text, provider
  tokens, extension env values, and raw host errors are forbidden in span/log annotations.
  `SvvyObservationAnnotationSchema` rejects package names outside the package/source literal set,
  operation names that do not match `/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/`, and reason classes
  that do not match `/^[a-z][a-z0-9_]{0,63}$/`.

- Tracing references are scoped runtime defaults supplied at bootstrap, in tests, or around one
  operation. `References.CurrentTraceLevel`, `References.MinimumTraceLevel`,
  `Tracer.DisablePropagation` / `References.DisablePropagation`, `References.TracerEnabled`, and
  `References.TracerTimingEnabled` are used only for trace sampling and propagation policy; do not
  infer trace parentage or sampling from product ids. They are not durable product settings.
- `Logger.tracerLogger` is an installed logger value, not a constructor. It may be installed through
  `Logger.layer([Logger.tracerLogger])` at app/bootstrap only after the exact logger members are
  production-adopted, when Effect log records should become span events in the same trace path. It
  does not replace app-log persistence or command facts.
- Optional OTLP export is an app-edge observability layer using `effect/unstable/observability`
  modules such as `OtlpTracer`, `OtlpLogger`, `OtlpMetrics`, and `OtlpSerialization`, provided after
  the app layer with an explicit `HttpClient` layer. Production OTLP use requires an app-edge
  adoption record naming exporter package dependencies, endpoint/config schema, redaction policy,
  batching policy, shutdown flush behavior, and tests before any production import of those unstable
  modules. OTLP is not a product event log, command fact store, or replacement for `@svvy/state`.
- `SvvyObservationAnnotation` is a core-owned encoded observation contract used by app/bootstrap
  exporters. Package services may add only values that encode through
  `SvvyObservationAnnotationSchema`; unknown annotations are dropped or redacted by the exporter and
  never become metric labels. Product ids may appear as span/log annotations or app-log related
  links, not as metric attributes. Raw env, prompts, command output, artifact text, provider
  tokens, extension env values, and raw host errors are always rejected by the schema/exporter.
- App/bootstrap may install a scoped diagnostic trace layer with redacted span/log annotations,
  bounded batching, local rotating trace output, and optional OTLP export. This diagnostic trace
  layer is not the app-log facade or persistence path and must not become durable product state. App
  logs remain state-backed read models; trace/log exporters are operational diagnostics.
- App logs remain product read models in `@svvy/state`.
- Effect observability may feed app logs and optional external telemetry. It is not a replacement
  for command facts, app-log rows, or read models.
- App/bootstrap is the only owner that installs an Effect-log-to-app-log logger layer. `@svvy/state`
  owns only the `AppLogWritePort` implementation and app-log read models. `@svvy/runtime`,
  `@svvy/state`, `@svvy/extensions`, `@svvy/sandbox`, and `@svvy/pi-adapter` may emit
  `Effect.log*` records under the caller-provided logging policy only after the exact log members are
  production-adopted. Runtime and app/bootstrap may call
  the core-owned `AppLogWritePort` backed by `@svvy/state` for product facts that must be durable. Other packages may
  call `AppLogWritePort` directly only when their package spec names the exact durable diagnostic
  fact, input shape, redaction policy, and tests. They must not install product `Logger.layer(...)`,
  `Logger.batched(...)`, file, console, or OTLP logger sinks themselves. Console/file loggers,
  including `Logger.toFile`-style sinks, are diagnostic/export-only and are not the product app-log
  persistence path.
- The target Effect-log-to-app-log bridge, after exact logger-member adoption, uses an explicit
  core-owned write port and a scoped batched logger layer:

  ```ts
  export interface AppLogWritePort {
    readonly _tag: "AppLogWritePort";
  }

  export interface AppLogWritePortService {
    append(
      input: AppendAppLogInput,
    ): Effect.Effect<StateMutationResult<{ appLogEntryId: AppLogEntryId }>, StateContractError>;
  }

  export const AppLogWritePort = Context.Service<AppLogWritePort, AppLogWritePortService>(
    "@svvy/core/AppLogWritePort",
  );

  type AppendAppLogInput = {
    workspaceId?: WorkspaceId;
    level: AppLogLevel;
    source: AppLogSource;
    message: string;
    occurredAt: IsoDateTimeString;
    normalizedError?: StateStoredError;
    related?: ReadonlyArray<AppLogRelatedLink>;
    idempotencyKey?: string;
  };

  type StateMutationResult<T> = {
    value: T;
    afterCommit: readonly StateInvalidationDescriptor[];
  };
  ```

  Target bridge form after exact logger/log-level production adoption: the bridge builds a scoped
  logger with `Logger.batched(...)` inside the app/bootstrap layer scope and installs the scoped
  logger effect/value with `Logger.layer([logger])`. `Logger.batched(baseLogger, { window, flush })`
  returns a scoped logger effect, so it must not be treated as a plain synchronous logger value. It
  maps Effect `LogLevel` values to product
  app-log levels exactly as `Fatal -> error`, `Error -> error`, `Warn -> warn`, `Info -> info`,
  `Debug -> debug`, `Trace -> debug`; `All` and `None` are policy bounds, not emitted record
  levels. `References.MinimumLogLevel` decides whether a log record reaches the bridge before
  product mapping. The bridge derives `AppLogSource` only from allowlisted package/operation
  annotations, derives related links only from allowlisted product-id annotations, normalizes
  message/error text, applies the same redaction as ordinary app logs, writes through
  `AppLogWritePort`, and records dropped or failed sink writes as metrics plus a diagnostic
  fallback. After exact logger/log-level production adoption, `Logger.batched(...)` may be used only
  with an installed-version option-shape test or equivalent manifest evidence that covers the exact
  option keys and return shape used by production code. Product capacity, overflow/drop policy, and
  recursion protection are enforced before or around the logger bridge and are not delegated to
  `Logger.batched(...)` unless installed-version behavior tests prove that exact guarantee.
  `idempotencyKey` is optional and is derived only for explicitly idempotent product facts; ordinary
  repeated logs are separate app-log rows. App-log sink persistence failure must not fail the domain
  Effect that emitted the log. The bridge names its upstream admission capacity, flush cadence/window,
  shutdown flush deadline, overflow/drop policy, and recursion guard. Shutdown wraps the final
  flush in the product deadline before `managedRuntime.dispose()`. Remaining records are counted in
  metrics or diagnostic fallback and never block domain finalizers. Sink write failures must not
  emit another app-log record through the same logger path; they use a separate diagnostic fallback
  and low-cardinality metric. Tests cover normal flush, overflow/drop accounting, sink failure,
  shutdown drain, and absence of recursive app-log writes.

- Secrets loaded from process/config edges use process-local `Redacted.Redacted<T>` values only
  across trusted, non-encoded service boundaries. `Redacted.make(...)` is production-adopted only at
  trusted app/host secret-intake boundaries such as provider-auth snapshots that wrap live raw
  credential strings before passing them to `@svvy/pi-adapter`, app bootstrap's process-local
  extension snapshot secret-values port, and `src/bun/extension-snapshot-storage.ts` when bytes
  returned from the OS keychain enter the typed snapshot secret store. `Config.redacted` remains
  audit-only; production code must not use it until exact member adoption names the owning config
  boundary.
  Secret intake boundaries are distinct from serialized product output boundaries. A user-owned app
  UI/RPC ingress may accept a raw secret string only in a schema explicitly named as a secret-intake
  input. That raw value is converted immediately to `Redacted.Redacted<string>` or handed to the
  secret-store adapter inside the trusted boundary. It must not be persisted, logged, emitted,
  copied into command facts, app logs, runtime events, transcripts, artifacts, generated
  declarations, generated package files, tool output, or read models. All outbound/public schemas
  expose only non-secret status, presence, label, or fingerprint fields. Public facades must not
  require callers to construct `Redacted` values.
  Do not emit `Redacted` wrappers across serialized boundaries: persistence, RPC, command facts,
  runtime events, app logs, transcripts, artifacts, generated declarations, tool output, or
  generated package files. `Redacted.Redacted<T>` values may cross only process-local, non-encoded
  trusted service boundaries explicitly named by a package spec.
  `Schema.Redacted(valueSchema, { disallowJsonEncode: true })` rejects JSON-codec encoding paths
  such as `Schema.toCodecJson(schema)`. It does not make every ordinary `Schema.encode*` path fail
  closed; ordinary schema encoding can still return an encoded redacted wrapper whose inspection/JSON
  representation is the redacted display string. `Schema.RedactedFromValue(valueSchema, {
disallowEncode: true })` is the v4 API that forbids ordinary encode as well, but remains
  audit-only until exact production adoption and focused schema tests exist. Public serialized output
  schemas should not contain `Redacted` fields; before any serialized boundary, map secrets to
  non-secret status, label, fingerprint, or presence fields.
  Redacted labels and status fields must be non-secret. Redacted labels are derived only from fixed
  product field names or user-approved account labels already stored as non-secret display data.
  They never use raw env values, token prefixes/suffixes, secret-store keys, provider error text,
  command output, file contents, or generated source. Boundary schemas that accept raw secret
  values and convert them to redacted wrappers may use `Schema.RedactedFromValue(...)` only after
  production adoption, only when the encoded form is intentionally secret-bearing, and never across
  persistence, RPC, command facts, events, app logs, transcripts, artifacts, generated declarations,
  or tool output. `Redacted.value(...)` is production-adopted only at the trusted invocation
  boundary that must hand the secret to a provider, subprocess, dependency installer, pi model
  registry, the app-bootstrap-local snapshot secret codec, or the OS keychain adapter in
  `src/bun/extension-snapshot-storage.ts`; production code must not value-import or call other
  `effect/Redacted` members.
  Extension redaction hooks run before logs, events, command facts, artifacts, app-log
  rows, or transcript-derived text are persisted or emitted; state enforces the final
  persistence/read-model redaction boundary.
- Public encoders must not try to serialize `Redacted` fields as secret values. Tests for
  secret-bearing schemas assert both ordinary `Schema.encode*` behavior and JSON-codec encode
  behavior, so `disallowJsonEncode` and `disallowEncode` are not confused. Boundary services map
  secrets to stable non-secret status fields, fingerprints, labels, or presence booleans before
  persistence, RPC, event, command-fact, app-log, generated-declaration, transcript, artifact, or
  tool-output boundaries.
- `Redacted` reduces accidental disclosure in logs, JSON, inspection, and schema output. It is not
  encryption, durable secret storage, or memory zeroing. Encrypted storage remains an
  app/state/keychain responsibility. If `Redacted.wipeUnsafe(...)` is later production-adopted, it
  is only best-effort registry removal, not secret destruction.
- The reference implementation's `Redacted` equality, hashing, and
  `Redacted.makeEquivalence(...)` inspect underlying values. Those members are not production
  permission unless exact `effect/Equal`, `effect/Hash`, and `effect/Redacted` value-member rows are
  adopted. Package code must not use equality, hashing, object-map keys, metric labels, log/span
  annotations, idempotency keys, or cache keys over `Redacted` values unless a package spec names a
  trusted comparison boundary, adopts the exact members, and tests prove the compared value never
  crosses a public or durable boundary. Secret comparisons normally happen inside the provider,
  keychain, or signing/verifier service that owns the secret material.
- Effect v4 secret handling in this repo uses `Redacted`; `Config.redacted` is installed-export
  audited but not production-adopted until exact manifest rows name the owning config edge. Do not
  use `effect/Secret` or `Secret` APIs.
- Package-boundary enforcement treats redacted-value equality, hashing, map-key use, and
  observability labels as explicit architecture gates. A package that needs a trusted secret
  comparison must name the exact comparison boundary, prove no compared value crosses a public or
  durable boundary, and add focused tests before adding allowlist entries.

## Console, Logging, And Observability Payloads

`effect/Console` is not adopted for production package code, generated packages, runtime policy, or
agent-facing command projection. CLI reference examples that use `Console.log(...)` are reference
material only. Product command output is captured through runtime-owned command/session services and
state-backed command facts. App-owned process entrypoints that need stdout/stderr use the
entrypoint's host output adapter or an explicitly adopted `Terminal`/`Stdio` process-edge service;
adopting `effect/Console` requires exact manifest rows, a process-edge owner, and tests.

`Effect.log*`, `Logger`, `Tracer`, and `Metric` value APIs are not production-adopted unless exact production
manifest rows exist. `Schema.Redacted` is separately production-adopted as a schema constructor;
`effect/Redacted` value use is limited to manifest-adopted `make` and `value` at trusted
secret-intake/invocation boundaries. Package code must not pass arbitrary second-argument payload objects to
`Effect.log*`. Structured log payloads must be encoded through the runtime/app observability
annotation schema named by the owning package spec, or redacted and normalized by the
app-bootstrap logger bridge before leaving the Effect runtime. Raw prompts, transcript text, command
output, secrets, provider credentials, filesystem contents, generated prompt bodies, and extension
env values must not be placed in log payloads, span attributes, metric labels, or runtime event
annotations.

## Bridge Rules

Desktop, browser tools, headless automation, facade/integration tests that intentionally exercise a
non-Effect edge, and other non-Effect consumers use small bridge facades. Ordinary Effect
service/layer tests do not create `ManagedRuntime`s or call `Effect.run*`; they use
`@effect/vitest` with test layers.

Default rule: `*.effect.test.ts` files use `@effect/vitest` (`it.effect`, `layer(...)`, and nested
`it.layer(...)`) and do not call `ManagedRuntime.make`, `managedRuntime.run*`, or module-level
`Effect.run*`. The only test exceptions are exact facade/bootstrap/integration harness globs and
the state-owned SQLite Bun-lane helper named by package-boundary checks. Adding any new
runner-using test path requires the same-change manifest/member policy, exact file allowlist,
owner reason, and cleanup assertions.

Bridge facades:

- are created from a single provided `ManagedRuntime`
- may call only the instance members listed in `adoptedEffectInstanceMemberPolicies` for their
  exact source globs
- package facade factories use only the exact `managedRuntime.run*` instance members allowed for
  their source globs, including `managedRuntime.runPromise(...)` /
  `managedRuntime.runPromiseExit(...)` in `packages/runtime/src/runtime-layer-config.ts`,
  `managedRuntime.runPromise(...)` in
  `packages/runtime/src/accepted-native-tool-execution.ts` and
  `packages/runtime/src/app-log-commit-notification-adapter.ts`,
  `managedRuntime.runPromiseExit(...)` in `packages/runtime/src/index.ts` and
  `packages/state/src/state-facade.ts`; app/bootstrap runner exceptions are listed separately below
- let app/bootstrap use `managedRuntime.context(...)`, `managedRuntime.runPromise(...)`, and
  `managedRuntime.dispose(...)` in `src/bun/runtime-service-adapter.ts`
- require a same-change manifest instance-member row, package-boundary allowlist, owner/spec
  wording, and focused tests before any `managedRuntime.runSync(...)`,
  `managedRuntime.runSyncExit(...)`, `managedRuntime.runCallback(...)`,
  `managedRuntime.runFork(...)`, `managedRuntime.disposeEffect(...)`, or other instance member use
- validate incoming payloads using hoisted `@svvy/core` schemas
- convert typed errors to stable app/RPC error payloads
- never contain state mutation policy, command/session lifecycle policy, readiness admission policy,
  retry policy, runtime event publication, queue claiming, prompt dispatch, tool execution, or
  recovery logic
- accept caller cancellation where relevant. Promise facades whose package contract says caller
  abort interrupts the underlying operation expose `{ signal?: AbortSignal }` and pass it as a run
  option to `managedRuntime.runPromise(...)` / `managedRuntime.runPromiseExit(...)`. Those
  interrupting facades must not implement cancellation by racing the returned Promise against an
  abort listener, because that rejects the caller while the Effect fiber can continue committing
  state or holding resources.
  Promise facades whose package contract intentionally says caller abort is wait-only, such as the
  runtime facade default `cancel-wait-only` policy, do not pass the signal to
  `managedRuntime.runPromiseExit(...)`. They may race the observed result against an abort listener
  only when the owning package spec names the wait-only policy and tests prove that the underlying
  owner-managed work continues intentionally. The only package-level `new Promise` allowance for
  detached wait-only facade cancellation is the `@svvy/runtime` facade wait-only cancellation bridge in
  `packages/runtime/src/index.ts`; package-boundary tests pin that allowance to one constructor
  occurrence so additional detached promise gates cannot appear silently. Callback facade runners
  are not currently adopted. If a callback facade later promotes `managedRuntime.runCallback`, the
  same change must add the exact instance-member policy, package-boundary allowlist, owning facade
  spec text, and focused tests. Until then, callback facades must be expressed through an already
  adopted runner or package-owned Effect service/facade pattern. The promotion text must restate the
  installed beta.84 signature and require stable `Exit` mapping for success, typed failure, defect,
  and interruption.
  `Effect.tryPromise` thunks receive and forward the Effect-provided `AbortSignal`;
  Direct `Effect.callback` remains audit-only and unavailable without manifest promotion. Adopted
  registrations declare and forward the provided `AbortSignal` when the host API supports it, and
  must return a cleanup effect when explicit unsubscribe/cancel is required.
  A cancellation bridge is incomplete if the wrapped host API ignores both the provided
  `AbortSignal` and cleanup finalizer; interruption then only stops the Effect fiber, not the
  underlying host operation.
- convert streams to `AsyncIterable` only through owning facade adapters that also own the
  subscription close path and close receipt. For runtime events this adapter is the
  package-private `asyncIterableFromRuntimeEventSubscription(...)` helper used by
  `createRuntimeFacade(...)`; it adapts `RuntimeEventSubscriptionEffect` into
  `RuntimeEventSubscription` and preserves the runtime-owned `close()` and `closed` receipt.
  The helper is package-private to `@svvy/runtime` unless another package spec adds a concrete
  public facade that must expose Effect streams to non-Effect callers.
  The adapter uses only exact production-adopted stream conversion members. Target
  `Stream.toAsyncIterableWith` requires a manifest row before production use. Any raw v4 iterator
  creates an internal scope and closes it from iterator `return()` only; natural stream completion
  returns `done: true` without closing that scope. The wrapper must close the stream
  scope on natural completion, early return, thrown iteration error, explicit subscription close,
  window close, workspace close, runtime restart, and app shutdown. It must resolve or forward the
  runtime-owned close receipt instead of inventing a renderer-local close reason.
  Before exposing a failing stream through `AsyncIterable`, map typed stream failures to the
  facade's stable bridge error shape or consume with `Exit` at the bridge boundary; v4
  `Stream.toAsyncIterableWith` squashes failing causes into thrown errors for async iteration.
- use the owning package's named stream bridge helper instead of open-coding iterator cleanup in
  every facade. For runtime events, use `asyncIterableFromRuntimeEventSubscription(...)`. Every
  public stream facade must first name the helper, subscription lifetime, close receipt, error
  mapping, and slow-consumer behavior in its owning package spec. Boundary tests reject direct
  `Stream.toAsyncIterableWith` / `Stream.toAsyncIterableEffect` use outside named helpers and named
  integration harnesses.
- own a scope or cancel path for every subscription. The facade owner closes that scope or invokes
  that cancel path on unsubscribe, window close, workspace close, app shutdown, or runtime restart.
- callback/event-emitter subscriptions use a bounded per-subscriber buffer. The bridge spec names
  capacity, overflow behavior, close/rebaseline path, and the read-models the consumer must refetch
  after rebaseline. Slow desktop renderer consumers must not block prompt turns, command terminal
  settlement, queue claims, or state commits after the authoritative state row has committed. When a
  per-subscriber buffer overflows on a non-lossless UI notification lane, the bridge closes that
  subscription with a stable rebaseline/dropped-subscriber result and records a runtime receipt or
  app-log fact; the renderer refetches state before resubscribing.
- PubSub-backed stream subscription attachment is deferred until the stream starts running.
  Production runtime events do not rely on PubSub for their public event authority. For a
  loss-sensitive PubSub lane, the owning package must first promote exact `PubSub.subscribe(...)` and
  `Stream.fromSubscription(...)` members in the manifest, then acquire the subscription in the owning
  scope before publishing values that must be observed. Until that promotion lands, package code uses
  the existing runtime-owned replay ring, bounded queues, and
  named facade bridge helpers.
- expose idempotent `close()` only for facade cleanup: facade-owned `AsyncIterable` scopes,
  callback fibers, and bridge subscriptions. Facade `close()` never closes package service layers,
  SQLite handles, runtime workers, pi sessions, or the app `ManagedRuntime`. All layer-scoped
  package resources are released only by the bootstrap owner calling `managedRuntime.dispose()`.
- fail closed when app/bootstrap readiness fails. Bridge adapters must not expose a partially
  initialized runtime facade, state facade, pi adapter, extension facade, or event stream after
  `managedRuntime.context()` fails. Pending bridge calls fail with the typed startup error, and the
  bootstrap owner disposes the failed runtime before any later app-bootstrap startup attempt creates
  a fresh app runtime.
- name readiness contracts before a facade is promoted. Each facade-owning package spec must name
  the bootstrap readiness barrier required before facade construction, any method-specific
  owner-scope readiness receipt, typed startup error, typed shutdown/disposed error, pending-call
  policy (`wait` or `fail`) and capacity per API group, plus tests for pending startup, failed
  startup, shutdown-in-progress, and disposed runtime states. `ManagedRuntime.context()` provides
  Effect acquisition; it is not the svvy product readiness contract by itself.
- create an explicit scope only at a source path that already has an exact
  `managedRuntime.runPromise(...)` instance-member policy for the owning facade/bootstrap edge,
  and only for subscriptions or clients that must outlive one `runPromise` call. After that edge has
  awaited `managedRuntime.context()`, create the scope through the caller-owned runtime, run scoped
  work by providing `Scope.Scope`, and close the same scope before `managedRuntime.dispose()`. This
  is a lifecycle pattern for files already named by `adoptedEffectInstanceMemberPolicies`, not a
  general permission to add three new `managedRuntime.runPromise(...)` calls in any facade. Adding
  the scope pattern to another source path requires the same-change manifest row, package-boundary
  allowlist, owner/spec reason, and focused tests. If a synchronous bridge path is later promoted
  and uses `managedRuntime.runSync(Scope.make())`, that promotion must include the exact manifest
  member, package-boundary allowlist, owning facade spec, and focused tests; the call must only run
  after readiness has cached the runtime context. Use
  `Effect.provideService(Scope.Scope, scope)`.
  `Scope.extend` is not an adopted svvy production API. `Scope.provide`
  and `Scope.use` are installed canaries only until promoted in the manifest and boundary tests.
  For subscriptions or clients that intentionally outlive one call, close with `Exit.void` only on
  normal explicit unsubscribe/close; on failing or interrupted bridge paths, close with the actual
  terminal `Exit` captured from an adopted runner such as
  `managedRuntime.runPromiseExit(...)` or `Effect.runPromiseExitWith(services)`.

App/bootstrap owns one idempotent shutdown coordinator around the app `ManagedRuntime`. Shutdown
starts by marking the app as shutting down and rejecting new bridge calls with a typed shutdown
error. It then closes facade subscriptions/callback scopes, cancels bridge callbacks, requests
runtime drains or terminalization with bounded deadlines, records shutdown receipts/app-log facts
when user-visible work is interrupted, and finally calls the adopted managed-runtime disposal
member `managedRuntime.dispose()`. Scoped OS/Electrobun signal listeners belong to this coordinator. If graceful drain
exceeds the configured deadline, the coordinator records the forced path and proceeds with runtime
disposal; package services do not install their own process-wide shutdown handlers.
Effect v4 disposal closes the `ManagedRuntime` layer scope with `Exit.void`; product-visible
shutdown, cancellation, timeout, and forced-disposal facts must be recorded before disposal or
passed through explicit service state. Layer finalizers must not infer app shutdown or user
cancellation from the scope-close `Exit` alone.

## Testing Rules

- Effect service/layer tests live in the named `@effect/vitest` lane. Tests that need `TestClock`
  import it from `effect/testing`. Pure schema, pure contract,
  generated-boundary, and package-boundary tests continue to use the Bun unit lane. A test file
  must not mix `bun:test` and `@effect/vitest` APIs.
- State tests that import `bun:sqlite` directly, or that import state modules whose implementation
  imports `bun:sqlite` directly, stay in the Bun unit lane while the active state persistence
  adapter is Bun's built-in SQLite module. This is a runtime-host constraint, not a product
  exception to Effect-native state code: the tested state APIs still return Effects and may use the
  state-local `runTestEffect` helper, but `*.effect.test.ts` files must not import `bun:sqlite`,
  `@svvy/state/structured-session-state`, `packages/state/src/structured-session-state.ts`, or
  `packages/state/src/app-log-store.ts`. Non-SQLite state service/layer tests, state-port fake
  tests, schema tests that need Effect test services, and other Effect-native package tests use
  `@effect/vitest` as above. SQLite-backed state tests remain in the Bun unit lane while the active
  state persistence adapter is Bun's built-in SQLite module. Adopting a different SQLite
  adapter/runtime requires the PRD, state spec, this spec, manifests, lockfile when affected, and
  package-boundary tests to describe and enforce the same lane rule in one patch.
- The test scripts are exact: `bun run test:unit` remains the Bun unit suite for
  pure/package-boundary tests, `bun run test:effect` runs Vitest over
  `packages/**/*.effect.test.ts`, and `bun run check` runs both lanes before lint, format, and
  production build. The Bun test glob
  excludes `*.effect.test.ts`; direct `bun test ./path/to/file.effect.test.ts` execution is not a
  supported verification path for Effect-lane files because those tests depend on the Vitest
  `@effect/vitest` runtime. Effect-lane files import only installed-verified test helpers from
  `@effect/vitest`, currently `assert`, `describe`, `it`, and `layer`; local aliases of those exact
  imported helpers are allowed when they make canary assertions clearer. Effect-lane files do not
  import `bun:test`. The `it.effect` and `it.effect.each` helpers are accessed through the
  installed `it` value rather than relying on reference-only named imports. Files importing
  `@effect/vitest` must match the Effect-lane filename pattern unless the package-boundary test
  names a fixture exception.
- `vitest` and `@effect/vitest` are root `devDependencies` pinned to the versions named in this
  spec and locked in `bun.lock`. Package-local `devDependencies` remain forbidden. Any version
  change is an Effect-stack architecture change and must update the root manifest, lockfile,
  installed-export audit, package-boundary tests, and this spec in one patch. Package-boundary
  dependency checks special-case `vitest` and `@effect/vitest` only for Effect-lane test files and
  helper files whose exact paths/globs, allowed imports, and owner rule are listed in
  package-boundary checks.
- When using `@effect/vitest`, use `it.effect` for Effect-returning tests, `assert` for Effect
  assertions, and `layer(AppTestLayer)("name", (it) => { it.effect(...) })`, nested
  `it.layer(...)`, or explicit test layers for shared service contexts. Top-level `layer(...)` and
  top-level `it.layer(...)` options such as `timeout`, `memoMap`, and `excludeTestServices` are
  allowed only with an explicit lifecycle reason. Nested `it.layer(...)` accepts `timeout` only and
  must not pass `memoMap` or `excludeTestServices`. Package-boundary tests currently enforce
  `@effect/vitest` import names and Effect-lane file placement; they do not parse every
  `@effect/vitest` option object. Option-shape rules in this paragraph are active spec policy and
  require same-change mechanical enforcement when a new option shape is promoted broadly.
- `it.effect.each(...)` is allowed for table-driven Effect tests. `it.effect.prop(...)`,
  `Schema.toArbitrary`, and `effect/testing/FastCheck` are not active repo permissions until the
  same patch adopts their installed exports in `packages/effect-adoption-manifest.ts`, adds
  package-boundary enforcement, and lands focused property-test examples. Property-style coverage
  before that promotion stays in ordinary table tests or Bun-lane pure schema tests.
- `it.live(...)` and named `live` imports from `@effect/vitest` are not active repo permissions
  until the installed-export manifest and package-boundary tests adopt them. Integration tests that
  need host services use explicit layers and the already adopted `layer(...)`/`it.effect(...)`
  helpers. Unit tests continue to use `TestClock`, fake layers, and deterministic providers.
  Local Effect reference examples that use `it.live(...)` or `it.effect.prop(...)` are reference
  examples, not svvy test-lane permission.
- Layer blocks default to the Effect test services. When an integration test needs a shared layer
  while using live runtime services, use top-level
  `layer(AppLayer, { excludeTestServices: true })(...)`, and keep that pattern out of unit-test
  files. Nested `it.layer(...)` inherits that enclosing layer setting; in the checked-in
  implementation it accepts timeout options, not `excludeTestServices`. Do not use live services to
  avoid deterministic `TestClock` in ordinary service tests.
- `flakyTest` is banned for product unit and integration tests in this repo. A test that needs
  retries, broad sleeps, or best-effort masking is missing a semantic receipt, fake layer, readiness
  gate, or deterministic clock control. Top-level `layer(...)` options such as `timeout`,
  `memoMap`, and `excludeTestServices` are allowed only when the test file explains the lifecycle
  reason: shared expensive fixtures use an explicit memo map, integration tests may raise timeout,
  and live-host tests may exclude test services. Nested `it.layer(...)` accepts timeout options
  only. None of these options are substitutes for fixing nondeterminism.
- Shared `layer(...)` / `it.layer(...)` blocks share the constructed context by design. Use
  per-test layer construction or avoid a shared layer block when a test must isolate database
  handles, refs, queues, pubsubs, layer maps, process spawners, clocks, or mutable fake ports.
  `Effect.provide(layer, { local: true })` is not an active test-lane permission unless the same
  change names the owning test pattern, adds an option-shape canary, and updates package-boundary
  enforcement. `Layer.fresh` is unavailable until manifest and boundary tests adopt it. Any test
  file that intentionally shares mutable fixtures through a shared layer block documents the shared
  resource and proves order independence or resets state through a test-local harness API that is
  not exported from the package public surface.
- Use `TestClock` for sleeps, retry schedules, queue drains, debounce, leases, and timeouts. Tests
  for sleeping or scheduled effects use the fork-then-adjust pattern: fork the effect under test,
  then advance time with `TestClock.adjust(...)` or `TestClock.setTime(...)`, then join/await the
  fiber, assert through a semantic receipt, use an explicit drain handle, or inspect state. For
  stream/event pipelines, a narrow scheduler yield is allowed only after the same change adds a
  test-only member policy for `Effect.yieldNow`, allowed source globs, and package-boundary
  enforcement. Until then, tests should prefer semantic receipts, drain handles, or explicit
  readiness effects rather than `Effect.yieldNow`. Do not promote debounce, timeout, retry, queue
  drain, lease, recovery scan, title job, source reconciliation, or generated-package refresh code
  while its tests rely on host timers, broad sleeps, polling loops, microtask flushing, or
  hand-rolled scheduler callbacks instead of
  `TestClock` plus semantic receipts/drains.
- If a test must temporarily use host time inside an Effect test, use `TestClock.withLive(...)`
  only for a narrow integration boundary; unit tests for sleeps, schedules, retries, debounces,
  leases, and timeouts stay on `TestClock.adjust` / `TestClock.setTime` plus semantic receipts.
- Test harnesses are contract fixtures, not anonymous mocks. Package-local `layerTest`,
  `layerInMemory`, or `layerFake` values may expose assertion handles through services such as refs,
  captured calls, fake queues, captured process commands, emitted events, and temp roots when the
  test needs to inspect interactions, but those fixture values are not public package exports unless
  the package spec and export map explicitly name them. Use `Layer.provideMerge(...)` only in
  manifest-listed test/harness globs when the test must access both the service under test and the
  fixture/handle service; production use remains limited to the exact source-gated package-root
  composition named by the adoption manifest.
- Runtime, recovery, projection, and queue-worker tests wait on semantic receipts, drain handles, or
  explicit readiness barriers owned by package-local test harnesses. They must not poll read models,
  filesystem state, or git refs as a substitute for a completion signal. `@svvy/runtime` keeps
  receipt plumbing private to runtime internals and runtime-local tests; it does not export a public
  `RuntimeReceiptBus`, public `layerTest`, or public receipt-stream fixture. Runtime tests may
  install package-private receipt collectors through test-only modules that are blocked from package
  public exports. Required runtime completion signals include queue row claimed, turn dispatched,
  turn terminalized, command terminalized, request-input wait created/resolved, event notification
  published, subscription attached, subscription closed, rebaseline rejected before stream exposure,
  slow subscriber dropped/rebaselined, recovery sweep completed, and generated-context/generated-
  package refresh completed when those milestones are the condition under test. Every
  resource-owning package service that has background work, scoped resources, or external adapters
  has package-local tests with deterministic fakes or harnesses; public fixture exports require an
  explicit package-spec and export-map entry.
  Worker services with background queues may expose package-private deterministic completion signals
  such as `drain()` or `drainKey(...)` to package-local tests. Those signals are not part of a
  public production facade or public service shape unless the owning package spec explicitly names
  them as product behavior. Reference patterns that put a test stream or receipt stream on a
  production service shape, such as a public `streamEventsForTest`, must not be copied into svvy
  package APIs.
- Use fake `@svvy/pi-adapter`, fake extension handlers, temp-file SQLite state layers,
  state-port fake layers, fake sandbox policy sources, and fake process spawners. Fake layers must
  preserve contract semantics: scope finalization, interruption, ordering, decoding, and typed
  errors. Persistence, migrations, SQL constraints, transaction rollback, queue claims, reopen
  behavior, source-version compare-and-swap behavior, recovery leases, and read-model projections
  are tested with temp-file SQLite layers, not in-memory fakes. In-memory/fake state layers are
  allowed only for dependent package unit tests that need a state-port contract double and are not
  proving SQL-backed behavior.
- Fake child-process spawner layers for runtime command tests must expose deterministic fake handles
  that cover stdout/stderr ordering, stdin writes, exit-code observation, timeout behavior, kill and
  interruption behavior, and scope cleanup. Tests assert against the fake handle/service receipts
  rather than sleeping or inspecting host process state.
- Unit tests must not call `ManagedRuntime.make`, `managedRuntime.runFork(...)`, or `Effect.run*`
  directly for ordinary service testing, except through the state-owned
  `packages/state/src/effect.test-support.ts` helper used by SQLite-backed Bun-lane state tests
  covered by the `bun:sqlite` lane rule above. Use the Bun unit lane for pure contracts, or
  `@effect/vitest` with `it.effect(...)`, `layer(...)`, nested `it.layer(...)`, and explicit test
  layers when the test needs Effect test services. Direct runners are allowed only in exact
  integration/e2e harness file globs listed in `SVVY-EFFECT-003` package-boundary checks, plus the
  facade/bootstrap exceptions named below.
- Facade tests are the named exception that may create a `ManagedRuntime` to prove the JavaScript
  edge. Allowed file patterns are `*.facade.test.ts`, `*.bootstrap.integration.test.ts`, exact
  named facade harnesses such as `packages/state/src/state-facade.test.ts`, and only other
  e2e/integration harness globs listed in package-boundary checks with owner, allowed runner APIs,
  purpose, and cleanup assertions. Those tests must verify that the
  facade uses a caller-owned runtime, does not rebuild layers per call, awaits
  `context()`/readiness before exposure when startup effects matter, maps typed failures and defects
  to stable bridge errors, propagates `AbortSignal` or callback cancellation, closes stream scopes
  on every completion path, reports facade disposal and runtime shutdown failure behavior, fails
  after facade disposal, and
  does not embed queue, turn, state, tool-execution, or recovery policy. Every public
  `AsyncIterable` facade test covers normal close, consumer early return, natural completion, scope
  finalization, typed stream failure mapping, defect mapping, runtime shutdown receipts, and facade
  disposal, and proves the subscription scope closes in each path. App-bootstrap integration tests
  prove `managedRuntime.context()` is awaited before facades are exposed when startup effects matter
  and that app/bootstrap closes facade subscriptions before disposing the caller-owned
  `ManagedRuntime`.
- Svvy target checks are stricter than the local `t3code` defaults: package-boundary or lint checks
  must name facade-test file patterns that may use `ManagedRuntime.make`, reject the same usage in
  ordinary service tests, and reject svvy-owned platform `runMain` and `Layer.launch` test usage
  outside named integration/e2e harnesses. Package-boundary checks reject every unlisted violation.
  Any allowed exception must be explicit, owner-named, enforced by the check, and represented by a
  package-boundary assertion that describes the stable owner and exact file pattern.
  The local `t3code` no-manual-runtime lint rule is a useful model only for detection shape; svvy
  keeps a zero-new, zero-unlisted manual `ManagedRuntime.make` / `Effect.run*` policy in ordinary
  service tests.
- Do not use broad sleeps, hidden globals, real desktop UI, real pi sessions, or real subprocesses
  in unit tests unless the test is explicitly an integration/e2e test.
- App/bootstrap and explicit integration harnesses may define an `AppEnvironment` service while
  wiring the process edge. Its fields are exact: cwd, platform, architecture, hostname, packaged
  resource roots, app config roots, feature flags, and an allowlisted environment map whose keys,
  redaction class, and consumer are listed beside the service definition. Reusable packages do not
  consume this broad service. They consume package-specific config values or narrow host ports such
  as generated-package roots, packaged extension templates, pi runtime paths, sandbox helper
  candidates, filesystem/path services, or guarded HTTP clients. Feature flags and host facts must
  be config fields or service values, not module-scope `process.env`, `process.cwd()`, `node:os`, or
  hostname reads.
- Architecture rules for ordinary Effect tests, schema compiler hoisting, and host-runtime
  references are mechanically enforced by lint or package-boundary tests modeled after the local
  `t3code` rules and extended by svvy-owned checks where the local rules are narrower. The test
  runtime rule is a svvy-specific allowlist rather than a direct copy of the local `t3code` default:
  facade and bootstrap integration tests named by this spec may own a `ManagedRuntime`, while
  ordinary service tests may not. The enforced rules include:
  - no manual `ManagedRuntime.make` / `Effect.run*` in ordinary service tests, with explicit
    exceptions only for facade tests and named integration/e2e harnesses
  - no `managedRuntime.runFork(...)` outside named scope-owned subscription/stream adapters with a
    tested close receipt
  - no inline Schema decoder/encoder compiler calls inside package, app-runtime, tool-handler,
    bridge-handler, event-loop, read-model selector, or command-output function bodies
  - svvy-owned checks extend beyond the local `t3code` rule and also reject inline
    `Schema.decodeUnknownResult(...)`, `Schema.decodeResult(...)`, `Schema.encodeUnknownResult(...)`,
    or `Schema.encodeResult(...)` compiler calls inside those same function bodies
  - dynamic schema factory exceptions only when the schema cannot be known at module scope
  - no direct `process.platform` / `process.arch` or `node:os` / `os` platform, architecture,
    hostname, home-directory, temp-directory, user-info, or equivalent host-fact reads outside
    allowed host-global zones
  - no direct `process.env`, `process.cwd()`, hostname, and equivalent host-global reads outside
    allowed host-global zones; the generated `@svvyx/workflows` task-agent bridge client exception is
    exact-name only and must not be generalized to extension services, generated package SDKs, app
    facades, dependency probes, prompt contributors, or ordinary Shell/TypeScript execution
  - no new reusable wrapper-style `return Effect.gen(...)` or `=> Effect.gen(...)` in non-test
    package code when `Effect.fn(...)` is the correct reusable function boundary. `Effect.fnUntraced`
    is not production-adopted for production unless a package owner promotes it in the adoption manifest and
    this spec.
  - no JavaScript `try` / `catch` blocks inside `Effect.gen(...)` or `Effect.fn(...)` generator
    bodies in package, app-runtime, bridge-handler, tool-handler, worker-loop, repository, facade,
    or runtime operation code, except inside explicitly named `Effect.try(...)` /
    `Effect.tryPromise(...)` foreign-boundary thunks that map unknown failures to package tagged
    errors
  - config provider mapping and config schema failure mapping are tested with deterministic
    providers
  - public schema annotation emitters drop non-allowlisted annotations
  - log/span annotation exporters normalize to the allowlist and redact unknown values
  - metric constants are derived from catalog entries and use only low-cardinality approved
    attributes
  - trace parent, sampling, and propagation behavior is tested at bridge/server boundaries
  - redaction schemas reject public-boundary encoding of protected secret wrappers
- App-owned CLI or process entrypoints that run a root Effect program use an app-owned process
  runner for signal handling, exit-code management, unhandled error reporting, and teardown policy.
  Effect v4 core already keeps the process alive while live fibers require it; the app-owned runner
  exists for process semantics and product shutdown behavior, not because keep-alive requires a
  separate runtime wrapper. Because the adopted Bun platform subset is limited to file/path/crypto
  services, approved Bun/Electrobun bootstrap modules may import only the concrete Bun platform
  service layers explicitly named by package specs: `BunFileSystem.layer`, `BunPath.layer`, and
  `BunCrypto.layer`.
  Platform `runMain` helpers and `effect/Runtime.makeRunMain` are not production-adopted.
  Process-runner adoption requires exact installed-export manifest rows, package-boundary
  allowlists, a named app/process entrypoint owner, signal and exit-code policy, and focused tests
  in the same patch.

Package verification must prove the package split, not only typecheck the package names:

| Package                       | Required Effect-proof tests                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@svvy/core`                  | Schemas, ids, tagged errors, encoders/decoders, boundary issue path formatting including numeric indexes, public annotation allowlist emission, public error shapes, and explicitly named data-only `Context.Service<PortIdentifier, PortService>` port tags. Core must not define service implementations, layers, runtime runners, queues, streams, scoped resources, or hidden host reads.                                                                                     |
| `@svvy/state`                 | Transaction commit/rollback, nested transaction behavior, row decoding failures, after-commit invalidation ordering, atomic queue claim order, safe integer boundaries, migration validation owned by state, paged replay streams, temp DB isolation, and dispose/reopen persistence against the same temp-file DB for queue rows, command facts/output, request-input rows, app logs, pi session references, generated-package facts, source-version facts, and recovery leases. |
| `@svvy/sandbox`               | Immutable snapshot input, helper lookup fail-closed behavior, canonical path checks, scoped temp profile cleanup, denial classification, and no subprocess ownership inside sandbox.                                                                                                                                                                                                                                                                                              |
| `@svvy/pi-adapter`            | Scoped session open/create/close, system prompt delivery, ambient pi resource disabling, turn stream interruption, protocol stderr drain when relevant, and no queue/tool/runtime policy ownership.                                                                                                                                                                                                                                                                               |
| `@svvy/extensions`            | Generated context from source records, tool handler input decoding, typed `ExtensionRuntimeOperation` items, source save invalidations, env redaction, dependency command plans, and no desktop/runtime mutation.                                                                                                                                                                                                                                                                 |
| `@svvy/runtime`               | Queue wakeup-after-commit behavior, durable queue claim ordering, prompt locks, active-turn abort, wait registry cleanup, event rebaseline, slow-subscriber policy, scoped workspace/surface ownership without public runtime maps, startup gates, helper-process reconciliation, and recovery leases.                                                                                                                                                                            |
| `@svvy/desktop`               | Bridge adapters call only bootstrap-provided facades, close stream/subscription scopes, refetch read models after events, and contain no queue claiming, prompt dispatch, direct state mutation, state mutation policy, or recovery policy.                                                                                                                                                                                                                                       |
| Generated `@svvyx/*` packages | Manifest, name, import-policy, and negative boundary tests prove they are authoring-time generated TypeScript outputs only: no Effect services/layers, no runtime/state/sandbox/pi-adapter/desktop/public-extension imports, no `execute_typescript` runtime facades, only the allowed `@svvyx/workflows` -> `@svvyx/extensions` generated-package edge, and only the exact type-only `@svvy/core` bridge-contract imports named by `generated-packages.spec.md`.                 |

## Package Gates

The Effect package architecture is complete only when behavior is owned by the package service
contracts below. A package directory existing, a type-only contract compiling, or a facade
forwarding to non-package implementation logic is not completion.

Package gates:

1. `@svvy/core` owns the cross-package schemas, branded ids, typed errors, command-fact unions,
   runtime request/event/read-model contracts, and hoisted boundary decoders/encoders.
2. Implementation code sits behind Effect service contracts. Promise facades exist only at
   non-Effect app/test/bridge edges.
3. `@svvy/state` owns durable state services, migrations, transactions, read-model selectors, and
   implementations/layers for `RuntimeWorkspaceStatePort`, `RuntimeSurfaceLifecycleStatePort`,
   `RuntimeComposerDraftStatePort`, `RuntimeQueueStatePort`, `RuntimeTurnStatePort`,
   `RuntimeCommandStatePort`, `RuntimeApprovalStatePort`,
   `RuntimeActorExtensionBindingStatePort`, `RuntimeEpisodeStatePort`,
   `RuntimeExtensionStatePort`, `RuntimeExtensionContextImpactStatePort`,
   `RuntimeGeneratedPackageStatePort`, `RuntimeArtifactStatePort`,
   `RuntimePromptDefaultsStatePort`, `RuntimeRecoveryStatePort`, `RuntimeReadModelStatePort`,
   `RuntimeRequestStatePort`, `RuntimeSessionWaitStatePort`, `RuntimeSourceStatePort`,
   `RuntimeThreadStatePort`, `ExtensionStatePort`, `ProviderAuthStatusStatePort`,
   `PiSessionReferencePort`, `SandboxPolicySource`, and `AppLogWritePort`. It owns secret
   metadata/readiness rows and state command facades that consume the host-owned `SecretStorePort`;
   it does not implement the live host secret store.
4. `@svvy/pi-adapter` owns scoped pi sessions, real pi `systemPrompt` loading, normalized turn
   streams, model metadata, and pi-facing helper jobs.
5. `@svvy/extensions` owns prompt/instruction MDX source loading, extension source/build metadata,
   generated context, handler semantics, generated `@svvyx/*` packages, and generated declarations.
6. `@svvy/runtime` owns prompt submission, durable queue claiming policy, generated-context
   pre-dispatch refresh, turn creation, command/tool execution orchestration, runtime event streams,
   recovery, and the exported runtime facade factory used with the app `ManagedRuntime`.
7. Native Effect internals own failure, cancellation, resource lifetime, concurrency, and scoped
   mutable state where the package contract requires those semantics.
8. Candidate Effect module adoption records exist before optional Effect modules become production
   dependencies. A production use of `RequestResolver`, `Cache`, `ScopedCache`, `Resource`, `Pool`,
   `RcMap`, `RcRef`, `JsonPatch`, `HttpServer`, unstable encoders, or similar helper modules is
   incomplete until its package spec names the product use case, owner service, scope,
   cache/lifetime policy, invalidation/release owner, deterministic test layer, and boundary check.
   `effect/JsonSchema` is installed-export audited for candidate schema-emitter uses named in this
   spec; production schema-emitter use still requires exact adopted member rows, owner policy,
   boundary allowlists, and focused tests.
9. App shell and renderer source consume the package architecture only through public facades and the
   generated/source contracts named by the PRD, feature inventory, and owning package specs.

Every gate requires package-boundary tests, focused behavior tests, and source-of-truth docs that
agree on file-backed versus DB/product-state-backed ownership. A dependent runtime implementation is
not promoted until its package docs, contracts, and tests agree on the owner of each source file,
generated file, durable fact, event, and read model it touches.

Mechanical enforcement lives in package-boundary and focused package tests, not in review memory.
Every mechanical gate required by this spec names a rule id, source/test globs, allowed exceptions,
and the check command that runs it under `bun run check`. Promoted gates also name the enforcing
package-boundary or focused test file and the exact assertion/helper that proves the rule. Gates
without that evidence are treated as unresolved spec work and do not grant production permission.
The required enforcement inventory is:

- `SVVY-EFFECT-001`: package manifest dependency checks for every `@svvy/*`, `@svvyx/*`, Effect,
  platform, SQL, test, pi, Electrobun, Svelte, Smithers, and generated-package edge. The gate fails
  unless root/package manifests and `bun.lock` resolve `effect` and adopted `@effect/*` packages to
  the adopted installed stack named by this spec. The same gate derives production package and Bun
  app Effect value-member reads from the TypeScript AST, requires exact coverage in
  `packages/effect-adoption-manifest.ts`, and runs
  `packages/effect-installed-exports.effect.test.ts` in the `test:effect` lane to prove every
  manifest-listed runtime member exists on the installed package namespace. Dated installed-export
  rows remain allowed only for reference-only, test-only, or conditional adoption notes that are
  not production reads. `bun run check` runs typecheck and the Bun unit lane first, then runs this
  Effect lane before lint, format, and production build so implementation cannot silently use
  reference-only APIs against older installed packages. The Effect test lane keeps installed-export
  canaries for manifest-listed runtime exports and audit-only exports.

  Focused production behavior tests are required only for APIs that are promoted through exact
  `adoptedEffectRuntimeModuleExports` rows and matching owner/spec records. In the current manifest,
  production-promoted examples include `@effect/platform-bun` `BunFileSystem.layer`,
  `BunPath.layer`, and `BunCrypto.layer`; adopted `Config`, `ConfigProvider.fromEnv`, `Scope.close`,
  production-adopted `Queue.shutdown`, source-gated `@svvy/pi-adapter` `Queue.fail`, and adopted
  `Stream` members; and
  the exact `Effect`, `Layer`, `Schema`, service, runner, file/path/crypto, and state primitives
  listed in the manifest. This paragraph does not grant production use to any member that is absent from
  `adoptedEffectRuntimeModuleExports`.

  Test-only behavior belongs in the Effect test lane and does not grant production permission.
  `@effect/vitest`, `effect/testing`, `effect/testing/TestClock`, and `Effect.forkScoped` are
  test-only under the current manifest policies and may be read only from their allowed
  test/harness globs. `Layer.provideMerge(...)` is source-gated: production reads are limited to
  the exact manifest-listed runtime root composition, while test reads remain limited to the
  manifest-listed test/harness globs. Conditional installed-export canaries for modules such as
  `Logger`, `Metric`, `FiberMap`, `FiberSet`, `FiberHandle`, `Resource`, `RcMap`, `RcRef`,
  `LayerMap`, `Latch`, `ScopedRef`, `ScopedCache`, `SynchronizedRef`, `SubscriptionRef`, `Request`,
  `RequestResolver`, `Cache`, `Pool`, `Tracer`, and `effect/unstable/process` prove installed
  availability only; they do not permit production imports or member reads. Production promotion
  requires exact `adoptedEffectRuntimeModuleExports` rows plus a complete package/spec owner
  record, matching package-boundary allowlist, and focused tests. Member-specific test-only or
  conditional restrictions are recorded in `auditedEffectInstalledExportMemberPolicies`.
  Package-boundary tests verify that member-policy rows exist, that test-only rows carry allowed
  source globs, that test-only member reads are allowed only within those `allowedSourceGlobs`, and
  that conditional member reads in test files are rejected by the conditional member-policy scan.

- `SVVY-EFFECT-002`: static import, dynamic `import(...)`, and CommonJS `require(...)` checks across
  `packages/**/src/**/*.{ts,tsx}`, `packages/**/*.{test,effect.test}.ts`,
  generated declaration/package output, `src/bun/**/*.{ts,tsx}`, `src/shared/**/*.{ts,tsx}`, and
  renderer/app-shell source. The gate rejects package-private subpaths, pi-native imports,
  renderer-only imports, platform/SQL imports without an adoption record, generated-package
  back-imports into product packages, and reference-tree imports from product code. Allowed
  exceptions are listed in `packages/package-boundaries.test.ts` as exact file paths or exact
  generated-directory globs with owner spec references. No directory-level exception is allowed
  unless the owning spec names the generated package, producer, importer, and permitted import
  specifiers.
- `SVVY-EFFECT-003`: no package-level `ManagedRuntime.make`, `Effect.runCallback`,
  `Effect.runCallbackWith`, `Effect.runFork`, `Effect.runForkWith`, `Effect.runPromise`,
  `Effect.runPromiseWith`, `Effect.runPromiseExitWith` outside the exact pi-adapter callback bridge
  allowlist, unaudited module-level promise-exit runners such as `Effect.runPromiseExit`,
  `Effect.runSync`, `Effect.runSyncWith`, `Effect.runSyncExit`,
  `Effect.runSyncExitWith`,
  instance `managedRuntime.run*` calls, `Layer.launch`, platform `runMain` helpers, or hidden
  runtime singletons outside app/bootstrap, process entrypoints, production facade factories and
  bridge adapters that run effects through a caller-owned `ManagedRuntime`, facade tests named by
  the package-boundary checks, named scope-owned subscription/stream adapters with close receipts,
  and explicit integration/e2e edge harnesses. Production facade/bridge runner allowlists are exact
  file globs maintained by package-boundary tests, including `@svvy/runtime` `createRuntimeFacade`,
  `@svvy/state` `createStateFacade` / `createStateCommandsFacade`, app/bootstrap runtime-service
  adapters, and explicit browser/headless bridge adapters. Those modules may call only caller-owned
  `managedRuntime.run*` methods or app-owned bootstrap runners; they must not create a runtime,
  rebuild layers per request, or expose a generic runner. Module-level
  `Effect.runPromiseWith(...)` and `Effect.runPromiseExitWith(...)` are not facade permissions;
  their only production package-internal use is the package-private `@svvy/pi-adapter` turn
  callback bridge named below. `Effect.runSync` is production-adopted as
  an installed member only, not as a general runner permission. Production `Effect.runSync`
  is allowed only in `src/bun/index.ts` for synchronous app bootstrap config decoding before layer
  composition and `src/bun/session-catalog.ts` for the existing catalog's bounded app-bootstrap
  bridge into already-owned runtime state effects. Both
  files are app/bootstrap implementation edges, not shipped runtime architecture boundaries,
  workflow runtimes, or catalog ownership surfaces. New production `Effect.runSync`,
  `Effect.runSyncWith`, `Effect.runSyncExit`, or
  `Effect.runSyncExitWith` requires package-boundary allowlist coverage,
  owner/spec reason, and focused test coverage. They remain forbidden in package services, runtime
  workers, state repositories, extension handlers, renderer code, generated output, generic bridge
  facades, and ordinary service tests. Production `Effect.runPromise(...)` is allowed only in the
  exact source-gated files named by `packages/effect-adoption-manifest.ts`:
  `src/bun/runtime-service-adapter.ts` as app/bootstrap glue over the already-acquired app-owned
  `ManagedRuntime`, `packages/runtime/src/source-invalidation-coordinator-adapter.ts` as the
  narrow runtime-owned source-invalidation coordinator Promise handle edge, and
  `src/bun/extension-lifecycle-authority.ts` as the app-owned Extension Managing command adapter
  that supplies Bun file/path/crypto host services to package-owned source lifecycle effects. The app/bootstrap
  adapter may adapt a spec-approved app/runtime edge effect to that adapter's Promise-returning app
  facade, or invoke a runtime-owned bootstrap/app-edge operation named by the owning package spec
  and intentionally absent from the public Promise facade, such as workspace-link repair recovery.
  These exceptions do not make `src/bun` or the coordinator adapter a runtime architecture
  boundary, workflow runtime, catalog owner, queue dispatcher, or package-private service caller.
  They run through the app-owned runtime composition boundary, must not create a runtime or rebuild
  layers per request, must not expose a generic runner, and remain forbidden in package services,
  runtime workers, state repositories, extension handlers, renderer code, generated output, generic
  bridge facades, and ordinary service tests. A
  production `Effect.runPromise(...)` use requires package-boundary allowlist coverage, owner/spec
  reason, and focused tests. The
  package-internal runner exceptions are the package-private `@svvy/pi-adapter` turn callback
  bridge named in `pi-adapter.spec.md` and the narrow
  `@svvy/runtime/source-invalidation-coordinator-adapter` Promise handle edge named in
  `runtime.spec.md`. The source-invalidation coordinator adapter may call
  `Effect.runPromise(...)` only to start, signal, reconcile, and close its own runtime-owned
  coordinator handle; it does not create a package-level runtime, rebuild layers per request, expose
  a generic runner, or expose source-invalidation service/tag/layer/policy APIs. The
  same change that introduces or changes the bridge runner must name the exact runner pair in the
  Effect adoption manifest. The pi callback bridge pair is
  `Effect.runPromiseWith(services)` for fire-and-forget queue/close effects whose failures are
  already normalized into the turn queue, and `Effect.runPromiseExitWith(services)` for effects
  whose `Exit` must be inspected and mapped into `PiAdapterError` or `NativeToolResult`. The
  `services` value is the `Context` captured inside the active `turns.run(...)` scope.
  `Effect.runCallbackWith(...)` is not part of the current pi-adapter bridge and requires a
  same-change manifest row, exact package-boundary allowlist, owner/spec reason, and focused fake pi
  tests before use. The bridge may run only against the current turn context to adapt pi
  subscription callbacks, prompt lifecycle callbacks, and runtime-provided tool executor effects
  inside the current turn; it never creates or receives a `ManagedRuntime`, never runs arbitrary
  package effects, and closes with the turn scope. The
  current gate records adopted `ManagedRuntime` instance member reads, including known aliases and
  string-literal member reads. It is not general type-aware receiver analysis for arbitrary values.
- `SVVY-EFFECT-004`: no `effect/Runtime` imports in product code. The process lifecycle helpers
  `Runtime.makeRunMain`, `Runtime.defaultTeardown`, `Runtime.errorExitCode`,
  `Runtime.errorReported`, `Runtime.getErrorExitCode`, and `Runtime.getErrorReported` are not
  adopted product APIs. Production use requires installed-export audit rows, production manifest
  rows, exact app/process adapter allowlists, and focused lifecycle tests in the same change.
  Bridge facades run effects through the
  app-bootstrap-owned `ManagedRuntime`, while domain packages remain Effect services/layers and do
  not run effects directly.
- `SVVY-EFFECT-005`: Effect layer usage uses only manifest-adopted v4 layer APIs and keeps
  unadopted layer APIs out of product code. `Layer.scoped` and `Layer.scopedDiscard` are not
  installed exports in the adopted beta.84 stack; even if an Effect upgrade introduces them, they
  remain forbidden product APIs until exact manifest/spec/test promotion. Layer acquisition uses
  adopted `Layer.effect(...)`; scoped acquisition inside that effect uses only the exact `Scope` /
  finalizer members named in the scoped-resource table and adoption manifest.
  Installed but unadopted layer APIs are rejected everywhere in product code:
  `Layer.fromBuild`, `Layer.fromBuildMemo`, `Layer.buildWithMemoMap`,
  `Layer.forkMemoMapUnsafe`, `Layer.effectDiscard`, `Layer.buildWithScope`, `Layer.unwrap`,
  `Layer.suspend`, `Layer.fresh`, `Layer.effectContext`, and `Layer.makeMemoMapUnsafe`.
  `Layer.provideMerge(...)` is production-adopted only for exact manifest source gates that compose
  package-private internal layers before a final public `Layer.provide(...)` boundary, and is
  otherwise allowed only in manifest-listed test/harness globs when the test must access both the
  service under test and the provided fixture/handle service.
  `Effect.provide(layer, { local: true })` is production-forbidden by package-boundary source
  scans. Test use requires the owning package spec to name the isolated resource subtree, owner,
  lifetime, and test proving isolation is required; broad test-lane option-shape enforcement must be
  added in the same change if this option becomes a repeated test pattern. Any production use of
  these non-adopted APIs requires the same patch to add exact manifest rows, boundary allowlists,
  owner policy, and focused tests.
- `SVVY-EFFECT-006`: Effect service/layer/schema/runtime imports use v4 names and v4 generator forms only
- `SVVY-EFFECT-007`: no pi-native imports outside `@svvy/pi-adapter` internals and explicitly named adapter tests
- `SVVY-EFFECT-008`: no renderer, Svelte, Dockview, or Electrobun imports in non-desktop packages
- `SVVY-EFFECT-009`: no runtime/state/sandbox/pi-adapter/desktop/public-extension imports from generated `@svvyx/*`
  outputs except allowed type-only `@svvy/core` bridge contracts named in
  `generated-packages.spec.md`
- Generated `@svvyx/*` source must not read ambient process env or call raw `fetch` except for the
  generated `@svvyx/workflows` `Agents.defineTaskAgent(...)` client reading the exact
  `SVVY_WORKFLOW_AGENT_*` command-scoped variables and POSTing to the injected authenticated
  `runTaskAgent` bridge URL. That exception is generated Smithers child-process plumbing only; it is
  not available to product packages, extension handlers, renderer code, app/bootstrap helpers,
  `execute_typescript` snippets, or generated-package SDK/facade surfaces.
- `SVVY-EFFECT-010`: no generated `@svvyx/*` observability or runtime-policy imports such as `effect/Metric`,
  `effect/Logger`, `effect/Tracer`, `effect/unstable/observability`, or `@effect/opentelemetry`
- `SVVY-EFFECT-011`: no generated `@svvyx/*` imports used as `execute_typescript` runtime facades
- `SVVY-EFFECT-012`: package-boundary checks reject unsafe process-edge patterns in package code
  that owns runtime logic: direct wall-clock reads such as `Date.now()`,
  `new Date()`, `DateTime.nowUnsafe()`, `clock.currentTimeMillisUnsafe()`, and
  `clock.currentTimeNanosUnsafe()`; raw timers such as `setTimeout` and `setInterval`; random or
  crypto globals such as `Math.random()`, `crypto.randomUUID()`, direct `node:crypto`, WebCrypto,
  or Bun crypto globals; raw `fetch` / `globalThis.fetch`; `console.*`; and the watcher/process
  API patterns named by the boundary tests. Detached-promise and broader unscoped watcher/process
  bans require explicit boundary patterns before they are treated as mechanically enforced.
  Package code uses Effect `Clock`, `DateTime`, `Schedule`, scoped fibers, injected
  crypto/HTTP/logging services, and test clocks unless a package spec names the process-edge
  exception.
- `SVVY-EFFECT-013`: no mutation of file-backed source truth from state repositories, renderer panes, runtime event
  publishers, or desktop bridge code
- `SVVY-EFFECT-014`: no inline schema parser compiler calls inside package, app-runtime,
  tool-handler, bridge-handler, event-loop, read-model selector, or command-output function bodies
  except named dynamic schema factory files. The exact denied compiler APIs are `Schema.is`,
  `Schema.decodeEffect`, `Schema.decodeExit`, `Schema.decodeOption`, `Schema.decodePromise`,
  `Schema.decodeSync`, `Schema.decodeUnknownEffect`,
  `Schema.decodeUnknownExit`, `Schema.decodeUnknownOption`, `Schema.decodeUnknownPromise`,
  `Schema.decodeUnknownSync`, `Schema.encodeEffect`, `Schema.encodeExit`,
  `Schema.encodeOption`, `Schema.encodePromise`, `Schema.encodeSync`, `Schema.encodeUnknownEffect`,
  `Schema.encodeUnknownExit`, `Schema.encodeUnknownOption`, `Schema.encodeUnknownPromise`,
  `Schema.encodeUnknownSync`, `Schema.decodeUnknownResult`, `Schema.decodeResult`,
  `Schema.encodeUnknownResult`, `Schema.encodeResult`, and svvy wrapper compilers
  `decodeUnknownResult`, `decodeResult`, `encodeUnknownResult`, and `encodeResult` when called
  inside function bodies. Package-boundary tests also include defensive source-pattern scans for
  unadopted assertion and schema construction/transform call shapes in package boundary, runtime,
  bridge, handler, read-model, and command-output code except named dynamic schema factory files.
  Those scans are prohibition policy, not installed-export adoption evidence. Package boundary code
  prefers hoisted decode/encode helpers so parse errors stay typed and testable. Any production use
  of assertion helpers or schema construction/transform APIs outside the currently adopted Schema
  member set requires exact manifest rows and focused schema construction tests.
- `SVVY-EFFECT-015`: Effect service/layer tests live in `*.effect.test.ts`, import
  `@effect/vitest`, and run through `bun run test:effect`; Bun test globs exclude them, and files
  that use `TestClock`, package layers, scoped services, `Effect.provide(...)` with service layers,
  or manual effect runner helpers cannot stay in the Bun lane except for SQLite-backed
  `@svvy/state` tests that directly or transitively depend on the active `bun:sqlite` adapter.
  Those state tests stay in the Bun unit lane while that adapter is active, still test
  Effect-returning APIs, and still cannot create `ManagedRuntime` manually except for exact named
  state facade harnesses that prove the non-Effect facade edge. App-side Bun tests that manually run
  Effect for native-tool, runtime-adapter, state-port, or app-bootstrap harnesses are not broad
  Effect service/layer tests; package-boundary checks keep their `Effect.run*`,
  `ManagedRuntime.make`, `Layer.launch`, and process-runner reads in an exact file/member ledger.
  Package-boundary checks reject manual Effect runner helpers outside named integration, facade,
  process-edge, e2e harnesses, app-side Bun test harnesses, or the state-local SQLite-backed
  Bun-lane tests.
- `SVVY-EFFECT-016`: every exported public `Schema.TaggedErrorClass`, public `*ErrorSchema`, and
  stable bridge/RPC error schema must export `decodeUnknown<Name>Effect`,
  `decodeUnknown<Name>Exit`, `encode<Name>Effect`, and `encode<Name>Exit` using
  `strictBoundaryParseOptions`. The package-boundary gate enforces the contract for its explicit
  public error/schema ledger; adding another public error/schema export requires adding it to that
  ledger in the same change. Sync error decoders may exist only as
  `unsafeDecode<Name>SyncForTestsAndBootstrap`.
- `SVVY-EFFECT-017`: public contract schemas use `Schema.optionalKey(...)` for optional object
  fields. Production package source must not use `Schema.optional(...)` inside
  `Schema.Struct({ ... })` field definitions; undefined-valued object-field semantics require a new
  explicit schema policy, package-boundary exception ledger, and focused decode/encode tests in the
  same change.
- `SVVY-EFFECT-018`: imports of optional Effect modules require a package-spec adoption record
  naming module, owner service, use case, scope/lifetime, capacity or TTL, invalidation/release
  path, test layer, and allowed source globs. Mechanized gates reject unadopted imports and member
  reads through the adoption manifest and boundary allowlists; the adoption record fields are a
  review requirement until a dedicated spec-record validator exists.
- `SVVY-EFFECT-019`: every exported scoped resource/service has a package-spec resource-lifetime
  matrix row naming owner, acquire layer, release owner, runtime phase, shutdown behavior, tests,
  and facade visibility. Exporting the service/layer before that row exists fails the boundary
  gate.
- `SVVY-EFFECT-020`: eager Effect/Match APIs such as `mapEager`, `mapErrorEager`, `mapBothEager`,
  `flatMapEager`, `catchEager`, `fnUntracedEager`, and eager match variants are banned outside
  package-spec hot-path exceptions that include benchmark evidence and focused tests. Default
  package services use lazy Effect APIs.
- `SVVY-EFFECT-021`: no `Schema.catchDecoding(...)` or
  `Schema.catchDecodingWithContext(...)` in public boundary, persistence, row, event, command-fact,
  read-model, app-log, generated-command, generated-contract, or generated-package schemas except
  owner-named internal normalization schemas that never cross product boundaries.
- `SVVY-EFFECT-022`: Effect APIs named `ExecutionPlan`, `Effect.withExecutionPlan`, and
  `Stream.withExecutionPlan` are not adopted product APIs. Boundary tests reject those exact names
  in product code when they appear as Effect imports or Effect/Stream member calls. The only allowed
  similarly named product contract is core-owned `ExtensionExecutionPlan`.

Focused tests must prove the positive contract for each promoted behavior: the service/layer is the
owner, the facade is mechanical, the state mutation returns after-commit invalidations, the runtime
publishes only after commit, the resource closes on scope shutdown/interruption, and the test layer
can replace the dependency without importing implementation internals. Manifest and package-boundary
checks prove import/member/export shape; they are not substitutes for those behavior tests.

## Acceptance Criteria

- Non-UI packages expose Effect-native services and layers.
- Desktop and non-Effect consumers use facades over the single app/bootstrap-owned `ManagedRuntime`
  for the healthy app-runtime instance.
- `@svvy/core` exposes schemas, branded ids, and typed errors without service/runtime state.
- Runtime event subscription APIs expose Effect streams through exact manifest-adopted stream
  members and named facade adapters.
- Runtime in-memory queues are not confused with durable state queues.
- State transactions are Effect effects and SQLite remains authoritative.
- pi session and turn lifetimes are scoped.
- Subprocess lifetimes are scoped and interruptible.
- Tool handlers are Effect effects with typed input validation, typed errors, and deterministic
  command facts.
- Effect service/layer tests normally use `@effect/vitest` and test layers; SQLite-backed
  `@svvy/state` tests that directly or transitively depend on the active `bun:sqlite` adapter stay
  in the Bun unit lane while that adapter is active; pure schema and contract tests may stay in the
  Bun unit suite.
- Effect imports use v4 APIs and v4 import paths only.
