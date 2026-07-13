# `@svvy/state` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/state`

## Purpose

`@svvy/state` owns durable product state, settings persistence, logs, and read-model projection.

It stores facts and projects them. It does not execute work.

`@svvy/state` is an Effect-native package. It exposes the state layer, implementations/layers for
core-owned state-backed Effect ports, finite state-owned read and command services, read facades,
and command facades over durable product state. SQLite remains the authoritative state store;
Effect queues, refs, streams, and pubsubs are not durable state. `@svvy/state` does not expose a
generic public transaction port or broad public write-port surface.

`@svvy/core` owns the shared cross-package port `Context.Service` tags and method contracts for
state-backed package boundaries. `@svvy/state` owns the implementations, database transactions,
after-commit collectors, layers, and test layers that provide those core-owned tags. It does not
expose a generic public transaction port.

Every mutating state-backed Effect port returns `StateMutationResult<T> = { value: T; afterCommit:
readonly StateInvalidationDescriptor[] }`. Read-only methods return `T`. State port implementations
derive descriptors from the committed write result; runtime-owned boundary code may collect multiple
returned `afterCommit` arrays while applying one runtime operation. Descriptors are publishable only
after the relevant state write succeeds. Idempotent duplicate replays return the original value with
`afterCommit: []`.

Multi-write state port methods must call exactly one package-private transactional store method that
commits all affected rows and computes the final descriptor set from the committed transaction
result. A port implementation must not compose multiple mutating store calls and synthesize one
`StateMutationResult` afterward. This rule applies to queue settlement, prompt/turn settlement,
source-fact commits, generated-package refresh commits, extension-state writes, and recovery
transitions. App-log read-state command services are single-domain state commands over the app-log
read-state domain; they return committed command results plus app-log read-model invalidation
descriptors through `StateCommands`. `createStateCommandsFacade(...)` only adapts those services to
the app-owned `ManagedRuntime` and does not call app-log stores or package-private app-log facades
directly. If an app-log command later writes multiple state domains atomically, add a specific
transactional store method for that product operation. If any product operation needs multiple state
domains changed atomically, add a specific transactional store method for that product operation
instead of exposing or reusing a
generic transaction builder.

A mutating state-backed Effect port method is any method that can create, update, delete, claim,
release, normalize, append, record, mark, resolve, default, cancel, clear, ensure by writing, or
persist state. Every such method returns
`Effect.Effect<StateMutationResult<T>, StateContractError>`. Use `T = void` only when no committed
domain value exists. Runtime-facing state ports use write verbs for mutations and `get`, `find`,
`list`, `read`, `inspect`, `has`, or domain-specific read verbs such as `fetch`, `rebaseline`, and
`snapshot` for non-mutating reads. Read-only methods perform no writes and return
`Effect.Effect<T, StateContractError>` or the port-specific read error directly.

Public state-backed port DTOs are schema-backed contracts exported from `@svvy/core` or explicitly
listed extension-owned contracts. Public facade DTOs use branded ids and branded timestamps where
those brands exist, and they must either be derived from schema-backed contracts or named in this
spec as state-owned facade DTOs that remain in-process TypeScript facade contracts and are not
exposed over renderer or RPC transport unless this spec names matching schemas/codecs. Package-private `Structured*` selector outputs may exist inside `@svvy/state` to make
SQL projection code readable, but they are not package-root contracts and they are not consumed by
runtime, desktop, generated packages, extensions, sandbox, or renderer/shared contracts as public
contracts. Public read-model results are derived from the core-owned schema DTOs where those schema
DTOs exist; state-owned read-model DTOs are package-root facade contracts only for read-model slices
whose schemas/codecs have not been promoted to transport boundaries. The only permitted
package-root exports are the state service/layer factories, approved read facades, approved command
facades, approved
state-backed port layers, state-owned public errors, and schema-backed facade contracts named in
this spec. The package root uses explicit named re-exports only. It does not export
`StructuredSessionStateStore`, `StructuredSessionStateStoreInput`, `Structured*` result DTOs,
`*FromStore` adapters, `*FromStructuredSessionState` adapters, structured-session port aggregate
layers, raw repository helpers, SQLite helpers, table helpers, migration helpers, transaction
helpers, broad store-construction helpers, or duplicated helper exports already assigned to public
subpaths.

The public subpath `@svvy/state/session-navigation` owns renderer-safe pure session-navigation
helpers. The restricted exported subpaths `@svvy/state/structured-session-state`,
`@svvy/state/structured-session-adapters`, `@svvy/state/structured-session-projections`, and
`@svvy/state/generated-package-maintenance` are restricted bootstrap/test wiring surfaces named by
this spec and package-boundary tests; they are not renderer, runtime facade, app-developer,
extension, browser-tool, headless, or generated-package APIs. Product app bootstrap may use them
only to acquire one structured-session state graph, adapt that graph to named core-owned state
ports, project structured-session read models for the app-bootstrap session catalog edge, and compose
app-owned generated-package maintenance wiring.
Concrete store constructors, raw repository aggregates, SQLite helpers, migrations, transaction
helpers, and package-private selector/storage modules remain package-private implementation modules,
not public `@svvy/state` subpaths. Product app bootstrap composes `@svvy/state` root layer inputs,
named state-backed port layers, approved read facades, approved command facades, and the restricted
wiring subpaths above. Boundary-tested app/bootstrap composition edges include
`src/bun/session-catalog.ts` for structured-session wiring/adapters,
`src/bun/app-runtime-bootstrap.ts` for the app-composed workspace-state router registration and
port-layer wiring, and `src/bun/workspace-runtime-registry.ts` for generated-package maintenance;
those files may import only the exact restricted state subpaths named here for their approved
composition reason. No other production file may treat concrete stores, raw adapters, or
package-private implementation modules as package architecture.
Repo-local tests may import package-private implementation modules only through boundary-test
allowlists that do not become product API.

Boundary tests keep an explicit restricted-state-subpath ledger: each approved restricted export is
named in the package export-map/public-symbol expectations, production consumers are scanned, the
boundary-tested app/bootstrap composition files are named above, and runtime, desktop,
renderer/shared, extensions, pi-adapter, sandbox, browser-tool, headless, and generated-package
consumers are rejected unless this spec and the boundary ledger name the exact reason. Test consumers
stay limited to `@svvy/state` tests and approved app/bootstrap integration fixtures. Every other
production consumer uses package-root state facades, command facades, or core-owned state port
layers. Stable pure selector helpers may be public only when this spec names
their subpath, schema-backed input, schema-backed output, owning read model, and boundary tests;
otherwise selectors are package-private implementation code.

Restricted subpath export status is explicit:

- `@svvy/state/structured-session-state` is a restricted bootstrap/test wiring surface. Its export
  set is limited to `StructuredSessionState`, `structuredSessionStateFromStore`,
  `makeStructuredSessionState`, `layerStructuredSessionState`, `createStructuredSessionStateStore`,
  `StructuredSessionStateStore`, `CreateStructuredSessionStateStoreOptions`, `StateDigestHelper`,
  and package-private `Structured*` record types only for explicitly named app-bootstrap and
  state-test boundaries. Runtime, desktop, renderer/shared, extensions, pi-adapter, sandbox,
  browser-tool, headless, and generated packages must not import this subpath. Raw store
  constructors, raw store types, and selector/storage DTOs are not production-visible restricted
  exports unless this spec names the exact app-bootstrap or state-test boundary allowlist.
- `@svvy/state/structured-session-adapters` is a restricted adapter ledger for per-port
  `*FromStructuredSessionState` helpers plus their corresponding `*FromStore` helpers, the
  state-owned `structuredSessionCatalogMutationsFromStore` adapter used only by the approved
  `src/bun/session-catalog.ts` bootstrap edge to return exact `StateMutationResult` descriptors for
  committed catalog-owned session, surface metadata, composer, queue edit, title, and interrupted
  recovery writes,
  app-composed workspace-store router symbols `createWorkspaceStateRouter`,
  `layerWorkspaceStateRouter`, `WorkspaceStateRouter`, `WorkspaceStateRouterInput`, and
  `WorkspaceStateRegistration`, and the router facade composers `stateReadModelsFromRouter` and
  `stateCommandsFromRouter`. `*FromStore` helpers are implementation escape hatches allowed only
  for state tests and approved app/bootstrap integration fixtures; they are not product API. Product
  app/bootstrap targets `*FromStructuredSessionState` helpers or named zero-argument port layers. The
  workspace-store router symbols are limited to the same boundary: `createWorkspaceStateRouter`,
  `WorkspaceStateRouterInput`, and `WorkspaceStateRegistration` construct the router from
  already-acquired stores, `layerWorkspaceStateRouter` and `WorkspaceStateRouter` provide its
  runtime-facing port layers, and `stateReadModelsFromRouter`/`stateCommandsFromRouter` compose the
  `StateReadModels`/`StateCommands` facades over a constructed router — all consumed only at the
  app-bootstrap runtime-state composition edge and by `@svvy/state` tests, and none of them exported
  from the `@svvy/state` package root. Runtime, desktop, renderer/shared, extensions, pi-adapter,
  sandbox, browser-tool, headless, and generated packages must not import this subpath.
- `@svvy/state/structured-session-projections` is a restricted app-bootstrap projection ledger for
  the finite structured-session read-model projection helpers consumed by `src/bun/session-catalog.ts`.
  It re-exports only the projection helpers and projection result types named by package-boundary
  tests. It does not expose store constructors, repositories, SQL helpers, mutation helpers,
  generic selector registries, or app-log APIs.
- `@svvy/state/generated-package-maintenance` is app-bootstrap/test wiring for generated-package
  maintenance facts only. It does not expose generated package parsing policy, runtime refresh
  scheduling, link repair execution, read models, or generated package source inspection.

`@svvy/state` is `private: true` for npm publication, but "public" in this spec means monorepo
package-boundary public API. Boundary tests and consumer restrictions apply to package-root exports
and exported subpaths even though the package is not published independently.

## Owns

- App and workspace settings persistence.
- Provider auth status rows and implementations/layers for core-owned provider auth status and
  provider-auth status state ports. Live provider credential snapshots remain outside product state
  and are returned only by the host/live `ProviderAuthPort`.
- Persisted extension env values, env status records, encrypted extension secret references, and
  state-owned command facade operations that create, update, remove, and report secret readiness.
  Raw secret reads for extension invocation are performed only by the host/live `SecretStorePort` at
  the trusted invocation boundary. State command facades may use `SecretStoreMutationPort` only to
  write/remove user-entered secret material and persist references/status facts.
- Ambient resource category settings.
- Workspace identity, default workspace state, worktree identity/context, layout identity, and
  workspace tab state.
- Sessions, surfaces, pi session references, messages, turns, queue rows, queue ordering indexes,
  and prompt-binding metadata.
- Generated context fingerprints and refresh state.
- Thread groups, handler objectives, reports, conclusion state, and episodes as persisted facts.
- CLI-observed Smithers workflow/run/task/node/iteration/attempt bridge facts, workflow task-agent
  attempt surfaces, approval observations, retry/resume observations, command links, artifact/log
  links, and workflow status summaries required by product read models.
- Request-input request, question, option, answer, timeout, and queue-delivery facts.
- Command records, command output events, diagnostics, approval state, and command facts.
- Artifact metadata, materialization lifecycle rows, immutable markers,
  source-command/thread/workflow linkage, stored-path facts, byte/digest facts supplied by runtime,
  and deleted state.
- Snippet records and transcript provenance.
- App logs, unread state, normalized error payloads, and related links.
- Durable title-generation job facts, title values, manual rename flags, and freeze state.
- Read-model selectors for desktop and non-desktop consumers, including Workflows generated-surface
  pane data.
- State migrations and recovery reads.

## Does Not Own

- Runtime queue execution, claim policy, retries, and delivery.
- pi sessions or model turns.
- Tool execution.
- Sandbox profile generation.
- Extension instruction composition or invocation.
- UI rendering.
- Smithers/Workflows source files, generated guidance, generated packages, or Smithers runtime
  state; state owns only `svvy` product facts observed from CLI/bridge execution.
- Lifecycle policy decisions owned by `@svvy/runtime` or `@svvy/extensions`. State still enforces
  persisted integrity invariants such as transaction atomicity, queue claim consistency, terminal
  command immutability, foreign-key validity, and read-model projection consistency.
- pi transcript/session implementation details beyond persisted references required to reopen
  surfaces through `@svvy/pi-adapter`.
- Runtime event delivery.
- Prompt or instruction source ownership.

## Public API Shape

Effect-native service surface:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  CommandId,
  ExtensionEnvName,
  ExtensionStatePort,
  ExtensionSnapshotStatePort,
  ExtensionSnapshotSettingsStatePort,
  PiSessionReferencePort,
  ProviderAuthStatusStatePort,
  RecoveryWorkKind,
  RuntimeActorExtensionBindingStatePort,
  RuntimeApprovalStatePort,
  RuntimeWorkspaceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeComposerDraftStatePort,
  RuntimeCommandStatePort,
  RuntimeEpisodeStatePort,
  RuntimeExtensionStatePort,
  RuntimeExtensionContextImpactStatePort,
  RuntimeGeneratedPackageStatePort,
  RuntimeArtifactStatePort,
  RuntimePromptDefaultsStatePort,
  RuntimeComposerProfileStatePort,
  RuntimeQueueStatePort,
  RuntimeReadModelStatePort,
  RuntimeRecoveryStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeThreadStatePort,
  RuntimeTranscriptStatePort,
  RuntimeTurnStatePort,
  SandboxPolicySource,
  SecretStorePort,
  SecretStoreMutationPort,
  AppLogWritePort,
  StateContractError,
  WorkspaceId,
} from "@svvy/core";

export class StateReadModels extends Context.Service<
  StateReadModels,
  {
    readonly fetch: (
      input: StateReadModelRequest,
    ) => Effect.Effect<StateReadModelResult, StateContractError>;
    readonly refetchInvalidation: (
      input: StateReadModelInvalidationRefetchRequest,
    ) => Effect.Effect<readonly StateReadModelResult[], StateContractError>;
    readonly rebaseline: (
      input: StateReadModelRebaselineRequest,
    ) => Effect.Effect<StateReadModelBaseline, StateContractError>;
  }
>()("@svvy/state/StateReadModels") {}

// Canonical service surface. A command method is public only when this service surface, the
// command facade shape, schema-backed inputs/results, state transaction, post-commit descriptors,
// package-root exports, and tests all name the same method.
export class StateCommands extends Context.Service<
  StateCommands,
  {
    readonly workspaceChrome: WorkspaceChromeStateCommands;
    readonly workspaceLayout: WorkspaceLayoutStateCommands;
    readonly sessionNavigation: SessionNavigationStateCommands;
    readonly appLogs: AppLogReadStateCommands;
    readonly appPreferences: AppPreferencesStateCommands;
    readonly providerAuth: ProviderAuthStateCommands;
    readonly extensionEnv: ExtensionEnvStateCommands;
    readonly agentProfiles: AgentProfileStateCommands;
    readonly snippets: SnippetStateCommands;
  }
>()("@svvy/state/StateCommands") {}

export const layer = (input: {
  config: StateLayerConfig;
  digest?: StateDigestHelper;
}): Layer.Layer<
  StateReadModels | StateCommands | AppLogWritePort | StateLayerProvidedPortServices,
  StateContractError,
  FileSystem.FileSystem | Path.Path
> => makeStateLayer(input);
```

`StateLayerProvidedPortServices` is a package-private documentation shorthand for the finite set of
core-owned state-backed port tags listed in this spec. It is not an exported type, not an importable
aggregate layer, and not a public umbrella state-port service. Public callers depend on the exact
core-owned port service tags or on `StateReadModels` / `StateCommands`, never on a
`StructuredSessionStatePorts` bundle.

`@svvy/state.layer(input)` receives only decoded state configuration. Secret-store mutation access is
required only by state-owned secret-write command services/facade paths if they are added to write
or remove user-entered secret material, through the core-owned `SecretStoreMutationPort` Effect service in the
caller-owned app runtime context. Secret reads for extension invocation remain host/live
invocation-boundary work through `SecretStorePort` and are not state read-model or command results.
`@svvy/state` must not define or accept a separate `SecretStoreAdapter` input that bypasses the
core-owned port contracts.

`StateReadModels` and `StateCommands` are narrow state-owned services with explicitly named method
groups. They are allowed public layer outputs because their contracts are finite Effect service
contracts, not an umbrella state store. Their Promise facades are separate adapters over these
Effect services. They do not expose repositories, SQL, transactions, raw snapshots, generic
mutation, queue execution policy, runtime command lifecycle helpers, or file-backed source editing.
`StateReadModels.refetchInvalidation(...)` is the durable read-model follow-up for runtime and
app/bootstrap invalidation notifications. Desktop, browser-tool, and headless consumers use it after
renderer-safe or programmatic notifications name affected models. They do not treat runtime event
payloads as read models, and `@svvy/state` does not subscribe to runtime events directly.
The package-architecture table phrase “no public umbrella service export” means no public
`StateStore`, no broad `State` service, and no raw store/service output.

The app/bootstrap host layer provides `FileSystem.FileSystem` and `Path.Path` to `@svvy/state` only
for state database parent-directory setup, SQLite adapter acquisition, migration support, and
state-owned metadata/fingerprint helpers named by this spec. State fingerprint helpers persist,
compare, and checksum bytes or strings supplied by the owning runtime, extension, sandbox, or state
repository path; they do not watch, scan, read, edit, or materialize file-backed source inputs.
During state layer acquisition, state may ensure the configured artifact root directory exists so
state-backed artifact metadata can reference a valid storage root. Artifact byte staging, copy,
rename, stat, delete, and digest calculation are runtime-owned file effects, not state-layer
behavior.
Synchronous state stores that must compute non-artifact checksums receive a narrow package-owned
`StateDigestHelper` in their layer input. App/bootstrap and state tests provide the live/test
implementation; state production modules do not import `node:crypto`, WebCrypto globals, Bun crypto
globals, or `BunCrypto.layer`, and the public state layer does not require `Crypto.Crypto`. The
digest helper is used only for state-owned sandbox policy fingerprints, persisted source and
generated-package fingerprint values supplied by their owning services, and persisted checksums
named by state-owned schemas. Managed sandbox profile digests are computed by `@svvy/sandbox` from
generated launch-profile material. Artifact byte and digest facts are supplied by runtime after
runtime reads the materialized artifact bytes.
State repository and selector code still does not receive raw host globals, source-checkout-relative
paths, or filesystem/digest access outside database setup, fingerprint, checksum, and id-generation
ports.

Layer input is host configuration, not product state. Product settings such as provider auth,
extension usage, snippets, prompt history, and artifact metadata are read and written through state
ports after the layer starts.

`layer(input)` constructs the package-private store/repository graph and provides each core-owned
state-backed port service over one decoded state configuration. The state layer owns scoped SQLite
store acquisition for app logs and structured-session state against the configured database path.
Callers depend on the narrow port service they need; they do not call a broad runtime-state bundle or
receive store handles, repositories, SQL clients, transaction builders, or shortcuts that bypass
service ownership.

Named state-backed port layers are zero-argument Effect layer values that provide one core-owned
port service and require the package-private `StructuredSessionState` service in their environment.
They do not receive a store object, repository object, SQLite handle, mutable state bundle, or
caller-constructed state-port service as a function argument:

```ts
export const layerRuntimeQueueStatePort: Layer.Layer<
  RuntimeQueueStatePort,
  StateContractError,
  StructuredSessionState
> = Layer.effect(RuntimeQueueStatePort, makeRuntimeQueueStatePort());
```

`makeRuntimeQueueStatePort()` is an Effect value factory. Package examples must call it when
installing the layer; they must not pass the factory function itself as the service effect.

The public named state-backed port layers are exactly:

- `layerRuntimeWorkspaceStatePort`
- `layerRuntimeSurfaceLifecycleStatePort`
- `layerRuntimeComposerDraftStatePort`
- `layerRuntimeQueueStatePort`
- `layerRuntimeTurnStatePort`
- `layerRuntimeCommandStatePort`
- `layerRuntimeApprovalStatePort`
- `layerRuntimeActorExtensionBindingStatePort`
- `layerRuntimeEpisodeStatePort`
- `layerRuntimeExtensionStatePort`
- `layerRuntimeExtensionContextImpactStatePort`
- `layerRuntimeGeneratedPackageStatePort`
- `layerRuntimePromptDefaultsStatePort`
- `layerRuntimeComposerProfileStatePort`
- `layerRuntimeArtifactStatePort`
- `layerRuntimeRecoveryStatePort`
- `layerRuntimeReadModelStatePort`
- `layerRuntimeRequestStatePort`
- `layerRuntimeSessionWaitStatePort`
- `layerRuntimeSourceStatePort`
- `layerRuntimeThreadStatePort`
- `layerRuntimeTranscriptStatePort`
- `layerRuntimeWorkflowTaskStatePort`
- `layerExtensionStatePort`
- `layerExtensionSnapshotStatePort`
- `layerExtensionUsageStatePort`
- `layerExtensionSnapshotSettingsStatePort`
- `layerSandboxPolicySource`
- `layerSandboxPolicySourceWithConfig(config)`
- `layerProviderAuthStatusStatePort`
- `layerPiSessionReferencePort`
- `layerAppLogWritePort`

`layerSandboxPolicySourceWithConfig(config)` is the only public named port-layer factory in this
set. Its config is app/bootstrap-supplied host/root context for generated output roots, extension
dependency roots, and temporary roots used by sandbox policy snapshots; it is not product state and
does not replace app preferences or workspace facts read from the acquired state service.

The named port layer must not call `layer(input)`, open SQLite, construct secret stores, run
migrations, or rebuild repository graphs. It can only yield `StructuredSessionState` from the Effect
environment and adapt that already-acquired service to the corresponding core-owned port. App
bootstrap composes one acquired state layer with the named projection layers inside the same app
layer graph; Effect v4 memoization preserves that explicit composition so every projection shares
the same acquired state graph and database handle. `layerSandboxPolicySource` follows this exact
zero-argument pattern for the DB-backed projection: it requires `StructuredSessionState`, adapts it
to the core-owned
`SandboxPolicySource`, and does not read ambient config, open SQLite, or acquire a standalone policy
store. The root `layer({ config })` may provide immutable app-bootstrap sandbox policy roots from
`StateLayerConfig.sandboxPolicy` to the sandbox-policy projection. Those roots are host/app config
inputs such as app-owned generated-output roots, extension dependency roots, and temporary roots;
they are not persisted state rows and not runtime-supplied ad hoc policy fragments.

App bootstrap constructs one state layer for the app runtime and receives the public root layer or
named projection layers already composed by `@svvy/state`; it does not import the package-private
`StructuredSessionState` tag. That explicit composition is the production wiring form. A named port
layer is never independently configured, never hides a call to `layer(input)`, and never acquires a
separate store. Aggregate port-layer composition helpers may exist only as package-private
implementation or state-test helpers; they are not public restricted subpath exports and are not
product app APIs, except the named app-composed workspace-store router layer `layerWorkspaceStateRouter`
exported from the restricted `@svvy/state/structured-session-adapters` subpath. Internal package code
may use the package-private aggregate helper to implement the root `layer(input)` facade, but
app/bootstrap, runtime, desktop, renderer/shared, extensions, pi-adapter, sandbox, browser-tool,
headless, and generated packages must not import or compose that helper.

Package-root exports, general public subpaths, tests, and app-entry code must not expose or consume
`StateStore`, `StructuredSessionState`, app-log store objects, repository objects, SQL clients,
migration helpers, transaction helpers, table helpers, or state-port layers that acquire their own
store. The restricted `@svvy/state/structured-session-adapters` subpath exposes only the explicit
store-adapter helpers named for the app-bootstrap structured-session state composition edge; it does
not export an aggregate port layer other than the named app-composed workspace-store router layer
`layerWorkspaceStateRouter`. State package boundaries do not expose
implementation seams that bypass the named state ports, state read facades, state command facades,
or the shared `StructuredSessionState` provider described in this spec.

The app-composed workspace-store router (`createWorkspaceStateRouter`, exported from the restricted
`@svvy/state/structured-session-adapters` subpath) is the single state-owned dispatcher over the
app-global structured-session store and the registered per-workspace stores. It accepts already
acquired `StructuredSessionStateStore` instances — the exact instances app bootstrap already owns —
and never opens a second store or database connection for a registered store. The app-global store is
a full member of the routable store set: it is reachable by explicit `workspaceId`, committed `cwd`,
durable committed-row id, prompt target, and the bare-input maintenance fan-out, in addition to being
the target for app-global designation (app-global source scope and the app-global generated-package
methods). Registered per-workspace stores take precedence over the app-global store on any
`workspaceId`/`cwd` collision, so an `acquireWorkspace(cwd)` that resolves the app-global store
returns a `workspaceId` that `releaseWorkspace` resolves back to the same store, and the bare-input
sweeps observe rows the app-global store owns. Every runtime-facing state-port method, and the
`StateReadModels`/`StateCommands` facades composed over the router through
`stateReadModelsFromRouter`/`stateCommandsFromRouter` (also restricted to that subpath), dispatches to
the correct store by explicit `workspaceId`/scope, by app-global designation, by a durable globally
resolvable id resolved through committed rows (surface `pi_session_reference`, `session`, `command`,
`turn`, `workflow_task_attempt`, `surface_message_queue`, `runtime_approval_request`,
`request_user_input_request`, and `thread` rows), or by fan-out over the app-global store and every
registered per-workspace store for the bare-input maintenance sweeps
(`releaseExpiredSurfaceMessageClaims`, `listOpenApprovalRequests`, `listOpenBlockingRequestInputs`,
and unscoped `readLinksNeedingRepair`). Durable-id global uniqueness holds only under the production
UUID `idFactory`; the router never derives scope from a bound single-workspace store. Unresolvable
targets fail with a typed `StateContractError` (`reason: "not-found"`, `operation` prefixed
`workspace-state-router.`). Committed invalidation descriptors carry the committed workspace scope of
the owning store. A bare-input maintenance fan-out mutation sweep does not fail fast: the router runs
every registered store, aggregates the committed values and after-commit descriptors of the stores
that succeed, and returns that aggregate when all stores succeed. When at least one store fails, the
sweep fails with a typed `StateContractError` (`reason: "transaction-failed"`, `operation` prefixed
`workspace-state-router.`) whose `cause` carries the preserved partial results (the aggregated values
and committed after-commit descriptors of the stores that succeeded) so already-committed descriptors
from earlier stores are never dropped. `layerWorkspaceStateRouter` provides the fifteen runtime-facing state-port layers
from a constructed router. The router is constructed only by app bootstrap at the runtime-state
composition edge, and has no product call site elsewhere.

```ts
type StateLayerConfig = {
  databasePath: AbsolutePath;
  artifactRoot: AbsolutePath;
  busyTimeoutMs: PositiveDurationMs;
  sandboxPolicy?: {
    generatedOutputRoots?: AbsolutePath[];
    extensionDependencyRoots?: AbsolutePath[];
    temporaryRoots?: AbsolutePath[];
  };
};

export const StateLayerConfigSchema = Schema.Struct({
  databasePath: AbsolutePath,
  artifactRoot: AbsolutePath,
  busyTimeoutMs: PositiveDurationMsSchema,
  sandboxPolicy: Schema.optionalKey(
    Schema.Struct({
      generatedOutputRoots: Schema.optionalKey(Schema.Array(AbsolutePath)),
      extensionDependencyRoots: Schema.optionalKey(Schema.Array(AbsolutePath)),
      temporaryRoots: Schema.optionalKey(Schema.Array(AbsolutePath)),
    }),
  ),
});
```

`StateLayerConfig`, `StateLayerConfigSchema`, and `SandboxPolicySourceConfig` are public root
exports from `@svvy/state`.
`@svvy/state` does not define or export `StateLayerConfigFromEnv`; app/bootstrap passes a decoded
`StateLayerConfig` into `@svvy/state.layer({ config, digest? })`. Ambient env reads belong to an
app-edge config reader before the decoded config enters the state layer. Production time policy is
runtime/app-edge owned and enters state as explicit method input when state must persist or compare
resulting facts. State repository and selector code must not read ambient time through `Date.now()`,
`new Date()`, unsafe `DateTime`/`Clock` calls, or host globals. Request-input timeout defaults,
queue/recovery/title/request-input lease durations, command output batching/retention thresholds,
app-log retention policy, and runtime worker cadences are runtime-owned policy and enter state only
as explicit method inputs when state must persist or compare resulting facts.

The app/bootstrap state-config reader is the only component that may read ambient env for state
config. In env-driven/headless app-edge lanes it reads exactly these keys:

- `SVVY_STATE_DATABASE_PATH`
- `SVVY_STATE_ARTIFACT_ROOT`
- `SVVY_STATE_BUSY_TIMEOUT_MS`

Those env-driven lanes require all three values. Missing values are config-source failures, and
explicitly configured invalid values fail startup without falling back to defaults. Packaged
desktop startup resolves equivalent decoded values from packaged app configuration and user-data
paths before calling `@svvy/state.layer({ config, digest? })`; `@svvy/state` receives only decoded
`StateLayerConfig` and never reads env or applies app-edge defaults internally. App/bootstrap is
responsible for mapping config/source failures and schema validation failures into the core-owned
`StateContractError` channel before SQLite, secret-store, artifact, migration, repository, or
state-port services are exposed.

`StateLayerConfig.sandboxPolicy` is optional programmatic app-bootstrap config, not env. It carries
immutable host/app roots that state cannot derive from DB rows: app-owned generated-output roots
such as the declaration-only `@svvy/core` type-contract package root, app-owned extension dependency
roots, and temporary roots. App/bootstrap resolves those roots from packaged app configuration and
passes them with the decoded state config before acquiring the state layer.

Promise read facade for non-Effect consumers:

```ts
const state = createStateFacade(managedRuntime);

const result = await state.readModels.fetch({
  kind: "appLogs",
  query: {
    limit: 50,
    direction: "backward",
  },
});
if (result.kind !== "appLogs") {
  throw new Error("Unexpected read model result");
}
const appLogs = result.value;

const baseline = await state.readModels.rebaseline({
  workspaceId,
  reason: "renderer-startup",
});
```

`createStateFacade(managedRuntime)` adapts an already-created app-bootstrap-owned
`ManagedRuntime`. It must not call `ManagedRuntime.make`, compose layers, acquire SQLite, create
state scopes, or own shutdown. It may only run `StateReadModels` effects through the supplied
runtime and map results/errors into the facade contract.

The read-model Promise facade is read-only. The separate `createStateCommandsFacade(...)` covers the
finite DB/product-state-backed UI command groups. Runtime mutations, command event appends, queue
settlement, request-input settlement, recovery updates, and artifact command writes happen through
Effect state ports owned by `@svvy/core` contracts and implemented by `@svvy/state` layers. Desktop
and renderer code never receive a non-Effect mutation shortcut that bypasses runtime ownership.

Exact renderer/headless read facade shape:

```ts
type StateFacade = {
  readModels: {
    fetch(
      input: StateReadModelRequest,
      options?: StateFacadeCallOptions,
    ): Promise<StateReadModelResult>;
    refetchInvalidation(
      input: StateReadModelInvalidationRefetchRequest,
      options?: StateFacadeCallOptions,
    ): Promise<readonly StateReadModelResult[]>;
    rebaseline(
      input: StateReadModelRebaselineRequest,
      options?: StateFacadeCallOptions,
    ): Promise<StateReadModelBaseline>;
  };
  close(): void;
};

type StateFacadeErrorContract = typeof StateFacadeErrorContractSchema.Type;
```

`StateFacadeErrorContract` is the closed encoded Promise/RPC failure payload for state read and
command facades and is owned by `@svvy/core`, not redefined by `@svvy/state`. The implementation may
reject with a `StateFacadeError extends Error` class for JavaScript ergonomics, but the class fields
must decode from exactly one `StateFacadeErrorContractSchema` variant. Adapters do not expose raw
`Cause`, stack traces, thrown objects, SQLite driver errors, host errors, or invalidation
descriptors.
`@svvy/state` exports only the JavaScript `StateFacadeError` wrapper. Bridge/RPC adapters
encode/decode the wrapper's `contract` field with the core schema rather than serializing `Error`
object fields, stack traces, raw causes, SQLite errors, or thrown defects.

```ts
type StateReadModelInvalidationRefetchRequest = {
  descriptor: StateInvalidationDescriptor;
};

type StateReadModelRequest =
  | { kind: "appLogs"; workspaceId?: WorkspaceId; query?: AppLogQuery }
  | { kind: "appLogSummary"; workspaceId?: WorkspaceId }
  | { kind: "appPreferences" }
  | { kind: "settings" }
  | { kind: "providerAuth"; workspaceId?: WorkspaceId }
  | { kind: "sessionNavigation"; workspaceId?: WorkspaceId }
  | (SurfaceTranscriptReadModelInput & { kind: "surfaceTranscript" })
  | { kind: "surfaceSummary"; target: RuntimeSurfaceTarget }
  | { kind: "surfaceComposer"; target: RuntimeSurfaceTarget }
  | { kind: "surfaceQueuedMessages"; target: RuntimeSurfaceTarget }
  | (CommandInspectorReadModelInput & { kind: "commandInspector" })
  | {
      kind: "artifactInspector";
      workspaceId: WorkspaceId;
      workspaceSessionId: WorkspaceSessionId;
      artifactId: ArtifactId;
    }
  | {
      kind: "requestInput";
      workspaceId?: WorkspaceId;
      surfacePiSessionId?: SurfacePiSessionId;
      requestId?: RequestInputRequestId;
    }
  | {
      kind: "approvals";
      workspaceId?: WorkspaceId;
      surfacePiSessionId?: SurfacePiSessionId;
      requestId?: RuntimeApprovalId;
    }
  | { kind: "agents"; profileId?: AgentProfileId }
  | { kind: "extensions"; extensionId?: ExtensionId }
  | { kind: "snippets"; workspaceId: WorkspaceId; snippetId?: SnippetId }
  | { kind: "workflowsGenerated"; buildId?: GeneratedPackageBuildId }
  | { kind: "handlerInspector"; workspaceId: WorkspaceId; threadId: ThreadId }
  | {
      kind: "workflowTaskAttemptInspector";
      workspaceId: WorkspaceId;
      workflowTaskAttemptId: WorkflowTaskAttemptId;
    }
  | { kind: "workspaceChrome" }
  | { kind: "workspaceLayout"; workspaceId: WorkspaceId };

type StateReadModelResult =
  | { kind: "appLogs"; value: AppLogReadModel }
  | { kind: "appLogSummary"; value: AppLogSummary }
  | { kind: "appPreferences"; value: AppPreferencesReadModel }
  | { kind: "settings"; value: SettingsReadModel }
  | { kind: "providerAuth"; value: ProviderAuthReadModel }
  | { kind: "sessionNavigation"; value: SessionNavigationReadModel }
  | { kind: "surfaceTranscript"; value: SurfaceTranscriptReadModel }
  | { kind: "surfaceSummary"; value: SurfaceSummaryReadModel }
  | { kind: "surfaceComposer"; value: SurfaceComposerReadModel }
  | { kind: "surfaceQueuedMessages"; value: SurfaceQueuedMessagesReadModel }
  | { kind: "commandInspector"; value: CommandInspectorReadModel | null }
  | { kind: "requestInput"; value: RequestInputReadModel }
  | { kind: "approvals"; value: ApprovalsReadModel }
  | { kind: "agents"; value: AgentsReadModel }
  | { kind: "extensions"; value: ExtensionsReadModel }
  | { kind: "snippets"; value: SnippetsReadModel }
  | { kind: "workflowsGenerated"; value: WorkflowsGeneratedReadModel }
  | { kind: "handlerInspector"; value: HandlerInspectorReadModel | null }
  | {
      kind: "workflowTaskAttemptInspector";
      value: WorkflowTaskAttemptInspectorReadModel | null;
    }
  | { kind: "workspaceChrome"; value: WorkspaceChromeReadModel }
  | { kind: "workspaceLayout"; value: WorkspaceLayoutReadModel };

type SettingsReadModel = {
  preferences: {
    appearance: "system" | "light" | "dark";
    externalEditor: string | null;
    artifactDirectory: AbsolutePath;
    approvalMode: "auto-review" | "user" | "full-access";
    networkAccess: boolean;
    externalInstructions: ExternalInstructionsSettings;
    ambientResources: AmbientAgentResourceSettings;
  };
  requestInput: RequestInputSettings;
};

// Exact schema-backed contract imported from the `@svvy/core` package root.
type ExternalInstructionsSettings = {
  globalRoots: Array<{
    id: string;
    kind: "builtin" | "custom";
    label: string;
    path: string;
    enabled: boolean;
  }>;
  globalControls: Record<
    string,
    { enabled: boolean; actors: Array<"orchestrator" | "handler" | "workflow-task"> }
  >;
  workspaceControls: Record<
    string,
    Record<
      string,
      { enabled: boolean; actors: Array<"orchestrator" | "handler" | "workflow-task"> }
    >
  >;
};

