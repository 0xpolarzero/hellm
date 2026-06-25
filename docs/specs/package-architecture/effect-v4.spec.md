# Effect v4 Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Scope: cross-package Effect v4 usage rules for the target package architecture

## Purpose

Effect v4 is the implementation substrate for non-UI `svvy` packages.

It gives the package architecture one typed way to express dependencies, resource lifetimes,
structured errors, validation, streams, retries, queues, cancellation, observability, and tests.

Effect does not replace pi, Smithers, SQLite product state, Electrobun, Svelte, or the extension
system. It makes those boundaries explicit and testable.

## References

The active installed Effect authority is `effect@4.0.0-beta.84`, pinned in the root manifest, every
`@svvy/*` package manifest, and `bun.lock`. The checked-in `docs/references/effect-smol` snapshot is
`effect@4.0.0-beta.84`; it is design/reference material unless the exact import path and named API
are verified against installed `node_modules/effect@4.0.0-beta.84`. The Effect test lane is adopted:
the root manifest pins `vitest@4.1.4` and `@effect/vitest@4.0.0-beta.84`, `bun.lock` records both
packages, and `bun run check` runs `bun run test:effect` between the Bun unit lane and lint.

The active lockfile must remain a coherent Effect platform stack: `effect`, every adopted
`@effect/*` package, every `@svvy/*` package manifest dependency on `effect`, and every transitive
`@effect/*` peer range in `bun.lock` resolve against the same adopted beta.84 stack. The
`packages/effect-installed-exports.effect.test.ts` audit proves the installed exports and concrete
usage forms explicitly adopted by the audit still exist in the active stack, including the named
Bun platform layers, `@effect/vitest` helpers, `LayerMap.Service`, logger/metric controls,
`Metric.snapshot` as an Effect value, bridge stream adapters, config providers, `SubscriptionRef`
latest-value helpers, and `TestClock`. Any future Effect upgrade is a lockstep architecture change
across root/package manifests, `bun.lock`, local references, installed-export audits,
package-boundary tests, and this spec.

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
live `@effect/sql-sqlite-*` adapters are forbidden in production code unless a new architecture
change updates the PRD, state spec, this spec, manifests, lockfile, and package-boundary tests as
one coherent adoption record.

API-delta notes may be consulted only to identify v4 APIs and disallowed old names; they do not
define product architecture, staging, or alternate behavior. Any implementation that uses a
reference-only API must either upgrade the installed root/package manifests and lockfile to the
reference version or add a dated installed-export audit entry to this spec proving that every
referenced API used by svvy exists in the installed package.

Effect API authority is resolved by this table. The import-family table is a non-exhaustive summary;
the Module Decisions Index and detailed construct table below are authoritative for individually
adopted modules and policies.

