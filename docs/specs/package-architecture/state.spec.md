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
source-save commits, generated-package refresh commits, extension-state writes, app-log writes, and
recovery transitions. If a product operation needs multiple state domains changed atomically, add a
specific transactional store method for that product operation instead of exposing or reusing a
generic transaction builder.

A mutating state-backed Effect port method is any method that can create, update, delete, claim,
release, normalize, append, record, mark, resolve, default, cancel, clear, ensure by writing, or
persist state. Every such method returns
`Effect.Effect<StateMutationResult<T>, StateContractError>`. Use `T = void` only when no committed
domain value exists. Runtime-facing state ports use write verbs for mutations and `get`, `find`,
`list`, `read`, `inspect`, `has`, or domain-specific read verbs such as `fetch`, `rebaseline`, and
`snapshot` for non-mutating reads. Read-only methods perform no writes and return
`Effect.Effect<T, StateContractError>` or the port-specific read error directly.

All public state-backed port DTOs and read models are schema-backed contracts exported from
`@svvy/core` or explicitly listed extension-owned contracts. Public DTOs do not use interface-only
shapes, raw string ids where a branded id exists, raw `number` durations where a duration brand
exists, or unbranded timestamp strings where `IsoDateTimeString` exists. Package-private
`Structured*` selector outputs may exist inside `@svvy/state` to make SQL projection code readable,
but they are not target package-root or public-subpath APIs and they are not consumed by runtime,
desktop, generated packages, extensions, sandbox, or renderer/shared contracts as public contracts.
Public read-model results are derived from the core-owned schema DTOs only. The only permitted
target package-root exports are the state service/layer factories, approved read facades, approved
command facades, approved state-backed port layers, state-owned public errors, and schema-backed
facade contracts named in this spec. The target package root does not export
`StructuredSessionStateStore`, `StructuredSessionStateStoreInput`, `Structured*` result DTOs, raw
repository helpers, SQLite helpers, table helpers, migration helpers, transaction helpers, or broad
store-construction helpers. Stable pure selector helpers may be public only when this spec names
their subpath, schema-backed input, schema-backed output, owning read model, and boundary tests;
otherwise selectors are package-private implementation code.

## Owns

- App and workspace settings persistence.
- Provider auth status rows and implementations/layers for core-owned provider auth status and
  secret storage ports. Live provider credential snapshots remain outside product state and are
  returned only by the host-backed `ProviderAuthPort`.
- Persisted extension env values, env status records, and encrypted extension secrets.
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
- Artifact metadata, physical artifact file-store persistence, immutable markers,
  source-command/thread/workflow linkage, and deleted state.
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
- Smithers or Workflows extension guidance.
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
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import {
  CommandId,
  ExtensionStatePort,
  PiSessionReferencePort,
  ProviderAuthPort,
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
  RuntimeQueueStatePort,
  RuntimeReadModelStatePort,
  RuntimeRecoveryStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeThreadStatePort,
  RuntimeTurnStatePort,
  SandboxPolicySource,
  AppLogWritePort,
  SecretStorePort,
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

export class StateCommands extends Context.Service<
  StateCommands,
  {
    readonly workspaceChrome: WorkspaceChromeStateCommands;
    readonly workspaceLayout: WorkspaceLayoutStateCommands;
    readonly appPreferences: AppPreferencesStateCommands;
    readonly agentProfiles: AgentProfileStateCommands;
    readonly snippets: SnippetStateCommands;
    readonly providerAuth: ProviderAuthStateCommands;
    readonly extensionEnv: ExtensionEnvStateCommands;
    readonly appLogs: AppLogReadStateCommands;
  }
>()("@svvy/state/StateCommands") {}

export const layer = (input: {
  config: StateLayerConfig;
  secretStore: SecretStoreAdapter;
}): Layer.Layer<
  | StateReadModels
  | StateCommands
  | RuntimeWorkspaceStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimeComposerDraftStatePort
  | RuntimeQueueStatePort
  | RuntimeTurnStatePort
  | RuntimeCommandStatePort
  | RuntimeApprovalStatePort
  | RuntimeActorExtensionBindingStatePort
  | RuntimeEpisodeStatePort
  | RuntimeExtensionStatePort
  | RuntimeThreadStatePort
  | RuntimeRequestStatePort
  | RuntimeSessionWaitStatePort
  | RuntimeSourceStatePort
  | RuntimeExtensionContextImpactStatePort
  | RuntimeGeneratedPackageStatePort
  | RuntimeArtifactStatePort
  | RuntimeRecoveryStatePort
  | RuntimeReadModelStatePort
  | ExtensionStatePort
  | SandboxPolicySource
  | ProviderAuthPort
  | ProviderAuthStatusStatePort
  | PiSessionReferencePort
  | AppLogWritePort
  | SecretStorePort,
  StateLayerError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto
> => makeStateLayer(input);
```

`StateReadModels` and `StateCommands` are narrow state-owned services with explicitly named method
groups. They are allowed public layer outputs because their contracts are finite Effect service
contracts, not an umbrella state store. Their Promise facades are separate adapters over these
Effect services. They do not expose repositories, SQL, transactions, raw snapshots, generic
mutation, queue execution policy, runtime command lifecycle helpers, or file-backed source editing.
The package-architecture table phrase “no public umbrella service export” means no public
`StateStore`, no broad `State` service, and no raw store/service output.

The app/bootstrap host layer provides `FileSystem.FileSystem` and `Path.Path` to `@svvy/state`.
State uses those services for state database parent-directory setup, artifact root resolution,
staging, copy, rename, stat, digest, delete, and temp cleanup. State repository and selector code
still does not receive raw host globals, source-checkout-relative paths, or filesystem access
outside the database setup and artifact file-store ports.

Layer input is host configuration, not product state. Product settings such as provider auth,
extension usage, snippets, prompt history, and artifact metadata are read and written through state
ports after the layer starts.

`layer(input)` constructs the package-private store/repository graph and provides each core-owned
state-backed port service from the same scoped database handle. Callers depend on the narrow port
service they need; they do not call a broad runtime-state bundle or receive shortcuts that bypass
service ownership.

Named state-backed port layer factories are optional public conveniences over the same state layer
identity. When exported, their exact signature is a projection from an already constructed state
layer value:

```ts
type StateLayer = ReturnType<typeof layer>;

export const layerRuntimeQueueStatePort = (
  stateLayer: StateLayer,
): Layer.Layer<RuntimeQueueStatePort, StateLayerError> => projectRuntimeQueueStatePort(stateLayer);
```

The target public named projection factories are exactly:

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
- `layerRuntimeArtifactStatePort`
- `layerRuntimeRecoveryStatePort`
- `layerRuntimeReadModelStatePort`
- `layerRuntimeRequestStatePort`
- `layerRuntimeSessionWaitStatePort`
- `layerRuntimeSourceStatePort`
- `layerRuntimeThreadStatePort`
- `layerExtensionStatePort`
- `layerSandboxPolicySource`
- `layerProviderAuthPort`
- `layerPiSessionReferencePort`
- `layerAppLogWritePort`
- `layerSecretStorePort`

The named factory must not call `layer(input)`, open SQLite, construct secret stores, run
migrations, or rebuild repository graphs. It can only project/adapt services from the same
`StateLayer` layer description. Under the app-owned `ManagedRuntime`, Effect v4 layer memoization
ensures those projections share the same acquired state graph and database handle. If app bootstrap
uses the full `layer(input)` output directly, it does not need the named factories at all. Public
target port layer exports are projection factories of shape
`(stateLayer: StateLayer) => Layer.Layer<Port, StateLayerError>`, or an equivalent owner-named
projection type that carries the same already-constructed state layer identity. Mixing
zero-argument port layers with a separately provided state layer is not a target architecture
pattern because it leaves resource identity ambiguous.

```ts
type StateLayerConfig = {
  databasePath: AbsolutePath;
  artifactRoot: AbsolutePath;
  busyTimeoutMs: PositiveDurationMs;
};

export const StateLayerConfigSchema = Schema.Struct({
  databasePath: AbsolutePath,
  artifactRoot: AbsolutePath,
  busyTimeoutMs: PositiveDurationMsSchema,
});

export const StateLayerConfigFromEnv = Config.schema(StateLayerConfigSchema, "state");
```

App/bootstrap resolves `StateLayerConfigFromEnv` once using the installed `ConfigProvider`; the
state layer receives a fully decoded `StateLayerConfig` and does not also read host config. Tests
pass a resolved config or install `ConfigProvider.fromUnknown(...)` only around app-bootstrap
config tests. State code uses Effect `Clock`/`DateTime` for persisted timestamps, lease
comparisons, OAuth expiry comparisons, and retention cutoff comparisons supplied by explicit state
command or runtime state-port inputs. Request-input timeout defaults,
queue/recovery/title/request-input lease durations, command output batching/retention thresholds,
app-log retention policy, and runtime worker cadences are runtime-owned policy and enter state only
as explicit method inputs when state must persist or compare resulting facts.

`StateLayerConfigFromEnv` reads only explicit `SVVY_STATE_*` keys from the app/bootstrap-installed
`ConfigProvider`. Source/provider failures map to `StateLayerError` reason
`"config-source-failed"`; schema validation failures map to `"config-schema-failed"` with formatted
`BoundaryIssue[]`. Defaults apply only to missing optional values. Explicitly configured invalid
values fail startup before SQLite, secret-store, artifact, migration, repository, or state-port
services are exposed.

`StateLayerError` is the state-owned public bootstrap/layer error exported from `@svvy/state`
because root layer signatures expose it. It uses `Schema.TaggedErrorClass`, includes a closed reason
vocabulary, optional structured boundary issues, and an optional redacted defect cause, and exports
the public codec quartet required by `SVVY-EFFECT-016`:

```ts
export class StateLayerError extends Schema.TaggedErrorClass<StateLayerError>()("StateLayerError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "config-source-failed",
    "config-schema-failed",
    "database-open-failed",
    "sqlite-setup-failed",
    "migration-failed",
    "schema-verification-failed",
    "secret-store-unavailable",
    "shutdown-failed",
  ]),
  message: Schema.String,
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
}) {}