type ProviderAuthReadModel = {
  providers: readonly ProviderAuthStatus[];
  usableModelProviders: readonly ProviderId[];
};

type AppLogReadModel = {
  query: AppLogQuery;
  entries: readonly AppLogEntry[];
  pageInfo: AppLogPageInfo;
  summary: AppLogSummary;
  persistedView: AppLogViewPreferences;
  readState: AppLogReadState;
};

type SessionNavigationReadModel = WorkspaceSessionNavigationReadModel<SessionNavigationSummary>;

type SessionNavigationSummary = WorkspaceSessionNavigationSummary & {
  id: WorkspaceSessionId;
  parentSessionId?: WorkspaceSessionId;
  title: string;
  preview: string;
  createdAt: IsoDateTimeString;
  messageCount: NonNegativeSafeInteger;
  status: "idle" | "running" | "waiting" | "error";
  isUnread: boolean;
  unreadAt: IsoDateTimeString | null;
  unreadReason: "assistant-turn-finished" | "manual" | null;
  lastReadAt: IsoDateTimeString | null;
  provider?: ProviderId;
  modelId?: string;
  thinkingLevel?: string;
  wait?: {
    threadId?: ThreadId;
    kind: "user" | "external" | "approval" | "signal" | "timer";
    reason: string;
    resumeWhen: string;
    since: IsoDateTimeString;
  } | null;
  counts?: {
    turns: NonNegativeSafeInteger;
    threads: NonNegativeSafeInteger;
    commands: NonNegativeSafeInteger;
    episodes: NonNegativeSafeInteger;
    workflows: NonNegativeSafeInteger;
    artifacts: NonNegativeSafeInteger;
    events: NonNegativeSafeInteger;
  };
  threadIdsByStatus?: {
    runningHandler: readonly ThreadId[];
    runningWorkflow: readonly ThreadId[];
    waiting: readonly ThreadId[];
    troubleshooting: readonly ThreadId[];
  };
  threadIds?: readonly ThreadId[];
  sidebarThreads?: readonly SessionNavigationSidebarHandlerThreadRow[];
  commandRollups?: readonly SessionNavigationCommandRollup[];
  productEvents?: readonly SessionNavigationProductEvent[];
  titleGeneration?: {
    status: "not-started" | "pending" | "running" | "completed" | "failed" | "cancelled";
    renameLocked: boolean;
    autoFrozen: boolean;
    manualOverride: boolean;
    triggeredAt: IsoDateTimeString | null;
    finishedAt: IsoDateTimeString | null;
    error: string | null;
  };
};

type SessionNavigationSidebarHandlerThreadRow = {
  threadId: ThreadId;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  status:
    | "idle"
    | "running-handler"
    | "running-workflow"
    | "waiting"
    | "troubleshooting"
    | "completed";
  subtitle: SessionNavigationSidebarRowSubtitle | null;
  latestCommandRollup: SessionNavigationCommandRollup | null;
  updatedAt: IsoDateTimeString;
  workflows: readonly {
    workflowRunId: WorkflowRunId;
    workflowName: string;
    status: "running" | "waiting" | "continued" | "completed" | "failed" | "cancelled";
    subtitle: SessionNavigationSidebarRowSubtitle | null;
    updatedAt: IsoDateTimeString;
  }[];
};

type SessionNavigationSidebarRowSubtitle = {
  badge: "waiting" | "error" | "workflow" | "text";
  text: string;
  tone: "muted" | "waiting" | "error";
};
```

`SessionNavigationCommandRollup` and `SessionNavigationProductEvent` are the exact core-owned,
schema-backed renderer DTOs exported with `SessionNavigationSummarySchema` and
`SessionNavigationReadModelSchema`. Command status is exactly `streaming`, `requested`, `running`,
`waiting`, `succeeded`, `failed`, or `cancelled`; nullable command ownership/finalization fields
remain nullable, while optional semantic sections remain omitted when no durable rows exist.
`SessionNavigationProductEvent.subject.kind` is exactly `session` or `thread`. Session-file and
parent-session lineage fields are not part of this read model because structured state cannot derive
them authoritatively. For a pi-only legacy session with no committed structured turn/request summary,
the exact transcript-derived first/latest-message preview is likewise unavailable; state uses the
durable projected title fallback and never parses a pi session file to synthesize navigation data.

```ts
type SurfaceSummaryReadModel = {
  target: RuntimeSurfaceTarget;
  title: string;
  status: "idle" | "running" | "waiting" | "error";
  activeTurnId: TurnId | null;
  activeTurnStartedAt: IsoDateTimeString | null;
  queuedCount: NonNegativeSafeInteger;
  model: string;
  provider: ProviderId | "";
  reasoningEffort: string;
  agentProfileId: AgentProfileId | "";
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
};

type SurfaceComposerReadModel = {
  target: RuntimeSurfaceTarget;
  draft: {
    text: string;
    attachments: readonly ComposerAttachment[];
    snippetMentions: readonly JsonValue[];
    updatedAt: IsoDateTimeString | null;
  };
};

type SurfaceQueuedMessagesReadModel = {
  target: RuntimeSurfaceTarget;
  queuedMessages: readonly {
    id: QueueItemId;
    kind:
      | "user_message"
      | "initial_handler_start"
      | "thread_followup"
      | "report_request"
      | "thread_report_notification"
      | "request_user_input_answer"
      | "workflow_task_agent_start";
    text: string;
    title?: string;
    summary?: string;
    threadId?: ThreadId;
    episodeId?: EpisodeId;
    sourceCommandId?: CommandId;
    status: "queued" | "steering" | "dispatching" | "failed";
    failureError?: string;
    createdAt: IsoDateTimeString;
    updatedAt: IsoDateTimeString;
  }[];
};

type RequestInputReadModel = {
  requests: readonly {
    requestId: RequestInputRequestId;
    workspaceSessionId: WorkspaceSessionId;
    surfacePiSessionId: SurfacePiSessionId;
    threadId: ThreadId | null;
    ownerTitle: string;
    variant: "nonblocking" | "blocking";
    status: "open" | "completed" | "cancelled" | "expired";
    createdAt: IsoDateTimeString;
    completedAt: IsoDateTimeString | null;
    timeout: RuntimeRequestInputDetailsRecord["timeout"];
    questions: readonly RuntimeRequestInputDetailsRecord["questions"][number][];
  }[];
};

type ApprovalsReadModel = {
  requests: readonly {
    requestId: RuntimeApprovalId;
    workspaceSessionId: WorkspaceSessionId;
    surfacePiSessionId: SurfacePiSessionId;
    threadId: ThreadId | null;
    ownerTitle: string;
    toolName: "apply_patch" | "exec_command" | "execute_typescript";
    approvalMode: "auto-review" | "user";
    cwd: AbsolutePath | string;
    command: string | null;
    commandFamily: string | null;
    snippetArtifactId: ArtifactId | null;
    status: "pending";
    createdAt: IsoDateTimeString;
    completedAt: null;
    summary: string;
  }[];
};

type AgentsReadModel = {
  configuredProfiles: readonly ConfiguredAgentProfileReadModelRecord[];
  workflowAgents: readonly WorkflowAgentSourceReadModelRecord[];
  actorExtensionDefaults: readonly AgentActorExtensionDefaultsReadModelRecord[];
  bindings: readonly AgentBindingReadModelRecord[];
  generatedContextPreviews: readonly GeneratedContextPreviewReadModelRecord[];
};

type WorkflowAgentSourceReadModelRecord = {
  sourceId: string;
  path: AbsolutePath;
  sourceVersion: string;
  fingerprint: string;
  validationStatus: "valid" | "invalid";
  diagnostics: readonly SourceDiagnostic[];
  parameters: TaskAgentParametersSource | null;
  extensionOrder: readonly ExtensionId[];
  observedAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  builtin: boolean;
  deletable: boolean;
};

type AgentActorExtensionDefaultsReadModelRecord = {
  actor: "orchestrator" | "workflow-task";
  extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
  extensionOrder: readonly ExtensionId[];
  updatedAt: IsoDateTimeString | null;
};

type ConfiguredAgentProfileReadModelRecord = {
  profileId: AgentProfileId;
  actor: "orchestrator" | "handler";
  name: string;
  providerId: ProviderId | "";
  modelId: ModelId | "";
  reasoning: JsonValue | null;
  followComposer: boolean;
  extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
  extensionOrder: readonly ExtensionId[];
  position: number;
  updatedAt: IsoDateTimeString;
  builtin: boolean;
  locked: boolean;
  deletable: boolean;
};

type AgentBindingReadModelRecord = {
  ownerKind: "session" | "thread" | "workflow-task-attempt";
  ownerId: WorkspaceSessionId | ThreadId | WorkflowTaskAttemptId;
  surfacePiSessionId: SurfacePiSessionId | null;
  profileId: AgentProfileId | string;
  actor: "orchestrator" | "handler" | "workflow-task";
  name: string;
  providerId: ProviderId | "";
  modelId: ModelId | "";
  reasoning: JsonValue | null;
  followComposer: boolean;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  generatedAgentContextFingerprint: string | null;
  source: "surface-binding" | "handler-thread" | "workflow-task-attempt";
};

type GeneratedContextPreviewReadModelRecord = {
  ownerKind: "session" | "thread" | "workflow-task-attempt";
  ownerId: WorkspaceSessionId | ThreadId | WorkflowTaskAttemptId;
  surfacePiSessionId: SurfacePiSessionId;
  actorKind: "orchestrator" | "handler" | "workflow-task";
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  externalSourceHashes: readonly string[];
};

`configuredProfiles` contains only `agent_profile` rows. It preserves sparse extension usage exactly,
including explicit `unavailable` values, and preserves stored extension order and position rather
than resolving them into loaded/available arrays. A newly initialized state store inserts
`default-orchestrator` and `thread-handler` itself with the canonical `zai` / `glm-5-turbo`, medium
reasoning, empty sparse usage/order, and `followComposer: false` defaults. Initialization uses
conflict-safe inserts, does not advance the state revision, and never overwrites an existing row on
reopen. No app-bootstrap or JSON-settings seed owns these rows. The `default-orchestrator`
orchestrator and `thread-handler` handler rows derive
`{ builtin: true, locked: true, deletable: false }`; another orchestrator row derives
`{ builtin: false, locked: false, deletable: true }`. Handler rows are never deletable because the
state command surface exposes no handler-profile deletion operation.
`actorExtensionDefaults` is a separate app-global collection backed by
`agent_actor_extension_defaults`; orchestrator and workflow-task defaults never alias profile rows
or each other. New stores insert empty rows for both actors with the same conflict-safe initialization
policy; defensive projection of a missing row remains empty usage/order with `updatedAt: null`.
Promoting one extension default updates only the addressed actor-default row, and actor-default
reset clears only the requested usage and/or order field. Orchestrator profile usage remains sparse:
selecting the exact persisted actor-default state removes that extension key from the profile
override. The singleton handler profile is its own authority and keeps explicit usage because there
is no handler actor-default row.
`workflowAgents` contains only current `workflow_agent_source_index` rows whose exact path, source
version, and fingerprint still join a non-deleted app-global `runtime_source_fact` row with
`sourceKind = "workflow-agent"`. Valid and invalid source observations remain visible. Invalid
filename-derived ids remain plain strings. Rows contain parsed parameters, extension order, and
diagnostics but never source text or generated workflow exports. `builtin` is true only for
`defaultAgent`, `explorerAgent`, `implementerAgent`, and `reviewerAgent`; `deletable` is true only
for a non-builtin source id accepted by `WorkflowAgentSourceExportNameSchema`. Invalid content with
a valid filename remains deletable, while invalid filename rows remain inspectable without exposing
a delete action that cannot satisfy the workflow-agent lifecycle contract. Generated-package export
rows are never a fallback for this collection. Workflow-task generated-context previews resolve the
selected source parameters and workflow-task actor defaults from this same freshly fetched `agents`
read-model snapshot. `agent-settings.json` contains no visible profile, workflow-agent, or actor
default fields. The Extension Managing child process emits only a strict response-bearing
extension-management request intent. The parent runtime applies that request, returns the committed
receipt/facts, and derives the resulting state and generated-context impact: profile/default
mutations enter `StateCommands.agentProfiles`, while workflow-agent source saves enter runtime source
edits with the committed source version as their compare-and-swap base. The child does not receive
an authority snapshot, emit state mutations, or derive affected surfaces. Reading local app/title
settings never rewrites workflow-agent source files or state rows.
`bindings` contains only live surface/thread/workflow-attempt facts and must not be treated as
editable profile configuration. There is no combined or compatibility `profiles` collection.

type ExtensionsReadModel = {
  aggregateFingerprint: string | null;
  diagnostics: readonly SourceDiagnostic[];
  observedAt: IsoDateTimeString | null;
  records: readonly ExtensionReadModelRecord[];
  dependencyReadiness: readonly ExtensionDependencyReadiness[];
};

type ExtensionReadModelRecord = ExtensionRegistryObservation & {
  buildAuthorityStatus:
    | "current"
    | "missing"
    | "registry-fingerprint-mismatch"
    | "build-requirement-mismatch"
    | "source-fingerprint-mismatch";
  buildObservation: ExtensionSourceBuildObservation | null;
  buildRequired: boolean;
  contextReady: boolean;
  runtimeReady: boolean;
  readiness: "ready" | "not-ready" | "unknown";
  // Existing profile usage, generated-package status, CLI readiness, and redacted env projection
  // fields follow. Aggregate generated-package status never supplies build/context/runtime authority.
};

`buildObservation` is present only when `buildAuthorityStatus` is `current`. Missing or stale build
authority fails closed for required records with `buildRequired: true`, `contextReady: false`, and
`runtimeReady: false`. A current not-required materialized direct source has
`buildRequired: false` and `contextReady: true`. A current required record has `contextReady: true`
only when its validated current manifest matches the registry source fingerprint. `runtimeReady`
additionally requires no required CLI or environment blocker. Until state has exact current
dependency-install evidence, any nonempty `dependencyDeclarations` collection fails runtime
readiness closed. Generated `@svvyx/extensions` package status remains a separate projection and
does not satisfy these fields.

type SnippetsReadModel = {
  managed: readonly SnippetReadModelRecord[];
  discovered: readonly SnippetReadModelRecord[];
  snippets: readonly SnippetReadModelRecord[];
};

type SnippetReadModelRecord = {
  id: SnippetId;
  source: SnippetSource;
  title: string;
  body: string;
  metadata: SnippetMetadata;
  enabled: boolean;
  path: AbsolutePath | null;
  updatedAt: IsoDateTimeString | null;
};

type WorkflowsGeneratedReadModel = {
  packageName: "@svvyx/workflows";
  facts: readonly StructuredGeneratedPackageFactRecord[];
  exports: readonly WorkflowsGeneratedExportReadModelRecord[];
};

type WorkflowsGeneratedExportReadModelRecord = {
  namespace: "Agents" | "Components" | "Prompts" | "Workflows";
  exportName: string;
  qualifiedName: string;
  kind: "agent" | "component" | "prompt" | "workflow";
  generatedCode: string | null;
  generatedPath: string | null;
  sourcePath: string | null;
  agentParameters: JsonValue | null;
  workflowAgentId: string | null;
};

type HandlerInspectorReadModel = StructuredHandlerThreadInspector;
type WorkflowTaskAttemptInspectorReadModel = StructuredWorkflowTaskAttemptInspector;

type WorkspaceChromeReadModel = {
  activeWorkspaceTabId: WorkspaceTabId | null;
  tabs: readonly WorkspaceTabRecord[];
  knownWorkspaces: readonly WorkspaceTabRecord[];
};

type WorkspaceTabRecord = {
  workspaceTabId: WorkspaceTabId;
  workspaceId: WorkspaceId;
  cwd: AbsolutePath;
  workspaceLabel: string;
  kind: "default" | "user";
  openedAt: IsoDateTimeString;
  activeLayoutId: WorkspaceLayoutSlotId;
};

type WorkspaceLayoutReadModel = {
  workspaceId: WorkspaceId;
  slots: readonly WorkspaceLayoutSlotReadModel[];
};

type WorkspaceLayoutSlotReadModel = {
  workspaceId: WorkspaceId;
  layoutId: WorkspaceLayoutSlotId;
  initialized: boolean;
  dockviewJson: JsonValue | null;
  panes: readonly WorkspacePaneRecord[];
  compactSurfaces: readonly CompactWorkspaceSurface[];
  focusedPaneId: WorkspacePaneId | null;
  updatedAt: IsoDateTimeString;
};

type StateReadModelRebaselineRequest = {
  workspaceId?: WorkspaceId;
  target?: RuntimeSurfaceTarget;
  afterSequence?: RuntimeEventSequence;
  reason: "renderer-startup" | "event-sequence-gap" | "manual-refresh" | "runtime-restart";
};

type StateReadModelBaseline = {
  app: readonly StateReadModelResult[];
  workspaces: readonly StateReadModelResult[];
  revision: StateRevision;
};
```

`createStateFacade(...)` exposes only read-model kinds whose schemas/codecs or approved facade DTOs,
builders, invalidation mappings, package-root exports, and positive/negative boundary tests are
defined by this spec.

Command input DTOs exported from `state-command-schemas.ts` are schema-backed; read facade
request/result/read-model DTOs in `state-facade.ts` are package-root TypeScript facade contracts
unless this spec names matching Effect Schema codecs for renderer/RPC transport.

`@svvy/state` exposes exactly the `StateReadModelRequest.kind` and `StateReadModelResult.kind` union
declared above. Additional read-model kinds are not package-root facade contracts unless this spec
names their request/result variants, builders, invalidation mappings, root exports, and tests.

First-half Increment 6 read-model rows:

`StateReadModelRequestSchema` and `StateReadModelResultSchema` are the package-root schema-backed
closed transport guards for the read facade kind union. They validate the discriminant and shallow
request fields for every variant named below while nested read-model DTOs remain the approved
state-owned facade contracts named in this table.

| Kind                    | Builder source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Invalidation mapping                                                                                                                                                                                                                                                             | Root exports                                                                                                                                                  | Tests                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sessionNavigation`     | `packages/state/src/state-facade.ts` builds and core-schema-validates `SessionNavigationReadModel` from workspace-routed `StructuredSessionState.listSessionStates()`, composer drafts, `buildStructuredSessionSummaryProjection(...)`, `buildStructuredSessionView(...)`, and `@svvy/state/session-navigation` grouping. It includes durable provisional-title/title-generation facts, renderer-safe parent session ids for fork badges, orchestrator-local status, thread status groups, sidebar thread/workflow rows and subtitles, command rollups, and product events, but no session-file or parent-session-file paths. | Workspace `{ model: "sessionNavigation" }` refetches `sessionNavigation`; renderer startup/manual/runtime rebaseline includes it for workspace scope.                                                                                                                            | `SessionNavigationReadModelRequest`, `SessionNavigationReadModel`, `SessionNavigationSummary` from `@svvy/state`; exact nested DTO schemas from `@svvy/core`. | `packages/core/src/session-navigation-contracts.test.ts` strict schema golden; `packages/state/src/state-facade.test.ts` structured fixture parity/golden; `packages/package-boundaries.test.ts` root-export ledger.                             |
| `promptHistory`         | `packages/state/src/state-facade.ts` reads the workspace's chronological prompt-history rows recorded atomically with accepted ordinary user-message queue rows and returns exact submitted text plus workspace-session, surface, queue-item, and acceptance-time lineage.                                                                                                                                                                                                                                                                                                                                                    | Workspace `{ model: "promptHistory" }` refetches `promptHistory`; workspace rebaseline includes it.                                                                                                                                                                              | `PromptHistoryReadModelRequest`, `PromptHistoryReadModel`, `PromptHistoryReadModelEntry` from `@svvy/state`.                                                  | `packages/state/src/runtime-queue-state-port.test.ts` atomic write/idempotency coverage; `packages/state/src/state-facade.test.ts` exact duplicates, refetch, and rebaseline coverage; `packages/package-boundaries.test.ts` root-export ledger. |
| `surfaceTranscript`     | `packages/state/src/state-facade.ts` builds the already-authored `SurfaceTranscriptReadModel` from the target session snapshot, committed turns/commands, composer draft, prompt-lock turn state, and queue count.                                                                                                                                                                                                                                                                                                                                                                                                            | Workspace `{ model: "surface", ids }` expands to `surfaceTranscript`, `surfaceSummary`, `surfaceComposer`, and `surfaceQueuedMessages` for each addressed surface id.                                                                                                            | `SurfaceTranscriptReadModelRequest`, `SurfaceTranscriptReadModel` from `@svvy/state`.                                                                         | `packages/state/src/state-facade.test.ts` fixture assertion plus `refetchInvalidation` surface expansion coverage; `packages/package-boundaries.test.ts` root-export ledger.                                                                     |
| `surfaceSummary`        | `packages/state/src/state-facade.ts` builds a minimal pane-header surface summary from the target snapshot, active turn, queue count, title, model/provider/reasoning, and bound extension ids.                                                                                                                                                                                                                                                                                                                                                                                                                               | Workspace `{ model: "surface", ids }` expands to `surfaceSummary` with the sibling surface slices.                                                                                                                                                                               | `SurfaceSummaryReadModelRequest`, `SurfaceSummaryReadModel` from `@svvy/state`.                                                                               | `packages/state/src/state-facade.test.ts`; `packages/package-boundaries.test.ts` root-export ledger.                                                                                                                                             |
| `surfaceComposer`       | `packages/state/src/state-facade.ts` reads `StructuredSessionState.getComposerDraft(surfacePiSessionId)` and returns durable draft text, attachments, snippet mentions, and update time.                                                                                                                                                                                                                                                                                                                                                                                                                                      | Workspace `{ model: "surface", ids }` expands to `surfaceComposer` with the sibling surface slices.                                                                                                                                                                              | `SurfaceComposerReadModelRequest`, `SurfaceComposerReadModel` from `@svvy/state`.                                                                             | `packages/state/src/state-facade.test.ts`; `packages/package-boundaries.test.ts` root-export ledger.                                                                                                                                             |
| `surfaceQueuedMessages` | `packages/state/src/state-facade.ts` reads `StructuredSessionState.listQueuedSurfaceMessages({ surfacePiSessionId })` and maps the existing queued-message record/payload fields used by the renderer.                                                                                                                                                                                                                                                                                                                                                                                                                        | Workspace `{ model: "surface", ids }` expands to `surfaceQueuedMessages` with the sibling surface slices.                                                                                                                                                                        | `SurfaceQueuedMessagesReadModelRequest`, `SurfaceQueuedMessagesReadModel` from `@svvy/state`.                                                                 | `packages/state/src/state-facade.test.ts`; `packages/package-boundaries.test.ts` root-export ledger.                                                                                                                                             |
| `commandInspector`      | `packages/state/src/state-facade.ts` calls `buildStructuredCommandInspector(...)` from `packages/state/src/structured-session-selectors.ts` over the explicitly routed workspace snapshots and returns that full debugger projection plus the exact durable command target and accepted arguments. It preserves title, visibility, exact lifecycle status, timestamps, command facts, raw argument/output/progress/patch/diagnostic histories, stdin receipts, detailed artifacts, and summary/trace child-command detail; it does not narrow those facts into id-only compatibility fields.                                  | Workspace `{ model: "commandInspector", ids }` refetches one `commandInspector` result per command id.                                                                                                                                                                           | `CommandInspectorReadModelRequest`, `CommandInspectorReadModel` from `@svvy/state`.                                                                           | `packages/state/src/state-facade.test.ts` compares the complete result against `buildStructuredCommandInspector(...)` plus target/accepted arguments on the same fixture snapshot; `packages/package-boundaries.test.ts` root-export ledger.     |
| `artifactInspector`     | `packages/state/src/state-facade.ts` resolves an artifact only through the explicitly routed workspace plus exact `(workspaceSessionId, artifactId)` ownership pair and returns committed artifact metadata and producer linkage. It returns no artifact bytes and performs no filesystem probe; app/bootstrap composes the metadata with the runtime-owned artifact preview file reader.                                                                                                                                                                                                                                     | Artifact mutations continue to invalidate the existing session, command, handler-thread, and workflow-task inspector models that expose artifact links. An open artifact pane explicitly refetches `artifactInspector`; there is no standalone artifact invalidation descriptor. | `ArtifactInspectorReadModelRequest`, `ArtifactInspectorReadModel` from `@svvy/state`.                                                                         | `packages/state/src/state-facade.test.ts` exact-owner and cross-session rejection coverage; runtime artifact preview reader coverage; `packages/package-boundaries.test.ts` root-export ledger.                                                  |
| `requestInput`          | `packages/state/src/state-facade.ts` ports the catalog `buildWorkspaceRequestUserInputRequests()` mapping over `StructuredSessionState.listSessionStates()` and returns open/completed surface-local clarification requests/questions.                                                                                                                                                                                                                                                                                                                                                                                        | Workspace `{ model: "requestInput", ids }` refetches `requestInput`; request-input state-port commits also invalidate `surface` and `commandInspector` where applicable.                                                                                                         | `RequestInputReadModelRequest`, `RequestInputReadModel`, `RequestInputReadModelRequestItem`, `WorkspaceRequestInputDelivery` from `@svvy/state`.              | `packages/state/src/state-facade.test.ts` fixture parity assertion and rebaseline coverage; `packages/package-boundaries.test.ts` root-export ledger.                                                                                            |
| `approvals`             | `packages/state/src/state-facade.ts` ports the catalog `buildWorkspaceRuntimeApprovalRequests()` mapping over `StructuredSessionState.listSessionStates()` and returns pending runtime approval requests.                                                                                                                                                                                                                                                                                                                                                                                                                     | Workspace `{ model: "runtimeApprovals", ids }` refetches `approvals`; runtime approval state-port commits also invalidate `surface`, `sessionNavigation`, and `commandInspector` where applicable.                                                                               | `ApprovalsReadModelRequest`, `ApprovalsReadModel`, `ApprovalReadModelRequestItem` from `@svvy/state`.                                                         | `packages/state/src/state-facade.test.ts` fixture parity assertion, invalidation refetch, and rebaseline coverage; `packages/package-boundaries.test.ts` root-export ledger.                                                                     |

Second-half Increment 6 read-model rows:

| Kind                           | Builder source                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Invalidation mapping                                                                                                                            | Root exports                                                                                                                                                                                                                                                          | Tests                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`                     | `packages/state/src/state-facade.ts` joins app-global app preferences with the authoritative `request_user_input_settings` singleton and returns both as `SettingsReadModel`; even a workspace-requested rebaseline reads this settings result from the app-global store.                                                                                                                                                                                                                                                                                                                                                                       | App `{ model: "settings" }` refetches `settings`; app and workspace-requested rebaseline include the app-global `settings` result.              | `SettingsReadModel` from `@svvy/state`; `RequestInputSettings` from `@svvy/core`.                                                                                                                                                                                     | `packages/state/src/state-facade.test.ts` default, invalidation-refetch, app/workspace routing, and rebaseline coverage; `packages/state/src/structured-session-state-sqlite.test.ts` reopen coverage.                                                                                                                                 |
| `agents`                       | `packages/state/src/state-facade.ts` projects app-global DB-backed orchestrator/handler configuration into `configuredProfiles`, current exact-join workflow-agent source observations into `workflowAgents`, independently persisted orchestrator/workflow-task defaults into `actorExtensionDefaults`, and live session/thread/workflow-attempt facts into `bindings`. `generatedContextPreviews` remains data-only binding metadata and excludes prompt/guidance/declaration bodies.                                                                                                                                                         | App `{ model: "agents", ids? }` refetches `agents`; app rebaseline includes `agents`.                                                           | `AgentsReadModelRequest`, `AgentsReadModel`, `WorkflowAgentSourceReadModelRecord`, `ConfiguredAgentProfileReadModelRecord`, `AgentActorExtensionDefaultsReadModelRecord`, `AgentBindingReadModelRecord`, `GeneratedContextPreviewReadModelRecord` from `@svvy/state`. | `packages/state/src/state-facade.test.ts` proves valid/invalid workflow-agent rows, no generated-export fallback, builtin/deletable policy, configured profile/default preservation, live-binding separation, data-only generated-context metadata, and rebaseline coverage; `packages/package-boundaries.test.ts` root-export ledger. |
| `extensions`                   | `packages/state/src/state-facade.ts` starts from the persisted package-owned `ExtensionRegistryObservationResult` and joins the current registry/source-fingerprint-matched `ExtensionSourceBuildObservation` batch, profile usage, generated `@svvyx/extensions` package status, non-secret overrides, secret status, and the current fingerprint-matched complete CLI readiness batch. Missing or stale build authority fails closed; aggregate generated-package status never supplies context/runtime readiness. Orphan usage/env/readiness/build facts do not invent inventory rows; plaintext and secret refs never enter the read model. | App `{ model: "extensions", ids? }` refetches `extensions`; app rebaseline includes `extensions`.                                               | `ExtensionsReadModelRequest`, `ExtensionsReadModel`, `ExtensionReadModelRecord`, `ExtensionCliReadinessReadModel` from `@svvy/state`; registry, source/build evidence, and readiness contracts from `@svvy/core`.                                                     | `packages/state/src/state-facade.test.ts` registry/source-build/usage/env/CLI joins, blockers, stale/missing fail-closed behavior, and generated-package non-authority; `packages/state/src/runtime-extension-state-port.test.ts` durable reopen, validation, pruning, and changed/no-op invalidation; boundary ledger.                |
| `snippets`                     | `packages/state/src/state-facade.ts` reads state-owned `snippet` rows seeded once from the legacy managed snippet file store and then maintained by `StateCommands.snippets`; managed svvy snippets are durable DB rows and discovered snippet rows use the same read-model DTO when committed by source reconciliation.                                                                                                                                                                                                                                                                                                                        | Workspace `{ model: "snippets", ids? }` refetches `snippets`; workspace rebaseline includes `snippets`.                                         | `SnippetsReadModelRequest`, `SnippetsReadModel`, `SnippetReadModelRecord` from `@svvy/state`.                                                                                                                                                                         | `packages/state/src/state-facade.test.ts` non-empty row fixture, rebaseline coverage, and `snippets.createManaged` descriptor/idempotency test; `packages/package-boundaries.test.ts` root-export ledger.                                                                                                                              |
| `workflowsGenerated`           | `packages/state/src/state-facade.ts` reads the current `@svvyx/workflows` package fact and joins it by `buildId` to state-owned `generated_workflows_export` rows. A requested noncurrent build id returns empty facts and exports; the facade never mixes rows from another build. Export rows include the generated code/paths, exact agent parameters, and `workflowAgentId`.                                                                                                                                                                                                                                                                | App `{ model: "workflowsGenerated", ids? }` refetches `workflowsGenerated`; app rebaseline includes `workflowsGenerated`.                       | `WorkflowsGeneratedReadModelRequest`, `WorkflowsGeneratedReadModel`, `WorkflowsGeneratedExportReadModelRecord` from `@svvy/state`.                                                                                                                                    | `packages/state/src/state-facade.test.ts` non-empty export projection, build-id filtering, generated-package fact fixture assertion, and app rebaseline coverage; `packages/package-boundaries.test.ts` root-export ledger.                                                                                                            |
| `handlerInspector`             | `packages/state/src/state-facade.ts` ports the catalog handler-thread inspector by calling `buildStructuredHandlerThreadInspector(...)` from `packages/state/src/structured-session-selectors.ts` over routed structured-session snapshots.                                                                                                                                                                                                                                                                                                                                                                                                     | Workspace `{ model: "handlerThreadInspector", ids }` refetches one `handlerInspector` result per thread id.                                     | `HandlerInspectorReadModelRequest`, `HandlerInspectorReadModel` from `@svvy/state`.                                                                                                                                                                                   | `packages/state/src/state-facade.test.ts` handler-thread selector fixture assertion; `packages/package-boundaries.test.ts` root-export ledger.                                                                                                                                                                                         |
| `workflowTaskAttemptInspector` | `packages/state/src/state-facade.ts` ports the workflow task-attempt inspector by calling `buildStructuredWorkflowTaskAttemptInspector(...)` from `packages/state/src/structured-session-selectors.ts` over routed structured-session snapshots.                                                                                                                                                                                                                                                                                                                                                                                                | Workspace `{ model: "workflowTaskAttemptInspector", ids }` refetches one `workflowTaskAttemptInspector` result per attempt id.                  | `WorkflowTaskAttemptInspectorReadModelRequest`, `WorkflowTaskAttemptInspectorReadModel` from `@svvy/state`.                                                                                                                                                           | `packages/state/src/state-facade.test.ts` workflow-task selector fixture assertion; `packages/package-boundaries.test.ts` root-export ledger.                                                                                                                                                                                          |
| `workspaceChrome`              | `packages/state/src/state-facade.ts` reads only the app-global `workspace_chrome_state` and ordered `workspace_chrome_tab` rows, then validates the exact core chrome schema. Tabs persist label/kind and never contain branch/version fields.                                                                                                                                                                                                                                                                                                                                                                                                  | App `{ model: "workspaceChrome" }` refetches `workspaceChrome`; app rebaseline includes it.                                                     | `WorkspaceChromeReadModelRequest` from `@svvy/state`; `WorkspaceChromeReadModel` and `WorkspaceTabRecord` re-exported from `@svvy/core`.                                                                                                                              | `packages/core/src/workspace-layout-contracts.test.ts`; `packages/state/src/state-command-schemas.test.ts`; `packages/state/src/state-facade.test.ts`; `packages/package-boundaries.test.ts`.                                                                                                                                          |
| `workspaceLayout`              | `packages/state/src/state-facade.ts` resolves the explicit `workspaceId` to that workspace store, reads its exact materialized A/B/C `workspace_layout_slot` rows, and validates the full core layout schema. Stored Dockview/pane/compact JSON is decoded through the core contract rather than cast into the read model.                                                                                                                                                                                                                                                                                                                      | Workspace `{ model: "workspaceLayout", ids: [layoutId] }` refetches the authoritative full `workspaceLayout`; workspace rebaseline includes it. | `WorkspaceLayoutReadModelRequest` from `@svvy/state`; exact layout/slot/pane/target/local-state/placement types re-exported from `@svvy/core`.                                                                                                                        | Core target/placement golden; state SQLite initialization/latch/full-replacement test; state facade routing/repeat-read/refetch/rebaseline tests; boundary ledger.                                                                                                                                                                     |

`refetchInvalidation(...)` maps committed read-model invalidation descriptors to affected facade
read requests, and `rebaseline(...)` returns the authoritative baseline for the requested
app/workspace scope.

`refetchInvalidation(...)` accepts exactly one `StateInvalidationDescriptor` represented by a
`workspace_read_model.changed` or `app_read_model.changed` runtime event: workspace events map to
`{ scope: "workspace", workspaceId: event.workspaceId, invalidation: event.invalidation }`, and app
events map to `{ scope: "app", invalidation: event.invalidation }`. Runtime event subscription and
app/bootstrap notification fanout own cursor tracking, sequence-gap detection, and rebaseline
decisions; state refetch callers supply no fabricated event payload, ad hoc scope,
command-specific invalidation, caller-authored descriptor, or separate cursor fields. Workspace `{ model: "surface",
ids }` descriptors expand into every open surface-scoped read request the caller asks state to
maintain for that surface: surface summary, surface transcript, composer state, queued-message
state, prompt status, and surface-local chrome. Those slices may have
separate `StateReadModelRequest` kinds for efficient fetching, but they do not have independent
invalidation descriptors. Workspace-scoped prompt history instead uses the dedicated
`{ model: "promptHistory" }` invalidation because one accepted prompt updates every composer in the
workspace. Workspace `{ model: "commandInspector", ids }` descriptors refetch the
`commandInspector` read model; state does not expose a separate live stdout/stderr/progress delta
read model.

Every `StateReadModelRequest.kind` in the package-root facade has a matching read-model builder,
invalidation mapping where applicable, root export, and positive/negative contract tests. Renderer
or RPC transport exposure additionally requires matching exported request/result schemas unless this
spec names the DTO as a state-owned facade contract for that slice. UI panes, runtime notifications,
and headless read use cases consume only request kinds that appear in this union and have an
invalidation descriptor that lets callers refetch them without receiving duplicate read-model
payloads in runtime events. Workspace and workflows-generated read models are not package-root state
facade contracts unless their exact request/result variants are added to the `StateReadModelRequest`
and `StateReadModelResult` unions above.

`AppLogReadModel` is the Logs-pane read model. It includes the requested query, ordered retained log
entries, pagination/window metadata, summary counts, persisted view preferences, and read-state
metadata. It must not contain canonical session, command, artifact, workflow, generated-package, or
extension state; logs link to those records by id and callers refetch the authoritative read model.

Fetch examples for named read-model kinds:

```ts
const logs = await state.readModels.fetch({
  kind: "appLogs",
  workspaceId,
  query: { limit: 50 },
});