| API/import family                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Installed beta.84 status                                                                                                                                                                                                                     | `effect-smol` beta.84 status                                                                               | Adoption state                                                                                                                                                                                                                                                                                                                                                                                                                | Allowed packages                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `effect` root import and adopted direct core subpaths named in the detailed construct table below, including `effect/Effect`, `effect/Layer`, `effect/Context`, `effect/ManagedRuntime`, `effect/Scope`, `effect/LayerMap`, `effect/Stream`, `effect/Queue`, `effect/PubSub`, `effect/Deferred`, `effect/Latch`, `effect/Ref`, `effect/SynchronizedRef`, `effect/SubscriptionRef`, `effect/ScopedRef`, `effect/Semaphore`, `effect/FiberHandle`, `effect/FiberMap`, `effect/FiberSet`, `effect/Schedule`, `effect/Duration`, `effect/Config`, `effect/ConfigProvider`, `effect/Schema`, `effect/SchemaIssue`, `effect/SchemaAST`, `effect/SchemaRepresentation`, `effect/JsonSchema`, `effect/Clock`, `effect/DateTime`, `effect/Crypto`, `effect/Encoding`, `effect/Channel`, `effect/Sink`, `effect/Filter`, `effect/FileSystem`, `effect/Path`, `effect/PlatformError`, `effect/Logger`, `effect/Tracer`, and `effect/Metric` | Path-exported by installed `effect@4.0.0-beta.84`; each named function/type used by svvy must typecheck against the installed package before the code lands.                                                                                 | Reference material may show newer names or examples.                                                       | Adopted through `effect@4.0.0-beta.84`; implementation may use only installed-verified names. This import-family row is a summary; the module decisions index below is the enforcement source for exact module adoption and package policy. Process-local concurrency subpaths are adopted only for scoped process-local coordination named by this spec; schema representation subpaths are adopted only for schema/declaration/contract emitter paths named later in this spec. They are not durable state, public contracts, renderer state, or runtime facade payloads. | Public `@svvy/*` packages according to each package spec; app/process edges where named by this spec.                                                                                |
| `effect/testing` and `@effect/vitest`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Installed through root dev dependencies and the `test:effect` lane; Effect service/layer test files must typecheck and run against installed beta.84-compatible packages.                                                                    | Reference testing examples may be newer and must be checked against installed packages.                    | Adopted for `packages/**/*.effect.test.ts` and named Effect integration harnesses.                                                                                                                                                                                                                                                                                                                                            | Test files and approved test helpers only.                                                                                                                                           |
| `effect/unstable/sql/*` abstract SQL service imports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Path-exported by installed `effect@4.0.0-beta.84`; named APIs require installed verification before use.                                                                                                                                     | Reference material only for SQL patterns and API discovery.                                                | Not adopted. Any use requires a new coherent Effect SQL adoption record across PRD, state spec, this spec, manifests, lockfile, implementation, and package-boundary tests.                                                                                                                                                                                                                                                   | None until adopted by a new architecture change.                                                                                                                                     |
| `effect/unstable/process` namespace imports for `ChildProcess` and `ChildProcessSpawner`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Installed-verified on 2026-06-25 against `effect@4.0.0-beta.84`; `import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"` exposes `ChildProcess.make` and `ChildProcessSpawner.ChildProcessSpawner`.                    | Reference material documents command definitions, streaming handles, and platform-provided spawner layers. | Adopted as abstract process service contracts for runtime-owned command sessions, sandbox launch execution, pi-adapter package-private protocol/helper transports when used, extension-owned bounded source/build/readiness helpers, and fake process test layers. Live platform implementations are supplied by app/bootstrap host adapters.                                                                                 | `@svvy/runtime`, `@svvy/sandbox`, `@svvy/pi-adapter`, and `@svvy/extensions` where their specs name command/launch/helper ownership, app/bootstrap host adapters, and focused tests. |
| `effect/unstable/http/*`, `effect/unstable/cli/*`, `effect/unstable/encoding/*`, other `effect/unstable/process/*` modules beyond `ChildProcess` / `ChildProcessSpawner`, and other unstable Effect modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Path-exported by installed `effect@4.0.0-beta.84`; named APIs require installed verification before use.                                                                                                                                     | Reference material only.                                                                                   | Not generally adopted; each production use requires an adoption record with owner, lifetime, test layer, and import globs.                                                                                                                                                                                                                                                                                                    | Only the package named by the adoption record.                                                                                                                                       |
| `@effect/platform-bun`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Installed in the root and `@svvy/runtime` manifests and `bun.lock`; `BunFileSystem.layer`, `BunPath.layer`, and `BunCrypto.layer` were installed-verified on 2026-06-25 and are used by `@svvy/runtime/bootstrap` `layerRuntimeBunPlatform`. | Reference material may show newer names or examples.                                                       | Adopted only for Bun/Electrobun platform bootstrap service layers, not domain service imports.                                                                                                                                                                                                                                                                                                                                | `@svvy/runtime/src/bun-platform.ts`, app/bootstrap adapters, and focused boundary tests.                                                                                             |
| `@effect/platform-node` and `@effect/sql-sqlite-*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Not installed/adopted unless the manifest and `bun.lock` entries exist in the same patch.                                                                                                                                                    | Reference material only.                                                                                   | Not adopted for product code at this spec revision.                                                                                                                                                                                                                                                                                                                                                                           | None until adopted.                                                                                                                                                                  |

`installed-verified` means both the import path and the exact named values used by svvy are
accepted by the installed dependency during typecheck or by a dated export audit committed in this
spec. `path-exported` alone is insufficient authority for implementation when examples come from a
newer reference snapshot.

Every Effect API referenced by this spec or used by `svvy` must either typecheck in the exact source
file against installed `effect@4.0.0-beta.84`/adopted `@effect/*` packages, or have explicit
installed-export audit coverage before production use. Production package and Bun app value member
reads are recorded in `packages/effect-adoption-manifest.ts` as import path plus exact member names.
`packages/package-boundaries.test.ts` derives current production Effect member reads from the
TypeScript AST and requires them to match that manifest exactly; `packages/effect-installed-exports.effect.test.ts`
imports the same manifest and proves every listed runtime member exists on the installed package
namespace. Type-only Effect imports are recorded as type-only module rows and are proven by source
typecheck, not runtime `typeof` checks. Future reference-only or test-only adoption rows still name
the package, import path, export name, verification command, date, owning package/spec section, and
scope. A successful broad package typecheck is useful evidence only when it covers the exact source
file that imports the symbol. `effect-smol` beta.84 examples are reference material only; they never
prove installed compatibility by themselves.

Reference entry points:

- `docs/references/effect-smol/LLMS.md`
- `docs/references/effect-smol/AGENTS.md`
- `docs/references/effect-smol/.patterns/effect.md`
- `docs/references/effect-smol/migration/v3-to-v4.md`
- `docs/references/effect-smol/migration/services.md`
- `docs/references/effect-smol/migration/runtime.md`
- `docs/references/effect-smol/migration/forking.md`
- `docs/references/effect-smol/migration/generators.md`
- `docs/references/effect-smol/migration/layer-memoization.md`
- `docs/references/effect-smol/migration/scope.md`
- `docs/references/effect-smol/migration/error-handling.md`
- `docs/references/effect-smol/migration/cause.md`
- `docs/references/effect-smol/migration/fiberref.md`
- `docs/references/effect-smol/migration/schema.md`
- `docs/references/effect-smol/cookbooks/schedule.md`
- `docs/references/effect-smol/ai-docs/src/01_effect/02_services/01_service.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/02_services/20_layer-composition.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/10_acquire-release.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/20_layer-side-effects.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/30_layer-map.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/05_running/10_run-main.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/05_running/20_layer-launch.ts`
- `docs/references/effect-smol/ai-docs/src/01_effect/06_pubsub/10_pubsub.ts`
- `docs/references/effect-smol/ai-docs/src/02_stream/10_creating-streams.ts`
- `docs/references/effect-smol/ai-docs/src/02_stream/20_consuming-streams.ts`
- `docs/references/effect-smol/ai-docs/src/02_stream/30_encoding.ts`
- `docs/references/effect-smol/ai-docs/src/03_integration/10_managed-runtime.ts`
- `docs/references/effect-smol/ai-docs/src/06_schedule/10_schedules.ts`
- `docs/references/effect-smol/ai-docs/src/08_observability/10_logging.ts`
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

Use Effect v4 APIs from `docs/references/effect-smol/`. Do not use v3 names or v3 package paths.

Effect package code uses TypeScript `strict` mode and a TypeScript version compatible with Effect
v4's declaration requirements. Do not weaken compiler settings to make Effect code typecheck.

## Local Reference Facts

The following facts are the local-reference basis for this architecture:

- Effect v4 services use `Context.Service` rather than v3 `Context.Tag` / `Effect.Service`; package
  implementation services use class-style `Context.Service<Self, Shape>()(id)`, while core-owned
  data-only ports use function-style `Context.Service<PortIdentifier, PortService>(id)` so the
  environment key remains type-distinct from the provider object shape. Reference:
  `docs/references/effect-smol/migration/services.md`.
- Service dependencies are read inside `Effect.gen(function* () { ... })` with `yield* Service`,
  which keeps dependencies visible at the use site. Reference:
  `docs/references/effect-smol/migration/services.md`.
- Service access inside service and layer implementation bodies uses `yield* Service` inside
  `Effect.gen(...)`. `Service.use(...)` and `useSync(...)` are allowed only for short edge/facade
  expressions where the resulting Effect value is immediately returned and the service requirement
  remains visible. Do not use `use(...)` inside package service implementations or returned service
  methods when it hides the dependency from the method body.
- Layers are explicit. Effect v4 does not create package layers automatically from `make`; package
  code defines named `Layer.effect(...)` or composed package layers. Reference:
  `docs/references/effect-smol/ai-docs/src/01_effect/02_services/20_layer-composition.ts`.
- `ManagedRuntime` is an integration/app edge for running many effects over one acquired layer
  graph, with cached context acquisition and explicit disposal. It is not a package singleton and
  not a per-request construction primitive. Reference:
  `docs/references/effect-smol/packages/effect/src/ManagedRuntime.ts`.
- Resource lifetimes are scope-driven through layer scopes, `Effect.acquireRelease`, scoped forks,
  and explicit finalizers. Reference:
  `docs/references/effect-smol/ai-docs/src/01_effect/04_resources/10_acquire-release.ts`.
- Manual bridge scopes use v4 `Scope.provide`, `Scope.use`, and `Scope.close`. `Scope.provide`
  provides a caller-owned scope without closing it; `Scope.use` closes a closeable scope with the
  program's real `Exit`; `Scope.close(scope, exit)` runs registered finalizers with the supplied
  `Exit`. Use `Scope.provide`, not removed v3 `Scope.extend`.
- `@effect/vitest` is the Effect service/layer test surface. Effect service/layer tests use
  `it.effect`, `layer(...)`, test layers, and `TestClock` instead of manual runners in Bun tests.
  References:
  `docs/references/effect-smol/ai-docs/src/09_testing/10_effect-tests.ts` and
  `docs/references/effect-smol/ai-docs/src/09_testing/20_layer-tests.ts`.
- T3Code references reinforce two svvy package rules: schema compiler calls should be hoisted rather
  than compiled inside function bodies, and host/process facts should be injected rather than read
  directly from globals. References:
  `docs/references/t3code/oxlint-plugin-t3code/rules/no-inline-schema-compile.ts` and
  `docs/references/t3code/oxlint-plugin-t3code/rules/no-global-process-runtime.ts`.

The complete svvy bootstrap sequence, `ManagedRuntime.make(appLayer)` followed by
`await managedRuntime.context()`, runtime-owned startup readiness, facade exposure, shutdown
preparation, and disposal, is a svvy product architecture contract assembled from the Effect
runtime/layer/scope primitives above. It is not copied from a single upstream reference example.

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
- `Runtime.layer`: the package-owned production layer factory for the runtime service.
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
a single `ManagedRuntime`. Those facades are adapters over the Effect services. They must not
contain parallel lifecycle logic. The complete app bootstrap graph, including state port layers, is
defined in `package-architecture.spec.md`; this file defines the Effect rules that graph must
follow.

Package layers are composed once at app/bootstrap. Facades receive the caller-owned
`ManagedRuntime`; package code must not create a runtime or rebuild this graph per request.
No public `@svvy/*` package module exports a package-level `ManagedRuntime` singleton. Exported
runtimes are allowed only in app/process bootstrap or narrowly named non-Effect edge harnesses whose
job is to adapt framework callbacks into package services; package entrypoints export services,
layers, contracts, and facade factories instead.

Packages may export named package-local layer bundles such as `layerRuntimeCore` or
`layerStateRepositories` to express owner-package dependency subgraphs. Those modules compose
services and layers only; they do not create `ManagedRuntime`s, launch process roots, read host
globals, or assemble per-request dependency graphs. Public svvy package layers do not use `Live`,
`Default`, or `*LayerLive` names; implementation/live status is expressed by the package owner and
dependency graph, not a suffix.

The shipped app bootstrap composes one app runtime layer graph from package-owned bundles, then
creates one app-owned `ManagedRuntime`. The intended topology is:

- `@svvy/state`: database setup, migrations, repositories, read models, and state-backed port
  implementations.
- `@svvy/sandbox`: sandbox policy and launch-policy services.
- `@svvy/pi-adapter`: pi session and turn-execution services.
- `@svvy/extensions`: extension registry, prompt/source services, native tool handlers, generated
  declarations, and generated package production.
- `@svvy/runtime`: workspace/surface runtime scope services, queue workers, event hubs, recovery,
  generated-context refresh, generated-package refresh coordination, command/session services, and
  facade factory.
- app/bootstrap: platform layers, app host facts/config, Electrobun bridge wiring, and the single
  `ManagedRuntime`.

Package bundles may depend on earlier package service tags, but they do not reach into another
package's implementation modules. App/bootstrap wires bundles once; request handlers and renderer
bridges call the resulting service/facade and never rebuild this topology per request.

`ManagedRuntime.make(...)` is lazy with respect to layer graph acquisition: it allocates runtime
scope/memo state immediately, but the package layer graph is not acquired until `contextEffect`,
`context()`, or a runner first needs services. App bootstrap must always call
`await managedRuntime.context()` before exposing runtime, state, pi-adapter, extension, sandbox,
desktop, browser-tool, or headless bridge facades. This acquires the app-owned layer graph. App
bootstrap then awaits the runtime-owned startup readiness barrier before exposing those facades,
unless a specific readiness check is explicitly implemented as part of layer acquisition. Startup
effects, migrations, source validation, generated-package recovery, and startup config validation
must complete during layer acquisition or the runtime-owned readiness barrier, or fail startup when
their successful completion is required before any facade can be exposed.

`managedRuntime.context()` / `managedRuntime.contextEffect` prove that the app layer graph has been
acquired. They do not by themselves prove that forked scoped background workers are semantically
ready. If startup depends on a watcher, recovery worker, source scan, queue wakeup loop, or surface
owner being attached, initialized, or ready to accept work, the layer construction effect must await
an explicit runtime-owned `Deferred`, `Latch`, receipt, or typed readiness effect after that worker
has reached the required state. `Effect.forkScoped` ties a forked fiber to the active scope and
returns a `Fiber`; it is not a readiness probe. Effect v4 fork APIs accept startup options such as
`{ startImmediately, uninterruptible }`. Svvy workers use default deferred start unless the owning
service explicitly needs eager attachment before the next effect step can proceed. When
`startImmediately: true` is used for a readiness-sensitive worker, the same service must still wait
for the worker's own readiness receipt; eager scheduling is not a substitute for initialization
proof. `uninterruptible` is allowed only around short critical sections that commit or release a
resource and must never wrap long-running queue drains, protocol readers, source scans, bridge
subscriptions, or process-output loops.

`ManagedRuntime.isManagedRuntime(value)` may only narrow unknown edge inputs. It does not prove that
the runtime has acquired its context, completed `svvy` readiness barriers, or remains undisposed.
Facade factories that accept a runtime validate readiness through the app bootstrap contract or by
executing an explicit readiness effect; they never treat the `ManagedRuntime` marker as a readiness
or liveness check.

Effect-native bootstrap code may use `managedRuntime.contextEffect` for the same acquisition
boundary, for example when exposing the built context through `Layer.effectContext(...)` at a
framework edge. A framework-edge layer may borrow an already owned `ManagedRuntime` context with
`Layer.effectContext(managedRuntime.contextEffect)`. That layer borrows the runtime's cached context;
it does not acquire, own, or dispose the services/resources inside that context. Closing the wrapper
layer only closes finalizers registered by the wrapper itself. The creator of the `ManagedRuntime`
remains responsible for `managedRuntime.dispose()` / `managedRuntime.disposeEffect`. Domain services
still receive dependencies through service requirements, not by reaching into a managed runtime.
If `managedRuntime.context()` fails, app/bootstrap treats startup as failed by `svvy` product
policy: it does not expose partial runtime/state/pi/extension facades, reports a typed startup
failure through the app-owned startup surface, and disposes the runtime before any retry. A retry
creates a new `ManagedRuntime` from the same package layer graph. Effect v4 supports lazy runtime
acquisition and explicit disposal; terminal pending/future bridge-call behavior is a `svvy`
bootstrap contract, not an Effect runtime guarantee.

If `managedRuntime.context()` succeeds but any required runtime-owned startup readiness barrier
fails, app/bootstrap treats startup as failed in the same way: it exposes no facades, fails pending
bridge calls with the typed startup error, runs the startup-failure shutdown path, and disposes the
`ManagedRuntime` before retry. A retry creates a new `ManagedRuntime`; the failed runtime and its
cached context are never reused.

`@svvy/runtime` bootstrap exposes internal readiness services for app/workspace/surface runtime scope
owners. Startup effects that launch watchers, recovery workers, source scans, queue wakeups, or
surface owners run in the runtime scope with `Effect.forkScoped`. App bootstrap exposes no public
facade until app readiness is complete. Runtime readiness gates expose three states: pending, ready,
and failed. Calls admitted during pending state either wait in a bounded gate queue or fail
immediately according to the API group's startup policy. When startup fails, all queued work fails
with the same typed startup error and no queued effect runs. Workspace/surface runtime scope calls validate
the relevant owner readiness through product-owned `Deferred`, `Queue`, or `Latch` coordination with
bounded waits and typed failure. Readiness services record which runtime scope is starting, which API
groups may wait, wait capacity, terminal startup failure, and drain behavior. They never accept
unbounded work. On startup failure they fail waiting calls with the typed startup failure and close
the failed runtime scope. Readiness gates are product/runtime-owned, not inferred from renderer
mount, active workspace, provider event order, first incoming request, or direct startup-worker
races.

Desktop, browser tools, and headless automation facades use the one app-owned `ManagedRuntime`.
One-shot app/process entrypoints that do not expose long-lived JavaScript facades may instead run a
root Effect program with the platform `runMain` helper. They may model the root application as a
layer with `Layer.launch(...)`, which converts the layer into a never-ending `Effect` that stays
alive until interrupted. That resulting effect must still be executed by a platform `runMain` helper
or another app-owned process runner. `Layer.launch(...)` is not itself a JavaScript process runner.
Those process roots compose the same package layers once, provide platform services only at
bootstrap, and must not export reusable package-level runtimes.

The owner that creates a `ManagedRuntime` also owns shutdown. A disposed runtime must not be reused;
bridge facades fail closed or are recreated from a new runtime during app restart. Effect marks
future context acquisition on a disposed `ManagedRuntime` as a defect (`Effect.die("ManagedRuntime
disposed")`) rather than a typed failure. Svvy bridge/facade code must map disposed-runtime defects
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
projection, and state-owned implementations/layers for the core-owned runtime state ports,
`ExtensionStatePort`, `ProviderAuthPort`, `PiSessionReferencePort`, `SandboxPolicySource`,
`AppLogWritePort`, `SecretStorePort`, and `RuntimeArtifactStatePort`.

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
`Sandbox.buildLaunchPolicy(...)`; desktop/app bridge code never calls sandbox directly.

### `@svvy/pi-adapter`

`@svvy/pi-adapter` exposes Effect services and streams for pi session lifecycle and turn execution.

It owns scoped pi session handles, system prompt loading, real user-message delivery, custom tool
registration, pi event normalization, model metadata reads, helper jobs, and pi error conversion.

It must not leak pi-native event types, pi session objects, or pi resource loaders across the
package boundary.

Each live pi surface/session is represented by a runtime- or adapter-owned child scope. The owning
registry keeps the durable pi session reference in `@svvy/state`, but keeps live handles, event
pumps, abort controllers, and protocol queues only in the child scope. Closing the surface/session
scope closes those live handles and interrupts the event pump. Runtime registries may track those
child scopes with `LayerMap.Service`, `FiberMap`, `FiberSet`, or `ScopedRef`, but pi-native objects
remain behind `@svvy/pi-adapter` service methods and streams.

When `@svvy/pi-adapter` adapts pi callback, promise, event-emitter, or async-iterator APIs into
Effect streams, it owns bridge cleanup. `Effect.tryPromise` thunks forward the Effect-provided
`AbortSignal` to pi or host APIs that support cancellation. `Effect.callback` registrations return
cleanup effects for unsubscribe and abort handles. `Stream.fromAsyncIterable` uses a typed
`PiAdapterError` mapper and closes or returns the underlying iterator when the surface scope, turn
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
bootstrap from one scoped `ManagedRuntime`.

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

| Package            | Effect-owned service boundaries                                                                                                      | Primary constructs                                                                                                                                                                                                                                        | Not used for                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@svvy/core`       | schema-backed contracts, branded ids, tagged errors, pure validation helpers, data-only port service tags                            | `Schema`, `Schema.TaggedErrorClass`, branded schemas, hoisted decoders/encoders, tiny pure `Effect` validators, `Context.Service` tags for cross-package ports                                                                                            | service implementations, layers, state, streams, queues, subprocesses, pi sessions, desktop bridges                                                           |
| `@svvy/state`      | SQLite store, transactions, read-model selectors, secret/artifact ports, after-commit invalidation descriptor collection             | `Context.Service`, `Layer`, `Scope`, `Schema`, `Clock`, `DateTime`, injected `FileSystem`/`Path` for artifact file-store work                                                                                                                             | Effect SQL, queue delivery policy, pi turns, command subprocess execution, runtime event fanout, extension source ownership                                   |
| `@svvy/sandbox`    | immutable policy resolution, pure snapshot path checks, effectful path resolution, scoped launch-policy construction, denial parsing | `Context.Service`, `Layer`, `Scope`, `FileSystem`, `Path`, `Schema`, `Effect.acquireRelease`                                                                                                                                                              | approvals, command lifecycle, subprocess ownership, state reads outside the provided policy source                                                            |
| `@svvy/pi-adapter` | scoped pi session handles, real `systemPrompt`, turn streams, model metadata, helper jobs                                            | `Context.Service`, `Layer`, `LayerMap`, `Scope`, `Stream`, `Effect.acquireRelease`, `FiberMap`, `FiberSet`, `ScopedRef`, typed errors                                                                                                                     | prompt composition, extension semantics, queue claiming, command fact storage, Effect AI model calls                                                          |
| `@svvy/extensions` | extension registry, source edits, generated context, handlers, `svvyx`, generated packages                                           | `Context.Service`, `Layer`, `Schema`, `FileSystem`, `Path`, immutable command plan data, redaction helpers                                                                                                                                                | turn scheduling, durable queue claiming, desktop panes, raw state tables, arbitrary event publication                                                         |
| `@svvy/runtime`    | prompt submission, queue workers, turn execution, runtime event stream, recovery, runtime service plus exported facade factory       | `Context.Service`, `Layer`, `LayerMap`, `Scope`, `Stream`, `Queue`, package-local `PubSub` where explicitly named, `Deferred`, `Ref`, `SynchronizedRef`, `Semaphore`, `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`, `Schedule`, `Clock`, `DateTime` | durable storage implementation, pi-native objects, extension record definitions, UI rendering, Smithers workflow graph execution, Smithers workflow/run state |
| `@svvy/desktop`    | bridge adapters that consume bootstrap-provided facades; product app bootstrap owns the `ManagedRuntime`                             | bridge cancellation scopes, schema decoders at RPC boundaries, renderer-safe facade types                                                                                                                                                                 | runtime policy, queue claiming, state mutation rules, pi event adaptation, Svelte stores as durable state                                                     |

This matrix is normative. Package specs may add narrower services inside their owner package, but
they must not move an Effect responsibility into a package listed as “not used for” without first
updating the PRD, feature inventory, and this architecture spec.

The `@svvy/runtime` Smithers exclusion means runtime is not the Smithers workflow engine and does
not own Smithers workflow/run state. Runtime still owns the narrow authenticated `runTaskAgent`
bridge, workflow-task surface lifecycle, queueing into pi-backed task-agent turns, generated context
binding for those turns, and pi turn orchestration around the task-agent result.

## Agentic Flow Effect Contract

The main agentic flow is one Effect-owned runtime program exposed through facades. Each step below
names the owner, durable source of truth, allowed process-local Effect constructs, and public
boundary. Implementation that puts the same behavior in a different owner is incomplete even when it
passes local tests.

| Flow step                    | Owner service                                                                  | Durable/file-backed truth                                                                                                                                               | Effect constructs                                                                                                                                                       | Boundary contract                                                                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Message admission            | `@svvy/runtime` `Runtime.messages.submit(...)`                                 | DB/product-state-backed queue row, submitted message row, surface state, and generated-context binding facts written through state ports                                | `Effect.fn`, hoisted schema decoders, state-port effects, `Clock`/`DateTime` for committed timestamps                                                                   | Promise facade accepts only `SubmitMessageInput`, delivery intent, and optional client metadata; it does not accept pi messages, prompt text, renderer snapshots, or raw runtime-effect envelopes                        |
| After-commit notification    | `@svvy/state` returns descriptors; `@svvy/runtime` publishes                   | Committed state mutation result `afterCommit` descriptors                                                                                                               | `StateMutationResult<T>`, scoped runtime event bus, replay ring, per-subscriber `Queue`, `Stream`                                                                       | Events are typed invalidation notifications; consumers refetch read models from state                                                                                                                                    |
| Queue wake and claim         | `@svvy/runtime` surface/workspace runtime scope owners                               | DB/product-state-backed queue rows, leases, retries, terminal facts, recovery rows                                                                                      | Process-local `Queue` only for wake hints, `SynchronizedRef` for dirty-key coalescing, `Semaphore`/prompt lock, scoped fibers, `Schedule` for recovery scans            | Queue ordering, claim, retry, terminalization, and recovery are persisted state-port effects; in-memory wakeups are rebuildable hints                                                                                    |
| Pre-dispatch prompt refresh  | `@svvy/runtime` coordinates; `@svvy/extensions` builds; `@svvy/state` persists | Extension/workflow/external-instruction source files plus DB generated-context facts and surface binding facts                                                          | source-owner service effects, `FileSystem`, `Path`, `Crypto`, state-port mutation results, `Clock`/`DateTime`                                                           | Runtime refreshes only at safe pre-dispatch boundaries; UI and callers never submit generated prompt previews                                                                                                            |
| Pi turn                      | `@svvy/pi-adapter`, called by `@svvy/runtime`                                  | pi transcript/history in pi plus persisted opaque pi session refs in state                                                                                              | scoped session/turn child scopes, `Stream<PiRuntimeEvent, PiAdapterError>`, `Effect.tryPromise`/`Effect.callback` adapters with cleanup, `AbortSignal` forwarding       | Adapter loads true pi `systemPrompt`, sends one real user message, disables ambient pi resources, and emits pi-normalized events; it exposes no pi-native handles                                                        |
| Accepted tool call           | `@svvy/runtime` command/tool lane plus `@svvy/extensions` handler lookup       | DB command rows, streamed argument snapshots, command events, terminal command facts                                                                                    | `Effect.fn`, typed handler effects, redaction effects, state-port mutation results                                                                                      | Extension handler receives only a decoded invocation for a tool that was declared for the active actor binding and returns one model-facing result plus ordered `ExtensionRuntimeOperation` items                        |
| `runtime_effect` operation   | `@svvy/runtime` operation applier                                              | The state rows or file/package evidence named by the closed request kind                                                                                                | ordered effect lane, state-port mutation results, service calls to state/extensions/pi/sandbox as required by the request kind                                          | Only runtime applies `RuntimeEffectRequest` values. Public facades do not accept them. Extensions do not write state or publish events directly                                                                          |
| `execution_plan` operation   | `@svvy/runtime` command/process/file/approval lanes                            | DB command facts, approval rows, artifact rows/files, sandbox launch facts, child-command facts                                                                         | `Sandbox.buildLaunchPolicy(...)`, `ChildProcessSpawner`, scoped subprocess fibers, bounded stdout/stderr streams, stdin queues, `Schedule` for bounded retries/timeouts | Runtime owns approval, sandbox, subprocess, file, stdin, artifact, and child-command lifecycle. Extension plans are immutable data                                                                                       |
| Request-input wait           | `@svvy/runtime` request-input lifecycle                                        | DB request/question/option/answer/deadline/wait facts                                                                                                                   | `Deferred`, scoped wait registry, `Effect.timeoutOrElse` or `Effect.sleep` race using `Clock`, state-port mutation results                                              | Blocking waits resolve from committed answers or committed timeout defaulting. Nonblocking answers are delivered by queued follow-up rows                                                                                |
| Runtime events               | `@svvy/runtime` event service                                                  | Durable read-model truth is DB/product-state-backed; runtime event generation/sequence and live fanout are runtime-owned delivery metadata, not persisted product state | replay ring, bounded per-subscriber `Queue` with explicit overflow close/rebaseline handling, `Stream`, rebaseline errors, scoped subscription finalizers               | Event payloads are notifications/patches, not durable read models. Slow or overflowed matching subscribers close with a typed rebaseline result, and recovery uses persisted state facts rather than event-stream replay |
| Desktop/headless consumption | `@svvy/desktop` and alternate app edges                                        | State read models and runtime facade calls                                                                                                                              | bridge scopes, `ManagedRuntime.runPromiseExit(...)`, runtime-owned closeable subscription adapters, hoisted schema decoders                                             | UI renders by calling facades and refetching state. It owns no queue, prompt, pi, command, recovery, generated-package, or state mutation policy                                                                         |

Every flow step with a durable write must return or collect `StateMutationResult<T>` from the
state-owned port that performed the write, publish runtime notifications only after the write
commits, and expose a focused test proving that a failed write publishes nothing. Every flow step
with a long-lived process-local resource must name its owner scope, finalizer, readiness receipt,
interruption behavior, and deterministic test layer in the owning package spec before promotion.
Every flow step that crosses a non-Effect boundary must use a facade or adapter named in the owning
package spec; ordinary package code must stay Effect-native.

## Required And Allowed Effect v4 Constructs

Use these constructs in the target architecture:

### Module Decisions Index

This index is the first stop when choosing an Effect primitive. The detailed rules below remain
normative; this table summarizes ownership and the hard product boundary for each module family.

| Module family                                                                              | Adoption decision                              | Primary svvy owner/use                                                                                                                                                                                   | Hard boundary                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Effect`, `Context`, `Layer`, `Scope`, `Exit`, `Cause`, `Option`, `Result`, `Data`         | Adopted                                        | All non-UI implementation packages for typed effects, services, layers, scopes, exits, causes, options/results, and package-local data errors                                                            | Public boundary errors use core-owned `Schema.TaggedErrorClass` shapes; package code does not expose raw host errors, unchecked thrown values, or ad hoc service objects                                                                                                                             |
| `Equal`, `Hash`                                                                            | Adopted as process-local equality/hash support | Cache keys, `RequestResolver` keys, `HashMap`/`HashSet` keys, `RcMap` keys, `LayerMap` keys when a non-primitive key is explicitly adopted, and deterministic tests                                      | Never durable identity, persisted ordering, authorization, auth tokens, source fingerprints, or security. Structured logical keys use `Data.Class` or an immutable class implementing both `Equal.Equal` and `[Hash.symbol]`; do not use fresh object literals where reconstruction equality matters |
| `ManagedRuntime`                                                                           | Adopted only at app/process/facade edges       | App bootstrap creates one app-owned runtime; facade factories receive a caller-owned runtime                                                                                                             | No package-level runtime singletons, no per-request runtimes, no ordinary service tests using runtime runners                                                                                                                                                                                        |
| `Schema`, `SchemaIssue`, `JsonSchema`, `Struct`                                            | Adopted                                        | `@svvy/core` contracts and generated declaration/schema emission                                                                                                                                         | Product contracts are schema-first; emitted JSON Schema is generated output, not the source of truth                                                                                                                                                                                                 |
| `Redacted`, `Encoding`                                                                     | Adopted                                        | Process-local secret values, digest/token encoding, generated schema-safe encodings                                                                                                                      | Redacted values never persist or cross JSON/product boundaries as secret values; package code does not hand-roll supported encodings                                                                                                                                                                 |
| `Crypto`, `Clock`, `DateTime`, `Random`                                                    | Adopted with strict roles                      | Crypto-backed package helpers for secure bytes/digests/UUIDs, service-supplied time, deterministic non-security randomness in tests/jitter                                                               | No direct `Math.random`, direct host crypto, host `new Date()` in package behavior, or `Random` for secrets/ids/digests                                                                                                                                                                              |
| `Queue`, `PubSub`, `Stream`, `Take`, `Sink`, `Channel`                                     | Adopted for process-local delivery             | Runtime wake hints, live notification fanout, pi/command/bridge streams, scoped stream adapters                                                                                                          | Not durable queues, transcripts, read models, app logs, command facts, generated-package facts, or recovery ledgers                                                                                                                                                                                  |
| `Deferred`, `Latch`, `Semaphore`, `Ref`, `SynchronizedRef`, `ScopedRef`                    | Adopted for scoped coordination                | Readiness gates, request-input waits, prompt locks, mutable live flags, replaceable scoped handles                                                                                                       | Not persisted state or restartable truth; every long-lived owner names scope, finalizer, duplicate-completion behavior, and tests                                                                                                                                                                    |
| `Fiber`, `FiberHandle`, `FiberMap`, `FiberSet`, `LayerMap`                                 | Adopted for scoped workers/resources           | Runtime workspace/surface/turn workers, pi session scopes, latest-job handles, keyed owner scopes                                                                                                        | No detached fibers, no product ownership registry, no readiness inferred from fork or map presence                                                                                                                                                                                                   |
| `Schedule`, `Duration`, `TestClock`                                                        | Adopted                                        | Retry/backoff, recovery cadence, timeout policies, deterministic Effect tests                                                                                                                            | Public/persisted contracts use finite schema-checked milliseconds or a named string schema, not raw `Duration`                                                                                                                                                                                       |
| `FileSystem`, `Path`, `PlatformError`                                                      | Adopted as abstract services                   | File-backed source, generated packages, sandbox/helper path checks; live Bun file/path layer supplied only by app/bootstrap                                                                              | Domain packages do not import concrete platform modules and do not use direct host fs/path APIs after their package layer is promoted                                                                                                                                                                |
| `Crypto`                                                                                   | Adopted as an abstract service                 | Secure random bytes, UUIDv4/v7 id generation behind package-owned id services, source/artifact/generated-package digests, tokens, and fingerprints; live Bun crypto layer supplied only by app/bootstrap | Domain packages import only `effect/Crypto`; signing/HMAC uses a package-owned signing service over a reviewed host crypto backend, not raw `Crypto.Crypto` policy                                                                                                                                   |
| `ChildProcess`, `ChildProcessSpawner`                                                      | Adopted as abstract process services           | Runtime-owned durable command sessions, sandbox launch execution, and extension-owned bounded source/build/readiness helpers that do not need durable command-session projection                         | No direct `child_process`; no user-visible command/session ownership outside runtime; extension helpers are operation-scoped, consume/redact output internally, and use fake spawner test layers                                                                                                     |
| `HttpClient` family                                                                        | Conditional                                    | Future provider/OAuth/metadata probes behind an app-owned network-policy wrapper                                                                                                                         | No native Web replacement, no raw platform HTTP layer in reusable packages, no adoption without exact owner/spec row and boundary gate                                                                                                                                                               |
| `SqlClient` / `SqlSchema` / `Migrator` family                                              | Not adopted                                    | None in the active architecture                                                                                                                                                                          | SQLite truth stays state-owned through package-private `@svvy/state` repositories; no production import of `effect/unstable/sql/*` or `@effect/sql-sqlite-*` without a PRD, feature inventory, state spec, Effect spec, manifest, lockfile, and boundary-test update in one architecture change      |
| `Config`, `ConfigProvider`, `Logger`, `Metric`, `Tracer`                                   | Adopted at controlled seams                    | App/bootstrap config provisioning and svvy-owned observability helpers                                                                                                                                   | Reusable services receive explicit inputs/services; logs/spans/metrics use closed metadata and never include prompts, file contents, secrets, or provider payloads                                                                                                                                   |
| `Request`, `RequestResolver`, `Cache`, `ScopedCache`, `Resource`, `Pool`, `RcMap`, `RcRef` | Conditional, owner-record required             | Bounded non-authoritative probes or live handles only when a package spec names owner, key, TTL/capacity, invalidation, release, and tests                                                               | Never state truth, generated-context readiness, source fingerprints, command facts, read models, app logs, recovery rows, or queue ordering                                                                                                                                                          |
| `ExecutionPlan`, `Effect.withExecutionPlan`, `Stream.withExecutionPlan`                    | Not adopted as product execution-plan contract | Only after PRD, feature inventory, this spec, and the owning package spec name exact package, owner, input/output contract, and why `@svvy/core` `ExtensionExecutionPlan` cannot model the work         | Never use Effect `ExecutionPlan` as generated-extension protocol, runtime command plan data, persisted state, prompt-facing contract, or replacement for `@svvy/core` `ExtensionExecutionPlan`                                                                                                        |
| `JsonPatch`, `Tx*`, `unstable/*` product frameworks                                        | Not adopted by default                         | Only after PRD, feature inventory, this spec, and owning package spec name exact product scope                                                                                                           | No implicit replacement for Apply Patch, state transactions, runtime events, workflows, RPC, MCP, cluster, persistence, browser platform, or UI architecture                                                                                                                                         |
| `SubscriptionRef`                                                                          | Adopted only for named latest-value snapshots  | Low-cardinality, process-local status snapshots where late subscribers need the current value plus future status changes                                                                                 | Never runtime events, command output, queue delivery, durable replay, read models, app logs, high-rate streams, or backpressured fanout                                                                                                                                                              |

Additional module-level policy:

- `effect/Encoding` is adopted for hex, base64, and base64url encoding/decoding of digests,
  fingerprints, tokens, and compact binary identifiers. Decoding failures map immediately to package
  tagged errors. Package code must not hand-roll these encodings with `Buffer`, `atob`, `btoa`, or
  ad hoc byte/string helpers when `Encoding` covers the case.
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
- `Deferred` completion booleans are checked. If `Deferred.succeed`, `Deferred.fail`, or
  `Deferred.interrupt` returns `false`, the implementation either proves the duplicate completion is
  benign in that method's contract or records a typed diagnostic. Code must not silently ignore a
  failed completion for request-input waits, prompt turns, queue handoff, or facade readiness.
- `Config` is app/bootstrap/test provisioning only. Reusable package services receive decoded config
  through explicit services or layer inputs and do not read a default `ConfigProvider`. `Config.redacted`
  is for process config values, not provider tokens, extension env, or secret-store payloads; product
  secrets flow through `SecretStorePort` and redacted invocation values.
- Effect `Crypto.Crypto` is not a signing or HMAC service in the checked-in v4 reference. It may
  generate secure random tokens, UUIDs, and SHA digests, but package code must not imply that
  `Crypto` alone signs `svvyx` child-adapter payloads, bridge results, or loopback requests. Any
  signed child/bridge payload scheme uses a separate package-owned signing service whose host crypto
  backend, key ownership, rotation, redaction, verification failure shape, and tests are named in
  the owning package spec before use. The signed `svvyx` subprocess result path uses an HMAC-SHA256
  signer/verifier service owned by the runtime command-session boundary; that service may depend on
  a host crypto backend through app/bootstrap, but reusable package code does not call `node:crypto`,
  Bun crypto globals, WebCrypto globals, or Effect `Crypto` as if they were the signing policy.
  Transport schemes that use only bearer-token lineage and schema validation must be described as
  authenticated or authorized transport, not signed transport.
- Digest and token helpers are package-owned services over `Crypto.Crypto`, not repeated call-site
  recipes. Source, artifact, generated-package, and migration digests use the package-owned digest
  helper and encode through the schema-declared format, normally lowercase SHA-256 hex with an
  explicit algorithm field or prefix when the value leaves a single table. Bearer tokens,
  idempotency keys, and command-scoped bridge tokens use a package-owned token helper backed by
  the yielded `Crypto.Crypto` service instance: `const crypto = yield* Crypto.Crypto; yield*
  crypto.randomBytes(size)`. The yielded service's `randomUUIDv4` / `randomUUIDv7` effects may
  create branded public ids only through the owning id-generation service; UUID ordering is never a
  durable sequencing guarantee. `Crypto.Crypto` itself is the Effect service tag, not the method
  container. Tests provide deterministic `Crypto.Crypto` layers for ids/digests/tokens and prove
  encoded shape, redaction, uniqueness handling, and failure mapping.
- `Redacted` values may exist only in trusted process memory. Boundary schemas for redacted values
  use non-JSON encodable forms or explicit status/reference payloads; read models, logs, app-log
  entries, generated packages, and durable rows do not encode raw redacted values.
- Log/span/metric annotations go through `svvy` helper functions with a closed metadata vocabulary.
  Package code does not emit unbounded user prompts, file contents, secret material, generated
  source, or provider payloads as annotations. OTLP/exporter layers are app/bootstrap concerns only.
- Digest, token, and signing helpers depend on package-owned services backed by `Crypto.Crypto`.
  The Bun/Electrobun live provider is `@effect/platform-bun/BunCrypto.layer` supplied only by
  app/bootstrap through `layerRuntimeBunPlatform`. Reusable packages import only `effect/Crypto` and
  depend on the abstract service. `BunServices` is not the crypto contract for reusable packages,
  and no reusable package may call `node:crypto`, Bun crypto globals, WebCrypto globals, or
  `BunCrypto.layer` directly. A new crypto-backed behavior still needs its owning package spec to
  name value ownership, byte lengths or digest algorithm, encoding, redaction, failure mapping, and
  deterministic test layer before production use.
- `ErrorReporter` is not a package-level dependency. It may be adopted only at app/bootstrap or
  process entrypoints with a spec naming reporting sinks, redaction, and shutdown behavior.
- Runtime facade readiness gates are part of the public contract. Facade tests prove queued calls do
  not run before readiness, failed readiness rejects queued calls without executing domain work, and
  every readiness queue names capacity and overflow behavior.

| Construct                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Direct import                                                                                                                                                                                                                                                         | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Effect.gen`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/Effect`                                                                                                                                                                                                                                                       | Required for direct multi-step programs. Direct generator effects that need `this` use `Effect.gen({ self: this }, function*() { ... })`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Effect.fn`, `Effect.fn("name")`, `Effect.fnUntraced`, `Effect.fn.Return`                                                                                                                                                                                                                                                                                                                                                                                                                                      | `effect/Effect`                                                                                                                                                                                                                                                       | Required for reusable Effect-returning functions. Use unnamed `Effect.fn(function* ...)` when generator reuse is useful without naming a trace boundary, named `Effect.fn("@svvy/runtime/Runtime.messages.submit")` when the operation should create a trace/span boundary, and `Effect.fnUntraced` for hot or small wrappers that do not need tracing. Class/object Effect methods that need `this` use `Effect.fn("Service.method")({ self: this }, function*(this: Service, ...args) { ... })`. When a generator needs an explicit return type, annotate it with `Effect.fn.Return<A, E, R>`, not a raw `Effect.Effect<...>` return type. `Effect.fn(...)` may take additional transform functions after the generator body; use those transforms for operation-local error/log/span decoration when they replace a wrapper. Each transform receives the returned `Effect` and the original function arguments; it does not receive the already-computed success value. Do not wrap an `Effect.fn` call in a thin `Effect.gen` solely to add catch, logging, or annotation behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Effect.try`, `Effect.tryPromise`, `Effect.promise`, `Effect.callback`                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Effect`                                                                                                                                                                                                                                                       | Foreign synchronous, Promise, and callback boundaries. Map unknown failures immediately to package tagged errors. Use `Effect.tryPromise` when rejection is an expected domain failure and map it to the typed error channel. Use `Effect.promise` only when rejection is unexpected/defect-like or already impossible at that boundary. `Effect.tryPromise` thunks receive and forward the Effect-provided `AbortSignal` when the host API supports cancellation. `Effect.callback` registrations should declare and forward the provided `AbortSignal` when the host API supports it, and must return a cleanup effect when explicit unsubscribe/cancel is required. Do not leave raw thrown values, rejected promises, host callback errors, or ignored cancellation hidden behind package service methods.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Effect.mapError`, `Effect.tapError`, `Effect.tapErrorTag`, `Layer.tapError`                                                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/Effect`, `effect/Layer`                                                                                                                                                                                                                                       | Required at foreign and package boundaries when host/platform/SQL/schema/process failures need to become package tagged errors or when failures need redacted logging/annotation without changing the error type. Do not widen public service errors to `unknown`, `Error`, or host package errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Effect.sleep`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `effect/Effect`                                                                                                                                                                                                                                                       | Allowed only for one-shot non-policy delays inside an Effect service when the owning spec names the host protocol receipt/deadline being waited on, or for `TestClock`-controlled timing assertions. Retry, backoff, polling, reconciliation cadence, worker draining, and UI/bridge stabilization use `Schedule`, `Clock`, deterministic receipts, or explicit `drain(...)`/acknowledgement APIs; do not put fixed sleeps inside effects that are retried or whose correctness depends on timing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Context.Service` plus `Context.Service.Shape<T>`, `Context.Service.Identifier<T>`, `Service["Service"]`, `Service.context(self)`, `.of`, `.use`, and `.useSync`                                                                                                                                                                                                                                                                                                                                               | `effect/Context`                                                                                                                                                                                                                                                      | Package services and approved data-only port tags. Implementation services use class syntax. Approved data-only port tags use an explicit exported port identifier interface, an explicit `*Service` interface, and `Context.Service<PortIdentifier, PortService>(id)`. The approved sets are `@svvy/core` data-only cross-package ports plus the named package-local host/config tags `ExtensionSourceRootsPort`, `GeneratedPackageRootPort`, `WorkspaceSourceLinkPort`, `PackagedExtensionTemplatesPort`, `SandboxHelperCandidatesPort`, and `HostProcessReferencePort`. Use `Context.Service.Shape<T>`, `Service["Service"]`, `Service.context(self)`, and `.of` only for class-style services. Providers and adapters for approved data-only tags implement the exported `*Service` interface and install plain service objects with `Layer.succeed(Port, service)` or `Layer.effect(Port, makeService)`, not `.of`. Use `Context.Service.Identifier<T>` only when a typed identifier is required by a helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Third-party service identifier adapters                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Context`                                                                                                                                                                                                                                                      | Third-party Effect service identifiers stay inside adapter implementations. Svvy-owned boundaries expose a named v4 `Context.Service`; do not use `Context.GenericTag`, `Context.Tag`, `Effect.Tag`, or `Effect.Service` in svvy service contracts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Layer.effect`, `Layer.sync`, `Layer.succeed`, `Layer.effectContext`, `Layer.syncContext`, `Layer.succeedContext`, `Layer.provide`, `Layer.provideMerge`, `Layer.mergeAll`, `Layer.buildWithScope`                                                                                                                                                                                                                                                                                                             | `effect/Layer`                                                                                                                                                                                                                                                        | Dependency graph construction. Use `Layer.sync` for synchronous service implementations such as app identity, packaged path resolution, and pure config snapshots; use `Layer.effect` when construction itself can fail, acquire resources, or call other services. Use the `*Context` variants only when one acquisition naturally provides multiple services or ports from the same scoped resource; do not use them to hide unrelated service construction in one broad layer. Use `Layer.buildWithScope` only at app/process bootstrap, explicit adapter edges, or named integration/e2e/facade harnesses that deliberately own and close the destination scope; ordinary service/layer tests use `@effect/vitest` `layer(...)` / `it.layer(...)` and test layers. Ordinary app/package composition uses layers, `ManagedRuntime`, and scoped services rather than manually built contexts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Effect.provideService`, `Effect.provideServiceEffect`                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Effect`                                                                                                                                                                                                                                                       | Test-edge and facade-edge service overrides when constructing a full layer would obscure the contract being tested. Use for narrow explicit overrides of one service value/effect in a bounded program. Do not use repeated `provideService` calls as the app dependency graph or as hidden per-request service assembly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Layer.fresh`, `Effect.provide(..., { local: true })`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `effect/Layer`, `effect/Effect`                                                                                                                                                                                                                                       | Explicit test/resource isolation when a layer subtree must not share v4's memo map.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Layer.mock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/Layer`                                                                                                                                                                                                                                                        | Allowed in tests for explicit service and port doubles whose behavior is part of the test. Use it for fake pi adapters, state ports, sandbox hosts, extension sources, and runtime queues instead of hand-assembling ad hoc runtimes or hidden mutable singletons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Layer.effectDiscard` (edge-only exception)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `effect/Layer`                                                                                                                                                                                                                                                        | App/bootstrap or explicit harness construction effects that provide no service. Normal package worker startup uses a named service layer with readiness, drain, and shutdown receipts. Any exception must be finite or fork long-lived work with `Effect.forkScoped`, return promptly, document ownership, and close the owning scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `LayerMap.Service`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `effect/LayerMap`                                                                                                                                                                                                                                                     | Dynamic keyed resources such as workspace runtime scope and surface runtime scope maps. A service subclass exposes static `.layer`, `.layerNoDeps`, `.get(key)`, `.contextEffect(key)`, and `.invalidate(key)` helpers. `.get(key)` returns a `Layer`; it does not by itself prove startup readiness. Readiness-sensitive owners explicitly acquire with `.contextEffect(key)` in the owner scope and treat that acquisition result as the readiness signal. `preloadKeys` / `preload` may eagerly build entries, but svvy does not treat them as the product readiness, ownership, recovery, or subscription-attach contract. Owners prove readiness with owner-scope `.contextEffect(key)` plus a product readiness receipt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Layer.unwrap`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `effect/Layer`                                                                                                                                                                                                                                                        | Dynamic layer selection from Effect/Config only in app bootstrap and named package config/layer factory modules that decode configuration before exposing a stable service layer. Ordinary domain services and per-call code do not use `Layer.unwrap`; they depend on explicit service ports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Scope`, `Scope.make`, `Scope.makeUnsafe`, `Scope.fork`, `Scope.forkUnsafe`, `Scope.provide`, `Scope.close`, `Scope.use`, `Effect.scoped`, `Effect.scopedWith`, `Effect.scope`, `Effect.addFinalizer`, `Scope.addFinalizer`, `Scope.addFinalizerExit`, `Effect.acquireRelease`, `Effect.acquireUseRelease`, `Effect.acquireDisposable`, `Effect.ensuring`, `Effect.onExit`, `Effect.forkChild`, `Effect.forkScoped`, `Effect.forkIn`, `Effect.abortSignal`                                                     | `effect/Scope`, `effect/Effect`                                                                                                                                                                                                                                       | Scoped resource lifetimes and v4 fiber ownership. Use `Effect.scoped` for one workflow; use `Effect.scopedWith(...)` when the workflow needs direct access to the freshly created scope, such as registering finalizers on that scope during scoped acquisition; use layer scopes for service lifetimes; use `Scope.fork(parentScope, finalizerStrategy?)` for manual child scopes that must close with the parent; use explicit `Scope.make` / `Scope.provide` / `Scope.close` only for bridge subscriptions or clients that must outlive one `runPromise`; use `Scope.forkUnsafe` and `Scope.makeUnsafe` only under the stricter synchronous-owner rules below; prefer `Scope.use(scope)(program)` for bounded manual-scope work so finalizers receive the program's real `Exit`. Use `Effect.acquireRelease` for scoped resources whose release is infallible, receives the scope-close `Exit`, and catches/logs/maps close failures before returning; acquisition is uninterruptible by default, so pass `{ interruptible: true }` only when partial acquisition is safe to interrupt. Use `Effect.acquireUseRelease` for one-shot bracketed handles whose release failure belongs to the operation result, `Effect.acquireDisposable` for JavaScript `Disposable` / `AsyncDisposable` handles, `Effect.addFinalizer` for current-scope cleanup that needs the scope-close `Exit` and must be infallible, `Scope.addFinalizer` for concrete-scope cleanup that does not need the close exit, `Scope.addFinalizerExit` for concrete-scope cleanup that needs the close exit, `Effect.onExit` around one effect when cleanup observes that effect's result and may intentionally affect the returned error channel, `Effect.ensuring` for unconditional cleanup around one effect, and `Effect.abortSignal` for host APIs that need a scope-bound `AbortSignal`. Do not use v3 fork names: use `Effect.forkChild` instead of `Effect.fork`, and do not translate daemon-style work to `Effect.forkDetach` inside packages. `Effect.forkScoped` and `Effect.forkIn` are the normal v4 names for scoped worker ownership. `Effect.forkAll` and `Effect.forkWithErrorHandler` were removed; fork effects individually with `forkChild` or higher-level concurrency and observe results with `Fiber.join` / `Fiber.await`. Pass fork options such as `startImmediately` and `uninterruptible` when lifecycle semantics matter. |
| `ManagedRuntime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `effect/ManagedRuntime`                                                                                                                                                                                                                                               | Electrobun RPC, Svelte, browser tools bridge, and other non-Effect framework edges. The only package-root production facade allowance is `@svvy/runtime.createRuntimeFacade(...)`, which runs through the caller-owned runtime and maps terminal `Exit` values with `managedRuntime.runPromiseExit(...)`. Other package facades or bridge runner styles must be named by the owning package spec, exported from an explicit subpath, and covered by boundary tests before use. Bootstrap calls `context()` before exposing facades when startup effects must be active, and shutdown uses `dispose()` / `disposeEffect`. `runFork` is allowed only for explicitly owned edge fibers that return or store a cancellation handle tied to a facade-owned close path; it is not an implicit subscription lifetime or an ordinary bridge-call runner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `PubSub`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/PubSub`                                                                                                                                                                                                                                                       | In-process fanout for package-local notifications where the owning spec names capacity, replay, shutdown, and slow-subscriber behavior. Public `Runtime.events(...)` does not use PubSub as its event authority; it uses the runtime-owned replay ring plus filtered per-subscriber queues.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Stream`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Stream`                                                                                                                                                                                                                                                       | Runtime events, pi turn output, command output, source invalidation, subprocess streams.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Channel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `effect/Channel`                                                                                                                                                                                                                                                      | Package-local stream/protocol machinery only, for framing, encoding/decoding, and backpressure adapters where ordinary `Stream` combinators would obscure the protocol.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Sink`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Sink`                                                                                                                                                                                                                                                         | Finite scoped stream consumption and reduction only. Prefer named runtime services and core-owned state-port methods for product read models, command facts, transcript reconstruction, and durable projections.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Effect.all`, `Effect.forEach`, `Effect.withConcurrency`, `Effect.validate`, `Effect.partition`                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/Effect`                                                                                                                                                                                                                                                       | Bounded parallel work over independent inputs: source scans, model/provider probes, extension readiness checks, generated-package validation, app-log/read-model fanout, and recovery batches. Use explicit concurrency for unbounded or user/workspace-sized collections. `Effect.all` and `Effect.forEach` are fail-fast by default and are appropriate when the first failure should stop the operation. Use `Effect.validate` or `Effect.partition` for finite independent validation where the product needs all diagnostics, such as generated-package source validation, extension manifest validation, model binding validation, or source-library import checks. Do not use collection concurrency for queue claim order, per-surface prompt serialization, transaction internals, or command output ordering.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Effect.timeout`, `Effect.timeoutOption`, `Effect.timeoutOrElse`, `Effect.race`, `Effect.raceFirst`, `Effect.raceAll`, `Effect.raceAllFirst`                                                                                                                                                                                                                                                                                                                                                                   | `effect/Effect`                                                                                                                                                                                                                                                       | Deadlines, user-input timeouts, provider/helper job limits, bridge request deadlines, and host probes. Use `Effect.race` / `Effect.raceAll` for first-success-wins behavior where early failures should be ignored until another candidate succeeds or all candidates fail. Use `Effect.raceFirst` / `Effect.raceAllFirst` for first-completion-wins behavior where an early typed failure is itself the result. Timeouts and races must record which branch won or timed out in command/recovery facts when user-visible behavior depends on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Effect.uninterruptible`, `Effect.uninterruptibleMask`, `Effect.interruptible`, `Effect.onInterrupt`                                                                                                                                                                                                                                                                                                                                                                                                           | `effect/Effect`                                                                                                                                                                                                                                                       | Short critical regions where interruption would corrupt a durable lifecycle boundary, such as queue claim plus lease write, command terminal fact write, recovery lease handoff, or state-finalizer handoff. Use `Effect.uninterruptible` only around the minimal transaction or final write. Use `Effect.uninterruptibleMask` when setup must be protected but a nested host operation, stream drain, subprocess wait, or long-running effect must be restored to interruptible execution with `restore(...)`; `Effect.interruptible` and `restore(...)` restore interruption only inside the protected fiber region and are not cancellation persistence mechanisms. `Effect.onInterrupt` is allowed for scoped cleanup, local diagnostics, or best-effort shutdown logging, but durable cancellation facts must be written by the runtime command/turn lifecycle and recovery paths. Do not wrap pi turns, command execution, source scans, watcher loops, provider calls, or user waits in uninterruptible regions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `Queue`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Queue`                                                                                                                                                                                                                                                        | Process-local wakeups, worker worklists, and command/event backpressure handoffs only. It never represents durable queue rows, command facts, transcript state, request-input rows, app logs, or recovery state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Deferred`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/Deferred`                                                                                                                                                                                                                                                     | Single-use readiness gates, one-shot request/response handoffs, and completion notifications. Do not use it as a reusable lock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `Latch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Latch`                                                                                                                                                                                                                                                        | Reusable in-memory readiness or wakeup gates inside scoped runtime services. Use when a gate can open/close repeatedly. Do not use `Deferred` for reusable readiness. Do not use `Latch` as durable queue state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `Ref`, `SynchronizedRef`, `SubscriptionRef`, `Semaphore`, `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/Ref`, `effect/SynchronizedRef`, `effect/SubscriptionRef`, `effect/Semaphore`, `effect/FiberHandle`, `effect/FiberMap`, `effect/FiberSet`, `effect/ScopedRef`                                                                                                  | Prompt locks, active-turn state, concurrency limits, scoped mutable runtime state, replaceable one-active-fiber lanes, keyed fibers, and replaceable scoped resources. A surface prompt lock is a one-permit `Semaphore` or equivalent synchronized state gate, not a `Deferred`. Use `SubscriptionRef` only for low-cardinality latest-value status where late subscribers need the current value plus future changes, such as live surface, turn, worker, or bridge subscription status inside `@svvy/runtime`; create it with `SubscriptionRef.make`, read snapshots with `SubscriptionRef.get`, expose the change stream with `SubscriptionRef.changes`, and mutate through `SubscriptionRef.set`, `SubscriptionRef.update`, or `SubscriptionRef.modify`. `SubscriptionRef` uses replay-one, unbounded PubSub semantics, so do not use it for high-rate runtime events, command output, queue delivery, durable replay, or backpressured fanout; use explicit `Ref` / `SynchronizedRef` plus bounded `PubSub` or `Queue` for those lanes. Do not expose the underlying pubsub or treat `SubscriptionRef.changes` as durable event history. Do not implement lossless runtime event handoff as `SubscriptionRef.get` followed by `SubscriptionRef.changes`; `changes` is appropriate for low-cardinality latest-value status because it emits the current replay-one value plus future updates, not because it provides durable sequence replay, backpressure, or state-read high-water semantics. Use `FiberHandle` when starting a new job should interrupt/replace the prior job for the same lane. Use `ScopedRef.fromAcquire` when the initial current client/subscription/handle is acquired effectfully; use `ScopedRef.make` only for an already available non-resource value; replace resource-backed values with `ScopedRef.set(acquire)`, which serializes replacement and closes the previous value's scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Schedule`, including `Schedule.recurs`, `Schedule.duration`, `Schedule.during`, `Schedule.spaced`, `Schedule.fixed`, `Schedule.windowed`, `Schedule.cron`, `Schedule.exponential`, `Schedule.jittered`, `Schedule.modifyDelay`, `Schedule.addDelay`, `Schedule.forever`, `Schedule.take`, `Schedule.either`, `Schedule.both`, `Schedule.bothLeft`, `Schedule.bothRight`, `Schedule.andThen`, `Schedule.setInputType`, `Schedule.while`, `Schedule.passthrough`, `Schedule.tapInput`, and `Schedule.tapOutput` | `effect/Schedule`                                                                                                                                                                                                                                                     | Retry, polling, debounce, reconciliation, recovery cadence, request-input timeout recovery, and long-lived background cadence. `tapInput` / `tapOutput` are allowed for package-owned retry/recovery observability when they publish typed logs or metrics without changing the retry value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Duration`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/Duration`                                                                                                                                                                                                                                                     | Named durations for sleeps, timeouts, retries, kill deadlines, leases, debounce windows, and test adjustments. Public persisted contracts still store ISO timestamps or explicit millisecond fields; internal Effect code prefers `Duration` values or string duration literals over anonymous numeric milliseconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Clock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Clock`                                                                                                                                                                                                                                                        | `DateTime.now` produces persisted instants and ISO timestamps. Use `Clock.currentTimeMillis` / `Clock.currentTimeNanos` for elapsed-time, TTL, and lease arithmetic inside Effect programs. Avoid host time reads on runtime paths so `TestClock` can drive timing tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `TestClock`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `effect/testing`                                                                                                                                                                                                                                                      | Virtual time in tests for sleeps, retry schedules, queue drains, debounce, leases, and timeouts. Prefer `TestClock.adjust` / `TestClock.setTime` over broad sleeps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DateTime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/DateTime`                                                                                                                                                                                                                                                     | Time inside Effect programs. Do not use `Date.now()`, `new Date()`, `DateTime.nowUnsafe()`, `clock.currentTimeMillisUnsafe()`, or `clock.currentTimeNanosUnsafe()` for runtime logic. Use Effect `Clock` / `DateTime` effects so runtime tests can use `TestClock`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Config`, `ConfigProvider`, `Redacted`, `Config.redacted`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `effect/Config`, `effect/ConfigProvider`, `effect/Redacted`                                                                                                                                                                                                           | Required at process/config edges and tests for configuration reads, platform env snapshots, and redacted host secrets. Domain services receive app-owned settings/secrets through explicit services or state ports; do not read global env directly. Tests provide deterministic object config with `ConfigProvider.fromUnknown(...)` and env mapping tests with `ConfigProvider.fromEnv({ env })`. Only unwrap `Redacted.value(...)` at the trusted invocation boundary that requires the secret.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `Context.Reference`, `References`                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `effect/Context`, `effect/References`                                                                                                                                                                                                                                 | Fiber-local/default runtime settings such as current concurrency, log level, scheduler, tracing flags, and explicit app-owned bootstrap references. Do not use removed `FiberRef` / `FiberRefs`; use ordinary services for durable product settings and `Context.Reference` only for scoped runtime defaults or a dedicated host-process reference module. Current time zone uses `DateTime.CurrentTimeZone` and its layers/helpers, not a custom `Context.Reference`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `Data`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Data`                                                                                                                                                                                                                                                         | Package-internal tagged errors that are mapped before crossing package, RPC, persistence, or generated-declaration boundaries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Exit`, `Cause`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/Exit`, `effect/Cause`                                                                                                                                                                                                                                         | Bridge, process, turn, command, and test boundaries that must distinguish success, typed failure, defect, and interruption.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Option`, `Result`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `effect/Option`, `effect/Result`                                                                                                                                                                                                                                      | Effect-native package internals and service APIs where absence or pure classification is clearer than nullable values or exceptions. `Option` is allowed for Effect service lookups such as optional rows; `Result` is allowed for pure parsing/classification helpers that are immediately folded or converted. Public RPC/read-model/persisted payloads encode absence as `null` or a discriminated shape, and public failures stay typed Effect errors or tagged error payloads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Match`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `effect/Match`                                                                                                                                                                                                                                                        | Exhaustive handling for closed tagged product unions, such as `RuntimeEffectRequest` dispatch, `ExtensionExecutionPlan` execution, `RuntimeEvent` branch handling, package tagged error mapping, and foreign-error-to-core-error conversion. Use `Match.valueTags`, `Match.typeTags`, `Match.discriminatorsExhaustive`, or `Match.tagsExhaustive` where exhaustiveness improves reliability. A direct `switch` is equally acceptable for small closed unions when it has no broad `default` branch and TypeScript proves exhaustiveness with a `never` assignment. Do not introduce `Match` for open-ended business branching or where a direct small `switch` is clearer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Filter`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Filter`                                                                                                                                                                                                                                                       | Approved only for v4 partial recovery predicates passed to `Effect.catchFilter(...)` or `Effect.catchCauseFilter(...)`, and for package-private predicate adapters such as `Filter.fromPredicate(...)`. `Filter` values are process-local code helpers; they are not public contracts, persisted payloads, generated declarations, runtime-event payloads, app-log fields, or extension model-facing output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `Logger`, `LogLevel`, `Logger.batched`, `Logger.layer`, `Logger.tracerLogger`, `References.MinimumLogLevel`, `References.CurrentLogLevel`, `References.CurrentLogAnnotations`, `References.CurrentLogSpans`, `References.UnhandledLogLevel`                                                                                                                                                                                                                                                                    | `effect/Logger`, `effect/LogLevel`, `effect/References`                                                                                                                                                                                                               | App bootstrap logging layers, package diagnostics, redacted command logs, scoped log annotations/spans, and bounded Effect-log-to-app-log bridge layers. Product app-log rows still live in `@svvy/state`; Effect logs are observability output, not durable product facts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `Metric`, `Tracer`, `Effect.log*`, `Effect.withSpan`, `Effect.annotateCurrentSpan`, `Effect.annotateSpans`, `Effect.annotateLogs`, `Effect.annotateLogsScoped`, `Effect.withLogSpan`, `Effect.trackDuration`, `Layer.withSpan`, `Stream.withSpan`                                                                                                                                                                                                                                                              | `effect/Metric`, `effect/Tracer`, `effect/Effect`, `effect/Layer`, `effect/Stream`                                                                                                                                                                                    | Service-boundary observability for queues, turns, commands, provider/pi-adapter calls, source invalidation, recovery, stream bridges, and generated package work. `Tracer` is for span context and optional exporter integration only. Durable product facts still live in `@svvy/state`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `Schema` plus `Schema.Struct`, `Schema.TaggedStruct`, `Schema.Class`, `Schema.TaggedClass`, `Schema.brand`, `Schema.Redacted`, `Schema.RedactedFromValue`                                                                                                                                                                                                                                                                                                                                                      | `effect/Schema`                                                                                                                                                                                                                                                       | Required for public contracts, persisted payloads, IPC/RPC payloads, command facts, generated package metadata, runtime event unions, tagged read-model variants, class-backed contracts when methods/default constructors are useful, branded ids, and secret-shaped payload fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `Struct.pick`, `Struct.omit`, `Struct.map`, `Struct.assign`, `Struct.mapPick`, `Struct.mapOmit`                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/Struct`                                                                                                                                                                                                                                                       | Required for current v4 Schema field-shape modeling through `schema.mapFields(...)`, including the allowed replacements for rejected v3 `pick`, `omit`, `partial`, `partialWith`, `required(schema)`, and `extend(structB)` forms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `Schema.TaggedErrorClass`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | `effect/Schema`                                                                                                                                                                                                                                                       | Typed domain errors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Data.TaggedError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `effect/Data`                                                                                                                                                                                                                                                         | Allowed only for package-local implementation errors that never cross a package, RPC, persistence, runtime-event, read-model, command-fact, app-log, generated-package, bridge, or transcript boundary. Boundary code maps these to public `@svvy/core` `Schema.TaggedErrorClass` errors or stable bridge payloads before returning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `SchemaIssue`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `effect/SchemaIssue`                                                                                                                                                                                                                                                  | Stable schema decode/encode issue formatting for typed boundary errors and app logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `Crypto`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Crypto`                                                                                                                                                                                                                                                       | Required for security-sensitive random bytes, UUIDs, digest/hashing, source/artifact fingerprints, generated-package facts, and app-owned cryptographic helpers. Package services depend on `Crypto.Crypto` when they need secure values. The live Bun/Electrobun provider is supplied only by app/bootstrap through `layerRuntimeBunPlatform` and installed-verified `BunCrypto.layer`. Do not use `Random`, `Math.random()`, `node:crypto`, WebCrypto globals, or Bun globals directly for secrets, auth tokens, secure ids, salts, hashes, digests, or persisted fingerprints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Random`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `effect/Random`                                                                                                                                                                                                                                                       | Allowed only for non-security randomness such as jittered schedules, randomized test data, deterministic tests with an explicitly provided/seeded random service, and sampling where no persisted identity or authorization semantics depend on the result. The default `Random` implementation is not cryptographically secure. Do not use `Random` for persisted ids, secrets, credentials, auth/session tokens, cryptographic salts, digests, hashes, source/artifact fingerprints, generated-package fingerprints, or user-visible uniqueness guarantees. Package runtime behavior must not call `Math.random()` directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `FileSystem`, `Path`, `PlatformError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `effect/FileSystem`, `effect/Path`, `effect/PlatformError`                                                                                                                                                                                                            | File-backed source, artifact, generated package, and sandbox helper boundaries when using Effect platform services.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ChildProcess.Command` type, `ChildProcess.make(...)`, and `ChildProcessSpawner.ChildProcessSpawner` service                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/unstable/process`                                                                                                                                                                                                                                             | Required for runtime-owned Shell/`svvyx`/Apply Patch/`execute_typescript` command sessions, sandbox helper launch, and extension-owned bounded helper work such as CLI requirement probes, generated instruction/source builds, and generated-package validation. Agent-invoked prompt-only CLI usage still enters through Shell `exec_command`; prompt-only extensions do not own durable subprocess sessions. Services construct immutable command descriptions with `ChildProcess.make(...)` and depend on the platform spawner implementation provided by host/app layers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `Command`, `Argument`, `Flag`, `GlobalFlag`, `CliError`; `CliOutput`, `HelpDoc`, `Param`, and `Primitive` only inside app-owned CLI modules/tests                                                                                                                                                                                                                                                                                                                                                              | `effect/unstable/cli/*`                                                                                                                                                                                                                                               | Allowed only for app-owned process entrypoint parsing such as `svvyx`. `CliError` may be mapped at the parser boundary. `CliOutput` and `HelpDoc` may be used only to render or test help output. `Param` and `Primitive` are CLI construction internals, not product contracts. `Prompt`, `Completions`, autosuggest, and interactive CLI UI remain banned from shipped runtime behavior.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `Ndjson`, `Msgpack` encoding channels                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `effect/unstable/encoding/Ndjson`, `effect/unstable/encoding/Msgpack`                                                                                                                                                                                                 | Allowed only inside a package-owned protocol adapter named by a package spec, for a schema-backed line or binary stream with exact request/event schemas. Candidate uses are pi-adapter stdio-style protocol adapters and the runtime-owned workflow task-agent bridge if that bridge chooses this framing. Encoded streams are not durable event history, transcript state, read models, command facts, or app logs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `HttpClient`, `HttpClientRequest`, `HttpClientResponse`, `FetchHttpClient`, and selected platform client layer                                                                                                                                                                                                                                                                                                                                                                                                 | `effect/unstable/http/HttpClient`, `effect/unstable/http/HttpClientRequest`, `effect/unstable/http/HttpClientResponse`, `effect/unstable/http/FetchHttpClient`                                                                                                        | Candidate modules for service-owned provider/OAuth health, model metadata probes, optional OTLP export, and scoped helper protocols after an owner/spec adoption record lands. Reusable services would depend on `HttpClient.HttpClient`; app/bootstrap would provide an app-owned network-policy HTTP layer backed by an adopted raw client layer such as `FetchHttpClient.layer` with an explicit `FetchHttpClient.Fetch` reference or a fake raw client layer. `@effect/platform-bun/BunHttpClient` and `NodeHttpClient.layer*` remain unadopted until their own package/spec row and boundary allowlist name them. Raw platform HTTP layers are private to that policy wrapper and wrapper tests. Do not implement native `svvy` web-search or web-fetch behavior with `HttpClient`; Web remains the prompt-only TinyFish CLI path unless a separate product spec adopts a native web extension.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `HttpServer`, `HttpRouter`, selected platform server layer                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/unstable/http/HttpServer`, `effect/unstable/http/HttpRouter`                                                                                                                                                                                                  | Not adopted for the shipped workflow task-agent bridge. The shipped bridge transport is the app-bootstrap Bun loopback adapter named in `runtime.spec.md`. Effect HTTP server modules are outside the current contract. Adopting them requires a spec change that names the exact bridge layer, scope owner, routes, host platform layer, readiness gate, shutdown path, and package-boundary tests. They are never a desktop bridge replacement, generic app RPC surface, generated HTTP client surface, Scalar/OpenAPI docs surface, Shell access path, settings API, or workflow-control API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Bun platform modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `@effect/platform-bun/BunServices`, `@effect/platform-bun/BunChildProcessSpawner`, `@effect/platform-bun/BunHttpClient`, `@effect/platform-bun/BunHttpServer`, `@effect/platform-bun/BunFileSystem`, `@effect/platform-bun/BunPath`, `@effect/platform-bun/BunCrypto` | `BunFileSystem.layer`, `BunPath.layer`, and `BunCrypto.layer` are adopted only through `@svvy/runtime/bootstrap` `layerRuntimeBunPlatform`. Other Bun platform modules remain reference-only until an owning package/spec row and boundary allowlist adopt them. Reusable packages depend on abstract Effect services, not Bun modules.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `SqlClient`, `Migrator`, `SqlError`, `SqlSchema`, and package-private `SqlConnection`                                                                                                                                                                                                                                                                                                                                                                                                                          | `effect/unstable/sql/SqlClient`, `effect/unstable/sql/SqlConnection`, `effect/unstable/sql/Migrator`, `effect/unstable/sql/SqlError`, `effect/unstable/sql/SqlSchema`                                                                                                 | Not adopted by the active package architecture. `@svvy/state` owns SQLite product persistence through package-private repositories and must not import these modules. If the PRD and state package spec adopt Effect SQL, state repository code may depend on `SqlClient` and `SqlSchema`; `SqlConnection` remains a low-level driver contract allowed only inside package-private SQL adapter implementation or driver-integration tests, never as a repository dependency or public state layer output. The live adapter package name, installed version, manifest entries, lockfile entries, setup layer, migration layer, and package-boundary checks must land as one coherent adoption record before production code imports these modules. Only the live adapter may import the Bun SQLite implementation. `SqlSchema` helpers encode request schemas and decode row schemas at repository boundaries. Do not use `SqlModel`, `SqlResolver`, or SQL-backed `RequestResolver` helpers for product repositories; `@svvy/state` owns explicit repositories, transaction boundaries, safe integer policy, terminal fact immutability, and after-commit invalidations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `Request` and `RequestResolver`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/Request`, `effect/RequestResolver`                                                                                                                                                                                                                            | No current owner; conditional, owner-record required. They may be introduced only after the PRD and owning package spec name a batchable external or process-local lookup, owner, batch key, backend, ordering/latency tolerance, cache/invalidation behavior, entry completion guarantee, `preCheck` false behavior, delay/batch-size limits, whether `RequestResolver.asCache` / `RequestResolver.withCache` is allowed, resolver span naming/linking, and tests. Do not use `Request` / `RequestResolver`, `RequestResolver.withCache`, or resolver delay knobs for `@svvy/state` read models, SQLite selectors, queue claims, source invalidation, runtime events, app logs, extension implementation records, or runtime facades. Acceptable candidate domains are non-authoritative probes such as provider/model metadata or CLI requirement probes only after their owning spec is updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Cache`, `Effect.cached`, `Effect.cachedWithTTL`, `Effect.cachedInvalidateWithTTL`                                                                                                                                                                                                                                                                                                                                                                                                                             | `effect/Cache`, `effect/Effect`                                                                                                                                                                                                                                       | Allowed only for bounded process-local memoization of non-authoritative external probes, such as provider/model metadata, CLI requirement probes, or host capability probes, with explicit capacity, TTL, invalidation ownership, and `requireServicesAt` ownership. Default construction-time service capture is allowed only when the cache is owned by the service/layer that owns those lookup dependencies. Use `requireServicesAt: "lookup"` when lookup services must be supplied by each caller scope. Use `Effect.cached*` helpers only inside an owner service when the cached effect's scope, TTL, and invalidation trigger are part of that service contract. Do not cache source fingerprints, generated-context readiness, build readiness, state read models, queue or command facts, app logs, or recovery state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `Resource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `effect/Resource`                                                                                                                                                                                                                                                     | Allowed only for scoped, refreshable, process-local values whose latest acquisition result is safe to reread, such as host capability probes or provider metadata probes. Use `Resource.manual` when refresh is triggered by an explicit owner action, and use `Resource.auto` only when the owner names the refresh schedule and shutdown scope. `Resource` values are created inside an owner scope. `Resource.get` may fail with the stored acquisition error. `Resource.refresh` uses `ScopedRef.set`, so refresh closes the previous value's scope before acquiring the replacement; if acquisition fails, the previous result may still be readable but previous scoped resources have been finalized. Use it only for reread-safe data/probes, not no-gap live clients. `Resource` is not durable product state and must not replace generated-context readiness, source fingerprints, build readiness, surface stale state, read models, command facts, app logs, or recovery records.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `ScopedCache`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `effect/ScopedCache`                                                                                                                                                                                                                                                  | Allowed only for bounded scoped-resource caches whose package spec names the cached resource, capacity, expiry/eviction policy, invalidation owner, release semantics, and `requireServicesAt` ownership, such as short-lived protocol clients, host capability clients, or package-owned helper handles. Default construction-time service capture is allowed only when the cache is owned by the service/layer that owns those lookup dependencies. Use `requireServicesAt: "lookup"` when lookup services must be supplied by each caller scope. Prefer `LayerMap.Service` for keyed service resources that are part of the package architecture. Do not use `ScopedCache` for durable facts, generated-context readiness, source fingerprints, queue rows, command facts, read models, app logs, or transcript reconstruction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `RcMap`, `RcRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `effect/RcMap`, `effect/RcRef`                                                                                                                                                                                                                                        | Allowed only for package-internal reference-counted scoped resource sharing when a package spec names the resource and why it should be acquired lazily and released after the last borrowing scope closes, with optional bounded idle TTL. Use `RcMap` for key-indexed resources and `RcRef` for one resource. Prefer `LayerMap.Service` for workspace/surface runtime scope maps and exported service lifecycles. Do not use reference-counted resources to model product ownership, queue claims, active turns, read models, or durable session state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `Pool`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `effect/Pool`                                                                                                                                                                                                                                                         | Allowed only for bounded pools of scoped reusable resources such as HTTP/provider clients, helper subprocess protocol clients, or other host resources where pooling is a measured product need. The pool owner chooses `Pool.make({ size })` for fixed-size pools or `Pool.makeWithTTL` / `Pool.makeWithStrategy` with `min` / `max`, and names per-item `concurrency`, `targetUtilization`, TTL/strategy, `Pool.invalidate(item)` behavior, and scope shutdown. Pool release order is not a product-observable ordering contract, so do not rely on it for ordered shutdown, durable lease release, command/session finalization, or immediate credential revocation. Pool adoption tests cover max/concurrency bounds, invalidation, scope shutdown, and failure behavior. Do not pool SQLite transactions, queue workers, prompt turns, command sessions, pi sessions, or renderer subscriptions unless a package spec names that concrete pooled resource and its product bound.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `JsonPatch`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `effect/JsonPatch`                                                                                                                                                                                                                                                    | Allowed only when a public contract explicitly defines deterministic JSON Patch operations over schema-backed JSON values. Do not use JSON Patch as the default read-model, transcript, runtime-event, command-fact, or app-log update format. It is not the code `apply_patch` model and not a substitute for typed runtime events or command facts. Any JSON Patch payload must be schema-validated at the boundary and refetchable from the owning read model.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `JsonSchema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `effect/JsonSchema`                                                                                                                                                                                                                                                   | Allowed only in generators/adapters that normalize or convert JSON Schema/OpenAPI documents for source contracts. Product APIs remain source-of-truth Effect Schema contracts in `@svvy/core` or package-owned schemas; do not hand-author parallel JSON Schema contracts when an Effect Schema contract can generate the required declaration/tool/schema block.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `ChannelSchema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `effect/ChannelSchema`                                                                                                                                                                                                                                                | Allowed only inside package-owned protocol/framing adapters when a `Channel` boundary must encode or decode chunks using existing `Schema` contracts. Prefer format-specific helpers such as `Ndjson.decodeSchema*` / `Msgpack.decodeSchema*` when those fit. Schema failures are mapped at the protocol boundary. `ChannelSchema` is not durable event history, app-log storage, read-model persistence, command facts, transcript reconstruction, or generated-package metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `HttpClientError`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `effect/unstable/http/HttpClientError`                                                                                                                                                                                                                                | Allowed only at HTTP boundary adapters that need to classify transport, status, response, or decoding failures before mapping them to package tagged errors with redacted diagnostics. HTTP callers may use `HttpClientError.isHttpClientError(...)` and the typed `response` / `reason` fields for classification. Do not expose `HttpClientError` through public package DTOs, command facts, app logs, renderer bridges, or extension model-facing output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `@effect/vitest`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `@effect/vitest`                                                                                                                                                                                                                                                      | Adopted for the Effect test lane. Effect service/layer tests that need the Effect test runtime, `TestClock`, scoped layers, shared test layers, `it.effect.each(...)`, or `it.effect.prop(...)` live in `*.effect.test.ts`, import from `@effect/vitest`, and run through `bun run test:effect`. Pure schema and contract tests may remain in the Bun unit suite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Package code must use direct Effect v4 module imports as a `svvy` package convention. The import
examples below are reference patterns, not a blanket package allow-list:

- always-adopted imports are the stable `effect/*` modules required by that package's public
  services, schemas, layers, streams, queues, metrics, logging, and tests
- package-specific imports require an owning package spec that names the concrete product reason,
  resource, policy, lifetime, and test coverage before they are used
- platform, SQL, HTTP, process, unstable CLI, encoding, cache/resource/pool/reference-counting, and
  transactional-memory imports remain conditional examples unless an owner package explicitly adopts
  them

Do not copy this full block into a package file. Import only the modules used by that file:

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
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaRepresentation from "effect/SchemaRepresentation";
import * as SchemaTransformation from "effect/SchemaTransformation";
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
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
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
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeStream from "@effect/platform-node/NodeStream";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
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
dated compatibility audit. A package manifest pin is not enough when the lockfile resolves a
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
production dependency. If the slice upgrades `effect` itself, it upgrades every `@svvy/*` Effect
dependency and every adopted `@effect/*` package as one manifest/lockfile change before using APIs
that only exist in the newer reference snapshot.

`ChildProcessSpawner` adoption is abstract-service adoption, not Node service adoption. Every
shipped command/subprocess owner that requires it names the Bun/Electrobun provider layer, owner
package, environment policy, sandbox-helper launch contract, fake test layer, and package-boundary
import globs before using live subprocesses. NodeServices examples in local Effect references are
reference-only unless a shipped Node host is explicitly added.

Platform packages are added only where used:

- `@effect/platform-bun` is currently adopted for Bun/Electrobun bootstrap service layers, not for
  domain service imports. The current product export is `@svvy/runtime/bootstrap`
  `layerRuntimeBunPlatform`, implemented from `BunFileSystem.layer`, `BunPath.layer`, and
  `BunCrypto.layer`, and it provides only the abstract `FileSystem.FileSystem`, `Path.Path`, and
  `Crypto.Crypto` services. Additional Bun
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
- `@effect/platform-node` is optional for Node-only scripts or tests and is not a shipped desktop
  runtime dependency unless a shipped Node host is explicitly introduced. Node-only scripts/tests or
  an explicitly introduced Node host prefer narrow layers such as `NodeFileSystem.layer`,
  `NodePath.layer`, `NodeChildProcessSpawner.layer`, `NodeHttpClient.layerFetch`,
  `NodeHttpClient.layerUndici`, `NodeHttpClient.layerNodeHttp`, and `NodeHttpServer.layer` unless
  the process edge intentionally needs the full `NodeServices.layer`.

Reusable packages that merely require `FileSystem`, `Path`, `ChildProcessSpawner`, `HttpClient`, or
`SqlClient` import Effect service modules and leave those requirements in their layer types. They do
not depend on `@effect/platform-bun` or `@effect/platform-node` unless they are the host/bootstrap
package, a package-specific live adapter, or a test harness intentionally providing real host
layers. The shipped Electrobun/Bun app provides the adopted Bun platform services at app bootstrap
through `layerRuntimeBunPlatform`; Node platform layers remain script/test-only unless a shipped Node
host is added.

Bun app-edge production modules under `src/bun/**` may import only the adopted Effect modules
required to adapt package services to the current app bootstrap edge: `effect/Effect`,
`effect/Exit`, `effect/Cause`, `effect/Schema`, `effect/Scope`, `effect/Layer`, and
`effect/ManagedRuntime`. `effect/Layer` and `effect/ManagedRuntime` remain allowed there only for
the app-owned bootstrap/facade boundary that composes package layers and constructs or consumes the
single app runtime. App-edge production code must not import optional Effect modules, unstable
Effect modules, platform packages, SQL packages, Effect `Runtime`, or broad service-layer helpers
unless this spec and the owning package spec add an adoption record and the package-boundary gate
names the exact file glob.

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
it is not currently adopted by svvy product code. It does not provide HTTP. If HTTP is adopted, app
bootstrap provides it explicitly through the app-owned network-policy `HttpClient` layer backed by
the `@effect/platform-bun/BunHttpClient` fetch-backed export,
`effect/unstable/http/FetchHttpClient.layer`, or another raw host client. Reusable packages depend
on the guarded `HttpClient.HttpClient`; they do not assume a platform service bundle includes HTTP
and do not receive raw platform HTTP layers.

Optional Effect modules require an adoption record before production use. The record lives in the
owning package spec, not in an implementation comment. It names the Effect module, owner package,
service that exposes the behavior, exact use case, lifetime/scope, capacity or TTL when applicable,
invalidation/release owner, failure behavior, deterministic test layer, and package-boundary check.
Without that record, production code must not introduce `Request`, `RequestResolver`,
`RequestResolver.withCache`, `RequestResolver.asCache`, `RequestResolver.persisted`, `Cache`,
`ScopedCache`, `Resource`, `Pool`,
`RcMap`, `RcRef`, removed or absent reloadable-style APIs from older Effect versions,
`JsonPatch`, `HttpServer`, unstable encoders, or any other Effect module that creates
a new product behavior surface rather than a direct dependency/lifetime primitive. This is an
adoption gate, not a blanket ban: the module is acceptable only when the product reason and contract
are concrete.
`effect/JsonSchema` is already adopted for schema-emitter code that normalizes
`Schema.toJsonSchemaDocument(...)` output for native-tool schemas, `svvyx` command schemas, and
agent-facing declaration blocks under the target policy in the schema section below. Any other
production `JsonSchema` use still needs an owning package record.

t3code may be cited for application, lint, bridge, and test patterns only. It is not product
authority for svvy public contract style, generated schemas, package-boundary declarations, error
class choice, or DTO ownership. When t3code examples use `Data.TaggedError` or product topology
that differs from svvy, svvy keeps the schema-backed `Schema.TaggedErrorClass` and
package-boundary rules in this spec.

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
  `Resource`, `RcMap`, `RcRef`, or `LayerMap`. Future cached provider clients must be keyed by
  provider id plus credential version and must interrupt active borrows on revoke or secret
  replacement when stale credential use is unsafe.
- Generated context fingerprints, readiness, stale surface state, generated-context bindings,
  generated-package facts, and read-model invalidations are product facts. Do not model them with
  `Cache`, `Resource`, `RequestResolver`, `RcMap`, or `RcRef`. File-backed aggregate caches are
  product-owned generated-output caches with manifests and state reconciliation, not Effect caches.
- Workspace, surface, and workflow task-attempt live runtimes use `LayerMap.Service` only through
  runtime-owned owner scopes. `RcMap` and `RcRef` are not alternate runtime registries.
- Extension registry reads, actor binding resolution, generated context builds, and readiness
  projection remain direct operations unless the extension spec names a specific cache owner and
  invalidation source. CLI requirement probes may use caching only after the owning package spec adds
  an adoption record.
- Host capability probes are direct uncached operations unless a package spec adds a resource row.
  Sandbox helper resolution, pi runtime path resolution, provider/model metadata reads, extension
  CLI requirement probes, platform capability checks, and packaged asset lookup are not
  cache/resource owners by default.
- Renderer warm read-model caches are UI-only memory. They are invalidated and refetched from
  `@svvy/state` after runtime notifications and are not Effect `Cache` entries.
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
  `@svvy/state` rows, and live notification fanout remains `@svvy/runtime` scoped PubSub/Stream
  machinery with state/read-model rebaseline.
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
- Removed or absent reloadable-style APIs from older Effect versions are not part of the package
  architecture. Use `Resource`, `ScopedRef`, `RcRef`, `RcMap`, or `LayerMap` only when the owning
  package spec names the concrete scoped resource and invalidation owner.
- `JsonPatch` as code editing, file patching, or transcript persistence: code/file edits use the
  Apply Patch extension and command facts; transcript and read-model state remains typed product
  state. JSON Patch may appear only in a schema-backed public payload that intentionally defines JSON
  Patch as its patch format and remains refetchable from the owning read model.
- `effect/unstable/cli` as a new agent-facing command architecture: app-owned binaries may use it,
  but agents continue to use explicit native tools, prompt-only official CLIs through Shell,
  `svvyx` command contracts, and generated actor-specific declarations.
- `effect/unstable/cli/Prompt`, autosuggest flows, shell completions, or interactive CLI UI in
  shipped runtime behavior. User interaction belongs to Electrobun UI, command palette, Shell
  commands, pi-backed surfaces, and `request_user_input`; do not create a second readline/TUI loop.
- `effect/Terminal`, `effect/Stdio`, and `effect/Console` as an interactive runtime, shell UI,
  transcript, or command projection architecture. App-owned CLI entrypoints may use `Stdio` or
  `Terminal` at the process edge, and tests may use test layers. Product runtime command I/O flows
  through `ChildProcessHandle` streams, command facts, runtime events, and app logs.

Effect CLI adoption is limited to process entrypoint parsing for app-owned binaries such as the
packaged `svvyx` CLI. Those entrypoints may run the v4 `Command.run(command, config)` /
`Command.run(config)(command)` process-edge helper with the required process-edge environment,
including `Terminal` and `Stdio`, then translate the parsed command into the single approved
extension/runtime dispatch seam for that subcommand. Internal `@svvy/runtime` and `@svvy/extensions`
services do not depend on `Command.Environment`, `Terminal`, `Stdio`, or `Console`; they receive
typed command plans, runtime effect requests, or service inputs from the entrypoint. CLI entrypoints
must not import state repositories, create `ManagedRuntime`s, call runtime internals directly, or
expose alternate runtime/state command surfaces.

CLI entrypoints use the v4 CLI pattern directly: define flags with names, aliases, descriptions,
and examples in the app-owned command module; compose subcommands explicitly; yield parent command
state only when subcommands need it; call `Command.run(command, { version })` or
`Command.run({ version })(command)` according to the local v4 API, with the command name supplied by
`Command.make(...)`; provide the full
`Command.Environment` only at the binary edge; and launch with `NodeRuntime.runMain` or the
host-equivalent runtime main function after the exact host platform layer is adopted.
`Command.run(...)` requires `FileSystem`, `Path`, `Terminal`, `ChildProcessSpawner`, and `Stdio`;
Node CLI scripts typically provide that with `NodeServices.layer`, while Bun/Electrobun binaries
use an explicitly adopted host-equivalent Bun layer. At this spec revision, svvy has adopted only
Bun file/path/crypto platform services (`BunFileSystem.layer`, `BunPath.layer`,
`BunCrypto.layer`), so CLI entrypoints may not assume `BunServices.layer`, terminal, stdio, or
process-spawner layers exist in the product graph. CLI parsing modules do not become
agent-facing APIs, product runtime services, or a replacement for generated native-tool/schema
contracts.

## Service And Layer Rules

- Every service identifier string starts with the package name and service area/path, such as
  `"@svvy/runtime/queue/QueueDispatcher"` or
  `"@svvy/core/RuntimeQueueStatePort"`. Every svvy-owned `Context.Service`,
  `Context.Reference`, and `LayerMap.Service` identifier string is globally unique, stable after
  merge, and covered by package-boundary checks that reject duplicate identifier strings. Reusing an
  identifier for unrelated services is invalid because Effect stores services by that string key.
- Svvy-owned services use v4 `Context.Service`, not `Context.Tag`, `Context.GenericTag`,
  `Effect.Tag`, or `Effect.Service`. Third-party service identifiers stay behind adapter
  implementations; any dependency that crosses a svvy package boundary is exposed as a named svvy
  `Context.Service`.
- Svvy-owned `Context.Reference` values use the v4 direct constructor form:

  ```ts
  import * as Context from "effect/Context";

  export const CurrentLogMode = Context.Reference<"quiet" | "normal" | "debug">(
    "@svvy/runtime/CurrentLogMode",
    { defaultValue: () => "normal" },
  );
  ```

  Do not use the removed v3-style `Context.Reference<Self>()(id, options)` form in svvy-owned
  code. `Context.Reference` defaults are cached and shared for contexts that do not override them.
  Svvy-owned references use immutable defaults, or provide fresh mutable values through an
  owner/test layer. Do not rely on `defaultValue` to create per-context mutable state.

- Class-style service contract modules are small. They export the `Context.Service` class, service
  shape aliases derived from that class, public input/output types when those are not already in
  `@svvy/core`, and public package error types. Approved data-only port tag modules instead export
  the explicit port identifier interface, the explicit `*Service` interface, and the function-syntax
  `Context.Service<PortIdentifier, PortService>(id)` tag. Live implementation modules build
  implementations with `Layer.effect`, `Layer.succeed`, `Layer.sync`, or layer factories. Facade
  modules adapt a caller-owned `ManagedRuntime`. Package entrypoints export approved service
  contracts, layer factories, and facade factories; they do not hide package boundaries inside one
  root layer.
- Svvy-owned implementation services use class-style `Context.Service<Self, Shape>()(id)` unless
  the service is an approved data-only port tag with no implementation class. A class service
  implementation returned from `Layer.effect(...)`, `Layer.sync(...)`, or a `make` constructor
  returns `Service.of({ ... })`, not an unchecked object literal, so TypeScript checks the
  implementation against the declared service shape. The service key association is provided by
  `Layer.effect(Service, ...)`, `Layer.succeed(Service, ...)`, or `Context.make(Service, ...)`;
  `.of` is not a runtime branding mechanism. Export class-service shapes as `Service["Service"]`
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
  package spec names the tag and the package-boundary tests ledger it. The approved package-local
  approved tags are:
  - `@svvy/extensions/ExtensionSourceRootsPort`
  - `@svvy/extensions/GeneratedPackageRootPort`
  - `@svvy/extensions/WorkspaceSourceLinkPort`
  - `@svvy/extensions/PackagedExtensionTemplatesPort`
  - `@svvy/sandbox/SandboxHelperCandidatesPort`
  - `@svvy/sandbox/HostProcessReferencePort`

  These tags are consumed only inside their owning package, are implemented by app/bootstrap host
  layers, have no behavior-bearing implementation class, and expose one explicit `*Service`
  interface. If any other package needs one of these contracts, promote the contract to
  `@svvy/core` in the same change. Runtime post-commit host seams, `RuntimeLayerConfigService`,
  `RuntimeStartupReadiness`, `RuntimeShutdownPreparation`, `RuntimeEventBus`,
  `RuntimeSourceInvalidationCoordinator`, `Extensions`, `Sandbox`, `PiAdapter`, state facades, and
  state stores are not data-only tags and remain class-style services.

- Service methods are normally accessed by yielding the service in `Effect.gen`; use
  `Service.use(...)` only for narrow one-line edge, test, or facade helpers and
  `Service.useSync(...)` only for pure synchronous accessors. Multi-step service methods yield the
  service in `Effect.gen` so requirements remain visible. Do not rely on v3 static accessor proxies,
  and do not use `Service.use` in a way that hides important service requirements from multi-step
  programs.
- Use `Effect.serviceOption(Service)` only at explicit optional adapter/bootstrap seams, such as
  optional host backends or test-installed integrations. Domain services keep required dependencies
  in their environment instead of probing optional services; optional lookup maps absence into an
  intentional fallback or typed product capability result.
- Reusable Effect-returning functions use named `Effect.fn("Package.Area.operation")(...)` when the
  call is a service, repository, worker, handler, bridge, command, or other observability boundary.
  Use `Effect.fnUntraced` for tiny wrappers, hot loops, callbacks, and internal helpers where trace
  volume is noise. Use unnamed `Effect.fn(function* ...)` only for local generic helpers where a
  name adds no useful observability. Avoid plain functions whose only body is `Effect.gen`.
- Service method implementations use the curried v4 form:
  `Effect.fn("@svvy/runtime/Runtime.messages.submit")(function* (...) { ... })`. Additional transforms such
  as `Effect.catch(...)` or `Effect.annotateLogs(...)` are passed as extra arguments to
  `Effect.fn(...)`; do not attach those transforms to `Effect.fn(...)` with `.pipe(...)`.
- Effect service, worker, repository, stream, queue, handler, and generated-operation code does not
  use JavaScript `async`/`await` or `try`/`catch` inside `Effect.gen`, `Effect.fn`, or
  `Effect.fnUntraced` bodies. Use Effect constructors and recovery APIs instead:
  `Effect.try`, `Effect.tryPromise`, concrete recovery APIs such as `Effect.catch`,
  `Effect.catchTag`, `Effect.catchTags`, `Effect.catchReason`, `Effect.catchCause`,
  `Effect.catchCauseFilter`, `Effect.exit`, `Exit`, and `Cause`. JavaScript `try` / `catch` is
  reserved for non-Effect host-edge code that is immediately wrapped before entering an Effect
  service boundary.
- Do not use JavaScript `try` / `finally` around `yield*` inside `Effect.gen`, `Effect.fn`, or
  `Effect.fnUntraced` for cleanup, lock release, state reset, resource finalization, or worker
  bookkeeping. Use `Effect.ensuring`, `Effect.acquireUseRelease`, `Effect.acquireRelease`,
  `Effect.uninterruptibleMask`, `Ref.modify`, `SynchronizedRef.modifyEffect`, scoped finalizers, or
  an explicit transaction helper so interruption and typed failure behavior are visible. JavaScript
  `try` / `finally` is allowed only in pure synchronous host-edge code that is wrapped before
  entering an Effect service boundary.
- Terminal generator branches use `return yield* ...`. Do not write bare
  `yield* Effect.fail(...)`, `yield* new TaggedError(...)`, `yield* Effect.interrupt`, or
  equivalent terminal effects and then continue the generator. This applies inside `Effect.gen`,
  `Effect.fn`, and `Effect.fnUntraced`.
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
  generator effects that need `this` use `Effect.gen({ self: this }, function*() { ... })`. Do not
  use the removed v3 `Effect.gen(this, ...)` form.
- Use unnamed `Effect.fn(function* ...)` for reusable generator functions that do not need a named
  trace boundary. Use named `Effect.fn` for operations that should form an observability boundary.
  Use `Effect.fnUntraced` for tiny wrappers, hot loops, and internal stream/queue callbacks where
  span volume would obscure useful traces.
- Layers are small and composable. Do not build one giant root layer that hides package boundaries.
- A service class only has a static `.layer` when the class explicitly defines one. V4
  `Context.Service` does not auto-generate `.Default` or wire a `dependencies` option. Otherwise,
  export named layer values or layer factory functions with `Layer.effect` or `Layer.succeed`.
- A service may use `Context.Service<Self>()(id, { make })` when keeping the constructor effect on
  the class improves locality. This still does not create a layer automatically; define
  `static readonly layer = Layer.effect(Service, Service.make)` for a zero-argument constructor or
  `static readonly layer = (input: Input) => Layer.effect(Service, Service.make(input))` for a
  parameterized constructor, then wire dependencies with `Layer.provide(...)`. Do not pass or
  emulate a v3 `dependencies` option on `Context.Service`; layer composition is the only dependency
  wiring mechanism.
- Primary service layers are named `layer`. Variants use descriptive `layer<Variant>` names such as
  `layerTest`, `layerConfig`, or `layerInMemory`. Do not use v3-style `Default` layer names or
  `Live` suffixes for svvy-owned services. `Context.Service(..., { make })` never implies a layer;
  every service with a `make` constructor that is used across a package boundary declares its layer
  explicitly with `Layer.effect(Service, Service.make)` or an equivalent visible layer expression.
- `Layer.provide(...)` composes an implementation with dependency layers and hides those dependency
  services from the resulting layer output. Use it for ordinary package boundaries.
- `Layer.provideMerge(...)` composes an implementation with dependency layers and keeps both the
  implementation service and dependency services exposed. Use it only when the caller genuinely
  needs both services after composition.
- Production `Layer.provideMerge(...)` across a package boundary is allowed only when the owning
  package spec names the retained dependency service as part of that exported layer's public output
  and explains why callers must access it. Otherwise use `Layer.provide(...)`. Test layers may use
  `Layer.provideMerge(...)` to expose fixture/assertion-handle services, but those handles stay in
  test-only entrypoints.
- `Layer.mergeAll(...)` composes independent or already-fully-provided sibling layers. Do not rely
  on one sibling in a `Layer.mergeAll(...)` call to satisfy another sibling's requirements. Wire
  dependencies with `Layer.provide(...)` first, then merge the fully provided outputs that the next
  package or app layer actually needs. When the same dependency layer value is intentionally reused
  in more than one provided subtree, v4 memoization shares it inside the same runtime memo map; do
  not create fresh equivalent layer expressions and expect them to share state.
- `Layer.suspend(...)` is allowed only in named layer factory or bootstrap modules for pure lazy
  layer selection and recursive or circular layer definitions that are explicitly named by the
  owning package spec. The suspended factory must not read host globals, create per-request layer
  graphs, hide package dependencies, or perform product policy. It is evaluated when the layer is
  first built and then follows normal layer memoization semantics for that layer value.
- When two package sublayers must share one scoped dependency, the owner constructs that dependency
  layer once in the enclosing module or layer factory scope and reuses that exact layer value in
  every `Layer.provide(...)`. Calling the same layer factory twice creates distinct layer values and
  is not a sharing contract, even if the arguments are equal. Any package layer that depends on
  shared scoped state, SQL handles, queues, pubsubs, process spawners, or fake handles has a focused
  acquisition/finalizer test proving the dependency is acquired once and finalized once per owner
  scope.
- Layer composition is explicit at package and app bootstrap boundaries even though Effect v4 shares
  layer memoization across `Effect.provide` calls that use the same current memo map. Separate
  `ManagedRuntime.make(...)` calls do not share memoization unless the owner passes the same
  `Layer.MemoMap` through `{ memoMap }`. Use `Layer.fresh` or
  `Effect.provide(layer, { local: true })` only when a test or resource scope intentionally needs an
  isolated layer subtree.
- Specs and resource matrices may use `layer-acquired` as a `svvy` lifetime label for resources
  acquired by a package/app layer and released when that layer scope closes. Do not turn that label
  into `Layer.scoped` usage. In Effect v4, layer-scoped acquisition is represented by
  `Layer.effect` or `Layer.effectContext` over effects that require `Scope.Scope` and register
  cleanup with `Scope.addFinalizer(...)`, `Effect.addFinalizer(...)`, or
  `Effect.acquireRelease(...)`. Use `Effect.scoped(...)` only at an outer run/test boundary that
  intentionally creates and closes a temporary scope, not inside a layer constructor for a resource
  that must live with the layer.
- State-backed port layer factories accept an already constructed `@svvy/state` layer value and
  only project or adapt services from that exact layer identity. They must not call the state layer
  factory, SQLite client layers, migrator layers, secret-store construction, or database-opening
  helpers internally. All state-backed port tags in one app bootstrap share the same scoped
  state/database resources unless a named test layer explicitly uses `Layer.fresh` or
  `Effect.provide(..., { local: true })`.
- A state-port adapter layer is an ordinary layer that requires state-package services and provides a
  core-owned port tag, for example
  `Layer.effect(RuntimeQueueStatePort, Effect.gen(function* () { const state = yield*
StructuredSessionState; return runtimeQueueStatePortFromStructuredSessionState(state); }))`.
  Adapter layers do not call `Layer.build`, `ManagedRuntime.context()`, `ManagedRuntime.make`, state
  layer factories, or database-opening helpers internally.
- Long-lived resources are scoped. A workspace runtime scope, surface runtime scope, watcher, pi session,
  subprocess, and bridge subscription must have an explicit scope/finalizer.
- Product resource scopes follow one ownership hierarchy:

  ```text
  app ManagedRuntime layer scope
    workspace runtime scope
      workspace watcher / recovery / queue-worker scopes
      surface runtime scope
        pi session scope
        active turn scope
          tool / command / blocking-wait child scopes
    bridge/facade subscription scopes owned by the caller
  ```

  Closing a parent scope closes every child scope. A surface runtime scope may have multiple desktop panes
  or bridge consumers, but it has one surface scope; reference counting or equivalent state lives in
  runtime, not in the UI. The last consumer release may close the surface scope only when runtime
  policy says the live surface should be disposed. Command/process scopes live under their owning
  turn or command-session service, not directly under the UI pane that first displayed them.

- Manual runtime child scopes use `Scope.fork(parentScope, finalizerStrategy?)` so parent shutdown
  closes the child. Use independent `Scope.make` only for bridge/facade scopes whose lifetime is
  owned outside the current parent scope and that are explicitly closed with `Scope.close`. Use
  `Scope.forkUnsafe` only at synchronous construction edges where the owner immediately installs the
  child scope into a scoped service or test fixture. Use v4 `Scope.provide`, not removed
  `Scope.extend`, when running work in an explicit scope.
- `Scope.makeUnsafe` is allowed only in low-level synchronous resource constructors that immediately
  bind the created scope to an explicit owner: an `Effect.acquireRelease(...)` resource, a parent
  scope, or a package-owned close path named in that package's resource-lifetime matrix. Package
  services must not allocate independent unsafe scopes and rely on callers remembering to call
  `close()` unless the owning package spec names the resource, close owner, interruption behavior,
  and deterministic cleanup tests. Prefer an Effect resource constructor requiring `Scope.Scope` or
  returning `Effect.acquireRelease(...)` for long-lived package resources.
- Scope finalizer strategy is a concrete shutdown policy. `Scope.fork(parentScope, "sequential")`
  closes finalizers sequentially in reverse registration order and is the default choice when
  child resources depend on parent-provided handles or ordered shutdown matters.
  `Scope.fork(parentScope, "parallel")` is allowed only for independent resources whose finalizers
  may safely run concurrently. Package specs for app, workspace, surface, watcher, subprocess, and
  bridge scopes name which strategy they use when manual child scopes are created.
- Runtime, workspace, surface, watcher, queue-worker, and command fibers use `Effect.forkScoped` or
  `Effect.forkIn(scope)`. `Effect.forkChild` is for work bounded by the current parent fiber.
  `Effect.forkDetach` is not allowed in package/domain services, runtime workers, stream consumers,
  protocol loops, or bridge subscriptions. It is allowed only at an app/process edge with a named
  shutdown handle and test coverage proving the detached fiber is stopped before app runtime
  disposal. Normal owned worker lifetime uses `Effect.forkScoped` or `Effect.forkIn(ownerScope)`.
  Fork options are part of the owner contract: use default deferred start for ordinary workers, use
  `startImmediately: true` only when the owner then awaits a typed attachment/readiness receipt, and
  keep `uninterruptible` limited to bounded commit/release regions.
- `Effect.acquireRelease` finalizers are infallible cleanup paths. Close/dispose failures in
  service-lifetime finalizers are converted to logs, metrics, app-log facts, or already-modeled
  typed facts before the finalizer returns; they are not leaked as finalizer failures. Use
  `Effect.acquireUseRelease` only for one-shot bracketed operations where release failure is part of
  the operation result and may fail the returned effect. Do not use `acquireUseRelease` for
  long-lived layer/service lifetime cleanup unless the package spec explicitly wants release
  failure to mask, join, or otherwise affect the use result.
- Dynamic keyed resources use a `LayerMap.Service` subclass when the map itself should be
  injectable. The subclass exposes static `MyMap.layer`, `MyMap.layerNoDeps`, `MyMap.get(key)`,
  `MyMap.contextEffect(key)`, and `MyMap.invalidate(key)`. Provide `MyMap.layer` once when the map
  should include its declared dependencies; use `MyMap.layerNoDeps` only when the caller has
  already provided those dependencies separately and the resulting layer graph must keep dependency
  ownership explicit. Use `Effect.provide(MyMap.get(key))` to supply a keyed resource. Use
  lower-level `LayerMap.make` only inside custom scoped map services; its returned instance has
  `.get`, `.contextEffect`, and `.invalidate`, not `.layer` or `.layerNoDeps`.
- `MyMap.get(key)` is a layer requiring the `MyMap` service; it acquires the keyed resource in the
  caller's active scope. Do not retain services or contexts returned by `contextEffect(key)` beyond
  that scope. Because `.get(key)` only returns a `Layer`, it is not a readiness probe by itself.
  Owners that need to prove startup acquisition run `MyMap.contextEffect(key)` or the lower-level
  map instance's `.contextEffect(key)` in the owner scope with the map service already provided, and
  treat that acquisition result as the readiness signal. Svvy does not rely on `preloadKeys`,
  `preload`, or undocumented eager-build behavior as the product warmup, readiness, ownership,
  recovery, or subscription-attach mechanism. Owners that need warmup or readiness explicitly call
  `contextEffect(key)` in the owner scope for each key, record the product readiness receipt or
  barrier, and decide whether failure blocks startup or is reported as a typed degraded capability.
  Keyed resources are disposed by scope closure, `invalidate(key)`, or configured idle TTL, and are
  recovered from durable state when recreated. Invalidating a key prevents reuse and affects future
  acquisition; it does not revoke an already borrowed scoped context. Active borrowers remain valid
  until their scopes close unless the owner explicitly interrupts that owner scope.
- `LayerMap.Service` lookups for per-workspace or per-surface resources must return a key-specific
  layer value, normally a layer factory call such as `WorkspaceRuntime.layer(workspaceId)` or
  `SurfaceRuntime.layer(surfacePiSessionId)`. Do not return one shared mutable layer value for
  multiple keys unless sharing the same scoped service instance across those keys is explicitly
  intended and named by the package spec. Shared dependencies inside keyed layers may still be
  memoized by the app/runtime memo map.
- Workspace and surface runtime scope `LayerMap` resources are acquired only by runtime-owned
  workspace/surface owner scopes. Facade methods may borrow an already owned workspace/surface
  runtime through runtime services, but they must not acquire `WorkspaceRuntimeMap.get(workspaceId)`
  or `SurfaceRuntimeMap.get(surfacePiSessionId)` per call unless the call is the explicit lifecycle
  operation that opens that owner scope. Closing the owner scope, invalidating the key, idle TTL, or
  app shutdown releases the resource. Dockview panes, renderer subscriptions, browser tools, and
  read-model refetches never call `.get(...)`, `.contextEffect(...)`, or `.invalidate(...)` on
  workspace/surface runtime scope maps; they attach through runtime facades and events so multiple panels
  can observe one live surface without creating or closing runtime resources from UI lifecycle. The
  only release paths are owner-scope close, explicit key invalidation, configured idle TTL, or app
  `ManagedRuntime` disposal; UI panes, subscriptions, refetches, and facade calls are never release
  owners.
- `ManagedRuntime` is created only by app/process bootstrap owners, explicit non-product
  integration/e2e harnesses, and named edge harnesses that own shutdown. Production bridge/facade
  modules adapt a caller-owned `ManagedRuntime`; they do not create one. Domain services, package
  facades, state repositories, runtime workers, extension handlers, pi-adapter services, and sandbox
  services do not create runtimes.
- Non-edge package code must not call any `Effect.run*` runner (`runPromise`, `runPromiseExit`,
  `runCallback`, `runFork`, `runSync`, and their `*With` / `*Exit` variants),
  `ManagedRuntime.make`, `Layer.launch`, or platform `runMain` helpers. Running effects is an app,
  bridge, CLI, approved facade/integration-test, or process-entry responsibility. The allowed
  runner zones are app/process bootstrap, app-owned CLI entrypoints, bridge/facade modules adapting
  a caller-provided runtime, explicit app-bootstrap or facade integration/e2e harnesses, and
  package-boundary-approved test harnesses for non-Effect framework edges. Ordinary service tests,
  package services, state repositories, runtime workers, extension handlers, pi-adapter services,
  and sandbox services do not run effects manually.
- The one product package exception is the `@svvy/pi-adapter` pi callback bridge inside
  `turns.run(...)`. When pi's native tool API requires a Promise callback, the adapter may construct
  a turn-scoped callback runner from the current turn Effect context for only the Effect returned by
  the `RunPiTurnInput.toolExecutor`. This runner is package-private, bound to the active turn scope,
  never creates or receives a `ManagedRuntime`, never runs arbitrary package effects outside the
  tool executor, maps `Exit` into pi callback results, and has boundary tests for cleanup,
  interruption, defects, and typed failures. This exception does not allow package-level runners,
  per-request runtimes, app-bootstrap-injected runner services, or public callback facades.
- Do not import `effect/Runtime` for service execution. Effect v4 does not provide a `Runtime<R>`
  service-execution value; code that needs to run effects uses a caller-owned `ManagedRuntime` at a
  framework edge. Advanced harness code that must fork with inherited services uses `Effect.context`
  and `Effect.runForkWith(services)` only inside that explicit edge.
- `effect/Runtime` is allowed only in platform/process adapter code for the exact process lifecycle
  exports `Runtime.makeRunMain`, `Runtime.defaultTeardown`, `Runtime.errorExitCode`,
  `Runtime.errorReported`, `Runtime.getErrorExitCode`, and `Runtime.getErrorReported`. Domain
  packages and bridge facades use caller-owned `ManagedRuntime` surfaces instead.
- Do not import or model `RuntimeFlags`, `FiberRef`, or `FiberRefs` as package architecture
  contracts. Effect v4 runtime defaults that are actually fiber-local references use
  `Context.Reference` values from `effect/References`. Current time-zone behavior uses the
  `DateTime.CurrentTimeZone` service plus `DateTime.withCurrentZone*` /
  `DateTime.layerCurrentZone*`; it is not a custom or built-in `Context.Reference`. Other runtime
  defaults are ordinary explicit `svvy` services or app-edge layers/effect provisioning before
  running work. `ManagedRuntime.make(...)` options are limited to layer memoization.
- `Runtime` in svvy examples is a product service name, not `effect/Runtime` or the removed v3
  `Runtime<R>` execution value. Package code may choose a less ambiguous class name such as
  `RuntimeService` when local naming would otherwise confuse the product service with Effect
  internals.
- The shipped product app graph has exactly one app-bootstrap `ManagedRuntime`. Non-product
  bootstrap/facade/e2e harnesses may intentionally create more than one `ManagedRuntime` over the
  same layer graph only when the harness names why shared acquisition is under test; the owner then
  creates one memo map with `Layer.makeMemoMapUnsafe()` and passes `{ memoMap }` to every
  `ManagedRuntime.make(...)` over that graph. Per-request runtimes, per-window app runtimes, and
  per-request memo maps are invalid.
- When an explicit shared memo map is passed to more than one
  `ManagedRuntime.make(..., { memoMap })` or layer-build harness, resource finalization is
  observer-counted by Effect. Disposing one observing runtime/scope detaches that observer, but
  shared resources are released only after every observing runtime/scope using that memo map is
  closed. Shared memo maps are therefore allowed only for app/bootstrap and explicit harnesses that
  name all owners and close every observer in tests.
- `Layer.effectDiscard` is an installed Effect API, but it is edge-only in svvy architecture. It is
  allowed only in app/bootstrap, named process entrypoints, and explicit integration/e2e/facade
  harnesses for finite construction effects or scoped worker forks with close receipts. Ordinary
  package worker startup uses a named service layer that exposes readiness, drain, and shutdown
  receipts. If an approved edge uses `Layer.effectDiscard`, the effect must be finite or must fork
  long-lived work with `Effect.forkScoped` and return promptly; the owner documents the scope,
  shutdown path, and test that closes the scope.
- `LayerMap.Service` constructors document whether they use `lookup` or static `layers`, any
  `dependencies`, key-specific layer identity policy, idle time-to-live, and invalidation
  semantics. Startup readiness is proven by owner-scope `MyMap.contextEffect(key)` acquisition, with
  the `MyMap` service already provided, plus the owning service's readiness receipt. Product
  runtime-owned declarations omit `preload` and `preloadKeys`; those options are not the readiness,
  warmup, ownership, or recovery contract for the checked-in Effect source. The generated service
  class exposes `.layer`, `.layerNoDeps`, `.get(key)`, `.contextEffect(key)`, and
  `.invalidate(key)`.
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
- `Resource` from `effect/Resource` is allowed only for scoped, refreshable, process-local values
  whose latest acquisition result is safe to reread, such as host capability probes or provider
  metadata probes. Use `Resource.manual` when refresh is triggered by an explicit owner action, and
  use `Resource.auto` only when the owner names the refresh schedule and shutdown scope. `Resource`
  values are created inside an owner scope. `Resource.get` may fail with the stored acquisition
  error. `Resource.refresh` delegates to `ScopedRef.set`, so it closes the previous value's scope
  before acquiring the replacement. If acquisition fails, the previous result may still be readable,
  but previous scoped resources have been finalized; use `Resource` only for reread-safe data/probes,
  not no-gap live clients. `Resource` is not durable product state and must not replace
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

```ts
export class QueueDispatcher extends Context.Service<
  QueueDispatcher,
  {
    wakeSurface(input: SurfaceWakeup): Effect.Effect<void, RuntimeContractError>;
  }
>()("@svvy/runtime/queue/QueueDispatcher") {
  static readonly layer = Layer.effect(
    QueueDispatcher,
    Effect.gen(function* () {
      const queueState = yield* RuntimeQueueStatePort;
      const dirtySurfaceWakeups = yield* SynchronizedRef.make(new Set<SurfaceWakeupKey>());
      const wakeups = yield* Queue.sliding<QueueWakeupKey>(1024);
      yield* Effect.addFinalizer(() => Queue.shutdown(wakeups).pipe(Effect.asVoid));

      yield* Stream.fromQueue(Queue.asDequeue(wakeups)).pipe(
        Stream.runForEach(() => drainDirtyQueueRows(queueState, dirtySurfaceWakeups)),
        Effect.forkScoped,
      );

      const wakeSurface = Effect.fn("@svvy/runtime/QueueDispatcher.wakeSurface")(function* (
        input: SurfaceWakeup,
      ) {
        const key = surfaceWakeupKey(input);
        yield* SynchronizedRef.update(dirtySurfaceWakeups, (dirty) => new Set(dirty).add(key));
        yield* Queue.offer(wakeups, key);
      });

      return QueueDispatcher.of({ wakeSurface });
    }),
  );
}
```

Long-lived workspace/surface resources use `LayerMap.Service` when keyed acquisition and scoped
disposal are part of the service contract:

```ts
const makeWorkspaceRuntimeMapLayer = Effect.gen(function* () {
  const runtimeLayerConfig = yield* RuntimeLayerConfigService;

  class WorkspaceRuntimeMap extends LayerMap.Service<WorkspaceRuntimeMap>()(
    "@svvy/runtime/workspace/WorkspaceRuntimeMap",
    {
      lookup: (workspaceId: WorkspaceId) => WorkspaceRuntime.layer(workspaceId),
      idleTimeToLive: runtimeLayerConfig.workspaceRuntimeIdleTtlMs,
    },
  ) {}

  return WorkspaceRuntimeMap.layer;
});
```

Runtime examples that show `LayerMap.Service` TTLs are config-driven; they do not hard-code a
second idle lifetime outside `RuntimeLayerConfig`.

## Runtime Flow Phase Ownership

The main agentic flow is one package-owned Effect program with edge facades around it. Each phase
has one policy owner and one durable source of truth:

| Phase                            | Owner                                                                 | Effect surface                                                                                                                                                       | Durable/product-state source                                              | Forbidden shortcut                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| App bootstrap                    | app/bootstrap                                                         | Compose package layers once, create one `ManagedRuntime`, call `context()` and complete bootstrap readiness before exposing facades                                  | app config, packaged paths, state database path                           | per-request runtimes, hidden global services, package code creating the app runtime                                     |
| User prompt submission           | `@svvy/runtime`                                                       | `Runtime.messages.submit(...)` service method, Promise facade over the app runtime                                                                                   | `@svvy/state` surface/session/profile/queue ports                         | renderer prompt assembly, direct pi calls, writing transcript history before delivery                                   |
| Durable queue insertion          | `@svvy/runtime` through `@svvy/state`                                 | short transaction effect plus after-commit invalidation                                                                                                              | SQLite queue row and composer draft/read-model rows                       | Effect `Queue` as persisted queue, UI-owned queue state                                                                 |
| Queue wakeup and claim           | `@svvy/runtime`                                                       | in-memory `Queue` wakeup, prompt lock `Semaphore`, short uninterruptible claim transaction                                                                           | SQLite queue row claim/lease/status                                       | relying on every wakeup value, claiming inside pi turn transaction                                                      |
| Generated-context refresh        | `@svvy/runtime` orchestrates, `@svvy/extensions` renders              | runtime calls extension services, state persists binding facts                                                                                                       | source fingerprints, generated-context binding rows, optional cache files | desktop prompt previews as source of truth, rewriting active turn context mid-turn                                      |
| Pi turn setup and stream         | `@svvy/pi-adapter` for pi adaptation, `@svvy/runtime` for turn policy | scoped pi session effect and `Stream<PiRuntimeEvent, PiAdapterError>`                                                                                                | pi session reference rows, turn/queue/stream patch rows                   | pi-native types crossing packages, adapter owning queue/tool policy                                                     |
| Native tool declaration          | `@svvy/extensions`                                                    | service methods return pi-free declarations and metadata                                                                                                             | extension source, actor bindings, readiness facts                         | runtime hard-coded tool catalogs, desktop-provided tool schemas                                                         |
| Tool invocation routing          | `@svvy/runtime`                                                       | runtime validates accepted tool call and calls extension handler effect                                                                                              | command row, tool-call id, prompt execution context                       | extension handler publishing runtime events or mutating unrelated targets                                               |
| Extension handler semantics      | `@svvy/extensions`                                                    | typed handler effect returning `ExtensionHandlerResult` with ordered `ExtensionRuntimeOperation` items wrapping `runtime_effect` requests or `execution_plan` values | extension source and state-backed extension ports                         | extension claiming queues, creating panes, scheduling recovery, launching sandboxed long-running sessions directly      |
| Command and subprocess execution | `@svvy/runtime`                                                       | scoped command-session service, child-process services, streams, cancellation finalizers                                                                             | command/session rows, output rows, artifact metadata                      | raw process handles in state, shell strings where command descriptions exist, extension-owned durable command lifecycle |
| Runtime effect application       | `@svvy/runtime`                                                       | closed algebra dispatcher using state/sandbox/pi/extensions services as needed                                                                                       | state transactions and generated package/build facts                      | arbitrary `Record<string, unknown>` requests, direct runtime service calls from extensions                              |
| Event publication                | `@svvy/runtime`                                                       | runtime replay ring plus per-subscriber `Queue` exposed through `Stream` subscriptions after commits                                                                 | committed state rows and live scoped stream patch state                   | treating replay buffers as durable event history                                                                        |
| UI/headless consumption          | `@svvy/desktop` or another consumer                                   | Promise/callback/`AsyncIterable` facades over one `ManagedRuntime`                                                                                                   | state read-model facades plus runtime notifications                       | UI-owned product lifecycle, runtime events containing read-model snapshots                                              |
| Shutdown and recovery            | `@svvy/runtime`, state, app/bootstrap                                 | scope finalizers, `FiberHandle`/`FiberMap`/`FiberSet`, `ScopedRef` replacement finalization, recovery scans and leases                                               | recovery rows, terminal command/queue/turn facts                          | orphaned fibers, relying on pre-restart process-local `Deferred`/`Ref` state after restart                                      |

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
  - `keyedLayerMapScoped`: acquired by a runtime-owned keyed owner scope and released by owner
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
  the implementation package. Service tags such as the named core-owned state ports,
  `ExtensionStatePort`, `SandboxPolicySource`, `ProviderAuthPort`, `PiSessionReferencePort`,
  `PiRuntimePathsPort`, `RuntimeArtifactStatePort`, `AppLogWritePort`, and `SecretStorePort` are
  core-owned contracts. Implementations, layers, resources, store handles, host-path resolution, and
  lifecycle policy are owned by `@svvy/state`, app bootstrap, or the adapter package that provides
  the port.
- Effect-native package service APIs may return `Option.Option<T>` for optional lookups when the
  caller is also Effect-native, such as `findSurface(...)`, optional provider metadata, or optional
  source records. Public Promise facades, Electrobun RPC payloads, renderer read models,
  persistence rows, generated packages, command facts, app logs, and runtime events do not expose
  `Option`; they encode absence as `null`, an omitted optional field, or a discriminated union.
  Choose one representation per contract and encode/decode it through `@svvy/core`.
- `Result.Result<A, E>` is internal to pure parse/classification helpers and reference-derived
  utilities. `Option.Option<T>` is allowed for Effect-native optional lookups. They are not public
  failure channels for package services. Convert them before crossing package, RPC, persistence,
  runtime-event, command-fact, app-log, generated-package, or UI boundaries. When an actual `Effect`
  is needed, use `Option.match(...)` or `Result.match(...)` to map to `Effect.succeed(...)` or
  `Effect.fail(...)`, or stay inside `Option.gen(...)` / `Result.gen(...)` for pure data flow. Do
  not document or rely on `.asEffect()` unless the installed Effect source exposes it.
- A package may expose Promise, callback, or `AsyncIterable` facades only for non-Effect consumers:
  Electrobun RPC handlers, Svelte renderer adapters, browser tools, headless scripts, or tests that
  intentionally exercise the public non-Effect edge.
- Facades receive a caller-owned `ManagedRuntime` and call that runtime's instance methods, such as
  `managedRuntime.runPromise(...)`, `managedRuntime.runCallback(...)`, and
  `managedRuntime.runSync(...)`, or a svvy bridge stream/subscription adapter built on the same
  runtime. Stream/subscription adapters are svvy facade helpers, not `ManagedRuntime` instance
  methods. They do not create hidden runtimes, build layers per request, keep durable state, claim
  queues, execute turns, or apply recovery policy. Facade methods call exported runtime service
  operations such as `Runtime.workspaces.open(...)`, `Runtime.surfaces.close(...)`, or
  `Runtime.messages.submit(...)`; they do not call `LayerMap.Service` subclass static helpers such
  as `WorkspaceRuntimeMap.get(...)` / `.contextEffect(...)`, lower-level map instance helpers such
  as `layerMap.get(...)` / `.contextEffect(...)`, layer constructors, repository ports, or worker
  services directly.
- Facade factories that accept `ManagedRuntime` are readiness-gated by contract. A facade is created
  only from an app-bootstrap-ready runtime handle, or it runs an explicit readiness effect before
  admitting calls. Facade methods must not be the first path that lazily acquires the app layer
  graph unless that same call enforces the runtime-owned startup readiness barrier before executing
  the requested service method. Facade tests cover calls made before readiness, after readiness
  failure, after explicit shutdown preparation, and after runtime disposal.
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
- `RuntimeEffectRequest` and `ExtensionExecutionPlan` dispatchers must be exhaustive. Use
  `Match.tagsExhaustive`, `Match.discriminatorsExhaustive`, or a direct `switch` with no broad
  `default` branch and a `never` exhaustiveness check. Do not add catch-all fallback behavior for
  closed product algebras.
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

- Use `Schema.Struct` / `Schema.TaggedStruct` for data-only persisted, RPC, event, read-model,
  command-fact, and generated-package payloads. Use `Schema.Class` / `Schema.TaggedClass` only when
  constructor/prototype methods, default constructor behavior, or yieldable class error semantics
  are intentionally part of the in-process contract. Do not make persisted or wire payloads
  class-backed just for nominal typing.
- Static schema definitions and compiled schema functions are hoisted at module scope, including
  `Schema.is`, `Schema.decodeEffect`, `Schema.decodeUnknownEffect`, `Schema.decodeExit`,
  `Schema.decodeUnknownExit`, `Schema.decodeOption`, `Schema.decodeUnknownOption`,
  `Schema.decodePromise`, `Schema.decodeUnknownPromise`, `Schema.decodeSync`,
  `Schema.decodeUnknownSync`, `Schema.encodeEffect`, `Schema.encodeUnknownEffect`,
  `Schema.encodeExit`, `Schema.encodeUnknownExit`, `Schema.encodeOption`,
  `Schema.encodeUnknownOption`, `Schema.encodePromise`, `Schema.encodeUnknownPromise`,
  `Schema.encodeSync`, and `Schema.encodeUnknownSync`. Effect v4 `Schema.asserts(schema, input)` is
  a direct assertion call, not a hoistable compiler that returns a reusable assertion function.
  Product package boundary code therefore does not use `Schema.asserts(...)` as a reusable guard
  surface; it uses hoisted `decodeUnknown*`, `decode*`, `encode*`, `Schema.is`, or package-owned
  wrapper helpers whose compiler call happens at module scope. Direct schema assertion calls are
  banned in package boundary, runtime, bridge, handler, read-model, and command-output code, except
  in named dynamic schema factory files where the schema cannot be known at module scope.
- `Schema.decodePromise(...)`, `Schema.decodeUnknownPromise(...)`, `Schema.encodePromise(...)`, and
  `Schema.encodeUnknownPromise(...)` are host-edge-only conveniences. Product package boundaries,
  bridge error normalization, persistence, runtime events, command facts, and app logs use Effect or
  Exit schema adapters instead.
- Effect service bodies prefer hoisted `Schema.decodeUnknownEffect(...)` and
  `Schema.encodeEffect(...)`. Use `decodeUnknownEffect` for genuinely unknown input inside Effect
  service methods, `decodeUnknownExit` only at non-Effect bridge edges that need `Exit`
  classification, `decodeEffect` / `decodeExit` for values already typed as the schema's encoded
  representation, `encodeEffect` for typed schema values, and `encodeUnknownEffect` only when the
  boundary must validate an unknown value before encoding it. `decodeUnknownSync` and `decodeSync`
  are not normal service-body adapters; exported sync decoders are restricted by the naming and
  usage rule below.
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
- Non-Effect bridge edges use hoisted `Schema.decodeUnknownExit(...)` /
  `Schema.encodeUnknownExit(...)` when the bridge needs to distinguish schema failure, defect, and
  interruption before mapping into a closed stable error. These `Exit` decoders are usable at
  non-Effect bridge edges only for schemas with no decoding service requirements. Public
  `@svvy/core` schemas that are decoded by desktop RPC, browser tools, headless automation,
  generated command boundaries, or persistence helpers must stay service-free. If a schema genuinely
  needs decoding services, bridge code runs `Schema.decodeUnknownEffect(...)` through the
  caller-owned `ManagedRuntime` instead of pretending the schema is synchronous.
  `*Result` schema adapters are allowed only in pure, non-Effect host-edge helpers that immediately
  catch thrown defects, interruptions, or non-schema causes and map them to a closed bridge error.
  Inside Effect service methods or package boundaries, use `Schema.decodeUnknownEffect(...)` /
  `Schema.encodeEffect(...)`, or use `Schema.decodeUnknownExit(...)` /
  `Schema.encodeUnknownExit(...)` at non-Effect bridge edges.
  `Schema.decodeUnknownSync(...)` is limited to trusted bootstrap, test, and assertion edges, or
  must be wrapped in `Effect.try(...)` before crossing a product boundary.
- Boundary helper names spell out both input kind and adapter:
  `decodeUnknown<TypeName>Effect`, `decodeUnknown<TypeName>Exit`, `decode<TypeName>Effect`,
  `encode<TypeName>Effect`, and `encodeUnknown<TypeName>Exit` where needed.
  Every public unknown-input boundary decoder exported from `@svvy/core` or package contract
  modules is named `decodeUnknown<TypeName>Effect` and/or `decodeUnknown<TypeName>Exit`.
  `decode<TypeName>Effect` / `decode<TypeName>Exit` are allowed only when the function accepts an
  already typed encoded value and calls `Schema.decodeEffect` / `Schema.decodeExit`, not
  `Schema.decodeUnknown*`. Sync decoders are not product-boundary helpers. Any exported sync
  decoder is named `unsafeDecode<TypeName>SyncForTestsAndBootstrap` and may be used only in tests,
  trusted bootstrap, or local assertions before entering an Effect boundary.
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
  syntax requirement, use v4 string checks before branding, for example
  `Schema.String.check(Schema.isUUID()).pipe(Schema.brand("WorkspaceId"))`. Do not use removed
  `Schema.UUID`.
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
  - Non-security jitter or sampling may use `Random` only when no persisted identity,
    authorization, fingerprint, or user-visible uniqueness semantics depend on the value.
  - Digest encoding is explicit in the schema (`sha256:<hex>`, base64url token, UUID string, etc.).
    Public facts expose fingerprints, labels, status, or presence fields, never raw secret token
    bytes or signing inputs.
- Use v4 Schema names and shapes: `Schema.TaggedErrorClass`, `Schema.decodeUnknownEffect`,
  `Schema.decodeEffect`, `Schema.encodeEffect`, `Schema.Literals([...])`, `Schema.Union([...])`,
  `Schema.Tuple([...])`, `Schema.Record(key, value)`, `Schema.String.check(...)`,
  `Schema.Struct`, `Schema.TaggedStruct`, `Schema.Class`, `Schema.TaggedClass`,
  `Schema.NonEmptyString`, `Schema.brand`, `Schema.Redacted`, `Schema.RedactedFromValue`, and
  `Schema.Defect({ excludeCause: true })`.
- Recursive, transformed, or externally encoded contracts declare their encoded and decoded sides
  explicitly as `Schema.Codec<Type, Encoded>`. Use `Schema.revealCodec(...)` only when recursive
  codec inference otherwise hides the encoded shape, and keep the revealed type local to the owning
  contract module. Use `Schema.toEncoded`, `Schema.toType`, and `Schema.toCodecJson` only for
  generated declaration/schema emission or contract tests that intentionally inspect codec sides.
  Do not hand-write parallel encoded/decoded TypeScript interfaces when the schema codec can expose
  those sides.
- Schema annotations used for generated declarations, JSON Schema, OpenAPI, native tool schemas,
  and agent-facing schema blocks are owned by the same package that owns the source contract. The
  allowed public annotation vocabulary is explicit: stable title/name, description, examples,
  deprecation status only when a product spec still supports that field, default value only when it
  is semantically part of the contract, and product-owned extension metadata needed by generated
  tool/declaration emitters. Internal implementation notes, source file paths, debug ids, package
  private tags, prompt previews, secret hints, and arbitrary AST annotations must not leak into
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
  Effect v4 schema representation APIs directly:

  ```ts
  import * as SchemaRepresentation from "effect/SchemaRepresentation";
  ```

  Use this only for schema/declaration rendering owned by the package that owns the
  schema/declaration contract, such as `@svvy/core` for shared contracts or `@svvy/extensions` for
  generated actor declarations. Do not use removed `Schema.format(...)`, and do not treat
  representation traversal as a way to bypass the public annotation allowlist above.

- `SchemaAST` and `SchemaRepresentation` are allowed only in `@svvy/core` and package-owned schema,
  declaration, JSON Schema, or contract emitter code. Direct imports use `effect/SchemaAST` and
  `effect/SchemaRepresentation`. Domain services, state repositories, runtime workers, extension
  handlers, and renderer code do not inspect schema ASTs for business behavior.
  `SchemaAST.ParseOptions` may be imported only for exported parse option constants.
  `SchemaRepresentation` may be used only for developer-facing schema rendering or
  generated-contract paths covered by emitter tests.
- When a schema transform crosses a generated JSON Schema, OpenAPI, native-tool-schema,
  generated-command-schema, or agent-facing declaration boundary, annotations that must appear in
  the generated encoded/wire schema are attached to the encoded side with `Schema.annotateEncoded(...)`
  or the equivalent v4 encoded-side annotation helper. Ordinary `.annotate(...)` metadata may
  describe the decoded schema side and is not assumed to propagate to generated wire contracts for
  transforms.
- Generated native-tool schemas, generated `svvyx` command schemas, and agent-facing declaration
  blocks use v4 generation APIs from the owning source schema:

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

  All generated native-tool, `svvyx` command, and declaration JSON Schema calls use
  `Schema.toJsonSchemaDocument(schema, { additionalProperties: false, includeAnnotationKey:
isPublicSchemaAnnotationKey })`. Examples must not omit those options.
  Before publishing a generated schema to a model/tool bridge, declaration block, or generated
  contract artifact, resolve top-level `$ref` values with `JsonSchema.resolveTopLevel$ref(...)`.
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

- Do not use removed or v3 names such as `Schema.TaggedError`, `Schema.Data`,
  `Schema.decodeUnknown`, `Schema.decodeEither`, `Schema.validate*`, variadic `Schema.Literal`,
  variadic `Schema.Union`, lowercase `Schema.nonEmptyString` (use `Schema.NonEmptyString` or
  `Schema.String.check(Schema.isNonEmpty())`), or `Schema.UUID` (use
  `Schema.String.check(Schema.isUUID())`). Also do not use removed or restructured v3 schema APIs
  `Schema.parseJson(...)`, `Schema.pattern(...)`, `Schema.pickLiteral(...)`, variadic
  `Schema.TemplateLiteral(...)`, variadic `Schema.TemplateLiteralParser(...)`,
  `Schema.filter(...)`, `Schema.ULID`, `Schema.transformLiteral(...)`,
  `Schema.transformLiterals(...)`, `Schema.attachPropertySignature(...)`, `Schema.keyof`, or
  `Schema.NonEmptyArrayEnsure`. Use `Schema.UnknownFromJsonString`,
  `Schema.fromJsonString(schema)`, `Schema.String.check(Schema.isPattern(regex))`,
  `Schema.Literals([...]).pick([...])`, `Schema.TemplateLiteral([...])`,
  `Schema.TemplateLiteralParser(schema.parts)`, `Schema.String.check(Schema.isULID())`, v4
  `check(Schema.makeFilter(...))` / `Schema.refine(...)`, literal transforms, and
  `mapFields(... Schema.tagDefaultOmit(...))` as documented by the current v4 schema API table.
  Treat `Schema.keyof` and `Schema.NonEmptyArrayEnsure` as explicit current-v4 modeling choices
  with no direct v4 equivalent.
- V4 field-shape contracts are explicit: use `Schema.optionalKey(...)` for exact optional object
  keys, `Schema.optional(...)` only when `undefined` is part of the decoded value,
  `Schema.withDecodingDefaultKey(...)` when an absent key receives an encoded-side default,
  `Schema.withDecodingDefault(...)` when an absent or `undefined` optional value receives an
  encoded-side default, `Schema.withDecodingDefaultTypeKey(...)` when an absent key receives a
  decoded-side default, and `Schema.withDecodingDefaultType(...)` when an absent or `undefined`
  optional value receives a decoded-side default. Use encoded-side defaults when the default must
  pass through the schema's decoding transform, and decoded-side defaults only when the default is
  already in the decoded type. Use `Schema.NullOr(...)` plus `Schema.decodeTo(...)` /
  `SchemaGetter.transformOptional(...)` for nullable wire inputs. Do not use v3 field-shape helper
  forms such as `Schema.optionalWith(...)`, `Schema.withDefaults(...)`, `Schema.partial(...)`,
  `Schema.partialWith(...)`, `Schema.pick(...)`, `Schema.omit(...)`, `Schema.extend(...)`, or v3
  `Schema.required(schema)`. For converting optional field shapes to required keys in v4 schemas, use
  `schema.mapFields(Struct.map(Schema.requiredKey))`; reserve v4 `Schema.required` for unwrapping
  `Schema.optional(...)` when removing `undefined` is intentionally part of the decoded shape. Do
  not use removed/restructured v3 `Schema.filterEffect(...)`, `Schema.transform(...)`, or
  `Schema.transformOrFail(...)` helper forms. Use `Schema.decodeTo(...)` / `Schema.encodeTo(...)`
  whenever the decoded and encoded schemas differ, especially for persisted, RPC,
  generated-schema, or SQL row codecs. V4 `Schema.decode(...)` / `Schema.encode(...)` are allowed
  only as transformation shortcuts when the schema's decoded or encoded side stays the same; do not
  confuse them with boundary helpers such as `Schema.decodeEffect(...)` and
  `Schema.encodeEffect(...)`. Use v4 `mapFields`, `Struct`, `Schema.Struct`, `SchemaGetter`, and
  `SchemaTransformation` patterns from `docs/references/effect-smol/migration/schema.md`.
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
  before returning. `Data.TaggedError` is allowed only for those package-local internal errors; it
  must not appear in public contract schemas, persisted payloads, RPC payloads, runtime events, read
  models, command facts, app logs, generated-package contracts, bridge errors, or transcript-derived
  artifacts:

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
- Use `Effect.catch`, `Effect.catchTag`, `Effect.catchTags`, `Effect.catchCause`, and
  `Effect.catchReason` / `Effect.catchReasons` v4 APIs. Use `catchReason` / `catchReasons` only
  when an error has a tagged reason union such as
  `reason: Schema.Union([RateLimitError, QuotaExceededError])`. For closed string-literal `reason`
  fields, catch the parent tagged error with `catchTag` / `catchTags` and branch on `error.reason`.
  Use `Effect.catchFilter` for partial typed-error recovery and `Effect.catchCauseFilter` for
  partial cause recovery; those APIs use `effect/Filter` predicates such as
  `Filter.fromPredicate(...)`, and the `Filter` value stays package-local.
  Use `Effect.catchIf` for simple boolean predicates over typed errors when no extracted or
  transformed value is needed. Use `Effect.catchCauseIf` for simple boolean predicates over full
  causes. Prefer `Effect.catchFilter` / `Effect.catchCauseFilter` when the recovery predicate should
  narrow, transform, or be reused as an `effect/Filter` value. Predicate/filter values remain
  package-local and must not cross public contracts. Eager Effect variants
  (`mapEager`, `mapErrorEager`, `mapBothEager`,
  `flatMapEager`, `catchEager`, `fnUntracedEager`, and eager match variants) are not default
  service primitives. Use them only in measured synchronous hot paths where eager execution is
  intentional and cannot alter error mapping, logging, interruption, tracing, or resource lifetime;
  otherwise use ordinary `Effect.map`, `Effect.flatMap`, `Effect.catch`, `catchTag`, `catchTags`,
  `catchFilter`, or `catchCauseFilter`. Do not use v3 `Effect.catchAll`,
  `Effect.catchAllCause`, `Effect.catchSome`, or `Effect.catchSomeCause`.
- At bridge/test/process boundaries, use `Effect.exit`, `Exit.match`, and v4 `Cause` helpers when
  code must distinguish success, typed failure, defect, and interruption. v4 `Cause` is flattened;
  inspect `cause.reasons` or use v4 helpers such as `Cause.hasFails`, `Cause.hasDies`,
  `Cause.hasInterrupts`, `Cause.hasInterruptsOnly`, `Cause.findErrorOption`, `Cause.findDefect`,
  and `Cause.findInterrupt`. `Cause.findErrorOption(...)` returns an `Option`; `Cause.findDefect(...)`
  returns a `Result`; branch on the actual v4 return shape instead of assuming every extractor
  returns `Option`. Do not use removed cause tags or v3 guards such as `isFailType`, `isDieType`,
  `isSequentialType`, or `isParallelType`.
- `Effect.catchDefect` is not a domain-service recovery primitive. Use it only at named bridge,
  facade, shutdown, or process edges that must translate a known Effect/runtime defect, such as
  disposed-runtime use, into a stable product bridge error. Package services, repositories, workers,
  and extension handlers use typed errors, `Effect.exit`, and `Cause` inspection instead of
  recovering defects as normal product failures.
- Bridge/error normalization code that iterates `cause.reasons` uses reason-level guards such as
  `Cause.isFailReason`, `Cause.isDieReason`, and `Cause.isInterruptReason` rather than inspecting
  private fields. Tests and adapters that need synthetic causes use `Cause.fromReasons(...)` or the
  v4 `Cause.make*Reason(...)` constructors. Use `Cause.annotate(...)` only for boundary diagnostics
  that must remain attached to the cause; durable command and app-log facts still store normalized
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
  Effect `Cause` tree. Use `Schema.Cause(errorSchema, defectSchema)` or
  `Schema.Exit(valueSchema, errorSchema, defectSchema)` only for explicitly debug- or
  bridge-internal payloads that must preserve Effect outcome structure and whose encoded shape is
  part of that contract. Command facts, runtime events, app logs, transcripts, artifacts, and read
  models should not expose raw Effect cause trees when a stable product outcome field is sufficient.
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
- If an internal runtime stream must fail after subscription, its hub stores
  `Take.Take<RuntimeEvent, RuntimeEventError>` values and consumers expose it with
  `Stream.fromPubSubTake(pubsub)`. Publish ordinary event output by publishing one `Take` value
  whose value case is a non-empty readonly array, for example `PubSub.publish(pubsub, [event])` or
  `PubSub.publish(pubsub, [event1, event2])`. Publish typed stream failure as `Exit.fail(error)`
  and normal stream completion only as the terminal marker, normally `Exit.void` /
  `Exit.succeed(undefined)`. Do not publish single plain events or successful event payloads as
  `Exit.succeed(event)`, and do not document `Stream.fromPubSub(pubsub)` as producing
  `RuntimeEventError`.
- Each runtime subscription API declares exactly one stream mode: non-failing notification stream
  (for example a runtime-owned `Queue<RuntimeEvent>` or package-local `PubSub<RuntimeEvent>`
  exposed as `Stream.Stream<RuntimeEvent, never>`) or failing protocol stream
  (`PubSub<Take.Take<RuntimeEvent, RuntimeEventError>>` exposed through
  `Stream.fromPubSubTake`). Public runtime notification streams default to the non-failing mode;
  rebaseline, stale `afterSequence`, auth, and setup failures are returned before stream exposure or
  as bridge-level close/rebaseline results, not as hidden failures in a
  `Stream.Stream<RuntimeEvent, never>`.
- Package-local event fanout may use `PubSub.bounded(capacity)` by default. Use
  `PubSub.bounded({ capacity, replay })` only for package-local recent-notification convenience
  where replay loss has a documented state refetch/rebaseline path. Public runtime
  `Runtime.events(...)` replay is served from the runtime-owned sequence ring/index, not from PubSub
  replay. Every runtime PubSub hub names capacity, replay size when used, publisher path, and
  slow-subscriber behavior. Use bounded backpressure only where blocking the publisher is intended
  and tested.
- Runtime-owned notification hubs own a scoped `PubSub`, register `PubSub.shutdown`, and may expose
  ordinary non-failing internal notification streams with `Stream.fromPubSub(pubsub)` only where
  publisher backpressure is intended and tested. Public runtime, desktop, browser-tool, and headless
  subscriptions use the package-specific per-subscriber queue rule so slow consumers cannot block
  runtime publication.
- `PubSub.shutdown` is teardown, not drain: it interrupts suspended publishers and subscribers and
  finalizes active subscriptions. Runtime subscriptions are scoped; consumers acquire
  `PubSub.subscribe(...)` in the API/consumer scope so unsubscribe/close finalizers run when that
  scope closes rather than leaking subscribers after a pane, bridge stream, or test scope exits.
- Do not use `Stream.toPubSub`, `Stream.runIntoPubSub`, `Stream.toPubSubTake`,
  `Channel.toPubSub`, `Channel.runIntoPubSub`, `Channel.toPubSubTake`, or equivalent
  stream/channel-to-hub helpers on a shared runtime/app/workspace notification hub unless the
  stream/channel creates and owns that `PubSub`. `Stream.toPubSub` and `Channel.toPubSub` create
  scoped PubSubs and default `shutdownOnEnd` to true; `runIntoPubSub` shuts down the target only
  when `{ shutdownOnEnd: true }` is passed, but a source stream/channel ending must never close the
  shared runtime event hub, app-log hub, read-model notification hub, or command-output hub.
- Runtime publishers treat `false` from `PubSub.publish(...)` / `PubSub.publishAll(...)` as "not
  accepted by the hub," not as a durable-delivery receipt. On bounded backpressured hubs, effectful
  publish suspends for capacity; `false` is expected primarily when the hub is already shut down,
  while `true` means accepted for current subscribers and/or replay, not that any subscriber
  observed it. Authoritative runtime notifications still rely on committed state plus rebaseline,
  not the publish boolean. For dropping/sliding telemetry or rebuildable hints, `false` may be
  ignored or logged as best-effort, but the path must not claim durable delivery.
- Snapshot-then-stream or otherwise lossless handoff is a `svvy` runtime policy, not a durability
  guarantee provided by Effect. APIs that promise that handoff acquire
  `const subscription = yield* PubSub.subscribe(pubsub)` in the consumer/API scope before the
  initial read, keep that subscription scope open until the consumer closes it, and return or record
  the initial read's app-runtime high-water sequence. The exposed stream then emits only events
  whose `sequence` is greater than that high-water mark, or documents a duplicate-safe invalidation
  contract where consumers de-dupe by sequence before refetching. A handoff that subscribes before
  reading but does not define the snapshot cursor and post-snapshot filter is incomplete.
- `Stream` is used for runtime events, pi turn output, command stdout/stderr, subprocess output, and
  source invalidation hints. It is not used as a durable read model, persisted queue,
  renderer-owned snapshot, or transcript reconstruction source.
- Use `PubSub` for named runtime notification hubs and subscription APIs. `Stream.broadcast`,
  `Stream.broadcastN`, and `Stream.share` are allowed only for package-local fanout of one
  already-owned source stream, with explicit scope, capacity, replay, and idle-time policy. They are
  not runtime event buses, durable replay, or public subscription contracts.
- Adopted stream constructors are explicit: `Stream.fromIterable` for finite in-memory values,
  `Stream.fromEffectSchedule` for schedule-driven polling, `Stream.paginate` for pull-style
  pagination, `Stream.fromAsyncIterable` only at Promise/bridge boundaries with typed error
  mapping, `Stream.fromEventListener` or `Stream.callback` only for host event adapters,
  `Stream.fromReadableStream` for standard Web `ReadableStream` values, and
  `NodeStream.fromReadable` only for Node-compatible `node:stream.Readable` values at Node or Bun
  Node-compat host edges. Use `BunStream.fromReadableStream` only in Bun-hosted adapters when the
  owned stream reader supports Bun's `readMany` API. Domain services still consume package-owned
  `Stream` values and must not import platform stream modules directly. Terminal consumers use
  `Stream.runCollect`, `Stream.runDrain`, `Stream.runFold`, `Stream.runHead`, or `Stream.runLast`
  according to the intended product result. Do not use removed v3 stream names or collect unbounded
  command/event streams into memory. Removed v3 async constructors, including
  `Stream.asyncScoped`, are not adopted; host callback bridges use `Stream.callback`.
- Use `Stream.scoped(...)` when the stream itself requires `Scope` and the stream run should own
  its finalizers. Use `Stream.unwrap(...)` for lazy stream construction or selection from an effect;
  v4 provides the stream scope to that effect, so scoped acquisitions inside the effect are valid
  and close when the stream closes. For snapshot-then-stream APIs where a subscription must precede
  an external initial read, acquire `const subscription = yield* PubSub.subscribe(pubsub)` in the
  consumer/API scope before the read, then expose `Stream.fromSubscription(subscription)` or a
  scoped loop over `PubSub.take(subscription)`.
- `Stream.callback` adapters model host close/completion with `Queue.end(queue)`, host errors with
  `Queue.fail` / `Queue.failCause`, and adapter teardown with scoped cleanup or
  `Effect.acquireRelease`. Long-lived callback streams choose `bufferSize` and `strategy`
  deliberately; the v4 default buffer is unbounded and is allowed only for finite,
  operation-scoped adapters whose maximum emission count is proven by the owning package. Long-lived
  `Stream.callback` adapters must pass an explicit `bufferSize` and `strategy`. Dropping/sliding
  callback buffers are allowed only for rebuildable, non-authoritative hints.
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
  publication receipt recording. Implement it with a one-permit `Semaphore`, a `SynchronizedRef`
  state machine, or an internal ordered event queue owned by the event-bus service. Concurrent state
  commits may enqueue notifications, but they must not publish sequence `2` before sequence `1` or
  append replay records in a different order from the exposed app-runtime sequence cursor.
- Authoritative event publishers check the yielded result of the runtime fanout primitive they use.
  For public `Runtime.events(...)`, a yielded `false` result from `Queue.offer(...)` on a matching
  subscriber means that subscriber is slow or closed; runtime closes that subscriber with a typed
  slow-consumer/rebaseline receipt and does not claim the event was delivered to it. For
  package-local PubSub hubs, the
  `PubSub.publish(...)` boolean means the operation was accepted by the hub strategy, not that every
  subscriber observed the value losslessly. Dropping/sliding telemetry and rebuildable hint lanes
  may accept lossy semantics only when their owning package spec says loss is acceptable.
- Lossless PubSub consumers that must avoid a publish race acquire
  `const subscription = yield* PubSub.subscribe(pubsub)` in the consumer scope before initial sync
  or other publish-sensitive work, then consume the acquired subscription with
  `Stream.fromSubscription(subscription)` or a scoped loop over `PubSub.take(subscription)`. Use
  `Stream.fromPubSub(pubsub)` only when lazy subscription at stream run time is acceptable. Do not
  fork `Stream.fromPubSub(...).pipe(Stream.runForEach, ...)` and assume the subscription is active
  before the next state read or publish.
- Durable queue rows remain in `@svvy/state`.
- Use `Effect.all` and `Effect.forEach` with explicit `concurrency` for independent finite
  collections whose order does not define product behavior, such as extension readiness probes,
  provider metadata probes, source fingerprint reads, generated-package validation, app-log
  notification fanout, and recovery scans. Use `Effect.withConcurrency(...)` to set a scoped default
  only when every nested parallel operation in that scope has the same product bound.
  `References.CurrentConcurrency` is an allowed app/package reference only for that same bounded,
  scoped fanout default. Durable owner serialization, including prompt locks, queue claims, command
  output ordering, state transactions, and per-surface runtime scope lanes, still uses explicit
  semaphores, queues, and transactions.
- Use `Effect.partition` for finite independent validation when product logic needs both accepted
  outputs and every diagnostic from the batch. Use `Effect.validate(..., { discard: true })` when
  only accumulated diagnostics matter and successful values should be discarded on failure.
  Boundary code maps the returned error arrays or `NonEmptyArray<E>` into the owning package's
  aggregate tagged error shape before crossing package, facade, RPC, or persistence boundaries.
  This is the default shape for source-library validation, generated-package source validation,
  extension manifest validation, provider/model binding validation, and package-boundary contract
  audits that should report all invalid inputs together.
- Do not use collection concurrency to implement persisted queue claim order, per-surface prompt
  serialization, transaction sequencing, command stdout/stderr ordering, request-input answer
  ordering, or handler report ordering. Those use state transactions, semaphores, queues, and
  explicit runtime policy.
- Effect `Queue` is allowed only for in-memory wakeups, worker worklists, and command/event
  backpressure.
- `Queue.bounded`, `Queue.sliding`, and `Queue.dropping` take numeric capacities. Replay buffers are
  a `PubSub` / stream fanout concern, not a `Queue` feature.
- `Queue.offer(queue, value)` yields `true` when the value is accepted and `false` when the queue is
  already closed or a dropping queue rejects a full-queue offer. Callers on authoritative paths must
  check the yielded boolean or otherwise prove that `false` cannot happen before treating the
  handoff as accepted.
  `Queue.offerAll(queue, values)` returns the values that were not accepted; callers must persist,
  retry, or explicitly discard those values according to the lane's data-loss policy.
- Use `Queue.takeBetween(queue, 1, max)` for bounded batch drains when a worker should wait for at
  least one in-memory hint and then process up to `max` available hints before yielding.
  `Queue.takeAll(queue)` is not an opportunistic bounded drain: it waits for at least one value when
  the queue is empty and then drains without an upper bound. Use it only when the worker explicitly
  accepts that blocking and unbounded batch behavior. `Queue.takeN(queue, n)` waits for exactly `n`
  values; use it only when the worker intentionally blocks until a full batch is available or the
  queue terminates. Use `Queue.clear` only for an immediate destructive drain of currently buffered
  messages; it does not wait for new messages and still observes terminal queue failure. Use
  `Queue.poll` for a non-blocking single optional take. Use `Queue.collect` only for finite
  producer-owned queues whose producer is guaranteed to call `Queue.end(queue)` after the final
  value; never use it inside long-lived worker loops. `Queue.end(queue)` is available only when the
  queue error channel includes `Cause.Done`; finite producer-owned queues that need graceful
  completion are typed as `Queue.Queue<A, E | Cause.Done>` or
  `Queue.Enqueue<A, E | Cause.Done>`. Batch drains must still re-read authoritative product state
  when the queue carries only wakeup hints.
- `PubSub.bounded(capacity)` is the normal backpressured hub. `PubSub.bounded({ capacity, replay })`
  is allowed only for bounded recent-notification replay and must not be treated as durable
  recovery. Every runtime notification hub that uses replay names its replay count, overflow result,
  subscriber slow path, and rebaseline read model in the owning package spec.
- `PubSub.dropping`, `PubSub.sliding`, and `PubSub.unbounded` are not default runtime-event hubs.
  Use dropping/sliding only for rebuildable hints or telemetry. Use unbounded only when producer
  cardinality is finite and documented. `PubSub.publishUnsafe` is diagnostic or best-effort only and
  must not publish durable events, command facts, queue delivery, or app-log persistence.
- Use `Queue.bounded` for lossless in-memory handoff paths. Use `Queue.sliding` or
  `Queue.dropping` only for explicitly non-authoritative hints that can be rebuilt. Avoid
  `Queue.unbounded` unless the producer cardinality and memory bound are documented. Long-lived
  queues are shut down in their owning scope with `Queue.shutdown`.
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
  stopping. Normal graceful completion of a queue-backed stream uses `Queue.end(queue)`. Do not use
  shutdown to mean "all work was processed successfully."
- `Queue.end(queue)` means graceful producer completion. `Queue.fail` / `Queue.failCause` means typed
  queue-backed protocol failure. `Queue.interrupt`
  means graceful interruption after buffered messages drain. `Queue.shutdown` remains scope
  teardown and immediate discard.
- When a service exposes an in-memory queue to collaborators, expose `Queue.Enqueue<A, E>` to
  producers through `Queue.asEnqueue(queue)` and `Queue.Dequeue<A, E>` to consumers through
  `Queue.asDequeue(queue)` instead of handing out the full `Queue` unless both sides intentionally
  need full queue authority. This is a TypeScript capability boundary only; the owning service still
  owns scope, shutdown, capacity, and durable recovery semantics.
- Queue-to-stream adapters are allowed only for process-local handoff streams. Use
  `Stream.fromQueue(Queue.asDequeue(queue))` for a scoped queue consumer, `Stream.toQueue(...)` only
  when a stream-backed queue is owned by the same scope, and `Stream.runIntoQueue(...)` only when the
  consumer owns queue shutdown. Durable surface queues remain SQLite rows.
- `Channel` is low-level stream machinery. Use it only inside package-local protocol, framing,
  encoding/decoding, or backpressure adapters where ordinary `Stream` combinators would obscure the
  actual protocol. `Channel` implementations stay behind package-owned service methods or streams;
  they are not public package APIs, durable event logs, read-model stores, queue state, transcript
  reconstruction, or UI refetch mechanisms. Use `Stream.pipeThroughChannel(...)` only when the
  channel intentionally owns the upstream error protocol. Use
  `Stream.pipeThroughChannelOrFail(...)` when upstream stream failures must survive alongside
  framing/codec failures.
- `Sink` is allowed for scoped finite stream consumption and reductions such as collecting a bounded
  probe response, folding command-output batches before persistence, or test assertions over stream
  output. Long-lived runtime consumers should be explicit scoped stream loops when ordering,
  shutdown, or backpressure policy matters. `Sink` does not own durable state, app-log storage,
  event replay, queue claims, or renderer snapshots.

```ts
const dirtyWakeups = yield* SynchronizedRef.make(new Set<QueueWakeupKey>());
const wakeups = yield* Queue.sliding<QueueWakeupKey>(1024);
yield* Effect.addFinalizer(() => Queue.shutdown(wakeups).pipe(Effect.asVoid));

yield*
  Stream.fromQueue(Queue.asDequeue(wakeups)).pipe(
    Stream.runForEach(() => drainDirtyDurableQueue(dirtyWakeups)),
    Effect.forkScoped,
  );
```

- Runtime queue wakeups carry only non-authoritative keys or hints, such as workspace id,
  surface id, queue domain, or recovery lane. They are offered only after the durable transaction
  that created or changed the row commits and never while holding the state transaction. Wakeup
  consumers drain authoritative state until no eligible rows remain; correctness never depends on
  receiving every in-memory wakeup value. Use `Queue.bounded` only when producer backpressure is the
  intended and tested behavior. Rebuildable hints prefer coalescing plus `Queue.sliding` or
  `Queue.dropping`, backed by periodic recovery scans. Every long-lived queue has a scoped drain
  fiber and a shutdown finalizer.
- Rebuildable queue wake hints update dirty-key/coalescing state before offering the wake signal. If
  the yielded `Queue.offer(...)` result is `false`, the dirty key remains recorded and the worker
  must still discover it through the next drain, explicit wake, or recovery scan. Tests set wake capacity to
  one, force a failed offer, and prove committed queue rows are still claimed.
- Lossless delivery is required for pi turn events, transcript stream deltas, command output needed
  for command facts, queue delivery work, and terminal command lifecycle events. Bounded queues,
  pubsubs, and streams use backpressure for those paths rather than dropping or sliding messages.
- Runtime notification fanout must not use `PubSub.dropping`, `PubSub.sliding`, `Queue.sliding`,
  `Queue.dropping`, or `SubscriptionRef` in a way that silently loses runtime events. Runtime owns
  per-subscriber sequence accounting. If a bounded subscriber buffer cannot accept the next event,
  runtime closes that subscriber with the typed slow-consumer/rebaseline result before exposing
  further events. Rebaseline-able means recoverable from state, not silently droppable.
- Command output may be batched for UI efficiency with `Stream.groupedWithin(maxChunks, maxLatency)`
  or an equivalent state-owned byte/line batcher. Batching must preserve sequence and stdout/stderr
  ordering facts, flush at terminal command completion, and never drop output required for command
  facts, summaries, artifacts, or inspector/read-model state. Batching reduces renderer patch
  frequency; it is not a data-loss policy.
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
  authoritative for request-input waits, approval waits, protocol requests, command continuations,
  and bridge request/response state. The scoped runtime service may keep a
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
- Complete process-local wait `Deferred`s with explicit v4 operations: use
  `Deferred.succeed(deferred, value)` when a user/default answer resolves a blocking request;
  `Deferred.fail(deferred, error)` for typed terminal wait failure; `Deferred.interrupt(deferred)`
  or `Deferred.interruptWith(deferred, fiberId)` when the owning turn, surface, or runtime scope is
  cancelled/interrupted; and `Deferred.done(deferred, exit)` when the terminal result is already
  modeled as an `Exit`. Treat the returned boolean as an idempotency signal and still remove the
  wait-registry entry on every terminal path. Use `Deferred.isDone` or `Deferred.poll` only for
  diagnostics/tests, not as durable request-input state.
- `Latch` is used for reusable scoped readiness gates such as “initial source scan completed” or
  “event subscription is attached.” Do not model reusable gates with a `Deferred` that is replaced
  by hand; use `Latch` or a `SynchronizedRef` state machine. Use `Latch.open` for one-time readiness
  that should release current and future waiters, `Latch.close` when a reusable phase gate must make
  future waiters suspend again, and `Latch.release` only for “wake current waiters but keep the gate
  closed” semantics such as one scan cycle or one subscription-attachment handoff. Use
  `Latch.await` / `Latch.whenOpen` for readiness waits instead of polling live refs.
- In Effect v4, `Ref`, `Deferred`, and `Fiber` values are not Effect subtypes. Use explicit module
  operations such as `Ref.get(ref)`, `Deferred.await(deferred)`, and `Fiber.join(fiber)` /
  `Fiber.await(fiber)`. Do not `yield*` a `Ref`, `Deferred`, or `Fiber` value or pass those values to
  Effect combinators as if they were effects.
- Use `Ref` for pure atomic state reads, writes, and transformations. Use
  `SynchronizedRef.modifyEffect` / `SynchronizedRef.updateEffect` only for short effectful critical
  sections where the whole effect must be serialized with the in-memory state transition. Do not
  hold a `SynchronizedRef` semaphore across pi turns, subprocess execution, Smithers CLI work, user
  waits, stream drains, long filesystem scans, or unrelated database transactions. When durable
  state or external observations are needed, read the current in-memory state, perform the
  durable/external work outside the ref lock when possible, then commit the minimal synchronized
  handoff under `SynchronizedRef`. The exception is a deliberately serialized owner lane such as
  runtime event sequence assignment, where the package spec names the short critical section and its
  backpressure behavior. Do not `Ref.get`, perform an effectful gap, then `Ref.set` for active-turn,
  wait-registry, prompt-lock-adjacent, subscription, or command-session state.
- Synchronous mutable Effect collections such as `MutableRef`, `MutableHashMap`, `MutableHashSet`,
  `MutableList`, and similar `Mutable*` modules are not default package state primitives. Prefer
  immutable values inside `Ref`/`SynchronizedRef`, scoped registries such as `FiberMap`/`FiberSet`,
  or small package-owned maps hidden behind a service. A `Mutable*` module is allowed only inside a
  package-private hot path or foreign-adapter boundary when the owning package spec names the
  performance/product reason, mutation scope, concurrency assumptions, tests, and why `Ref` or an
  immutable data structure is insufficient. Mutable collections must never cross a public package
  boundary, renderer bridge, runtime event, state port, or generated package contract.
- `FiberHandle`, `FiberMap`, `FiberSet`, `Semaphore`, `Ref`, `SynchronizedRef`, and `ScopedRef` are
  scoped live-runtime machinery. `FiberHandle` owns one replaceable fiber lane such as latest scan,
  latest title job, or latest refresh worker. `FiberMap` and `FiberSet` are created inside a
  `Scope`, automatically remove completed fibers, and interrupt tracked fibers when the scope
  closes. `ScopedRef` owns a replaceable scoped value such as a protocol client, subscription, or
  helper handle and closes the previous value's scope on replacement. These values are disposed with
  workspace/surface/runtime scopes and reconstructed from durable state during recovery.
- `Fiber` from `effect/Fiber` is allowed for awaiting, joining, interrupting, or inspecting fibers
  already owned by the current scope, a `FiberHandle`, `FiberMap`, or `FiberSet`. It is not a
  separate ownership model for runtime work; untracked `Fiber` references must not be stored in
  state, service maps, renderer objects, or bridge payloads.
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
  borrows are allowed to finish with the old snapshot.
- Process-local `Cache`, `ScopedCache`, `RcMap`, and hash-collection keys are branded strings or
  numbers by default. If a key is structured, define it with `Data.Class` or another type that
  implements coherent `Equal` and `Hash` semantics; do not use fresh plain object literals as
  logical keys.
- In Effect programs, allocate live coordination primitives with `Deferred.make`, `Latch.make`,
  `Ref.make`, `SynchronizedRef.make`, `SubscriptionRef.make`, `Semaphore.make`,
  `FiberHandle.make`, `FiberMap.make`, `FiberSet.make`, `ScopedRef.fromAcquire`, and
  `ScopedRef.make` as appropriate. `FiberHandle`, `FiberMap`, `FiberSet`, and `ScopedRef`
  constructors must run in the owning `Scope`; they are not package globals. Use `makeUnsafe` /
  unsafe acquire variants only at synchronous construction edges where the owner can prove the value
  is immediately installed into a scoped service or test fixture and will be closed by that scope.
- `FiberHandle.makeRuntime`, `FiberMap.makeRuntime`, and `FiberSet.makeRuntime` are allowed only
  inside an already scoped owning service to adapt callback-style or imperative registration APIs
  into scoped fibers. They do not replace the app-level `ManagedRuntime`, must not be exposed as
  public package facades, and must not be stored in product state, renderer objects, or bridge
  payloads. Use the Promise variants only when a foreign API requires Promise-returning callbacks,
  and map rejection or squashed causes back into typed package errors before crossing a svvy package
  boundary. Closing the owner `Scope` remains the lifecycle boundary that interrupts the tracked
  fibers.
- Use `Semaphore.withPermit` / `Semaphore.withPermits` for prompt locks and concurrency limits
  unless a lower-level protocol genuinely needs manual `take` / `release`; automatic permit release
  on effect exit is the default lock-safety rule. Use `Semaphore.withPermitsIfAvailable` only when
  the product behavior is explicitly “skip or return busy if capacity is unavailable now,” such as a
  noncritical background probe, never for required queue claims or prompt turns.
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

Runtime supervision uses scoped `FiberMap` / `FiberSet`, not untracked forks:

```ts
const activeTurns = yield* FiberMap.make<SurfacePiSessionId, void, RuntimeTurnError>();

const startTurn = Effect.fn("@svvy/runtime/SurfaceTurns.start")(function* (input: TurnInput) {
  yield* acquirePromptTurnLockOrFail(input.surfacePiSessionId);

  if (yield* FiberMap.has(activeTurns, input.surfacePiSessionId)) {
    yield* releasePromptTurnLock(input.surfacePiSessionId);
    return yield* Effect.fail(
      new TurnAlreadyActive({ surfacePiSessionId: input.surfacePiSessionId }),
    );
  }

  yield* FiberMap.run(
    activeTurns,
    input.surfacePiSessionId,
    runTurn(input).pipe(
      Effect.exit,
      Effect.flatMap((exit) => settleTurnFromExit(input, exit)),
    ),
  ).pipe(Effect.asVoid);
});

const abortTurn = Effect.fn("@svvy/runtime/SurfaceTurns.abort")(function* (surfacePiSessionId) {
  yield* FiberMap.remove(activeTurns, surfacePiSessionId);
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

`LayerMap` is allowed only for scoped keyed resource ownership where the key has a stable product
identity and the package spec names the owner. The owning service defines the key type, canonical key
serialization/equality rule, layer factory, acquisition input, finalizer, invalidation trigger, and
tests. Callers use `.get(key)` only when they need a service value from a long-lived acquired scoped
resource; they use `.contextEffect(key)` only when they need to run a program in that keyed resource
context without exposing the service value. `invalidate(key)` is owned by the same runtime/service
that owns the key lifecycle and is used for explicit workspace/surface/session replacement,
source-fingerprint changes, or shutdown. It is not a cache eviction API for read models, generated
context strings, provider metadata, command facts, app logs, or durable queue rows. LayerMap keys
must not be UI panel ids, arbitrary object literals, file path strings before canonicalization, or
mutable config snapshots.

`ScopedRef.set(...)` closes the previous scoped value before acquiring the replacement. Use it only
for hard replacement where downtime and failed refresh leaving no active value are acceptable and
documented. For no-gap client/protocol/provider rotation, acquire the replacement in a child scope
first, install it through a `SynchronizedRef` handoff only after successful acquisition, then close
the old scope after the new value is live. Tests cover both failed replacement and old-resource
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
implementation defaults. Their target implementation uses already adopted process-local primitives
such as `Queue`, `Ref`, `SynchronizedRef`, `Deferred`, `Semaphore`, `FiberMap`, `FiberSet`, and
`Schedule`. `Effect.tx`, `Effect.txRetry`, `TxQueue`, `TxRef`, `TxPubSub`, `TxSemaphore`, and other
`Tx*` helpers remain unadopted for worker utilities until an owning package spec adds the exact
adoption record, import allowlist, failure semantics, and tests. Worker utilities must be adapted to
svvy's durable-state model:

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

All command-like execution uses Effect-scoped process services:

- Shell `exec_command`
- Shell `write_stdin`
- sandbox helper launch
- `execute_typescript`
- Shell-launched `svvyx ...` CLI commands
- extension CLI requirement checks and user-triggered install/update commands
- prompt-only CLI guidance when invoked through Shell

Internal `Extensions.svvyx.run(...)` service calls inside `@svvy/extensions` and generated
`execute_typescript` extension facades are not automatically child-process execution. They are
extension service calls that return `ExtensionHandlerResult` values, generated declarations, or
app-owned command facts depending on the extension. Runtime-owned work is represented as ordered
`ExtensionRuntimeOperation` items on the handler result. When an extension operation actually
launches a child process, that launch follows the process rules in this section; when it is an
in-process app-owned implementation, it must not be documented or projected as shell output merely
because its agent-facing command name begins with `svvyx`.

Durable user-visible command sessions, sandboxed Shell execution, `write_stdin` continuations,
command cancellation, stdout/stderr persistence, and terminal command facts are runtime-owned. An
extension service may launch a short app-owned helper only when that helper is part of extension
source/build/readiness work and does not need a durable command session. Otherwise the extension
returns an `ExtensionHandlerResult` with ordered `ExtensionRuntimeOperation` items for
`@svvy/runtime` to process.

Trusted shell-dispatched `svvyx` child adapters may return signed subprocess result payloads
containing structured output, JSON command facts, progress facts, app-log facts, and closed signed
transport intents for the parent to validate. The signed result is a serialization boundary for
parent-owned replay, not an Effect runtime boundary, not a public runtime subpath, and not a second
state API. A child adapter must not create `ManagedRuntime`, call `Effect.run*`, open SQLite product
databases, construct product state ports, publish runtime/read-model events, mutate
artifact/profile/session/thread state directly, or choose the owning session, thread, source
command, or surface. The parent command-session service validates the signed result, derives
ownership from trusted runtime context, decodes `runtime_effect.request` transport intents through
`@svvy/core`'s `SvvyxRuntimeEffectTransportIntentSchema` codecs, and patches the parent command
facts/model-facing output through the app-private command-session code and the state facade already
present in trusted runtime context. The Bun transport does not define a duplicate runtime-effect
transport request type, validator, or public applier.

Allowed transport intents are explicit and schema-backed. The supported closed transport intent is
`runtime_effect.request`; it is limited to the explicit context-impact transport requests.
Additional transport intents require a product reason, a typed `@svvy/core` contract, a
parent-owned replay rule in runtime/app command-session code, and fail-closed tests. Artifact work must use normal
runtime-owned command facts, `RuntimeEffectRequest`, or `ExtensionExecutionPlan` operations. Tests
prove unsigned, malformed, or user-extension signed results fail closed.

Allowed extension-owned helper subprocesses are bounded source/build/readiness probes such as
exact-version CLI requirement checks, generated instruction/source builds, schema/declaration
generation, and package validation work whose stdout/stderr is consumed by the extension service
and whose result is recorded as extension/build facts. They are not durable command sessions, are
not user-visible Shell command cards, cannot be continued with `write_stdin`, and cannot be
cancelled through public `Runtime.commands.cancel(...)`. Any execution that needs user-visible
streaming, approval linkage, sandbox launch policy, stdin continuation, command inspection,
artifact linkage, or terminal command facts belongs to runtime command/session services.

Extension handler effects are request-bounded. Any resource they acquire directly is
`operationScoped` and is released before the handler returns, fails, or is interrupted. Handlers do
not retain scoped handles, fibers, subprocess handles, queues, pubsubs, watchers, protocol clients,
or mutable refs for later tool calls. Long-lived command sessions, workflow task-agent bridge
attempts, source watchers, generated-package refresh workers, durable waits, and answer-delivery
work are represented as `ExtensionRuntimeOperation` items wrapping closed `RuntimeEffectRequest`
values, immutable `ExtensionExecutionPlan` values, or runtime-owned service calls.

Use the `ChildProcess.Command` type for immutable command descriptions, create concrete commands
with `ChildProcess.make(...)`, and run them through the injected
`ChildProcessSpawner.ChildProcessSpawner` service. The reference docs import these through the
process barrel, for example `import { ChildProcess, ChildProcessSpawner } from
"effect/unstable/process"`; that barrel import is the documented local v4 process import path.
Narrower direct subpath imports are allowed only when the installed Effect package exports that
subpath. Runtime code must not hide executable/argument/env decisions inside ad hoc string
concatenation when a direct command description is available.

Shell `exec_command` is the only normal product boundary that accepts a user-authored shell string.
Runtime first converts that request into a canonical shell launch plan before spawning:

- `command`: the exact user-authored shell string after approval segmentation, stored for command
  facts and never reserialized from parsed argv pieces.
- `shellExecutable`: resolved from the user's configured shell or the host fallback, recorded as an
  absolute executable path when known.
- `shellArgs`: explicit shell invocation args such as `["-lc", command]` or the selected
  non-login/login equivalent. The plan names whether login semantics are enabled.
- `cwd`: resolved through the workspace/worktree path service and sandbox policy before launch.
- `env`: explicit filtered env with `extendEnv: false`.
- `approvalSegments`: the app/runtime approval-review segments derived from the shell-control
  grammar before launch.
- `sandboxPolicy`: the immutable sandbox/network policy snapshot applied to the helper.

Shell mode is allowed only for Shell requests, prompt-only official CLI guidance issued through
Shell, and app-owned CLI entrypoints whose spec says a shell is part of the interface. Extension
handlers, runtime services, `svvyx` in-process dispatch, dependency checks, and helper protocols use
direct executable/argument plans unless their owning package spec explicitly requires shell
compatibility. Do not pass `shell: true`, ambient env inheritance, or raw shell strings directly to
the platform spawner outside this launch-plan boundary.

The Shell launch plan is executed as a direct executable invocation:
`ChildProcess.make(shellExecutable, shellArgs, options)`. Runtime does not use
`CommandOptions.shell: true` for Shell requests, because that delegates shell selection, argument
construction, and quoting semantics back to the host. The selected shell is represented by
`shellExecutable` plus explicit `shellArgs`; `CommandOptions.shell` remains unset unless a narrow
host adapter spec names a different platform requirement.

Long-running or interactive commands normally construct `const command = ChildProcess.make(...)`
and run it with `yield* command` inside a scope. That uses the injected
`ChildProcessSpawner.ChildProcessSpawner` service and returns a `ChildProcessHandle`. Code that
needs to call the spawner explicitly yields `const spawner = yield*
ChildProcessSpawner.ChildProcessSpawner` and then calls `yield* spawner.spawn(command)`.
`ChildProcessSpawner.spawn(...)` is not a module-static call. Consumers use the returned handle's
`stdin`, `stdout`, `stderr`, `all`, `exitCode`, `kill`, and `isRunning`. Reserve `string`,
`lines`, `streamString`, and `streamLines` helpers for simple collection or probe cases such as
CLI version checks, dependency readiness probes, or host capability probes. User-visible Shell,
Smithers, `svvyx`, install/update, Apply Patch, and `execute_typescript` command sessions must not
use those helpers because durable projection needs scoped handles, ordered stdout/stderr,
cancellation facts, stdin lanes, artifacts, child-command links, and terminal facts.
`ChildProcessHandle.pid` may be recorded only as redacted process diagnostics and never as durable
identity. `getInputFd` and `getOutputFd` are allowed only inside package-owned low-level protocol
adapters that need file-descriptor handoff and prove close behavior; ordinary command sessions use
the typed streams above. `unref` is process-edge only and must not be used by runtime-owned command
sessions because runtime must retain shutdown, cancellation, and terminal-fact authority over every
accepted child process.
`ChildProcess.pipeTo(...)` is allowed only for internal helper pipelines whose intermediate process
outputs are not user-visible command boundaries and whose combined command facts still identify the
complete pipeline. User-visible Shell, Apply Patch, `execute_typescript`, Smithers, and `svvyx`
work prefer explicit command steps or one shell command captured as written so approvals,
cancellation, stdout/stderr grouping, child-command links, and terminal facts stay explainable.

Process services depend on `ChildProcessSpawner.ChildProcessSpawner`. App bootstrap layers provide
the platform spawner implementation through a svvy-owned Bun/Electrobun host adapter typed as that
abstract service. Although `@effect/platform-bun` is adopted for file/path/crypto services,
`BunServices.layer` and `BunChildProcessSpawner.layer` are not adopted for process spawning until an
owning package/spec row and boundary allowlist name them; those concrete platform imports remain
private to approved bootstrap/live-adapter modules. `@effect/platform-node` is script/test-only
unless a shipped Node host is introduced by PRD and package-spec updates. Tests provide fake
`ChildProcessSpawner.ChildProcessSpawner` layers.

Subprocess environment is part of the runtime launch plan. Runtime or the owning extension service
resolves the complete effective env map before launch, including redacted extension env injection,
bridge tokens, sandbox helper variables, and any safe host variables. Package code must not pass
ambient `process.env` through by default. Runtime-owned launches set an explicit filtered `env` map
and `extendEnv: false`. In Node-compatible platform spawners, `extendEnv: true` merges
`globalThis.process.env`; otherwise the resolved environment is exactly `options.env`. If `env` is
omitted, the host spawn call receives `env: undefined`, which inherits the host environment.
Leaving `env` undefined is therefore banned outside host adapter modules. `ChildProcess`
`extendEnv` is forbidden in domain services unless the host adapter has already filtered the
inherited env through an explicit allowlist and the command plan records that inheritance. Secret
values are unwrapped only at the trusted invocation boundary and are never copied into command
facts, events, app logs, transcripts, generated declarations, artifacts, or read models.

Sandbox helper execution is a runtime-owned command launch. `@svvy/sandbox` resolves an immutable
launch policy: helper executable path, helper arguments, temporary profile file or profile text,
filtered helper env additions, network policy, writable/read-only roots, and denial-classification
rules. The sandbox package may create scoped temporary profile files through injected
`FileSystem.FileSystem`, but it does not spawn the child process, own stdin/stdout streams,
terminalize command facts, or retry without sandboxing. `@svvy/runtime` combines that launch policy
with the approved command plan and runs the helper through
`ChildProcessSpawner.ChildProcessSpawner`. `approvalMode: "full-access"` is the only normal path
that omits the sandbox helper; sandbox-denial exits or stderr are classified as sandbox denial
rather than retried as unsandboxed commands.

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

Command cancellation uses the returned `ChildProcessHandle.kill(...)`, normally with explicit
`KillOptions` such as `{ killSignal: "SIGTERM", forceKillAfter: "5 seconds" }` when product
cancellation must guarantee cleanup. `ChildProcessHandle.exitCode` is an `Effect` that waits for
process exit and returns the exit code; runtime awaits it in the terminal watcher or forks that
watcher in the command-session scope. Unexpected signal details are available only when the host
adapter exposes them as structured data; otherwise they appear as a platform failure.
Runtime-initiated cancellation records the requested `killSignal`, `forceKillAfter`, and whether the
forced path was used.

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

Durable command-session launch example:

This example assumes it runs inside the runtime-owned command-session scope. If the same pattern is
used as a one-shot operation, wrap the process effect in `Effect.scoped`. If it is used under a
long-lived command session, run it in the command-session scope with the package's explicit scope
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
an exit-code watcher, and a scope cleanup finalizer that does not record cancellation facts.
Product code may adapt the exact helper names to the installed Effect process API, but it must
preserve those product properties. Spawner collection helpers such as `spawner.string(command)`,
`spawner.lines(command)`, `spawner.streamString(command)`, and `spawner.streamLines(command)` are
not used for user-visible durable command facts because they collapse process lifetime, output
ownership, cancellation, and fact recording into a collection helper.

Every spawned child stream must be consumed, drained, or explicitly closed. Protocol subprocesses
that use only stdout/stdin still drain stderr in a scoped background fiber so large stderr output
cannot block the child process. Regression tests for protocol adapters include a child that writes
large stderr output while serving successful protocol responses.

Long-running interactive command sessions are scoped runtime resources keyed by durable
command/session id. The scoped command-session service owns the `ChildProcessHandle`, stdin writer,
output consumers, terminal watcher, and cancellation finalizer. `write_stdin` resolves the durable
session id through that service and never receives the raw handle. Accepted stdin chunks enter a
per-command `Queue.dropping(commandStdinQueueCapacity)` admission queue. Effect v4
`Queue.offer(...)` on a dropping queue yields `false` when a full queue rejects the new value;
runtime maps that boolean rejection to typed backpressure immediately instead of suspending the
caller, and the stdin writer drains accepted chunks losslessly and in FIFO order. Terminal command facts close the session scope. Durable state
stores command ids, session ids, output, accepted stdin write receipts, status, and facts. The
accepted stdin receipt stores the exact admitted text plus `acceptedBytes`; it is product command
history, not a process handle or writer. Durable state never stores process handles, streams, abort
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
- fork reader, writer, heartbeat, and stderr-drain loops with `Effect.forkScoped`
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
`effect/ChannelSchema` is allowed at the same adapter boundary when the protocol is already modeled
as a `Channel` and the format-specific helpers do not fit; it must use the same source `Schema`
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

Services that need outbound HTTP depend on an injected `HttpClient.HttpClient`. They do not construct
global fetch clients, read auth directly from env, or assume `BunServices.layer` provides HTTP. The
app or test harness supplies the app-owned network-policy HTTP layer, backed internally by adopted
raw host layers such as `FetchHttpClient.layer`, a fake raw client layer, or another explicit
host-owned raw client layer. `@effect/platform-bun/BunHttpClient` is not adopted by the current
product; it can back the policy layer only after its own owning spec row and boundary allowlist
land.
`FetchHttpClient.layer` and fetch-backed platform layers must be wrapped by the same app-owned
policy layer, with app/bootstrap providing or overriding the `FetchHttpClient.Fetch`
`Context.Reference` explicitly when the raw client uses fetch. Reusable packages and tests do not
rely on a raw fetch-backed layer implicitly
capturing `globalThis.fetch` and do not provide raw platform HTTP layers directly.

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
reference-only until separately adopted.

Outbound request bodies use `yield* request.pipe(HttpClientRequest.schemaBodyJson(schema)(value))`
or `yield* HttpClientRequest.schemaBodyJson(schema)(request, value)` when a request schema is
available; the helper returns an `Effect` that produces the updated request. When a schema helper is
not usable at a trusted HTTP edge, encode the value with the hoisted schema first and call
`HttpClientRequest.bodyJsonUnsafe(encoded)` only with that encoded JSON value. JSON responses are
decoded with hoisted schemas, preferably
`HttpClientResponse.schemaBodyJson(schema)`, before they cross the package boundary. Services classify
non-2xx responses by using or providing an `HttpClient.HttpClient` transformed with
`HttpClient.filterStatusOk`, by applying `HttpClientResponse.filterStatusOk` at the response boundary,
or by equivalent typed status handling. HTTP boundary code may use
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
authentication failures, schema failures, or deterministic provider/model incompatibility. Package
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

- Effect programs use `DateTime.now`, `Clock`, `Schedule`, and `TestClock`.
- Runtime code must not use `Date.now()`, `DateTime.nowUnsafe()`,
  `clock.currentTimeMillisUnsafe()`, or `clock.currentTimeNanosUnsafe()` for claim leases, retries,
  waits, title jobs, source invalidation, command timings, or recovery. These unsafe reads bypass
  the Effect `Clock` service's testable effect surface. Unsafe current-time reads are limited to
  explicit bootstrap or diagnostic edges.
- Request-path retry and polling schedules must be bounded with `Schedule.recurs`,
  `Schedule.during`, or both. `Schedule.recurs(n)` means `n` follow-up executions after the first
  attempt. Classify retryable failures with
  `Effect.retry({ schedule, while: (error) => error.retryable })`, where `schedule` is a
  `Schedule<_, Failure>`; or use the builder form when inference matters:
  `Effect.retry(($) => $(schedule).pipe(Schedule.while(({ input }) => isRetryable(input))))`.
  Timing policy alone must not decide retryability. Polling that should return the latest
  successful status uses `Schedule.passthrough`.
- Provider, HTTP, CLI requirement, and host probe retries use capped jittered backoff, for example a
  bounded exponential schedule with `Schedule.jittered`, after typed retryability classification.
  Use `Schedule.modifyDelay` when the policy caps, replaces, or compares the selected delay,
  including capped reconnect backoff. Use `Schedule.addDelay` only when an additional delay derived
  from schedule output should be added to the selected delay. Do not hide fixed sleeps in the
  retried effect body.
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
  - status polling uses `Effect.repeat(...)` or `Stream.fromEffectSchedule(...)` with
    `Schedule.passthrough` when callers need the latest successful status value.
  - background cadence uses a scoped worker fiber with a named `Schedule.spaced` / `fixed` /
    `windowed` policy plus a terminal worker policy and shutdown scope.
  - debounce/coalescing tests fork the worker, advance `TestClock`, then wait on drain handles,
    receipts, or readiness barriers; they do not use host timers, microtask flushing, or polling as
    completion signals.
- Background cadence uses `Schedule.spaced` when the next run should wait until after the prior run
  completes, `Schedule.fixed` for aligned interval cadence, `Schedule.windowed` when work should
  align to fixed windows, `Schedule.cron` only for human calendar semantics, and `Schedule.andThen`
  when a startup phase and steady-state phase are intentionally different.
  Package specs must name the cadence, first-run behavior, and shutdown scope for every long-lived
  background schedule. Runtime source invalidation, request-input timeouts, provider/CLI retries,
  command grace periods, generated-package refresh, workspace-link repair, and recovery sweeps are
  not calendar jobs and must not use `Schedule.cron`.
- Use `Effect.retry` for failed attempts and `Effect.repeat` for polling or reconciliation based on
  successful status values. Use `Effect.repeat` when a single effect should repeat until it returns
  a terminal value or fails. Use `Schedule.recurs(maxRetries)` for retry counts; do not use
  `Schedule.take(n)` as a retry-attempt count because it limits schedule outputs, not the same
  product concept as total effect evaluations. Use `Stream.fromEffectSchedule` when polling or
  reconciliation is itself an observable stream; it emits the initial run before scheduled
  recurrences. `Schedule.forever` and other unbounded schedules belong only in explicitly scoped
  background fibers and must be named in the owning package spec. Use `Schedule.take(n)` only when a
  long-lived cadence needs a bounded startup or probe phase before switching to another schedule.
  When combining schedules and the output matters, use `Schedule.bothLeft(...)` or
  `Schedule.bothRight(...)` instead of `Schedule.both(...)` so the retained schedule output is
  intentional.
- Use `Effect.timeout`, `Effect.timeoutOption`, or `Effect.timeoutOrElse` for request-input
  blocking timeouts, provider/helper job deadlines, protocol request deadlines, dependency probe
  limits, and bounded command shutdown windows. Persisted timeout behavior records the deadline and
  the branch that produced the result when it affects user-visible state.
- Persisted-deadline timer fibers are an allowed `Effect.sleep(remainingMs)` use when the owning
  package spec names the deadline source, recomputes remaining time from Effect `Clock` /
  `DateTime`, stores the durable deadline, versions pause/resume changes, forks the timer in an
  owner scope, and cancels/reforks it through that scope after committed changes. Fixed sleeps
  remain forbidden for polling, retries, stabilization, queue correctness, or test synchronization.
- Use `Effect.race` / `Effect.raceAll` only when the first successful result should win and early
  failures should be ignored until success or total failure. Use `Effect.raceFirst` /
  `Effect.raceAllFirst` only when the first completion, including typed failure, should decide the
  outcome. Do not race two state writes, queue claims, command fact writers, or prompt dispatches
  for the same durable owner.
- Store persisted timestamps as stable ISO strings produced from `DateTime`, normally
  `DateTime.formatIso(yield* DateTime.now)` for UTC instants.
- Time-zone conversion uses `DateTime.CurrentTimeZone`, `DateTime.withCurrentZone*`, and
  `DateTime.layerCurrentZone*` where user/workspace zone matters. Do not model current time zone as
  a custom `Context.Reference`.

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
- integration/e2e harnesses and tests that explicitly verify host-global mapping

Every other package module receives host facts through injected services or decoded bootstrap config.
The local `t3code` host-runtime rule covers platform/architecture reads; svvy extends that rule with
project-owned checks for environment, cwd, hostname, app paths, and equivalent host facts because
those values affect packaged-app behavior and must be provided through bootstrap/config services.
Use `Context.Reference` only for fiber-local Effect runtime defaults intentionally overridden per
scope, such as log level, tracing flags, current concurrency, or scheduler. Do not store app path,
workspace, package ownership, or durable settings in `Context.Reference`; durable product settings
remain `@svvy/state` data.
Scheduler/yield references such as `References.Scheduler`, `References.MaxOpsBeforeYield`, and
`References.PreventSchedulerYield` are app-edge, test, or narrowly measured hot-path tools. Domain
and runtime services do not tune scheduler/yield references unless a package spec names the measured
hot path and its starvation/fairness tradeoff. In particular, preventing scheduler yield is banned
for ordinary runtime loops, queue drains, source scans, protocol readers, command-output consumers,
and bridge subscriptions.

Configuration rules:

- App/bootstrap config is described with `Config.schema` or `Config.all` and parsed against an
  explicit `ConfigProvider`, either by yielding the config after installing
  `ConfigProvider.layer(...)` / `ConfigProvider.layerAdd(...)` or by calling
  `config.parse(provider)` at the process edge.
- `Config.unwrap(...)` is an app/bootstrap or explicit host-adapter edge operation for wrapped
  config definitions, not a domain-service API. Package root layers receive decoded config through a
  package-owned config service layer unless the package spec names a bootstrap subpath that is
  allowed to decode config for the app. `Layer.unwrap(...)` may build a layer from decoded config
  only when an explicit `ConfigProvider` has already been installed or the input is an already
  decoded config service. Domain service methods do not call `Config.unwrap(...)`.
- Domain services do not read extension env values, provider keys, app settings, workspace
  settings, profile settings, approval policy, network policy, or sandbox policy through
  `Config`. Those are product-state, keychain, or app-managed snapshots supplied through explicit
  state ports, runtime services, or immutable launch-policy inputs. `Config` is for
  process/bootstrap host env snapshots and deterministic tests.
- Package-owned bootstrap config services such as `RuntimeLayerConfigService` may be decoded at
  app/bootstrap and provided as explicit layers when they contain only process-local cadence,
  buffer, backpressure, or test knobs. They are not durable product settings, not profile/workspace
  settings, and not a path for extension env or provider credentials.
- Tests that need deterministic object-shaped config use `ConfigProvider.fromUnknown(...)`.
  Env-specific tests use `ConfigProvider.fromEnv({ env })` only when the test is specifically
  exercising environment-variable mapping.
- `ConfigProvider.fromEnv()` without an explicit env object is allowed only in exact host-global
  zones such as the app entrypoint, packaged helper entrypoint, or narrowly reviewed live host
  adapter. Reusable package layers, tests, and package-owned live services pass an explicit env
  snapshot such as `ConfigProvider.fromEnv({ env })` so configuration is deterministic and does not
  hide ambient host reads.
- Parsing `Config` without an explicitly installed `ConfigProvider.layer(...)` /
  `ConfigProvider.layerAdd(...)` is treated the same as calling ambient `ConfigProvider.fromEnv()`
  and is allowed only in those exact host-global zones. Reusable package code and tests always
  install a deterministic provider or consume an already decoded bootstrap config service.
- `ConfigProvider.layer(...)` replaces the current config provider for the supplied scope.
  `ConfigProvider.layerAdd(...)` composes with the current provider; by default the newly added
  provider is a fallback, while `{ asPrimary: true }` makes the added provider primary. Provider
  fallback occurs only when the first provider reports absence (`undefined`), not when it reports a
  source or schema error. Do not use provider fallback to hide invalid configuration.
- Host environment snapshots often arrive as `Record<string, string | undefined>`. Compact them to
  `Record<string, string>` before calling `ConfigProvider.fromEnv({ env })`; do not pass undefined
  values through the config provider boundary.
- Env providers that bridge camelCase config keys to environment variables use
  `ConfigProvider.constantCase`; apply it after `ConfigProvider.nested(...)` when the prefix should
  also be converted.
- `Config.withDefault` handles missing values only. `Config.orElse` catches every
  `Config.ConfigError`. Boundary code that maps config failures inspects the caught error
  instance's `.cause` field (`SourceError | Schema.SchemaError`) to distinguish provider/source
  failures from schema validation failures. Bootstrap config decode failures map to the startup
  error family owned by app/bootstrap or the package bootstrap subpath. Provider/source failures use
  reason `config-source-failed`; schema validation failures use reason `config-schema-failed` and
  include formatted boundary issues when the cause is `Schema.SchemaError`.
- Runtime, state, sandbox, pi-adapter, and extension bootstrap config that says invalid config must
  fail startup uses `Config.withDefault` only for missing optional values. It must not use
  `Config.orElse` or catch-all fallback to replace schema validation failures with defaults. Tests
  cover missing-value defaulting separately from invalid-value startup failure.
- `Config.nonEmptyString(...)` is a valid config API. The removed API ban applies to
  `Schema.nonEmptyString`, not `Config.nonEmptyString`.

## File, Path, Database, And Watcher Rules

- File-backed source, artifact, generated-package, prompt-source, and extension-source operations
  use injected filesystem/path services or package-owned file-store ports. They do not read/write
  via hidden globals or source-checkout-relative paths.
- Temporary command, patch, generated-package, and sandbox-helper files use the injected
  `FileSystem.FileSystem` service, for example `fs.makeTempFileScoped(...)`,
  `fs.makeTempDirectoryScoped(...)`, or scoped `fs.open(...)` when lifetime is bounded to one
  operation. Path policy and artifact/sandbox checks use injected `Path.Path` plus
  `fs.realPath(...)` where symlink or canonical-path behavior matters. Plain string concatenation
  and source-checkout-relative path resolution are not package-boundary APIs.
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

  ```ts
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const tmp = yield* fs.makeTempFileScoped({ prefix: "svvy-" });
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

  ```ts
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
- Effect SQL is not part of the active implementation target. State repository code wraps
  package-private SQLite access in Effect services and layers without importing
  `effect/unstable/sql/*` or `@effect/sql-sqlite-*`.
- The target architecture exposes no public SQLite backup, export, checkpoint, vacuum,
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
- Repository schemas use v4 schema transforms such as `Schema.decodeTo(...)` with
  `SchemaTransformation` / `SchemaGetter`, `Schema.fromJsonString(...)`, and
  `Schema.DateTimeUtcFromString` for encoded JSON and timestamp columns. Do not reintroduce v3
  parse/transform APIs in state schemas.
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
  selector/repository reads wrapped in `Stream.fromEffect`, `Stream.paginate`, or an equivalent
  state-owned pagination loop. That is not SQL driver streaming: each page is an ordinary repository
  effect with an explicit cursor/limit, row schema, ordering, and transaction policy.
- `effect/unstable/persistence` is not the product persistence layer. Do not use Effect persisted
  queues/caches/key-value stores as substitutes for `@svvy/state` tables and migrations.
- File watchers are scoped resources. Watcher events are hints that schedule deterministic
  fingerprint scans; watcher event payloads are not authoritative state.
- The source invalidation coordinator is a scoped `@svvy/runtime` Effect service. Prefer the
  injected filesystem service for watcher streams:
  `const fs = yield* FileSystem.FileSystem; const events = fs.watch(path)`. Use `Stream.callback`
  or `Effect.acquireRelease` only for custom host APIs not covered by the injected filesystem
  service. `fs.watch(path)` returns a `Stream`; constructing that stream does not start the watcher.
  The coordinator must run the stream inside its owning scope, normally with
  `Stream.runForEach(...).pipe(Effect.forkScoped)`, so shutdown closes watcher handles, pending
  debounce work, and scan fibers through scope interruption.
- Custom watcher implementations are installed as `FileSystem.WatchBackend` layers, not imported as
  Node or Bun watcher APIs inside runtime/domain services. A `WatchBackend` `register(path, stat)` returns
  `Option.some(Stream.Stream<FileSystem.WatchEvent, PlatformError.PlatformError>)` when it owns that watched path
  and `Option.none()` to fall back to the platform default. Product code still consumes watcher
  events through `const fs = yield* FileSystem.FileSystem; fs.watch(path)`. Provide custom
  `FileSystem.WatchBackend` layers into the platform `FileSystem` layer build context before the
  Bun/Node filesystem layer is merged into the app platform bundle. The Node-compatible filesystem
  captures the available watcher backend while `FileSystem.FileSystem` is acquired; providing a
  watcher backend after that service exists does not change the captured filesystem service.
  `@svvy/runtime` owns product watcher policy for source invalidation domains, including which roots
  use custom backends, debouncing, periodic reconciliation, and test fake watchers. App/bootstrap
  wires the chosen custom backend layer together with the Bun/Node filesystem layer; runtime
  services consume only `FileSystem.FileSystem`.
- Raw watcher events enter only as non-authoritative hints. They may use `Queue.sliding`,
  `Queue.dropping`, or `Stream.debounce(...)` because correctness comes from fresh deterministic
  fingerprint scans and periodic reconciliation.
- Debounce, periodic reconciliation, and retry cadence use `Clock`, `Schedule`, `Stream.debounce`,
  `Stream.fromEffectSchedule`, and `TestClock` in tests. Runtime source invalidation code must not
  use `setTimeout`, `setInterval`, `Date.now()`, Promise-based gates, or hidden global clocks.
- Runtime owns two source-invalidation coordinator services, not one generic watcher:
  - the app-global coordinator watches Workflows and Extensions source roots, performs one generated
    package refresh for the app-owned generated packages, records source/build facts through state
    ports, and fans out workspace-link repair work for affected workspaces;
  - each workspace-scoped coordinator watches external instruction candidates and discovered
    read-only host snippet Markdown sources for that workspace, records source fingerprints through
    state ports, and marks affected surfaces stale through runtime-owned invalidation work.
    Generated package output, workspace package links, DB-backed agent/profile settings, and managed
    svvy snippets are excluded from watcher triggers.
- One scan/build batch per coordinator/domain runs at a time, guarded by a one-permit semaphore
  created with `yield* Semaphore.make(1)` or by `SynchronizedRef` state. Use
  `Semaphore.makeUnsafe(1)` only at synchronous construction edges. If hints arrive while a scan is
  active, runtime records the dirty domains and runs one follow-up scan after the active scan
  finishes.
- The source invalidation coordinator has a reusable readiness gate, normally a `Latch`, for
  startup scans and rebaseline-sensitive subscribers. It must not replace `Deferred`s by hand for a
  gate that can reopen or be waited on repeatedly.
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

- Effect observability uses `Effect.withSpan`, `Stream.withSpan`, `Effect.annotateCurrentSpan`,
  `Effect.annotateSpans`, `Effect.annotateLogs`, `Effect.annotateLogsScoped`, `Effect.withLogSpan`,
  `Effect.withTracerEnabled`, `Effect.withTracerTiming`, `Layer.withSpan`, `Metric`, `Logger`,
  `LogLevel`, `Tracer`, `References.MinimumLogLevel`, `References.CurrentLogLevel`,
  `References.CurrentLogAnnotations`, `References.CurrentLogSpans`, `References.UnhandledLogLevel`,
  `References.TracerEnabled`, `References.CurrentTraceLevel`, `References.MinimumTraceLevel`,
  `References.DisablePropagation`, `Tracer.DisablePropagation`, `References.TracerSpanAnnotations`,
  `References.TracerSpanLinks`, and `References.TracerTimingEnabled` at service boundaries. Runtime
  and command flows record
  counters/timers for queue claim latency, turn duration, command duration, recovery attempts, and
  provider/pi-adapter activity.
- Use `Stream.withSpan` for runtime event subscriptions, command-output streams, pi-adapter event
  streams, source watcher streams, and bridge streams when a stream boundary is itself the work
  being observed. Use `Effect.withSpan` around one-shot acquire, publish, decode, persist, and
  command-dispatch operations. Stream spans must carry bounded redacted annotations only; they do
  not carry raw transcript text, command output, provider payloads, or extension secret values.
- Ambient logging/tracing reference overrides are owner-scoped. App bootstrap owns process-wide
  defaults and exporter wiring. Tests own test-local log/trace levels, disabled propagation, and
  deterministic timing. Export, snapshot, and diagnostic code may set scoped verbosity for one
  report. Bridge adapters may add scoped bridge span annotations and links. Package service methods
  must not mutate global log or trace policy ad hoc; they add operation spans, annotations, metrics,
  and redacted logs under the caller-provided policy.
- `Effect.withTracerEnabled(...)` and `Effect.withTracerTiming(...)` are allowed only at
  app/bootstrap trace policy setup, focused tests, diagnostic/export paths, and one-operation
  troubleshooting wrappers. They are installed-verified on 2026-06-25 against
  `effect@4.0.0-beta.84`. They are scoped policy combinators, not product state, and domain services
  must not toggle tracing or timing based on workspace, surface, provider, model, extension, or
  command data.
- Metrics use `Metric.counter` for counts, `Metric.timer` or histograms for durations,
  `Metric.update` for recording, and `Effect.trackDuration(metric)` around service or command
  boundaries. Use `Metric.value` only in metric tests, diagnostic endpoints, or exporter/snapshot
  code. Runtime product behavior must not branch on metric state. Metrics are observability data,
  not durable product state.
- Runtime metric controls `Metric.enableRuntimeMetricsLayer`, `Metric.disableRuntimeMetricsLayer`,
  `Metric.enableRuntimeMetrics`, `Metric.disableRuntimeMetrics`, `Metric.snapshot`, and
  `Metric.snapshotUnsafe` are installed-verified on 2026-06-25 against
  `effect@4.0.0-beta.84`. App/bootstrap may install the enable/disable layers as one
  process/runtime observability policy. Tests, diagnostics, and exporters use `yield* Metric.snapshot`
  as the default Effectful snapshot value. `Metric.snapshotUnsafe` is reserved for the narrow
  explicit-context synchronous edge where an exporter or assertion already owns the target
  `Context` and cannot run an Effect. Domain logic, runtime scheduling, queue decisions, provider
  selection, pi-adapter behavior, and UI state must not branch on runtime metric snapshots.
- Metric tests, exporter snapshot tests, and diagnostic metric assertions provide
  `Metric.MetricRegistry` with a fresh `Map` when isolation matters; they do not assert against the
  ambient default registry.
- Metric attributes stay low-cardinality, such as package, operation, status, reason class,
  extension kind, queue domain, or retry outcome. Product ids such as workspace/session/surface,
  thread, turn, command, queue item, request, artifact, and generated-package build ids belong in
  spans, logs, app-log rows, and command facts, not metric labels.
- Approved metric attributes are applied with `Metric.withAttributes(...)` before `Metric.update`,
  `Metric.value`, or `Effect.trackDuration(...)`. Do not hand-roll alternate metric tagging helpers
  unless they only normalize the approved string pairs before calling `Metric.withAttributes(...)`.
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
  metric tests. The baseline catalog includes:

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
  an app/bootstrap-owned bridge-only contract that decodes those headers and installs
  `Tracer.ParentSpan` with `Tracer.externalSpan(...)` before entering package services; the trace
  context still does not become a runtime/state/package service input. Use `Effect.currentParentSpan`
  and `Effect.withParentSpan` only when an in-process runtime operation must attach child work to a
  known parent span. Deliberately omit a parent span when modeling a fresh product turn, background
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
  `Logger.layer([Logger.tracerLogger])` at app/bootstrap when Effect log records should become span
  events in the same trace path. It does not replace app-log persistence or command facts.
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
  `Effect.log*` records under the caller-provided logging policy. Runtime and app/bootstrap may call
  explicit app-log state/runtime ports for product facts that must be durable. Other packages may
  call `AppLogWritePort` directly only when their package spec names the exact durable diagnostic
  fact, input shape, redaction policy, and tests. They must not install product `Logger.layer(...)`,
  `Logger.batched(...)`, file, console, or OTLP logger sinks themselves. Console/file loggers,
  including `Logger.toFile`-style sinks, are diagnostic/export-only and are not the product app-log
  persistence path.
- The Effect-log-to-app-log bridge uses an explicit core-owned write port and a scoped batched
  logger layer:

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

  The bridge builds a scoped logger with `Logger.batched(...)` and installs the resulting logger
  with `Logger.layer([logger])` at app/bootstrap scope. It maps Effect `LogLevel` values to product
  app-log levels exactly as `Fatal -> error`, `Error -> error`, `Warn -> warn`, `Info -> info`,
  `Debug -> debug`, `Trace -> debug`; `All` and `None` are policy bounds, not emitted record
  levels. `References.MinimumLogLevel` decides whether a log record reaches the bridge before
  product mapping. The bridge derives `AppLogSource` only from allowlisted package/operation
  annotations, derives related links only from allowlisted product-id annotations, normalizes
  message/error text, applies the same redaction as ordinary app logs, writes through
  `AppLogWritePort`, and records dropped or failed sink writes as metrics plus a diagnostic
  fallback. `Logger.batched(...)` is the Effect v4 batching primitive and accepts only a `window`
  and `flush`; its internal buffer is not capacity-bounded by the API. Product capacity,
  overflow/drop policy, and recursion protection must therefore be enforced before or around the
  logger bridge rather than attributed to `Logger.batched(...)`. `idempotencyKey` is optional and is
  derived only for explicitly idempotent product facts; ordinary repeated logs are separate app-log
  rows. The `Logger.batched(...)` `flush` effect has no typed failure channel, so the flush
  implementation catches/write-through failures internally and converts them to metrics plus
  fallback diagnostics. App-log sink persistence failure must not fail the domain Effect that
  emitted the log. The bridge names its upstream admission capacity, flush cadence/window,
  shutdown flush deadline, overflow/drop policy, and recursion guard. Shutdown wraps the final
  flush in the product deadline before `managedRuntime.dispose()`. Remaining records are counted in
  metrics or diagnostic fallback and never block domain finalizers. Sink write failures must not
  emit another app-log record through the same logger path; they use a separate diagnostic fallback
  and low-cardinality metric. Tests cover normal flush, overflow/drop accounting, sink failure,
  shutdown drain, and absence of recursive app-log writes.

- Secrets loaded from process/config edges use `Config.redacted` and `Redacted` values.
  `Redacted.make(...)` is used only inside trusted Effect code to reduce accidental disclosure.
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
  such as `Schema.toCodecJson(schema)`, but ordinary `Schema.encode*` may still encode the wrapper
  as its redacted placeholder. Use `Schema.RedactedFromValue(valueSchema, { disallowEncode: true })`
  when ordinary schema encoding must fail closed. Public serialized output schemas should not
  contain `Redacted` fields; before any serialized boundary, map secrets to non-secret status,
  label, fingerprint, or presence fields.
  Redacted labels and status fields must be non-secret. Boundary schemas that accept raw secret
  values and convert them to redacted wrappers use `Schema.RedactedFromValue(...)` only when the
  encoded form is
  intentionally secret-bearing and never crosses persistence, RPC, command facts, events, app logs,
  transcripts, artifacts, generated declarations, or tool output. `Redacted.value(...)` is allowed
  only at the trusted invocation boundary that must hand the secret to a provider, subprocess, or
  dependency installer. Extension redaction hooks run before logs, events, command facts, artifacts,
  app-log rows, or transcript-derived text are persisted or emitted; state enforces the final
  persistence/read-model redaction boundary.
- Public encoders must not try to serialize `Redacted` fields as secret values. Tests for
  secret-bearing schemas assert both ordinary `Schema.encode*` behavior and JSON-codec encode
  behavior, so `disallowJsonEncode` and `disallowEncode` are not confused. Boundary services map
  secrets to stable non-secret status fields, fingerprints, labels, or presence booleans before
  persistence, RPC, event, command-fact, app-log, generated-declaration, transcript, artifact, or
  tool-output boundaries.
- `Redacted` reduces accidental disclosure in logs, JSON, inspection, and schema output. It is not
  encryption, durable secret storage, or memory zeroing. Encrypted storage remains an
  app/state/keychain responsibility. `Redacted.wipeUnsafe(...)` is best-effort registry removal, not
  secret destruction.
- Effect v4 secret handling in this repo uses `Redacted` and `Config.redacted`. Do not use
  `effect/Secret` or `Secret` APIs.

## Bridge Rules

Desktop, browser tools, headless automation, facade/integration tests that intentionally exercise a
non-Effect edge, and other non-Effect consumers use small bridge facades. Ordinary Effect
service/layer tests do not create `ManagedRuntime`s or call `Effect.run*`; they use
`@effect/vitest` with test layers.

Bridge facades:

- are created from a single provided `ManagedRuntime`
- run Effect service methods with `managedRuntime.runPromise(...)`,
  `managedRuntime.runCallback(...)`, or stream adapters built on that same runtime
- use `managedRuntime.runPromiseExit(...)` or `managedRuntime.runSyncExit(...)` when the facade must
  distinguish typed failure, defect, and interruption. Use `runPromise(...)` only when promise
  rejection semantics are acceptable after the facade has a clear error mapping policy.
- do not call `managedRuntime.runFork(...)` for ordinary bridge requests. A forked facade runner is
  allowed only for a named scope-owned subscription/stream adapter whose public close path
  interrupts/closes the fiber and whose tests prove normal completion, early consumer return,
  typed failure, defect, interruption, shutdown, and disposal all produce a close receipt.
- validate incoming payloads using hoisted `@svvy/core` schemas
- convert typed errors to stable app/RPC error payloads
- never contain queue claiming, prompt dispatch, tool execution, or recovery logic
- accept caller cancellation where relevant. Promise facades whose package contract says caller
  abort interrupts the underlying operation expose `{ signal?: AbortSignal }` and pass it as a run
  option to `managedRuntime.runPromise(...)` / `managedRuntime.runPromiseExit(...)`. They do not
  implement cancellation by racing the returned Promise against an abort listener, because that
  rejects the caller while the Effect fiber can continue committing state or holding resources.
  Promise facades whose package contract intentionally says caller abort is wait-only, such as the
  runtime facade default `cancel-wait-only` policy, must name that policy in the owning package spec
  and prove that hidden continuing work is the intended owner-managed behavior. Callback facades use
  `managedRuntime.runCallback(program, { signal, onExit })` and return the interruptor/cancel
  function. `onExit` is mandatory for facade callbacks; it maps `Exit` success, typed failure,
  defect, and interruption into the facade's stable callback result/error shape.
  `Effect.tryPromise` thunks receive and forward the Effect-provided `AbortSignal`;
  `Effect.callback` registrations should declare and forward the provided `AbortSignal` when the
  host API supports it, and must return a cleanup effect when explicit unsubscribe/cancel is
  required.
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
  The adapter may wrap `Stream.toAsyncIterableWith` or `Stream.toAsyncIterableEffect`, but the raw
  v4 iterator creates an internal scope and closes it from iterator `return()` only. Natural stream
  completion returns `done: true` without closing that scope. The wrapper must close the stream
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
- expose idempotent `close()` only for facade cleanup: facade-owned `AsyncIterable` scopes,
  callback fibers, and bridge subscriptions. Facade `close()` never closes package service layers,
  SQLite handles, runtime workers, pi sessions, or the app `ManagedRuntime`. All layer-scoped
  package resources are released only by the bootstrap owner calling `managedRuntime.dispose()` or
  `managedRuntime.disposeEffect`.
- fail closed when app/bootstrap readiness fails. Bridge adapters must not expose a partially
  initialized runtime facade, state facade, pi adapter, extension facade, or event stream after
  `managedRuntime.context()` fails. Pending bridge calls fail with the typed startup error, and the
  bootstrap owner disposes the failed runtime before any retry creates a replacement runtime.
- name readiness contracts before a facade is promoted. Each facade-owning package spec must name
  the readiness effect invoked before calls, its typed startup error, typed shutdown/disposed error,
  pending-call policy (`wait` or `fail`) and capacity per API group, plus tests for pending startup,
  failed startup, shutdown-in-progress, and disposed runtime states. `ManagedRuntime.context()`
  provides Effect acquisition; it is not the svvy product readiness contract by itself.
- create an explicit scope for subscriptions or clients that must outlive one `runPromise` call.
  After app bootstrap has awaited `managedRuntime.context()`, create the scope through the provided
  runtime, for example `const scope = await managedRuntime.runPromise(Scope.make())`, run scoped
  work with `await managedRuntime.runPromise(Scope.provide(scope)(...))`, and close it with
  `await managedRuntime.runPromise(Scope.close(scope, Exit.void))` before
  `managedRuntime.dispose()`. If a synchronous bridge path uses
  `managedRuntime.runSync(Scope.make())`, it must only do so after readiness has cached the runtime
  context. Use v4 `Scope.provide`, not `Scope.extend`. For bounded work with a manually created
  closeable scope, prefer `Scope.use(scope)(program)` so finalizers receive the program's real exit.
  For subscriptions or clients that intentionally outlive one call, close with `Exit.void` only on
  normal explicit unsubscribe/close; on failing or interrupted bridge paths, close with the actual
  terminal `Exit` captured from `runPromiseExit`, `runSyncExit`, or callback `onExit`.

App/bootstrap owns one idempotent shutdown coordinator around the app `ManagedRuntime`. Shutdown
starts by marking the app as shutting down and rejecting new bridge calls with a typed shutdown
error. It then closes facade subscriptions/callback scopes, cancels bridge callbacks, requests
runtime drains or terminalization with bounded deadlines, records shutdown receipts/app-log facts
when user-visible work is interrupted, and finally calls `managedRuntime.dispose()` /
`disposeEffect`. Scoped OS/Electrobun signal listeners belong to this coordinator. If graceful drain
exceeds the configured deadline, the coordinator records the forced path and proceeds with runtime
disposal; package services do not install their own process-wide shutdown handlers.
Effect v4 disposal closes the `ManagedRuntime` layer scope with `Exit.void`; product-visible
shutdown, cancellation, timeout, and forced-disposal facts must be recorded before disposal or
passed through explicit service state. Layer finalizers must not infer app shutdown or user
cancellation from the scope-close `Exit` alone.

## Testing Rules

- Effect service/layer tests that need the Effect test runtime, `TestClock`, scoped layers, or
  layer fixtures use the named `@effect/vitest` lane. Pure schema, pure contract,
  generated-boundary, and package-boundary tests continue to use the Bun unit lane. A test file
  must not mix `bun:test` and `@effect/vitest` APIs.
- The target test scripts are exact: `bun run test:unit` remains the Bun unit suite for
  pure/package-boundary tests, `bun run test:effect` runs Vitest over
  `packages/**/*.effect.test.ts` and any explicitly named Effect integration-test pattern, and
  `bun run check` runs both lanes before lint, format, and production build. The Bun test glob
  excludes `*.effect.test.ts`. Effect-lane files import assertions, `describe`, `it`, `effect`,
  `live`, or `layer` from `@effect/vitest`; they do not import `bun:test`. Files importing
  `@effect/vitest` must match the Effect-lane filename pattern unless the package-boundary test
  names a fixture exception.
- `vitest` and `@effect/vitest` are root `devDependencies` installed at versions compatible with
  the pinned `effect` version. Package-local `devDependencies` remain forbidden. Package-boundary
  dependency checks special-case `vitest` and `@effect/vitest` only for Effect-lane test files and
  approved test helper files.
- When using `@effect/vitest`, use `it.effect` for Effect-returning tests, `assert` for Effect
  assertions, and `layer(AppTestLayer)("name", (it) => { it.effect(...) })`, nested
  `it.layer(...)`, or explicit test layers for shared service contexts. Top-level `layer(...)` and
  top-level `it.layer(...)` options such as `timeout`, `memoMap`, and `excludeTestServices` are
  allowed only with an explicit lifecycle reason. Nested `it.layer(...)` accepts `timeout` only and
  must not pass `memoMap` or `excludeTestServices`.
- `it.effect.each(...)` is allowed for table-driven Effect tests. `it.effect.prop(...)` is allowed
  for property tests that need Effect services. Installed `@effect/vitest@4.0.0-beta.84` types
  allow Schema inputs for top-level `prop(...)` and `it.effect.prop(...)`; array-form Schema inputs
  are converted with `Schema.toArbitrary`. Object-form Schema inputs are typed as accepted but are
  not reliable in the checked-in implementation because the converted arbitrary is overwritten.
  Schema-derived properties therefore use only array form until the installed implementation is
  fixed or reverified. When `Schema.toArbitrary` does not support the exact schema under test, pass
  explicit FastCheck arbitraries or keep the property in dedicated schema/property helpers. Explicit
  property-test arbitraries import FastCheck from `effect/testing/FastCheck`; do not use the removed
  `effect/FastCheck` path.
- `it.live(...)` opts into real runtime services and is integration-test-only in this repo. Unit
  tests continue to use `TestClock`, fake layers, and deterministic providers.
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
  per-test provisioning, `Effect.provide(layer, { local: true })`, or avoid a shared layer block
  when a test must isolate database handles, refs, queues, pubsubs, layer maps, process spawners,
  clocks, or mutable fake ports. `Layer.fresh` bypasses the outer memo map at the point where that
  layer is built; it is not a blanket per-test reset for an already shared context. Any test file
  that intentionally shares mutable fixtures through a shared layer block documents the shared
  resource and proves order independence or resets state through a package-owned fixture API.
- Use `TestClock` for sleeps, retry schedules, queue drains, debounce, leases, and timeouts. Tests
  for sleeping or scheduled effects use the fork-then-adjust pattern: fork the effect under test,
  then advance time with `TestClock.adjust(...)` or `TestClock.setTime(...)`, then join/await the
  fiber, assert through a semantic receipt, use an explicit drain handle, or inspect state. For
  stream/event pipelines, a narrow `Effect.yieldNow` after `TestClock.adjust(...)` is allowed only
  to let fibers unblocked by virtual time run; it is not a substitute for sleeps or polling. Do not
  promote debounce, timeout, retry, queue drain, lease, recovery scan, title job, source
  reconciliation, or generated-package refresh code while its tests rely on host timers, broad
  sleeps, polling loops, microtask flushing, or hand-rolled scheduler callbacks instead of
  `TestClock` plus semantic receipts/drains.
- If a test must temporarily use host time inside an Effect test, use `TestClock.withLive(...)`
  only for a narrow integration boundary; unit tests for sleeps, schedules, retries, debounces,
  leases, and timeouts stay on `TestClock.adjust` / `TestClock.setTime` plus semantic receipts.
- Test layers are contract fixtures, not anonymous mocks. Package-owned `layerTest`,
  `layerInMemory`, or `layerFake` values expose assertion handles through services such as refs,
  captured calls, fake queues, captured process commands, emitted events, and temp roots when the
  test needs to inspect interactions. Use `Layer.provideMerge(...)` in tests only when the test must
  access both the service under test and the fixture/handle service.
- Runtime, recovery, projection, and queue-worker tests wait on semantic receipts, drain handles, or
  explicit readiness barriers exposed by test layers. They must not poll read models, filesystem
  state, or git refs as a substitute for a completion signal. Production receipt buses may be no-op
  or private when receipts exist only for tests; test layers may expose PubSub-backed receipt
  streams. `@svvy/runtime` owns a runtime-private `RuntimeReceiptBus` service for these milestones:
  the production layer is no-op/redacted, and `RuntimeReceiptBus.layerTest` exposes deterministic
  receipt streams for assertions. Required runtime receipts include queue row claimed, turn
  dispatched, turn terminalized, command terminalized, request-input wait created/resolved, event
  notification published, subscription attached, subscription closed, rebaseline rejected before
  stream exposure, slow subscriber dropped/rebaselined, recovery sweep completed, and
  generated-context/generated-package refresh completed when those milestones are the condition
  under test. Every resource-owning package service that has background work, scoped resources, or
  external adapters exposes a package-owned test layer and, when needed for assertions, a harness
  service with captured calls, receipts, drain handles, temp roots, fake process handles, emitted
  events, or finalizer receipts.
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
  directly for ordinary service testing. Use the Bun unit lane for pure contracts, or
  `@effect/vitest` with `it.effect(...)`, `layer(...)`, nested `it.layer(...)`, and explicit test
  layers when the test needs Effect test services. Direct runners are allowed only in named
  integration/e2e harnesses that test a non-Effect edge, plus the facade/bootstrap exceptions named
  below.
- Facade tests are the named exception that may create a `ManagedRuntime` to prove the JavaScript
  edge. Allowed file patterns are `*.facade.test.ts`, `*.bootstrap.integration.test.ts`, and
  explicit e2e/integration harnesses named in package-boundary checks. Those tests must verify that
  the facade uses a caller-owned runtime, does not rebuild layers per call, awaits
  `context()`/readiness before exposure when startup effects matter, maps typed failures and defects
  to stable bridge errors, propagates `AbortSignal` or callback cancellation, closes stream scopes
  on every completion path, reports disposal/shutdown failure behavior, fails after disposal, and
  does not embed queue, turn, state, tool-execution, or recovery policy. Every public
  `AsyncIterable` facade test covers normal close, consumer early return, natural completion, scope
  finalization, typed stream failure mapping, defect mapping, runtime shutdown, and runtime
  disposal, and proves the subscription scope closes in each path. App-bootstrap integration tests
  prove `managedRuntime.context()` is awaited before facades are exposed when startup effects matter.
- Svvy target checks are stricter than the local `t3code` defaults: package-boundary or lint checks
  must name facade-test file patterns that may use `ManagedRuntime.make`, reject the same usage in
  ordinary service tests, and reject svvy-owned platform `runMain` and `Layer.launch` test usage
  outside named integration/e2e harnesses. Target architecture specs do not authorize temporary debt
  baselines; implementation gaps are tracked in `docs/progress.md` until the checks reject every
  unlisted violation.
- Do not use broad sleeps, hidden globals, real desktop UI, real pi sessions, or real subprocesses
  in unit tests unless the test is explicitly an integration/e2e test.
- App/bootstrap and explicit integration harnesses may define an `AppEnvironment` service that
  carries cwd, platform, architecture, hostname, selected environment variables, packaged resource
  roots, app config roots, and feature flags while wiring the process edge. Reusable packages do not
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
    allowed host-global zones
  - no new reusable wrapper-style `return Effect.gen(...)` or `=> Effect.gen(...)` in non-test
    package code when `Effect.fn(...)` or `Effect.fnUntraced(...)` is the correct reusable function
    boundary
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
  separate runtime wrapper. Because the currently adopted Bun platform subset is
  limited to file/path/crypto services, approved Bun/Electrobun bootstrap modules may import only the
  concrete Bun platform service layers explicitly named by package specs, currently
  `BunFileSystem.layer`, `BunPath.layer`, and `BunCrypto.layer`.
  Platform `runMain` helpers remain allowed only for named app/process roots that own process
  lifecycle; domain services and bridge facades still must not call platform `runMain` helpers.
  `effect/Runtime.makeRunMain` is only for narrow app/process adapter code that intentionally
  defines a platform runner.

Package verification must prove the package split, not only typecheck the package names:

| Package                       | Required Effect-proof tests                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@svvy/core`                  | Schemas, ids, tagged errors, encoders/decoders, boundary issue path formatting including numeric indexes, public annotation allowlist emission, public error shapes, and explicitly named data-only `Context.Service<PortIdentifier, PortService>` port tags. Core must not define service implementations, layers, runtime runners, queues, streams, scoped resources, or hidden host reads.                                                                                     |
| `@svvy/state`                 | Transaction commit/rollback, nested transaction behavior, row decoding failures, after-commit invalidation ordering, atomic queue claim order, safe integer boundaries, migration validation owned by state, paged replay streams, temp DB isolation, and dispose/reopen persistence against the same temp-file DB for queue rows, command facts/output, request-input rows, app logs, pi session references, generated-package facts, source-version facts, and recovery leases. |
| `@svvy/sandbox`               | Immutable snapshot input, helper lookup fail-closed behavior, canonical path checks, scoped temp profile cleanup, denial classification, and no subprocess ownership inside sandbox.                                                                                                                                                                                                                                                                                              |
| `@svvy/pi-adapter`            | Scoped session open/create/close, system prompt delivery, ambient pi resource disabling, turn stream interruption, protocol stderr drain when relevant, and no queue/tool/runtime policy ownership.                                                                                                                                                                                                                                                                               |
| `@svvy/extensions`            | Generated context from source records, tool handler input decoding, typed `ExtensionRuntimeOperation` items, source save invalidations, env redaction, dependency command plans, and no desktop/runtime mutation.                                                                                                                                                                                                                                                                 |
| `@svvy/runtime`               | Queue wakeup-after-commit behavior, durable queue claim ordering, prompt locks, active-turn abort, wait registry cleanup, event rebaseline, slow-subscriber policy, LayerMap workspace/surface isolation, startup gates, helper-process reconciliation, and recovery leases.                                                                                                                                                                                                      |
| `@svvy/desktop`               | Bridge adapters call only bootstrap-provided facades, close stream/subscription scopes, refetch read models after events, and contain no queue claiming, prompt dispatch, direct state mutation, state mutation policy, or recovery policy.                                                                                                                                                                                                                                       |
| Generated `@svvyx/*` packages | Manifest, name, import-policy, and negative boundary tests prove they are authoring-time generated TypeScript outputs only: no Effect services/layers, no runtime/state/sandbox/pi-adapter/desktop/public-extension imports, no `execute_typescript` runtime facades, only the allowed `@svvyx/workflows` -> `@svvyx/extensions` generated-package edge, and only the exact type-only `@svvy/core` bridge-contract imports named by `generated-packages.spec.md`.                 |