export const StateLayerErrorSchema = StateLayerError;
export const decodeUnknownStateLayerErrorEffect = Schema.decodeUnknownEffect(
  StateLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownStateLayerErrorExit = Schema.decodeUnknownExit(
  StateLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeStateLayerErrorEffect = Schema.encodeEffect(
  StateLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeStateLayerErrorExit = Schema.encodeExit(
  StateLayerErrorSchema,
  strictBoundaryParseOptions,
);
```

Promise read facade for non-Effect consumers:

```ts
const state = createStateFacade(managedRuntime);

const result = await state.readModels.fetch({
  kind: "workspace",
  workspaceId,
});
if (result.kind !== "workspace") {
  throw new Error("Unexpected read model result");
}
const workspace = result.value;

const baseline = await state.readModels.rebaseline({
  workspaceId,
  reason: "renderer-startup",
});
```

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

```ts
type StateReadModelInvalidationRefetchRequest = {
  descriptor: StateInvalidationDescriptor;
};

type StateReadModelRequest =
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "sessionNavigation"; workspaceId: WorkspaceId }
  | { kind: "surface"; target: RuntimeSurfaceTarget }
  | { kind: "surfaceTranscript"; target: RuntimeSurfaceTarget }
  | { kind: "commandInspector"; commandId: CommandId }
  | { kind: "handlerThreadInspector"; threadId: ThreadId }
  | { kind: "workflowTaskAttemptInspector"; workflowTaskAttemptId: WorkflowTaskAttemptId }
  | { kind: "requestInput"; workspaceId?: WorkspaceId; target?: RuntimeSurfaceTarget }
  | { kind: "runtimeApprovals"; workspaceId?: WorkspaceId; target?: RuntimeSurfaceTarget }
  | { kind: "agents"; workspaceId?: WorkspaceId }
  | { kind: "extensions"; workspaceId?: WorkspaceId; actor?: ActorKind }
  | { kind: "settings" }
  | { kind: "providerAuth" }
  | { kind: "appPreferences" }
  | { kind: "snippets"; workspaceId?: WorkspaceId }
  | { kind: "workflowsGenerated"; workspaceId?: WorkspaceId }
  | { kind: "appLogs"; workspaceId?: WorkspaceId; cursor?: AppLogCursor; filter?: AppLogFilter }
  | { kind: "appLogSummary"; workspaceId?: WorkspaceId };

type StateReadModelResult =
  | { kind: "workspace"; value: WorkspaceReadModel }
  | { kind: "sessionNavigation"; value: WorkspaceSessionNavigationReadModel }
  | { kind: "surface"; value: SurfaceReadModel }
  | { kind: "surfaceTranscript"; value: SurfaceTranscriptReadModel }
  | { kind: "commandInspector"; value: CommandInspectorReadModel }
  | { kind: "handlerThreadInspector"; value: HandlerThreadInspectorReadModel }
  | { kind: "workflowTaskAttemptInspector"; value: WorkflowTaskAttemptInspectorReadModel }
  | { kind: "requestInput"; value: RequestInputReadModel }
  | { kind: "runtimeApprovals"; value: RuntimeApprovalsReadModel }
  | { kind: "agents"; value: AgentsReadModel }
  | { kind: "extensions"; value: ExtensionsReadModel }
  | { kind: "settings"; value: SettingsReadModel }
  | { kind: "providerAuth"; value: ProviderAuthReadModel }
  | { kind: "appPreferences"; value: AppPreferencesReadModel }
  | { kind: "snippets"; value: SnippetsReadModel }
  | { kind: "workflowsGenerated"; value: WorkflowsGeneratedReadModel }
  | { kind: "appLogs"; value: AppLogReadModel }
  | { kind: "appLogSummary"; value: AppLogSummary };

type WorkspaceReadModel = {
  workspace: {
    workspaceId: WorkspaceId;
    cwd: AbsolutePath;
    workspaceLabel: string;
    branch: string | null;
    kind: "default" | "user";
  };
  chrome: WorkspaceChromeReadModel;
  layoutSlots: readonly WorkspaceLayoutSlotSummary[];
  capabilities: WorkspaceCapabilitySummary;
  statusCounts: WorkspaceStatusCounts;
};

type AgentsReadModel = {
  profiles: readonly AgentProfileRowReadModel[];
  workflowAgents: readonly WorkflowAgentProfileRowReadModel[];
  modelOptions: readonly ProviderModelOption[];
  extensionUsageRows: readonly AgentExtensionUsageRowReadModel[];
  sourceConflicts: readonly SourceEditConflictSummary[];
};

type ExtensionsReadModel = {
  inventory: readonly ExtensionInventoryRowReadModel[];
  externalInstructions: readonly ExternalInstructionRowReadModel[];
  generatedContextPreviews: readonly GeneratedContextPreviewSummary[];
  dependencyActions: readonly ExtensionDependencyActionSummary[];
  envStatuses: readonly ExtensionEnvStatusSummary[];
  snapshots: readonly ExtensionSnapshotSummary[];
};

type SettingsReadModel = {
  preferences: {
    appearance: "system" | "light" | "dark";
    externalEditor: string | null;
    artifactDirectory: AbsolutePath;
    approvalMode: "auto-review" | "user" | "full-access";
    networkAccess: boolean;
    ambientResources: AmbientAgentResourceSettings;
  };
};

type ProviderAuthReadModel = {
  providers: readonly ProviderAuthStatus[];
  usableModelProviders: readonly ProviderId[];
};

type WorkflowsGeneratedReadModel = {
  packageStatus: GeneratedPackageRefreshStatus | null;
  workspaceLinks: readonly GeneratedPackageWorkspaceLinkStatus[];
  exports: readonly WorkflowsGeneratedExportReadModel[];
  diagnostics: readonly GeneratedPackageDiagnostic[];
};

type WorkflowsGeneratedExportReadModel = {
  kind: "workflow" | "agent" | "prompt" | "component";
  namespace: string;
  exportName: string;
  qualifiedName: string;
  sourcePath: AbsolutePath;
  generatedPath: AbsolutePath;
  uiLinks: readonly (
    | { kind: "generated-file"; path: AbsolutePath }
    | { kind: "source-file"; path: AbsolutePath }
    | { kind: "agents-pane"; agentId: WorkflowAgentId }
  )[];
};

type AppLogReadModel = {
  query: AppLogQuery;
  entries: readonly AppLogEntry[];
  pageInfo: AppLogPageInfo;
  summary: AppLogSummary;
  persistedView: AppLogViewPreferences;
  readState: AppLogReadState;
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

`refetchInvalidation(...)` accepts exactly the `StateInvalidationDescriptor` carried by a
`workspace_read_model.changed` or `app_read_model.changed` runtime event. The caller supplies the
event cursor fields for gap detection and supplies no fabricated event payload, ad hoc scope,
command-specific invalidation, or caller-authored descriptor. Workspace `{ model: "surface",
ids }` descriptors expand into every open surface-scoped read request the caller asks state to
maintain for that surface: surface summary, surface transcript, composer state, queued-message
state, prompt-history state, prompt status, and surface-local chrome. Those slices may have
separate `StateReadModelRequest` kinds for efficient fetching, but they do not have independent
invalidation descriptors. Workspace `{ model: "commandInspector", ids }` descriptors refetch the
`commandInspector` read model; state does not expose a separate live stdout/stderr/progress delta
read model.

Every `StateReadModelRequest.kind` has a matching exported request schema, result schema,
read-model builder, invalidation mapping, and positive/negative contract tests. A new UI pane,
runtime notification, or headless read use case is not promoted until it appears in this union and
has an invalidation descriptor that lets callers refetch it without receiving duplicate read-model
payloads in runtime events.

`WorkspaceReadModel.workspace` is the canonical workspace identity payload for desktop, browser
tools, and headless automation. It includes `workspaceId`, `cwd`, `workspaceLabel`, nullable
`branch`, and `kind: "default" | "user"`. Do not define a separate workspace-info response;
callers consume this field.

`WorkflowsGeneratedReadModel.exports[]` is a product read model for the Workflows pane and source
navigation. `uiLinks` may point at generated files, source files, or Agents-pane rows, but those
links are UI navigation facts only and are not agent-facing API.

`AppLogReadModel` is the Logs-pane read model. It includes the requested query, ordered retained log
entries, pagination/window metadata, summary counts, persisted view preferences, and read-state
metadata. It must not contain canonical session, command, artifact, workflow, generated-package, or
extension state; logs link to those records by id and callers refetch the authoritative read model.

Example fetches:

```ts
const transcript = await state.readModels.fetch({
  kind: "surfaceTranscript",
  target,
});

const agents = await state.readModels.fetch({
  kind: "agents",
  workspaceId,
});
```

`StateFacade.close()` releases only facade-owned callback, `AsyncIterable`, or subscription helper
resources. It does not dispose the app `ManagedRuntime`, state layer, database handle, or package
scope. Layer shutdown is owned by app/bootstrap through `managedRuntime.dispose()`.

State-owned command facade for DB/product-state-backed UI intents:

```ts
const stateCommands = createStateCommandsFacade(managedRuntime, {
  invalidationSink,
});

const result = await stateCommands.appPreferences.update({
  patch: { appearance: "dark", networkAccess: true },
  clientSubmission: {
    clientRequestId: "client_req_01",
    submittedAt: "2026-06-20T12:30:00.000Z",
    source: "desktop",
  },
});
```

`createStateCommandsFacade(managedRuntime, { invalidationSink })` is a separate root export from
`createStateFacade(managedRuntime)`. It exposes only named product commands whose writes are owned
by `@svvy/state` and backed by SQLite/product state. It does not expose generic mutation,
repository, table, transaction, SQL, migration, queue, command-fact, request-input,
generated-package build, source-file edit, sandbox, pi, or extension-handler methods. Every method
validates its input through an Effect Schema contract, executes one state transaction, and returns
only committed output plus a state-issued receipt. Failed transactions return a typed
`StateContractError` and no success receipt.

The `@svvy/state` package root value exports `layer(input)`, `createStateFacade(...)`,
`createStateCommandsFacade(...)`, the Effect service tags `StateReadModels` and `StateCommands`,
and the named state-backed port layer factories allowed by this spec. It also exports the
TypeScript-only facade and command contract names `StateFacade`, `StateFacadeCallOptions`,
`StateCommandsFacade`, `CreateStateCommandsFacadeOptions`, `StateCommandInvalidationSink`, and
`StateCommandResult`, plus `StateLayerError` and its root-layer codec helpers. `StateCommandReceipt`
is a core-owned shared encoded contract exported from `@svvy/core`, then imported and reused by
`@svvy/state`; `@svvy/state` does not redefine it. Those
type exports do not add alternate state surfaces. Facade object/interface shapes may be
TypeScript-only; facade method inputs, results, receipts, and error payloads are not. Every facade
method payload that crosses a package, renderer, desktop bridge, browser-tool, headless automation,
or test harness boundary has a hoisted Effect Schema contract and derives its TypeScript type from
that schema.

State command Promise facades do not return raw `StateInvalidationDescriptor` arrays to renderer,
desktop, browser-tool, or headless callers. State Effect write services return core-owned
`StateInvalidationDescriptor` values in an internal `afterCommit` field. The
`createStateCommandsFacade(managedRuntime, { invalidationSink })` runs the state write through the
caller-owned app `ManagedRuntime`, collects `afterCommit` only after the state transaction commits,
then invokes the injected invalidation sink before resolving the public command result. The sink is
an app/bootstrap-owned narrow callback over the same app runtime context; its implementation may
call the runtime-owned publication service, but `@svvy/state` does not import `@svvy/runtime` and
does not know how publication is implemented. Public command facade result schemas never expose
descriptors, and non-Effect callers never receive raw descriptors. Runtime remains the sole
publisher on the public event stream, performs any runtime-owned refresh, scheduling, queue wakeup,
source work, or recovery work after state commits. If the state transaction commits but the invalidation sink
rejects, the facade returns a typed post-commit notification failure that includes the committed
receipt and requires caller rebaseline. Retrying with the same `clientRequestId` returns
`outcome: "duplicate"` and does not recreate descriptors.
Desktop consumers refetch state-backed read models after notifications.
Renderer panes and desktop UI state-command paths never manually fan out invalidations or call
runtime source-invalidation methods for DB/product-state writes. Browser-tool, headless,
app-bootstrap, test, and recovery callers may use runtime source-invalidation methods only for the
file-backed reconciliation domains named by `runtime.spec.md`.

`afterCommit` is the field name for Effect state-port mutation results returned inside
runtime-owned lanes. `StateCommandsFacade` hides those descriptors and returns only the state command
receipt plus command-specific committed output.

The target command facade shape is:

```ts
type StateCommandsFacade = {
  workspaceChrome: {
    setWorkspaceTabs(
      input: SetWorkspaceTabsCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    selectWorkspaceTab(
      input: SelectWorkspaceTabCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    selectWorkspaceLayoutSlot(
      input: SelectWorkspaceLayoutSlotCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  workspaceLayout: {
    saveSnapshot(
      input: SaveWorkspaceLayoutSnapshotCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    updatePane(
      input: UpdateWorkspacePaneCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    closePane(
      input: CloseWorkspacePaneCommandInput,
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
    upsertCredential(
      input: UpsertProviderCredentialCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    removeCredential(
      input: RemoveProviderCredentialCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    recordProviderStatus(
      input: RecordProviderAuthStatusInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  extensionEnv: {
    setNonSecretOverride(
      input: SetExtensionEnvOverrideCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    removeNonSecretOverride(
      input: RemoveExtensionEnvOverrideCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setSecretValue(
      input: SetExtensionSecretValueCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    removeSecretValue(
      input: RemoveExtensionSecretValueCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
  };
  agentProfiles: {
    updateOrchestratorProfile(
      input: UpdateOrchestratorProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    updateThreadHandlerProfile(
      input: UpdateThreadHandlerProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    deleteOrchestratorProfile(
      input: DeleteOrchestratorProfileCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    reorderOrchestratorProfiles(
      input: ReorderOrchestratorProfilesCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    setProfileExtensionUsage(
      input: SetProfileExtensionUsageCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    promoteProfileExtensionDefault(
      input: PromoteProfileExtensionDefaultCommandInput,
      options?: StateFacadeCallOptions,
    ): Promise<StateCommandResult>;
    resetActorExtensionDefaults(
      input: ResetActorExtensionDefaultsCommandInput,
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
};

import type { StateCommandReceipt } from "@svvy/core";

type StateFacadeCallOptions = {
  signal?: AbortSignal;
};

type StateCommandInvalidationSink = {
  publishCommittedStateInvalidations(input: {
    source: "state-command-facade";
    descriptors: readonly StateInvalidationDescriptor[];
    clientSubmission?: RuntimeClientSubmissionInput;
  }): Promise<void>;
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
The state transaction stores one command receipt keyed by command name, caller/source, target
identity, and `clientRequestId`. A repeated matching submission returns the committed output with
`receipt.outcome: "duplicate"`. Durable extra output fields, such as a
created `snippetId`, match the original committed output. Duplicate replay never returns
publication-ready after-commit descriptors, repeats file effects, repeats SQL writes, inserts new
invalidations, or republishes app/runtime notifications. If the same id is reused with a different
decoded input, the method fails with `StateContractError` code `stale-state` or `invalid-input`
according to the owning command contract. Commands without a client request id are single-shot calls
and receive `clientRequestId: null`.

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

type WorkspaceTabRecordInput = {
  workspaceTabId: WorkspaceTabId;
  workspaceId: WorkspaceId;
  cwd: AbsolutePath;
  openedAt: IsoDateTimeString;
  activeLayoutId: WorkspaceLayoutSlotId;
};

type WorkspaceLayoutSlotId = "A" | "B" | "C";

type SaveWorkspaceLayoutSnapshotCommandInput = {
  workspaceId: WorkspaceId;
  layoutId: WorkspaceLayoutSlotId;
  snapshotJson: JsonObject;
  focusedPaneId?: WorkspacePaneId;
  panelMetadata: readonly WorkspacePaneMetadataInput[];
  clientSubmission?: StateCommandClientSubmission;
};

type UpdateWorkspacePaneCommandInput = {
  workspaceId: WorkspaceId;
  layoutId: WorkspaceLayoutSlotId;
  paneId: WorkspacePaneId;
  patch: WorkspacePanePatch;
  clientSubmission?: StateCommandClientSubmission;
};

type CloseWorkspacePaneCommandInput = {
  workspaceId: WorkspaceId;
  layoutId: WorkspaceLayoutSlotId;
  paneId: WorkspacePaneId;
  clientSubmission?: StateCommandClientSubmission;
};

type WorkspacePaneMetadataInput =
  | {
      paneId: WorkspacePaneId;
      kind: "surface";
      surfacePiSessionId: SurfacePiSessionId;
      threadId?: ThreadId;
      localStateJson?: JsonObject;
    }
  | {
      paneId: WorkspacePaneId;
      kind: "inspector";
      target:
        | { kind: "command"; commandId: CommandId }
        | { kind: "workflow-task-attempt"; workflowTaskAttemptId: WorkflowTaskAttemptId };
      localStateJson?: JsonObject;
    }
  | {
      paneId: WorkspacePaneId;
      kind:
        | "workflows"
        | "app_logs"
        | "agents"
        | "extensions"
        | "snippets"
        | "settings"
        | "open_workspace";
      localStateJson?: JsonObject;
    };

type WorkspacePanePatch = {
  title?: string | null;
  surfacePiSessionId?: SurfacePiSessionId | null;
  threadId?: ThreadId | null;
  workflowTaskAttemptId?: WorkflowTaskAttemptId | null;
  commandId?: CommandId | null;
  localStateJson?: JsonObject | null;
};

type UpdateAppPreferencesPatch = {
  appearance?: "system" | "light" | "dark";
  externalEditor?: string | null;
  artifactDirectory?: AbsolutePath;
  approvalMode?: "auto-review" | "user" | "full-access";
  networkAccess?: boolean;
  ambientResources?: AmbientAgentResourceSettings;
};

type UpdateAppPreferencesCommandInput = {
  patch: UpdateAppPreferencesPatch;
  clientSubmission?: StateCommandClientSubmission;
};

type UpsertProviderCredentialCommandInput = {
  providerId: ProviderId;
  workspaceId?: WorkspaceId;
  credentialKind: "api-key" | "oauth-token";
  secretValue: string;
  redactedAccountLabel?: string;
  expiresAt?: IsoDateTimeString;
  clientSubmission?: StateCommandClientSubmission;
};

type RemoveProviderCredentialCommandInput = {
  providerId: ProviderId;
  workspaceId?: WorkspaceId;
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
  name: string;
  value: string;
  clientSubmission?: StateCommandClientSubmission;
};

type RemoveExtensionEnvOverrideCommandInput = {
  extensionId: ExtensionId;
  name: string;
  clientSubmission?: StateCommandClientSubmission;
};

type SetExtensionSecretValueCommandInput = {
  extensionId: ExtensionId;
  name: string;
  secretValue: string;
  clientSubmission?: StateCommandClientSubmission;
};

type RemoveExtensionSecretValueCommandInput = {
  extensionId: ExtensionId;
  name: string;
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
  workspaceId?: WorkspaceId;
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
  snippetId: SnippetId;
  patch: UpdateManagedSnippetPatch;
  clientSubmission?: StateCommandClientSubmission;
};

type DeleteManagedSnippetCommandInput = {
  snippetId: SnippetId;
  clientSubmission?: StateCommandClientSubmission;
};

type SetSnippetEnabledCommandInput = {
  snippetId: SnippetId;
  enabled: boolean;
  clientSubmission?: StateCommandClientSubmission;
};
```

Snippets using `Redacted.Redacted<T>` assume `import type * as Redacted from "effect/Redacted"`.
Secret-bearing local types stay process-local. Persisted state, RPC contracts, generated package
files, read models, diagnostics, and app logs expose only presence, non-secret labels, key names, or
fingerprints.

Promise/RPC command facades accept raw user-entered `secretValue: string` only at the trusted
user-entry boundary and immediately wrap it into `Redacted.Redacted<string>` before it reaches
Effect-local services, logs, diagnostics, persistence adapters, or generated declarations. Internal
state services may use `Redacted.Redacted<string>` for in-process secret handling; public state
facades must not require callers to construct Effect `Redacted` values.

Public command patch contracts are named schemas, not `Partial<...>` aliases. Patch schema fields
use `Schema.optionalKey(...)` so omitted means “leave unchanged” and `undefined` is not accepted as
a value. Explicit `null` is used only where clearing a nullable field is a product operation.

Every command input and command result type above has a matching exported schema named
`<TypeName>Schema` from `@svvy/state`, plus decoded and encoded types,
`decodeUnknown<TypeName>Effect`, `decodeUnknown<TypeName>Exit`, `encode<TypeName>Effect`, and,
where bridge adapters need non-throwing outbound mapping, `encodeUnknown<TypeName>Exit`.
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

| Facade group      | Use case                                                                                                                                                                                                                                                                                  | Product-state owner                                               | Not allowed in this group                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `workspaceChrome` | Persist app-global workspace tab order, active tab, known workspace tab records, selected slot.                                                                                                                                                                                           | `@svvy/state` workspace chrome tables                             | Acquiring a workspace runtime, opening a repository picker, closing a runtime, pi session lifecycle, file watching.        |
| `workspaceLayout` | Persist slot-scoped Dockview snapshot, svvy panel metadata, pane binding, focused pane.                                                                                                                                                                                                   | `@svvy/state` workspace layout tables                             | Rendering Dockview, owning Svelte pane state, creating prompt turns, mutating pi sessions.                                 |
| `appPreferences`  | Persist appearance, external editor, artifact directory, approval mode, network access, ambient resource settings.                                                                                                                                                                        | `@svvy/state` settings tables                                     | Provider OAuth flows, secret entry UI, sandbox launch execution, prompt rebuilding.                                        |
| `providerAuth`    | Persist provider credential presence, provider auth status, and OAuth result/status facts through state-owned provider auth and secret ports.                                                                                                                                             | `@svvy/state` provider auth tables and secret references          | Live OAuth browser/device flow, model probing, pi provider calls, returning raw secrets.                                   |
| `extensionEnv`    | Persist app-global non-secret extension env overrides, secret references, and env status facts used by readiness and invocation env resolution.                                                                                                                                           | `@svvy/state` extension env tables and secret references          | Running extension commands, exposing raw secrets, editing extension source manifests, generated package refresh execution. |
| `agentProfiles`   | Persist orchestrator profile rows, singleton handler profile, orchestrator/handler extension usage, DB-backed external-instruction actor usage/order, and workflow-task actor defaults for newly created workflow task-agent attempts that are not tied to one `.agent.json` source file. | `@svvy/state` agent/profile and external-instruction usage tables | Workflow-agent `.agent.json` row edits, extension source edits, generated actor-context rendering.                         |
| `snippets`        | Persist managed svvy snippets and enablement state for managed/discovered snippets.                                                                                                                                                                                                       | `@svvy/state` snippet tables                                      | Editing read-only host snippet files, watching snippet source roots, expanding snippets into prompt text during send.      |
| `appLogs`         | Persist app-log read cursors, visible-range read marking, and workspace/app unread clearing.                                                                                                                                                                                              | `@svvy/state` app-log read-state tables                           | Deleting log rows, rewriting payloads, publishing live bridge messages directly, or inferring command/session state.       |

File-backed source commands are excluded by construction. Workflow-agent `.agent.json` edits,
including that workflow agent's provider, model, reasoning, instruction text, extension usage
overrides, and source-order metadata, go through the runtime source-edit service over a
`WorkflowAgentSourceRef` and `@svvy/extensions` source services. Workflows prompt/component/workflow
edits, normal extension source edits, and extension generated contributor source edits use that same
runtime/source-edit boundary. External instruction records are read-only discovered inputs:
runtime/workspace watchers and `@svvy/extensions` discovery services read their file content and
fingerprints, while actor enablement, ordering, diagnostics, and participation facts stay
DB/product-state-backed in `@svvy/state`. Generated-package refresh is a runtime command/effect path.
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

App-log implementation helpers are package-private or explicit test-only subpaths. The root
entrypoint exports the primary state layer factory, approved state read and command facades, layer
exports for core-owned state-backed ports, and approved pure selectors only. `StateStore` is an
internal implementation service and is not a public dependency for `@svvy/runtime`,
`@svvy/extensions`, `@svvy/pi-adapter`, `@svvy/desktop`, renderer code, or bridge code.

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

The app-log state slice is DB/product-state-backed. `@svvy/core` owns `AppLogLevel`,
`AppLogSource`, `AppLogEntry`, `AppLogSummary`, `AppLogQuery`, `AppLogReadModel`, and
`AppLogUpdateMessage`. `@svvy/state` owns the SQLite-backed app-log persistence implementation,
redaction before persistence/live delivery, unread state, query filtering, bounded retention, and a
finite app-log implementation behind state ports and the named state read/command facades. The
target package root must not export separate app-log facades or loggers such as `AppLogFacade`,
`AppLogAppender`, `AppLogAppendInput`, `CreateAppLogFacadeOptions`, `createAppLogFacade`,
`AppLogger`, `CreateAppLoggerOptions`, `createAppLogger`, `AppLogStore`, `createAppLogStore`,
`AppLogState`, `AppLogStateService`, `appLogStateFromStore`, `makeAppLogState`, or
`layerAppLogState`. The package root exports only named app-log state ports, read facades, and
command facades. Internal app-log stores, logger helpers, and bootstrap/test helpers stay private or
test-only and must not be imported by runtime, desktop, generated-package, extension, sandbox, or
renderer/shared code. Public app-log writes go through `AppLogWritePort`; public reads and
read-state mutations go through `StateReadModels` and `StateCommandsFacade.appLogs`. Bridge
forwarding is app/bootstrap/runtime-owned; bridge transport, workspace routing, and renderer
delivery stay outside `@svvy/state`.
`AppLogWritePort.append(input)` validates `AppendAppLogInputSchema`, redacts before persistence,
inserts one app-log row in a write transaction, and returns
`StateMutationResult<{ appLogEntryId: AppLogEntryId }>` with the app-log entry id in `value`.
Success returns an `appLogs` invalidation for the related workspace when present. There is an
`appLogSummary` read model, but no separate invalidation descriptor; the `appLogs` invalidation is
the signal for both `appLogs` and `appLogSummary` refetch. App-log sink failure is recorded as
metrics/diagnostic fallback and must not fail the domain operation that emitted the Effect log.
`AppLogUpdateMessage` is a redacted post-commit live delivery optimization for open panes. It is not
a durable event log, not an app-log read model, and not sufficient for recovery. Renderer and
headless consumers fall back to the `appLogs` invalidation/read-model refetch path whenever a live
message is missed, rejected, filtered out, or older than the retained UI window.

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
- `sandboxPolicyPort()` exposes immutable `SandboxPolicySnapshot` resolution defined in
  `@svvy/core`.
- `layerAppLogWritePort` is the public state-owned layer for the append-only durable
  `AppLogWritePort` implementation. Runtime and app/bootstrap may use it for product facts and the
  Effect-log-to-app-log bridge. Other packages emit `Effect.log*` under the caller-provided logging
  policy by default; they may call `AppLogWritePort` directly only when their package spec names the
  exact durable diagnostic fact, input shape, redaction policy, and tests. Extensions, pi-adapter,
  and sandbox still do not publish runtime events or command/session facts.
- `secretStorePort()` exposes secret status/listing and invocation-local resolution only. Secret
  create, update, and remove operations are state-owned app command facade operations reached from
  user-owned UI or runtime command paths; runtime, extensions, pi-adapter, sandbox, generated
  packages, and agent-facing tools never receive a cross-package secret mutation port or raw secret
  values.
- `RuntimeArtifactStatePort` exposes artifact metadata creation, inspection, listing, deletion,
  command linkage, materialization status, immutable flags, digests, and stored-file facts for
  runtime-owned artifact commands. Physical artifact file effects, immutable-path placement,
  digest/byte calculation, and file deletion run inside the state-owned artifact-port
  implementation through injected `FileSystem`/`Path` services. Runtime orchestrates the command,
  approval, sandbox, and cancellation policy, calls the artifact port, and publishes only committed
  `afterCommit` descriptors.

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
  makeRuntimeQueueStatePort,
);

const RuntimeTurnStatePortLayer = Layer.effect(RuntimeTurnStatePort, makeRuntimeTurnStatePort);

// Each listed port must be specified in this section before implementation is promoted:
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

The public target contract is the core-owned service shape exported from `@svvy/core` state-port
modules. This matrix uses the exact exported method names unless the same change deliberately
renames the core port and all state implementations/tests. All promoted state-backed write port
methods return mutation result wrappers that include committed domain output plus `afterCommit`.
Read-only methods return domain read results without `afterCommit`.

```ts
type StateMutationResult<T> = {
  value: T;
  afterCommit: readonly StateInvalidationDescriptor[];
};
```

RuntimeWorkspaceStatePort:

- Caller: @svvy/runtime workspace acquisition and release.
- Methods: acquireWorkspace, acquireDefaultWorkspace, releaseWorkspace.
- Rule: workspace acquisition and release methods commit durable workspace/session ownership facts
  and return `StateMutationResult` wrappers with session navigation invalidations only after
  commit. They do not acquire live workspace runtime scopes, start source watchers, create
  `ManagedRuntime` values, or publish runtime events.

The exact workspace state port is:

```ts
type RuntimeWorkspaceStatePort = {
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

- Caller: @svvy/runtime queue dispatcher.
- Methods: acceptSubmittedSurfaceMessage, enqueueSurfaceMessage, getSurfaceQueuedMessage,
  claimNextQueuedSurfaceMessage, releaseExpiredSurfaceMessageClaims, markSurfaceMessageSteering,
  markSurfaceMessageQueued, markSurfaceMessageDelivered, markSurfaceMessageFailed,
  cancelSurfaceMessage.
- Rule: queue mutations are transactional; write methods return after-commit invalidations only
  after commit.
- Rule: ordinary runtime composer send acceptance uses
  `acceptSubmittedSurfaceMessage(...)`, which inserts the `user_message` queue row and clears the
  submitted durable composer draft inside one state transaction. Duplicate idempotency-key replay
  returns the existing queue row with `afterCommit: []` and must not clear the user's current draft.
  `enqueueSurfaceMessage(...)` remains the lower-level queue insert for runtime-owned non-composer
  work such as request-input answer deliveries, workflow task starts, report requests, and other
  surface-control queue items.

RuntimeSurfaceLifecycleStatePort:

- Caller: @svvy/runtime surface creation, open, and close flows.
- Methods: createOrchestratorSurface, openSurface, closeSurface.
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

RuntimeComposerDraftStatePort:

- Caller: renderer-facing state command facades and runtime cleanup paths that already have an
  accepted queue row.
- Methods: clearSubmittedDraft.
- Rule: `clearSubmittedDraft(...)` is a narrow committed-draft cleanup method keyed by the submitted
  `RuntimeSurfaceTarget` and the accepted `QueueItemId`. It returns
  `StateMutationResult<void>` and emits only composer/surface read-model invalidations. It must not
  enqueue messages, mutate transcript rows, start turns, or expose generic composer mutation.

The exact composer draft state port is:

```ts
type RuntimeComposerDraftStatePort = {
  clearSubmittedDraft(
    input: ClearSubmittedComposerDraftInput,
  ): Effect.Effect<StateMutationResult<void>, StateContractError>;
};
```

RuntimeTurnStatePort:

- Caller: @svvy/runtime turn execution.
- Methods: startTurn, setTurnDecision, finishTurn.
- Rule: active-turn writes are serialized by surface and prompt-lock ownership.

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
  `recordCommandEvent(...)` accepts only the closed runtime-owned command event kinds that append
  command detail facts after command creation: `argument_snapshot`, `diagnostic`, `output`,
  `patch_snapshot`, and `progress`. Accepted stdin writes are not appended through
  `recordCommandEvent(...)`; runtime uses `recordStdinWrite(...)` only after live command-session
  admission returns `accepted`. That method records one `command.stdin` event with exact `text` and
  `acceptedBytes`, returns `StateMutationResult<void>`, and emits command-inspector invalidation.
  It does not compute public `writeStdin` statuses, manage stdin queues, deduplicate client
  submissions, or own process handles. Command lifecycle events such as `command.requested` and
  `command.started` are produced by `createCommand(...)` and `startCommand(...)`, not through a
  generic string event append surface.
  `createCommand(...)` accepts only initial command statuses: `requested` for command rows that
  still need a `startCommand(...)` transition, or `streaming` for already-live streamed tool-call
  rows. `finishCommand(...)` accepts only terminal or waiting states: `waiting`, `succeeded`,
  `failed`, or `cancelled`. It never accepts `requested`, `running`, or `streaming`.
  `command.output` source values are the closed runtime vocabulary `live-stream`, `final-result`,
  `execute_typescript`, and `retained-log-artifact`; arbitrary source strings are not part of the
  port contract.

RuntimeApprovalStatePort:

- Caller: @svvy/runtime approval request creation, answer recording, wait recovery, cancellation,
  and terminal command linkage.
- Methods: createApprovalRequest, getApprovalRequest, listOpenApprovalRequests,
  resolveApprovalRequest.
- Rule: approval rows are durable `@svvy/state` facts created for runtime-owned approval policy.
  State records requests and answers atomically through core-owned state ports; runtime owns policy,
  waiting, command terminalization, queue effects, and publication after commit.

Approval port contract:

```ts
type RuntimeApprovalToolName = "apply_patch" | "exec_command" | "execute_typescript";
type RuntimeApprovalMode = "auto-review" | "user";
type RuntimeApprovalStatus = "pending" | "approved" | "denied" | "cancelled";
type RuntimeApprovalResolvedStatus = "approved" | "denied" | "cancelled";
type RuntimeApprovalReviewer = "auto-review" | "user";

type RuntimeApprovalRequestRecord = {
  approvalId: RuntimeApprovalId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: ThreadId | null;
  turnId: TurnId | null;
  commandId: CommandId;
  toolCallId: ToolItemId;
  toolName: RuntimeApprovalToolName;
  approvalMode: RuntimeApprovalMode;
  cwd: AbsolutePath;
  command: string | null;
  commandFamily: string | null;
  patch: string | null;
  snippetArtifactId: ArtifactId | null;
  typescriptCode: string | null;
  status: RuntimeApprovalStatus;
  decisionReason: string | null;
  reviewer: RuntimeApprovalReviewer | null;
  createdAt: IsoDateTimeString;
  answeredAt: IsoDateTimeString | null;
};

type CreateRuntimeApprovalRequestInput = {
  approvalId?: RuntimeApprovalId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId?: ThreadId | null;
  turnId?: TurnId | null;
  commandId: CommandId;
  toolCallId: ToolItemId;
  toolName: RuntimeApprovalToolName;
  approvalMode: RuntimeApprovalMode;
  cwd: AbsolutePath;
  command?: string | null;
  commandFamily?: string | null;
  patch?: string | null;
  snippetArtifactId?: ArtifactId | null;
  typescriptCode?: string | null;
  createdAt: IsoDateTimeString;
};

type GetRuntimeApprovalRequestInput = {
  approvalId: RuntimeApprovalId;
  workspaceSessionId?: WorkspaceSessionId;
  surfacePiSessionId?: SurfacePiSessionId;
};

type ListOpenRuntimeApprovalRequestsInput = {
  workspaceSessionId?: WorkspaceSessionId;
  surfacePiSessionId?: SurfacePiSessionId;
};

type ResolveRuntimeApprovalRequestInput = {
  approvalId: RuntimeApprovalId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  status: RuntimeApprovalResolvedStatus;
  reviewer: RuntimeApprovalReviewer;
  decisionReason?: string | null;
  answeredAt: IsoDateTimeString;
};

type RuntimeApprovalStatePort = {
  createApprovalRequest(
    input: CreateRuntimeApprovalRequestInput,
  ): Effect.Effect<StateMutationResult<RuntimeApprovalRequestRecord>, StateContractError>;
  getApprovalRequest(
    input: GetRuntimeApprovalRequestInput,
  ): Effect.Effect<RuntimeApprovalRequestRecord, StateContractError>;
  listOpenApprovalRequests(
    input?: ListOpenRuntimeApprovalRequestsInput,
  ): Effect.Effect<readonly RuntimeApprovalRequestRecord[], StateContractError>;
  resolveApprovalRequest(
    input: ResolveRuntimeApprovalRequestInput,
  ): Effect.Effect<StateMutationResult<RuntimeApprovalRequestRecord>, StateContractError>;
};
```

`createApprovalRequest(...)` inserts a pending row and returns
`StateMutationResult<RuntimeApprovalRequestRecord>`. `resolveApprovalRequest(...)` is a
compare-and-set transition from `pending` to one terminal status; resolving an already terminal row
with the same terminal facts is idempotent and returns `afterCommit: []`. A conflicting terminal
answer fails with `StateContractError.reason: "conflict"`. Successful create/resolve writes emit
runtime-approval and affected surface/session invalidations; read-only get/list methods return no
invalidation descriptors.

RuntimeActorExtensionBindingStatePort:

- Caller: @svvy/runtime actor extension binding updates.
- Methods: updateActorExtensionBinding, setActorExtensionBinding.
- Rule: orchestrator bindings update DB-backed session extension ids; handler bindings update
  DB-backed thread extension ids. `updateActorExtensionBinding(...)` applies one
  loaded/available/off usage transition and requires `usage: "loaded"` to refer to an extension that
  is currently available or already loaded for that actor. `setActorExtensionBinding(...)` replaces
  the complete loaded/available extension id lists for a runtime-owned binding refresh after the
  caller has validated the list. Workflow-task binding mutation is not part of this port; workflow
  task-agent extension defaults are resolved from task-agent/profile context before the attempt
  starts.

The exact actor extension binding state port is:

```ts
type RuntimeActorExtensionBindingStatePort = {
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
  `threadGroupId` before creating the durable episode row. Outcome-bearing requests conclude the
  handler thread through the same state boundary. Non-thread episode scopes are outside the
  `RuntimeEpisodeStatePort` contract; adding one requires a product spec that first defines its
  state rows, read models, ownership checks, and runtime applier.
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
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  sourceCommandId: CommandId;
  kind: RuntimeEpisodeKind;
  title: string;
  summary: string;
  body: string;
  outcome?: RuntimeEpisodeOutcome | null;
  relatedCommandIds?: readonly CommandId[];
  relatedArtifactIds?: readonly ArtifactId[];
  relatedWorkflowRunIds?: readonly WorkflowRunId[];
  createdAt: IsoDateTimeString;
  idempotencyKey: string;
};

type RuntimeEpisodeRecord = {
  id: EpisodeId;
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  sourceCommandId: CommandId | null;
  kind: RuntimeEpisodeKind;
  title: string;
  summary: string;
  body: string;
  outcome: RuntimeEpisodeOutcome | null;
  relatedCommandIds: readonly CommandId[];
  relatedArtifactIds: readonly ArtifactId[];
  relatedWorkflowRunIds: readonly WorkflowRunId[];
  createdAt: IsoDateTimeString;
};

type RuntimeEpisodeStatePort = {
  recordHandlerThreadEpisode(
    input: RecordRuntimeHandlerThreadEpisodeInput,
  ): Effect.Effect<StateMutationResult<RuntimeEpisodeRecord>, StateContractError>;
};
```

`recordHandlerThreadEpisode(...)` is idempotent by `(workspaceSessionId, sourceCommandId,
idempotencyKey)`. Replaying the same input returns the existing episode with `afterCommit: []`;
replaying the same idempotency key with different episode content fails with
`StateContractError.reason: "conflict"`.

RuntimeThreadStatePort:

- Caller: @svvy/runtime handler/workflow thread lifecycle.
- Methods: startHandlerThreads, ensureHandlerThreadRunnable.
- Rule: `startHandlerThreads(...)` is the only state port method that commits the state-owned rows
  for a `handler_thread.start` effect. It accepts only runtime-prepared facts: workspace/session
  ownership, the orchestrator turn id, source command id, optional thread group id, handler pi
  surface ids already allocated by runtime/pi-adapter, display titles, objectives, history mode,
  worktree id, resolved loaded/available extension ids, optional serialized agent profile facts,
  exact generated actor context binding text/fingerprint, and exact initial queue payloads. State
  does not allocate pi sessions, build generated context, choose profiles, validate extension
  availability, derive forked history, publish runtime events, wake queues, create desktop panes, or
  execute handler turns.
- `startHandlerThreads(...)` commits one transaction containing one or more handler-thread rows, one
  generated-context binding row per created thread, and one `initial_handler_start` queue row per
  created thread. It validates that `orchestratorTurnId` belongs to `workspaceSessionId`. It stores
  `sourceCommandId` on each initial queue row so command lineage is durable. If the same
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
  surfacePiSessionId: SurfacePiSessionId;
  title: string;
  objective: string;
  historyMode: "isolated" | "forked";
  worktreeId?: WorktreeId | null;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  agentProfileJson?: string | null;
  generatedAgentContextBinding: RuntimeHandlerThreadGeneratedContextBindingInput;
  initialQueue: RuntimeHandlerThreadInitialQueueInput;
}

interface RuntimeHandlerThreadGeneratedContextBindingInput {
  aggregateCacheKey: string;
  systemPrompt: string;
  svvyxGuidance: string;
  commandsDts: string;
  nativeToolSchemasJson: string;
  generatedAgentContextFingerprint: string;
  generatedAgentContextRevision: number;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  externalSourceHashes: readonly string[];
}

interface RuntimeHandlerThreadInitialQueueInput {
  idempotencyKey: string;
  priority?: "interactive" | "runtime" | "background";
  orderingKey?: string | null;
  nextAttemptAt?: string | null;
  maxAttempts?: number;
  messageJson: string;
  payloadJson: string;
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
  title: string;
  objective: string;
  historyMode: "isolated" | "forked";
  objectiveState: "active";
  status: "running-handler";
  wait: null;
  worktreeId: WorktreeId | null;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  generatedAgentContextFingerprint: string;
  generatedAgentContextBindingId: string;
  queuedMessage: RuntimeSurfaceMessageRecord;
}
```

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
  `nativeToolSchemasJson`, `messageJson`, and `payloadJson` before this port is called. State stores
  those exact JSON strings as committed facts and may reject invalid JSON as a contract error, but
  it does not derive prompt policy, queue payload meaning, native tool declarations, or generated
  context from them.

RuntimeExtensionStatePort:

- Caller: @svvy/runtime extension dependency command completion.
- Methods: recordDependencyReadiness.
- Rule: this port records app-global extension dependency readiness facts after runtime-owned
  dependency install/update/probe commands finish and `@svvy/extensions` has returned immutable
  readiness evidence. It returns `StateMutationResult<ExtensionDependencyReadiness>` and emits the
  app-level `extensions` read-model invalidation descriptor. It does not approve dependencies,
  launch dependency commands, inspect CLIs, read source fingerprints, generate packages, or mutate
  extension source.

The exact extension dependency state port is:

```ts
type RuntimeExtensionStatePort = {
  recordDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): Effect.Effect<StateMutationResult<ExtensionDependencyReadiness>, StateContractError>;
};
```

RuntimeSourceStatePort:

- Caller: @svvy/runtime source edit and invalidation workers.
- Methods: readSourceVersion, recordSourceSave, recordSourceDelete.
- Rule: this port owns source-version facts needed for compare-and-swap editable source saves,
  source deletion facts, and recovery after two-phase file/state work. `readSourceVersion(...)` is
  read-only. `recordSourceSave(...)` and `recordSourceDelete(...)` return
  `StateMutationResult<RuntimeSourceFactRecord>` and emit only source/read-model invalidations
  backed by committed product state. The port does not read or write file contents, watch files,
  generate extension packages, or mutate renderer drafts.

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
};
```

RuntimeRequestStatePort:

- Caller: @svvy/runtime request-input creation, snapshot reads, open blocking wait recovery, answer
  recording, timer pause commits, timeout defaulting, cancellation, and later nonblocking answer
  delivery linkage.
- Methods: createRequestInput, getRequestInput, listOpenBlockingRequestInputs,
  answerRequestInput, setRequestInputTimerPaused, defaultOpenRequestInputQuestions,
  cancelRequestInput.
- Rule: this port owns request-input records and any later nonblocking answer delivery linkage.
  Command progress, waiting status, terminal command facts, and command immutability are handled
  separately through `RuntimeCommandStatePort`. Session/surface wait projections are handled
  separately through `RuntimeSessionWaitStatePort`; request-input timer scheduling itself is runtime
  process behavior and is never owned by state.

RuntimeSessionWaitStatePort:

- Caller: @svvy/runtime approval waits, request-input blocking waits, and prompt/session recovery
  flows that need to project why a session or thread is intentionally waiting.
- Methods: setApprovalWait, setUserWait, clearSessionWait.
- Rule: this port owns only durable wait projection facts used by read models and recovery. It does
  not own in-memory pending registries, timeout scheduling, command settlement, approval decisions,
  request-input answers, queue delivery, or pi prompt control.
- Mutation result rule: `setApprovalWait` and `setUserWait` return
  `StateMutationResult<RuntimeSessionWaitRecord>` with `surface(surfacePiSessionId)` plus
  `sessionNavigation` descriptors for the affected orchestrator or handler-thread surface.
  Non-no-op `clearSessionWait` returns `StateMutationResult<RuntimeSessionWaitRecord | null>` with
  the cleared record as `value`; when the session has no matching wait to clear it returns
  `value: null` and `afterCommit: []`.

Wait projection contract:

```ts
type RuntimeSessionWaitOwner =
  | { kind: "orchestrator" }
  | { kind: "thread"; threadId: ThreadId };

type RuntimeSessionWaitRecord =
  | {
      kind: "approval";
      workspaceSessionId: WorkspaceSessionId;
      surfacePiSessionId: SurfacePiSessionId;
      owner: RuntimeSessionWaitOwner;
      commandId: CommandId;
      approvalId: RuntimeApprovalId;
      reason: string;
      resumeWhen: string;
      startedAt: IsoDateTimeString;
      expiresAt: null;
    }
  | {
      kind: "user";
      workspaceSessionId: WorkspaceSessionId;
      surfacePiSessionId: SurfacePiSessionId;
      owner: RuntimeSessionWaitOwner;
      commandId: CommandId;
      requestId: RequestInputRequestId;
      reason: string;
      resumeWhen: string;
      startedAt: IsoDateTimeString;
      expiresAt: IsoDateTimeString | null;
    };

type SetRuntimeApprovalWaitInput = {
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  owner: RuntimeSessionWaitOwner;
  commandId: CommandId;
  approvalId: RuntimeApprovalId;
  reason: string;
  resumeWhen: string;
  startedAt: IsoDateTimeString;
};

type SetRuntimeUserWaitInput = {
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  owner: RuntimeSessionWaitOwner;
  commandId: CommandId;
  requestId: RequestInputRequestId;
  reason: string;
  resumeWhen: string;
  startedAt: IsoDateTimeString;
  expiresAt?: IsoDateTimeString | null;
};

type ClearRuntimeSessionWaitInput = {
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId?: SurfacePiSessionId;
  owner?: RuntimeSessionWaitOwner;
  commandId?: CommandId;
  approvalId?: RuntimeApprovalId;
  requestId?: RequestInputRequestId;
  clearedAt: IsoDateTimeString;
  reason: "approval_resolved" | "user_answered" | "timeout_defaulted" | "command_cancelled" | "surface_closed" | "recovery";
};

type RuntimeSessionWaitStatePort = {
  setApprovalWait(
    input: SetRuntimeApprovalWaitInput,
  ): Effect.Effect<StateMutationResult<RuntimeSessionWaitRecord>, StateContractError>;
  setUserWait(
    input: SetRuntimeUserWaitInput,
  ): Effect.Effect<StateMutationResult<RuntimeSessionWaitRecord>, StateContractError>;
  clearSessionWait(
    input: ClearRuntimeSessionWaitInput,
  ): Effect.Effect<StateMutationResult<RuntimeSessionWaitRecord | null>, StateContractError>;
};
```

`setApprovalWait(...)` and `setUserWait(...)` overwrite only the wait projection for the addressed
`workspaceSessionId` and owner after validating that the supplied `surfacePiSessionId` belongs to
that owner. They do not create approval/request rows. `clearSessionWait(...)` clears only a wait
matching all supplied owner fields; stale clear attempts are idempotent no-ops with
`afterCommit: []`. Runtime timers, `Deferred` registries, approval answers, request-input answers,
and command settlement stay outside this port.

There is no public `RuntimeTitleStatePort`. Title generation is runtime-owned work represented by
`RuntimeRecoveryStatePort` recovery rows with the `title_generation` kind plus state-owned title
facts on the relevant session/thread records. Do not add detached helper promises or a separate
title-job service outside runtime/state ports.

RuntimeRecoveryStatePort:

- Caller: @svvy/runtime recovery workers.
- Methods: normalizeWorkspaceRecoveryState, listWorkspaceRecoveryStartupSnapshots,
  ensureRecoveryWork, claimNextRecoveryWork, completeRecoveryWork, failOrRetryRecoveryWork.
- Rule: recovery claims use the same owner/lease/version discipline as queue claims.
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
  write. No target public state facade unwraps this mutation result into a raw affected-surface
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
- Read operations that inspect current generated-context binding, stale binding status, or
  affected surfaces return state records without `afterCommit`.
- Mutation operations that update a surface generated-context binding return
  `StateMutationResult<SurfaceGeneratedContextBinding>` from the actor-extension binding port. Their
  `afterCommit` contains a `surface(surfacePiSessionId)` invalidation and any affected
  Agents/Extensions invalidation. Rebinding to the same current build id is an idempotent no-op and
  returns `afterCommit: []`.

RuntimeGeneratedPackageStatePort:

- Caller: @svvy/runtime generated-package refresh/recovery.
- Methods: recordGeneratedPackageBuild, recordGeneratedPackageFailure,
  recordWorkspaceLinkStatus, readLinksNeedingRepair, readGeneratedPackageFacts,
  reconcileGeneratedPackageManifest, markGeneratedPackageRefreshNeeded.
- Rule: generated package files are never edited by state; state stores manifests, diagnostics, and
  link facts.

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
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
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
- Methods: extension inventory, source, env, dependency, build, and generated-context fact methods
  listed in the extension spec.
- Rule: extension writes are product-state writes; source files remain owned by @svvy/extensions.

ProviderAuthPort / ProviderAuthStatusStatePort:

- Caller: @svvy/pi-adapter and runtime model surfaces for live credential snapshots;
  @svvy/runtime/app for redacted status persistence.
- Methods: `ProviderAuthPort.getProviderAuthSnapshot`,
  `ProviderAuthPort.refreshProviderCredentialSnapshot`,
  `ProviderAuthStatusStatePort.listProviderStatuses`,
  `ProviderAuthStatusStatePort.recordProviderStatus`.
- Rule: credential material is returned only by live `ProviderAuthPort` snapshot methods for trusted
  invocations. DB/product-state-backed provider status contains redacted account labels, health,
  expiry, and issues only.

PiSessionReferencePort:

- Caller: @svvy/pi-adapter.
- Methods: getPiSessionReference, savePiSessionReference, deletePiSessionReference,
  validatePiSessionReference.
- Rule: persisted pi references are opaque adapter-owned records keyed by surfacePiSessionId.

SandboxPolicySource:

- Caller: @svvy/sandbox.
- Methods: snapshot.
- Rule: returns immutable policy snapshots only; sandbox never reads settings/state directly.

RuntimeArtifactStatePort:

- Caller: @svvy/runtime artifact effect application and runtime-owned artifact command adapters.
- Methods: createArtifact, inspectArtifact, listArtifacts, deleteArtifact.
- Rule: artifact metadata, stored files, immutable-path placement, digest/byte calculation,
  deleted lifecycle fields, command/thread/workflow links, and read-model indexes are paired inside
  the state-owned implementation of the core-owned runtime artifact port. Extension handlers do not
  receive artifact state or artifact file-store ports; they return validated handler results,
  command facts, and `ExtensionRuntimeOperation` items wrapping `RuntimeEffectRequest` values or
  immutable execution plans for runtime to apply.

The method names above are target public contracts. A promoted implementation must either implement
the exact name or update this matrix in the same change; similar private repository/helper names are
not substitutes for the public port contract.
\*/

type RuntimeQueueStatePort = {
acceptSubmittedSurfaceMessage(
input: AcceptSubmittedRuntimeSurfaceMessageInput,
): Effect.Effect<StateMutationResult<RuntimeSurfaceMessageRecord>, StateContractError>;
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
};

type EnqueueRuntimeSurfaceMessageInput = {
workspaceSessionId: WorkspaceSessionId;
surfacePiSessionId: SurfacePiSessionId;
threadId?: ThreadId | null;
workflowTaskAttemptId?: WorkflowTaskAttemptId | null;
kind: RuntimeSurfaceQueueItemKind;
idempotencyKey: string;
priority: RuntimeSurfaceQueuePriority;
orderingKey: string;
sourceCommandId?: CommandId | null;
maxAttempts?: number;
nextAttemptAt?: IsoDateTimeString | null;
message: RuntimeSubmittedMessage;
payload?: QueueItemPayload | null;
position?: "front" | "back";
};

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
answerRequestInput(input: AnswerRequestInputInput): Effect.Effect<StateMutationResult<AnswerRequestInputResult>, StateContractError>;
setRequestInputTimerPaused(
input: SetRequestInputTimerPausedInput,
): Effect.Effect<StateMutationResult<SetRequestInputTimerPausedResult>, StateContractError>;
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

`AnswerRequestInputInput`, `AnswerRequestInputResult`, `SetRequestInputTimerPausedInput`, and
`SetRequestInputTimerPausedResult` are core-owned runtime request-input contracts imported from
`@svvy/core`. `RuntimeRequestStatePort` must not import these shapes from `@svvy/runtime` or define
state-local aliases with the same names. Runtime facade methods and state ports share the core
contract, while state owns only the DB-backed request rows, question rows, answer rows, timeout
facts, and `StateMutationResult.afterCommit` descriptors.

State computes and persists request-input timeout deadline facts during
`createRequestInput(...)` using `Clock.Clock`: `durationMs`, `createdAt`, `expiresAt`,
`pausedAt: null`, and `remainingMsWhenPaused: null`. Runtime passes only requested duration and
mode; callers do not author persisted deadline timestamps. On pause, state writes `pausedAt` and
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
enabled timeout, writes paused/resumed timer facts transactionally, and returns only the committed
request id. Runtime reschedules or clears process-local timeout/wait fibers only after this state
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
`StateMutationResult<T>`. `createRequestInput`, `answerRequestInput`,
`defaultOpenRequestInputQuestions`, `cancelRequestInput`, and `setRequestInputTimerPaused` return
their committed domain value as `value` and their publication descriptors as `afterCommit`. They do
not embed a second nested `afterCommit`, `receipt`, queue row preview, or best-effort delivery claim
object inside `value`.

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

`SurfaceTranscriptReadModel` is DB/product-state-backed. It returns committed transcript,
composer, prompt-lock, and queue-derived facts only. Live assistant deltas, stream generation ids,
runtime event sequences, and rebaseline cursors are process-local runtime event data. Desktop and
renderer surfaces receive them only through app/bootstrap renderer-safe fanout. Browser, headless,
and test edges may consume runtime facade subscriptions directly. All consumers refetch through
state using ordinary `StateReadModelRequest` values when a committed invalidation arrives.

type CommandInspectorReadModelInput = {
commandId: CommandId;
};

type CommandInspectorReadModel = {
commandId: CommandId;
status: "pending" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
toolName: NativeToolName;
target?: RuntimeSurfaceTarget;
acceptedArguments?: JsonValue;
summary?: string;
error?: StateStoredError;
finishedAt?: IsoDateTimeString;
output: readonly {
stream: "stdout" | "stderr";
text: string;
sequence: NonNegativeSafeInteger;
}[];
stdin: {
mode: "none" | "continuable";
canAttemptWrite: boolean;
acceptedWrites: readonly {
text: string;
acceptedBytes: ByteCount;
at: IsoDateTimeString;
}[];
};
facts?: CommandFactsPayload;
childCommandIds: readonly CommandId[];
artifactIds: readonly ArtifactId[];
};

`summary`, `error`, and `finishedAt` are terminal command fields persisted from
`FinishCommandInput` or the equivalent terminal command event after runtime has committed the
command lifecycle. They are fetchable from the command inspector read model because runtime events
carry invalidation signals, not terminal read-model snapshots. They are not preview fields and are
not authored by the renderer.

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

type RecoveryWorkPayloadByKind = {
  queue_delivery: { surfacePiSessionId: SurfacePiSessionId };
  active_turn_recovery: { surfacePiSessionId: SurfacePiSessionId; turnId?: TurnId };
  workflow_task_attempt_recovery: { workflowTaskAttemptId: WorkflowTaskAttemptId };
  source_reconcile: SourceReconcileRequest;
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

Runtime-facing state ports are exact method groups for the target architecture, not examples to
reinterpret as raw table access. Queue claim methods atomically select one eligible row, mark it
dispatching, attach owner/lease facts, and return after-commit invalidations. Eligibility is
`status` in `queued` or `steering`, `nextAttemptAt` absent or due, and no active unexpired claim
lease. Within one `surfacePiSessionId` and `orderingKey`, claim order is:
`steering` rows first by `steerSequence` or `updatedAt`, then `request_user_input_answer` rows FIFO
by `sequence`, then priority `interactive > runtime > background`, then FIFO `sequence`.
`orderingKey` is the durable
serialization key for rows that must not overtake each other on the same surface; ordinary surface
prompt work uses the surface key. State implements this ordering atomically, while runtime owns the
policy that assigns priority, ordering key, steering facts, retry timing, and cancellation.
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
Runtime starts one drain lane per `(surfacePiSessionId, orderingKey)`. Ordinary prompt-bearing rows
use `orderingKey = surface:<surfacePiSessionId>`. Runtime must not claim across ordering keys unless
the owning runtime spec defines a cross-lane arbitration policy for that queue item kind.

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
and prompt history are not renderer storage and are not watched as file-backed source. Runtime reads
provider credentials through `ProviderCredentialSnapshot` records that contain only the information
needed to configure the pi/provider port for one invocation. Secret values are resolved through the
secure secret-store adapter into `Redacted.Redacted<string>` values at the trusted invocation
boundary, are redacted in logs/read models/events, and are never returned in extension inventory,
generated context, app logs, command facts, transcripts, or desktop bridge payloads.
Secret values never appear in state read models. `SecretStorePort` methods return only secret refs,
presence, fingerprints, status records, or `Redacted` invocation values. Provider status writes invalidate
`providerAuth` app read models. Pi session reference writes invalidate the owning surface/session
recovery read models. Validation failures return the port-specific typed error and do not delete or
rewrite references unless the caller uses the explicit delete method.

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
  secretKeyNames: readonly string[];
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
  readiness: ExtensionDependencyReadiness;
  sourceCommandId?: CommandId | null;
  recordedAt: IsoDateTimeString;
};

type RuntimeExtensionStatePortService = {
  recordDependencyReadiness(
    input: RecordExtensionDependencyReadinessInput,
  ): Effect.Effect<StateMutationResult<ExtensionDependencyReadiness>, StateContractError>;
};

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
    list(
      input: ListExtensionRecordsInput,
    ): Effect.Effect<ReadonlyArray<ExtensionRecord>, StateContractError>;
    get(input: GetExtensionRecordInput): Effect.Effect<ExtensionRecord, StateContractError>;
    readSourceFingerprint(
      input: ReadExtensionSourceFingerprintInput,
    ): Effect.Effect<string | null, StateContractError>;
  };
  usage: {
    resolveActorBinding(
      input: ResolveActorExtensionBindingInput,
    ): Effect.Effect<ActorExtensionBinding, StateContractError>;
  };
  env: {
    listStatus(
      input: ListExtensionEnvStatusInput,
    ): Effect.Effect<ReadonlyArray<ExtensionEnvStatus>, StateContractError>;
    getInvocationEnv(
      input: GetExtensionInvocationEnvInput,
    ): Effect.Effect<ExtensionExecutionEnvPlan, StateContractError>;
  };
  dependencies: {
    isApproved(
      input: ReadExtensionDependencyApprovalInput,
    ): Effect.Effect<boolean, StateContractError>;
    readReadiness(
      input: ReadExtensionDependencyReadinessInput,
    ): Effect.Effect<ExtensionDependencyReadiness, StateContractError>;
  };
  generatedPackages: {
    readFacts(
      input: ReadGeneratedPackageFactsInput,
    ): Effect.Effect<GeneratedPackageFacts, StateContractError>;
    readLinksNeedingRepair(
      input: ReadGeneratedPackageLinksNeedingRepairInput,
    ): Effect.Effect<ReadonlyArray<GeneratedPackageWorkspaceLink>, StateContractError>;
  };
};
```

Extension-facing state methods that write DB/product state open or join the correct state-owned
transaction internally and return mutation result wrappers containing committed output plus
`afterCommit`. Extensions never compose arbitrary state transactions. Generated-package fact and
workspace-link writes are not extension-facing operations; they are runtime-owned writes through
`RuntimeGeneratedPackageStatePort`.

Implementation-local artifact file-store helper shape:

```ts
type InternalArtifactFileStore = {
  createEmpty(
    input: CreateEmptyArtifactFileInput,
  ): Effect.Effect<ArtifactStoredFile, StateContractError | ArtifactFileStoreError>;
  copyIntoStore(
    input: CopyArtifactIntoStoreInput,
  ): Effect.Effect<ArtifactStoredFile, StateContractError | ArtifactFileStoreError>;
  read(
    input: ReadArtifactFileInput,
  ): Effect.Effect<ArtifactFileBytes, StateContractError | ArtifactFileStoreError>;
  stat(
    input: StatArtifactFileInput,
  ): Effect.Effect<ArtifactStoredFile, StateContractError | ArtifactFileStoreError>;
  markImmutable(
    input: MarkArtifactImmutableInput,
  ): Effect.Effect<ArtifactStoredFile, StateContractError | ArtifactFileStoreError>;
  delete(
    input: DeleteArtifactFileInput,
  ): Effect.Effect<DeletedArtifactFile, StateContractError | ArtifactFileStoreError>;
};
```

This helper is not exported; public consumers receive only `RuntimeArtifactStatePort`.

`ExtensionStatePortService` is DB/product-state-backed and is provided through the core-owned
`ExtensionStatePort` tag. It exposes extension records, usage policy,
env readiness, dependency approval/readiness, source fingerprints, and read-only generated-package
fact selectors for validation and listing. It does not expose generated-context writes,
generated-package fact writes, workspace-link writes, command writes, recovery writes, or read-model
invalidation publication. Generated-context writes remain runtime-owned through
`RuntimeActorExtensionBindingStatePort` and `RuntimeExtensionContextImpactStatePort`.
Generated-package fact and workspace-link writes remain runtime-owned through
`RuntimeGeneratedPackageStatePort`.
`records.readSourceFingerprint(...)` reads the currently recorded fingerprint for a source root, and
`dependencies.isApproved(...)` reads the dependency approval ledger for a single exact dependency
identity:

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

`RuntimeArtifactStatePort` is the core-owned artifact state boundary. `@svvy/state` owns its live
implementation and layer. It creates, inspects, lists, and deletes artifacts while maintaining the
matching DB-backed artifact metadata, stored-file path, digest, byte count, deleted lifecycle,
command/thread/workflow links, and read-model indexes. Runtime/command adapters may refresh file
source bytes or source paths while producing command output, but the state-owned port owns final
placement, digest, byte count, and metadata records. The port returns metadata records and does not
return artifact file contents.
`createArtifact` and `deleteArtifact` return `StateMutationResult<RuntimeArtifactRecord>`.
`inspectArtifact` and `listArtifacts` are read-only and return raw records. Artifact mutation
descriptors target only existing read-model invalidation vocabulary: `sessionNavigation`,
`commandInspector(sourceCommandId)` when present, `handlerThreadInspector(threadId)` when present,
and `workflowTaskAttemptInspector(workflowTaskAttemptId)` when present. There is no standalone
artifact invalidation descriptor unless a standalone artifact read model is added in this spec.
Implementation-local file-store helpers may exist inside `@svvy/state`, but they are not exported
to `@svvy/extensions` or `@svvy/runtime`.
`RuntimeArtifactStatePort` exposes only:

```ts
type RuntimeArtifactStatePort = {
  createArtifact(
    input: CreateRuntimeArtifactInput,
  ): Effect.Effect<StateMutationResult<RuntimeArtifactRecord>, StateContractError>;
  inspectArtifact(
    input: InspectRuntimeArtifactInput,
  ): Effect.Effect<RuntimeArtifactRecord, StateContractError>;
  listArtifacts(
    input: ListRuntimeArtifactsInput,
  ): Effect.Effect<ReadonlyArray<RuntimeArtifactRecord>, StateContractError>;
  deleteArtifact(
    input: DeleteRuntimeArtifactInput,
  ): Effect.Effect<StateMutationResult<RuntimeArtifactRecord>, StateContractError>;
};

type CreateRuntimeArtifactInput = {
  workspaceSessionId: WorkspaceSessionId;
  threadId?: ThreadId | null;
  workflowRunId?: WorkflowRunId | null;
  workflowTaskAttemptId?: WorkflowTaskAttemptId | null;
  sourceCommandId?: CommandId | null;
  kind: "text" | "log" | "json" | "file";
  name?: string;
  source:
    | { kind: "inline"; content: string }
    | { kind: "copy_file"; path: AbsolutePath }
    | { kind: "empty" };
  mimeType?: string;
  immutable?: boolean;
};

`CreateRuntimeArtifactInput.workspaceSessionId` is required because every artifact record is durable
product state under one workspace session. `source` is a closed one-of:

- `inline` stores runtime-provided content into a new artifact file.
- `copy_file` copies the referenced file into the artifact store, records only the immutable stored
  path, and never persists the caller's mutable source path as the artifact location.
- `empty` creates a placeholder file owned by the artifact store for runtime-owned writers that fill
  content later under the same command/session context.

Exactly one `source` variant is accepted. Inline content and file path cannot both be supplied.

type InspectRuntimeArtifactInput = {
  workspaceSessionId?: WorkspaceSessionId | null;
  artifactId: ArtifactId;
};

type ListRuntimeArtifactsInput = {
  workspaceSessionId: WorkspaceSessionId;
  threadId?: ThreadId | null;
  limit?: number;
};

type DeleteRuntimeArtifactInput = {
  workspaceSessionId?: WorkspaceSessionId | null;
  artifactId: ArtifactId;
};

type RuntimeArtifactRecord = {
  id: ArtifactId;
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId | null;
  workflowRunId: WorkflowRunId | null;
  workflowTaskAttemptId: WorkflowTaskAttemptId | null;
  sourceCommandId: CommandId | null;
  kind: "text" | "log" | "json" | "file";
  name: string;
  path?: AbsolutePath;
  mimeType: string;
  bytes: NonNegativeSafeInteger;
  sha256: string;
  immutable: boolean;
  createdAt: IsoDateTimeString;
  deletedAt: IsoDateTimeString | null;
};
```

File-store failures are mapped into the shared `StateContractError` vocabulary at the public port:
missing artifacts map to `not-found`, duplicate artifact names map to `conflict`, invalid names or
source paths map to `invalid-input`, and store-level `COPY_FAILED` / `DELETE_FAILED` materialization
failures map to `transaction-failed` unless the shared state error vocabulary is explicitly expanded
in `@svvy/core`.

Artifact commands use a two-phase materialization protocol:

1. Stage new bytes outside the SQL transaction under a state-owned temporary path.
2. Enter a short SQL transaction, decode the command input, insert or update artifact metadata with
   `materializationStatus: "staging"`, command/thread/workflow links, digest intent, immutable
   intent, and after-commit invalidations.
3. Promote the staged file into its final artifact-store path with atomic rename where the host
   filesystem supports it.
4. Enter a second short SQL transaction that marks the artifact `materializationStatus: "ready"`,
   records byte size and digest, and returns after-commit read-model invalidation descriptors.

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
  byteSize: number;
  sha256: string;
  materializationStatus: "staging" | "ready" | "delete_pending" | "deleted" | "failed";
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  deletedAt: IsoDateTimeString | null;
  lastRecoveryWorkId: RecoveryWorkId | null;
};
```

If promotion or the second transaction fails, state records or enqueues
`artifact_materialization` recovery work that can remove an orphan staged file, remove orphan ready
bytes without metadata, or complete metadata for a promoted file whose digest can still be verified.
Deletes mark metadata deleted transactionally, then remove bytes, then record recovery work when
byte removal fails. SQL transactions never perform file I/O while open.

Staging must happen under the same artifact root/filesystem as the final path. If same-filesystem
atomic rename cannot be guaranteed, the port must fail before metadata insertion or use an explicit
copy-then-digest-verify path that records `artifact_materialization` recovery before exposing
`materializationStatus: "ready"`.

DB/product-state-backed slices include:

- workspace, worktree, layout, session, surface, pi session reference, prompt binding, and generated
  context rows
- message, turn, queue, prompt delivery, retry, lease, and recovery rows
- thread group, handler objective, report, conclusion, episode, request-input, approval, title job,
  and manual title rows
- command, command event, command output, diagnostic, patch snapshot, child command, command fact,
  and app-log rows
- extension record, usage, env status, encrypted secret reference, dependency readiness,
  generated-package fact, and generated-package workspace-link rows
- Smithers-observed workflow/run/task/node/iteration/attempt bridge facts that product read models
  require
- artifact metadata, immutable marker, deleted marker, source-command/thread/workflow links, and
  read-model indexes

State-exposed file-backed assets are limited to:

- artifact bytes and immutable artifact files written through `RuntimeArtifactStatePort`
- temporary staged files used by state-owned artifact replacement commands

`@svvy/state` stores DB rows for source fingerprints, source versions, diagnostics,
generated-context facts, generated-package facts, and workspace-link facts. It does not own
Workflows source, extension source, external instruction files, generated package files, generated
extension build files, workspace `.smithers/node_modules` links, watcher coordination, or source
invalidation scheduling.

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
- `runtime_source_fact`, keyed by `(source_kind, source_id)`, records file-backed source path,
  source version, fingerprint, diagnostics, source command lineage, creation/update timestamps, and
  optional deletion timestamp. Save operations clear `deleted_at`; delete operations mark the
  existing fact deleted and require the expected source version when supplied.
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
- Secure secret-store adapter acquisition and close when the adapter has a lifecycle.
- Artifact file-store root resolution, directory creation, and cleanup of temporary staging
  directories through injected `FileSystem.FileSystem` and `Path.Path`.
- No product source watcher lives in `@svvy/state`; runtime owns source watchers. State may only own
  lifecycle for storage adapters such as SQLite, secret store, and artifact temp cleanup.

No state service may hide a process-wide mutable singleton. The app creates state layers once per
runtime graph and disposes them through the owning `ManagedRuntime` / layer scope.

| Resource                               | Owner package/service                | Backing kind            | Lifetime kind     | Acquired by                                                                                                 | Released by                                                                                                 | Reused across calls                     | Interruption behavior                                                                                                    | Required receipts/tests                                                                       |
| -------------------------------------- | ------------------------------------ | ----------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| SQLite database handle                 | `@svvy/state` layer                  | DB/product-state-backed | `layer-acquired`  | `@svvy/state layer({ config, secretStore })` under the app runtime layer                                    | app `ManagedRuntime.dispose()` closes the layer scope and database handle                                   | yes, for the app runtime graph          | request interruption cancels the current transaction/effect only; app disposal closes the handle                         | scoped database lifecycle test, transaction rollback test, no handle access after scope close |
| Migration and pragma setup             | `@svvy/state` layer                  | DB/product-state-backed | `layer-acquired`  | `@svvy/state layer(input)` before exposing state ports/facades under the app runtime layer                  | app runtime disposal; migration receipts remain in SQLite                                                   | yes, setup runs once per acquired layer | interruption before layer acquisition fails startup; interruption after setup does not rerun until reacquire             | migration ordering receipt, pragma verification, startup-failure typed error test             |
| Secret-store adapter                   | `@svvy/state` secret-store service   | host resource           | `layer-acquired`  | state layer from decoded `StateLayerConfig` and injected host secret-store implementation                   | adapter close/finalizer on state layer scope close                                                          | yes, while app runtime graph is alive   | operation interruption cancels the current secret operation; app disposal closes adapter when it has a lifecycle         | fake secret-store lifecycle test, redaction/no-raw-secret read-model test                     |
| Artifact durable root metadata         | `@svvy/state` artifact state service | DB/product-state-backed | `layer-acquired`  | state layer validates configured artifact root and state command facades materialize metadata               | app runtime disposal for adapter handles; metadata persists until explicit state command deletes/updates it | yes                                     | interruption cancels current metadata command; committed rows remain authoritative                                       | artifact metadata command tests, pure selector no-filesystem test                             |
| Artifact temporary staging directories | `@svvy/state` artifact state service | file-backed             | `operationScoped` | artifact command effect through injected `FileSystem.FileSystem` / `Path.Path`                              | operation finalizer or terminal artifact materialization fact                                               | no                                      | interruption runs staging cleanup finalizers; committed durable artifact facts are not rolled back by filesystem cleanup | temp staging cleanup test, interrupted artifact write test                                    |
| State read-model projection rows       | `@svvy/state` projection services    | DB/product-state-backed | `layer-acquired`  | state command facades inside transactions under the state layer                                             | explicit state transactions update/delete rows; app disposal closes access handles only                     | yes                                     | interruption before commit leaves prior projection; after commit runtime receives after-commit descriptors               | projection transaction atomicity test, after-commit descriptor receipt test                   |
| Provider auth status rows              | `@svvy/state` provider auth status port | DB/product-state-backed | `layer-acquired`  | `layerProviderAuthStatusStatePort` over the structured session state layer                                  | explicit provider status writes update rows; app disposal closes access handles only                       | yes                                     | interruption before commit leaves prior provider status; after commit runtime receives `providerAuth` invalidations      | provider auth status state-port test, redacted/no-secret status test                         |
| App log rows                           | `@svvy/state` app-log command port   | DB/product-state-backed | `layer-acquired`  | runtime/state command facade within owning transaction or recovery observation effect under the state layer | retention/clear command or database lifecycle, not runtime event disposal                                   | yes                                     | interruption before commit drops uncommitted log; after commit log is durable                                            | app-log write/read-model test, no runtime-published-only log test                             |

Startup order inside the state layer is deterministic:

1. Receive the app-bootstrap-decoded `StateLayerConfig` and validate path ownership.
2. Create the parent directory for the configured SQLite file through injected
   `FileSystem.FileSystem` / `Path.Path` after validating that the configured absolute path belongs
   to the app-owned state root.
3. Open the SQLite connection.
4. Ensure WAL is enabled, apply `PRAGMA foreign_keys = ON` and the configured busy timeout, and
   verify effective connection settings. The state SQLite adapter may enable WAL by default unless
   disabled, but svvy still verifies the effective setting before migrations or repositories are
   exposed. The setup layer also verifies the repository sequence/cursor/lease numeric policy before
   any runtime/state facade is exposed: repository schemas/storage choices must bind numeric values
   to safe JavaScript numbers, text, or `bigint` according to the repository contract. The busy
   timeout value is a schema-validated positive safe integer and is applied only through a
   state-owned helper/adapter API that emits a reviewed integer PRAGMA; no caller-provided SQL text
   or arbitrary PRAGMA fragment may reach setup.
5. Run the state migrator.
6. Construct package-private repositories, ports, and read-model services.
7. Expose the state layer, approved facades, and core-owned state-backed port layers to app
   bootstrap. Repositories, SQL clients, migrations, table helpers, and `StateStore` remain
   package-private. Dependent packages receive only the narrow ports or facades they declare, never a
   broad `StateStore` service.

No runtime queue worker, source invalidation coordinator, generated-package worker, title worker,
or desktop bridge facade starts before this layer has successfully completed startup.

`@svvy/state` owns this setup order with its package-private SQLite repository adapter. Effect SQL
is not part of the target state architecture. Production state code must not import
`effect/unstable/sql/*`, `@effect/sql-sqlite-bun`, `@effect/sql-sqlite-node`, `SqlClient`,
`SqlSchema`, `SqlResolver`, upstream Effect SQL migrators, or Effect SQL reactive/streaming helpers.
The package may use direct SQLite implementation modules only inside `@svvy/state` repository,
setup, migration, and test-layer code. No direct SQLite handle, transaction object, repository
object, table helper, migration helper, or row store crosses the public state package boundary.

The state SQLite handle is acquired exactly once per acquired `@svvy/state.layer(...)` scope and is
reused by setup, migration, repository, read-model, and state-port implementation sublayers. Tests
prove one database handle is acquired and finalized once per state scope. `@svvy/state.layer` must
verify effective SQLite settings before exposing ports: WAL enabled, `foreign_keys = ON`,
configured busy timeout applied, and sequence/cursor/lease numeric policy explicitly wired through
repository context or schemas. Startup fails with `StateLayerError` if verification fails. A
state-owned setup effect/layer runs required pragmas and verifies the effective connection settings
before exposing repository layers or public state services.

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
migration-body failures into `StateLayerError` before exposing any state services.
State startup uses numbered immutable migrations only.
`CREATE TABLE IF NOT EXISTS`,
`ensureColumn`, and ad hoc backfills are allowed only inside migration bodies. There are no down
migrations, runtime schema probes, runtime table creation, compatibility branches, or dynamic
`ALTER TABLE` paths outside numbered migrations. Schema-required seed/default product rows are
inserted by explicit numbered migrations. Startup reconciliation may upsert only deterministic
product facts derived from current config, packaged defaults, or file-backed source scans through
named state ports, with after-commit descriptors and tests. It must not create tables, alter
schemas, compensate for missing migrations, or hide migration failures. Test seed helpers are
test-only exports. Migration failures fail the state layer and prevent the app runtime graph from
exposing runtime or desktop facades.

V1 exposes no public SQLite backup, export, checkpoint, vacuum, load-extension, or maintenance
surface. Future database maintenance must be state-owned, adapter-aware, scoped, and exposed through
typed state service methods rather than raw SQLite clients, database objects, connections,
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

`TransactionPort` is a package-private state contract unless a specific runtime-owned port in
`@svvy/core` names an after-commit domain operation. `CurrentTransaction` and
`TransactionContext` are state-internal implementation details and are not exported from the
`@svvy/state` root.

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
  Consumers do not place `TransactionContext` in the public Effect requirement channel.
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

The target state repository architecture is direct package-private SQLite repositories wrapped in
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
- Artifact files are durable product state. State owns artifact file-store implementation,
  metadata, and the implementation/layer for the core-owned `RuntimeArtifactStatePort`; sandbox
  enforces immutable/generated boundaries; extensions only create validated handler results,
  command facts, and `ExtensionRuntimeOperation` items wrapping `RuntimeEffectRequest` values or
  immutable execution plans for runtime to apply.
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
  generated-package metadata, and migration envelopes test both the shared parse options and the
  schema-level optionality/redaction/transform behavior instead of relying on Effect defaults.
- All public state DTOs, state port inputs/results, read models, facade request/result schemas,
  persisted JSON payload schemas, command facts, app logs, and migration envelope schemas use
  `Schema.optionalKey(...)` for absent-only optional object fields. `Schema.optional(...)` inside a
  public `Schema.Struct({ ... })` field is allowed only when `undefined` is intentionally part of the
  encoded and decoded contract, and that exception has focused decode/encode tests.
- Static row schemas and compiled schema functions are hoisted at module scope, including
  `Schema.is`, `Schema.decodeEffect`, `Schema.decodeUnknownEffect`, `Schema.decodeExit`,
  `Schema.decodeUnknownExit`, `Schema.decodeSync`, `Schema.decodeUnknownSync`,
  `Schema.encodeEffect`, `Schema.encodeUnknownEffect`, `Schema.encodeExit`,
  `Schema.encodeUnknownExit`, `Schema.encodeSync`, and `Schema.encodeUnknownSync`. Effect v4
  `Schema.asserts(schema, input)` is a direct assertion call, not a reusable guard compiler. State
  boundary code therefore uses hoisted decoders, encoders, `Schema.is`, or package-owned wrapper
  helpers whose compiler calls happen at module scope. Direct inline assertion calls are allowed
  only in named dynamic schema factory files where the schema cannot be known at module scope.
- Decode and encode failures map to typed state boundary errors with operation context and a stable
  schema issue summary.
- State tests prove repositories do not expose raw SQLite handles, transactions, SQL streams, or
  reactive SQL handles across public state ports.
- `@svvy/state` exports named test fixtures only from test-only entrypoints:
  `layerTestSqlite`, `layerTestSqliteIsolated`, `layerTestInMemoryPorts`, and explicit fake port
  layers.
  `layerTestSqlite` and `layerTestSqliteIsolated` use temp-file SQLite and run the same setup,
  pragma verification, migration, repository, and port layers as production. Runtime package tests
  may import those test entrypoints only. SQL behavior, migrations, queue claims, recovery leases,
  reopen behavior, locking behavior, and source-version compare-and-swap must use temp-file SQLite
  layers, not in-memory fakes. In-memory real SQLite adapters are allowed only for narrow numeric
  decode/encode tests that do not assert persistence, locking, reopen, migration, queue, or recovery
  behavior.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on Effect v4.
- May depend on storage and secure-secret-store adapters.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/pi-adapter`, `@svvy/sandbox`,
  `@svvy/desktop`, Svelte, or Electrobun.

## Product Source Ownership

Target package paths:

- `packages/state/src/**`
- state-local migrations and schema modules
- state-local SQLite/secret-store/file-store adapters
- explicit pure selector subpaths such as `packages/state/src/session-navigation.ts`
- internal structured-session storage modules and approved pure selector modules such as
  `packages/state/src/structured-session-state.ts` and
  `packages/state/src/structured-session-selectors.ts`
- state facade and port modules exported through package-boundary tests

## Acceptance Criteria

- `@svvy/state` is the only package that owns SQLite-backed product state, state transactions,
  migrations, durable queue persistence, secrets metadata, and committed read-model projections.
- State ports expose domain operations and typed read models, not raw table handles or generic SQL
  escape hatches.
- `@svvy/state` exports test layers such as `layerTestSqlite`, `layerTestSqliteIsolated`, and
  `layerTestInMemoryPorts` only for tests. Those layers preserve transaction, invalidation, clock,
  secret-store, and lifecycle semantics rather than becoming anonymous mock objects. Persistence,
  migrations, SQL constraints, transaction rollback, queue claims, reopen behavior, locking
  behavior, source-version compare-and-swap behavior, recovery leases, and read-model projections
  are tested with temp-file SQLite layers. Fake or in-memory state layers are only port-contract
  doubles for dependent package unit tests that are not validating SQL-backed behavior.
- Every state write that can affect runtime/UI observation is transactional and returns
  publication-ready invalidation descriptors only after commit. `@svvy/runtime` turns those
  descriptors into runtime notifications; `@svvy/state` does not publish notifications itself.
- Recovery uses persisted state facts and queue rows, not runtime event-stream replay.
- State code never executes commands, calls pi, renders UI, owns runtime scheduling, or decides tool
  retry/approval policy.

## Tests

- Transactional write tests.
- `@effect/vitest` service/layer tests.
- Test-layer coverage for `layerTestSqlite`, `layerTestSqliteIsolated`, state-port fake layers,
  fake secret stores, and `TestClock`; tests do not create `ManagedRuntime` manually except
  facade/bootstrap integration tests. Real SQLite layers prove SQL behavior, migrations,
  transactions, constraints, queue claiming, and read-model selectors. Fake/in-memory layers are
  only for consumers of state ports when the test is not validating SQL behavior.
- Scoped database lifecycle tests.
- Queue persistence and query-order tests.
- Runtime-facing queue recovery read tests.
- Transaction commit/after-commit-notification-order tests.
- Transaction rollback tests proving no runtime event notification is emitted for failed writes.
- Worktree context selector tests.
- Artifact file-store persistence tests.
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
- Artifact materialization crash-recovery tests at each staging, metadata, promotion, digest, ready,
  delete, and recovery phase.
- Source-version compare-and-swap conflict tests.
- Generated-package fact repair tests.
- Service-tag ownership/package-boundary import tests.
- SQLite adapter rule tests reject repository/runtime use of streaming or reactive SQL handles,
  Effect SQL helpers, direct repository transactions outside the state-owned transaction service,
  public SQLite handles, and any SQLite connection import outside package-private repository,
  migration, setup, or driver-integration tests.
- Tests proving state package does not execute commands, call pi, or render UI.