const settings = await state.readModels.fetch({
  kind: "settings",
});
```

`StateFacade.close()` releases only facade-owned callback, `AsyncIterable`, or subscription helper
resources. It does not dispose the app `ManagedRuntime`, state layer, database handle, or package
scope. Layer shutdown is owned by app/bootstrap through `managedRuntime.dispose()`.

State-owned command facade for DB/product-state-backed UI intents:

```ts
const stateCommands = createStateCommandsFacade(managedRuntime);

const result = await stateCommands.appPreferences.update({
  patch: { appearance: "dark", networkAccess: true },
  clientSubmission: {
    clientRequestId: "client_req_01",
    submittedAt: "2026-06-20T12:30:00.000Z",
    source: "desktop",
  },
});
```

`createStateCommandsFacade(managedRuntime)` is a separate root export from
`createStateFacade(managedRuntime)`. It exposes only named product commands whose writes are owned
by `@svvy/state` and backed by SQLite/product state. It does not expose generic mutation,
repository, table, transaction, SQL, migration, queue, command-fact, request-input,
generated-package build, source-file edit, sandbox, pi, or extension-handler methods. Every method
validates its input through an Effect Schema contract, executes the state-owned commit protocol
named by that command, and returns only committed output plus a state-issued receipt. Commands whose
protocol is SQLite-only execute one state transaction. Secret write/remove commands first use
`SecretStoreMutationPort` according to the secret update/removal ordering below, then commit the
SQLite reference/status transaction. Failed command protocols return a typed `StateContractError`
and no success receipt.

`StateCommands` and `createStateCommandsFacade(...)` expose only the named state-owned product
commands in this spec. Each public command has schema-backed input/result contracts, executes one
state-owned commit protocol, returns committed output plus a state-issued receipt, maps post-commit
descriptors, defines facade error mapping and idempotency behavior, and has package-root export and
positive/negative test coverage. Desktop, browser-tool, headless, runtime, and non-bootstrap app code
use this facade instead of structured-session wiring subpaths or store adapters.

The `@svvy/state` package root value exports `layer(input)`, `createStateFacade(...)`,
`createStateCommandsFacade(...)`, the Effect service tags `StateReadModels` and `StateCommands`,
and the named state-backed port layer values allowed by this spec. It also exports the
TypeScript-only facade and command contract names `StateFacade`, `StateFacadeCallOptions`,
`StateCommandsFacade`, and `StateCommandResult`, plus the root-layer config contracts and
`StateFacadeError`. `StateCommandReceipt` is a core-owned shared encoded contract exported from
`@svvy/core`, then imported and reused by `@svvy/state`; `@svvy/state` does not redefine it. Those
type exports do not add alternate state surfaces. Facade object/interface shapes may be
TypeScript-only; facade method inputs, results, receipts, and error payloads are not. Every facade
method payload that crosses a package, renderer, desktop bridge, browser-tool, headless automation,
or test harness boundary has a hoisted Effect Schema contract and derives its TypeScript type from
that schema.

State command Promise facades do not return raw `StateInvalidationDescriptor` arrays to renderer,
desktop, browser-tool, or headless callers. State Effect write services return core-owned
`StateInvalidationDescriptor` values in an internal `afterCommit` field. The
`createStateCommandsFacade(managedRuntime)` facade requires the app-bootstrap-owned
`ManagedRuntime` passed by the facade creator, and that runtime context must contain both
`StateCommands` and the core-owned
`StateCommandPostCommitNotificationPort`; secret write/remove command methods also require the
core-owned `SecretStoreMutationPort` in that runtime context. It runs the state write through that
runtime, collects `afterCommit` only after the state commit protocol succeeds, and hands the
committed descriptors to the notification port provided by `@svvy/runtime` in the composed app
runtime. `@svvy/state` consumes the port contract but does not provide it, import `@svvy/runtime`,
or own runtime event publication. Public command facade result schemas never expose descriptors, and
non-Effect callers
never receive raw descriptors. Runtime remains the sole publisher on the public event stream and
performs any runtime-owned refresh, scheduling, queue wakeup, source work, or recovery work after
state commits. If post-commit notification handling fails after the state transaction commits, the
facade rejects with `StateFacadeErrorContract.reason: "post-commit-notification-failed"` carrying
the committed receipt and typed notification error; callers must rebaseline through state read
models before retrying UI projection. Retrying with the same `clientRequestId` returns
`outcome: "duplicate"` and does not recreate descriptors.
`StateCommandPostCommitNotificationPort.notifyCommittedStateCommand(...)` is called only when the
committed mutation result has at least one `afterCommit` descriptor. Its acknowledgement is internal
runtime/app-bootstrap evidence and is never returned to the facade caller. Facade success returns
only the committed command result; a post-commit notification failure means projection delivery
failed after commit, not that the write rolled back.
Desktop consumers refetch state-backed read models after notifications.
Renderer panes and desktop UI state-command paths never manually fan out invalidations or call
runtime source-invalidation methods for DB/product-state writes. Browser-tool, headless,
app-bootstrap, test, and recovery callers may use runtime source-invalidation methods only for the
file-backed reconciliation domains named by `runtime.spec.md`.

`RuntimeSourceStatePort.reconcileDiscoveredHostSnippets(...)` is the workspace-only state boundary
for a committed `host_snippets` scan. One SQLite transaction upserts exact core-schema Claude/pi
rows by `(source, user-or-workspace discovery scope, canonical absolute path)`, revives tombstoned
rows without resetting their persisted `enabled` value, tombstones missing discovered rows, retains
rows named as unreadable files or descendants of unreadable roots, records scan diagnostics and
per-root fingerprints, bumps the state revision once, and returns one workspace `snippets`
after-commit invalidation. It never updates or tombstones managed `source = "svvy"` rows. Any
identity collision or invalid observation rolls the entire row/scan/root-fact write back.

`RuntimeSourceStatePort.recordWorkflowAgentSourceSave(...)` and
`recordWorkflowAgentSourceDelete(...)` commit the app-global editable source fact and durable
workflow-agent source index upsert/tombstone in one SQLite transaction and bump `state_revision`
once. `reconcileWorkflowAgentSources(...)` atomically upserts every exact core observation, commits
matching app-global workflow-agent facts, tombstones current facts/index rows absent from the scan,
updates the `workflows` scan/root-fingerprint receipts, and bumps the revision once. Each method
returns one deduplicated app invalidation batch containing `agents` and `workflowsGenerated`.

`afterCommit` is the field name for Effect state-port mutation results returned inside
runtime-owned lanes. `StateCommandsFacade` hides those descriptors and returns only the state command
receipt plus command-specific committed output.

StateCommandsFacade exposes the DB/product-state-backed command groups named in the canonical
facade shape below. Each command group is public only when its method names, result schemas,
secret-store ordering where applicable, transactions, notification behavior, package-root exports,
and tests are all named by this spec.

`StateCommandResult` is a TypeScript facade result type whose `receipt` field reuses the core-owned
`StateCommandReceipt` contract. Command facade results are package-root JavaScript/TypeScript facade
results, not independent renderer/RPC DTO schemas, unless this spec names the exact state-owned
command result schema, command method, transaction, notification behavior, package-root export, and
tests.

The canonical command facade shape is:

```ts
type StateCommandsFacade = {
  workspaceChrome: {
    setTabs(
      input: SetWorkspaceTabsCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    selectTab(
      input: SelectWorkspaceTabCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    selectLayoutSlot(
      input: SelectWorkspaceLayoutSlotCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  workspaceLayout: {
    saveSlot(
      input: SaveWorkspaceLayoutSlotCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  sessionNavigation: {
    setPinned(
      input: SetSessionPinnedCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setArchived(
      input: SetSessionArchivedCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    markRead(
      input: MarkSessionReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    markUnread(
      input: MarkSessionUnreadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setSectionState(
      input: SetSessionNavigationSectionStateCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  appLogs: {
    markRead(
      input: MarkAppLogReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    markVisibleRangeRead(
      input: MarkVisibleAppLogRangeReadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    clearWorkspaceUnread(
      input: ClearWorkspaceAppLogUnreadCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  appPreferences: {
    update(
      input: UpdateAppPreferencesCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  providerAuth: {
    recordStatus(
      input: RecordProviderAuthStatusInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  extensionEnv: {
    setOverride(
      input: SetExtensionEnvOverrideCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    removeOverride(
      input: RemoveExtensionEnvOverrideCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setSecret(
      input: SetExtensionEnvSecretCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult<{ configured: true }>>;
    removeSecret(
      input: RemoveExtensionEnvSecretCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult<{ configured: false }>>;
  };
  agentProfiles: {
    updateOrchestrator(
      input: UpdateOrchestratorProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    updateThreadHandler(
      input: UpdateThreadHandlerProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    deleteOrchestrator(
      input: DeleteOrchestratorProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    reorderOrchestrators(
      input: ReorderOrchestratorProfilesCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setProfileExtensionUsage(
      input: SetProfileExtensionUsageCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    promoteExtensionDefault(
      input: PromoteProfileExtensionDefaultCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    resetActorExtensionDefaults(
      input: ResetActorExtensionDefaultsCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setActorExtensionDefaults(
      input: SetAgentActorExtensionDefaultsCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setExternalInstructionActorUsage(
      input: SetExternalInstructionActorUsageCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  snippets: {
    createManaged(
      input: CreateManagedSnippetCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult<{ snippetId: SnippetId }>>;
    updateManaged(
      input: UpdateManagedSnippetCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    deleteManaged(
      input: DeleteManagedSnippetCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setEnabled(
      input: SetSnippetEnabledCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  close(): void;
};

import type { StateCommandReceipt } from "@svvy/core";

type StateFacadeCallOptions = {
  signal?: AbortSignal;
};

type StateCommandResult<Extra extends object = Record<never, never>> = Extra & {
  receipt: StateCommandReceipt;
};
```

`@svvy/state` owns the `StateCommandsFacade` TypeScript types and Effect Schema contracts except for
shared encoded contracts owned by `@svvy/core`, including `StateCommandReceipt`. The input contracts
reuse core ids, public encoded `RuntimeClientSubmissionInput`, and `ExtensionUsageState`. Public
command facade input and output schemas never expose
`StateInvalidationDescriptor`; descriptors remain an internal state/runtime write result detail.
`@svvy/core` remains the authoritative descriptor contract owner and `@svvy/runtime` remains the
authoritative public publisher.

`StateFacadeCallOptions.signal` is an interrupting state-facade signal, not a wait-only timeout. If
the signal is already aborted before a state facade call is admitted, the facade rejects with
`StateFacadeError { reason: "aborted" }` and does not run the Effect. If the signal aborts after the
call is admitted, the facade passes that signal to the caller-owned `ManagedRuntime` runner and maps
the interrupted `Exit` to `StateFacadeError { reason: "interrupted" }`. State facades must not
implement cancellation by `Promise.race(...)` against an abort listener, because that can reject the
caller while the state Effect keeps running, committing rows, publishing invalidations, or holding
resources. State mutations that have entered a transaction either roll back by interruption before
commit or complete the short uninterruptible commit section and return the committed receipt; they do
not continue silently after the facade has reported caller abort.

Every state command facade method is idempotent when `clientSubmission.clientRequestId` is present.
The state transaction stores one command receipt keyed by command name, caller/source, the command
subject identity derived from the decoded input, and `clientRequestId`. The subject identity is
command-specific, such as workspace id, workspace tab id, snippet id, provider/workspace credential
scope, extension env key, app/global scope, or app-log workspace scope; it is not inferred from
mutable current UI state unless that current value is explicitly part of the decoded command input.
A repeated matching submission returns the committed output with `receipt.outcome: "duplicate"`.
Durable extra output fields, such as a created `snippetId`, match the original committed output.
Duplicate replay never returns publication-ready after-commit descriptors, repeats file effects,
repeats SQL writes, inserts new invalidations, or republishes app/runtime notifications. If the same
id is reused with a different decoded input, the method fails with `StateContractError` code
`stale-state` or `invalid-input` according to the owning command contract. Commands without a client
request id are single-shot calls and receive `clientRequestId: null`.

Exact state command input contracts:

```ts
type StateCommandClientSubmission = RuntimeClientSubmissionInput;

type MarkAppLogReadCommandInput = {
  workspaceId?: WorkspaceId;
  entryIds: readonly AppLogEntryId[];
  readAt: IsoDateTimeString;
  clientSubmission: StateCommandClientSubmission;
};

type MarkVisibleAppLogRangeReadCommandInput = {
  workspaceId?: WorkspaceId;
  newestVisibleEntryId: AppLogEntryId;
  oldestVisibleEntryId: AppLogEntryId;
  readAt: IsoDateTimeString;
  filter?: AppLogFilter;
  clientSubmission: StateCommandClientSubmission;
};

type ClearWorkspaceAppLogUnreadCommandInput = {
  workspaceId?: WorkspaceId;
  readAt: IsoDateTimeString;
  clientSubmission: StateCommandClientSubmission;
};

type SetWorkspaceTabsCommandInput = {
  activeWorkspaceTabId: WorkspaceTabId | null;
  tabs: readonly WorkspaceTabRecordInput[];
  knownWorkspaces: readonly WorkspaceTabRecordInput[];
  clientSubmission?: StateCommandClientSubmission;
};

type SelectWorkspaceTabCommandInput = {
  workspaceTabId: WorkspaceTabId;
  clientSubmission?: StateCommandClientSubmission;
};

type SelectWorkspaceLayoutSlotCommandInput = {
  workspaceTabId: WorkspaceTabId;
  layoutId: WorkspaceLayoutSlotId;
  clientSubmission?: StateCommandClientSubmission;
};

type SetSessionPinnedCommandInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  pinned: boolean;
  clientSubmission?: StateCommandClientSubmission;
};

type SetSessionArchivedCommandInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  archived: boolean;
  clientSubmission?: StateCommandClientSubmission;
};

type MarkSessionReadCommandInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  clientSubmission?: StateCommandClientSubmission;
};

type MarkSessionUnreadCommandInput = MarkSessionReadCommandInput;

type SetSessionNavigationSectionStateCommandInput = {
  workspaceId: WorkspaceId;
  section: "pinned" | "active" | "archived";
  collapsed?: boolean;
  sizePx?: number;
  clientSubmission?: StateCommandClientSubmission;
};

type WorkspaceTabRecordInput = {
  workspaceTabId: WorkspaceTabId;
  workspaceId: WorkspaceId;
  cwd: AbsolutePath;
  workspaceLabel: string;
  kind: "default" | "user";
  openedAt: IsoDateTimeString;
  activeLayoutId: WorkspaceLayoutSlotId;
};

type WorkspaceLayoutSlotId = "A" | "B" | "C";

type SaveWorkspaceLayoutSlotCommandInput = {
  workspaceId: WorkspaceId;
  layoutId: WorkspaceLayoutSlotId;
  dockviewJson: JsonValue | null;
  panes: readonly WorkspacePaneRecord[];
  compactSurfaces: readonly CompactWorkspaceSurface[];
  focusedPaneId: WorkspacePaneId | null;
  clientSubmission?: StateCommandClientSubmission;
};

type WorkspacePaneRecord = {
  paneId: WorkspacePaneId;
  target: WorkspacePaneTarget;
  localState: {
    scroll: { transcriptAnchorId: string | null; offsetPx: number } | null;
    timelineDensity: "compact" | "comfortable";
  };
  fallbackChrome:
    | { title: string; subtitle: string | null; kind: WorkspacePaneFallbackChromeKind }
    | null;
  placement: WorkspacePanePlacement | null;
  restore:
    | { kind: "ready" }
    | { kind: "unavailable"; reason: string; lastKnownLocationLabel: string | null };
};

type WorkspacePaneTarget =
  | { surface: "orchestrator"; workspaceSessionId: WorkspaceSessionId; surfacePiSessionId: SurfacePiSessionId }
  | { surface: "handler"; workspaceSessionId: WorkspaceSessionId; surfacePiSessionId: SurfacePiSessionId; threadId: ThreadId }
  | { surface: "command"; workspaceSessionId: WorkspaceSessionId; commandId: CommandId }
  | { surface: "workflow-task-attempt"; workspaceSessionId: WorkspaceSessionId; workflowTaskAttemptId: WorkflowTaskAttemptId }
  | { surface: "artifact"; workspaceSessionId: WorkspaceSessionId; artifactId: ArtifactId }
  | { surface: "workflows" | "snippets" | "settings" | "open-workspace" }
  | { surface: "agents"; targetAgentProfileId?: AgentProfileId; view?: "profiles" | "generated-context-preview" }
  | { surface: "extensions"; targetExtensionId?: ExtensionId; view?: "inventory" | "generated-context-preview" }
  | { surface: "app-logs"; workspaceSessionId?: WorkspaceSessionId };

type WorkspacePaneFallbackChromeKind =
  | "orchestrator" | "handler-thread" | "artifact" | "workflows" | "agents"
  | "extensions" | "snippets" | "settings" | "app-logs" | "open-workspace"
  | "command" | "workflow-task-attempt";

type WorkspacePanePlacement =
  | { kind: "split"; referencePanelId: WorkspacePaneId; direction: "left" | "right" | "above" | "below"; size?: number }
  | { kind: "tab"; groupId: string; index?: number }
  | { kind: "edge"; direction: "left" | "right" | "above" | "below"; size?: number }
  | { kind: "floating"; box?: { x: number; y: number; width: number; height: number } }
  | { kind: "popout"; box?: { left: number; top: number; width: number; height: number } };

type CompactWorkspaceSurface = {
  kind: "compact-thread";
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
  panelId: WorkspacePaneId | null;
  density: "compact" | "comfortable";
};

Workspace chrome and layout have no file import, old-schema migration, compatibility alias, or
dual-write path. A workspace store materializes exactly A/B/C empty rows at setup with the stable
epoch timestamp; repeat reads therefore do not invent a new `updatedAt`. Saving an empty never-used
slot leaves `initialized: false`. The first save with a bound product pane latches it true, and later
empty full replacements keep it true while deleting every stale pane and compact row. Duplicate
visual tabs retain distinct `workspaceTabId` values but address the same workspace store, so they
share `(workspaceId, layoutId)` contents. The same tab id may appear once in both ordered open and
known collections; duplicates within either collection are rejected.

Workspace chrome selection validates the open tab and writes the active tab or selected layout in
the same app-store SQLite transaction. Selecting a missing open tab fails with a typed `not-found`
`StateContractError`; selecting the already-current value is an exact no-op that does not advance
the revision or publish an invalidation. Layout selection updates both the open and known copy of
the same visual tab. A full `setTabs` remains authoritative for ordering, records, and removals, but
preserves the current active tab and per-tab layout selection for every surviving
`(workspaceTabId, workspaceId)` pair, so a stale full write cannot overwrite a newer granular
selection within one app authority.

type UpdateAppPreferencesPatch = {
  appearance?: "system" | "light" | "dark";
  externalEditor?: string | null;
  artifactDirectory?: AbsolutePath;
  approvalMode?: "auto-review" | "user" | "full-access";
  networkAccess?: boolean;
  externalInstructions?: ExternalInstructionsSettings;
  ambientResources?: AmbientAgentResourceSettings;
};

type UpdateAppPreferencesCommandInput = {
  patch: UpdateAppPreferencesPatch;
  clientSubmission?: StateCommandClientSubmission;
};

type RecordProviderAuthStatusInput = {
  status: {
    providerId: ProviderId;
    workspaceId?: WorkspaceId;
    health: "usable" | "missing" | "expired" | "refresh_failed";
    redactedAccountLabel?: string;
    refreshedAt?: IsoDateTimeString;
    expiresAt?: IsoDateTimeString;
    issue?: string;
  };
  observedAt: IsoDateTimeString;
  source: "provider_refresh" | "startup_scan" | "user_action" | "runtime_retry";
  clientSubmission?: StateCommandClientSubmission;
};

type SetExtensionEnvOverrideCommandInput = {
  extensionId: ExtensionId;
  envName: ExtensionEnvName;
  value: string;
  clientSubmission?: StateCommandClientSubmission;
};

type RemoveExtensionEnvOverrideCommandInput = {
  extensionId: ExtensionId;
  envName: ExtensionEnvName;
  clientSubmission?: StateCommandClientSubmission;
};

type UpdateOrchestratorProfileCommandInput = {
  profile: OrchestratorAgentProfileInput;
  clientSubmission?: StateCommandClientSubmission;
};

type UpdateThreadHandlerProfileCommandInput = {
  profile: ThreadHandlerProfileInput;
  clientSubmission?: StateCommandClientSubmission;
};

type DeleteOrchestratorProfileCommandInput = {
  profileId: AgentProfileId;
  clientSubmission?: StateCommandClientSubmission;
};

type ReorderOrchestratorProfilesCommandInput = {
  profileIds: readonly AgentProfileId[];
  clientSubmission?: StateCommandClientSubmission;
};

type SetProfileExtensionUsageCommandInput = {
  actor: "orchestrator" | "handler";
  profileId: AgentProfileId;
  extensionId: ExtensionId;
  usage: ExtensionUsageState;
  clientSubmission?: StateCommandClientSubmission;
};

type PromoteProfileExtensionDefaultCommandInput = {
  actor: "orchestrator" | "workflow-task";
  profileId: AgentProfileId;
  extensionId: ExtensionId;
  usage: ExtensionUsageState;
  clientSubmission?: StateCommandClientSubmission;
};

type ResetActorExtensionDefaultsCommandInput = {
  actor: "orchestrator" | "workflow-task";
  reset: "usage" | "order" | "usage-and-order";
  clientSubmission?: StateCommandClientSubmission;
};

type SetAgentActorExtensionDefaultsCommandInput = {
  actor: "orchestrator" | "workflow-task";
  extensionUsage: Readonly<Record<ExtensionId, ExtensionUsageState>>;
  extensionOrder: readonly ExtensionId[];
  clientSubmission?: StateCommandClientSubmission;
};

type SetExternalInstructionActorUsageCommandInput = {
  actor: "orchestrator" | "handler";
  profileId: AgentProfileId;
  sourceId: ExternalInstructionSourceId;
  usage: "disabled" | "available" | "loaded";
  order?: number;
  clientSubmission?: StateCommandClientSubmission;
};

type OrchestratorAgentProfileInput = {
  profileId: AgentProfileId;
  name: string;
  providerId: ProviderId;
  modelId: ModelId;
  reasoning?: ReasoningSelection;
  followComposer: boolean;
  extensionUsage: Readonly<Record<ExtensionId, ExtensionUsageState>>;
  extensionOrder?: readonly ExtensionId[];
};

type ThreadHandlerProfileInput = Omit<OrchestratorAgentProfileInput, "followComposer">;

type CreateManagedSnippetCommandInput = {
  workspaceId: WorkspaceId;
  title: string;
  body: string;
  metadata: SnippetMetadata;
  enabled: boolean;
  clientSubmission?: StateCommandClientSubmission;
};

type UpdateManagedSnippetPatch = {
  title?: string;
  body?: string;
  metadata?: SnippetMetadata;
  enabled?: boolean;
};

type UpdateManagedSnippetCommandInput = {
  workspaceId: WorkspaceId;
  snippetId: SnippetId;
  patch: UpdateManagedSnippetPatch;
  clientSubmission?: StateCommandClientSubmission;
};

type DeleteManagedSnippetCommandInput = {
  workspaceId: WorkspaceId;
  snippetId: SnippetId;
  clientSubmission?: StateCommandClientSubmission;
};

type SetSnippetEnabledCommandInput = {
  workspaceId: WorkspaceId;
  snippetId: SnippetId;
  enabled: boolean;
  clientSubmission?: StateCommandClientSubmission;
};
```

Session-navigation commands always route by explicit `workspaceId`; session-targeted commands also
require `workspaceSessionId`, and state rejects a session that is absent from that routed workspace
instead of creating or resolving it from focused renderer state. `setPinned` and `setArchived` use
one boolean for both directions and preserve the existing invariant that pinning clears archive
state while archiving clears pin state. `markUnread` is the product-UI manual action and commits
`unreadReason: "manual"`; runtime remains the only writer of
`unreadReason: "assistant-turn-finished"`. `setSectionState` requires at least one of `collapsed` or
`sizePx`; state normalizes the durable size through the existing 64–1000 px integer clamp.

These five state-owned operations return `sessionNavigation` invalidations only, because pin,
archive, unread, and section-layout facts are absent from `SurfaceSummaryReadModel`. Manual rename
is deliberately not a state command: the complete product operation must append pi `SessionInfo`
through the pi session manager before committing the manual title override. The renderer cutover
therefore requires a typed runtime-owned rename operation; after that atomic operation commits,
runtime must publish both `sessionNavigation` and the orchestrator `surface` invalidations. State
does not expose a partial rename/title-override command that could desynchronize pi history and
structured title facts.

Snippet command and read-model contracts reuse the exact core-owned `SnippetMetadata` and
`SnippetSource` contracts. Metadata contains only nullable `description` and `argumentHint`; source
is exactly `svvy`, `claude`, or `pi`, with no generic `host` source or arbitrary JSON metadata.
Managed create/update title decoding trims surrounding whitespace and rejects an empty result.
Managed update/delete resolves the row by both explicit `workspaceId` and `source = "svvy"` before
writing; missing, cross-workspace, deleted, and discovered rows return `StateContractError` without
bumping the state revision or emitting an invalidation descriptor. `setEnabled` remains valid for
both managed and discovered rows, but still resolves the target inside the explicit workspace.

Secret-bearing local types stay process-local. Persisted state, RPC contracts, generated package
files, read models, diagnostics, and app logs expose only presence, non-secret labels, extension
env names, or fingerprints. Provider credential writes/removals are not `StateCommandsFacade`
methods in this surface. Extension secret writes/removals are the state-owned
`extensionEnv.setSecret` and `extensionEnv.removeSecret` commands: they accept process-local
redacted input, use the privately captured `SecretStoreMutationPort`, and commit only declaration,
status, opaque-ref, receipt, and cleanup-recovery facts. The same group owns non-secret app-level
overrides keyed by `(extensionId, envName)`.

Public command patch contracts are named schemas, not `Partial<...>` aliases. Patch schema fields
use `Schema.optionalKey(...)` so omitted means “leave unchanged” and `undefined` is not accepted as
a value. Explicit `null` is used only where clearing a nullable field is a product operation.

Every exposed command facade method has a matching exported input schema named `<TypeName>Schema`
from `@svvy/state`, plus decoded and encoded types, `decodeUnknown<TypeName>Effect`,
`decodeUnknown<TypeName>Exit`, `encode<TypeName>Effect`, and `encode<TypeName>Exit`. Separate
non-throwing outbound helpers land only when bridge adapters explicitly need them. Command methods return the shared
`StateCommandResult` receipt contract plus method-specific committed output where the method has a
domain value to return; method-specific output schemas must land before those outputs cross renderer
or RPC transport boundaries.
`StateCommandsFacade` exposes only the finite command groups named in the facade shape above:
`workspaceChrome`, `workspaceLayout`, `sessionNavigation`, `appPreferences`, `providerAuth`,
`extensionEnv`, `agentProfiles`, `snippets`, and `appLogs`. Provider-auth and extension-env secret schemas are
trusted user-entry ingress contracts only for the named `providerAuth` and `extensionEnv` methods
above. No other command group accepts raw secret values.
Result payloads are encoded before RPC/facade emission; decoded class, redacted, and `DateTime`
values do not cross bridge or persistence boundaries. `StateCommandsFacade` exposes only methods
with input schema, result schema, transaction behavior, invalidation set, and package-boundary
export test coverage. Similar repository/helper request names are not substitutes for these facade
contracts.

Command results do not include fresh read models, previews, or renderer state. The initiating caller
receives only commit-scoped facts that cannot be fetched before the write, such as the generated
`snippetId` for `snippets.createManaged(...)`, plus the state-issued receipt. All read data comes from
`createStateFacade(...).readModels` after runtime publishes the corresponding typed notifications.

`StateCommandsFacade` owns these DB/product-state-backed use cases:

| Facade group        | Use case                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Product-state owner                                                                                    | Not allowed in this group                                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceChrome`   | Persist app-global workspace tab order, active tab, known workspace records, label/kind, and each tab's selected slot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | App-global `@svvy/state` workspace chrome tables                                                       | Acquiring a workspace runtime, repository picking, runtime/session lifecycle, layout contents.                                                                         |
| `workspaceLayout`   | Atomically replace one explicitly routed workspace A/B/C slot's Dockview JSON, exact pane/compact arrays, focus, and state-owned timestamp. Initialization latches only after the first non-empty pane array; later empty saves retain the latch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Workspace-routed `@svvy/state` layout rows keyed by `(workspaceId, layoutId)`                          | Partial pane patches, rendering Dockview, owning live Svelte state, prompt/session mutation.                                                                           |
| `sessionNavigation` | Persist explicitly workspace-routed session pin/archive/manual-read state and per-workspace session-section collapsed/size state through the existing structured-session transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `@svvy/state` session navigation and workspace sidebar rows                                            | Session create/open/delete lifecycle, pi `SessionInfo` mutation, partial manual rename/title override, focused-pane routing, or assistant-turn-finished unread policy. |
| `appPreferences`    | Persist appearance, external editor, preferred artifact directory, approval mode, network access, exact schema-backed external-instruction roots/actor controls, and ambient resource settings. External-instruction settings are canonicalized through the public `@svvy/core` contract before commit, so state read models and runtime consumers observe the same builtin roots, trimmed identities/paths, and deterministic actor order. App/bootstrap may read the file-backed agent-settings preferences only as a bootstrap seed when no state app-preference row exists; once a state row exists, `@svvy/state` settings rows are authoritative for these fields and the file store is not written as a compatibility mirror. App/bootstrap resolves the preferred artifact directory into `StateLayerConfig.artifactRoot` before acquiring `@svvy/state`; changing the persisted preference affects artifact file effects only after app/bootstrap reacquires the app runtime/state graph. | `@svvy/state` settings tables                                                                          | Provider OAuth flows, secret entry UI, sandbox launch execution, prompt rebuilding.                                                                                    |
| `providerAuth`      | Persist provider credential presence, provider auth status rows, and OAuth result/status facts through state-owned provider auth status rows and secret references coordinated with host/live `SecretStorePort`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `@svvy/state` provider auth tables and secret references                                               | Live OAuth browser/device flow, model probing, pi provider calls, returning raw secrets.                                                                               |
| `extensionEnv`      | Persist app-global non-secret extension env overrides, secret references, and env status facts used by readiness and invocation env resolution.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `@svvy/state` extension env tables and secret references                                               | Running extension commands, exposing raw secrets, editing extension source manifests, generated package refresh execution.                                             |
| `agentProfiles`     | Persist orchestrator profile rows, singleton handler profile, sparse orchestrator/handler extension usage, independently keyed orchestrator/workflow-task actor extension defaults, DB-backed external-instruction actor usage/order, and workflow-task defaults for newly created workflow task-agent attempts that are not tied to one `.agent.json` source file. The default orchestrator is locked first and cannot be deleted; the singleton handler profile is not governed by an actor-default row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `@svvy/state` `agent_profile`, `agent_actor_extension_defaults`, and external-instruction usage tables | Workflow-agent `.agent.json` row edits, extension source edits, generated actor-context rendering.                                                                     |
| `snippets`          | Persist exact-schema managed svvy snippets and enablement state for managed/discovered snippets; trim and reject empty managed titles, and reject missing, cross-workspace, or discovered managed update/delete targets without committing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `@svvy/state` snippet tables                                                                           | Editing read-only host snippet files, watching snippet source roots, expanding snippets into prompt text during send.                                                  |
| `appLogs`           | Persist app-log read cursors, visible-range read marking, and workspace/app unread clearing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `@svvy/state` app-log read-state tables                                                                | Deleting log rows, rewriting payloads, publishing live bridge messages directly, or inferring command/session state.                                                   |

Increment 6 command-group rows:

| Group               | Command path port                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | After-commit descriptors                                                                                           | Renderer-safe facade row                                                                                                      | Tests                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaceChrome`   | `state-facade.ts` validates set/select inputs and routes them only to the app-global store. The store validates selection existence and writes in one SQLite transaction, reports committed/no-op precisely, and throws typed `not-found` without a facade pre-read. `setTabs` preserves newer granular active-tab and surviving-tab layout selections.                                                                                                                                                                                                                                                                             | App `{ model: "workspaceChrome" }` after committed mutation; duplicate replay and exact no-op have no descriptors. | `StateCommandsFacade.workspaceChrome`; renderer narrowing is app/bootstrap integration work.                                  | State schema, facade receipt/idempotency, atomic selection/no-op/not-found concurrency, target-disappears, and app-store routing tests; boundary ledger.                                                                                                                                     |
| `workspaceLayout`   | `state-facade.ts` validates `SaveWorkspaceLayoutSlotCommandInput` with the shared core slot-content invariant, resolves its explicit workspace store, and performs one full slot replacement through `StateCommands.workspaceLayout.saveSlot`.                                                                                                                                                                                                                                                                                                                                                                                      | Workspace `{ model: "workspaceLayout", ids: [layoutId] }`; duplicate replay has no descriptors.                    | `StateCommandsFacade.workspaceLayout.saveSlot`; renderer narrowing is app/bootstrap integration work.                         | Core schema golden; state command schema; SQLite latch/stale-row replacement; facade explicit-routing/idempotency tests; boundary ledger.                                                                                                                                                    |
| `sessionNavigation` | `packages/state/src/state-facade.ts` validates five exact command inputs through `state-command-schemas.ts`, routes by explicit `workspaceId`, verifies session ownership where applicable, and commits through `StructuredSessionState.applySessionNavigationCommand(...)` over the existing pin/archive/read/sidebar methods.                                                                                                                                                                                                                                                                                                     | Workspace `{ model: "sessionNavigation" }` only; duplicate replay returns no descriptors.                          | `StateCommandsFacade.sessionNavigation`; app/bootstrap narrows this group for renderer use during the renderer cutover.       | `packages/state/src/state-command-schemas.test.ts` strict routing/shape tests; `packages/state/src/state-facade.test.ts` boolean directions, manual unread, section clamp, duplicate receipt, post-commit publication, and cross-workspace rejection; `packages/package-boundaries.test.ts`. |
| `extensionEnv`      | `packages/state/src/state-facade.ts` validates non-secret overrides plus declared secret set/remove inputs through `state-command-schemas.ts`; secret commands use the state-service-captured `SecretStoreMutationPort`, versioned replacement, DB-first removal, durable receipts, and cleanup recovery without persisting plaintext.                                                                                                                                                                                                                                                                                              | App `{ model: "extensions", ids: [extensionId] }` descriptors.                                                     | `StateCommandsFacade.extensionEnv`; app/bootstrap may narrow trusted secret entry separately from ordinary renderer commands. | `packages/state/src/state-facade.test.ts` sequencing, replay, invalid-target, cleanup, and sentinel-absence coverage; schema and boundary coverage.                                                                                                                                          |
| `agentProfiles`     | `packages/state/src/state-facade.ts` validates orchestrator/thread-handler profile, extension usage/default, order, and external-instruction usage command inputs through `state-command-schemas.ts` and routes them through `StateCommands.agentProfiles`. Store policy rejects deleting or moving `default-orchestrator`, requires reorder input to contain every orchestrator exactly once, removes an orchestrator profile usage key when it equals that extension's persisted actor default, keeps handler usage explicit, and makes promote/reset address only the exact `orchestrator` or `workflow-task` actor-default row. | App `{ model: "agents", ids? }` descriptors.                                                                       | `RendererStateCommandsFacade.agentProfiles` in `src/bun/renderer-state-facade.ts` and `packages/desktop/src/index.ts`.        | `packages/state/src/state-facade.test.ts`; `packages/state/src/structured-session-state-sqlite.test.ts`; `src/bun/renderer-state-facade.test.ts`; `src/bun/removed-contracts.test.ts` legacy channel coverage.                                                                               |
| `snippets`          | `packages/state/src/state-facade.ts` validates exact core snippet metadata/source contracts and trimmed non-empty managed titles through `state-command-schemas.ts`, routes every request by explicit workspace through `StateCommands.snippets`, and requires managed update/delete targets to exist in that workspace with `source = "svvy"`; `createManaged` returns the committed `snippetId` plus receipt.                                                                                                                                                                                                                     | Workspace `{ model: "snippets", ids: [snippetId] }` descriptors only after a successful commit.                    | `RendererStateCommandsFacade.snippets` in `src/bun/renderer-state-facade.ts` and `packages/desktop/src/index.ts`.             | `packages/state/src/state-command-schemas.test.ts`; `packages/state/src/structured-session-state-sqlite.test.ts`; `packages/state/src/state-facade.test.ts`; `src/bun/renderer-state-facade.test.ts`; `src/bun/removed-contracts.test.ts` legacy channel coverage.                           |

File-backed source commands are excluded by construction. Workflow-agent `.agent.json` edits,
including that workflow agent's provider, model, reasoning, instruction text, extension usage
overrides, and source-order metadata, go through the runtime source-edit service over a
`WorkflowAgentSourceRef` and `@svvy/extensions` source services. Workflows prompt/component/workflow
edits, normal extension source edits, and extension generated contributor source edits use that same
runtime/source-edit boundary. External instruction input records are read-only discovered inputs:
runtime/workspace watchers and `@svvy/extensions` discovery services read their file identity,
content, and fingerprints, while actor enablement, ordering, diagnostics, and participation facts
stay DB/product-state-backed in `@svvy/state`. Generated-package refresh is a runtime
command/effect path.
Runtime queue, turn, command-fact, request-input, recovery, and title mutations stay on
runtime-facing Effect state ports and are not available to desktop as state commands.

Example input/output for a DB-backed agent-profile edit:

```json
{
  "input": {
    "profile": {
      "profileId": "profile_default_orchestrator",
      "name": "Default Orchestrator",
      "providerId": "openai",
      "modelId": "gpt-5.5",
      "reasoning": { "effort": "high" },
      "followComposer": true,
      "extensionUsage": {
        "github": "loaded",
        "smithers": "available"
      },
      "extensionOrder": ["base-common", "base-orchestrator", "github", "smithers"]
    },
    "clientSubmission": {
      "clientRequestId": "client_req_02",
      "submittedAt": "2026-06-20T12:31:00.000Z",
      "source": "desktop"
    }
  },
  "output": {
    "receipt": {
      "clientRequestId": "client_req_02",
      "outcome": "applied",
      "committedAt": "2026-06-20T12:31:00.000Z",
      "stateRevision": 42
    }
  }
}
```

Actual command results include no generated prompt preview, no generated context body, no extension
source text, no renderer draft state, no read-model payload, and no pi objects. A caller that needs
generated context details or updated Agents-pane data fetches the relevant state read model after
invalidations publish.

App-log implementation helpers are package-private or explicit state-owned subpaths. The root
entrypoint exports the primary state layer factory, approved state read and command facades, and
layer exports for core-owned state-backed ports only. Pure helpers live on their named subpaths, not
the root. `StateStore` is an internal implementation service and is not a public dependency for
`@svvy/runtime`, `@svvy/extensions`, `@svvy/pi-adapter`, `@svvy/desktop`, renderer code, or bridge
code.

The root entrypoint exposes enough app-bootstrap surface to compose one state layer and wire
state-backed ports into dependent package layers. Non-state packages consume only their declared
core-owned ports or approved facades; they do not receive an umbrella store object. Renderer-safe
pure selectors that must not pull in SQLite-backed modules are exported through explicit public
subpaths such as `@svvy/state/session-navigation`; new subpaths require package-boundary tests and
must not expose table internals.

State-owned domain and port slices, not `StateStore` or facade API groups:

- `settings`
- `providers`
- `providerAuth`
- `workspaces`
- `worktrees`
- `sessions`
- `surfaces`
- `queues`
- `turns`
- `threads`
- `requestInput`
- `commands`
- `artifacts`
- `artifactCommands`
- `snippets`
- `logs`
- `titles`
- `recovery`
- `generatedContext`
- `generatedPackages`
- `readModels`
- `piSessionReferences`
- `sandboxPolicy`
- `migrations`
- `transactions`

This list names internal package organization and approved core-owned state-backed port areas, not
package-root exports. In particular, migrations and transactions are package-private
implementation slices; public callers never import migration runners, transaction services, SQL
clients, table helpers, repositories, or broad store handles.

The app-log state slice is DB/product-state-backed. `@svvy/core` owns `AppLogLevel`,
`AppLogSource`, `AppLogEntry`, `AppLogSummary`, `AppLogQuery`, `AppLogReadModel`, and
`AppLogUpdateMessage`. `@svvy/state` owns the SQLite-backed app-log persistence implementation,
redaction before persistence/live delivery, unread state, query filtering, bounded retention, and a
finite app-log implementation behind state ports and the named state read/command facades. The
package root exports `createStateAppLogsFacade(...)` only as a state-owned app/bootstrap facade that
preserves synchronous append/query/summary/mark-seen/subscribe/close behavior and exposes the
matching `AppLogWritePortService` for runtime composition from the same backing store. The package
root must not export separate app-log implementation facades or loggers such as `AppLogFacade`,
`AppLogAppender`, `AppLogAppendInput`, `CreateAppLogFacadeOptions`, `createAppLogFacade`,
`AppLogger`, `CreateAppLoggerOptions`, `createAppLogger`, `AppLogStore`, `createAppLogStore`,
`AppLogState`, `AppLogStateService`, `appLogStateFromStore`, `makeAppLogState`, or
`layerAppLogState`. Internal app-log stores and logger helpers stay package-private to
`@svvy/state` implementation or state-local tests. Production app bootstrap, runtime, desktop,
generated-package, extension, sandbox, browser-tool, headless, and renderer/shared code must not
import app-log implementation modules or standalone app-log facade helpers. Public app-log writes
go through `AppLogWritePort`; public reads and read-state mutations go through `StateReadModels`
and `StateCommandsFacade.appLogs`. Bridge
forwarding is app/bootstrap/runtime-owned; bridge transport, workspace routing, and renderer
delivery stay outside `@svvy/state`.
`AppLogWritePort.append(input)` validates `AppendAppLogInputSchema`, redacts before persistence,
inserts one app-log row in a write transaction, and returns
`StateMutationResult<{ appLogEntryId: AppLogEntryId }>` with the app-log entry id in `value`.
Success returns an `appLogs` invalidation only when `input.workspaceId` is present; app-global
app-log appends return no invalidation descriptor. There is an `appLogSummary` read model,
but no separate invalidation descriptor. Direct
`AppLogWritePort.append(...)` failure is a state command failure for that append operation. Only the
separate best-effort Effect-log-to-app-log bridge may degrade to metrics/diagnostic fallback, and
bridge failure must not fail the domain operation that emitted the Effect log.
`AppLogUpdateMessage` is a redacted post-commit live delivery optimization for open panes. It is not
a durable event log, not an app-log read model, and not sufficient for recovery. Renderer and
headless consumers fall back to the `appLogs` invalidation/read-model refetch path whenever a live
message is missed, rejected, filtered out, or older than the retained UI window.
App/bootstrap may observe `createStateAppLogsFacade(...).subscribe(...)` only to identify that a real
append committed in the app-global or a registered workspace app-log source. It hands only that
source scope to `@svvy/runtime/app-log-commit-notification-adapter`; runtime constructs the fixed
`appLogs` invalidation and owns event publication. State does not construct runtime descriptors from
the subscription, publish runtime events, call renderer transport, or treat the live callback as
durable replay.

App-log read-state commands are DB/product-state-backed. `appLogs.markRead(...)`,
`appLogs.markVisibleRangeRead(...)`, and `appLogs.clearWorkspaceUnread(...)` mutate only the
persisted app-log read cursor/read-entry state for the app or targeted workspace. They do not delete
log entries, rewrite log payloads, publish live bridge messages directly, or infer command/session
state. On commit they return `appLogs` invalidations for the targeted workspace or app/global
app-log read model. A dedicated `appLogSummary` invalidation variant does not exist unless it is
first added to `@svvy/core`; summary data is refetched from the `appLogSummary` read model in
response to the `appLogs` invalidation.

## Port Boundaries

State exposes narrow ports to other packages instead of raw store/database objects. `@svvy/core`
owns the shared `Context.Service` tags, data contracts, and structural request/result shapes for
cross-package state-backed ports; `@svvy/state` owns the implementations, layers, transactions, and
test layers for those ports.

- Runtime-facing state access is split into named Effect port services by lifecycle domain:
  surface/session identity, queue claiming, turn records, command facts, thread/report records,
  request-input/approval records, generated-context bindings, generated-package facts,
  recovery/title jobs, and read models. No runtime package code receives one umbrella state object.
- `extensionStatePort()` exposes extension records, profile/default usage, generated-context
  source/build facts, env status, dependency readiness, source fingerprints, and read-only
  generated-package fact selectors needed by `@svvy/extensions`. Generated-package fact writes
  remain runtime-owned through `RuntimeGeneratedPackageStatePort`.
- `SandboxPolicySource.snapshot(input)` exposes immutable `SandboxPolicySnapshot` resolution
  defined in `@svvy/core`. The input is the core-owned `SandboxPolicySnapshotInput` naming the
  target workspace/session scope and the command/run context whose launch policy is being resolved;
  callers do not pass raw settings rows, renderer preferences, profile fragments, or filesystem
  roots. The source of truth is committed `@svvy/state` app/workspace settings, committed generated
  package facts, and immutable app-bootstrap sandbox policy roots supplied through
  `StateLayerConfig.sandboxPolicy` at layer composition. The returned snapshot is an immutable
  launch input for `@svvy/sandbox`, not a live settings view and not a policy mutation surface.
- `layerAppLogWritePort` is the public state-owned layer for the append-only durable
  `AppLogWritePort` implementation. Direct calls to `AppLogWritePort.append(...)` are durable
  product-state writes for exact app-log facts and return committed invalidation descriptors.
  Runtime and app/bootstrap may use that direct durable path for named product facts. State does not
  expose an Effect-log observation surface. Any Effect-log diagnostic sink must be specified as its
  own app/bootstrap diagnostic adapter, may observe promoted `Effect.log*` events only after the
  exact members are promoted in `packages/effect-adoption-manifest.ts`, and sink failure must not
  fail the domain operation that emitted the Effect log. Other packages use caller-provided logging
  policy without assuming `Effect.log*` production imports; they may call `AppLogWritePort` directly
  only when their package spec names the exact durable diagnostic fact, input shape, redaction policy, and
  tests.
  Extensions, pi-adapter, and sandbox still do not publish runtime events or command/session facts.
- Secret create, update, and remove operations are state-owned app command facade operations reached
  from user-owned UI or runtime command paths. `@svvy/state` never owns or exports its own
  secret-store implementation or state-backed secret mutation port. State-owned command services may
  require the core-owned host/live `SecretStoreMutationPort` from the app runtime context only to
  write or remove user-entered secret material, then persist redacted refs/status rows. Runtime,
  extensions, pi-adapter, sandbox, generated packages, and agent-facing tools never receive raw
  secret values. Invocation-local secret resolution is provided by the host/live `SecretStorePort`,
  which returns only status records or `Redacted` invocation values.
- `RuntimeArtifactStatePort` exposes artifact metadata creation, inspection, listing, deletion,
  command linkage, materialization status, immutable flags, digests, and stored-path facts for
  runtime-owned artifact commands. Physical artifact file effects, immutable-path placement,
  digest/byte calculation, and file deletion run in runtime-owned artifact file-effect services.
  Runtime calls the artifact port only to commit metadata lifecycle transitions and publishes only
  committed `afterCommit` descriptors.

Ports must not expose SQLite table handles. Ports must return typed domain records and read models.
Ports are Effect-native. State-backed runtime ports use `StateContractError`. Core-owned provider
and pi-reference ports keep their public error channels: `ProviderAuthPortError` and
`PiSessionReferencePortError`. `@svvy/state` implementations map SQL, schema, secret-store, and
transaction failures into those port-specific errors before returning. They do not leak
`StateContractError` across those two public port boundaries unless the core contract is explicitly
changed. State port and facade errors may retain raw foreign causes only inside package-private
logs, spans, or test diagnostics. Any `StateContractError`, `ProviderAuthPortError`,
`PiSessionReferencePortError`, `AppLogWriteError`, `SecretStorePortError`, or state facade error
payload that crosses a package, bridge, persistence, command-fact, app-log, runtime-event, or
read-model boundary carries only stable reason fields, a redacted message, normalized boundary
issues when applicable, and sanitized `Schema.Defect({ excludeCause: true })` data.

Runtime-facing port contracts are named method groups, not one umbrella runtime API. Each port
exposes only the operations required by its owning runtime subsystem. The queue port owns durable
surface-message row lifecycle for runtime queue insertion, claiming, restoration, and terminal
status updates; visible row listing and manual reordering belong to read-model/UI-control ports.

````ts
// Service tags and service shape types are exported by @svvy/core.
// @svvy/state exports implementations and layers for those tags.
const RuntimeQueueStatePortLayer = Layer.effect(
  RuntimeQueueStatePort,
  makeRuntimeQueueStatePort(),
);

const RuntimeTurnStatePortLayer = Layer.effect(RuntimeTurnStatePort, makeRuntimeTurnStatePort());

// Each listed port must be specified in this section before it is added to the public state boundary:
// one core-owned tag, one exact method contract, one state-owned live implementation, and one
// state-owned test layer.

/*
Port Contract Matrix

Every core-owned state port consumed across packages must have an exact method table. Each public
state-backed port method has a method contract block:

- Method.
- Owning caller.
- Input schema.
- Output schema.
- Error channel.
- Transaction: `read-only`, `opens-own-write-transaction`, `requires-active-TransactionPort`,
  `joins-active-or-opens-outermost`, or `two-phase-file-and-SQL`, plus required owner, lease, and
  idempotency checks.
- After-commit invalidations: exact `StateInvalidationDescriptor` variants emitted on success,
  empty list only when no observer can change, and no success invalidations on failure or duplicate
  idempotent replay.
- Non-goals.
- Required tests.

The method names in this matrix are an inventory, not sufficient contracts. A port is public only
when every method has a schema-backed input type, schema-backed output type when it crosses a
boundary, exact Effect error channel, transaction isolation/locking rule, after-commit invalidation
behavior, and focused tests. Package-boundary tests reject adding a method to any state port without
the corresponding contract block.

The public contract is the core-owned service shape exported from `@svvy/core` state-port
modules. This matrix uses the exact exported method names from that core-owned service shape. All
public state-backed write port methods return mutation result wrappers that include committed
domain output plus `afterCommit`. Read-only methods return domain read results without
`afterCommit`.

```ts
type StateMutationResult<T> = {
  value: T;
  afterCommit: readonly StateInvalidationDescriptor[];
};
```

RuntimeWorkspaceStatePort:

- Caller: @svvy/runtime workspace acquisition and release.
- Methods: resolvePromptTargetWorkspaceId, acquireWorkspace, acquireDefaultWorkspace,
  releaseWorkspace.
- Rule: workspace acquisition and release methods commit durable workspace/session ownership facts
  and return `StateMutationResult` wrappers with session navigation invalidations only after
  commit. They do not acquire live workspace runtime scopes, start source watchers, create
  `ManagedRuntime` values, or publish runtime events.

The exact workspace state port is:

```ts
type RuntimeWorkspaceStatePort = {
  resolvePromptTargetWorkspaceId(input: {
    target: PromptTarget;
  }): Effect.Effect<WorkspaceId, StateContractError>;

  acquireWorkspace(
    input: AcquireWorkspaceInput,
  ): Effect.Effect<StateMutationResult<AcquireWorkspaceResult>, StateContractError>;

  acquireDefaultWorkspace(
    input: AcquireDefaultWorkspaceInput,
  ): Effect.Effect<StateMutationResult<AcquireWorkspaceResult>, StateContractError>;

  releaseWorkspace(
    input: ReleaseWorkspaceInput,
  ): Effect.Effect<StateMutationResult<ReleaseWorkspaceResult>, StateContractError>;
};
```

RuntimeQueueStatePort:

- Caller: `@svvy/runtime` queue dispatcher and runtime-owned queue insertion paths only.
- Methods: acceptSubmittedSurfaceMessage, acceptEditedCommittedSurfaceMessage,
  enqueueSurfaceMessage, getSurfaceQueuedMessage,
  claimNextQueuedSurfaceMessage, releaseExpiredSurfaceMessageClaims, markSurfaceMessageSteering,
  markSurfaceMessageQueued, markSurfaceMessageDelivered, markSurfaceMessageFailed,
  cancelSurfaceMessage, reorderSurfaceMessage.
- Rule: queue mutations are transactional; write methods return `StateMutationResult<T>` with
  committed `afterCommit` descriptors after the state commit succeeds. The port never publishes
  runtime events, wakes queue lanes, starts turns, schedules retries, or performs post-commit work;
  runtime collects descriptors after commit, publishes typed notifications, and wakes the affected
  committed queue lanes.
- Rule: ordinary runtime composer send acceptance uses
  `acceptSubmittedSurfaceMessage(...)`, which inserts the `user_message` queue row and clears the
  submitted durable composer draft and, for non-empty submitted text, appends the exact workspace
  prompt-history row inside one state transaction. Duplicate client-submission idempotency-key
  replay returns the existing queue row with `afterCommit: []`, appends no history row, and must not
  clear the user's current draft, including after the original queue row becomes terminal.
  `enqueueSurfaceMessage(...)` remains the lower-level queue insert for runtime-owned non-composer
  work such as request-input answer deliveries, workflow task starts, report requests, and other
  surface-control queue items.
- Rule: committed-message edit acceptance uses
  `acceptEditedCommittedSurfaceMessage(...)`. The transaction first returns an existing row for an
  edit-specific idempotency key, then rejects any other nonterminal row on the surface, validates
  workspace/target ownership and the exact source message id, committed timestamp, and pi history
  reference, rejects an active assistant, deletes the source and later transcript rows, inserts the
  interactive replacement row carrying the durable edit intent, clears the durable draft, and
  appends prompt history. Any failed check or insert rolls the entire mutation back.

RuntimeSurfaceLifecycleStatePort:

- Caller: @svvy/runtime surface creation, open, and close flows.
- Methods: createOrchestratorSurface, openSurface, closeSurface, readOrchestratorLifecycle,
  renameOrchestrator, forkOrchestrator, deleteOrchestrator.
- Rule: this port records durable lifecycle facts only: surface/session creation,
  open-owner/reference state, close-owner/reference state, lifecycle timestamps, and after-commit
  read-model invalidation descriptors. It does not acquire, retain, or dispose live pi sessions,
  prompt locks, workspace runtime scopes, event subscriptions, watchers, queues, command fibers, or
  generated-context workers.

The exact surface lifecycle state port is:

```ts
type RuntimeSurfaceLifecycleStatePort = {
  createOrchestratorSurface(
    input: CreateOrchestratorSurfaceInput,
  ): Effect.Effect<StateMutationResult<CreateSurfaceResult>, StateContractError>;

  openSurface(
    input: OpenSurfaceInput,
  ): Effect.Effect<StateMutationResult<OpenSurfaceResult>, StateContractError>;

  closeSurface(
    input: CloseSurfaceInput,
  ): Effect.Effect<StateMutationResult<CloseSurfaceResult>, StateContractError>;
  readOrchestratorLifecycle(input: {
    workspaceId: WorkspaceId;
    workspaceSessionId: WorkspaceSessionId;
  }): Effect.Effect<OrchestratorLifecycleRecord, StateContractError>;
  renameOrchestrator(input: RenameOrchestratorInput): Effect.Effect<
    StateMutationResult<RenameOrchestratorSurfaceResult>,
    StateContractError
  >;
  forkOrchestrator(input: ForkOrchestratorInput): Effect.Effect<
    StateMutationResult<CreateSurfaceResult>,
    StateContractError
  >;
  deleteOrchestrator(input: DeleteOrchestratorInput): Effect.Effect<
    StateMutationResult<DeleteOrchestratorSurfaceResult>,
    StateContractError
  >;
};
```

There is no public broad `RuntimeSurfaceStatePort`. Surface message queuing is owned by
`RuntimeQueueStatePort`; handler-thread surface creation is owned by `RuntimeThreadStatePort`;
extension binding state is owned by `RuntimeActorExtensionBindingStatePort`; runtime-owned read
baselines use `RuntimeReadModelStatePort`.

The only allowed surface-lifecycle state port is the narrow core-owned
`RuntimeSurfaceLifecycleStatePort` with lifecycle-only methods:
`createOrchestratorSurface(...)`, `openSurface(...)`, and `closeSurface(...)`. It must not expose
queue rows, transcript rows, command rows, request-input rows, extension binding rows, generated
context rows, or generic surface mutation helpers. Do not add a broad surface port that recombines
those responsibilities.

`RuntimeSurfaceLifecycleStatePort` records durable product facts only: surface/session creation,
open-owner/reference state, close-owner/reference state, lifecycle timestamps, and after-commit
read-model invalidation descriptors. It does not acquire, retain, or dispose live pi sessions,
surface prompt locks, workspace runtime scopes, event subscriptions, watchers, queues, or command
fibers. Those live resources are runtime-owned scoped services under `Runtime.layer`,
`WorkspaceRuntime.layer(workspaceId)`, and `SurfaceRuntime.layer(surfacePiSessionId)`. The state port
may validate stored pi/session references through core-owned reference facts, but it must not return
live handles.

RuntimeWorkflowTaskStatePort:

- Caller: @svvy/runtime workflow task-agent `runTaskAgent` bridge admission.
- Methods: acceptWorkflowTaskAgentStart, getWorkflowTaskAgentAttemptTerminal,
  settleWorkflowTaskAgentAttempt.
- Rule: this port validates source command/session lineage, records or reuses the durable workflow
  task-attempt surface keyed by `WorkflowTaskAttemptId`, writes the idempotent
  `workflow_task_agent_start` queue row, and returns committed invalidation descriptors. It does not
  authenticate bridge bearer tokens, acquire live pi sessions, run prompts, publish runtime events,
  refresh generated context, or inspect generated packages.

The exact workflow task-agent state port is:

```ts
type RuntimeWorkflowTaskStatePort = {
  acceptWorkflowTaskAgentStart(
    input: AcceptRuntimeWorkflowTaskAgentStartInput,
  ): Effect.Effect<
    StateMutationResult<RuntimeWorkflowTaskAgentStartReceipt>,
    StateContractError
  >;
  getWorkflowTaskAgentAttemptTerminal(input: {
    workspaceSessionId: WorkspaceSessionId;
    idempotencyKey: string;
  }): Effect.Effect<RuntimeWorkflowTaskAgentTerminalReceipt | null, StateContractError>;
  settleWorkflowTaskAgentAttempt(
    input: SettleRuntimeWorkflowTaskAgentAttemptInput,
  ): Effect.Effect<
    StateMutationResult<RuntimeWorkflowTaskAgentTerminalReceipt>,
    StateContractError
  >;
};
```

RuntimePromptDefaultsStatePort:

- Caller: @svvy/runtime prompt submission through `RuntimePromptDefaultsService`.
- Methods: resolvePromptDefaults, updatePromptDefaults.
- Rule: prompt default resolution reads durable surface/profile/model state and returns the
  provider, model, and reasoning effort that runtime must use for prompt admission. It does not
  return prompt text, generated-context read-model payloads, extension instruction bodies, pi-native model
  objects, or UI snapshots. File-backed prompt and instruction content remains owned by
  `@svvy/extensions`; live pi session handles remain owned by `@svvy/pi-adapter`.

`RuntimePromptDefaultsStatePort` is only the DB/product-state-backed defaults source for
`RuntimePromptDefaultsService`. It must not absorb extension-owned prompt files, generated-context
rendering, extension binding materialization, or prompt-preview construction. Runtime composes this
state result with `@svvy/extensions` services when prompt dispatch needs prompt binding,
generated-context fingerprint/revision, or extension binding facts.

The exact prompt defaults state port is:

```ts
type RuntimePromptDefaultsStatePort = {
  resolvePromptDefaults(
    input: ResolveRuntimePromptDefaultsInput,
  ): Effect.Effect<RuntimePromptDefaultsRecord, StateContractError>;
  updatePromptDefaults(
    input: UpdateRuntimePromptDefaultsInput,
  ): Effect.Effect<StateMutationResult<RuntimePromptDefaultsRecord>, StateContractError>;
};
```

RuntimeComposerProfileStatePort:

- Caller: `@svvy/runtime` surface model, reasoning, and extension composer controls.
- Methods: readSurfaceProfileId, updateFromComposer.
- Rule: surface profile identity is resolved from the exact workspace target, while Follow composer
  writes are routed to app-global agent-profile authority. Workspace-local profile rows are never
  used as app-global write authority.

```ts
type RuntimeComposerProfileStatePort = {
  readSurfaceProfileId(input: {
    target: PromptTarget;
  }): Effect.Effect<AgentProfileId | null, StateContractError>;
  updateFromComposer(
    input: RuntimeComposerProfileUpdateInput,
  ): Effect.Effect<StateMutationResult<boolean>, StateContractError>;
};
```

RuntimeComposerDraftStatePort:

- Caller: `@svvy/runtime` composer persistence and accepted-submit cleanup paths.
- Methods: setDraft, clearSubmittedDraft.
- Rule: `setDraft(...)` persists the exact target-scoped composer text, attachments, and snippet
  mentions and returns committed composer/surface read-model invalidations. Renderer and headless
  consumers reach this operation only through the runtime facade.
- Rule: `clearSubmittedDraft(...)` is a narrow committed-draft cleanup method keyed by the submitted
  `RuntimeSurfaceTarget` and the accepted `QueueItemId`. It returns
  `StateMutationResult<void>` and emits only composer/surface read-model invalidations. It must not
  enqueue messages, mutate transcript rows, start turns, or expose generic composer mutation.

The exact composer draft state port is:

```ts
type RuntimeComposerDraftStatePort = {
  setDraft(
    input: SetRuntimeComposerDraftInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  clearSubmittedDraft(
    input: ClearSubmittedComposerDraftInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
};
```

RuntimeTurnStatePort:

- Caller: `@svvy/runtime` turn execution after a queue row has been durably claimed through
  `RuntimeQueueStatePort`.
- Methods: startTurn, setTurnDecision, finishTurn, recoverInterruptedTurn, settlePromptTurn,
  queueTopLevelTitleGeneration.
- Rule: active-turn writes are serialized by surface and prompt-lock ownership. `startTurn(...)`
  records turn state for the already claimed queue item but does not claim queue rows, choose queue
  ordering, wake lanes, or enqueue follow-up work. Ordinary queue-only transitions remain on
  `RuntimeQueueStatePort`; terminal prompt settlement uses `settlePromptTurn(...)` so the accepted
  queue row cannot be replayed after its turn has already committed terminal state.

The exact turn state port is:

```ts
type RuntimeTurnStatePort = {
  startTurn(
    input: StartRuntimeTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;

  setTurnDecision(
    input: SetRuntimeTurnDecisionInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;

  finishTurn(
    input: FinishRuntimeTurnInput,
  ): Effect.Effect<StateMutationResult<RuntimeTurnRecord>, StateContractError>;

  recoverInterruptedTurn(
    input: RecoverInterruptedRuntimeTurnInput,
  ): Effect.Effect<
    StateMutationResult<RuntimeInterruptedTurnRecoveryResult>,
    StateContractError
  >;

  settlePromptTurn(
    input: SettleRuntimePromptTurnInput,
  ): Effect.Effect<
    StateMutationResult<RuntimePromptTurnSettlementResult>,
    StateContractError
  >;

  queueTopLevelTitleGeneration(input: {
    sessionId: WorkspaceSessionId;
    surfacePiSessionId: SurfacePiSessionId;
  }): Effect.Effect<StateMutationResult<RuntimeTitleGenerationQueueReceipt>, StateContractError>;
};
```

`recoverInterruptedTurn(...)` is one state transaction for an active turn that can no longer have a
live runtime owner. It applies the requested failed/cancelled terminal status to the turn, active
transcript assistant, linked commands, and dispatching queue claim; cancels blocking request-input
and approval rows in the same transaction; and clears only the matching session wait. The result
names every command terminalized anywhere inside that transaction plus every other changed durable
identity so runtime can cancel matching process-local command handles and publish the complete
post-commit invalidation batch. Repeating the same recovery after those facts are terminal is a
no-op.

`settlePromptTurn(...)` is the normal prompt terminalization transaction. It claim-fences and
settles the accepted queue row, records the exact completed/failed/cancelled turn state, and
terminalizes any still-live commands in one commit. A same-facts replay returns `changed: false`
and no invalidations; a mismatched terminal replay or foreign command/queue lineage fails without
partially mutating any row.

RuntimeTranscriptStatePort:

- Caller: `@svvy/runtime` while admitting a claimed prompt and consuming normalized pi message
  lifecycle events.
- Methods: commitUserMessage, beginAssistantMessage, appendAssistantContentDelta,
  upsertAssistantToolCall, linkAssistantToolCallCommand, commitAssistantMessage,
  failAssistantMessage, bindPiHistoryEntry, advanceStreamCursor, readSurfaceTranscript.
- Rule: transcript messages are Svvy-owned durable records ordered by a surface-local ordinal.
  User rows preserve the complete `RuntimeSubmittedMessage`; assistant rows preserve ordered text,
  thinking, and tool-call blocks plus provider/model/API, usage, stop/error, timestamps, command
  linkage, and optional pi history identity. One runtime turn may own multiple assistant messages.
  Surface stream generation and sequence compare-and-swap is committed atomically with each live
  transcript mutation. Per-packet delta/tool/cursor writes return no read-model invalidations;
  user commit, assistant begin, assistant commit, and assistant fail return exactly one surface
  invalidation. Committed-message transcript rebasing is not exposed as a standalone transcript
  mutation; it is part of the atomic queue-state edit acceptance transaction.

The exact transcript state port is:

```ts
type RuntimeTranscriptStatePort = {
  commitUserMessage(input: CommitRuntimeTranscriptUserMessageInput): Effect.Effect<
    StateMutationResult<RuntimeTranscriptUserMutation>,
    StateContractError
  >;
  beginAssistantMessage(input: BeginRuntimeTranscriptAssistantMessageInput): Effect.Effect<
    StateMutationResult<RuntimeTranscriptAssistantMutation>,
    StateContractError
  >;
  appendAssistantContentDelta(
    input: AppendRuntimeTranscriptAssistantContentDeltaInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  upsertAssistantToolCall(
    input: UpsertRuntimeTranscriptAssistantToolCallInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  linkAssistantToolCallCommand(
    input: LinkRuntimeTranscriptAssistantToolCallCommandInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  commitAssistantMessage(
    input: CommitRuntimeTranscriptAssistantMessageInput,
  ): Effect.Effect<StateMutationResult<RuntimeTranscriptAssistantMutation>, StateContractError>;
  failAssistantMessage(input: FailRuntimeTranscriptAssistantMessageInput): Effect.Effect<
    StateMutationResult<RuntimeTranscriptAssistantMutation>,
    StateContractError
  >;
  bindPiHistoryEntry(input: BindRuntimeTranscriptPiHistoryEntryInput): Effect.Effect<
    StateMutationResult<RuntimeTranscriptMessage>,
    StateContractError
  >;
  advanceStreamCursor(input: AdvanceRuntimeTranscriptStreamCursorInput): Effect.Effect<
    StateMutationResult<RuntimeTranscriptStreamCursor>,
    StateContractError
  >;
  readSurfaceTranscript(
    input: ReadRuntimeSurfaceTranscriptInput,
  ): Effect.Effect<RuntimeSurfaceTranscriptSnapshot, StateContractError>;
};
```

RuntimeCommandStatePort:

- Caller: @svvy/runtime command tracking.
- Methods: createCommand, createOrReuseStreamingCommand, findCommandByToolCallId,
  findCommandById, updateCommandArguments, startCommand, finishCommand, recordCommandEvent,
  recordStdinWrite, hasCommandOutputEvent.
- Rule: command rows and command-scoped lifecycle events are durable product state. The command
  port is not an inspector/read-model API and never exposes a full session snapshot. The only
  command-event read it exposes is `hasCommandOutputEvent(...)`, used by runtime command tracking to
  avoid duplicating final stdout/stderr when live command output has already been recorded.
  `recordCommandEvent(...)` accepts only the closed runtime-owned durable state event kinds that
  append command detail facts after command creation: `command.arg_snapshot`,
  `command.diagnostics`, `command.output`, `command.patch_snapshot`, and `command.progress`. These
  durable row kinds are storage command-event kinds; runtime notification and projection change
  kinds still use the shorter public change vocabulary such as `argument_snapshot`, `diagnostic`,
  `output`, `patch_snapshot`, and `progress`.
  Accepted stdin writes are not appended through
  `recordCommandEvent(...)`; runtime uses `recordStdinWrite(...)` only after live command-session
  admission returns `accepted`. That method records one `command.stdin` event with exact `text` and
  `acceptedBytes`, returns `StateMutationResult<void>`, and emits the complete command-owner
  invalidation set defined below. It does not compute public `writeStdin` statuses, manage stdin
  queues, deduplicate client submissions, or own process handles. Command lifecycle events such as
  `command.requested` and `command.started` are produced by `createCommand(...)` and
  `startCommand(...)`, not through a generic string event append surface.
  `createCommand(...)` accepts only initial command statuses: `requested` for command rows that
  still need a `startCommand(...)` transition, or `streaming` for already-live streamed tool-call
  rows. `finishCommand(...)` accepts only terminal or waiting states: `waiting`, `succeeded`,
  `failed`, or `cancelled`. It never accepts `requested`, `running`, or `streaming`.
  `recordCommandEvent(...)` persists the core `CommandOutputEventPayload` shape for
  `command.output`: `stream`, optional `source`, optional `text`, optional `chunkRef`, and optional
  `truncated`. State does not reinterpret that payload as raw bytes, base64 bytes, byte counts, or a
  sequenced output-chunk record. Runtime-owned command output callers use the closed source
  vocabulary `live-stream`, `final-result`, `execute_typescript`, and `retained-log-artifact`.
  `hasCommandOutputEvent(...)` accepts only that closed vocabulary for source filters; it is a query
  contract for runtime-owned command output sources, not a second persisted event-payload schema.
  Every committed command row or command-event mutation invalidates the command inspector, owning
  surface, and session navigation read models. When the command belongs to a delegated handler or a
  workflow task-agent attempt, the same mutation also invalidates the corresponding
  `handlerThreadInspector` and `workflowTaskAttemptInspector` read models. Event and accepted-stdin
  writers resolve the durable command after the event append so this complete owner-dependent
  descriptor set comes from committed state rather than caller-supplied linkage.

RuntimeApprovalStatePort:

- Caller: @svvy/runtime approval request creation, answer recording, wait recovery, cancellation,
  and terminal command linkage.
- Methods: createApprovalRequest, getApprovalRequest, listOpenApprovalRequests,
  resolveApprovalRequest.
- Rule: approval rows are durable `@svvy/state` facts created for runtime-owned approval policy.
  Runtime owns policy and process-local waiter wakeups. For user review, state creates the pending
  approval, transitions its active linked command to `waiting`, and records the matching approval
  wait in one transaction. State resolves every approval, transitions its linked command, and clears
  only the matching approval wait in one transaction, then returns the complete post-commit
  invalidation batch.

Approval port contract:

```ts
type RuntimeApprovalToolName = "apply_patch" | "exec_command" | "execute_typescript";
type RuntimeApprovalMode = "auto-review" | "user";
type RuntimeApprovalStatus = "pending" | "approved" | "denied" | "cancelled";
type RuntimeApprovalResolvedStatus = "approved" | "denied" | "cancelled";
type RuntimeApprovalReviewer = "auto-review" | "user";

type RuntimeApprovalRecord = {
  requestId: RuntimeApprovalId;
  sessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: ThreadId | null;
  turnId: TurnId | null;
  commandId: CommandId | null;
  toolCallId: ToolItemId;
  toolName: RuntimeApprovalToolName;
  approvalMode: RuntimeApprovalMode;
  cwd: AbsolutePath;
  command: string | null;
  commandFamily: string | null;
  patch: string | null;
  snippetArtifactId: ArtifactId | null;
  typescriptCode: string | null;
  context: {
    reason: "sandbox_denial_escalation";
    sandboxDenied: true;
  } | null;
  status: RuntimeApprovalStatus;
  decisionReason: string | null;
  reviewer: RuntimeApprovalReviewer | null;
  createdAt: IsoDateTimeString;
  completedAt: IsoDateTimeString | null;
};

type CreateRuntimeApprovalRequestInput = {
  sessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId?: ThreadId | null;
  turnId?: TurnId | null;
  commandId?: CommandId | null;
  toolCallId: ToolItemId;
  toolName: RuntimeApprovalToolName;
  approvalMode: RuntimeApprovalMode;
  cwd: AbsolutePath;
  command?: string | null;
  commandFamily?: string | null;
  patch?: string | null;
  snippetArtifactId?: ArtifactId | null;
  typescriptCode?: string | null;
  context?: {
    reason: "sandbox_denial_escalation";
    sandboxDenied: true;
  } | null;
};

type GetRuntimeApprovalRequestInput = {
  requestId: RuntimeApprovalId;
};

type ListOpenRuntimeApprovalRequestsInput = {
  surfacePiSessionId?: SurfacePiSessionId;
};

type ResolveRuntimeApprovalRequestInput = {
  requestId: RuntimeApprovalId;
  status: RuntimeApprovalResolvedStatus;
  reviewer: RuntimeApprovalReviewer;
  decisionReason?: string | null;
};

type RuntimeApprovalStatePort = {
  createApprovalRequest(
    input: CreateRuntimeApprovalRequestInput,
  ): Effect.Effect<StateMutationResult<RuntimeApprovalRecord>, StateContractError>;
  getApprovalRequest(
    input: GetRuntimeApprovalRequestInput,
  ): Effect.Effect<RuntimeApprovalRecord, StateContractError>;
  listOpenApprovalRequests(
    input?: ListOpenRuntimeApprovalRequestsInput,
  ): Effect.Effect<readonly RuntimeApprovalRecord[], StateContractError>;
  resolveApprovalRequest(
    input: ResolveRuntimeApprovalRequestInput,
  ): Effect.Effect<StateMutationResult<RuntimeApprovalRecord>, StateContractError>;
};
```

`createApprovalRequest(...)` validates exact session/surface/thread/turn/command lineage and rejects
terminal linked commands. It inserts a pending row and returns
`StateMutationResult<RuntimeApprovalRecord>`. A `user` approval requires an active linked command;
the same transaction moves that command to `waiting` and records its session approval wait.
`resolveApprovalRequest(...)` is a compare-and-set transition from `pending` to one terminal status.
In the same transaction it starts the linked command for approval, cancels it for
denial/cancellation, and clears the matching approval wait when no other pending approval owns that
session/thread wait. Resolving an already terminal row with the same terminal facts is idempotent
and returns `afterCommit: []`. A conflicting terminal answer fails with
`StateContractError.reason: "conflict"`. Successful create/resolve writes emit runtime-approval,
command, and affected surface/session invalidations; read-only get/list methods return no
invalidation descriptors.

RuntimeActorExtensionBindingStatePort:

- Caller: @svvy/runtime actor extension binding updates and prompt-dispatch binding reads.
- Methods: readRuntimePromptBinding, readGeneratedContextBuildSubject, bindGeneratedContext,
  updateActorExtensionBinding, setActorExtensionBinding.
- Rule: `readRuntimePromptBinding(...)` is the read-only runtime prompt binding lookup for a
  prompt target. It first validates target ownership, then reads the exact DB/product-state-backed
  generated-context binding row addressed by the target's currently bound generated-context
  fingerprint. It returns only binding id, fingerprint, revision, bound loaded/available extension
  ids, external source hashes, and the target's update-before-next-turn intent. It must not return
  provider/model/reasoning defaults, system-prompt bodies, `svvyxGuidance`, command declarations,
  native tool schema JSON, generated-context preview data, extension instruction bodies, or
  pi-native objects. Runtime resolves prompt/declaration material from `@svvy/extensions`, the
  generated-context owner, before dispatch. Orchestrator binding mutations update DB-backed session
  extension ids; handler binding mutations update DB-backed thread extension ids.
  `readGeneratedContextBuildSubject(...)` validates the target and returns the state-owned actor,
  profile, model/reasoning, extension usage/order, and external-instruction inputs required for a
  fresh package-owned generated-context build without returning generated prompt bodies.
  `bindGeneratedContext(...)` commits the exact generated-context build identity and bound
  loaded/available extension ids for the target after Runtime has completed that build; replaying
  the same binding is an idempotent no-op with no invalidation descriptors.
  `updateActorExtensionBinding(...)` applies one loaded/available/off usage transition and requires
  `usage: "loaded"` to refer to an extension that is currently available or already loaded for that
  actor. `setActorExtensionBinding(...)` replaces the complete loaded/available extension id lists
  for a runtime-owned binding refresh after the caller has validated the list. Workflow-task binding
  mutation is not part of this port; workflow task-agent extension defaults are resolved from
  task-agent/profile context before the attempt starts.

The exact actor extension binding state port is:

```ts
type RuntimeActorExtensionBindingStatePort = {
  readRuntimePromptBinding(
    input: ReadRuntimePromptBindingInput,
  ): Effect.Effect<RuntimePromptBindingRecord, StateContractError>;

  readGeneratedContextBuildSubject(input: {
    readonly target: RuntimeSurfaceTarget;
  }): Effect.Effect<RuntimeGeneratedContextBuildSubjectRecord, StateContractError>;

  bindGeneratedContext(
    input: BindRuntimeGeneratedContextInput,
  ): Effect.Effect<StateMutationResult<RuntimePromptBindingRecord>, StateContractError>;

  updateActorExtensionBinding(
    input: UpdateActorExtensionBindingRequest,
  ): Effect.Effect<StateMutationResult<RuntimeActorExtensionBindingRecord>, StateContractError>;

  setActorExtensionBinding(
    input: SetRuntimeActorExtensionBindingInput,
  ): Effect.Effect<StateMutationResult<RuntimeActorExtensionBindingRecord>, StateContractError>;
};
```

RuntimeEpisodeStatePort:

- Caller: @svvy/runtime accepted episode-producing tools and runtime flows.
- Methods: recordHandlerThreadEpisode.
- Rule: handler-thread episode writes validate `workspaceSessionId`, `threadId`, and
  `threadGroupId`, plus any related command, artifact, and workflow-run ids, before creating the
  durable episode row. Outcome-bearing requests conclude the handler thread through the same state
  boundary. Non-thread episode scopes are outside the
  `RuntimeEpisodeStatePort` contract; adding one requires a product spec that first defines its
  state rows, read models, ownership checks, and runtime applier.
- Transaction rule: `recordHandlerThreadEpisode(...)` delegates to one package-private
  `StructuredSessionState.recordHandlerThreadEpisode(...)` SQLite transaction method. The state
  port adapter must not compose `getSessionState(...)`, `createEpisode(...)`, and
  `updateThread(...)` calls. The transaction owns validation, episode insertion, optional
  handler-thread conclusion, event rows, and the committed records used for descriptor derivation.
- Mutation result rule: `recordHandlerThreadEpisode(...)` returns
  `StateMutationResult<RuntimeEpisodeRecord>` with `surface(surfacePiSessionId)`,
  `handlerThreadInspector(threadId)`, and `sessionNavigation` descriptors. Surface invalidation is
  for transcript/sidebar projection; `handlerThreadInspector(threadId)` is explicit because the
  inspector read model contains episode summaries and conclusion state and must not depend on broad
  surface read-model fanout.

The exact episode contract is:

```ts
type RuntimeEpisodeKind = "change" | "clarification" | "report" | "handoff" | "conclusion";

type RuntimeEpisodeOutcome = "completed" | "failed" | "blocked" | "cancelled";

type RecordRuntimeHandlerThreadEpisodeInput = {
  scope: "handler-thread";
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  sourceCommandId?: CommandId;
  kind: RuntimeEpisodeKind;
  summary: string;
  body?: string;
  outcome?: RuntimeEpisodeOutcome;
  notifyOrchestrator?: boolean;
  relatedCommandIds?: readonly CommandId[];
  relatedArtifactIds?: readonly ArtifactId[];
  relatedWorkflowRunIds?: readonly WorkflowRunId[];
};

type RuntimeEpisodeRecord = {
  id: EpisodeId;
  sessionId: WorkspaceSessionId;
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  sourceCommandId: CommandId | null;
  kind: RuntimeEpisodeKind;
  title: string;
  summary: string;
  body: string;
  createdAt: IsoDateTimeString;
};

type RuntimeEpisodeStatePort = {
  recordHandlerThreadEpisode(
    input: RecordRuntimeHandlerThreadEpisodeInput,
  ): Effect.Effect<StateMutationResult<RuntimeEpisodeRecord>, StateContractError>;
};
```

`summary` on runtime episode records is a durable user-facing episode fact authored by runtime from
completed handler/workflow evidence. It is not a cache, preview, best-effort compression of hidden
transcript state, or duplicate request payload. Longer inspection content belongs in `body` and
linked artifacts; read models may derive display snippets from these stored episode facts.

RuntimeThreadStatePort:

- Caller: @svvy/runtime handler/workflow thread lifecycle.
- Methods: startHandlerThreads, ensureHandlerThreadRunnable.
- Rule: `startHandlerThreads(...)` is the only state port method that commits the state-owned rows
  for a `handler_thread.start` effect. It accepts only runtime-prepared facts: workspace/session
  ownership, the orchestrator turn id, source command id, optional per-thread parent handler thread
  id, optional thread group id, handler pi surface ids already allocated by runtime/pi-adapter,
  display titles, objectives, history mode, worktree id, resolved loaded/available extension ids,
  optional serialized agent profile facts, exact generated actor context binding text/fingerprint,
  and exact runtime-created initial queue payloads. State does not allocate pi sessions, build
  generated context, choose profiles, validate extension availability, derive forked history,
  publish runtime events, wake queues, create desktop panes, or execute handler turns.
- `startHandlerThreads(...)` commits one transaction containing one or more handler-thread rows, one
  generated-context binding row per created thread, and one `initial_handler_start` queue row per
  created thread. It validates that `orchestratorTurnId` belongs to `workspaceSessionId`. It stores
  `sourceCommandId` on each initial queue row so command lineage is durable. When a prepared thread
  carries `parentThreadId`, state validates that the parent thread belongs to the same
  `workspaceSessionId` before inheriting lineage or committing the child row. If the same
  `sourceCommandId` is replayed after a successful commit, it returns the already-created thread,
  binding, and queue records rather than creating duplicates; a replay with a different thread count
  is a state contract conflict.
- The exact core-owned contract is:

```ts
interface StartRuntimeHandlerThreadsInput {
  workspaceSessionId: WorkspaceSessionId;
  orchestratorTurnId: TurnId;
  sourceCommandId: CommandId;
  threadGroupId?: ThreadGroupId | null;
  threads: readonly [StartRuntimeHandlerThreadInput, ...StartRuntimeHandlerThreadInput[]];
}

interface StartRuntimeHandlerThreadInput {
  parentThreadId?: ThreadId | null;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  historyMode: "isolated" | "forked";
  worktreeId?: WorktreeId | null;
  agentProfileJson?: string | null;
  generatedAgentContextBinding: RuntimeHandlerThreadGeneratedContextBindingInput;
  initialQueue: RuntimeHandlerThreadInitialQueueInput;
}

interface RuntimeHandlerThreadGeneratedContextBindingInput {
  aggregateCacheKey: string;
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  externalSourceHashes: readonly string[];
}

interface RuntimeHandlerThreadInitialQueueInput {
  idempotencyKey: string;
  priority?: "interactive" | "runtime" | "background";
  nextAttemptAt?: string | null;
  maxAttempts?: number;
  inheritedHistory?: HandlerInheritedHistoryBlock;
  overrides?: Readonly<Record<ExtensionId, "loaded" | "available" | "unavailable">>;
}

interface StartRuntimeHandlerThreadsResult {
  threadGroupId: ThreadGroupId;
  threads: readonly StartedRuntimeHandlerThread[];
}

type RuntimeThreadStatePort = {
  startHandlerThreads(
    input: StartRuntimeHandlerThreadsInput,
  ): Effect.Effect<StateMutationResult<StartRuntimeHandlerThreadsResult>, StateContractError>;

  ensureHandlerThreadRunnable(
    input: EnsureRuntimeHandlerThreadRunnableInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
};

interface StartedRuntimeHandlerThread {
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  parentThreadId: ThreadId | null;
  title: string;
  objective: string;
  historyMode: "isolated" | "forked";
  objectiveState: "active";
  status: "running-handler";
  wait: null;
  worktreeId: WorktreeId | null;
  generatedAgentContextFingerprint: string;
  generatedAgentContextBindingId: string;
  queuedMessageId: QueueItemId;
}
```

Generated context binding inputs and handler-thread start receipts are reference/fact contracts only.
They carry the aggregate cache key, generated-context fingerprint/revision, external source hashes,
created ids, and queued row id needed for idempotency and post-commit scheduling. They do not carry
system-prompt bodies, generated `svvyx` guidance, TypeScript declaration text, native tool schema
JSON, loaded/available extension id projections, or a full queue-row preview. Runtime resolves
prompt/declaration material from the generated-context owner before dispatch, and callers use state
read models or generated-context/actor-binding read models for projection details.

`RuntimeHandlerThreadInitialQueueInput` carries queue policy plus id-free runtime-prepared start
metadata only. It never accepts caller-supplied `messageJson`, `payloadJson`, `threadId`, or concrete
new `threadGroupId`, because those facts are not all known until the state transaction creates the
handler thread row. Inside the same `startHandlerThreads(...)` transaction, after `threadId` and the
resolved `threadGroupId` exist, state writes `messageJson` as `{}` and writes one canonical
`initial_handler_start` `payloadJson` with:

- `kind: "initial_handler_start"`
- allocated `threadId`
- resolved `threadGroupId`
- committed `objective`
- optional committed `worktreeId`
- optional runtime-prepared `inheritedHistory`
- optional runtime-prepared per-thread `overrides`

Runtime creates the handler's first prompt-bearing start item, including objective text and any
product-filtered inherited-history block, after decoding the accepted `handler_thread.start` effect
and before calling this state port. Extension handlers provide creation intent only; they do not
author handler transcript messages, serialize forked history, allocate queue ids, or create
`thread_start` / `initial_handler_start` queue rows. State owns only the id-dependent final queue JSON
materialization inside this atomic handler-start commit; it does not infer inherited-history content
or extension override intent from transcripts or product settings.

- `ensureHandlerThreadRunnable(...)` is the narrow existing-handler transition used before a handler
  surface resumes execution. It validates `workspaceSessionId`, `surfacePiSessionId`, and `threadId`,
  then clears any wait and sets the handler status to `running-handler`. Display text is derived by
  read models. Durable handler-thread episode writes go through
  `RuntimeEpisodeStatePort.recordHandlerThreadEpisode(...)`; `RuntimeThreadStatePort` does not append
  episode rows.
- Mutation result rule: `startHandlerThreads(...)` returns
  `StateMutationResult<StartRuntimeHandlerThreadsResult>` with `sessionNavigation`,
  `commandInspector(sourceCommandId)`, and for each started or replayed handler thread,
  `surface(surfacePiSessionId)` plus `handlerThreadInspector(threadId)` descriptors.
  Idempotent replay returns the same `value` with `afterCommit: []` because no rows changed.
  `ensureHandlerThreadRunnable(...)` returns `StateMutationResult<void>`; when it commits a wait
  clear or status change it returns `surface(surfacePiSessionId)`,
  `handlerThreadInspector(threadId)`, and `sessionNavigation`; when the thread is already
  `running-handler` with no wait, it returns `afterCommit: []`.
- Runtime prepares, validates, and owns the typed meaning of `agentProfileJson`,
  `nativeToolSchemasJson`, inherited-history content, and extension override intent before this port
  is called. In particular, runtime is the only owner of `thread_start` application and the
  resulting `initial_handler_start` queue item creation. State stores runtime-supplied JSON strings
  for agent profile and native tool declarations exactly as committed facts, and state materializes
  only the id-dependent `initial_handler_start` queue JSON after allocating the handler thread row.
  State may reject invalid JSON as a contract error, but it does not derive prompt policy,
  inherited-history content, extension override intent, native tool declarations, or generated
  context from those JSON strings.

RuntimeExtensionStatePort:

- Caller: @svvy/runtime extension registry observation plus dependency command and approval completion.
- Methods: readBuildAttemptByClientRequestId, reconcileRegistryObservation, reconcileBuildEvidence, startBuildAttempt,
  recordBuildSuccess, recordBuildFailure, recordDependencyApproval, recordDependencyReadiness,
  reconcileDependencyReadiness.
- Rule: this port atomically persists the package-owned extension registry observation and its env
  declarations, records committed app-global extension dependency approval facts after a
  runtime-owned approval answer is accepted, and records app-global extension dependency readiness
  facts after runtime-owned dependency probe work finishes and `@svvy/extensions` has returned
  immutable readiness evidence. `recordDependencyApproval(...)` returns `StateMutationResult<void>`
  because callers can refetch the state-backed approval/readiness models and must not rely on
  mutation-return previews. `reconcileDependencyReadiness(...)` accepts only one complete canonical
  batch for the exact current registry aggregate and exact per-requirement fingerprints, prunes
  removed facts, and returns `changed: false` without a write or invalidation when the canonical
  batch is unchanged. Changed batches bump revision once and emit exactly the app-level `extensions`
  read-model invalidation descriptor. This port does not launch dependency install/update commands,
  inspect CLIs, read source fingerprints, generate packages, or mutate extension source.

The exact extension dependency state port is:

```ts
type RuntimeExtensionStatePort = {
  readBuildAttemptByClientRequestId(
    clientRequestId: RuntimeClientRequestId,
  ): Effect.Effect<ExtensionBuildAttemptRecord | null, StateContractError>;
  reconcileRegistryObservation(
    input: ReconcileExtensionRegistryObservationInput,
  ): Effect.Effect<StateMutationResult<ExtensionRegistryStateRecord>, StateContractError>;
  reconcileBuildEvidence(
    input: ReconcileExtensionSourceBuildEvidenceInput,
  ): Effect.Effect<
    StateMutationResult<ReconcileExtensionSourceBuildEvidenceResult>,
    StateContractError
  >;
  startBuildAttempt(
    input: StartExtensionBuildAttemptInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordBuildSuccess(
    input: RecordExtensionBuildSuccessInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordBuildFailure(
    input: RecordExtensionBuildFailureInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordDependencyApproval(
    input: RecordExtensionDependencyApprovalInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  recordDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): Effect.Effect<StateMutationResult<ExtensionDependencyReadiness>, StateContractError>;
  reconcileDependencyReadiness(
    input: ReconcileExtensionDependencyReadinessInput,
  ): Effect.Effect<
    StateMutationResult<ReconcileExtensionDependencyReadinessResult>,
    StateContractError
  >;
};
```

`reconcileBuildEvidence(...)` accepts one canonical extension-id-sorted app-global batch for the
exact persisted registry aggregate. Its required/not-required rows must exactly match registry
declarations, every materialized row's source fingerprint must match the same registry observation,
and removed extension ids are pruned in the same transaction. An identical batch preserves its
original timestamps, performs no write, does not bump revision, and returns `afterCommit: []`.
Changed rows bump revision once and return one app `extensions` descriptor narrowed to the sorted
changed extension ids.

State stores one current source/build evidence row per extension and no build artifact history. It
also stores compact build-attempt orchestration receipts with unique required client-request identity,
registry/source identity, status,
timestamps, a closed failure reason or successful build id, and no stdout, stderr, message, source
content, or artifact paths. `startBuildAttempt(...)` accepts only the exact current required,
materialized registry/source identity. `recordBuildSuccess(...)` atomically marks the running
attempt successful and promotes the matching existing evidence row to current;
`recordBuildFailure(...)` marks only the receipt and preserves current evidence. Terminal time must
not precede start time. Exact replays return the existing receipt with no write or invalidation;
conflicting terminal outcomes fail. Each committed transition bumps revision once and returns one
app `extensions` descriptor narrowed to the extension id. A read-only observation may mark current
evidence missing, stale, or invalid; it never fabricates a build attempt. If current files later
become unusable, prior build ids remain diagnostic evidence only and are never treated as
activatable artifacts.

Client request identity is durable across reopen. Reusing a request id for a different extension,
registry aggregate, or source fingerprint is a typed conflict. An identical request returns the same
running or terminal attempt; success/failure terminal inputs must carry the matching request id.

The extensions read model joins registry and build batches only when their registry aggregate
fingerprints match, and joins a required current build only when its source fingerprint matches the
current registry row. Any missing or mismatched join fails closed as build-required. It derives
`contextReady` from current build evidence and derives `runtimeReady` by joining required CLI,
extension env, and dependency facts. Those joined facts remain independently persisted families;
neither `runtimeReady` nor a coarse ready boolean is written into the build evidence row.

RuntimeSourceStatePort:

- Caller: @svvy/runtime source edit and invalidation workers.
- Methods: readSourceVersion, recordSourceSave, recordSourceDelete,
  recordWorkflowAgentSourceSave, recordWorkflowAgentSourceDelete,
  reconcileWorkflowAgentSources, recordSourceScan, reconcileDiscoveredHostSnippets,
  recordObservedSourceDeletion, recordSourceDiagnostic.
- Rule: this port owns three distinct durable source fact families. Editable source facts are keyed
  by `(sourceInvalidationScope, sourceKind, sourceId)` and support compare-and-swap source edits,
  source deletion facts, and recovery after two-phase file/state work. Runtime source-root
  fingerprint facts are keyed by the source-root path supplied by runtime's deterministic source
  scan, with committed scope/domain metadata, and store the current deterministic aggregate
  fingerprint, root diagnostics, observation timestamp, and commit timestamps used by
  `ExtensionStatePort.records.readSourceFingerprint(...)`. Runtime source scan facts record the
  accepted aggregate domain fingerprint, diagnostics, scan timestamp, and commit timestamps for the
  reconciliation work; they are receipts for reconciliation work, not the authoritative current
  source-root fingerprint. `readSourceVersion(...)` is read-only.
  `recordSourceSave(...)` and `recordSourceDelete(...)` are reserved for explicit user-owned
  source-edit operations. `recordSourceScan(...)`, `reconcileDiscoveredHostSnippets(...)`,
  `recordObservedSourceDeletion(...)`, and `recordSourceDiagnostic(...)` are reserved for
  runtime-owned deterministic reconciliation and return
  `StateMutationResult<RuntimeSourceScanFactRecord>`. Every write emits only committed
  source/read-model invalidation descriptors derived from the affected source kind or source
  domain plus the committed scope. Workflow-agent direct saves/deletes and external scans use the
  dedicated atomic methods so `runtime_source_fact`, `workflow_agent_source_index`, and the
  workflows scan receipt cannot diverge. The port does not infer scope from a bound workspace store, read
  or write file contents, watch files, generate extension packages, build generated context, own
  recovery scheduling, publish runtime events, or mutate renderer drafts.

The exact source state port is:

```ts
type RuntimeSourceStatePort = {
  readSourceVersion(
    input: ReadRuntimeSourceVersionInput,
  ): Effect.Effect<RuntimeSourceFactRecord | null, StateContractError>;

  recordSourceSave(
    input: RecordRuntimeSourceSaveInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;

  recordSourceDelete(
    input: RecordRuntimeSourceDeleteInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;

  recordWorkflowAgentSourceSave(
    input: RecordRuntimeWorkflowAgentSourceSaveInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;

  recordWorkflowAgentSourceDelete(
    input: RecordRuntimeWorkflowAgentSourceDeleteInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceFactRecord>, StateContractError>;

  reconcileWorkflowAgentSources(
    input: ReconcileRuntimeWorkflowAgentSourcesInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;

  recordSourceScan(
    input: RecordRuntimeSourceScanInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;

  reconcileDiscoveredHostSnippets(
    input: ReconcileDiscoveredHostSnippetsInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;

  recordObservedSourceDeletion(
    input: RecordObservedRuntimeSourceDeletionInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;

  recordSourceDiagnostic(
    input: RecordRuntimeSourceDiagnosticInput,
  ): Effect.Effect<StateMutationResult<RuntimeSourceScanFactRecord>, StateContractError>;
};
```

The exact source-state inputs are the core-owned schemas below. They are not interchangeable with
runtime source-edit facade inputs:

```ts
type RecordRuntimeSourceSaveInput = {
  scope: SourceInvalidationScope;
  sourceKind: ExtensionSourceKind;
  sourceId: string;
  path: AbsolutePath;
  previousSourceVersion?: string | null;
  sourceVersion: string;
  fingerprint: string;
  diagnostics: SourceDiagnostic[];
  sourceCommandId?: CommandId | null;
  savedAt: IsoDateTimeString;
};

type ReadRuntimeSourceVersionInput = {
  scope: SourceInvalidationScope;
  sourceKind: ExtensionSourceKind;
  sourceId: string;
};

type RecordRuntimeSourceDeleteInput = {
  scope: SourceInvalidationScope;
  sourceKind: ExtensionSourceKind;
  sourceId: string;
  path: AbsolutePath;
  previousSourceVersion: string;
  previousFingerprint: string;
  sourceCommandId?: CommandId | null;
  deletedAt: IsoDateTimeString;
};

type RecordRuntimeSourceScanInput = {
  scope: SourceInvalidationScope;
  domain: SourceDomain;
  sourceFingerprint: string;
  sourceRoots?: {
    sourceRoot: AbsolutePath;
    rootFingerprint: string;
  }[];
  diagnostics: SourceDiagnostic[];
  scannedAt: IsoDateTimeString;
};
```

`SaveExtensionSourceEditInput.expectedSourceVersion` belongs to the runtime source-edit facade and
does not appear on `RecordRuntimeSourceSaveInput`. `RecordRuntimeSourceSaveInput.previousSourceVersion`
is state-port evidence produced after the source owner resolves the file-backed save. The state
port save input owns `scope`, `path`, `sourceVersion`, `fingerprint`, `diagnostics`, and `savedAt`;
callers must not submit renderer draft state, generated-context read-model payloads, source text, or
best-effort summaries. `RecordRuntimeSourceDeleteInput` carries the exact deleted path plus the
previous version/fingerprint needed to create or update a tombstone even when no active source fact
has been recorded yet. Replaying an exact save target or delete tombstone is idempotent recovery;
an existing fact with divergent target evidence is a typed stale-state failure and is never silently
accepted. Tombstone updates preserve prior diagnostics while recording deletion lineage and time.
`RecordRuntimeSourceScanInput.sourceFingerprint` is the aggregate
domain-level scan receipt fingerprint. `RecordRuntimeSourceScanInput.sourceRoots` contains the
source-root fingerprints observed in the same deterministic scan batch. Runtime is responsible for
submitting stable source-root paths; state stores and looks up the exact submitted path. Committing a
scan input upserts the current `runtime_source_root_fingerprint_fact` rows for each listed source
root and updates the `runtime_source_scan_fact` receipt for the reconciliation attempt in the same
state transaction. `runtime_source_scan_fact` rows must not be treated as the current source-root
fingerprint index. `RecordRuntimeSourceScanInput` records only deterministic scan evidence and must
not accept storage/projection fields such as `scopeKey`, `lastObservedPath`, `lastObservationKind`,
`observedAt`, `createdAt`, or `updatedAt`.

RuntimeRequestStatePort:

- Caller: @svvy/runtime app-global settings reads/writes, request-input creation, snapshot reads, open
  blocking wait recovery, answer recording, timer pause commits, timeout defaulting, cancellation,
  and later nonblocking answer delivery linkage.
- Methods: readRequestInputSettings, setRequestInputVariant,
  setRequestInputBlockingTimeout, createRequestInput, getRequestInput,
  listOpenBlockingRequestInputs, answerRequestInput, setRequestInputTimerPaused,
  defaultOpenRequestInputQuestions, cancelRequestInput.
- Rule: this port owns request-input records and any later nonblocking answer delivery linkage.
  Creation validates exact session/surface/thread/turn/command lineage and requires an active turn
  and command. For blocking requests, creation atomically records the request/questions, the linked
  command's waiting state, and the durable user wait. The first completed/expired/cancelled request
  transition atomically terminalizes the linked command and clears only the matching user wait. A
  nonblocking answer atomically records the answer, its delivery queue row, and `steering` priority
  for `enqueue-and-run`. Standalone command and wait operations remain available through their
  narrow ports; request-input timer scheduling itself is runtime process behavior and is never owned
  by state.
- Settings rule: the router always dispatches the three settings methods to the app-global store.
  Existing request rows and all row-addressed methods remain workspace-routed. The app-global
  `request_user_input_settings` singleton defaults without inserting a row to mode `nonblocking`
  with `{ enabled: true, durationMs: 300000 }`, and each settings write updates that one row and
  bumps `state_revision` exactly once. There is no JSON mirror, migration bridge, compatibility row,
  or dual-write path.
- Settings invalidations: `setRequestInputVariant(...)` returns app `settings`, app `extensions`
  narrowed to extension id `request-user-input`, and app `agents` descriptors in that order.
  `setRequestInputBlockingTimeout(...)` returns only app `settings`.
- Transaction rule: blocking creation, the terminal answer, timeout defaulting, and cancellation
  each delegate all request/command/wait writes to one structured-session transaction. Answer
  recording and timer pause/resume delegate surface ownership validation and committed row changes
  to structured-session write methods. The state port adapter must not pre-read
  `getRequestUserInputRequest(...)` only to recover session ownership, validate the target surface,
  or derive stale invalidations before calling `answerRequestUserInput(...)` or
  `setRequestUserInputTimerPaused(...)`.

RuntimeSessionWaitStatePort:

- Caller: @svvy/runtime approval waits, request-input blocking waits, and prompt/session recovery
  flows that need to project why a session or thread is intentionally waiting.
- Methods: setApprovalWait, setUserWait, clearSessionWait.
- Rule: this port owns only durable wait projection facts used by read models and recovery. It does
  not own in-memory pending registries, timeout scheduling, command settlement, approval decisions,
  request-input answers, queue delivery, or pi prompt control.
- Mutation result rule: `setApprovalWait`, `setUserWait`, and `clearSessionWait` return
  `StateMutationResult<void>`. Runtime consumers use the committed success/failure and
  `afterCommit` descriptors; they do not read wait records from this port. Approval request rows,
  request-input rows, command facts, and read-model projections remain the authoritative sources for
  the pending action details. A no-op `clearSessionWait` returns `value: undefined` and
  `afterCommit: []`.

Wait projection contract:

```ts
type RuntimeSessionWaitOwner =
  | { kind: "orchestrator" }
  | { kind: "thread"; threadId: ThreadId };

type SetRuntimeApprovalSessionWaitInput = {
  sessionId: WorkspaceSessionId;
  owner: RuntimeSessionWaitOwner;
  reason: string;
  resumeWhen: string;
};

type SetRuntimeUserSessionWaitInput = {
  sessionId: WorkspaceSessionId;
  owner: RuntimeSessionWaitOwner;
  reason: string;
  resumeWhen: string;
};

type ClearRuntimeSessionWaitInput = {
  sessionId: WorkspaceSessionId;
};

type RuntimeSessionWaitStatePort = {
  setApprovalWait(
    input: SetRuntimeApprovalSessionWaitInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  setUserWait(
    input: SetRuntimeUserSessionWaitInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
  clearSessionWait(
    input: ClearRuntimeSessionWaitInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
};
```

`setApprovalWait(...)` and `setUserWait(...)` overwrite only the wait projection for the addressed
`sessionId` and owner. They do not create approval/request rows and do not return the projection
record as an operation result. `clearSessionWait(...)` clears the session wait projection for the
addressed `sessionId`; stale clear attempts are idempotent no-ops with `afterCommit: []`. Runtime
timers, `Deferred` registries, approval answers, request-input answers, and command settlement stay
outside this port. If owner-scoped clears become necessary to reject stale callers, that must be a
separate core contract change with runtime consumer updates; it is not implied by this port's
current return value.

There is no public `RuntimeTitleStatePort`. Title generation is runtime-owned work represented by
`RuntimeRecoveryStatePort` recovery rows with the `title_generation` kind plus state-owned title
facts on the relevant session/thread records. Do not add detached helper promises or a separate
title-job service outside runtime/state ports.

RuntimeRecoveryStatePort:

- Caller: @svvy/runtime recovery workers.
- Methods: normalizeWorkspaceRecoveryState, listWorkspaceRecoveryStartupSnapshots,
  ensureRecoveryWork, claimNextRecoveryWork, completeRecoveryWork, failOrRetryRecoveryWork.
- Rule: recovery claims use the same owner/lease/version discipline as queue claims. Recovery work
  is explicitly scoped as `{ kind: "app" }` or `{ kind: "workspace"; workspaceId }`; app-global
  work such as source reconciliation and generated-package refresh is not forced into a workspace
  bucket. `RuntimeRecoveryWorkOwnerScope`, `RuntimeRecoveryWorkRecord`, and
  `EnsureRuntimeRecoveryWorkInput` carry enough scope to route through one app-owned runtime state
  service without relying on a bound single-workspace store.
- `listWorkspaceRecoveryStartupSnapshots(...)` is read-only and returns recovery startup snapshots
  for workspace-scoped runtime recovery.
- `normalizeWorkspaceRecoveryState(...)`, `ensureRecoveryWork(...)`, `claimNextRecoveryWork(...)`,
  `completeRecoveryWork(...)`, and `failOrRetryRecoveryWork(...)` are mutating state-port methods
  and return `StateMutationResult<T>`.
- Mutation result rule: `normalizeWorkspaceRecoveryState(...)` returns `StateMutationResult<void>`.
  Its `afterCommit` contains one `surface(surfacePiSessionId)` descriptor for each interrupted
  queued message surface reset from `steering` or `dispatching` back to `queued`. It returns
  `afterCommit: []` when it only resets recovery-work claims or no rows changed.
  `ensureRecoveryWork(...)`, `claimNextRecoveryWork(...)`, `completeRecoveryWork(...)`,
  `failOrRetryRecoveryWork(...)` return their committed recovery-work value with
  `afterCommit: []`, because recovery-work rows are runtime-internal and have no public recovery
  read-model invalidation descriptor.

The exact recovery state port is:

```ts
type RuntimeRecoveryStatePort = {
  normalizeWorkspaceRecoveryState(
    input: NormalizeRuntimeRecoveryStateInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;

  listWorkspaceRecoveryStartupSnapshots(): Effect.Effect<
    readonly RuntimeRecoveryStartupSnapshot[],
    StateContractError
  >;

  ensureRecoveryWork(
    input: EnsureRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>, StateContractError>;

  claimNextRecoveryWork(
    input: ClaimNextRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord | null>, StateContractError>;

  completeRecoveryWork(
    input: CompleteRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>, StateContractError>;

  failOrRetryRecoveryWork(
    input: FailOrRetryRuntimeRecoveryWorkInput,
  ): Effect.Effect<StateMutationResult<RuntimeRecoveryWorkRecord>, StateContractError>;
};
```

Startup snapshots include at least claimable recovery rows, recoverable queue rows, active turns,
request-input waits, approval waits, title jobs, generated-context refresh rows,
generated-package-readiness rows, workspace generated-package link-repair rows, command-process
reconciliation candidates, and app-log repair facts for the supplied scope. Workspace snapshots
include `workspaceId`; app snapshots never fabricate a workspace id.

RuntimeExtensionContextImpactStatePort:

- Caller: @svvy/runtime extension usage and snapshot-impact workers.
- Methods: listUsageContextAffectedSurfaces, applySnapshotContextImpact.
- Rule: this port computes which existing surfaces are affected by extension usage/default changes
  and snapshot loads. It does not record generated-context builds or surface generated-context
  bindings.
- `listUsageContextAffectedSurfaces(...)` is read-only. It returns the affected surfaces for an
  already-committed profile/usage settings change and does not return `StateMutationResult`.
- `applySnapshotContextImpact(...)` is the mutating snapshot-load cleanup path. It removes deleted
  user extension ids from affected orchestrator and handler-thread loaded/available extension lists,
  marks the affected surfaces as extension-context changed, and returns
  `StateMutationResult<readonly RuntimeExtensionContextChangedSurface[]>`.
- Mutation result rule: `applySnapshotContextImpact(...)` returns one `surface(surfacePiSessionId)`
  descriptor for each affected surface plus one deduped `sessionNavigation` descriptor for the
  workspace. When no surface state changes, it returns `value: []` and `afterCommit: []`. It does
  not emit `handlerThreadInspector` descriptors unless the handler-thread inspector read model adds
  extension-list facts that are not already refetched through the surface invalidation contract.
- Runtime paths consume the Effect service port and collect `afterCommit` after the committed state
  write. No public state facade unwraps this mutation result into a raw affected-surface
  array.

The exact extension context-impact state port is:

```ts
type RuntimeExtensionContextImpactStatePort = {
  listUsageContextAffectedSurfaces(
    input: ListRuntimeExtensionUsageContextAffectedSurfacesInput,
  ): Effect.Effect<readonly RuntimeExtensionContextChangedSurface[], StateContractError>;

  applySnapshotContextImpact(
    input: ApplyRuntimeExtensionSnapshotContextImpactInput,
  ): Effect.Effect<
    StateMutationResult<readonly RuntimeExtensionContextChangedSurface[]>,
    StateContractError
  >;
};
```

Generated-context state ownership:

- Caller: @svvy/runtime generated-context refresh worker and safe-boundary prompt dispatcher.
- Ports: generated-context binding and stale-surface work is owned by
  `RuntimeActorExtensionBindingStatePort`; extension context-impact replay is owned by
  `RuntimeExtensionContextImpactStatePort`; generated-package build facts and workspace-link facts
  are owned by `RuntimeGeneratedPackageStatePort`.
- Rule: generated-context source/build facts and per-surface binding/stale facts are runtime-owned
  product state. `@svvy/extensions` builds immutable generated-context evidence from source and
  state-backed inputs, then returns that evidence to runtime. Runtime records generated-context
  binding and stale-surface facts through the actor-extension binding port after deciding the safe
  refresh boundary. No separate `RuntimeGeneratedContextStatePort` exists in the target
  architecture.
- `RuntimeActorExtensionBindingStatePort.readRuntimePromptBinding(...)` is the runtime prompt
  dispatch read for the current generated-context binding. It resolves the target row, uses the
  target's bound fingerprint for an exact binding lookup, and returns state records without
  `afterCommit`. Other read operations that inspect stale binding status or affected surfaces also
  return state records without `afterCommit`.
- Mutation operations that update a surface generated-context binding return
  `StateMutationResult<SurfaceGeneratedContextBinding>` from the actor-extension binding port. Their
  `afterCommit` contains a `surface(surfacePiSessionId)` invalidation and any affected
  Agents/Extensions invalidation. Rebinding to the same current build id is an idempotent no-op and
  returns `afterCommit: []`.

RuntimeGeneratedPackageStatePort:

- Caller: @svvy/runtime generated-package refresh/recovery.
- Methods: recordGeneratedPackageBuild, recordGeneratedPackageFailure,
  recordWorkspaceLinkStatus, readLinksNeedingRepair, readGeneratedPackageFacts,
  reconcileGeneratedPackageManifest, markGeneratedPackageRefreshNeeded,
  markWorkspaceLinksRepairNeeded.
- Rule: generated package files and manifest bodies are never edited by state; state stores indexed
  generated-package facts, diagnostics, manifest path/build identity, file-list digest, Workflows
  export evidence, and link facts. A successful Workflows write replaces its fact and complete
  export snapshot in one transaction. A failed write updates failure diagnostics without replacing
  the last successful export rows.

The exact generated package state port is:

```ts
type RuntimeGeneratedPackageStatePort = {
  recordGeneratedPackageBuild(
    input: RecordGeneratedPackageBuildInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;

  recordGeneratedPackageFailure(
    input: RecordGeneratedPackageFailureInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;

  recordWorkspaceLinkStatus(
    input: RecordGeneratedPackageWorkspaceLinkInput,
  ): Effect.Effect<
    StateMutationResult<RuntimeGeneratedPackageWorkspaceLinkRecord>,
    StateContractError
  >;

  readLinksNeedingRepair(
    input?: ReadGeneratedPackageLinksNeedingRepairInput,
  ): Effect.Effect<readonly RuntimeGeneratedPackageWorkspaceLinkRecord[], StateContractError>;

  readGeneratedPackageFacts(
    input?: ReadGeneratedPackageFactsInput,
  ): Effect.Effect<readonly RuntimeGeneratedPackageFactRecord[], StateContractError>;

  reconcileGeneratedPackageManifest(
    input: ReconcileGeneratedPackageManifestInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;

  markGeneratedPackageRefreshNeeded(
    input: MarkGeneratedPackageRefreshNeededInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;

  markWorkspaceLinksRepairNeeded(
    input: MarkWorkspaceGeneratedPackageLinksRepairNeededInput,
  ): Effect.Effect<
    StateMutationResult<MarkWorkspaceGeneratedPackageLinksRepairNeededResult>,
    StateContractError
  >;
};
```

RuntimeReadModelStatePort:

- Caller: @svvy/runtime for state-backed read models needed by runtime-owned native tools and
  runtime workers.
- Methods: getCurrentThread, listThreads, readThreadEpisodes, getThreadGroup.
- Rule: read models are refetched from committed state; runtime events are not replayed as durable
  state. The runtime-facing port uses exact domain methods, not a stringly generic read-model
  registry. The non-Effect state facade may expose `readModels.fetch(...)`,
  `readModels.refetchInvalidation(...)`, and `readModels.rebaseline(...)` for renderer/headless
  consumers, but that facade is not the runtime-facing state port.

The exact runtime-facing read-model port is:

```ts
type RuntimeThreadStatus =
  | "running-handler"
  | "running-workflow"
  | "waiting"
  | "idle"
  | "troubleshooting"
  | "completed";

type RuntimeThreadCompactRow = {
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  objectiveState: "active" | "concluded";
  status: RuntimeThreadStatus;
  wait: { kind: "user" | "external"; reason: string; resumeWhen: string } | null;
  latestEpisode: { id: EpisodeId; title: string; summary: string; createdAt: IsoDateTimeString } | null;
};

type GetCurrentRuntimeThreadInput = {
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
};

type RuntimeThreadCurrentReadModel = RuntimeThreadCompactRow & {
  pendingReportRequests: readonly {
    queuedMessageId: QueueItemId;
    request: string;
    createdAt: IsoDateTimeString;
  }[];
};

type ListRuntimeThreadsInput = {
  workspaceSessionId: WorkspaceSessionId;
  threadGroupId?: ThreadGroupId | null;
  status?: readonly RuntimeThreadStatus[] | null;
  limit?: PositiveSafeInteger;
};

type RuntimeThreadListReadModel = {
  threads: readonly RuntimeThreadCompactRow[];
};

type ReadRuntimeThreadEpisodesInput = {
  workspaceSessionId: WorkspaceSessionId;
  target: { kind: "thread"; threadId: ThreadId } | { kind: "thread-group"; threadGroupId: ThreadGroupId };
  limit?: PositiveSafeInteger;
};

type RuntimeThreadEpisodesReadModel = {
  episodes: readonly RuntimeEpisodeRecord[];
};

type GetRuntimeThreadGroupInput = {
  workspaceSessionId: WorkspaceSessionId;
  currentThreadId: ThreadId;
};

type RuntimeThreadGroupReadModel = {
  threadGroupId: ThreadGroupId;
  currentThreadId: ThreadId;
  threads: readonly RuntimeThreadCompactRow[];
};

type RuntimeReadModelStatePort = {
  getCurrentThread(
    input: GetCurrentRuntimeThreadInput,
  ): Effect.Effect<RuntimeThreadCurrentReadModel, StateContractError>;

  listThreads(input: ListRuntimeThreadsInput): Effect.Effect<RuntimeThreadListReadModel, StateContractError>;

  readThreadEpisodes(
    input: ReadRuntimeThreadEpisodesInput,
  ): Effect.Effect<RuntimeThreadEpisodesReadModel, StateContractError>;

  getThreadGroup(
    input: GetRuntimeThreadGroupInput,
  ): Effect.Effect<RuntimeThreadGroupReadModel, StateContractError>;
};
```

`readThreadEpisodes(...)` never has an omitted target. Handler-thread calls pass their own
`threadId`; orchestrator calls pass either an explicit `threadId` or a `threadGroupId`. There is no
runtime-facing state method that returns every episode in a workspace session.

ExtensionStatePort:

- Caller: @svvy/extensions.
- Methods: `records.readSourceFingerprint(...)`, `dependencies.isApproved(...)`, and
  `dependencies.readReadiness(...)`.
- Rule: extension-facing state reads expose only committed source-root fingerprints and dependency
  approval/readiness facts needed by `@svvy/extensions` validation and build planning. Source files,
  extension inventory, actor bindings, env planning, generated-context writes, and generated-package
  writes remain owned by their separately named ports and services.
  `layerExtensionStatePort` targets only the core-owned `ExtensionStatePort` tag consumed by
  `@svvy/extensions`; package-boundary tests reject structural-provider exports or accidental
  provision of another state/source service under this layer name.

ExtensionSnapshotStatePort:

- Caller: package-private runtime `RuntimeExtensionSnapshotService` production orchestration.
- Authority: app-global SQLite rows for snapshot metadata, client-submission receipts, resumable
  restore attempts, and pending payload/keychain cleanup. Snapshot payload bytes and secret-store
  operations are outside state and are not implemented by this port.
- Reads: `list()` is pure and never creates an `Initial` snapshot; it returns only the public summary
  read model. `read(...)`, restore-attempt reads, and pending-cleanup reads are trusted internal
  operations that may return opaque payload/secret references but never secret values or paths.
- Mutations: save/rename/delete/load, restore advancement, and cleanup completion are transactional,
  revision-checked where they target existing metadata, and idempotent by required client request
  id. Reusing a request id with different operation/input is a typed conflict. Delete commits a
  pending cleanup row in the same transaction as metadata removal; load only prepares a durable
  restore attempt and does not apply payloads.
- Persistence invariants: secret state agrees with nullable private secret reference; restore
  terminal timestamps and failure reasons agree with status; every restore phase durably retains
  the exact affected-surface receipts produced when snapshot settings commit so recovery after that
  phase returns the same agent-context impact; public DTO schemas fail on excess private fields.
  Reopen, idempotency, transition, cleanup, and no-public-leak tests are required.

ExtensionSnapshotSettingsStatePort:

- Caller: package-private runtime `RuntimeExtensionSnapshotService` production orchestration.
- Capture reads app-global actor extension defaults, every existing profile's extension order/usage,
  non-secret env override scopes/rows, and declaration-based secret target presence. It returns no
  paths, profile model/prompt fields, secret refs, revision fingerprints, or secret values.
- Apply is one SQLite transaction idempotent by required client request id. It overwrites extension
  order/usage for captured actor rows and existing captured profiles, skips and reports missing
  profile ids without creating them, and clears/reinserts non-secret override rows exactly within
  explicit captured scopes. Profiles outside the payload and profile name/provider/model/reasoning,
  follow-composer, title, prompt, and unrelated rows remain unchanged.
- Secret targets are counted as deferred facts only; this port never mutates secret rows or invokes a
  secret store. Applied mutations emit only app `extensions` and `agents` invalidations; duplicate
  replay emits none. Persistence, reopen, exact clearing, skipped-profile, idempotency, and
  no-secret-value tests are required.

ProviderAuthPort / ProviderAuthStatusStatePort:

- Caller: `@svvy/pi-adapter` and runtime model surfaces for live credential snapshots; app
  bootstrap records redacted provider status through runtime-owned state ports.
- Methods: `ProviderAuthPort.getProviderAuthSnapshot`,
  `ProviderAuthPort.refreshProviderCredentialSnapshot`,
  `ProviderAuthStatusStatePort.listProviderStatuses`,
  `ProviderAuthStatusStatePort.recordProviderStatus`.
- Rule: credential material is returned only by live `ProviderAuthPort` snapshot methods for trusted
  invocations. DB/product-state-backed provider status contains redacted account labels, health,
  expiry, and issues only. `@svvy/state` implements `ProviderAuthStatusStatePort`; app/bootstrap
  supplies the host/live `ProviderAuthPort`.

PiSessionReferencePort:

- Caller: @svvy/pi-adapter.
- Methods: getPiSessionReference, savePiSessionReference, deletePiSessionReference,
  validatePiSessionReference.
- Rule: persisted pi references are opaque adapter-owned records keyed by surfacePiSessionId.

SandboxPolicySource:

- Caller: @svvy/sandbox.
- Methods: snapshot.
- Rule: `snapshot(input: SandboxPolicySnapshotInput)` reads committed state-owned settings and
  policy facts plus immutable root config supplied at state-layer composition for the requested
  workspace/session command context and returns an immutable policy snapshot only. `@svvy/sandbox`
  never reads settings/state directly, never passes ad hoc policy fragments, and never receives a
  mutable policy handle. `layerSandboxPolicySource` targets only `SandboxPolicySource` consumed by
  `@svvy/sandbox`; package-boundary tests reject swapped service targets or structural-provider
  exports.

RuntimeArtifactStatePort:

- Caller: @svvy/runtime artifact effect application and runtime-owned artifact command adapters.
- Methods: recordArtifactMetadata, inspectArtifact, listArtifacts, markArtifactMetadataDeleted.
- Rule: artifact metadata, stored-path facts, materialization status, deleted lifecycle fields,
  command/thread/workflow links, and read-model indexes are DB/product-state-backed facts committed
  by the state implementation of the core-owned runtime artifact port. Runtime owns the matching
  physical file effects and supplies byte size, digest, and final stored-path facts to this port.
  Extension handlers do not receive artifact state or artifact file-store ports; they return
  validated handler results, command facts, and `ExtensionRuntimeOperation` items wrapping
  `RuntimeEffectRequest` values or immutable execution plans for runtime to apply.

The method names above are public contracts. Implementations either provide the exact name or update
this matrix in the same change; similar private repository/helper names are not substitutes for the
public port contract.
\*/

type RuntimeQueueStatePort = {
acceptSubmittedSurfaceMessage(
input: AcceptSubmittedRuntimeSurfaceMessageInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
acceptEditedCommittedSurfaceMessage(
input: AcceptEditedCommittedRuntimeSurfaceMessageInput,
): Effect.Effect<
  StateMutationResult<AcceptEditedCommittedRuntimeSurfaceMessageResult>,
  StateContractError
>;
enqueueSurfaceMessage(
input: EnqueueRuntimeSurfaceMessageInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
getSurfaceQueuedMessage(
input: GetRuntimeSurfaceMessageInput,
): Effect.Effect<RuntimeSurfaceMessageRecord, StateContractError>;
claimNextQueuedSurfaceMessage(
input: ClaimNextRuntimeSurfaceMessageInput,
): Effect.Effect<
  StateMutationResult<RuntimeSurfaceMessageRecord | null>,
  StateContractError
>;
releaseExpiredSurfaceMessageClaims(
input?: ReleaseExpiredRuntimeSurfaceMessageClaimsInput,
): Effect.Effect<
  StateMutationResult<readonly RuntimeSurfaceMessageRecord[]>,
  StateContractError
>;
markSurfaceMessageSteering(
input: MarkRuntimeSurfaceMessageSteeringInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
markSurfaceMessageQueued(
input: MarkRuntimeSurfaceMessageQueuedInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
markSurfaceMessageDelivered(
input: MarkRuntimeSurfaceMessageDeliveredInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
markSurfaceMessageFailed(
input: MarkRuntimeSurfaceMessageFailedInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
cancelSurfaceMessage(
input: CancelRuntimeSurfaceMessageInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
reorderSurfaceMessage(
input: ReorderRuntimeSurfaceMessageInput,
): Effect.Effect<
  StateMutationResult<readonly RuntimeSurfaceMessageRecord[]>,
  StateContractError
>;
};

type EnqueueRuntimeSurfaceMessageInput = {
workspaceSessionId: WorkspaceSessionId;
surfacePiSessionId: SurfacePiSessionId;
threadId?: ThreadId | null;
workflowTaskAttemptId?: WorkflowTaskAttemptId | null;
kind: RuntimeSurfaceQueueItemKind;
idempotencyKey: string;
priority: RuntimeSurfaceQueuePriority;
sourceCommandId?: CommandId | null;
maxAttempts?: number;
nextAttemptAt?: IsoDateTimeString | null;
message: RuntimeSubmittedMessage;
payload?: QueueItemPayload | null;
position?: "front" | "back";
};

`RuntimeQueueStatePort.enqueueSurfaceMessage(...)` derives and stores the durable `orderingKey` from
`surfacePiSessionId`, queue item `kind`, and committed target lineage. Runtime supplies queue kind,
priority, idempotency, timing, source-command lineage, message, and typed payload; callers do not
supply `orderingKey`.

type ClaimNextRuntimeSurfaceMessageInput = {
  surfacePiSessionId: SurfacePiSessionId;
  orderingKey: string;
  ownerId: RuntimeOwnerId;
  now: IsoDateTimeString;
  leaseDurationMs: PositiveDurationMs;
};

type ReleaseExpiredRuntimeSurfaceMessageClaimsInput = {
  now: IsoDateTimeString;
  surfacePiSessionId?: SurfacePiSessionId;
  orderingKey?: string;
};

type QueueDepthInput = {
surfacePiSessionId: SurfacePiSessionId;
orderingKey?: string;
};

type QueueDepthResult = {
queued: number;
steering: number;
dispatching: number;
};

type RuntimeSurfaceQueueItemKind =
  | "user_message"
  | "initial_handler_start"
  | "thread_followup"
  | "report_request"
  | "thread_report_notification"
  | "request_user_input_answer"
  | "workflow_task_agent_start";

type RuntimeSurfaceQueuePriority = "interactive" | "runtime" | "background";

type SurfaceQueueRow = {
id: QueueItemId;
workspaceId: WorkspaceId;
workspaceSessionId: WorkspaceSessionId;
surfacePiSessionId: SurfacePiSessionId;
threadId: ThreadId | null;
workflowTaskAttemptId: WorkflowTaskAttemptId | null;
kind: RuntimeSurfaceQueueItemKind;
status: "queued" | "steering" | "dispatching" | "delivered" | "failed" | "cancelled";
priority: RuntimeSurfaceQueuePriority;
orderingKey: string;
sequence: number;
position: number;
steerSequence: number | null;
payload: QueueItemPayload;
idempotencyKey: string;
sourceCommandId: CommandId | null;
nextAttemptAt: IsoDateTimeString | null;
attemptCount: number;
maxAttempts: number;
claimOwnerId: RuntimeOwnerId | null;
claimLeaseExpiresAt: IsoDateTimeString | null;
leaseVersion: number;
lastError: StateStoredError | null;
createdAt: IsoDateTimeString;
updatedAt: IsoDateTimeString;
deliveredAt: IsoDateTimeString | null;
failedAt: IsoDateTimeString | null;
failureError: string | null;
cancelledAt: IsoDateTimeString | null;
};

type RuntimeSurfaceMessageRecord = SurfaceQueueRow;

type GetRuntimeSurfaceMessageInput = {
  id: QueueItemId;
  surfacePiSessionId?: SurfacePiSessionId;
};

type MarkRuntimeSurfaceMessageSteeringInput = {
  id: QueueItemId;
  surfacePiSessionId: SurfacePiSessionId;
  orderingKey: string;
  steeredAt: IsoDateTimeString;
  reason: "user" | "request_input_answer" | "runtime_policy";
};

type MarkRuntimeSurfaceMessageQueuedInput = {
  id: QueueItemId;
  surfacePiSessionId: SurfacePiSessionId;
  orderingKey: string;
  queuedAt: IsoDateTimeString;
  reason: "restore_to_queue" | "active_turn_busy" | "steering_cancelled" | "runtime_policy";
  ownerId?: RuntimeOwnerId;
  leaseVersion?: number;
};

Queue state-port mutation results return exact invalidations:

- enqueue, steering, queued, delivered, failed, and cancelled rows emit
  `surface(surfacePiSessionId)`, `sessionNavigation`, and the queue/read-model descriptor for that
  surface.
- claim and expired-claim release emit those descriptors only when the committed row set changes.
- duplicate idempotency-key enqueue returns the existing row with `afterCommit: []` when no stored
  row field changes.
- failed materialization never silently requeues a row; retry scheduling is explicit in
  `MarkRuntimeSurfaceMessageFailedInput.retry`.

type RuntimeCommandStatePort = {
createCommand(
input: CreateRuntimeCommandInput,
): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
createOrReuseStreamingCommand(
input: CreateOrReuseStreamingRuntimeCommandInput,
): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
findCommandByToolCallId(
input: FindRuntimeCommandByToolCallIdInput,
): Effect.Effect<RuntimeCommandRecord | null, StateContractError>;
findCommandById(
input: FindRuntimeCommandByIdInput,
): Effect.Effect<RuntimeCommandRecord | null, StateContractError>;
updateCommandArguments(
input: UpdateRuntimeCommandArgumentsInput,
): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
startCommand(input: StartRuntimeCommandInput): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
finishCommand(
input: FinishRuntimeCommandInput,
): Effect.Effect<StateMutationResult<RuntimeCommandRecord>, StateContractError>;
recordCommandEvent(input: RecordRuntimeCommandEventInput): Effect.Effect<StateMutationResult<void>, StateContractError>;
recordStdinWrite(input: RecordRuntimeCommandStdinWriteInput): Effect.Effect<StateMutationResult<void>, StateContractError>;
hasCommandOutputEvent(
input: HasRuntimeCommandOutputEventInput,
): Effect.Effect<boolean, StateContractError>;
};

// Imported from @svvy/core; state must not redefine this as an unbranded string.
type NativeToolName = import("@svvy/core").NativeToolName;

type RuntimeCommandRecord = {
id: CommandId;
workspaceSessionId: WorkspaceSessionId;
turnId: TurnId | null;
workflowTaskAttemptId: WorkflowTaskAttemptId | null;
surfacePiSessionId: SurfacePiSessionId;
threadId: ThreadId | null;
workflowRunId: WorkflowRunId | null;
parentCommandId: CommandId | null;
toolName: NativeToolName;
executor: "orchestrator" | "handler" | "workflow-task-agent" | "execute_typescript" | "runtime";
visibility: "trace" | "summary" | "surface";
status: "streaming" | "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
attempts: number;
title: string;
summary: string;
arguments: JsonValue | null;
facts: CommandFactsPayload | null;
error: string | null;
startedAt: IsoDateTimeString;
updatedAt: IsoDateTimeString;
finishedAt: IsoDateTimeString | null;
};

`title` and `summary` on runtime command records are durable command display facts for command
projection, collapsed tool spans, and inspectors. Runtime writes them from accepted tool metadata,
command lifecycle state, terminal facts, and normalized errors. They are not source contents, queue
request summaries, generated-context read-model payloads, or duplicated submitted prompt text. Raw arguments,
progress, stdout/stderr, patch snapshots, artifacts, diagnostics, and structured terminal facts stay
in command event rows and command fact payloads addressed by command id.

type CreateRuntimeCommandInput = {
turnId?: TurnId | null;
workflowTaskAttemptId?: WorkflowTaskAttemptId | null;
surfacePiSessionId?: SurfacePiSessionId;
threadId?: ThreadId | null;
workflowRunId?: WorkflowRunId | null;
parentCommandId?: CommandId | null;
toolName: NativeToolName;
executor: RuntimeCommandRecord["executor"];
visibility: RuntimeCommandRecord["visibility"];
title: string;
summary: string;
arguments?: JsonValue;
facts?: CommandFactsPayload | null;
attempts?: number;
status?: "requested" | "streaming";
};

type CreateOrReuseStreamingRuntimeCommandInput = Omit<
CreateRuntimeCommandInput,
"facts" | "status"
> & {
toolCallId: ToolCallId;
facts?: CommandFactsPayload | null;
};

type FindRuntimeCommandByToolCallIdInput = {
toolCallId: ToolCallId;
};

type UpdateRuntimeCommandArgumentsInput = {
commandId: CommandId;
arguments: JsonValue;
};

type StartRuntimeCommandInput = {
commandId: CommandId;
};

type FinishRuntimeCommandInput = {
commandId: CommandId;
status: "waiting" | "succeeded" | "failed" | "cancelled";
visibility?: RuntimeCommandRecord["visibility"];
summary?: string;
facts?: CommandFactsPayload | null;
error?: string | null;
};

type RecordRuntimeCommandEventInput = {
sessionId: WorkspaceSessionId;
commandId: CommandId;
kind:
| "command.arg_snapshot"
| "command.diagnostics"
| "command.output"
| "command.patch_snapshot"
| "command.progress";
at?: IsoDateTimeString;
data?: CommandEventPayload;
};

type RecordRuntimeCommandStdinWriteInput = {
sessionId: WorkspaceSessionId;
commandId: CommandId;
text: string;
acceptedBytes: ByteCount;
at?: IsoDateTimeString;
};

type HasRuntimeCommandOutputEventInput = {
sessionId: WorkspaceSessionId;
commandId: CommandId;
stream?: "stdout" | "stderr";
source?: "live-stream" | "final-result" | "execute_typescript" | "retained-log-artifact";
};

type RuntimeRequestStatePort = {
readRequestInputSettings(): Effect.Effect<RequestInputSettings, StateContractError>;
setRequestInputVariant(
input: SetRequestInputVariantInput,
): Effect.Effect<StateMutationResult<SetRequestInputVariantResult>, StateContractError>;
setRequestInputBlockingTimeout(
input: SetRequestInputBlockingTimeoutInput,
): Effect.Effect<StateMutationResult<SetRequestInputBlockingTimeoutResult>, StateContractError>;
createRequestInput(
input: CreateRuntimeRequestInput,
): Effect.Effect<StateMutationResult<RuntimeRequestInputRecord>, StateContractError>;
getRequestInput(
input: { requestId: RequestInputRequestId },
): Effect.Effect<RuntimeRequestInputDetailsRecord, StateContractError>;
listOpenBlockingRequestInputs(
input?: {
workspaceSessionId?: WorkspaceSessionId | null;
surfacePiSessionId?: SurfacePiSessionId | null;
},
): Effect.Effect<readonly RuntimeRequestInputDetailsRecord[], StateContractError>;
answerRequestInput(input: AnswerRequestInputInput): Effect.Effect<StateMutationResult<RuntimeAnswerRequestInputCommitResult>, StateContractError>;
setRequestInputTimerPaused(
input: SetRequestInputTimerPausedInput,
): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
defaultOpenRequestInputQuestions(input: {
requestId: RequestInputRequestId;
answeredBy: "timeout_default";
}): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
cancelRequestInput(input: {
requestId: RequestInputRequestId;
}): Effect.Effect<StateMutationResult<RuntimeRequestInputDetailsRecord>, StateContractError>;
};

type CreateRuntimeRequestInput = {
target: PromptTarget;
turnId: TurnId;
toolItemId: ToolItemId;
sourceCommandId: CommandId;
mode: "nonblocking" | "blocking";
questions: readonly RuntimeRequestInputQuestionInput[];
timeout: null | { enabled: boolean; durationMs: number };
};

type RuntimeAnswerRequestInputCommitResult = {
answer: AnswerRequestInputResult;
target: PromptTarget;
};

`RequestInputSettings`, both named settings mutation input/result pairs,
`AnswerRequestInputInput`, `AnswerRequestInputResult`, `SetRequestInputTimerPausedInput`, and
`SetRequestInputTimerPausedResult` are core-owned runtime request-input contracts imported from
`@svvy/core`. `RuntimeRequestStatePort` must not import these shapes from `@svvy/runtime` or define
state-local aliases with the same names. Runtime facade methods and state ports share the core
contract, while state owns the app-global settings singleton, DB-backed request rows, question rows,
answer rows, timeout facts, and committed request-input post-commit handoff values.

`answerRequestInput(...)` returns the public `AnswerRequestInputResult` inside
`RuntimeAnswerRequestInputCommitResult.answer` and the committed owning `PromptTarget` inside
`RuntimeAnswerRequestInputCommitResult.target`. State derives `target` from the committed request
record returned by the answer transaction: `threadId === null` means orchestrator, and non-null
`threadId` means handler. Runtime uses this committed target for nonblocking queued-answer wakeup and
must not issue a post-answer `getRequestInput(...)` read only to reconstruct the wake target. The
public runtime facade still returns only `AnswerRequestInputResult`. For blocking requests,
`answer.delivery.kind` is `blocking-open` while any question in the committed request remains open
and `blocking-resolved` only after the committed request has no open questions.
When `AnswerRequestInputInput.clientSubmission` provides a submission, client-request, or
correlation id, the answer transaction stores the selected key on the answer row. Replaying the
same `(requestId, questionId, key)` returns the original answer and queued-delivery receipt with
`status: "duplicate"` and `afterCommit: []`; it does not insert another answer or queue row. A fresh
answer returns `status: "recorded"`.

State persists request-input timeout deadline facts during `createRequestInput(...)` from explicit
runtime-provided timestamp/duration inputs plus manifest-adopted `DateTime`/`Duration` helpers.
Durable timeout policy is the app-global request-input settings row; runtime reads that policy and
remains the owner of clock access and process-local scheduling. Runtime passes only the resolved
duration and mode; extension effects and UI callers do not author persisted deadline timestamps. On
pause, state writes `pausedAt` and
`remainingMsWhenPaused` from the committed clock time and clears `expiresAt`. On resume, state
recomputes `expiresAt = now + remainingMsWhenPaused`, clears pause fields, and keeps the original
`durationMs`. Restart recovery and timeout scans read persisted `expiresAt` / pause fields rather
than reconstructing deadlines from process-local timers.

type RuntimeRequestInputQuestionInput = {
title: string;
question: string;
defaultAnswer:
| { kind: "option"; label: string; text: string }
| { kind: "custom"; text: string };
choices?: readonly {
label: string;
description: string;
recommended: boolean;
}[];
};

// Nonblocking default answers are created as part of createRequestInput(... mode: "nonblocking").
// Blocking timeout defaults are produced by defaultOpenRequestInputQuestions(...).
// Model-facing command completion for both paths is written separately through
// RuntimeCommandStatePort.finishCommand(...).

type SetRuntimeRequestInputTimerPausedInput = {
surfacePiSessionId: SurfacePiSessionId;
requestId: RequestInputRequestId;
paused: boolean;
};

`setRequestInputTimerPaused(...)` validates surface ownership and an open blocking request with an
enabled timeout, writes paused/resumed timer facts transactionally, and returns the committed
`RuntimeRequestInputDetailsRecord` through `StateMutationResult.value`. Runtime adapts that
state-port value back to the public `SetRequestInputTimerPausedResult` `{ requestId }` facade
result. Runtime reschedules or clears process-local timeout/wait fibers only after this state
commit. State never owns host timers, Effect fibers, queue wakeups, or command settlement for timer
pause.

type ClaimRuntimeRequestInputAnswerDeliveryInput = {
requestId: RequestInputRequestId;
ownerId: RuntimeOwnerId;
now: IsoDateTimeString;
leaseDurationMs: PositiveDurationMs;
};

type SettleRuntimeRequestInputInput = {
requestId: RequestInputRequestId;
status: "answered" | "cancelled" | "expired" | "failed";
settledAt: IsoDateTimeString;
reason?: string;
};

type ExpireRuntimeRequestInputsInput = {
now: IsoDateTimeString;
ownerId: RuntimeOwnerId;
limit: PositiveSafeInteger;
};

Request-input mutations use the same single envelope as every other runtime-facing state write:
`StateMutationResult<T>`. `setRequestInputVariant`, `setRequestInputBlockingTimeout`,
`createRequestInput`, `answerRequestInput`,
`defaultOpenRequestInputQuestions`, `cancelRequestInput`, and `setRequestInputTimerPaused` return
their committed domain value as `value` and their publication descriptors as `afterCommit`. They do
not embed a second nested `afterCommit`, `receipt`, queue row preview, or best-effort delivery claim
object inside `value`. `answerRequestInput(...)` is the answer-specific exception where `value` is
the committed handoff object `{ answer, target }`: `answer` is the exact public
`AnswerRequestInputResult`, and `target` is the committed `PromptTarget` required for runtime
post-commit wake behavior. This is not a queue-row preview and must not require a runtime
post-answer state read.

type SurfaceTranscriptReadModelInput = {
target: RuntimeSurfaceTarget;
afterMessageId?: MessageId;
limit?: PositiveSafeInteger;
};

type SurfaceTranscriptReadModel = {
target: RuntimeSurfaceTarget;
surfaceStatus: "idle" | "running" | "waiting" | "error";
promptLock: { activeTurnId: TurnId | null; queuedCount: number };
composerDraft: { text: string; attachmentIds: readonly string[] };
messages: readonly {
messageId: MessageId;
role: "user" | "assistant";
turnId?: TurnId;
text?: string;
commandIds?: readonly CommandId[];
createdAt: IsoDateTimeString;
}[];
};

`SurfaceTranscriptReadModel` is DB/product-state-backed. It returns the committed rich transcript,
composer and prompt-lock facts, the current durable streaming assistant when one exists, and the
matching surface-local `{ streamGenerationId, streamSequence }` cursor. Runtime persists a compact
transcript mutation before publishing its corresponding renderer patch. This permits an
authoritative targeted mid-stream rebaseline without publishing a global read-model invalidation for
every packet: the renderer replaces its durable base from state, resumes at the returned cursor, and
applies only later contiguous patches. The projection reads `transcript_message`, ordered
`transcript_content_block`, and `surface_transcript_stream`; it does not reconstruct transcript
messages from turn summaries, legacy turn assistant columns, renderer patches, or pi-native message
objects.

type CommandInspectorReadModelInput = {
workspaceId: WorkspaceId;
commandId: CommandId;
};

type CommandInspectorReadModel = StructuredCommandInspector & {
target: RuntimeSurfaceTarget;
acceptedArguments: JsonValue;
};

`StructuredCommandInspector` is the complete state-owned debugger projection. It preserves the
canonical parent command identity for child-command requests, exact `streaming`, `requested`,
`running`, `waiting`, and terminal lifecycle states, title, visibility, thread/workflow linkage,
timestamps, terminal facts/error, raw argument/output/progress/patch/diagnostic histories, detailed
artifact links, and summary/trace child-command detail. `target` is resolved from the same durable
command/session snapshot. `acceptedArguments` is the command row's accepted argument JSON, or
`null` when the command has no accepted arguments. Runtime events carry invalidation signals, not
inspector snapshots, and the renderer does not author or reconstruct these fields.

`stdin.canAttemptWrite` is a UI affordance hint derived from durable command stdin mode and
nonterminal command status. It is not a live handle guarantee. `runtime.commands.writeStdin(...)`
remains authoritative and may still return `stdin_closed`, `not_running`, `already_terminal`, or a
typed runtime failure before the state layer records an accepted write. `stdin.acceptedWrites`
contains only state-backed accepted stdin receipts recorded by `RuntimeCommandStatePort.recordStdinWrite(...)`.

type MarkRuntimeSurfaceMessageDeliveredInput = {
  id: QueueItemId;
  ownerId: RuntimeOwnerId;
  leaseVersion: number;
  deliveredAt: IsoDateTimeString;
  turnId: TurnId;
};

type MarkRuntimeSurfaceMessageFailedInput = {
  id: QueueItemId;
  ownerId: RuntimeOwnerId;
  leaseVersion: number;
  failedAt: IsoDateTimeString;
  error: StateStoredError;
  retry: { nextAttemptAt: IsoDateTimeString } | { terminal: true };
};

type CancelRuntimeSurfaceMessageInput = {
  id: QueueItemId;
  cancelledAt: IsoDateTimeString;
  reason: "user" | "runtime_shutdown" | "surface_deleted" | "superseded";
  ownerId?: RuntimeOwnerId;
  leaseVersion?: number;
};

type RecoveryWorkScope = { kind: "app" } | { kind: "workspace"; workspaceId: WorkspaceId };

type RecoveryWorkPriority = "interactive" | "runtime" | "background";

type RuntimeRecoveryWorkOwnerScope =
  | { kind: "workspace" }
  | { kind: "source"; sourceKind: ExtensionSourceKind; sourceId: string }
  | { kind: "workspace_session"; workspaceSessionId: WorkspaceSessionId }
  | {
      kind: "surface";
      workspaceSessionId: WorkspaceSessionId;
      surfacePiSessionId: SurfacePiSessionId;
    }
  | {
      kind: "thread";
      workspaceSessionId: WorkspaceSessionId;
      threadId: ThreadId;
      surfacePiSessionId: SurfacePiSessionId;
    }
  | { kind: "workflow_run"; workflowRunId: WorkflowRunId; smithersRunId: string }
  | { kind: "queue_item"; queuedItemId: QueueItemId; surfacePiSessionId: SurfacePiSessionId }
  | { kind: "title_job"; titleJobId: TitleJobId };

type SourceReconcileRecoveryPayload = {
  request: SourceReconcileRequest;
  retry:
    | { operation: "record-save"; record: RecordRuntimeSourceSaveInput }
    | { operation: "record-delete"; record: RecordRuntimeSourceDeleteInput };
};

type RecoveryWorkPayloadByKind = {
  queue_delivery: { surfacePiSessionId: SurfacePiSessionId };
  active_turn_recovery: { surfacePiSessionId: SurfacePiSessionId; turnId?: TurnId };
  workflow_task_attempt_recovery: { workflowTaskAttemptId: WorkflowTaskAttemptId };
  source_reconcile: SourceReconcileRecoveryPayload;
  generated_context_refresh: RefreshGeneratedContextRequest;
  generated_package_refresh: Extract<RefreshGeneratedPackagesRequest, { scope: "app-global" }>;
  workspace_generated_package_link_repair: Extract<
    RefreshGeneratedPackagesRequest,
    { scope: "workspace-link-repair" }
  >;
  artifact_materialization: {
    artifactId: ArtifactId;
    sourceCommandId?: CommandId | null;
    operation: "finalize" | "cleanup-staged" | "cleanup-ready";
  };
  title_generation: { titleJobId: TitleJobId };
  request_input_wait: { requestId: RequestInputRequestId };
  approval_wait: { approvalId: RuntimeApprovalId };
  command_process_reconciliation: RuntimeCommandSessionReconcileInput;
};

type RecoveryWorkRecord<K extends RecoveryWorkKind = RecoveryWorkKind> = {
  id: RecoveryWorkId;
  scope: RecoveryWorkScope;
  kind: K;
  status: "pending" | "claimed" | "blocked" | "completed" | "failed" | "cancelled";
  ownerScope: RuntimeRecoveryWorkOwnerScope;
  idempotencyKey: string;
  orderingKey: string;
  priority: RecoveryWorkPriority;
  notBefore: IsoDateTimeString;
  nextAttemptAt: IsoDateTimeString | null;
  attemptCount: NonNegativeSafeInteger;
  maxAttempts: PositiveSafeInteger;
  claimOwnerId: RuntimeOwnerId | null;
  claimedAt: IsoDateTimeString | null;
  claimLeaseExpiresAt: IsoDateTimeString | null;
  leaseVersion: NonNegativeSafeInteger;
  payload: RecoveryWorkPayloadByKind[K];
  lastError: StateStoredError | null;
  cancellationReason: "runtime_shutdown" | "source_deleted" | "superseded" | "user" | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  completedAt: IsoDateTimeString | null;
  failedAt: IsoDateTimeString | null;
  cancelledAt: IsoDateTimeString | null;
};

type EnsureRecoveryWorkInput<K extends RecoveryWorkKind = RecoveryWorkKind> = {
  scope: RecoveryWorkScope;
  kind: K;
  ownerScope: RuntimeRecoveryWorkOwnerScope;
  idempotencyKey: string;
  orderingKey: string;
  priority: RecoveryWorkPriority;
  notBefore: IsoDateTimeString;
  maxAttempts: PositiveSafeInteger;
  payload: RecoveryWorkPayloadByKind[K];
};

`ensureRecoveryWork(...)` dedupes by `(scope, idempotencyKey)` across nonterminal rows except
`claimed` rows. A claimed row represents work already draining; a new ensure with the same logical
key records a pending follow-up row so queue-delivery and other dirty-set style work cannot lose a
wake that arrives during an active drain.

`source_reconcile` work must use `ownerScope: { kind: "source", sourceKind, sourceId }`; source
owner scope is reserved for that recovery kind. The payload is not a bare scan request: it retains
the reconcile request and the exact idempotent state-recording retry that must run after a prior file
mutation succeeded. Recovery workers replay that record first, then perform or request normal
source reconciliation; they do not reconstruct deleted paths, fingerprints, or prior versions.

type ClaimRecoveryWorkInput = {
  scope?: RecoveryWorkScope;
  kinds?: readonly RecoveryWorkKind[];
  ownerId: RuntimeOwnerId;
  now: IsoDateTimeString;
  leaseDurationMs: PositiveSafeInteger;
};

type CompleteRecoveryWorkInput = {
  id: RecoveryWorkId;
  claimOwnerId: RuntimeOwnerId;
  leaseVersion: NonNegativeSafeInteger;
  completedAt: IsoDateTimeString;
};

type FailOrRetryRecoveryWorkInput = {
  id: RecoveryWorkId;
  claimOwnerId: RuntimeOwnerId;
  leaseVersion: NonNegativeSafeInteger;
  failedAt: IsoDateTimeString;
  error: StateStoredError;
  result:
    | { status: "pending"; nextAttemptAt: IsoDateTimeString }
    | { status: "blocked"; nextAttemptAt?: IsoDateTimeString }
    | { status: "failed" };
};

type CancelRecoveryWorkInput = {
  id: RecoveryWorkId;
  claimOwnerId: RuntimeOwnerId;
  leaseVersion: NonNegativeSafeInteger;
  cancelledAt: IsoDateTimeString;
  reason: "runtime_shutdown" | "source_deleted" | "superseded" | "user";
};

type CreateCommandInput = {
workspaceId: WorkspaceId;
workspaceSessionId: WorkspaceSessionId;
target?: RuntimeSurfaceTarget;
turnId?: TurnId;
parentCommandId?: CommandId;
toolCallId?: ToolCallId;
toolName: NativeToolName;
extensionIds: readonly ExtensionId[];
visibility: "trace" | "summary" | "surface";
startedAt: IsoDateTimeString;
acceptedArguments?: JsonValue;
};

type FinishCommandInput = {
commandId: CommandId;
status: "succeeded" | "failed" | "cancelled";
finishedAt: IsoDateTimeString;
summary?: string;
facts?: CommandFactsPayload;
error?: StateStoredError;
};

type AppendCommandEventInput = {
commandId: CommandId;
sequence?: number;
eventId?: CommandEventId;
idempotencyKey?: string;
postTerminalObservation?: boolean;
toolCallId?: ToolCallId;
type:
| "created"
| "argument_snapshot"
| "accepted"
| "started"
| "output"
| "stdin_write"
| "progress"
| "diagnostic"
| "patch_snapshot"
| "child_command"
| "approval"
| "wait"
| "artifact_linked"
| "finished";
payload: CommandEventPayload;
occurredAt: IsoDateTimeString;
};

// These operation groups are internal state-domain sketches. They are not exported
// runtime-facing Effect service tags unless they are explicitly listed in the public API shape above.
// Public mutation ports return StateMutationResult<T>; private repository helpers may return the
// same value shape inline only inside @svvy/state implementation files.

type SettingsStateOperations = {
  readAppPreferences(): Effect.Effect<AppPreferencesRecord, StateContractError>;
  writeAppPreferences(
    input: WriteAppPreferencesInput,
  ): Effect.Effect<StateMutationResult<AppPreferencesRecord>, StateContractError>;
  readAgentProfile(input: ReadAgentProfileInput): Effect.Effect<AgentProfileRecord, StateContractError>;
  writeAgentProfile(
    input: WriteAgentProfileInput,
  ): Effect.Effect<StateMutationResult<AgentProfileRecord>, StateContractError>;
};

type ProviderStateOperations = {
  listStatus(): Effect.Effect<readonly ProviderAuthStatusRecord[], StateContractError>;
  getCredentialSnapshot(
    input: GetProviderCredentialSnapshotInput,
  ): Effect.Effect<ProviderCredentialSnapshot, StateContractError>;
  writeCredentialStatus(
    input: WriteProviderAuthStatusInput,
  ): Effect.Effect<StateMutationResult<ProviderAuthStatusRecord>, StateContractError>;
};

type ExtensionEnvStateOperations = {
  listStatus(
    input: ListExtensionEnvStatusInput,
  ): Effect.Effect<readonly ExtensionEnvStatus[], StateContractError>;
  getInvocationSecretRefs(
    input: GetExtensionInvocationSecretRefsInput,
  ): Effect.Effect<ExtensionInvocationSecretRefs, StateContractError>;
  writeValue(
    input: WriteExtensionEnvValueInput,
  ): Effect.Effect<StateMutationResult<ExtensionEnvStatus>, StateContractError>;
};

type SnippetStateOperations = {
  list(input: ListSnippetsInput): Effect.Effect<readonly SnippetRecord[], StateContractError>;
  writeManagedSnippet(
    input: WriteManagedSnippetInput,
  ): Effect.Effect<StateMutationResult<SnippetRecord>, StateContractError>;
  recordMention(
    input: RecordSnippetMentionInput,
  ): Effect.Effect<SnippetMentionRecord, StateContractError>;
};

````

SQLite JSON columns are package-private storage details. State repositories decode command
arguments, command facts, command event payloads, request-input payloads, app-log payloads,
generated-package facts, and read-model JSON through the owning core/state schemas before returning
through a state port. Public state ports expose `JsonValue`, `CommandFactsPayload`,
`CommandEventPayload`, or narrower product payload types; they do not expose raw JSON strings,
`unknown`, or loose `Record<string, unknown>` objects.

Tool execution is projected through command read models and ordered stream patches. Pi-native
tool-result transcript entries may be retained internally as pi references, but renderer-facing
transcript read models must not expose independent `tool` message rows that duplicate command
spans.

Runtime-facing state ports are exact method groups for the architecture, not examples to
reinterpret as raw table access. Queue claim methods atomically select one eligible row, mark it
dispatching, attach owner/lease facts, and return after-commit invalidations. Eligibility is
`status` in `queued` or `steering`, `nextAttemptAt` absent or due, and no active unexpired claim
lease. Within one `surfacePiSessionId` and `orderingKey`, claim order is:
`steering` rows first by `steerSequence` or `updatedAt`, then `request_user_input_answer` rows FIFO
by `sequence`, then priority `interactive > runtime > background`, then FIFO `sequence`.
`orderingKey` is the durable
serialization key for rows that must not overtake each other on the same surface; ordinary surface
prompt work uses the surface key. State implements this ordering atomically and derives the stored
`orderingKey` at enqueue time from the committed target surface and queue item kind. Runtime owns
the policy that assigns priority, steering facts, retry timing, cancellation, and the typed queue
item kind/payload it asks state to enqueue.
State increments `attemptCount` and `leaseVersion` when a row is claimed. The default
`maxAttempts` for newly enqueued surface rows is `3` unless the caller provides a stricter value.
State never chooses queue, recovery, title, or request-input delivery lease durations from layer
config or product settings. Runtime owns those durations in `RuntimeLayerConfig` and passes the
exact `leaseDurationMs` to the state claim method; state only validates, records, and compares the
lease atomically with the caller-provided `now`.
`releaseExpiredSurfaceMessageClaims(input)` clears expired claim owner and lease fields for the requested
surface or lane without resetting attempt history, so released rows remain claimable until
`attemptCount >= maxAttempts`.
Command finish methods enforce terminal immutability: once a command is `succeeded`, `failed`, or
`cancelled`, later writes may append diagnostics but must not rewrite terminal status, terminal
facts, terminal error, or finished timestamp. Any operation that mutates durable runtime state
returns after-commit invalidation descriptors either directly or through the surrounding
`TransactionPort`.

Queue claiming is one SQLite-compatible atomic mutation inside the state transaction. The target
shape is an `UPDATE ... WHERE id = (SELECT id ... ORDER BY ... LIMIT 1) RETURNING ...`-style claim
or an equivalent single-transaction mutation that cannot select one row and update another under
concurrency. State must not implement claim as a select outside a transaction followed by a separate
update. Runtime may decide claim owner, lease duration, retry timing, priorities, and non-default
max attempts, but the state port enforces deterministic ordering, lease versioning, and attempt
counting atomically.
Runtime starts one drain lane per committed `(surfacePiSessionId, orderingKey)` returned by state.
Ordinary prompt-bearing rows use the state-derived `orderingKey = surface:<surfacePiSessionId>`.
Runtime must not claim across ordering keys unless the owning runtime spec defines a cross-lane
arbitration policy for that queue item kind.

Claim-settling methods that complete or retry a dispatching row require `ownerId` and
`leaseVersion`; rows claimed by another owner or a later lease version fail with a typed
claim-conflict error. `releaseExpiredSurfaceMessageClaims(input)` clears expired claim fields and leaves
rows eligible under the same deterministic ordering without changing payload identity or attempt
history.

Command event rows are append-only. State assigns a monotonic per-command `sequence` when the
caller does not provide one, rejects duplicate `eventId` or `idempotencyKey` for the same command,
and decodes each event payload through the core command-event schema before persistence. Command
terminal guards apply to every command mutation: terminal status, terminal facts, terminal error,
and finished timestamp are immutable; only diagnostic/event appends explicitly marked
post-terminal-observation may be accepted after terminal state.

Recovery claiming follows the same lease discipline as queue claiming. `claimNext` treats expired
claims as eligible inside the same transaction that writes the new owner and `leaseVersion`.
`finish` requires the owner and lease version returned by the claim. If another owner has reclaimed
the row or the lease version changed, state returns a typed recovery-claim conflict and does not
settle the row.

Settings, provider auth, extension env, and snippets are DB/product-state-backed ports. App
preferences, provider readiness, OAuth status, agent profiles, extension usage, managed snippets,
and prompt history are not renderer storage and are not watched as file-backed source.
`ProviderAuthPort` is host/live, not DB/product-state. Usable provider snapshots may carry
operation-scoped `Redacted` credential material; unusable snapshots and `ProviderAuthStatusStatePort`
rows carry only redacted account/status metadata, health, expiry, and issue fields. Product state
stores provider status and secret references/status only; it never exposes raw provider tokens,
refresh tokens, or reusable host secret-store paths in read models or persisted public DTOs. Secret
values are resolved through the host-owned secure secret-store adapter into
`Redacted.Redacted<string>` values at the trusted invocation boundary, are redacted in logs/read
models/events, and are never returned in extension
inventory, generated context, app logs, command facts, transcripts, or desktop bridge payloads. A
provider snapshot must not contain raw environment variable names, provider-specific token payloads,
refresh tokens, or reusable secret-store paths as public state data.
Secret values never appear in state read models. `SecretStorePort` methods return only secret refs,
presence, fingerprints, status records, or `Redacted` invocation values. Provider status writes
invalidate `providerAuth` app read models. Pi session reference writes invalidate the owning
`surface` and `sessionNavigation` read models. Validation failures return the port-specific typed
error and do not delete or rewrite references unless the caller uses the explicit delete method.

Read-model invalidations are returned descriptors from committed writes, not a separate mutable
state API. State may expose pure helper functions that derive `StateInvalidationDescriptor` values
from write results, but runtime and bridge packages publish runtime/app notification events only
after the write transaction commits. A failed transaction publishes no success notification.
Every write method contract lists its success invalidations by descriptor shape. A method may return
`afterCommit: []` only when no app/workspace read model can change. Idempotent duplicate replay
returns the original durable extra output and a duplicate receipt without returning public
invalidation descriptors; it must not republish invalidations. Failed writes return the typed error
and no success invalidations.

Queue claim example:

```json
{
  "input": {
    "surfacePiSessionId": "pi_handler_7",
    "orderingKey": "surface:pi_handler_7",
    "ownerId": "runtime_worker_01",
    "now": "2026-06-18T10:15:00.000Z",
    "leaseDurationMs": 30000
  },
  "result": {
    "row": {
      "id": "queue_17",
      "workspaceId": "wksp_01",
      "workspaceSessionId": "wsess_01",
      "surfacePiSessionId": "pi_handler_7",
      "threadId": "thread_7",
      "kind": "thread_followup",
      "status": "dispatching",
      "priority": "interactive",
      "orderingKey": "surface:pi_handler_7",
      "claimOwnerId": "runtime_worker_01",
      "claimLeaseExpiresAt": "2026-06-18T10:15:30.000Z",
      "payload": {
        "kind": "thread_followup",
        "threadIds": ["thread_7"],
        "message": "Please verify the fix.",
        "sender": "orchestrator"
      }
    },
    "afterCommit": [
      {
        "scope": "workspace",
        "workspaceId": "wksp_01",
        "invalidation": { "model": "surface", "ids": ["pi_handler_7"] }
      }
    ]
  }
}
```

`ExtensionUsageStatePort` owns profile-target resolution, explicit orchestrator/handler/workflow-task
usage overrides, the authoritative network-access preference read used by Runtime admission, and
durable reversible `ExtensionUsageChangeRecord` history. Set and revert are atomic, exact
client-request-idempotent, optionally state-revision CAS guarded, and revert conflicts when the
current explicit value no longer equals the recorded post-change value. Workflow-task overrides are
joined into generated-context profile projections; no extension-source `.svvy/changes` journal or
child-process `AgentProfileMutationStore` is usage authority.

Extension port contract:

```ts
type ExtensionInterfaceKind = "instructions" | "native_tool" | "svvyx" | "mixed";
type ExtensionCategory = "builtin" | "user" | "external_instruction";
type ExtensionUsageState = "loaded" | "available" | "unavailable";

type ExtensionRecord = {
  extensionId: ExtensionId;
  title: string;
  description: string;
  category: ExtensionCategory;
  interfaceKind: ExtensionInterfaceKind;
  source:
    | { kind: "builtin-extension"; editable: boolean; sourceRoot: AbsolutePath }
    | { kind: "user-extension"; sourceRoot: AbsolutePath }
    | { kind: "external-instruction"; path: AbsolutePath; readOnly: true };
  defaultUsage: Partial<Record<ActorKind, ExtensionUsageState>>;
  readiness: {
    status: "ready" | "missing-dependency" | "build-failed" | "disabled" | "unknown";
    diagnostics: readonly string[];
    updatedAt: IsoDateTimeString | null;
  };
  tags: readonly string[];
};

type ListExtensionRecordsInput = {
  actorKind?: ActorKind;
  category?: ExtensionCategory;
  availability?: "available-only" | "all";
};

type GetExtensionRecordInput = {
  extensionId: ExtensionId;
};

type ReadExtensionSourceFingerprintInput = {
  extensionId?: ExtensionId;
  sourceRoot: AbsolutePath;
};

type RecordExtensionSourceFingerprintInput = {
  extensionId: ExtensionId;
  sourceRoot: AbsolutePath;
  fingerprint: SourceFingerprint;
  sourceVersion: SourceVersionId;
  diagnostics: readonly string[];
  recordedAt: IsoDateTimeString;
};

type ExtensionSourceFingerprintRecord = {
  extensionId: ExtensionId;
  sourceRoot: AbsolutePath;
  fingerprint: SourceFingerprint;
  sourceVersion: SourceVersionId;
  diagnostics: readonly string[];
  updatedAt: IsoDateTimeString;
};

type ResolveActorExtensionBindingInput = {
  actorKind: ActorKind;
  profileId?: AgentProfileId;
  target:
    | { kind: "orchestrator"; workspaceSessionId: WorkspaceSessionId }
    | { kind: "handler"; workspaceSessionId: WorkspaceSessionId; threadId: ThreadId }
    | {
        kind: "workflow-task";
        workspaceSessionId: WorkspaceSessionId;
        workflowTaskAttemptId: WorkflowTaskAttemptId;
      };
  overrides?: Readonly<Record<ExtensionId, ExtensionUsageState>>;
};

type ActorExtensionBinding = {
  actorKind: ActorKind;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  unavailableExtensionIds: readonly ExtensionId[];
  instructionOrder: readonly ExtensionId[];
  source: "profile-default" | "surface-binding" | "workflow-agent-source";
};

type UpdateExtensionUsageOverrideInput = {
  actorKind: ActorKind;
  profileId?: AgentProfileId;
  target:
    | { kind: "orchestrator"; workspaceSessionId: WorkspaceSessionId }
    | { kind: "handler"; workspaceSessionId: WorkspaceSessionId; threadId: ThreadId }
    | {
        kind: "workflow-task";
        workspaceSessionId: WorkspaceSessionId;
        workflowTaskAttemptId: WorkflowTaskAttemptId;
      };
  extensionId: ExtensionId;
  usage: ExtensionUsageState;
  updatedAt: IsoDateTimeString;
};

type ResetActorExtensionDefaultsInput = {
  actorKind: ActorKind;
  profileId?: AgentProfileId;
  target?: ResolveActorExtensionBindingInput["target"];
  reset: "selection" | "order" | "selection-and-order";
  updatedAt: IsoDateTimeString;
};

type ExtensionEnvStatus = {
  extensionId: ExtensionId;
  envName: string;
  required: boolean;
  secret: boolean;
  status: "configured" | "missing" | "invalid";
  updatedAt: IsoDateTimeString | null;
};

type ListExtensionEnvStatusInput = {
  extensionId?: ExtensionId;
};

type GetExtensionInvocationEnvInput = {
  extensionId: ExtensionId;
  commandId?: string;
  sourceCommandId: CommandId;
};

type ExtensionExecutionEnvPlan = {
  extensionId: ExtensionId;
  nonSecretValues: Readonly<Record<string, string>>;
  secretRefs: readonly ExtensionEnvSecretRef[];
  redactedLabels: Readonly<Record<string, string>>;
  secretRevisionFingerprint: string;
};

// Non-secret state contract. This never contains plaintext secret values or Redacted wrappers.
// @svvy/extensions combines it with process-local secret access to create
// ExtensionInvocationEnvSnapshot only inside the trusted invocation path.

type ExtensionDependencyApprovalIdentity = {
  kind: "dependency" | "trusted_dependency";
  packageManager: "bun";
  source: "npm";
  name: string;
  version: string;
  integrity: string | null;
  resolution: string | null;
};

type ReadExtensionDependencyApprovalInput = {
  dependency: ExtensionDependencyApprovalIdentity;
};

type ExtensionDependencyReadiness = {
  extensionId: ExtensionId;
  requirementId: string;
  requirementFingerprint: string;
  status: "missing" | "unknown" | "available" | "version-mismatch" | "update-available" | "ready";
  detectedVersion: string | null;
  expectedVersion: string | null;
  diagnostics: readonly string[];
  checkedAt: IsoDateTimeString | null;
};

type ReadExtensionDependencyReadinessInput = {
  extensionId: ExtensionId;
  requirementId: string;
};

type RecordExtensionDependencyReadinessInput = {
  scope: { kind: "app" };
  readiness: ExtensionDependencyReadiness;
  sourceCommandId?: CommandId | null;
  recordedAt: IsoDateTimeString;
};

type RuntimeExtensionStatePortService = {
  reconcileRegistryObservation(
    input: ReconcileExtensionRegistryObservationInput,
  ): Effect.Effect<StateMutationResult<ExtensionRegistryStateRecord>, StateContractError>;
  reconcileBuildEvidence(
    input: ReconcileExtensionSourceBuildEvidenceInput,
  ): Effect.Effect<
    StateMutationResult<ReconcileExtensionSourceBuildEvidenceResult>,
    StateContractError
  >;
  startBuildAttempt(
    input: StartExtensionBuildAttemptInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordBuildSuccess(
    input: RecordExtensionBuildSuccessInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordBuildFailure(
    input: RecordExtensionBuildFailureInput,
  ): Effect.Effect<StateMutationResult<ExtensionBuildAttemptRecord>, StateContractError>;
  recordDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): Effect.Effect<StateMutationResult<ExtensionDependencyReadiness>, StateContractError>;
  reconcileDependencyReadiness(
    input: ReconcileExtensionDependencyReadinessInput,
  ): Effect.Effect<
    StateMutationResult<ReconcileExtensionDependencyReadinessResult>,
    StateContractError
  >;
};

`reconcileRegistryObservation` is one app-global SQLite transaction: changed package observations
replace the singleton authority and env declaration rows, queue cleanup facts for secret refs whose
declarations disappeared or became non-secret, bump state revision once, and return exactly one app
`extensions` invalidation. An identical observation preserves the original `observedAt`, performs no
write, does not bump revision, and returns no invalidation. State never receives secret mutation
authority through this port.

`reconcileDependencyReadiness` validates the batch against the persisted current registry inside the
same SQLite transaction, requires exactly one fact for every required and optional CLI declaration,
stores a canonical `(extensionId, requirementId)` ordering plus the registry aggregate fingerprint,
and deletes facts absent from the new complete batch. The extensions read model exposes the typed
durable batch and joins each registry CLI declaration to a fact only when both registry and
requirement fingerprints match. Missing or stale required facts fail closed; `missing`, `unknown`,
and `version-mismatch` block required declarations, while optional failures do not. `available`,
`ready`, and `update-available` remain usable. Required env blockers are evaluated independently.

type GeneratedPackageFacts = {
  packages: readonly RuntimeGeneratedPackageFactRecord[];
};

type ReadGeneratedPackageLinksNeedingRepairInput = {
  workspaceId?: WorkspaceId;
  packageName?: GeneratedPackageName;
};

type GeneratedPackageWorkspaceLink = RuntimeGeneratedPackageWorkspaceLinkRecord;

type ExtensionStatePortService = {
  records: {
    readSourceFingerprint(
      input: ReadExtensionSourceFingerprintInput,
    ): Effect.Effect<string | null, StateContractError>;
  };
  dependencies: {
    isApproved(
      input: ReadExtensionDependencyApprovalInput,
    ): Effect.Effect<boolean, StateContractError>;
    readReadiness(
      input: ReadExtensionDependencyReadinessInput,
    ): Effect.Effect<ExtensionDependencyReadiness | null, StateContractError>;
  };
};
```

Extension-facing state methods that write DB/product state open or join the correct state-owned
transaction internally and return mutation result wrappers containing committed output plus
`afterCommit`. Extensions never compose arbitrary state transactions. Generated-package fact and
workspace-link writes are not extension-facing operations; they are runtime-owned writes through
`RuntimeGeneratedPackageStatePort`.

Artifact file-store helpers are not part of `@svvy/state`. Runtime owns package-private artifact
file-effect helpers and may implement them with `FileSystem.FileSystem`, `Path.Path`, and
`Crypto.Crypto` provided by the runtime platform layer. State ports never receive raw artifact
content, mutable source paths, temp paths, file handles, directory handles, or host filesystem
capabilities for artifact bytes.

`ExtensionStatePortService` is DB/product-state-backed and is provided through the core-owned
`ExtensionStatePort` tag. It exposes committed source-root fingerprints and dependency
approval/readiness facts for extension validation and build planning. It does not expose extension
inventory, usage policy, env planning, generated-context writes, generated-package fact writes,
workspace-link writes, command writes, recovery writes, or read-model invalidation publication.
Extension inventory and env planning are resolved through the separately named extension services
and state-backed contracts that own those read models. Generated-context writes remain runtime-owned through
`RuntimeActorExtensionBindingStatePort` and `RuntimeExtensionContextImpactStatePort`.
Generated-package fact and workspace-link writes remain runtime-owned through
`RuntimeGeneratedPackageStatePort`.
`records.readSourceFingerprint(...)` reads the currently recorded fingerprint for a source root, and
`dependencies.isApproved(...)` reads committed approval facts for a single exact dependency identity:

```ts
type ExtensionDependencyApprovalIdentity = {
  kind: "dependency" | "trusted_dependency";
  packageManager: "bun";
  source: "npm";
  name: string;
  version: string;
  integrity: string | null;
  resolution: string | null;
};
```

The state ledger key includes every field in that identity. Extension code that has only a generated
dependency declaration normalizes it to `packageManager: "bun"`, `source: "npm"`,
`integrity: null`, and `resolution: null` before calling the port. It does not read or write
generated package files directly.

`RuntimeArtifactStatePort` is the core-owned artifact metadata boundary. `@svvy/state` owns its live
implementation and layer. It commits DB-backed artifact metadata, stored-path facts, digest facts,
byte-count facts, materialization status, deleted lifecycle, command/thread/workflow links, and
read-model indexes. Runtime/command services own final path resolution, temporary staging,
copy/write/rename/stat/delete operations, digest calculation, and recovery for partial file effects.
The port returns metadata records and does not return artifact file contents.
`recordArtifactMetadata` and `markArtifactMetadataDeleted` return
`StateMutationResult<ArtifactMetadataRecord>`.
`inspectArtifact` and `listArtifacts` are read-only and return raw records. Artifact mutation
descriptors target only existing read-model invalidation vocabulary: `sessionNavigation`,
`commandInspector(sourceCommandId)` when present, `handlerThreadInspector(threadId)` when present,
and `workflowTaskAttemptInspector(workflowTaskAttemptId)` when present. The standalone
`artifactInspector` metadata read model is fetched by exact artifact-pane identity and does not add
an invalidation descriptor; existing artifact-link invalidations drive pane discovery and opening.
Implementation-local artifact metadata helpers may exist inside `@svvy/state`, but file-store
helpers do not.
`RuntimeArtifactStatePort` exposes only:

```ts
type RuntimeArtifactStatePort = {
  recordArtifactMetadata(
    input: RecordRuntimeArtifactMetadataInput,
  ): Effect.Effect<StateMutationResult<ArtifactMetadataRecord>, StateContractError>;
  inspectArtifact(
    input: InspectRuntimeArtifactInput,
  ): Effect.Effect<ArtifactMetadataRecord, StateContractError>;
  listArtifacts(
    input: ListRuntimeArtifactsInput,
  ): Effect.Effect<ReadonlyArray<ArtifactMetadataRecord>, StateContractError>;
  markArtifactMetadataDeleted(
    input: MarkRuntimeArtifactMetadataDeletedInput,
  ): Effect.Effect<StateMutationResult<ArtifactMetadataRecord>, StateContractError>;
};

type RecordRuntimeArtifactMetadataInput = {
  workspaceSessionId: WorkspaceSessionId;
  threadId?: ThreadId | null;
  workflowRunId?: WorkflowRunId | null;
  workflowTaskAttemptId?: WorkflowTaskAttemptId | null;
  sourceCommandId: CommandId;
  kind: "text" | "log" | "json" | "file";
  name: string;
  storedPath: AbsolutePath;
  mimeType: string;
  byteSize: NonNegativeSafeInteger;
  sha256: string;
  immutable: boolean;
  materializationStatus: "ready";
};
```

`RecordRuntimeArtifactMetadataInput.workspaceSessionId` is required because every artifact record is
durable product state under one workspace session. `storedPath`, `byteSize`, and `sha256` are
observed facts from runtime-owned materialization after the final artifact bytes exist. The input
never contains inline content, a mutable source path, `copy_file`, temp paths, or open file handles.
Runtime validates the original artifact create request, materializes bytes, computes these facts,
and then commits this metadata record. State validates ownership, id uniqueness, stored-path
namespace, digest format, lifecycle transition, and read-model indexes.

```ts
type InspectRuntimeArtifactInput = {
  workspaceSessionId?: WorkspaceSessionId | null;
  artifactId: ArtifactId;
};

type ListRuntimeArtifactsInput = {
  workspaceSessionId: WorkspaceSessionId;
  threadId?: ThreadId | null;
  limit?: PositiveSafeInteger;
};

type MarkRuntimeArtifactMetadataDeletedInput = {
  workspaceSessionId?: WorkspaceSessionId | null;
  artifactId: ArtifactId;
};

type ArtifactMetadataRecord = {
  artifactId: ArtifactId;
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId | null;
  workflowRunId: WorkflowRunId | null;
  workflowTaskAttemptId: WorkflowTaskAttemptId | null;
  sourceCommandId: CommandId;
  name: string;
  storedPath: AbsolutePath;
  mimeType: string;
  byteSize: NonNegativeSafeInteger;
  sha256: string;
  immutable: boolean;
  materializationStatus: "staging" | "ready" | "delete_pending" | "deleted" | "failed";
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  deletedAt: IsoDateTimeString | null;
  lastRecoveryWorkId: RecoveryWorkId | null;
};
```

Metadata failures are mapped into the shared `StateContractError` vocabulary at the public port:
missing artifacts map to `not-found`, duplicate active artifact names map to `conflict`, invalid
names, stored paths, digests, byte sizes, ownership links, or lifecycle transitions map to
`invalid-input` or `stale-state`, and transaction failures map to `transaction-failed`. Runtime-owned
file-effect failures are runtime command/recovery failures; state does not translate copy, write,
rename, stat, digest, or delete errors.

Artifact commands use a two-phase materialization protocol:

1. Runtime validates the artifact command or execution plan, derives workspace/session ownership,
   resolves the final stored path, and stages new bytes under a runtime-owned temporary path in the
   same artifact root.
2. Runtime writes/copies the bytes, flushes the handle when required by the platform adapter, computes
   byte size and SHA-256 from the staged bytes, and promotes the staged file into its final
   artifact-store path with atomic rename where the host filesystem supports it.
3. Runtime calls `RuntimeArtifactStatePort.recordArtifactMetadata(...)` with only final metadata facts:
   stored path, byte size, digest, MIME type, immutable flag, ownership links, and command linkage.
4. State commits the metadata row and read-model invalidation descriptors in one short SQL
   transaction. Runtime publishes notifications only after that commit.

Artifact metadata shape:

```ts
type ArtifactMetadataRecord = {
  artifactId: ArtifactId;
  workspaceSessionId: WorkspaceSessionId;
  sourceCommandId: CommandId;
  threadId: ThreadId | null;
  workflowRunId: WorkflowRunId | null;
  workflowTaskAttemptId: WorkflowTaskAttemptId | null;
  name: string;
  storedPath: AbsolutePath;
  immutable: boolean;
  mimeType: string;
  byteSize: NonNegativeSafeInteger;
  sha256: string;
  materializationStatus: "ready" | "delete_pending" | "deleted" | "failed";
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  deletedAt: IsoDateTimeString | null;
  lastRecoveryWorkId: RecoveryWorkId | null;
};
```

If promotion or metadata commit fails, runtime records or enqueues `artifact_materialization`
recovery work that can remove an orphan staged file, remove orphan ready bytes without metadata, or
complete metadata for a promoted file whose digest can still be verified. Deletes mark metadata
`delete_pending`, runtime removes bytes, then runtime commits `deleted` or records recovery work when
byte removal fails. SQL transactions never perform file I/O while open.

Staging must happen under the same artifact root/filesystem as the final path. If same-filesystem
atomic rename cannot be guaranteed, runtime must fail before metadata insertion or use an explicit
copy-then-digest-verify path that records `artifact_materialization` recovery before committing
`materializationStatus: "ready"`.

DB/product-state-backed slices include:

- workspace, worktree, layout, session, surface, pi session reference, prompt binding, and generated
  context rows
- message, turn, queue, prompt delivery, retry, lease, and recovery rows
- thread group, handler objective, report, conclusion, episode, request-input, approval, title job,
  and manual title rows
- command, command event, command output, diagnostic, patch snapshot, child command, command fact,
  and app-log rows
- extension availability/readiness record, usage, env status, encrypted secret reference,
  dependency readiness, generated-package fact, generated Workflows export, and generated-package
  workspace-link rows
- Smithers-observed workflow/run/task/node/iteration/attempt bridge facts that product read models
  require
- artifact metadata, immutable marker, deleted marker, source-command/thread/workflow links, and
  read-model indexes

File-backed artifact assets are runtime-owned:

- artifact bytes and immutable artifact files written by runtime artifact materialization services
- temporary staged files used by runtime-owned artifact create/delete/recovery operations

`@svvy/state` stores DB rows for source fingerprints, source versions, diagnostics,
generated-context facts, generated-package facts, generated Workflows export evidence, and
workspace-link facts. It does not own Workflows source, extension source, external instruction
files, generated package files, generated extension build files, workspace
`.smithers/node_modules` links, watcher coordination, Smithers run state, or source invalidation
scheduling.

Source-version rows are compare-and-swap indexes over file-backed source. Source-owning packages
validate and atomically write file-backed source, compute fingerprints/diagnostics, and then call
explicit state-backed source-version or source-fact ports. `@svvy/state` alone writes
source-version rows transactionally. Runtime startup/source-invalidation reconciliation may request
those state writes only after deterministic scans of current file-backed source; it does not edit
source files. A stale source-version save is a typed conflict, not a best-effort overwrite.

The concrete state records for the runtime lifecycle/source ports are:

- `workspace_runtime_owner`, keyed by `(workspace_id, owner_id, owner_kind)`, records scoped
  workspace acquisition owner facts, open reason, acquisition timestamp, and update timestamp. It is
  a durable owner fact ledger, not a live runtime scope or app-global workspace discovery service.
- `surface_lifecycle`, keyed by `surface_pi_session_id`, records the durable session/surface
  lifecycle fact for orchestrator, handler, and workflow-task surfaces: session id, surface kind,
  thread/workflow-task ids when applicable, lifecycle status, open count, open/close timestamps,
  close reason, and update timestamp. It never stores prompt locks, queues, command fibers, watcher
  handles, or live pi handles.
- `pi_session_reference`, keyed by `surface_pi_session_id`, records the persisted adapter reference
  for reopening a pi session: workspace id, workspace session id, surface kind, actor kind, optional
  thread/workflow-task identity, adapter kind, adapter version, storage locator, optional
  pi-native session id, reference fingerprint, adapter-owned metadata JSON, created/updated
  timestamps, last validated timestamp, and optional deleted timestamp. The row stores only opaque
  adapter reopen metadata and validation fields; it never stores pi-native live handles, prompt text,
  transcript text, provider credentials, runtime queues, or command facts. `savePiSessionReference`
  commits the row and returns `surface`/`sessionNavigation` invalidations when the persisted reopen
  state changes. `deletePiSessionReference` marks the row deleted before runtime releases retained
  surface scopes. `@svvy/state` owns only the durable deletion marker and invalidations; physical
  cleanup of adapter-owned bytes, when any exist, is owned by `@svvy/pi-adapter` and recorded by
  runtime recovery/observation after the SQL transaction. `validatePiSessionReference` compares the
  durable row to the requested workspace, surface, actor, adapter kind/version, and reference
  fingerprint before `@svvy/pi-adapter` attempts a reopen.
- `runtime_source_fact`, keyed by `(source_invalidation_scope, source_kind, source_id)`, records
  editable file-backed source path, source version, per-source fingerprint, diagnostics, source
  command lineage, creation/update timestamps, and optional deletion timestamp. Save operations clear
  `deleted_at`; delete operations mark the existing fact deleted and require the expected source
  version when supplied. This table is the editable-source compare-and-swap ledger, not the
  deterministic source-root scan ledger.
- `workflow_agent_source_index`, keyed by plain-string filename-derived `source_id`, records the
  latest validated or invalid app-global workflow-agent observation: path, version, fingerprint,
  diagnostics, parsed task-agent parameters when valid, extension order, observation/commit
  timestamps, and an optional tombstone. It never stores source text. Current read-model rows must
  join an exact non-deleted app-global workflow-agent `runtime_source_fact`; generated workflow
  exports are not an authority or fallback for this index.
- `runtime_source_root_fingerprint_fact`, keyed by the exact `source_root` supplied by runtime with
  committed source-invalidation scope and source-domain metadata, records the current deterministic
  aggregate fingerprint for a source root, root diagnostics, observation timestamp, and commit
  timestamps. Runtime source invalidation computes deterministic source evidence and commits this
  table from the accepted scan batch; `ExtensionStatePort.records.readSourceFingerprint` reads this
  table directly by `sourceRoot`; it never derives a root fingerprint from `runtime_source_fact`,
  generated-package facts, host callbacks, or aggregate scan receipts.
- `runtime_source_scan_fact` records reconciliation receipts: scope, domain, accepted aggregate
  source fingerprint, diagnostics, scan timestamp, and commit timestamps. It does not reuse or
  collide with editable source fact keys and is not the authoritative current source-root
  fingerprint.
- `state_revision`, keyed by singleton id `1`, is the local state revision counter used by current
  lifecycle APIs that must return `StateRevision`. It is a state commit cursor, not an app-wide event
  bus sequence and not a replacement for runtime notification sequencing.

File-backed saves are two-phase but not one DB transaction. `@svvy/extensions` validates and
atomically writes the file; `@svvy/state` then records source version, fingerprint, diagnostics, and
after-commit descriptors in one transaction. If state commit fails after file write,
`@svvy/runtime` schedules source reconciliation recovery and treats the file as source of truth.
State never stores editable source text.

Generated-package fact rows store the generated manifest build id, source fingerprint, output
fingerprint, generated file list digest, dependencies, diagnostics, source-command lineage,
recovery-work lineage, refresh-needed reason, and timestamps. They index generated files owned by
`@svvy/extensions`; they store a digest of the generated file list rather than duplicating the full
generated file list as product state. A failed build records the failed status and diagnostics while
preserving the previous ready build id, manifest path, source fingerprint, output fingerprint, file
list digest, and dependencies so the last ready generated output remains the active evidence.
`generated_workflows_export` is the state-owned renderer projection of the successful Workflows
build evidence. Rows are ordered by `position`, keyed by the Workflows package plus
`qualified_name`, and store the owning `build_id`, exact kind/namespace/export identity, source and
generated paths, generated code, validated agent-parameters JSON, `workflow_agent_id`, and
timestamps. `recordGeneratedPackageBuild(...)` writes the successful `@svvyx/workflows` package
fact and replaces the entire export snapshot in one SQLite transaction; an empty successful
snapshot removes all prior export rows. Any insert or fact-write failure rolls back both sides.
`recordGeneratedPackageFailure(...)`, refresh-needed writes, and manifest reconciliation do not
replace export rows. `WorkflowsGeneratedReadModel.exports` reads only rows whose `build_id` matches
the selected current package fact, so preserved rows cannot be projected under a different build.
These rows are svvy generated-package metadata, not Smithers workflow/run state; Smithers remains
the owner of workflow execution persistence and its Gateway control-plane reads.
Workspace-link fact rows are keyed by `(workspaceId, packageName)` and store link status, link path,
target path, diagnostics, source-command lineage, recovery-work lineage, and timestamps. Link facts
with status other than `linked` or `unchanged` are eligible for
`workspace_generated_package_link_repair` scheduling. These rows are repaired from generated
manifests during runtime reconciliation and never become a second editable source of generated
package truth.
Manifest reconciliation is a decoded-data state operation owned by runtime coordination.
`@svvy/extensions` returns decoded generated-package manifest evidence from the file-backed
generated root to `@svvy/runtime`; runtime then calls
`RuntimeGeneratedPackageStatePort.reconcileGeneratedPackageManifest(...)` with those decoded facts.
`@svvy/state` records facts and invalidations transactionally, but it does not read generated
package files, call extension services, call generated-package builders, or hold SQL transactions
open while generated package file I/O is running. `@svvy/extensions` never calls generated-package
state ports directly.

Every file-backed artifact has a DB/product-state fact that records identity, location, digest or
fingerprint when relevant, lifecycle state, and ownership. File presence alone is never product
state.

Exported selector helpers are pure over their input records and read models. They must not inspect
the filesystem, call `existsSync`, read artifact bytes, open SQLite handles, or perform host probes.
File materialization status enters read models through artifact metadata and recovery observations
written by state ports.
Every exported selector subpath names its input schema, output schema, source row sets/read models,
and invalidation descriptors that require refetch. Selectors are pure functions over provided
records only; they do not inspect filesystem, SQLite, clocks, runtime events, or host globals. The
package root does not export broad selector modules. A selector becomes public only through a named
subpath listed in this spec, with schema-backed inputs/outputs and package-boundary tests proving
the selector has no host, database, clock, runtime-event, or filesystem dependency.

## Resource Lifetimes

State resources are scoped layers:

- SQLite database handle acquisition, migration, pragma setup, and close.
- Consumption of the host-owned `SecretStoreMutationPort` by secret-write command services/facade
  paths;
  app/bootstrap provides that port in the app runtime context and owns acquisition/close when the
  host implementation has a lifecycle.
- Artifact metadata root configuration and committed stored-path fact validation. Runtime owns
  artifact directory creation, byte staging, promotion, deletion, digest calculation, and staged-file
  cleanup through its runtime-owned file-effect services.
  `RuntimeArtifactStatePort` implementations must reject committed artifact metadata whose
  `storedPath` is outside the configured artifact root, outside the owning workspace session's
  artifact directory, or inconsistent with the artifact's mutable/immutable placement rules. Core
  schemas can brand `storedPath` as an absolute path only; containment, session-root matching, and
  immutable-child placement are state implementation checks backed by focused escaped-path,
  wrong-session-root, and mutable/immutable-placement tests.
- No product source watcher lives in `@svvy/state`; runtime owns source watchers. State may only own
  lifecycle for storage adapters such as SQLite.

Provider credentials and extension secrets use a two-store protocol. Extension env secrets are
logically addressed through core-owned `ExtensionEnvSecretTarget` records shaped as
`{ kind: "extension-env", extensionId, envName }`. Every successful write allocates an opaque
`materialId` and returns an immutable physical `ExtensionEnvSecretRef` shaped as
`{ kind: "extension-env", extensionId, envName, materialId }`. The host secret store contains the
encrypted or OS-protected secret material for that exact ref; SQLite contains only the secret ref/status row,
readiness/status facts, declaration identity, non-secret metadata, revision, created/updated
timestamps, and redacted invalidation descriptors. User-entered raw secret values exist only inside
the state command effect until the secret-store write succeeds or fails.
Provider credential and extension env secret command inputs reject missing or empty `secretValue`
values; examples must use non-empty example secret values such as `sk-test-secret`, never `""`, `null`, or an
omitted secret field.

Secret update order is strict:

1. Decode and validate the state command input and ask the host-owned `SecretStoreMutationPort`
   outside the SQLite transaction to write the raw value under a newly allocated immutable material
   ref. Replacement writes supply the prior exact ref/fingerprint for validation but do not remove it.
2. Commit the SQLite reference/status row in one state transaction after the secure-store write
   succeeds, collecting `providerAuth`, `extensions`, `settings`, or app-log invalidations named by
   the command contract.
3. If the SQLite commit fails after the secure-store write succeeded, record or schedule secret
   orphan cleanup by secret ref and report a typed state command failure without exposing the raw
   value.
4. On replacement, write the new secret first, commit the new SQLite reference/revision second, then
   remove the prior secret-store material for the previous ref after commit. If prior material
   removal fails, record cleanup recovery; the newly committed ref remains authoritative.
5. On removal, mark the SQLite reference removed or not-configured in one transaction first, publish
   only the committed invalidations, then remove the secret-store material for the ref. Failed
   material removal is cleanup recovery and must not resurrect the DB reference.

Secret writes are idempotent by command id / client submission key plus declaration identity. A
replayed command returns the committed reference/status result when the SQLite revision already
matches, and never writes the raw secret into logs, app logs, command facts, generated packages,
prompt context, read models, or runtime events. Startup and recovery scan for orphaned
secret-store material and DB refs whose host material is missing, surface redacted app-log facts,
and update only status/readiness rows through committed state transactions.

Host revision fingerprints are opaque facts derived only from immutable material identity; secret
bytes never participate in a persisted or returned fingerprint. Snapshot-secret storage remains a
separate coarse snapshot facility and is not accepted by `SecretStorePort` invocation-resolution
methods.

No state service may hide a process-wide mutable singleton. The app creates state layers once per
runtime graph and disposes them through the owning `ManagedRuntime` / layer scope.

| Resource                                     | Owner package/service                                                                                               | Backing kind            | Lifetime kind    | Acquired by                                                                                                                                                                                                                                                                                                                                                                 | Released by                                                                                                                                                                            | Reused across calls                                                             | Interruption behavior                                                                                                | Required receipts/tests                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| SQLite database handle                       | `@svvy/state` layer                                                                                                 | DB/product-state-backed | `layer-acquired` | `@svvy/state.layer({ config })` provided with decoded state config and the required abstract filesystem/path services under the app runtime layer                                                                                                                                                                                                                           | app `ManagedRuntime.dispose()` closes the layer scope and database handle                                                                                                              | yes, for the app runtime graph                                                  | request interruption cancels the current transaction/effect only; app disposal closes the handle                     | scoped database lifecycle test, transaction rollback test, no handle access after scope close |
| Migration and pragma setup                   | `@svvy/state` layer                                                                                                 | DB/product-state-backed | `layer-acquired` | `@svvy/state layer(input)` before exposing state ports/facades under the app runtime layer                                                                                                                                                                                                                                                                                  | app runtime disposal; migration receipts remain in SQLite                                                                                                                              | yes, setup runs once per acquired layer                                         | interruption before layer acquisition fails startup; interruption after setup does not rerun until reacquire         | migration ordering receipt, pragma verification, startup-failure typed error test             |
| Host secret-store implementation             | app/bootstrap `SecretStorePort` and `SecretStoreMutationPort` layers                                                | host resource           | `layer-acquired` | app layer provides the core-owned `SecretStorePort` for invocation reads and `SecretStoreMutationPort` for state-owned secret writes/removals; `@svvy/state` owns only persisted refs/status rows                                                                                                                                                                           | app runtime disposal closes the host secret-store implementation when it has a lifecycle                                                                                               | yes, while app runtime graph is alive                                           | operation interruption cancels the current secret operation; app disposal closes host implementation when applicable | fake secret-store lifecycle test, redaction/no-raw-secret read-model test                     |
| Artifact durable metadata                    | `@svvy/state` artifact state service                                                                                | DB/product-state-backed | `layer-acquired` | state layer validates configured artifact root settings and committed stored-path facts; runtime supplies byte size, digest, stored path, and lifecycle transition facts through `RuntimeArtifactStatePort`                                                                                                                                                                 | explicit metadata lifecycle transitions; app runtime disposal closes access handles only                                                                                               | yes                                                                             | interruption cancels the current state effect only; committed artifact metadata remains authoritative                | artifact metadata command tests, pure selector no-filesystem test                             |
| State read-model projection rows             | `@svvy/state` projection services                                                                                   | DB/product-state-backed | `layer-acquired` | state command facades inside transactions under the state layer                                                                                                                                                                                                                                                                                                             | explicit state transactions update/delete rows; app disposal closes access handles only                                                                                                | yes                                                                             | interruption before commit leaves prior projection; after commit runtime receives after-commit descriptors           | projection transaction atomicity test, after-commit descriptor receipt test                   |
| State port projection graph                  | `@svvy/state` state-backed port layers, including core `ExtensionUsageStatePort` via `layerExtensionUsageStatePort` | DB/product-state-backed | `layer-acquired` | zero-argument `layerRuntime*StatePort`, `layerExtensionStatePort`, `layerExtensionSnapshotStatePort`, `layerExtensionSnapshotSettingsStatePort`, `layerExtensionUsageStatePort`, `layerSandboxPolicySource`, `layerProviderAuthStatusStatePort`, `layerPiSessionReferencePort`, and `layerAppLogWritePort` layers all provided with the same `StructuredSessionState` layer | app `ManagedRuntime.dispose()` or test layer scope closes the shared state handle                                                                                                      | yes, every projected port shares one acquired `StructuredSessionState` provider | interruption cancels the current port effect only; the acquired state graph remains live until layer scope shutdown  | state projection identity test proves multiple ports share one acquired state layer           |
| Pi session reference state port              | `@svvy/state` pi reference port                                                                                     | DB/product-state-backed | `layer-acquired` | `layerPiSessionReferencePort` provided with the same `StructuredSessionState` layer                                                                                                                                                                                                                                                                                         | explicit `deletePiSessionReference` marks the row deleted; adapter-owned byte cleanup is `@svvy/pi-adapter` work observed by runtime recovery; app disposal closes access handles only | yes                                                                             | interruption cancels the current port effect only; committed opaque reopen references remain authoritative           | pi session reference state-port test, adapter-validation mismatch test                        |
| Runtime prompt defaults state port           | `@svvy/state` prompt defaults port                                                                                  | DB/product-state-backed | `layer-acquired` | `layerRuntimePromptDefaultsStatePort` provided with the same `StructuredSessionState` layer                                                                                                                                                                                                                                                                                 | explicit surface/thread/profile state writes update durable defaults; app disposal closes access handles only                                                                          | yes                                                                             | interruption cancels the current read effect only; committed surface/thread defaults remain authoritative            | runtime prompt defaults state-port test, state projection identity coverage                   |
| Generated-context preview subject state port | core-owned `GeneratedContextPreviewSubjectStatePort` implemented by `@svvy/state`                                   | DB/product-state-backed | `layer-acquired` | `layerGeneratedContextPreviewSubjectStatePort` provided with the same app-global `StructuredSessionState` authority and workspace router                                                                                                                                                                                                                                    | profile/workflow-agent writes update durable subject facts; app disposal closes access handles only                                                                                    | yes                                                                             | interruption cancels only the current read; no preview state or generated context is persisted                       | configured-profile/workflow-agent reopen, routing, invalid/stale subject tests                |
| Provider auth status rows                    | `@svvy/state` provider auth status port                                                                             | DB/product-state-backed | `layer-acquired` | `layerProviderAuthStatusStatePort` provided with the same `StructuredSessionState` layer                                                                                                                                                                                                                                                                                    | explicit provider status writes update rows; app disposal closes access handles only                                                                                                   | yes                                                                             | interruption before commit leaves prior provider status; after commit runtime receives `providerAuth` invalidations  | provider auth status state-port test, redacted/no-secret status test                          |
| App log rows                                 | `@svvy/state` app-log command port                                                                                  | DB/product-state-backed | `layer-acquired` | runtime/state command facade within owning transaction or recovery observation effect under the state layer                                                                                                                                                                                                                                                                 | retention/clear command or database lifecycle, not runtime event disposal                                                                                                              | yes                                                                             | interruption before commit drops uncommitted log; after commit log is durable                                        | app-log write/read-model test, no runtime-published-only log test                             |

Startup order inside the state layer is deterministic:

1. Receive the app-bootstrap-decoded `StateLayerConfig` and validate path ownership.
2. Create the parent directory for the configured SQLite file through injected
   `FileSystem.FileSystem` / `Path.Path` after validating that the configured absolute path belongs
   to the app-owned state root.
3. Open every SQLite connection through the state-owned adapter.
4. Apply the configured busy timeout to every SQLite connection opened by `@svvy/state` through a
   state-owned helper that accepts only a schema-validated positive safe integer and emits the
   reviewed `PRAGMA busy_timeout = <integer>` statement. Effective-setting verification for WAL,
   foreign keys, busy timeout, and numeric policy is part of state startup and has focused startup
   tests.
5. Run the state migrator.
6. Construct package-private repositories, ports, and read-model services.
7. Expose the state layer, approved facades, and core-owned state-backed port layers to app
   bootstrap. Repositories, SQL clients, migrations, table helpers, and `StateStore` remain
   package-private. Dependent packages receive only the narrow ports or facades they declare, never a
   broad `StateStore` service.

No runtime queue dispatcher, source invalidation coordinator, generated-package service, title
service, or desktop bridge facade starts before this layer has successfully completed startup.

`@svvy/state` owns this setup order with its package-private SQLite repository adapter. Effect SQL
is not part of the state architecture. Production state code must not import
`effect/unstable/sql/*`, `@effect/sql-sqlite-bun`, `@effect/sql-sqlite-node`, `SqlClient`,
`SqlSchema`, `SqlResolver`, upstream Effect SQL migrators, or Effect SQL reactive/streaming helpers.
The package may use direct SQLite implementation modules only inside `@svvy/state` repository,
setup, migration, and test-layer code. No direct SQLite handle, transaction object, repository
object, table helper, migration helper, or row store crosses the public state package boundary.
Direct `bun:sqlite` imports are allowed only in package-private state SQLite adapter, setup,
migration, repository modules that this spec assigns to the SQLite persistence edge, and their
driver-integration tests. State-port, facade, read-model, and domain modules depend on the
state-owned adapter/repository boundary, not `bun:sqlite` directly, unless this spec names the exact
file as SQLite adapter code.

The root layer acquires the structured-session store and app-log store once per state scope, using
the configured database path and busy timeout. The state layer owns SQLite adapter acquisition and
startup verification; public consumers never receive SQLite handles or adapter objects.

Repository code stores and decodes sequence, cursor, lease, count, and ordering values deliberately.
Values that can exceed JavaScript's safe integer range are stored and decoded as text or `bigint`.
Values decoded as numbers are schema-bound to the safe integer range at the SQL boundary. This
numeric policy is part of the repository contract and is tested at the persistence boundary.

State migrations use contiguous numeric ids with immutable names and bodies after merge. Migration
entries are owned by `@svvy/state` and loaded through a state-owned manifest. `@svvy/state`
validates migration loader shape before running migrations: ids are contiguous from 1, ids are not
duplicated, and every loader entry has state-owned metadata with `migration_id`, `name`,
`body_sha256`, and `applied_at` semantics. `body_sha256` is computed from canonical migration source
bytes or a generated state-owned manifest, not from function source, runtime objects, or bundler
output.

Before running pending migrations, `@svvy/state` reads the state-owned migration table and checksum
metadata. A missing migration table means a fresh database only when no svvy-owned product tables
exist. If svvy-owned product tables exist without the state-owned migration table, startup
classifies the database as `untracked-schema` and fails before repositories are exposed. Startup
fails when an applied id is absent from the current loader, an applied name differs from the current
loader name, an applied body hash differs from the recorded hash, the current loader has a gap, or
the database contains an applied id outside the current loader.

`@svvy/state` records checksum metadata atomically with each migration through one canonical table:

```sql
CREATE TABLE svvy_schema_migration_checksums (
  migration_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

Startup validates the current loader head and checksum table before exposing ports. If pending
loader ids remain after the migration runner, or migration rows exist without checksum rows, state
classifies startup as migration-locked/incomplete and retries or fails according to the state
startup policy before exposing ports. SQLite database lock errors fail startup unless the state
startup policy has explicitly classified and retried them. State startup maps SQLite, schema, and
migration-body failures into the root-layer startup error contract before exposing any state
services.
State startup uses numbered immutable migrations only.
`CREATE TABLE IF NOT EXISTS`,
`ensureColumn`, and ad hoc backfills are allowed only inside migration bodies. There are no down
migrations, runtime schema probes, runtime table creation, alternate schema branches, or dynamic
`ALTER TABLE` paths outside numbered migrations. Schema-required seed/default product rows are
inserted by explicit numbered migrations. Startup reconciliation may upsert only deterministic
product facts derived from current config, packaged defaults, or file-backed source scans through
named state ports, with after-commit descriptors and tests. It must not create tables, alter
schemas, compensate for missing migrations, or hide migration failures. Test seed helpers are
test-only exports. Migration failures fail the state layer and prevent the app runtime graph from
exposing runtime or desktop facades.

`@svvy/state` exposes no public SQLite backup, export, checkpoint, vacuum, load-extension, or
maintenance surface. Any maintenance surface must be state-owned, adapter-aware, scoped, and exposed
through typed state service methods rather than raw SQLite clients, database objects, connections,
backup/export handles, or adapter-specific handles.

## Transactions

State owns transaction execution. Runtime effect-application services and state command facades ask
for atomic state changes only through narrow core-owned state port methods that name the product
operation. State-internal repositories implement those methods through package-private transaction
services. Runtime never receives `TransactionPort`, `CurrentTransaction`, `TransactionContext`,
repository handles, broad store services, SQL clients, or SQLite handles. Extensions never receive
transaction ports, `CurrentTransaction`, `TransactionContext`, repository handles, SQL clients, or
state-local service tags. If an extension
workflow needs to affect product state, it returns schema-backed facts, source evidence, generated
file evidence, or ordered `ExtensionRuntimeOperation` items wrapping closed `RuntimeEffectRequest`
values for runtime to process; runtime then applies the committed state change through explicit
runtime/state ports.

`StateTransaction` is package-private. Repository/domain write services enter writes through
`StateTransaction.run(operation, effect)`. Nested calls join the current transaction unless a
state-internal savepoint is explicitly named. A named local rollback section may use
state-owned savepoint helper only inside the active SQL transaction, where the SQLite adapter
implements the nested call with `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` rather than an independent
SQLite transaction. No public export may expose `StateTransaction`, `Database`,
`StructuredSessionStateStore`, repositories, or transaction helpers.

`TransactionPort` is always package-private state implementation. If runtime needs an atomic
multi-domain write, `@svvy/core` names a domain-specific state port method for that product
operation, and the `@svvy/state` implementation uses package-private transaction services
internally. `CurrentTransaction` and `TransactionContext` are state-internal implementation details
and are not exported from the `@svvy/state` root.

Required transaction surface:

```ts
class CurrentTransaction extends Context.Service<CurrentTransaction, TransactionContext>()(
  "@svvy/state/CurrentTransaction",
) {}

type TransactionPort = {
  run<R, E, A>(
    name: string,
    body: (tx: TransactionContext) => Effect.Effect<A, E, R>,
  ): Effect.Effect<TransactionResult<A>, E | StateContractError, R>;
};

type TransactionResult<A> = {
  value: A;
  afterCommit: readonly StateInvalidationDescriptor[];
};

type TransactionContext = {
  queues: QueueTransactionPort;
  commands: CommandTransactionPort;
  threads: ThreadTransactionPort;
  requests: RequestInputTransactionPort;
  extensions: ExtensionTransactionPort;
  settings: SettingsTransactionPort;
  providers: ProviderTransactionPort;
  piReferences: PiSessionReferenceTransactionPort;
  generatedPackages: GeneratedPackageTransactionPort;
  logs: AppLogTransactionPort;
  artifacts: ArtifactTransactionPort;
  recovery: RecoveryTransactionPort;
};
```

`CurrentTransaction` is package-private. It must not be exported from the `@svvy/state` root or any
public subpath.

Only outermost committed product transactions return publication-ready invalidations. Nested state
calls append to the active collector and cannot publish independently.

Rules:

- One product event that mutates multiple tables runs in one transaction.
- All state write methods that produce invalidations return those invalidation descriptors only after
  the SQLite transaction commits. `@svvy/runtime` publishes runtime notifications from the
  after-commit descriptors; `@svvy/state` does not publish runtime events.
- `TransactionPort.run(...)` provides the active transaction context to the callback and also makes
  `CurrentTransaction` available to lower-level state helpers for the duration of that callback.
  State-internal repository/domain helpers do not place `TransactionContext` in any public Effect
  requirement channel.
- Nested product transaction requests reuse the active `CurrentTransaction` context by default so
  state ports do not accidentally create nested product event boundaries. State-internal repository
  code may use the SQL client's savepoint semantics only inside that active product transaction and
  only when a local rollback section is required. Nested product transactions do not open
  independent SQLite transactions, and after-commit invalidations are emitted only by the outermost
  product transaction.
- Nested `TransactionPort.run(...)` calls append invalidations to the active outer transaction
  collector. Only the outermost committed transaction returns publication-ready `afterCommit`
  descriptors. Rollback discards the collector.
- Transaction bodies are short SQL-critical sections. They do not perform file I/O, subprocess
  execution, pi calls, network calls, user prompts, secret-entry UI, source watching, generated
  package builds, notification publishing, or other long-running work while holding the SQL
  transaction. Runtime/extensions collect inputs before entering the transaction and publish
  notifications only after commit.
- Queue claims are serialized by durable queue indexes, claim ordering columns, and transaction
  boundaries.
- Command terminal facts, terminal status, terminal error, and finished timestamp are written
  atomically.
- Transaction methods return committed results plus after-commit invalidation descriptors.
  Runtime or bridge packages publish runtime/app notifications only after the state transaction
  commits. A failed transaction publishes no success notification.
- Read models observe committed state only.
- Transaction names are included in Effect spans/log annotations.

The state repository architecture uses direct package-private SQLite repositories wrapped in
Effect services and layers. SQLite remains the canonical store; browser IndexedDB, renderer stores,
Effect `Ref`, Effect `Queue`, Effect `PubSub`, and file watchers are never substitutes for
authoritative product state.

Repository rules:

- Use prepared statements or parameterized repository helpers for ordinary DML values. Dynamic
  identifiers are allowed only through whitelisted repository helpers for known table and column
  names.
- Raw SQL text is allowed only inside state repository, setup, and migration modules. It is not a
  general escape hatch for caller-controlled values or identifiers.
- Repository methods that accept input use hoisted request schemas and hoisted row/result schemas at
  the SQL boundary. They decode requests before building SQL, decode rows before returning them,
  map schema failures into `StateContractError`, and name any direct-row exception in a focused
  repository test.
- Map SQLite, schema, missing-row, lock, and adapter errors into `StateContractError` or a narrower
  state-local tagged error before crossing state ports.
- SQLite columns stay `snake_case`; repository/domain schemas and public read-model contracts stay
  `camelCase`. Raw selected columns must be explicitly aliased to the camelCase result schema field
  names unless the query is built through transformed identifier helpers that produce the expected
  row keys.
- Public ids remain strings. Sequence, cursor, ordering, and lease values decoded as JavaScript
  numbers stay within safe integer range and are schema-checked. Potentially 64-bit values are
  stored and decoded deliberately as text or `bigint`.
- Product read models do not depend on SQL streaming or reactive SQL handles. State returns
  after-commit invalidation descriptors from committed writes and read models are refetched through
  state ports.
- `RequestResolver` is not used for state repositories, queue claims, read models, transaction
  ports, source invalidation, or runtime event fanout. State uses direct repository methods inside
  explicit transaction ports so batching does not hide product ordering or transaction boundaries.

## State Rules

- Store authoritative facts, not UI guesses.
- Command facts are the source of truth for tool outcomes.
- Episodes are the source of truth for handler updates and conclusions.
- Logs are evidence and observability, not replacement command/session state.
- Secret values are stored only through secure storage ports and never returned through read models.
- Domain invariants are enforced by runtime/extension modules before state mutation when possible.
- State writes for one product event must be transactional.
- Queues are persisted transactionally in state. Runtime decides retry policy, recovery behavior, and
  the priority/ordering inputs that state uses for the deterministic claim order; state enforces the
  actual claim ordering atomically.
- Worktree state is first-class: surfaces, handler threads, Shell/Smithers command cwd, defaults,
  and UI read models must be able to resolve the intended worktree explicitly.
- Artifact files are durable file-backed product facts with DB-backed metadata. Runtime owns byte
  materialization, deletion, and recovery; state owns artifact metadata, lifecycle indexes, and the
  implementation/layer for the core-owned `RuntimeArtifactStatePort`; sandbox enforces
  immutable/generated boundaries; extensions only create validated handler results, command facts,
  and `ExtensionRuntimeOperation` items wrapping `RuntimeEffectRequest` values or immutable
  execution plans for runtime to apply.
- Runtime events are not persisted state. They are notifications derived from runtime actions and
  state mutations. Recovery uses persisted facts, not event-stream replay.
- Read models are selectors over authoritative facts. State stores persisted workspace tab order,
  selected layout id, Dockview layout JSON, panel-to-surface bindings, and panel-local restore
  metadata needed for restart restore. Renderer-only transient state such as active focus
  affordances, drag state, open menus, temporary selections, and unsaved visual preferences stays
  outside structured session state.
- State code uses Effect `DateTime`/`Clock` for persisted timestamps and testable time. It does not
  use `Date.now()`, `new Date()`, `DateTime.nowUnsafe()`, `clock.currentTimeMillisUnsafe()`, or
  `clock.currentTimeNanosUnsafe()` in Effect programs.
- Persisted JSON, row payloads, read-model payloads, app/RPC payloads, command facts, generated
  package metadata, app logs, and migration envelope payloads are decoded before use and encoded
  before persistence or RPC emission through hoisted `@svvy/core` or state-local Effect Schema
  decoders/encoders.
- Decode and encode calls at persistence/RPC boundaries use explicit parse options from the core
  boundary policy for parser behavior: error collection, excess-property handling, property order,
  checks, and concurrency. Exact optionality, redaction, defaults, and transforms are schema-level
  policy, such as `Schema.optionalKey(...)` for absent-only optional fields and
  `Schema.Redacted(...)` / `Schema.RedactedFromValue(...)` fail-closed settings for secret-bearing
  values. Stored rows, read models, app bridge payloads, command facts, app logs,
  generated-package metadata, and schema-versioned payload envelopes test both the shared parse
  options and the schema-level optionality/redaction/transform behavior instead of relying on Effect
  defaults.
- All public state DTOs, state port inputs/results, read models, facade request/result schemas,
  persisted JSON payload schemas, command facts, app logs, and schema-versioned payload schemas use
  `Schema.optionalKey(...)` for absent-only optional object fields. `Schema.optional(...)` inside a
  public `Schema.Struct({ ... })` field is allowed only when `undefined` is intentionally part of the
  encoded and decoded contract, and that exception has focused decode/encode tests.
- Static row schemas and manifest-adopted compiled schema functions are hoisted at module scope,
  including `Schema.decodeUnknownEffect`, `Schema.decodeUnknownExit`,
  `Schema.decodeUnknownSync`, `Schema.encodeEffect`, `Schema.encodeExit`, and
  `Schema.encodeUnknownSync`. Other schema compiler helpers such as `Schema.is`,
  `Schema.decodeEffect`, `Schema.decodeExit`, `Schema.encodeUnknownEffect`, and
  `Schema.encodeUnknownExit` are not adopted production helpers unless exact manifest rows and focused
  tests exist.
  Effect v4 `Schema.asserts(schema, input)` is a direct assertion call, not a reusable guard
  compiler. State boundary code therefore uses hoisted manifest-adopted decoders, encoders, or
  package-owned wrapper helpers whose compiler calls happen at module scope. Direct inline
  assertion calls are allowed only in named dynamic schema factory files where the schema cannot be
  known at module scope.
- Decode and encode failures map to typed state boundary errors with operation context and a stable
  schema issue summary.
- State tests prove repositories do not expose raw SQLite handles, transactions, SQL streams, or
  reactive SQL handles across public state ports.
- State package tests may use package-local test helpers and the SQLite-backed
  `@svvy/state/structured-session-state` entrypoint. Runtime, extensions, pi-adapter, sandbox, and
  desktop package tests use fake core-owned ports or their own package-local harnesses. App/bootstrap
  integration tests may compose concrete state layers through the approved integration fixture path.
  SQL behavior, migrations, queue claims, recovery leases, reopen behavior, locking behavior, and
  source-version compare-and-swap must use temp-file SQLite layers, not in-memory fakes. In-memory
  real SQLite adapters are allowed only for narrow numeric decode/encode tests that do not assert
  persistence, locking, reopen, migration, queue, or recovery behavior.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on Effect v4.
- May depend on package-private SQLite code, metadata validation helpers, and core-owned state-port
  contracts.
- Does not own live secure-secret-store adapters. State persists encrypted secret references and
  status rows; live secret resolution happens through host-owned `SecretStorePort` boundaries at
  trusted invocation edges.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/pi-adapter`, `@svvy/sandbox`,
  `@svvy/desktop`, Svelte, or Electrobun.

## Product Source Ownership

Target package paths:

- `packages/state/src/**`
- state-local migrations and schema modules
- state-local SQLite adapters and metadata validation helpers, plus state logic that consumes the
  host-owned `SecretStorePort` for persisted secret refs/status rows
- explicit public pure selector subpaths named by this spec and package-boundary tests, such as
  `packages/state/src/session-navigation.ts`
- explicit public bootstrap/maintenance subpaths named by this spec and package-boundary tests, such
  as `packages/state/src/structured-session-adapters.ts` and
  `packages/state/src/structured-session-projections.ts` and
  `packages/state/src/generated-package-maintenance.ts`
- restricted public structured-session bootstrap/test wiring modules named by this spec, such as
  `packages/state/src/structured-session-state.ts`
- package-private structured-session storage modules and selector implementation modules such as
  `packages/state/src/structured-session-selectors.ts`
- state facade and port modules exported through package-boundary tests

## Acceptance Criteria

- `@svvy/state` is the only package that owns SQLite-backed product state, state transactions,
  migrations, durable queue persistence, secrets metadata, and committed read-model projections.
- State ports expose domain operations and typed read models, not raw table handles or generic SQL
  escape hatches.
- `@svvy/state` keeps test helpers package-local unless an explicit package export map and
  package-boundary test names a public testing subpath. Runtime, extensions, pi-adapter, sandbox,
  and desktop tests use fake core-owned ports or their own package-local harnesses; app/bootstrap
  integration tests may compose concrete state layers through the approved integration fixture path.
  Persistence, migrations, SQL constraints, transaction rollback, queue claims, reopen behavior,
  locking behavior, source-version compare-and-swap behavior, recovery leases, and read-model
  projections are tested with temp-file SQLite layers. Fake or in-memory state layers are only
  port-contract doubles for dependent package unit tests that are not validating SQL-backed
  behavior.
- Every state write that can affect runtime/UI observation is transactional and returns
  publication-ready invalidation descriptors only after commit. `@svvy/runtime` turns those
  descriptors into runtime notifications; `@svvy/state` does not publish notifications itself.
- Recovery uses persisted state facts and queue rows, not runtime event-stream replay.
- State code never executes commands, calls pi, renders UI, owns runtime scheduling, or decides tool
  retry/approval policy.

## Tests

- Transactional write tests.
- `@effect/vitest` service/layer tests for state services, state ports, schemas, and package-local
  fake layers that do not import Bun-only SQLite modules.
- Bun-lane Effect tests for SQLite-backed state modules while the active persistence adapter imports
  `bun:sqlite` directly. Tests that import `bun:sqlite`, `packages/state/src/app-log-store.ts`, or
  package-private structured-session storage through source paths or the explicitly allowlisted
  `@svvy/state/structured-session-state` subpath use `bun:test` plus the state-local
  `runTestEffect` helper instead of `@effect/vitest`. Production use of that subpath is restricted
  to the app-bootstrap structured-session state composition edge. These tests still test
  Effect-returning state APIs and must not create `ManagedRuntime` manually.
- Test coverage for concrete temp-file SQLite state layers, package-local state-port fake layers,
  fake secret stores, and `TestClock`. Tests do not create `ManagedRuntime` manually except the
  named state facade test harness that proves the JavaScript facade edge over an explicitly supplied
  test `ManagedRuntime`. That harness is not production app/bootstrap behavior, must be
  package-boundary allowlisted by exact file path, and must not introduce package-level,
  facade-owned, per-request, workspace-level, or surface-level runtime creation. Real SQLite layers
  prove SQL behavior, migrations, transactions, constraints, queue claiming, and read-model
  selectors. Fake/in-memory layers are only for consumers of state ports when the test is not
  validating SQL behavior.
- Scoped database lifecycle tests.
- Queue persistence and query-order tests.
- Runtime-facing queue recovery read tests.
- Transaction commit/after-commit-notification-order tests.
- Transaction rollback tests proving no runtime event notification is emitted for failed writes.
- Worktree context selector tests.
- Artifact metadata lifecycle and runtime-supplied byte/digest fact tests.
- Selector snapshot tests.
- Command inspector read-model tests for stdin mode, `canAttemptWrite`, accepted stdin receipt
  ordering, malformed receipt rejection, and terminal/non-running projection.
- Secret non-exposure tests.
- State migration tests.
- Reopen persistence tests using the same temp-file SQLite database for queue rows, command facts,
  command output, request-input rows, app logs, pi session references, generated-package facts,
  source-version facts, recovery leases, and read-model projections.
- TestClock-based lease/retry timestamp tests.
- Concurrent queue claim conflict tests.
- Recovery claim conflict tests.
- Terminal command immutability tests.
- Post-terminal observation gating tests for `AppendCommandEventInput.postTerminalObservation`.
- Artifact metadata lifecycle tests for runtime-supplied staging, promotion, digest, ready, delete,
  and recovery facts.
- Source-version compare-and-swap conflict tests.
- Generated-package fact repair tests.
- Service-tag ownership/package-boundary import tests.
- SQLite adapter rule tests reject repository/runtime use of streaming or reactive SQL handles,
  Effect SQL helpers, direct repository transactions outside the state-owned transaction service,
  public SQLite handles, and any SQLite connection import outside package-private repository,
  migration, setup, or driver-integration tests.
- Tests proving state package does not execute commands, call pi, or render UI.
- Workspace-store router dispatch tests proving each runtime-facing state-port method reaches the
  correct app-global or registered per-workspace store by explicit `workspaceId`/scope, app-global
  designation, durable committed-row id, prompt target, committed cwd, or bare-input fan-out; that
  after-commit descriptors carry the committed workspace scope of the owning store; that unresolvable
  targets fail with a typed `StateContractError` (`reason: "not-found"`); and that the router
  dispatches through the exact acquired store instance without opening a second connection.
- Routing-identity audit test enumerating every runtime-facing routed state-port method across the
  fifteen ports and classifying each by the routable identity present in its decoded input or a
  durable committed record; the audit is exhaustive over the routed port method set at compile time
  (`Record<keyof Service, …>` exhaustiveness and `keyof` input-field proofs) and complete against the
  constructed router's method set at runtime.