## Target Package Gates

The Effect package architecture is complete only when behavior is owned by the package service
contracts below. A package directory existing, a type-only contract compiling, or a facade
forwarding to non-package implementation logic is not completion.

Target gates:

1. `@svvy/core` owns the cross-package schemas, branded ids, typed errors, command-fact unions,
   runtime request/event/read-model contracts, and hoisted boundary decoders/encoders.
2. Implementation code sits behind Effect service contracts. Promise facades exist only at
   non-Effect app/test/bridge edges.
3. `@svvy/state` owns durable state services, migrations, transactions, read-model selectors, and
   implementations/layers for core-owned runtime queue, surface, turn, command, thread, request,
   generated-context, generated-package, recovery, title, read-model, extension-state, provider-auth,
   pi-session-reference, sandbox-policy-source, app-log-write, secret-store, and artifact command
   ports.
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
   `effect/JsonSchema` is already adopted only for the schema-emitter uses named in this spec; new
   `JsonSchema` uses outside those emitters require the same adoption record.
9. App shell and renderer source consume the single package architecture through public facades. A
   second product architecture, dual schema path, fallback bridge, or alias surface is forbidden
   unless the PRD, feature inventory, and owning package specs are updated to make it the resolved
   steady-state architecture.

Every gate requires package-boundary tests, focused behavior tests, and source-of-truth docs that
agree on file-backed versus DB/product-state-backed ownership. A dependent runtime implementation is
not promoted until its package docs, contracts, and tests agree on the owner of each source file,
generated file, durable fact, event, and read model it touches.

Mechanical enforcement lives in package-boundary and focused package tests, not in review memory.
Every mechanical gate required by this spec must name a rule id, source/test globs, allowed
exceptions, and the check command that runs it under `bun run check` before the owning package is
promoted. The required enforcement inventory is:

- `SVVY-EFFECT-001`: package manifest dependency checks for every `@svvy/*`, `@svvyx/*`, Effect,
  platform, SQL, test, pi, Electrobun, Svelte, Smithers, and generated-package edge. The gate fails
  unless root/package manifests and `bun.lock` resolve `effect` and adopted `@effect/*` packages to
  the adopted installed stack named by this spec. The same gate derives production package and Bun
  app Effect value-member reads from the TypeScript AST, requires exact coverage in
  `packages/effect-adoption-manifest.ts`, and runs
  `packages/effect-installed-exports.effect.test.ts` in the `test:effect` lane to prove every
  manifest-listed runtime member exists on the installed package namespace. Dated installed-export
  rows remain allowed only for reference-only, test-only, or future adoption notes that are not yet
  production reads. `bun run check` runs this gate before typecheck/build so implementation cannot
  silently use reference-only APIs against older installed packages. The Effect test lane also keeps
  behavioral canaries for the adopted exports explicitly named by this spec, including
  `@effect/vitest`, `@effect/platform-bun` Bun platform layers, `LayerMap.Service`,
  `Logger.batched`, `Logger.tracerLogger`, runtime metric controls, bridge stream adapters,
  `Scope.provide`/`Scope.use`/`Scope.close`, `Queue` terminal and capability APIs, `PubSub`
  subscribe/replay APIs, `Take`, `Stream.fromPubSubTake`, `Stream.fromSubscription`,
  `Stream.callback`, `FiberMap`, `FiberHandle`, `Resource`, `RcMap`, `RcRef`, config providers,
  and `TestClock`.
- `SVVY-EFFECT-002`: static import, dynamic `import(...)`, and CommonJS `require(...)` checks across
  `packages/**/src/**/*.{ts,tsx}`, `packages/**/*.{test,effect.test}.ts`,
  generated declaration/package output, `src/bun/**/*.{ts,tsx}`, `src/shared/**/*.{ts,tsx}`, and
  renderer/app-shell source. The gate rejects package-private subpaths, pi-native imports,
  renderer-only imports, platform/SQL imports without an adoption record, generated-package
  back-imports into product packages, and reference-tree imports from product code. Allowed
  exceptions are named fixture files, local reference trees under `docs/references/**`, and
  generated output directories whose owning spec explicitly names the importer/imported edge.
- `SVVY-EFFECT-003`: no package-level `ManagedRuntime.make`, `Effect.runCallback`,
  `Effect.runCallbackWith`, `Effect.runFork`, `Effect.runForkWith`, `Effect.runPromise`,
  `Effect.runPromiseWith`, `Effect.runPromiseExit`, `Effect.runPromiseExitWith`,
  `Effect.runSync`, `Effect.runSyncWith`, `Effect.runSyncExit`, `Effect.runSyncExitWith`,
  instance `managedRuntime.run*` calls, `Layer.launch`, platform `runMain` helpers, or hidden
  runtime singletons outside app/bootstrap, process entrypoints, production facade factories and
  bridge adapters that run effects through a caller-owned `ManagedRuntime`, facade tests named by
  the package-boundary checks, named scope-owned subscription/stream adapters with close receipts,
  and explicit integration/e2e edge harnesses. Production facade/bridge runner allowlists are exact
  file globs maintained by package-boundary tests, including `@svvy/runtime` `createRuntimeFacade`,
  `@svvy/state` `createStateFacade` / `createStateCommandsFacade`, app/bootstrap runtime-service
  adapters, and explicit browser/headless bridge adapters. Those modules may call only caller-owned
  `managedRuntime.run*` methods or app-owned bootstrap runners; they must not create a runtime,
  rebuild layers per request, or expose a generic runner. The only package-internal runner
  exception is the package-private `@svvy/pi-adapter` turn callback bridge named in
  `pi-adapter.spec.md`, which may call `Effect.runCallbackWith(services)` or
  `Effect.runPromiseWith(services)` against the current turn context only to adapt
  runtime-provided tool executor effects to pi's callback API. That bridge never creates or
  receives a `ManagedRuntime`, never runs arbitrary package effects, closes with the turn scope, and
  has fake pi tests for cleanup, abort, typed failure, defect, and interruption. The gate treats
  method calls on variables typed or named as
  `ManagedRuntime`/`managedRuntime` as runtime runners even when the import is indirect.
- `SVVY-EFFECT-004`: no `effect/Runtime` imports outside named app/process adapter files that use
  only exact process lifecycle helpers: `Runtime.makeRunMain`, `Runtime.defaultTeardown`,
  `Runtime.errorExitCode`, `Runtime.errorReported`, `Runtime.getErrorExitCode`, and
  `Runtime.getErrorReported`; bridge facades and domain packages use caller-owned `ManagedRuntime`
  only
- `SVVY-EFFECT-005`: removed, unadopted, or edge-internal layer APIs are banned everywhere in
  product code:
  `Layer.scoped`, `Layer.scopedDiscard`, `Layer.fromBuild`, `Layer.fromBuildMemo`,
  `Layer.buildWithMemoMap`, and `Layer.forkMemoMapUnsafe`. Edge-only layer APIs are banned in
  ordinary svvy-owned package code and allowed only by the explicit owner rules in this spec:
  `Layer.effectDiscard`, `Layer.buildWithScope`, app-bootstrap or named config/layer-factory
  `Layer.unwrap`, `Layer.suspend`, `Layer.fresh`, `Effect.provide(layer, { local: true })`, and
  non-exported scoped layer constructor/member access. `Layer.makeMemoMapUnsafe` is allowed only in
  app/process bootstrap and explicit
  integration/e2e/facade harnesses that own all `ManagedRuntime` lifetimes and need shared
  memoization across those runtimes. `Layer.effectDiscard` is edge-only, not a normal service
  startup primitive; ordinary package workers use named service layers with readiness, drain, and
  shutdown receipts. `Layer.unwrap` is allowed only in app bootstrap and named package
  layer-factory/config modules that decode package-specific config before exposing services; it is
  forbidden in per-call, domain-service, repository, bridge-handler, and facade paths.
  `Layer.fresh(...)` and `Effect.provide(layer, { local: true })` are rejected in production package
  code unless the owning package spec names the isolated resource subtree, owner, lifetime, and test
  proving isolation is required. They are allowed in `*.effect.test.ts`, facade/bootstrap
  integration tests, and explicit test helpers when the test explains the isolation reason.
  `Layer.buildWithScope` is allowed only at app/process bootstrap,
  explicit adapters, and named integration/e2e/facade harnesses that deliberately own and close the
  destination scope; ordinary Effect service/layer tests use the `@effect/vitest` lane. Scoped
  layer acquisition uses `Layer.effect` or `Layer.effectContext` with `Effect.addFinalizer`,
  `Effect.acquireRelease`, or explicit `Scope` use.
- `SVVY-EFFECT-006`: no Effect v3 service/layer/schema/runtime import names or v3 generator forms
- `SVVY-EFFECT-007`: no pi-native imports outside `@svvy/pi-adapter` internals and explicitly named adapter tests
- `SVVY-EFFECT-008`: no renderer, Svelte, Dockview, or Electrobun imports in non-desktop packages
- `SVVY-EFFECT-009`: no runtime/state/sandbox/pi-adapter/desktop/public-extension imports from generated `@svvyx/*`
  outputs except allowed type-only `@svvy/core` bridge contracts named in
  `generated-packages.spec.md`
- `SVVY-EFFECT-010`: no generated `@svvyx/*` observability or runtime-policy imports such as `effect/Metric`,
  `effect/Logger`, `effect/Tracer`, `effect/unstable/observability`, or `@effect/opentelemetry`
- `SVVY-EFFECT-011`: no generated `@svvyx/*` imports used as `execute_typescript` runtime facades
- `SVVY-EFFECT-012`: no `Date.now()`, `new Date()`, `DateTime.nowUnsafe()`,
  `clock.currentTimeMillisUnsafe()`, `clock.currentTimeNanosUnsafe()`, `setTimeout`,
  `setInterval`, `Math.random()`, `crypto.randomUUID()`, direct `node:crypto` / WebCrypto / Bun
  crypto globals, raw `fetch` / `globalThis.fetch`, `console.*`, detached promises, or unscoped
  watcher/process APIs in package code that owns runtime logic; package code uses Effect `Clock`,
  `DateTime`, `Schedule`, scoped fibers, injected crypto/HTTP/logging services, and test clocks
  unless a package spec names the process-edge exception
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
  inside function bodies. `Schema.asserts` is a direct v4 assertion API rather than a reusable
  compiler return value, so this inline compiler-call gate is not enough to catch it. Boundary tests
  must include a separate direct-call scan that bans `Schema.asserts(...)` in package boundary,
  runtime, bridge, handler, read-model, and command-output code except named dynamic schema factory
  files. Package boundary code
  still does not use it as a custom guard surface; it prefers hoisted decode/encode helpers so
  parse errors stay typed and testable. `Schema.decodeTo`, `Schema.encodeTo`, and other schema
  construction/transform APIs are allowed where their source schema is module-hoisted or owned by a
  named schema factory.
- `SVVY-EFFECT-015`: Effect service/layer tests live in `*.effect.test.ts`, import
  `@effect/vitest`, and run through `bun run test:effect`; Bun test globs exclude them, and files
  that use `TestClock`, package layers, scoped services, `Effect.provide(...)` with service layers,
  or manual effect runner helpers cannot stay in the Bun lane. Package-boundary checks reject
  manual Effect runner helpers outside named integration, facade, process-edge, or e2e harnesses.
- `SVVY-EFFECT-016`: every exported public `Schema.TaggedErrorClass`, public `*ErrorSchema`, and
  stable bridge/RPC error schema exports `decodeUnknown<Name>Effect`, `decodeUnknown<Name>Exit`,
  `encode<Name>Effect`, and `encode<Name>Exit` using `strictBoundaryParseOptions`. Sync error
  decoders may exist only as `unsafeDecode<Name>SyncForTestsAndBootstrap`.
- `SVVY-EFFECT-017`: public contract schemas use `Schema.optionalKey(...)` for optional object
  fields; `Schema.optional(...)` inside public `Schema.Struct({ ... })` field definitions requires
  an explicit undefined-valued exception and focused decode/encode tests.
- `SVVY-EFFECT-018`: imports of optional Effect modules require a package-spec adoption record
  naming module, owner service, use case, scope/lifetime, capacity or TTL, invalidation/release
  path, test layer, and allowed source globs. Production imports fail when the adoption record is
  absent or incomplete.
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
- `SVVY-EFFECT-022`: Effect `ExecutionPlan`, `Effect.withExecutionPlan`, and
  `Stream.withExecutionPlan` are not adopted product APIs. Boundary tests reject those exact
  Effect exports and member calls in product code. The only allowed similarly named product
  contract is core-owned `ExtensionExecutionPlan`.

Focused tests prove the positive contract for each promoted behavior: the service/layer is the
owner, the facade is mechanical, the state mutation returns after-commit invalidations, the runtime
publishes only after commit, the resource closes on scope shutdown/interruption, and the test layer
can replace the dependency without importing implementation internals.

## Acceptance Criteria

- Non-UI packages expose Effect-native services and layers.
- Desktop and non-Effect consumers use facades over one `ManagedRuntime`.
- `@svvy/core` exposes schemas, branded ids, and typed errors without service/runtime state.
- Runtime events are Effect streams.
- Runtime in-memory queues are not confused with durable state queues.
- State transactions are Effect effects and SQLite remains authoritative.
- pi session and turn lifetimes are scoped.
- Subprocess lifetimes are scoped and interruptible.
- Tool handlers are Effect effects with typed input validation, typed errors, and deterministic
  command facts.
- Effect service/layer tests use `@effect/vitest` and test layers; pure schema and contract tests
  may stay in the Bun unit suite.
- No v3 Effect APIs or import paths are used.
