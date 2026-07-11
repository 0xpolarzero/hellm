# `@svvy/runtime` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/runtime`

## Purpose

`@svvy/runtime` is the reusable orchestration kernel.

It coordinates the shared execution model:

```text
message submit -> durable queue commit -> queue wake/claim -> prompt defaults/binding read -> required generated-context refresh -> turn record commit -> pi stream -> streamed tool intent -> accepted tool call -> runtime command envelope -> extension handler -> ExtensionRuntimeOperation processing -> runtime_effect application / execution_plan execution -> state commit -> runtime notification/live patch -> UI refetch or stream rebaseline -> recovery scan
```

It is the package another app imports when it wants `svvy` behavior without the desktop UI.

`@svvy/runtime` is the primary Effect-native orchestration package. Package-to-package consumers use
its Effect service and layers. Desktop, browser tools, headless scripts, and other non-Effect
consumers use Promise facades, `AsyncIterable` event adapters, and narrow callback adapters only for
bridge lifecycle/exit wiring over a scoped `ManagedRuntime`. Callbacks never supply runtime policy,
routing, queue claiming, event publication, or command/session ownership.

## Owns

- Workspace runtime scope lifecycle.
- Default workspace runtime scope behavior.
- Workspace/session/surface creation and activation.
- Live surface runtime scope keyed by `surfacePiSessionId`.
- Prompt lock, active claimed queue item, active stream, retain count, and current turn coordination
  state for opened surfaces.
- Worktree context alignment with sessions and surfaces.
- Prompt-bearing turn execution.
- Queue claiming, delivery ordering, retries, recovery, and delivery.
- Queue delivery semantics for all queue item kinds.
- Follow-up messages and active steer requests.
- Safe pause/resume boundaries.
- Generated agent context refresh scheduling.
- Source invalidation coordination for file-backed source inputs and DB/product-state-backed
  settings, profile, and managed-snippet invalidation routing.
- App-global generated-package refresh scheduling/recovery, and runtime-owned workspace-link repair
  scheduling/application after committed generated-package facts.
- Runtime routing of model tool calls to extension handlers.
- Streamed tool-call lifecycle coordination.
- Runtime-provided tool declaration handoff to `@svvy/pi-adapter` for the addressed actor surface.
- Handler-thread surface lifecycle and orchestrator reconciliation delivery.
- Nonblocking request-input queued answer delivery through the owning surface, plus blocking
  request-input wait and timeout resolution.
- Durable title-generation scheduling, recovery, concurrency, manual-rename blocking, and freeze
  rules.
- Runtime event stream for UIs and automation consumers.
- Recovery orchestration after app restart.
- Redaction enforcement before data is persisted or emitted when extension handlers provide
  redaction hooks.

In this spec, "workspace runtime scope" means the runtime-owned keyed child scope acquired through
the package-private `RuntimeWorkspaceScopeService` from the package-private workspace runtime scope
map inside the single app-owned `ManagedRuntime`. It is built by package-private
`layerRuntimeWorkspaceScopeService` as an implementation detail of `Runtime.layer`. It is not a
per-workspace `ManagedRuntime`, not a public `RuntimeFacade`, not an app/bootstrap workspace
registry, not a desktop/headless routing object, and not an exported package API.

## Does Not Own

- Durable SQLite storage implementation or state repository adapters. Runtime does own artifact byte
  materialization, deletion, staged-file cleanup, digest calculation, and recovery as command-scoped
  file effects; committed artifact metadata is stored only through state ports.
- pi internals or pi transcript storage.
- Extension catalog definitions.
- Native tool declaration schema ownership.
- Prompt or instruction source files.
- Filesystem/network sandbox policy semantics, helper/profile construction, and sandbox-denial
  classification. Runtime does own launch-kind admission, command-scope launch-policy acquisition,
  and runtime error mapping through package-private `RuntimeLaunchPolicyService`.
- Desktop UI rendering.
- Renderer-owned `Agent` state, Dockview pane focus, or panel bindings.
- Smithers workflow execution command surfaces.
- Separate public packages for builtin extension subdomains.

## Public API Shape

Effect-native service surface:

```ts
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ExtensionSourceRootsPort, Extensions } from "@svvy/extensions";
import type { HostProcessReferencePort, SandboxHelperCandidatesPort } from "@svvy/sandbox";
import type {
  RuntimeGeneratedContextRefreshHostPort,
  RuntimeGeneratedPackageRefreshHostPort,
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeLayerConfigService,
  RuntimeLayerError,
  RuntimeLayerModelResolverPort,
  RuntimeLayerProviderAuthPort,
  RuntimeShutdownPreparation,
  RuntimeSourceInvalidationScanPort,
  RuntimeStartupReadiness,
} from "@svvy/runtime/bootstrap";
import {
  AppLogWritePort,
  RuntimeContractError,
  type RuntimeActorExtensionBindingStatePort,
  type RuntimeApprovalStatePort,
  type RuntimeCommandStatePort,
  type RuntimeEpisodeStatePort,
  type RuntimeEvent,
  type RuntimeEventError,
  type RuntimeEventsInput,
  type RuntimeGeneratedPackageStatePort,
  type RuntimePromptDefaultsStatePort,
  type RuntimeQueueStatePort,
  type RuntimeRequestStatePort,
  type RuntimeSessionWaitStatePort,
  type RuntimeSourceStatePort,
  type RuntimeSurfaceLifecycleStatePort,
  type RuntimeThreadStatePort,
  type RuntimeTurnStatePort,
  type RuntimeWorkspaceStatePort,
  type BuildLaunchPolicyInput,
  type SandboxLaunchFacts,
  type SandboxPolicySource,
  type StateCommandPostCommitNotificationPort,
} from "@svvy/core";

// `@svvy/core` owns schema-backed DTOs/codecs and shared API group interfaces where they cross
// package boundaries. `@svvy/runtime` owns the `Runtime` service composition, package-local groups,
// event subscription effect shape, and Promise facade adapter.

export class Runtime extends Context.Service<
  Runtime,
  {
    workspaces: RuntimeWorkspacesApiEffect;
    surfaces: RuntimeSurfacesApiEffect;
    messages: RuntimeMessagesApiEffect;
    queues: RuntimeQueuesApiEffect;
    commands: RuntimeCommandsApiEffect;
    approvals: RuntimeApprovalsApiEffect;
    requestInput: RuntimeRequestInputApiEffect;
    sourceEdits: RuntimeSourceEditsService; // public service/facade group; group type stays package-local
    sourceInvalidation: RuntimeSourceInvalidationApiEffect;
    events(
      input?: RuntimeEventsInput,
    ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
  }
>()("@svvy/runtime/Runtime") {}

const runtimeGeneratedPackageRefreshLayer = layerRuntimeGeneratedPackageRefreshService.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeSourceInvalidationLayer = layerRuntimeSourceInvalidationService.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
  Layer.provideMerge(layerRuntimeGeneratedContextRefreshService),
  Layer.provideMerge(runtimeGeneratedPackageRefreshLayer),
);
const runtimeRequestInputWaitLayer = layerRuntimeRequestInputWaitService.pipe(
  Layer.provideMerge(layerRuntimeQueueWakeService),
);
const runtimeApprovalWaitLayer = layerRuntimeApprovalWaitService;
const runtimeLaunchPolicyLayer = layerRuntimeLaunchPolicyService.pipe(Layer.provide(sandboxLayer));
const runtimeSurfaceEventPublisherLayer = layerRuntimeSurfaceEventPublisher.pipe(
  Layer.provideMerge(layerRuntimeEventBus),
);
const runtimeInternalServicesLayer = Layer.mergeAll(
  runtimeSourceInvalidationLayer,
  runtimeRequestInputWaitLayer,
  runtimeApprovalWaitLayer,
  runtimeLaunchPolicyLayer,
  runtimeSurfaceEventPublisherLayer,
  layerRuntimeWorkspaceScopeService,
  layerRuntimePromptDefaultsService,
);

export namespace Runtime {
  const runtimeServiceLayer = Layer.effect(Runtime, makeRuntimeService());
  const runtimeAcceptedNativeToolExecutionLayer = layerRuntimeAcceptedNativeToolExecution;
  const runtimeAppLogCommitNotificationLayer = layerRuntimeAppLogCommitNotification;
  const runtimeExecutionPlanExecutorLayer = layerRuntimeExecutionPlanExecutor;
  const runtimeStartupReadinessLayer = layerRuntimeStartupReadiness;
  const runtimeShutdownPreparationLayer = layerRuntimeShutdownPreparation;

  export const layer: Layer.Layer<
    | Runtime
    | RuntimeStartupReadiness
    | RuntimeShutdownPreparation
    | RuntimeAppLogCommitNotification
    | StateCommandPostCommitNotificationPort,
    RuntimeLayerError,
    | RuntimeLayerConfigService
    | RuntimePromptDefaultsStatePort
    | RuntimeLayerProviderAuthPort
    | RuntimeLayerModelResolverPort
    | AppLogWritePort
    | RuntimeGeneratedContextRefreshHostPort
    | RuntimeGeneratedPackageRefreshHostPort
    | RuntimeSourceInvalidationScanPort
    | RuntimeLayerCommandStdinPort
    | RuntimeLayerCommandControlPort
    | SandboxPolicySource
    | SandboxHelperCandidatesPort
    | HostProcessReferencePort
    | RuntimeWorkspaceStatePort
    | RuntimeSurfaceLifecycleStatePort
    | RuntimeSourceStatePort
    | RuntimeGeneratedPackageStatePort
    | Extensions
    | FileSystem.FileSystem
    | Path.Path
    | Crypto.Crypto
    | ExtensionSourceRootsPort
    | RuntimeActorExtensionBindingStatePort
    | RuntimeQueueStatePort
    | RuntimeRequestStatePort
    | RuntimeApprovalStatePort
    | RuntimeCommandStatePort
    | RuntimeSessionWaitStatePort
    | RuntimeThreadStatePort
    | RuntimeTurnStatePort
    | RuntimeEpisodeStatePort
  > = Layer.mergeAll(
    runtimeServiceLayer,
    runtimeAcceptedNativeToolExecutionLayer,
    runtimeAppLogCommitNotificationLayer,
    runtimeExecutionPlanExecutorLayer,
    runtimeStartupReadinessLayer,
    runtimeShutdownPreparationLayer,
    layerStateCommandPostCommitNotificationPort,
  ).pipe(Layer.provide(runtimeInternalServicesLayer));
}

export const layer = Runtime.layer;
```

`Runtime.layer` composes one package-private `runtimeInternalServicesLayer` graph per app
`ManagedRuntime` acquisition. That internal graph may use `Layer.provideMerge(...)` only to retain
package-private dependency services that are still needed by sibling runtime internals while the
bundle is assembled. The final public `Runtime.layer` composition consumes that bundle with
`Layer.provide(runtimeInternalServicesLayer)`, so internal services do not appear in the public
layer success type. Shared internal services such as `RuntimeEventBus`,
`RuntimeSurfaceEventPublisher`, `RuntimeApprovalWaitService`, `RuntimeQueueWakeService`,
`RuntimeRequestInputWaitService`, `RuntimeGeneratedContextRefreshService`,
`RuntimeGeneratedPackageRefreshService`, `RuntimeSourceInvalidationService`,
`RuntimeLaunchPolicyService`, `RuntimeWorkspaceScopeService`, and
`RuntimePromptDefaultsService` are acquired exactly once in that graph, then provided to all
runtime service groups and workers. Services with surface-specific behavior, including
`RuntimeRequestInputWaitService`, own keyed entries by durable surface/request ids inside that one
runtime-acquired service; they are not reacquired once per surface runtime scope.
Layer sketches in this spec are illustrative API-shape examples; they are not permission to
duplicate singleton internal services in separate provider chains. Package-private layers shown
inside the `Runtime.layer` sketch are provided to runtime implementation modules and then hidden by
the final `Runtime.layer` output type. Their appearance in the sketch does not make their service
tags public output, package-root exports, bootstrap exports, facade groups, or app/bootstrap
extension points.

`runtimePostCommitNotificationLayer` is package-private implementation wiring inside
`@svvy/runtime`; it provides the core-owned `StateCommandPostCommitNotificationPort` into
`Runtime.layer` and is not a package-root export or public `Runtime` namespace member.
`RuntimeAcceptedNativeToolExecution` is package-private runtime context used by accepted pi tool
wiring inside runtime implementation modules. It is composed inside runtime package internals and
tested through package-local modules, but it is not part of `Runtime.layer`'s public output type,
not a package-root value export, not a public bootstrap export, not a facade group, and not a
renderer, desktop, browser-tool, headless, or extension API.
`@svvy/runtime/accepted-native-tool-execution` is the only public adapter over this context. It
exports Promise functions that accept the already acquired app-owned `ManagedRuntime` and run the
package-private service inside that runtime for app/bootstrap-owned accepted native-tool entry
points. It does not export `RuntimeAcceptedNativeToolExecution`,
`RuntimeAcceptedNativeToolExecutionService`, `layerRuntimeAcceptedNativeToolExecution`, extension
handler invocation, runtime-effect application, generic accepted-tool dispatch, or command/state
ports.

`RuntimeAppLogCommitNotification` is the analogous package-private `Runtime.layer` output service
used only by `@svvy/runtime/app-log-commit-notification-adapter`. It receives an app-global or
workspace source scope after a real committed app-log append, constructs the fixed `appLogs`
descriptor inside runtime, and publishes through `RuntimeEventBus`. Its tag, service interface,
layer, and mapping are not package-root exports, bootstrap exports, Runtime/facade groups, or
caller-supplied callback surfaces.

`RuntimeLaunchPolicyService` is the only package-private runtime service that calls
`Sandbox.buildLaunchPolicy(...)`. Runtime command/session lanes call this adapter rather than
calling `Sandbox` directly. This service may be exported from a runtime-internal source module for
package-local composition and tests. It is not exported from the `@svvy/runtime` package root, not
exported from `@svvy/runtime/bootstrap`, not present in the package export map as an app surface,
and not available to desktop, extensions, generated packages, or pi-adapter. The exact
package-private service shape is:

```ts
export interface RuntimeLaunchPolicyServiceService {
  build(
    input: BuildLaunchPolicyInput,
  ): Effect.Effect<SandboxLaunchFacts, RuntimeContractError, Scope.Scope>;
}

export class RuntimeLaunchPolicyService extends Context.Service<
  RuntimeLaunchPolicyService,
  RuntimeLaunchPolicyServiceService
>()("@svvy/runtime/RuntimeLaunchPolicyService") {}
```

The `build` implementation is a named Effect v4 service method:
`Effect.fn("@svvy/runtime/launchPolicy.build")(function* (input) { ... })`. The label is part of
the runtime adapter contract because launch-policy failures, traces, and defects must point at the
runtime-owned launch-policy operation rather than an anonymous layer generator or a sandbox-owned
operation.

Direct native-tool launch lanes do not accept handler-authored, generated-package-authored, or
app-edge `launchKind` values. Runtime acquires direct-tool launch facts through the
package-private `RuntimeAcceptedNativeToolExecution.acquireDirectToolLaunch(...)` method. Its input
is `BuildLaunchPolicyInput` without `launchKind` plus
`toolName: "exec_command" | "apply_patch" | "execute_typescript"`. The method is labeled
`Effect.fn("@svvy/runtime/acceptedNativeToolExecution.acquireDirectToolLaunch")`, uses the
package-private `buildRuntimeDirectToolLaunchFacts(...)` mapper in
`runtime-direct-tool-launch-policy.ts`, and provides the acquired `RuntimeLaunchPolicyService` to
that mapper. The mapper is labeled `Effect.fn("@svvy/runtime/directToolLaunchPolicy.build")`, calls
only `RuntimeLaunchPolicyService.build(...)`, does not import `@svvy/sandbox`, and maps exactly:

- `exec_command` -> `direct_shell`
- `apply_patch` -> `direct_apply_patch`
- `execute_typescript` -> `execute_typescript_runtime`

`buildRuntimeDirectToolLaunchFacts(...)` is package-private implementation surface only behind the
accepted-tool service method: not a package-root export, not a bootstrap export, not a facade group,
not a separate runtime service, not a runtime composition dependency, and not available to
app/bootstrap, desktop, extensions, generated packages, sandbox, state, or pi-adapter.

`BuildLaunchPolicyInput` is the core-owned sandbox launch contract. Runtime command lanes allocate
or reuse the durable command envelope when accepting the tool execution or starting the command
session, before creating approval requests and before building launch facts. Approval uses that
command envelope. Runtime builds `BuildLaunchPolicyInput` only after the action is admitted by the
applicable approval policy and immediately before acquiring subprocess or file-effect worker
resources:

- `scope` is the admitted product scope. Shell, Apply Patch, Execute TypeScript, and extension child
  commands use `{ kind: "workspace", workspaceId }` when they operate in a workspace. Runtime derives
  the `workspaceId` from the accepted target's workspace session binding or validated runtime target,
  never from handler-authored plan data, raw tool arguments, or app/bootstrap launch code.
- `surfacePiSessionId` is present when the accepted target is tied to a pi-backed surface. Runtime
  derives it from the accepted target context; launch callers do not supply arbitrary pi session ids.
- `commandId` is the durable command id whose lifecycle owns the launched process or file-effect
  worker.
- `launchKind` is the runtime-selected closed launch kind, such as `direct_shell`,
  `direct_apply_patch`, or `execute_typescript_runtime`.
- `command` is the exact executable argv that runtime will launch after `SandboxLaunchFacts`
  returns. Runtime chooses argv from the accepted native-tool runner or validated execution plan. It
  is not used by state to derive policy.
- `cwd` is the runtime-admitted and canonical working directory for the accepted target.
- `envFacts` contains redacted receipts derived from the runtime-built environment plan only; it
  never contains raw env values.
- `snapshot` is omitted for normal launches. Runtime may supply it only to replay or verify an
  already committed immutable sandbox snapshot. App/bootstrap, extensions, generated packages,
  direct-tool helpers, and handler plans cannot synthesize or provide live policy snapshots.

Callers receive only `SandboxLaunchFacts` or `RuntimeContractError`. `SandboxPolicyError` never
escapes `RuntimeLaunchPolicyService`; `helper-unavailable` maps to runtime reason
`target-not-ready`, and all other sandbox policy failures map to runtime reason `state-conflict`
with the original sandbox error retained as `cause`.

Example direct Shell input:

```ts
const input: BuildLaunchPolicyInput = {
  scope: { kind: "workspace", workspaceId },
  surfacePiSessionId,
  commandId,
  launchKind: "direct_shell",
  command: ["/bin/zsh", "-lc", "bun test ./packages/package-boundaries.test.ts"],
  cwd: workspaceCwd,
  envFacts: [{ key: "PATH", redactionLabel: "system path" }],
};

const effect = launchPolicy.build(input);
```

Example `apply_patch` worker input:

```ts
const input: BuildLaunchPolicyInput = {
  scope: { kind: "workspace", workspaceId },
  surfacePiSessionId,
  commandId,
  launchKind: "direct_apply_patch",
  command: [runtimePatchWorkerPath],
  cwd: workspaceCwd,
  envFacts: [],
};

const effect = launchPolicy.build(input);
```

Example Execute TypeScript runtime input:

```ts
const input: BuildLaunchPolicyInput = {
  scope: { kind: "workspace", workspaceId },
  surfacePiSessionId,
  commandId,
  launchKind: "execute_typescript_runtime",
  command: [bunExecutablePath, runtimeEntrypointPath],
  cwd: workspaceCwd,
  envFacts: [
    { key: "SVVY_EXECUTE_TYPESCRIPT_PAYLOAD", redactionLabel: "execute-typescript payload" },
  ],
};

const effect = launchPolicy.build(input);
```

A full-access snapshot returns an omitted-launch receipt rather than managed helper facts:

```ts
{
  mode: "omitted_full_access",
  spawn: {
    executable: "/bin/zsh",
    args: ["-lc", "git status --short"],
    cwd: workspaceCwd,
    envFacts: [{ key: "PATH", redactionLabel: "system path" }],
  },
  policySnapshot: {
    sandboxMode: "omitted_full_access",
    networkPolicy: "allow",
    filesystemPolicy: { defaultAccess: "read", entries: [] },
    // plus immutable snapshot identity fields
  },
}
```

`HttpClient.HttpClient` is not a base `Runtime.layer` requirement. Runtime-owned outbound
helper/protocol calls use separately named app-bootstrap transport adapters that invoke the
already-acquired app `ManagedRuntime`; they do not create per-transport or per-request
`ManagedRuntime` instances, layer graphs, event buses, queue dispatch services, or command
registries.
Runtime domain services do not call global `fetch`, Bun, Node HTTP APIs, or extension-owned HTTP
clients directly.
`Runtime.layer`'s package-root signature names the complete external production dependency set with
public service tags. The package-private `RuntimeLayerRequirements` alias may exist only in
`runtime-layer.ts` as an implementation-local mirror of that same set; the package root must not
import or expose the private alias. The set names core-owned state ports, the direct `Extensions`
package service, sandbox layer dependencies consumed by `RuntimeLaunchPolicyService`,
platform services used by runtime-owned command/source work, and host capabilities named by the
public runtime method ledger. Runtime does not directly require `SecretStorePort`; trusted
invocation-local extension secret materialization is owned by the extension/env planning and
app-host invocation boundary that satisfies the extension service dependencies. Runtime also does
not require a ready `Sandbox` or `PiAdapter` service tag from app/bootstrap. App/bootstrap composes
the root app graph that satisfies `Extensions.layer`, `PiAdapter.layer`, `@svvy/state.layer`,
extension secret-store dependencies, sandbox host-support ports, and host platform layers; runtime
internally composes the sandbox launch-policy adapter from the listed sandbox dependencies. Every
state port, package service, platform service, sandbox host-support service, and host capability
consumed by a public runtime method, package-private `Runtime.layer` output, or internal layer
composed by `Runtime.layer` must appear in the package-root layer signature, or the ledger must name
an already-listed service that owns the behavior.
Runtime-owned implementation services such as `RuntimeEventBus`, `RuntimeSurfaceEventPublisher`,
`RuntimeQueueWakeService`, `RuntimeRequestInputWaitService`,
`RuntimeGeneratedPackageRefreshService`, `RuntimeSourceInvalidationService`,
`RuntimeAcceptedNativeToolExecution`, `RuntimeExecutionPlanExecutor`, `RuntimeLaunchPolicyService`,
`RuntimeWaitRegistry`, `RuntimeCommandSessionService`, `SourceInvalidationCoordinator`, and
`RuntimeRecoveryCoordinator` are named internal sublayers built by `Runtime.layer` and hidden with
`Layer.provide(...)`;
app/bootstrap does not provide them and package code must not satisfy them through package-private
singletons, direct `@svvy/state` implementation imports, source-checkout-relative helpers, or
per-request layer graphs.
`StateCommandPostCommitNotificationPort` is provided by `Runtime.layer` into the app runtime
context so `@svvy/state` command facades can hand committed descriptors to runtime-owned
publication. It is not a `@svvy/runtime` package-root value export, not a facade group, and not an
app/bootstrap callback surface.

Every public runtime API group exposed by `Runtime` and `createRuntimeFacade(...)` has a complete
production dependency path through `RuntimeLayerRequirements` and runtime-owned internal services. A
public method is invalid if it relies on an optional app/bootstrap callback, returns
`unsupported-operation` because the public method itself lacks a production implementation, or
delegates product policy to a broad catalog object. `unsupported-operation` is a valid public failure
only when the decoded input asks for a domain, scope, transport, or capability that the method
contract ledger explicitly lists as unsupported.

Package-private operation applicators may return typed `unsupported-operation` only when the
decoded operation asks for a capability intentionally modeled as optional in
`RuntimeEffectRequestApplicationContext`, or when the decoded `ExtensionExecutionPlan` kind has no
spec-defined concrete runtime-owned execution lane.
`RuntimeEffectRequestApplicationContext` is package-private command execution context, not an
app/bootstrap callback or routing hook. Source invalidation public facade wiring remains a
composition requirement, and runtime effect application treats a missing package-private
`sourceInvalidation` application-context capability as a typed unsupported operation for effect
variants that require generated-context or generated-package refresh.

Command stdin uses `RuntimeLayerCommandStdinPort.writeStdin(...)` behind
`Runtime.commands.writeStdin(...)`. The service admits text only by durable `CommandId`, never by
shell session id or process handle, and keeps live process handles package-private. App/bootstrap
may provide primitive process and stdin host capabilities only
through the named `RuntimeLayerCommandStdinPort`; it does not own command lookup, admission policy,
durable stdin receipt recording, or command terminal state.

Routeable lookup is owned by runtime services that manage runtime-owned workspace and surface scope
records, direct core-owned state ports, and package service requirements in
`RuntimeLayerRequirements`. `Runtime.layer` composes runtime-owned package-private workspace/surface
scope-manager services implemented only with manifest-adopted Effect primitives.
App/bootstrap does not provide a workspace registry, route resolver, callback table, or alternate
runtime implementation, and it is never authoritative for workspace, queue, prompt, event, recovery,
generated-package, or command policy.

Runtime post-commit, prompt dispatch, surface queue wake, and active prompt interruption semantics
are owned by runtime services. Runtime post-commit lanes publish committed invalidation descriptors
through the runtime event bus, wake runtime queue dispatchers, resolve runtime wait registries, and
acquire workspace/surface child scopes through runtime-owned package-private scope-manager services
implemented only with manifest-adopted Effect primitives. App/bootstrap may provide primitive host
capability ports as named dependencies of runtime-owned services, but those ports are not public
semantic callback surfaces and are not exported from `@svvy/runtime/bootstrap` unless this spec
names the exact tag, service shape, layer helper, and boundary test. Examples include process
launch, provider credential resolution, packaged path resolution, filesystem edge access, renderer
fanout adapters, and command stdin process handles. The semantic-looking public bootstrap host
ports are limited to the explicitly listed app-edge ports: `RuntimeLayerCommandStdinPort`,
`RuntimeLayerCommandControlPort`, `RuntimeLayerProviderAuthPort`, `RuntimeLayerModelResolverPort`,
`RuntimeGeneratedContextRefreshHostPort`, `RuntimeGeneratedPackageRefreshHostPort`, and
`RuntimeSourceInvalidationScanPort`.

Runtime active-turn cancellation is implemented by retained `RuntimeSurfaceRuntimeService` scopes
and the `@svvy/pi-adapter` turn interrupt path. App/bootstrap does not provide a prompt-control host
port, catalog callback, live pi handle, or cancellation delegate. Renderer, desktop, headless,
extension, generated-package, and agent-facing code can only request cancellation through the
runtime facade; runtime records the state facts and interrupts the retained surface scope.

Surface queue wakeup decisions also stay inside runtime. `RuntimeQueueWakeService.wakeSurface({
target, reason })` accepts the closed wake reason and calls the package-private
`RuntimeSurfaceQueueDispatcherService.acceptWakeHint(...)`; that service owns the drain loop and
uses `RuntimeSurfaceScopeService` to retain/release the addressed live surface while
`RuntimePromptExecutionService` owns prompt execution. App/bootstrap does not receive queued-row
payloads, dispatch results, pi session handles, callback functions, mutable state-port results, or
broad catalog access for wake/dispatch. Public bootstrap must not export callbacks named after
semantic runtime lifecycle events such as `afterRuntimeSurfaceMessageQueued`,
`afterRuntimeSurfaceMessageSteered`, `afterRequestInputAnswered`, `afterRequestInputTimerPaused`,
or `afterApprovalCommitted`. Those names describe runtime behavior and therefore belong inside
`@svvy/runtime`, backed by core-owned state ports, runtime-owned queues/wait registries, and
package-private child scopes.

The runtime wake reason shape is exact:

```ts
type RuntimeSurfaceQueueWakeReason =
  | "message-submitted"
  | "request-input-answer-queued"
  | "queue-steered"
  | "runtime-queue-inserted";
```

No public bootstrap method may wake, drain, claim, materialize, inspect, or reorder surface queue
rows. Adding a new wake reason requires the same change to update the reason union,
`RuntimeQueueWakeService` callsites, runtime tests, and package-boundary assertions.

Runtime-owned semantic lanes are package-private services. They are not public facade groups,
bootstrap exports, renderer bridge methods, or state facades:

- `RuntimeQueueWakeService` is the runtime-local wakeup scheduler for already committed surface
  work. Its authoritative inputs are DB/product-state-backed queue, request-input, command,
  recovery, surface, workspace, and generated-package rows read through core-owned state ports.
  Any in-memory Effect `Queue` is only a process-local wake hint and never the queue source of truth.
  The service accepts a `PromptTarget`, not a raw renderer panel id or a pi-native session object, so
  orchestrator and handler-thread wakeups use the same product target contract as runtime message
  submission. The service exposes this package-private shape:

  ```ts
  type RuntimeQueueWakeService = {
    wakeSurface(input: {
      target: PromptTarget;
      reason:
        | "message-submitted"
        | "request-input-answer-queued"
        | "queue-steered"
        | "runtime-queue-inserted";
    }): Effect.Effect<void, RuntimeContractError>;
  };
  ```

  Wake reasons are closed runtime values so tests can prove each caller is a known committed state
  transition. `message-submitted` is emitted only after a committed prompt-bearing surface queue row
  that should start normal delivery: a submitted `user_message` with enqueue-and-run delivery, or an
  accepted `thread_start` transaction that committed an `initial_handler_start` row for the handler
  surface. `request-input-answer-queued` is emitted only after the answer transaction commits a
  nonblocking answer delivery row. `queue-steered` is emitted only after a committed queue
  reorder/edit/promote operation requires the addressed surface to re-check its queue.
  `runtime-queue-inserted` is emitted only after the closed `queue.insert` runtime-effect applier
  commits an allowed internal queue row for the addressed surface. No other caller may reuse these
  reasons as a generic "queue changed" signal. The wake result returns no queued-row payload,
  dispatch result, or derived read-model data; UI consumers refetch DB-backed read models from
  runtime notifications. Workspace-scoped
  generated-package repair, recovery sweeps, and startup scans are runtime-owned workers with their
  own package-private wake or schedule services; they are not hidden behind this surface wake API.

- `RuntimeRequestInputWaitService` owns blocking request-input waiting plus post-answer and
  post-timer-pause behavior. It is backed by `RuntimeRequestStatePort`,
  `RuntimeCommandStatePort`, `RuntimeSessionWaitStatePort`, `RuntimeQueueWakeService`, and the
  process-local blocking request wait registry. Its package-private shape is:

  ```ts
  type RuntimeRequestInputWaitService = {
    waitForBlockingRequest(input: {
      request: RuntimeRequestInputDetailsRecord;
      command: RuntimeCommandRecord;
    }): Effect.Effect<RequestUserInputResult, RuntimeContractError>;

    afterAnswerCommitted(input: {
      surfacePiSessionId: SurfacePiSessionId;
      requestId: RequestInputRequestId;
      delivery:
        | { kind: "blocking-resolved"; queuedItemId: null }
        | { kind: "blocking-open"; queuedItemId: null }
        | { kind: "nonblocking-queued"; queuedItemId: QueueItemId }
        | { kind: "nonblocking-recorded"; queuedItemId: null };
      target: PromptTarget;
    }): Effect.Effect<void, RuntimeContractError>;

    afterTimerPausedCommitted(input: {
      requestId: RequestInputRequestId;
    }): Effect.Effect<void, RuntimeContractError>;
  };
  ```

  `waitForBlockingRequest(...)` parks the accepted tool call on the runtime-owned live handoff for
  the already committed blocking request and command, returning the model-facing
  `RequestUserInputResult` only after user answer, timeout default, cancellation, or recovery
  terminalizes the durable wait.
  `afterAnswerCommitted(...)` runs only after the answer transaction commits and committed
  invalidations are accepted for publication. For `blocking-resolved`, it resolves the live blocking
  `Deferred` only after durable answer, command, and wait state prove the blocking wait is still
  current. `blocking-open` means a blocking request answer was recorded while at least one question
  remains open, so it performs no queue wake and no blocking wait resolution. For
  `nonblocking-queued`, it wakes the committed owning `target` queue with the committed
  `queuedItemId`. For `nonblocking-recorded`, it performs no queue wake and no blocking wait
  resolution. The target comes from the committed `RuntimeRequestStatePort.answerRequestInput(...)`
  result, not from a post-answer request-input state read. `afterTimerPausedCommitted(...)`
  reschedules or clears only the process-local timeout that matches the committed timer version.
  Timeout fibers, timeout scan recovery, cancellation, turn interruption, surface/workspace close
  recovery, and startup recovery enter the same package-private blocking request-input lifecycle
  behind this service and its registry/state implementation. The lifecycle owns the durable
  compare-and-set transition that records the terminal request, answer, command, and wait facts;
  the public app/runtime facade does not expose separate timeout, recovery, cancellation, or
  registry-control methods. If the lifecycle needs additional package-private entry points, they
  must be specified here as runtime-owned service methods before implementation, not added as
  app/bootstrap callbacks or extension/state responsibilities.
  Neither method records the answer, mutates timer state, publishes renderer payloads, returns
  request-input read-model payloads, calls `RuntimeRequestStatePort.getRequestInput(...)` to derive
  wake behavior, or calls app/bootstrap.

- `RuntimeApprovalWaitService` owns process-local approval waiters inside the runtime-owned accepted
  native-tool execution lane after that lane has created the DB/product-state-backed approval
  request, command waiting facts, and session wait facts through core-owned state ports. The service is a runtime-owned waiter registry,
  not a state writer: it resumes or cancels the active tool call only after the durable approval
  transition has committed and published. The service instance is constructed inside
  `Runtime.layer` so direct-tool approval creation and `Runtime.approvals.answer(...)` share the
  same process-local waiter map within the single app-owned `ManagedRuntime`. App/bootstrap only
  composes the layer and never imports or constructs the registry. Its package-private shape is:

  ```ts
  type RuntimeApprovalWaitService = {
    waitForApproval(input: {
      request: RuntimeApprovalRecord;
    }): Effect.Effect<RuntimeApprovalDecision, RuntimeContractError>;

    afterApprovalCommitted(input: {
      request: RuntimeApprovalRecord;
      approved: boolean;
      reason?: string | null;
    }): Effect.Effect<void, RuntimeContractError>;

    cancelApprovalWait(input: {
      request: RuntimeApprovalRecord;
      reason: string;
    }): Effect.Effect<void, RuntimeContractError>;

    cancelAllApprovalWaits(input: { reason: string }): Effect.Effect<void, RuntimeContractError>;
  };
  ```

  Approval state is DB/product-state-backed. The process-local `Deferred` only resumes the active
  tool call after the committed approval transition wins. Approval admission, approval request
  creation, and approval waiting are one runtime-owned accepted native-tool execution lane;
  app/bootstrap does not provide a broad approval lifecycle callback such as `RuntimeLayerApprovalPostCommitPort`,
  `RuntimeApprovalAnswerPostCommitHost`, `resolveRuntimeApprovalAnswer(...)`, or a catalog callback.

- `RuntimeSurfaceQueueDispatcherService` owns queue claiming and draining for a surface. It is a
  runtime-owned dispatcher backed by runtime-owned workspace/surface scope-manager services plus
  core-owned state ports, not an app/bootstrap host port, catalog callback object, renderer bridge,
  facade adapter, or wake-scheduling service. It exposes package-private `acceptWakeHint(...)` and
  `drain(...)` effects. Wake scheduling enters the dispatcher only as coalescible `QueueWakeup`
  hints produced by `RuntimeQueueWakeService.wakeSurface({ target, reason })` after committed state
  changes.
  Queue rows, claim leases, turn rows, and terminal facts are DB/product-state-backed; active
  prompt fibers, prompt locks, and queue wake hints are scoped runtime resources.

- `RuntimePromptDefaultsService.resolve(...)` is a narrow defaults resolver over
  `RuntimePromptDefaultsStatePort.resolvePromptDefaults(...)`; it returns only DB/product-state-backed
  provider, model, and reasoning defaults and maps state failures to runtime contract errors.
  Prompt-bearing dispatch is not complete until the package-private dispatch resolver composes those
  defaults with `RuntimeActorExtensionBindingStatePort.readRuntimePromptBinding(...)` for the
  DB/product-state-backed committed binding id, generated-context fingerprint/revision, bound
  extension ids, external source hashes, and update-before-next-turn intent, plus
  `@svvy/extensions` prompt/generated-context services for generated system-prompt material and when
  runtime must refresh file-backed prompt and generated-context evidence before dispatch. The
  prompt-defaults state port
  intentionally returns only provider/model/reasoning; the actor binding state port intentionally
  returns only committed prompt binding facts. Generated-context previews, extension instruction
  bodies, tool declaration payloads, and pi-native model objects are not state-port payloads. The
  runtime service does not call app/bootstrap for defaults and does not return prompt text to
  callers outside the committed generated-context/prompt-dispatch contract.

- `RuntimePromptExecutionService` materializes a claimed queued message into pi work through
  `@svvy/pi-adapter`, owns the active-turn fiber, stream consumption, tool-call acceptance,
  command facts, prompt cancellation, title scheduling, queue settlement, and runtime event
  publication. It reads file-backed prompt/instruction assets only through `@svvy/extensions` and
  reads/writes product state only through core-owned state ports. The service returns committed turn
  and command receipts to its caller; transcript, command, queue, and event read models remain
  state-backed.

- `RuntimeSurfaceRuntimeService` is the scoped value acquired from the runtime-owned surface scope
  manager for one durable `surfacePiSessionId`. The scoped value owns the live pi session handle,
  prompt lock, active prompt fiber,
  surface-local wait registries, command session handles, and finalizers. Durable pi-session
  references, transcript facts, command facts, wait rows, and surface lifecycle state remain
  DB/product-state-backed.

The dependency order is strict. `RuntimeQueueWakeService` and `RuntimeRequestInputWaitService` own
queued-answer wakeup, blocking wait resolution, and timer rescheduling. Accepted native-tool
execution creates approval requests and waits on approvals through `RuntimeApprovalWaitService`.
Prompt execution owns the runtime-owned surface scope manager, prompt-default resolution, queue
dispatch, prompt execution, cancellation, and surface runtime scopes over the required
`@svvy/pi-adapter` session/turn operations. App/bootstrap may provide primitive pi, process,
filesystem, credential, packaged-path, and renderer fanout capabilities, but never semantic
lifecycle callbacks.

Runtime-owned routing is package-private and deterministic:

- Workspace-addressed public methods use an explicit `workspaceId` from the decoded input or the
  workspace id returned by the state port commit they just performed. They then borrow
  the workspace runtime scope inside the caller effect scope when they need scoped workspace
  services such as queue dispatch, source coordination, recovery, app-log routing,
  generated-package link repair, or workspace shutdown state.
- Surface-addressed public methods use the decoded `surfacePiSessionId` from the public target.
  Runtime reads the owning workspace/session facts through core-owned state ports when the method
  needs workspace-scoped services, validates that the surface belongs to the addressed workspace
  when both ids are present, and borrows the surface runtime scope only for live surface services
  such as pi session materialization, prompt locks, active stream fibers, blocking wait ownership,
  and surface-local command sessions.
- Command-addressed public methods such as `commands.writeStdin(...)`,
  `commands.cancel(...)`, approval resolution, and command-linked workflow task-agent bridge work
  first read the durable command row through
  `RuntimeCommandStatePort` by `CommandId`. That row is the authoritative route to the owning
  workspace/session/surface and terminal state. Runtime never routes command work by shell
  `session_id`, process id, app-local map key, or caller-supplied workspace metadata.
- App-global public methods and workers use app-scoped runtime services acquired once inside
  `Runtime.layer`. They do not pick an arbitrary workspace runtime scope as an owner for app-global work.
  App-global generated-package refresh records app-global facts first, then schedules separate
  workspace link repair for each acquired or recoverable workspace.
- If a route cannot be proven from decoded input plus committed state facts, the method fails with
  the exact public `RuntimeContractError` reason named in the method ledger (`target-not-found`,
  `stale-state`, `state-conflict`, `runtime-shutdown`, or `runtime-disposed`). Runtime does not
  fall back to the focused desktop pane, the last opened workspace, a registry default, a first map
  entry, or any route not proven by decoded input plus committed state facts.

Promise/`AsyncIterable` facade:

```ts
import { createRuntimeFacade } from "@svvy/runtime";

const runtime = createRuntimeFacade(managedRuntime);

await runtime.workspaces.acquire({ owner, cwd, openReason: "user-open" });

await runtime.surfaces.createOrchestrator({ workspaceId, title: "Main" });

await runtime.messages.submit({ target, message: { text }, delivery: "enqueue-and-run" });

await runtime.commands.writeStdin({ commandId, text: "y\n" });

await runtime.approvals.answer({ approvalId, decision: "approved" });

const subscription = await runtime.events({
  workspaceId,
  workspaceSessionId,
  afterSequence,
});

for await (const event of subscription) {
  consume(event);
}

const closeReceipt = await subscription.closed;
if (closeReceipt.rebaselineRequired) {
  await refetchReadModels();
}
```

The `events(...)` input fields are filtering and cursor fields over the single app runtime event
bus. They do not select a workspace runtime, create a per-workspace facade, or grant
app/bootstrap routing authority.

Package root API surface includes only `Runtime`, `Runtime.layer`, the root `layer` alias, and
`createRuntimeFacade(...)`. `Runtime.layer` is the production package-owned Effect layer for the
complete `Runtime` service; the root `layer` export is only an alias of `Runtime.layer`.
`createRuntimeFacade(...)` is a mechanical adapter over an app/bootstrap-owned `ManagedRuntime` and
exposes the same public API groups as the `Runtime` service:
`workspaces`, `surfaces`, `messages`, `queues`, `requestInput`, `commands`, `approvals`,
`sourceEdits`, `sourceInvalidation`, and `events`. The facade also owns caller cleanup through
`close()`. `close()` marks only that facade instance closed, rejects still-waiting facade calls with
the facade `disposed` error, closes active event subscriptions, and prevents new calls through that
facade instance. The facade must not expose `handlerThreads`, `recovery`,
`workflowTaskAgentBridge`, dependency-action public facades, dependency-action
continuation/admission calls, `sourceInvalidation.productStateChanged(...)`, or any facade group
without a schema-backed runtime method.
It does not call `prepareRuntimeShutdown(...)`, does not dispose the app-owned
`ManagedRuntime`, and does not close runtime admission for other facades or app/bootstrap bridges.
`close()` is not a runtime service API group. `Runtime.layer` is not parameterized by an
app-supplied `RuntimeService`, callback table, catalog, workspace registry, or fake service object.
No service-lifting helper such as `Runtime.layer(service)` or `layerRuntime(service)` is part of the
package-root API. A `Layer.succeed(Runtime, fake)` helper is allowed only inside tests or internal
fixtures and is never exported from the package root as a public runtime layer. App bootstrap
composes concrete services, awaits `managedRuntime.context()`,
awaits runtime-owned startup readiness, exposes facades only after readiness, and owns shutdown
preparation plus disposal. The single canonical public service shape is the `Runtime` class above.
Package code and tests must not maintain either a narrower facade for implemented methods or a wider
facade with groups that lack implemented runtime methods.

The public runtime service shape and facade expose only methods whose schema-backed input/result
contracts, public error mapping, state ports, runtime-owned services, emitted
invalidations/events, shutdown behavior, and Effect-lane tests exist. Package-private internal code
is not a public runtime surface. `Runtime`, `Runtime.layer`, and `createRuntimeFacade(...)` expose
only production methods with the owning Effect service and state-port contract in place. They do not
expose a method that returns `unsupported-operation` instead of a production implementation,
delegate product policy to app/bootstrap callback objects, or admit work without the owning service
graph. When `unsupported-operation` appears in a method contract table, tests prove it is reached
only after schema decoding and explicit domain/scope/capability validation, not because the service
path is unwired.

The `@svvy/runtime` package export map exposes exactly `.`, `./bootstrap`,
`./prompt-execution-context`, `./accepted-native-tool-execution`,
`./app-log-commit-notification-adapter`, and `./source-invalidation-coordinator-adapter`. Prompt execution context content stripping, live
invocation handles, and runtime-owned prompt execution helpers are package-private implementation
details except for the narrow constructor/live-handle type surface named below. `@svvy/core` exports
only the schema-backed prompt execution context DTOs. The package root value surface is explicit:
`Runtime`, `Runtime.layer`, `layer`, and `createRuntimeFacade(...)`. These are boundary-tested root
contracts.
Public callers type the facade as
`ReturnType<typeof createRuntimeFacade>` or narrower local aliases derived from that return type.
`@svvy/runtime` does not export a separate executable facade service, facade class, facade group type
namespace, or concrete facade error class from the package root. Runtime event subscription payload
contracts come from `@svvy/core`; RuntimeEffectRequest appliers, svvyx runtime-effect transport
helpers, event-bus internals, prompt-execution handles, prompt-execution-context construction,
layer config helpers, and bootstrap helpers remain off the package root. Public callers use
core-owned encoded error contracts and facade
Promise/stream rejection behavior; they do not import a runtime-owned error class from the package
root.

App-bootstrap-only helpers live under `@svvy/runtime/bootstrap`: `RuntimeLayerConfig`,
`RuntimeLayerConfigInputSchema`, `RuntimeLayerConfigSchema`, `RuntimeLayerConfigFromEnv`,
`defaultRuntimeLayerConfig`, `RuntimeLayerConfigService`, `RuntimeLayerError`,
`RuntimeLayerErrorSchema`, `decodeUnknownRuntimeLayerErrorEffect`,
`decodeUnknownRuntimeLayerErrorExit`, `encodeRuntimeLayerErrorEffect`,
`encodeRuntimeLayerErrorExit`, `RuntimeStartupPhase`, `RuntimeStartupReadiness`,
`RuntimeStartupReadinessReceipt`, `RuntimeStartupDegradedPhase`, `RuntimeStartupError`,
`RuntimeStartupErrorSchema`, `RuntimeLayerCommandStdinPort`,
`RuntimeLayerCommandStdinPortService`, `RuntimeLayerCommandControlPort`,
`RuntimeLayerCommandControlPortService`, `RuntimeLayerProviderAuthPort`,
`RuntimeLayerProviderAuthPortService`, `RuntimeLayerModelResolverPort`,
`RuntimeLayerModelResolverPortService`, `RuntimeGeneratedContextRefreshHostPort`,
`RuntimeGeneratedContextRefreshHostPortService`, `RuntimeGeneratedPackageRefreshHostPort`,
`RuntimeGeneratedPackageRefreshHostPortService`, `RuntimeSourceInvalidationScanPort`,
`RuntimeSourceInvalidationScanPortService`, `RuntimeGeneratedPackageWorkspaceLinkFileHost`,
`RuntimeSourceInvalidationDirectoryEntry`, `RuntimeSourceInvalidationDomain`,
`RuntimeSourceInvalidationEvent`, `RuntimeSourceInvalidationHost`, `RuntimeSourceWatchInput`,
`RuntimeSurfaceQueueWakeReason`,
`RuntimeWorkflowTaskAgentBridgeBearerVerifier`,
`RuntimeWorkflowTaskAgentBridgeBearerVerifierService`,
`RuntimeShutdownPreparation`, `RuntimePrepareShutdownReason`,
`RuntimePrepareShutdownRequest`, `RuntimePrepareShutdownResult`,
`createRuntimeLayerConfigLayer(...)`, `awaitRuntimeStartupReadiness(...)`,
`prepareRuntimeShutdown(...)`, `layerRuntimeStartupReadiness`, `layerRuntimeShutdownPreparation`,
`layerRuntimeBunPlatform`, and `RuntimeBunPlatformServices`.
`RuntimeLayerRequirements`, `RuntimeLayer`, and `makeRuntimeService()` are source-level
implementation-module exports only for runtime package implementation and colocated tests. They are
not exported from the package root or `@svvy/runtime/bootstrap`, and app/bootstrap consumers must not
import them as public composition contracts. These host ports are primitive app-edge adapters that
let `Runtime.layer` call the already owned app/pi/host infrastructure while runtime retains product
semantics. Active prompt cancellation and queue wake/drain are runtime-owned through retained
surface scopes, `PiAdapter.turns.interrupt(...)`, `RuntimeQueueWakeService`, and
`RuntimeSurfaceQueueDispatcherService`.
`RuntimeLayerCommandStdinPort` and `RuntimeLayerCommandControlPort` adapt host process stdin and
control primitives behind runtime command authority. The generated-context, generated-package, and
source-scan ports adapt existing app-edge source/build machinery while runtime owns scheduling,
state facts, link repair, notification, and recovery semantics. Provider-auth and model-resolver
ports adapt app-owned credential/model availability sources into runtime admission; they do not own
provider settings persistence, model policy, or pi session handles. None of these ports may perform
queue claiming, turn settlement, state mutation outside their named primitive action, runtime event
publication, extension handler invocation, accepted-tool execution, or recovery policy. The
Smithers workflow task-agent loopback bridge is an app-bootstrap binding around the runtime-owned
authenticated `runTaskAgent` path; it is not an exported `@svvy/runtime/bootstrap`
symbol, not a package-root API, not a public runtime facade group, and not a general workflow or
Smithers command surface. App/bootstrap owns the Bun HTTP route binding,
request-body decoding, host server lifecycle, and transport-level response writing; runtime owns
token-lineage authorization, command/source identity validation, task-attempt surface creation,
queue insertion, event publication, recovery facts, bridge shutdown behavior, and typed result/error
mapping. Renderer code, `@svvy/desktop` package modules, extensions, generated packages,
browser-tool adapters, headless automation adapters, and alternate app consumers do not import
loopback bridge helpers. `@svvy/runtime/bootstrap` must not export runtime semantic callback ports,
post-commit host ports, runtime-effect appliers, accepted-tool operation helpers, source
coordinators, queue dispatchers, generated-package repair executors, event-bus internals, wait
registries, runtime scope services, `RuntimeWorkspaceScopeService`, or
`layerRuntimeWorkspaceScopeService` unless the exact symbol is named in the bootstrap helper list
above.

`@svvy/runtime/accepted-native-tool-execution` is the only public adapter over the
runtime-owned accepted native-tool execution service. It exports Promise functions that require the
already acquired app-owned `ManagedRuntime`; it does not export the accepted-tool service tag,
service interface, layer, dispatcher, extension handler, runtime-effect applier, or facade group.
The exact exported types and functions are listed in the Accepted Native Tool Execution section
below; this bootstrap surface inventory is not a second API definition.

`@svvy/runtime/app-log-commit-notification-adapter` is the only public adapter for notifying the
runtime that a state-owned app-log facade subscription observed a real committed append. Its entire
public API is:

```ts
export type AppLogCommitNotificationInput = { readonly workspaceId?: WorkspaceId };

export function notifyCommittedAppLogAppend<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: AppLogCommitNotificationInput,
): Promise<void>;
```

App/bootstrap calls this adapter only from a post-commit `StateAppLogsFacade.subscribe(...)`
notification with at least one appended entry. The optional `workspaceId` identifies the
state-owned workspace app-log source that produced the committed append; absence means the
app-global source. The adapter accepts no `StateInvalidationDescriptor`, read-model name, runtime
event, receipt, renderer target, or retry instruction. It runs the package-private
`RuntimeAppLogCommitNotification` service inside the already acquired app-owned `ManagedRuntime`;
that runtime-owned service maps the committed source scope to the single `appLogs` invalidation and
publishes it through `RuntimeEventBus`. The service tag, service interface, layer, descriptor
mapping, and event-bus access stay package-private and are not facade groups or bootstrap exports.

`@svvy/runtime/source-invalidation-coordinator-adapter` is the only public adapter over
runtime-owned source-invalidation coordinator handles. Its entire public API is:

```ts
export type RuntimeSourceInvalidationCoordinatorHandleOptions =
  SourceInvalidationCoordinatorOptions;

export type RuntimeSourceInvalidationCoordinatorHandle = {
  classifyHint(
    input: Parameters<SourceInvalidationCoordinator["classifyHint"]>[0],
  ): Promise<"scan" | "scan-parent-domain" | "ignore">;
  close(): Promise<void>;
  reconcile(input: {
    domains?: readonly RuntimeSourceInvalidationDomain[];
    reason: string;
  }): Promise<SourceInvalidationEvent | null>;
  ready(): Promise<void>;
  refreshWatchedInputs(reason?: string): Promise<void>;
  requestScan(input: Parameters<SourceInvalidationCoordinator["requestScan"]>[0]): Promise<void>;
};

export function createRuntimeSourceInvalidationCoordinatorHandle(
  options: RuntimeSourceInvalidationCoordinatorHandleOptions,
): RuntimeSourceInvalidationCoordinatorHandle;
```

The adapter may be imported only by app/bootstrap source-root and workspace-scope binding code that
starts, waits for, signals, reconciles, and closes app-global or workspace source coordinators used
behind `RuntimeSourceInvalidationScanPort`. It does not export
`RuntimeSourceInvalidationCoordinator`, `RuntimeSourceInvalidationCoordinatorService`,
`layerRuntimeSourceInvalidationCoordinator`, watcher tables, source policy, state writers,
descriptor publishers, generated refresh services, or source-invalidation facade groups.

`RuntimeLayerProviderAuthPortService` is Effect-shaped inside `@svvy/runtime`; Promise-based
credential lookup is allowed only at the app/bootstrap adapter that provides the port:

```ts
export interface RuntimeLayerProviderAuthPortService {
  ensureUsableProviderAuth(
    provider: string,
  ): Effect.Effect<string | undefined, RuntimeContractError>;
  getProviderAuthUnavailableMessage(provider: string): string;
}
```

`ensureUsableProviderAuth(provider)` returns the usable live provider credential material required
for pi admission, or `undefined` when the provider is unavailable. Runtime maps `undefined` to a
typed `target-not-ready` submission failure and app-log warning. The method does not persist
provider settings, mutate credential state, expose redacted status rows, select a model, or create
pi sessions. App/bootstrap may adapt an existing Promise-returning credential helper with
`Effect.tryPromise(...)` before satisfying `RuntimeLayerProviderAuthPort`; runtime package code must
not wrap this port method in `Effect.tryPromise(...)` or treat it as a callback object.

This restriction applies to package exports and direct source imports. App/bootstrap, browser-tool
adapters, headless adapters, desktop bridge code, renderer code, extensions, generated packages, and
alternate app consumers must not bypass the export map with relative imports into
`@svvy/runtime/src/**`. Boundary tests resolve relative imports and reject imports of runtime wait
services, queue dispatchers, source-invalidation coordinators, generated-package refresh or repair
internals, runtime scope services, `RuntimeWorkspaceScopeService`,
`layerRuntimeWorkspaceScopeService`, event buses, runtime-effect appliers, accepted-tool helpers,
prompt-execution helpers, or internal service constructors outside `@svvy/runtime` implementation
files, approved runtime test fixtures, and the named public
`@svvy/runtime/source-invalidation-coordinator-adapter` handle surface.

App/bootstrap owns exactly one app-scoped `ManagedRuntime` for product execution. Workspace, surface, and workflow
task-attempt ownership is represented by runtime-owned keyed child scopes inside that app runtime,
not by per-workspace `ManagedRuntime` instances or facade-owned runtime singletons. App-global
generated-package refresh runs in an app-scoped runtime lane and never selects an arbitrary acquired
workspace as the owner. Startup readiness covers layer acquisition, event-bus readiness,
app-source reconcile, generated-package reconcile, and recovery startup scan before app/bootstrap
exposes facades. Shutdown preparation is the bootstrap-only pre-disposal barrier that closes
runtime admission, drains or terminalizes admitted queue, command, request-input, and task-agent
work, records recovery or interruption facts, revokes task-agent bridge tokens, closes event
subscriptions with receipts, and returns before app/bootstrap disposes the app-owned
`ManagedRuntime`. `RuntimeLayerRequirements` contains only concrete package
services, core-owned state ports, platform services, bootstrap config/readiness services, and
spec-approved primitive host ports. Command stdin/control, generated-context refresh,
generated-package refresh, source invalidation scan, queue wake, provider auth, and model resolving
enter runtime through those named primitive host ports; request-input, approval, accepted-tool
execution, event publication, queue dispatch, generated-package link repair, source invalidation
policy, and command lifecycle semantics are runtime-owned services backed by package services and
core-owned state ports, not app/bootstrap callback policy.

App/bootstrap satisfies runtime routing state by composing core-owned state-port layers implemented
by `@svvy/state` into that single app runtime. Routing-authoritative state ports include
`RuntimeWorkspaceStatePort`, `RuntimeSurfaceLifecycleStatePort`, `RuntimeQueueStatePort`,
`RuntimeCommandStatePort`, `RuntimeThreadStatePort`, `RuntimeTurnStatePort`,
`RuntimeRequestStatePort`, `RuntimeApprovalStatePort`, `RuntimeSessionWaitStatePort`,
`RuntimeEpisodeStatePort`, `RuntimeSourceStatePort`, `RuntimeGeneratedPackageStatePort`,
`RuntimeArtifactStatePort`, `RuntimeComposerDraftStatePort`, `RuntimeExtensionStatePort`,
`RuntimeActorExtensionBindingStatePort`, `RuntimeExtensionContextImpactStatePort`,
`RuntimeRecoveryStatePort`, and `RuntimeReadModelStatePort`. These ports are state-backed routing
fact providers, not app/bootstrap route resolver callbacks. App/bootstrap may compose their layers
into the app runtime graph, but must not wrap them with workspace registries, focused-pane defaults,
per-request routing maps, callback tables, or alternate runtime instances as routing authority.
Runtime methods prove routes from decoded input plus committed state-port facts inside the acquired
app runtime. If the proof is absent or contradictory, the method fails with the ledger-listed
`RuntimeContractError` reason and does not fall back to host state.

Startup readiness is represented for app/bootstrap by `RuntimeStartupReadiness`,
`layerRuntimeStartupReadiness`, and `awaitRuntimeStartupReadiness(managedRuntime)`. It returns
`RuntimeStartupReadinessReceipt` with `status: "ready" | "degraded-ready"`, `completedPhases`, and
`degradedPhases`, or fails with `RuntimeStartupError`. The public facade surface does not expose
readiness as a runtime API group, and readiness does not create a second runtime lifecycle.

The public runtime API excludes `commands.runExtensionDependencyAction(...)`; extension dependency
install/update behavior belongs only to the complete runtime-owned lifecycle contract with schemas,
implementation, state/package contracts, public error mapping, and tests. Implementations must not
export dependency install/update admission unless the complete runtime-owned lifecycle contract is
specified and implemented. Dependency approval answering uses the generic
`runtime.approvals.answer(...)` contract for an already-created approval whose
`approvalKind: "dependency"`; that generic approval API is not a dependency install/update
admission surface.

`@svvy/core` owns only the
schema-backed prompt execution context data contract, derived types, and boundary codecs. Runtime
owns content-stripping construction helpers, live prompt invocation/runtime handles, and production
derivation of prompt execution context input from durable state and queue claims. The only public
package surface for the runtime-owned constructor and live handle type is the narrow
`@svvy/runtime/prompt-execution-context` subpath. Prompt execution context is not a bootstrap API,
package-root runtime API, public app-developer workflow API, renderer bridge payload, browser-tool
input, or headless automation input. App developers receive prompt execution information through
state-backed read models and runtime events, not by constructing turn contexts directly.

`prepareRuntimeShutdown(managedRuntime, input)` is the bootstrap-only pre-disposal shutdown barrier.
Calling it is the transition that closes runtime admission. Before the transition, public facades and
task-agent bridge calls follow normal readiness/admission rules. After the transition commits the
shutdown-started marker, every public facade group, event subscription request, task-agent bridge
call, queue wake, source scan, command start, command stdin write, approval wait, request-input
wait, generated-package refresh, workspace-link repair, and queue claim is rejected or ignored with
the typed shutdown/disposed path unless it is already part of admitted shutdown preparation work.
The bootstrap shutdown helper itself remains admitted and is idempotent for the active app runtime:
concurrent or repeated calls observe the same shutdown generation and return the existing or final
shutdown receipt rather than opening a second drain.

This shutdown/disposed path is the runtime contract path returned by runtime-owned Effect methods
and schema-backed facade calls that reach the runtime service. It is distinct from facade-local
`RuntimeFacadeErrorContract.reason: "disposed"`, which means only the Promise/AsyncIterable facade
instance was closed before or during a call.

Shutdown drains the post-commit publication barrier for descriptors that already committed before
the shutdown-started marker, records recovery work or app-log facts for committed descriptors that
cannot be published, requests bounded queue/recovery/command/request-input drain or
terminalization, records shutdown receipts and app-log facts for interrupted user-visible work
through state ports, releases queue claims and runtime-local waiters, revokes task-agent bridge
tokens, closes event subscriptions with typed close receipts after the final publication barrier,
and returns a shutdown receipt before app/bootstrap calls `managedRuntime.dispose()` /
`disposeEffect`. Any state mutation that commits after shutdown admission closes is an
implementation defect unless it is one of these admitted shutdown writes: shutdown lifecycle facts,
interrupted-work command/turn/request/approval facts, queue-claim release facts, recovery rows,
app-log rows, task-agent token revocation facts, event-subscription close receipts, or the final
shutdown receipt. It does not close the database or platform resources itself; those resources close
when the app-owned `ManagedRuntime` disposes the acquired layer scope. Shutdown/recovery/app-log
facts committed after the final publication barrier are product-state records only; they are
intentionally not required to produce runtime event delivery because event subscriptions are
closing. The next app startup, state read-model refetch, or recovery lane observes those facts from
durable state.
Layer finalizers are cleanup and test-receipt surfaces, not product-state authors. Runtime shutdown
records user-visible shutdown, cancellation, timeout, forced-disposal, and recovery facts before it
closes workspace/surface scopes or disposes the app-owned `ManagedRuntime`; implementation must not
infer product semantics from the `ManagedRuntime.dispose()` / `disposeEffect` `Exit.void` cleanup
path.

`RuntimeLayerConfigService` is a bootstrap-only service token exported from
`@svvy/runtime/bootstrap`, not from the package root. The package-internal
`RuntimeLayerRequirements` and `RuntimeLayer` type aliases may be mentioned only in
`runtime-layer.ts`; `makeRuntimeService()` may be imported only by `packages/runtime/src/index.ts`
and colocated runtime tests to build `Layer.effect(Runtime, makeRuntimeService())`. The public
bootstrap subpath and application bootstrap code do not import or expose those implementation
symbols. App/bootstrap composes the concrete requirement layers and relies on `Layer.provide(...)` /
TypeScript inference against `Runtime.layer`.

`layerRuntimeBunPlatform` provides only the abstract `FileSystem.FileSystem`, `Path.Path`, and
`Crypto.Crypto` services from the installed Bun platform layers. It is app/bootstrap infrastructure,
not a domain service, and it does not provide child-process, HTTP, terminal, stdio, SQL, or generic
Bun service bundles.

Promoted public API groups:

- `workspaces`
- `surfaces`
- `messages`
- `queues`
- `commands`
- `approvals`
- `requestInput`
- `sourceEdits`
- `sourceInvalidation`
- `events`

Runtime-owned domains such as worktrees, turns, handler threads, title jobs, and recovery remain
internal runtime responsibilities. They are excluded from public API groups unless this spec contains
exact methods, schema-backed inputs/outputs, public typed error reasons, state port calls, emitted
runtime invalidations, and test-layer coverage for that public API group.

Every promoted public API group must have an explicit method contract table in this spec before an
implementation exports it:

```ts
type RuntimeMethodContract = {
  method: string;
  inputCodec: string;
  resultCodec: string | null;
  publicErrors: readonly RuntimeContractErrorReason[];
  statePorts: readonly string[];
  emittedEvents: readonly RuntimeEventType[];
  emittedInvalidations: readonly RuntimeReadModelInvalidationKey[];
  requiredTests: readonly string[];
};
```

`inputCodec` and `resultCodec` are concrete exported schema/codec names, not prose descriptions.
`publicErrors` is the closed user-visible reason set for that method. `statePorts` names the exact
state service methods called by the runtime method. `emittedEvents` and `emittedInvalidations` name
observable notifications emitted after the successful state commit. `requiredTests` names the unit,
contract, and integration fixtures that must move with the method. A public group without this table
is incomplete, even if its TypeScript surface is sketched elsewhere.

All schema-backed facade methods also expose `RuntimeContractError.reason: "schema-error"` when the
boundary input fails its exported codec before domain validation starts. Ledger row `publicErrors`
then names the method's domain/runtime errors after successful boundary decoding, including
`invalid-input` for semantically invalid but schema-shaped input.

`Events` names live runtime event types only: non-authoritative progress, stream, queue, command, or
read-model invalidation notifications published by runtime. `Invalidations` names the
`StateInvalidationDescriptor.invalidation.model` values returned by committed state writes. It does
not let callers fabricate descriptors.

Canonical public runtime method contract ledger:

| Method                                        | Input codec                                                                                                              | Result codec                                                                                                                                                                  | Public errors                                                                                                                                    | State/package ports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Events                                                                                                                                                                                                                                     | Invalidations                                                                                                                                | Required tests                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces.acquire`                          | `AcquireWorkspaceInputSchema`                                                                                            | `AcquireWorkspaceResultSchema`                                                                                                                                                | `invalid-input`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                                        | `RuntimeWorkspaceStatePort.acquireWorkspace(...)` for durable workspace/session ownership facts; owner-scope workspace runtime scope acquisition for readiness-sensitive scoped runtime services. Source coordinator startup and watched-input refresh belong to the scan-port/coordinator owner-scope binding, not the public method body.                                                                                                                                                                                                                                                                                                                                                                                                                        | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                                                                                               | `sessionNavigation`                                                                                                                          | workspace acquire/create/reopen, duplicate owner, shutdown rejection                                                                                                         |
| `workspaces.acquireDefault`                   | `AcquireDefaultWorkspaceInputSchema`                                                                                     | `AcquireWorkspaceResultSchema`                                                                                                                                                | `invalid-input`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                                        | `RuntimeWorkspaceStatePort.acquireDefaultWorkspace(...)` for durable default-workspace facts; owner-scope workspace runtime scope acquisition for readiness-sensitive scoped runtime services. Source coordinator startup and watched-input refresh belong to the scan-port/coordinator owner-scope binding, not the public method body.                                                                                                                                                                                                                                                                                                                                                                                                                           | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                                                                                               | `sessionNavigation`                                                                                                                          | default workspace acquire, persisted cwd, startup readiness                                                                                                                  |
| `workspaces.release`                          | `ReleaseWorkspaceInputSchema`                                                                                            | `ReleaseWorkspaceResultSchema`                                                                                                                                                | `invalid-input`, `target-not-found`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                    | `RuntimeWorkspaceStatePort.releaseWorkspace(...)` for durable owner/reference facts; runtime closes the keyed workspace scope only when release policy says no live owner remains; `RuntimeRecoveryCoordinator.wake(...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                                                                                               | `surface`, `sessionNavigation`                                                                                                               | release last owner, retained active surface, shutdown finalizer                                                                                                              |
| `surfaces.createOrchestrator`                 | `CreateOrchestratorSurfaceInputSchema`                                                                                   | `CreateSurfaceResultSchema`                                                                                                                                                   | `invalid-input`, `target-not-found`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                    | `RuntimeSurfaceLifecycleStatePort.createOrchestratorSurface(...)` for durable surface/session facts; `RuntimeActorExtensionBindingStatePort.setActorExtensionBinding(...)` for initial generated-context binding facts; owner-scope workspace runtime acquisition followed by retained surface runtime scope acquisition for the live surface; `PiAdapter.sessions.create(...)` inside that retained surface scope only                                                                                                                                                                                                                                                                                                                                            | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`, `surface.changed(reason: "surface.updated")`                                                                                                                 | `surface`, `sessionNavigation`                                                                                                               | create surface, pi session reference, generated-context binding, invalid profile                                                                                             |
| `surfaces.open`                               | `OpenSurfaceInputSchema`                                                                                                 | `OpenSurfaceResultSchema`                                                                                                                                                     | `invalid-input`, `target-not-found`, `stale-state`, `runtime-shutdown`, `runtime-disposed`                                                       | `RuntimeSurfaceLifecycleStatePort.openSurface(...)` for durable open/reference facts; owner-scope surface runtime acquisition and `PiAdapter.sessions.open(...)` for live scoped materialization; pi session reference lookup and validation happen inside `@svvy/pi-adapter` through the state-backed `PiSessionReferencePort` dependency, with `PiAdapterError` mapped to runtime errors                                                                                                                                                                                                                                                                                                                                                                         | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`, `surface.changed(reason: "surface.updated")`                                                                                                                 | `surface`, `sessionNavigation`                                                                                                               | reopen existing pi session, missing reference, stale context                                                                                                                 |
| `surfaces.close`                              | `CloseSurfaceInputSchema`                                                                                                | `CloseSurfaceResultSchema`                                                                                                                                                    | `invalid-input`, `target-not-found`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                    | `RuntimeSurfaceLifecycleStatePort.closeSurface(...)` for durable close/reference facts; runtime closes or interrupts keyed surface resources only after prompt-lock, wait, command, and retention policy allows it; `RuntimeCommandStatePort`, `RuntimeSessionWaitStatePort`, `RuntimeRequestStatePort` cleanup methods                                                                                                                                                                                                                                                                                                                                                                                                                                            | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`, `surface.changed(reason: "surface.closed")`; `surface.stream` only for active-turn cancellation/rebaseline patches                                           | `surface`, `requestInput`, `commandInspector`                                                                                                | close idle/running/waiting surface, active turn cancellation, wait cleanup                                                                                                   |
| `messages.submit`                             | `SubmitMessageInputSchema`                                                                                               | `SubmitMessageResultSchema`                                                                                                                                                   | `invalid-input`, `target-not-found`, `target-not-ready`, `stale-state`, `state-conflict`, `backpressure`, `runtime-shutdown`, `runtime-disposed` | `RuntimeQueueStatePort.acceptSubmittedSurfaceMessage(...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | descriptor-derived `workspace_read_model.changed` / `app_read_model.changed`; no `queue.changed` event is emitted by this public method unless a queue lifecycle publisher commits and publishes that event from authoritative queue state | `surface`, `requestInput`                                                                                                                    | enqueue-and-run, queue-only, idempotency, renderer-field rejection, after-commit publication                                                                                 |
| `messages.abort`                              | `AbortPromptInputSchema`                                                                                                 | null                                                                                                                                                                          | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                     | `RuntimeQueueStatePort.cancelSurfaceMessage(...)` with a queued/steering status guard for queued rows; claimed/dispatching rows are rejected so callers use active-turn cancellation for already-dispatching prompts; active-turn cancellation interrupts the runtime-owned active-turn fiber and records the terminal turn through `RuntimeTurnStatePort.finishTurn(...)`; affected command rows terminalize through `RuntimeCommandStatePort.finishCommand(...)` after live command/session cancellation is accepted or recovered                                                                                                                                                                                                                                | `queue.changed`, `surface.stream`                                                                                                                                                                                                          | `surface`, `commandInspector`, `requestInput`                                                                                                | queued abort, claimed queued-row rejection, active-turn abort, all-for-surface abort, terminal idempotency                                                                   |
| `queues.steer`                                | `SteerQueuedMessageInputSchema`                                                                                          | null                                                                                                                                                                          | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                     | `RuntimeQueueStatePort.getSurfaceQueuedMessage(...)`, `RuntimeQueueStatePort.markSurfaceMessageQueued({ position: "front" })` with a queued/steering status guard so claimed or dispatching rows keep their claim and are rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | descriptor-derived `workspace_read_model.changed` / `app_read_model.changed`; no `queue.changed` event is emitted by this public method unless a queue lifecycle publisher commits and publishes that event from authoritative queue state | `surface`, `sessionNavigation`                                                                                                               | reorder FIFO, claimed-row rejection, duplicate steer idempotency                                                                                                             |
| `commands.writeStdin`                         | `WriteCommandStdinInputSchema`                                                                                           | `WriteCommandStdinResultSchema`                                                                                                                                               | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `backpressure`, `runtime-shutdown`, `runtime-disposed`                     | `RuntimeCommandStatePort.findCommandById(...)`, `RuntimeLayerCommandStdinPort.writeStdin(...)`, then `RuntimeCommandStatePort.recordStdinWrite(...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `command.changed`                                                                                                                                                                                                                          | `commandInspector`                                                                                                                           | durable lookup, open stdin, closed stdin, backpressure, terminal command                                                                                                     |
| `commands.cancel`                             | `CancelCommandInputSchema`                                                                                               | `CancelCommandResultSchema`                                                                                                                                                   | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                     | `RuntimeCommandStatePort.findCommandById(...)`, `RuntimeLayerCommandControlPort.cancel(...)`, then `RuntimeCommandStatePort.finishCommand(...)` with cancelled terminal facts when the command is cancelable and not already terminal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `command.changed`                                                                                                                                                                                                                          | `commandInspector`, `surface`, `requestInput`                                                                                                | running process cancel, already-terminal no-op, wait cleanup                                                                                                                 |
| `approvals.answer`                            | `AnswerRuntimeApprovalInputSchema`                                                                                       | `AnswerRuntimeApprovalResultSchema`                                                                                                                                           | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                     | `RuntimeApprovalStatePort.getApprovalRequest(...)`, `RuntimeApprovalStatePort.resolveApprovalRequest(...)`, committed descriptor publication, then `RuntimeCommandStatePort.startCommand(...)` for approved requests or `RuntimeCommandStatePort.findCommandById(...)` plus `RuntimeCommandStatePort.finishCommand(...)` for denied requests, then `RuntimeSessionWaitStatePort.clearSessionWait(...)`, committed descriptor publication for each mutation, and finally package-private `RuntimeApprovalWaitService.afterApprovalCommitted(...)` inside the acquired `Runtime.layer`; public approval answering must not call a generic wait-registry facade or any app/bootstrap approval-wait service                                                            | `workspace_read_model.changed`, `command.changed`                                                                                                                                                                                          | `runtimeApprovals`, `commandInspector`, `sessionNavigation`; `surface` when the approval state-port descriptor includes the affected surface | approve/deny, stale answer, wait resolution                                                                                                                                  |
| `requestInput.answer`                         | `AnswerRequestInputInputSchema`                                                                                          | `AnswerRequestInputResultSchema`                                                                                                                                              | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `backpressure`, `runtime-shutdown`, `runtime-disposed`                     | `RuntimeRequestStatePort.answerRequestInput(...)`, `RuntimeQueueStatePort.enqueueSurfaceMessage(...)` only when model delivery is required for a `request_user_input_answer` queue row, then `RuntimeRequestInputWaitService.afterAnswerCommitted(...)` after commit/publication acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | always `workspace_read_model.changed`; `queue.changed` only when `delivery.kind === "nonblocking-queued"` and a `request_user_input_answer` queue row was committed                                                                        | `requestInput`, `surface`, `commandInspector`; queue read-model invalidation only for committed queue delivery                               | blocking open, blocking resolved, nonblocking queued, nonblocking recorded-only, duplicate submission                                                                        |
| `requestInput.setTimerPaused`                 | `SetRequestInputTimerPausedInputSchema`                                                                                  | `SetRequestInputTimerPausedResultSchema`                                                                                                                                      | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                     | `RuntimeRequestStatePort.setRequestInputTimerPaused(...)`, publish committed descriptors, then `RuntimeRequestInputWaitService.afterTimerPausedCommitted(...)`; timer pause/resume must not be owned by a generic wait-registry facade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `workspace_read_model.changed`                                                                                                                                                                                                             | `requestInput`                                                                                                                               | pause/resume, no-timeout rejection, restart preserved pause                                                                                                                  |
| `sourceEdits.open`                            | `OpenExtensionSourceEditInputSchema`                                                                                     | `SourceEditSessionSchema`                                                                                                                                                     | `invalid-input`, `target-not-found`, `read-only-source`, `runtime-shutdown`, `runtime-disposed`                                                  | `Extensions.sources.openEditSession(...)`, `RuntimeSourceStatePort.readSourceVersion(...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | none                                                                                                                                                                                                                                       | none                                                                                                                                         | extension open, read-only generated output, path authority rejection                                                                                                         |
| `sourceEdits.save`                            | `SaveExtensionSourceEditInputSchema`                                                                                     | `SourceEditSaveResultSchema`                                                                                                                                                  | `invalid-input`, `target-not-found`, `read-only-source`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                 | `Extensions.sources.openEditSession(...)`, `RuntimeSourceStatePort.readSourceVersion(...)`, `Extensions.sources.saveEditSession(...)`, `RuntimeSourceStatePort.recordSourceSave(...)`; that state write returns after-commit descriptors and runtime publishes descriptor-derived events through the package-private `RuntimeEventBus` after the committed write                                                                                                                                                                                                                                                                                                                                                                                                   | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                                                                                               | `extensions`, `agents`, `workflowsGenerated`                                                                                                 | compare-and-swap save, stale save, overwrite, file-write/state-fail boundary                                                                                                 |
| `sourceInvalidation.hint`                     | `SourceInvalidationHintSchema`                                                                                           | null                                                                                                                                                                          | `invalid-input`, `unsupported-operation`, `runtime-shutdown`, `runtime-disposed`                                                                 | `RuntimeSourceInvalidationService.hint(...)` validates scope/domain, selects the acquired `RuntimeSourceInvalidationCoordinator` for app-global or workspace scope, calls `classifyHint(...)`, and calls `requestScan(...)` only for scan-worthy hints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none for duplicate or ignored hints; committed scan work later publishes descriptor-derived events                                                                                                                                         | none directly                                                                                                                                | scope/domain validation, generated-output ignored, debounce with TestClock                                                                                                   |
| `sourceInvalidation.reconcile`                | `SourceReconcileRequestSchema`                                                                                           | `SourceReconcileResultSchema`                                                                                                                                                 | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `unsupported-operation`, `runtime-shutdown`, `runtime-disposed`            | `RuntimeSourceInvalidationService.reconcile(...)` validates app-global domains `extensions`/`workflows` or workspace domains `external_instructions`/`host_snippets`, delegates deterministic scan work to `RuntimeSourceInvalidationScanPort.reconcile(...)`, then applies the returned committed scan event through `RuntimeSourceInvalidationService.applyCommittedScanEvent(...)`                                                                                                                                                                                                                                                                                                                                                                              | descriptor-derived events after committed source facts, generated-package facts, link facts, app-log diagnostics, or recovery rows                                                                                                         | affected source/read-model invalidations only after commits                                                                                  | startup/manual/recovery scans, one scan per domain, failed scan recovery                                                                                                     |
| `sourceInvalidation.applyCommittedScanEvent`  | `ApplyCommittedSourceInvalidationEventInputSchema`                                                                       | `SourceReconcileResultSchema`                                                                                                                                                 | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `unsupported-operation`, `runtime-shutdown`, `runtime-disposed`            | `RuntimeSourceInvalidationService.applyCommittedScanEvent(...)` validates the scope/domain pair on a committed source-scan event, publishes `event.afterCommit` through `RuntimeEventBus`, refreshes affected generated packages for app-global package domains, refreshes generated context for acquired workspaces or the named workspace when changed domains affect generated context, and returns only receipt facts through `SourceReconcileResult`                                                                                                                                                                                                                                                                                                          | descriptor-derived runtime events from committed source facts, followed by descriptor-derived events from committed generated-package/generated-context/link-repair facts                                                                  | affected source/read-model invalidations only after commits                                                                                  | rejects caller-authored descriptors outside committed scan shape; publication failure stops reactions; app-global and workspace reaction parity                              |
| `sourceInvalidation.refreshGeneratedContext`  | `RefreshGeneratedContextRequestSchema`                                                                                   | null                                                                                                                                                                          | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `unsupported-operation`, `runtime-shutdown`, `runtime-disposed`            | `Extensions.generatedContext.build(...)` and `RuntimeActorExtensionBindingStatePort.updateActorExtensionBinding(...)` when the refresh commits a new bound generated-context fingerprint; `RuntimeGeneratedPackageStatePort` is used only when generated-package facts are refreshed in the same operation. Trusted context-impact transport is applied through the runtime-effect request path, not the public generated-context refresh facade.                                                                                                                                                                                                                                                                                                                  | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                                                                                               | `surface`, `extensions`                                                                                                                      | target refresh, workspace refresh, stale context banner                                                                                                                      |
| `sourceInvalidation.refreshGeneratedPackages` | Effect service: `InternalRefreshGeneratedPackagesRequestSchema`; Promise facade: `RefreshGeneratedPackagesRequestSchema` | `GeneratedPackagesRefreshResultSchema`                                                                                                                                        | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `unsupported-operation`, `runtime-shutdown`, `runtime-disposed`            | Public app-global refresh calls `Extensions.generatedPackages.refresh(...)` through `RuntimeGeneratedPackageRefreshService`, retains the complete `GeneratedPackageBuildPlanResult`, and commits each build through `RuntimeGeneratedPackageStatePort.recordGeneratedPackageBuild(...)` or `recordGeneratedPackageFailure(...)`. A successful Workflows write carries the plan's exact `workflowsExports` snapshot and required Workflows build id into the same state transaction as the package fact; extension and failed writes carry no export snapshot. Downstream runtime-owned workspace-link repair applies package-private link plans and commits `RuntimeGeneratedPackageStatePort.recordWorkspaceLinkStatus(...)` after app-global build facts commit. | descriptor-derived `app_read_model.changed` for app-global build facts; later workspace-link repair emits descriptor-derived app/workspace read-model changes from committed link facts                                                    | `workflowsGenerated`, `extensions`, `appLogs`                                                                                                | app-global build, public caller policy rejects workspace-link-repair scope, scheduled workspace-link repair, Workflows fact/export atomicity, build failure keeps last ready |
| `events`                                      | `RuntimeEventsInputSchema`                                                                                               | live `RuntimeEventSubscriptionEffect` / facade `RuntimeEventSubscription`; event values use `RuntimeEventSchema` and close receipts use `RuntimeEventSubscriptionCloseSchema` | `event-replay-unavailable`, `stream-failed`                                                                                                      | `RuntimeEventBus.subscribe(...)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | subscribed runtime events                                                                                                                                                                                                                  | none                                                                                                                                         | replay cursor, gap/rebaseline error, slow consumer close, close receipt                                                                                                      |

Package-specific domain tables may add detail only when they preserve this ledger and every
contract dimension above.

## Bottom-Up Main Flow Execution Contract

This section is the exact package-to-package contract for the ordinary prompt-bearing path:

```text
message submit -> durable queue commit -> queue wake/claim -> prompt defaults/binding read -> required generated-context refresh -> turn record commit -> pi stream -> streamed tool intent -> accepted tool call -> runtime command envelope -> extension handler -> ExtensionRuntimeOperation processing -> runtime_effect application / execution_plan execution -> state commit -> runtime notification/live patch -> UI refetch or stream rebaseline -> recovery scan
```

The contract applies to orchestrator and handler-thread surfaces. Workflow task-agent attempts enter
through the runtime-owned task-agent bridge queue path, then use the same queue, turn, pi-adapter,
tool, state, event, and recovery machinery once a workflow-task surface is created.

### Public Entry

The only public entry for user-messageable prompt-bearing work is
`Runtime.messages.submit(input: SubmitMessageInput)` and the matching Promise facade method. The
input codec is `SubmitMessageInputSchema`; the result codec is `SubmitMessageResultSchema`.
Callers provide only `target: PromptTarget`, `message: RuntimeSubmittedMessage`, optional
`delivery: "enqueue-and-run" | "queue-only"`, and optional
`clientSubmission: RuntimeClientSubmissionInput`.

Callers must not provide `workspaceId`, pi message arrays, transcript snapshots, `systemPrompt`,
generated-context previews, extension declarations, renderer panel ids, workflow task-agent targets,
command ids, turn ids, queue row payloads, runtime-effect envelopes, or extension operations.
Runtime resolves workspace ownership from committed surface/session facts through core-owned state
ports.

### Durable Queue Commit

`Runtime.messages.submit(...)` calls exactly
`RuntimeQueueStatePort.acceptSubmittedSurfaceMessage(input)`. That state method owns the one
transaction that validates target surface ownership, inserts one durable `user_message` queue row,
clears the submitted durable composer draft, and handles idempotent `clientRequestId` replay. The
state result is a `StateMutationResult<RuntimeSurfaceMessageRecord>` carrying the committed queue
row and committed `StateInvalidationDescriptor[]` values. `@svvy/runtime` maps the committed row
into `SubmitMessageResult`; `@svvy/state` computes the descriptors; `@svvy/runtime` publishes them
only after commit; consumers refetch through `StateReadModels`.

The state/core contract must name the exact schemas for submitted-message acceptance input,
committed queue-row identity, duplicate replay comparison fields, and any queue-row receipt embedded
in `SubmitMessageResult`. Those schemas are the only durable queue acceptance contract; runtime
events are not acceptance receipts.

### Post-Commit Wake

After the queue commit and descriptor publication acceptance, runtime may wake a surface queue:

- `delivery === "enqueue-and-run"` calls package-private
  `RuntimeQueueWakeService.wakeSurface({ target, reason: "message-submitted" })`.
- `delivery === "queue-only"` does not wake the surface queue.

`RuntimeQueueWakeService.wakeSurface(...)` accepts only a `PromptTarget` and a closed reason:
`"message-submitted"`, `"request-input-answer-queued"`, `"queue-steered"`, or
`"runtime-queue-inserted"`. It must not receive queue row payloads, dispatch results, pi handles,
renderer snapshots, callbacks, mutable state-port results, or broad catalog objects.

### Queue Claim, Pre-Dispatch Refresh, And Turn Start

The package-private `RuntimeSurfaceQueueDispatcherService` owns wake-hint acceptance and draining
through `acceptWakeHint(...)` and `drain(...)`; wake scheduling remains owned by
`RuntimeQueueWakeService.wakeSurface({ target, reason })`, which maps committed-state reasons to
dispatcher `QueueWakeup` hints. It claims work only with
`RuntimeQueueStatePort.claimNextQueuedSurfaceMessage(...)`, commits the claim, runs any required
opted-in generated-context refresh, prepares the exact `StartRuntimeTurnInput`, then creates and
commits the durable turn with
`RuntimeTurnStatePort.startTurn(input: StartRuntimeTurnInput)` before pi delivery.

The queue/turn state contract names these methods as the prompt-bearing claim lifecycle:
`claimNextQueuedSurfaceMessage`, `markSurfaceMessageDelivered`, `markSurfaceMessageFailed`,
`releaseExpiredSurfaceMessageClaims`, `startTurn`, `setTurnDecision`, and `finishTurn`. The core
symbol index must contain schemas for the claim input, claimed queue item result, claim lease,
`StartRuntimeTurnInput`, and `RuntimeTurnRecord` before implementation can claim the path complete.

### Prompt Defaults And Generated Context

Before calling pi, runtime composes dispatch input from:

- `RuntimePromptDefaultsStatePort.resolvePromptDefaults(input)` for DB/product-state-backed
  provider, model, and reasoning only.
- `RuntimeActorExtensionBindingStatePort.readRuntimePromptBinding(input)` for the committed
  DB/product-state-backed prompt binding facts for an already-bound target.
- `Extensions.generatedContext.build(input)` when a refresh is required.
- `Extensions.nativeTools.declarations(input)` for actor-filtered model-facing tool declarations.
- `Extensions.nativeTools.metadata(input)` when command projection metadata is needed.

State owns provider/model/reasoning facts and the committed prompt binding row that a target is
currently bound to. `@svvy/extensions` owns generated prompt/instruction content, tool
declarations, and regenerated generated-context evidence. Runtime owns whether refresh is required
before dispatch and the complete package-private
`RuntimePromptDefaultsService.resolveForDispatch(...)` input/result shape. Pi-adapter owns only
delivery to pi's real `systemPrompt` channel.

### Pi Turn Dispatch

Runtime calls exactly `PiAdapter.turns.run(input: RunPiTurnInput)`. `RunPiTurnInput` is the
core-owned input tying together `PiSessionRef`, `TurnId`, `SurfacePiSessionId`,
`RuntimeSubmittedMessage`, submitted timestamp, `PiSystemPromptBinding`, `ModelSelection`,
`ReasoningSelection`, actor-filtered `NativeToolDeclaration[]`, `PiToolExecutor`, and optional
ambient pi-resource enablement. `PiAdapter.turns.run(...)` returns
`Effect.Effect<PiAdapterTurnStream, PiAdapterError>`, where `PiAdapterTurnStream.stream` is the
`Stream.Stream<PiRuntimeEvent, PiAdapterError>` runtime consumes and `close()` plus `closed` expose
explicit turn-stream cleanup and close receipt semantics.

Runtime owns turn ids, timestamps, prompt dispatch policy, tool executor implementation, state
commits, turn settlement, and runtime events. Pi-adapter owns scoped pi session access, true
`systemPrompt` rebinding, pi event normalization, and the package-private callback bridge. Pi-adapter
must not apply `RuntimeEffectRequest` values, invoke extension handlers directly, write command
facts, publish runtime events, or expose pi-native handles.

The package-private `RuntimePromptExecutionService` owns the prompt-bearing active-turn lifecycle
after the queue dispatcher has claimed one row and committed the turn record. Its exact target
surface is:

```ts
type RuntimePromptExecutionInput = {
  claimedMessage: RuntimeSurfaceMessageRecord;
  turn: RuntimeTurnRecord;
  promptContext: PromptExecutionContext;
  piTurnInput: RunPiTurnInput;
};

type RuntimePromptCommandReceipt = {
  commandId: CommandId;
  status: "completed" | "failed" | "cancelled";
};

type RuntimePromptExecutionResult = {
  queueItemId: QueueItemId;
  turnId: TurnId;
  status: "completed" | "failed" | "cancelled";
  commandReceipts: readonly RuntimePromptCommandReceipt[];
};

type RuntimePromptExecutionService = {
  executeClaimedPrompt(
    input: RuntimePromptExecutionInput,
  ): Effect.Effect<
    RuntimePromptExecutionResult,
    RuntimeContractError,
    RuntimeSurfaceRuntimeService
  >;
};
```

`claimedMessage` is the DB/product-state-backed queue row returned by
`RuntimeQueueStatePort.claimNextQueuedSurfaceMessage(...)`; `turn` is the DB/product-state-backed
record returned by `RuntimeTurnStatePort.startTurn(...)`; `promptContext` is the core-exported,
content-stripped invocation context; `piTurnInput` is assembled by runtime from committed defaults,
binding facts, generated-context evidence, actor-filtered tool declarations, and the claimed
message body. The input invariants are exact:

- `turn.id === promptContext.turnId`
- `turn.surfacePiSessionId === claimedMessage.surfacePiSessionId`
- `promptContext.queueItemId === claimedMessage.id`
- `piTurnInput.turnId === turn.id`
- `piTurnInput.surfacePiSessionId === claimedMessage.surfacePiSessionId`
- `piTurnInput.userMessage` is parsed from `claimedMessage.messageJson`
- `piTurnInput.userMessageSubmittedAt === claimedMessage.createdAt`

The result is a receipt only. It does not duplicate queue rows, turn rows, transcript entries,
command records, prompt previews, generated prompt content, external instruction content, renderer
snapshots, or derived read models. Callers that need details read state-backed projections after
runtime publishes committed events. Failures are `RuntimeContractError` failures on the returned
Effect; durable failure facts are committed through state ports before the failure is surfaced.

### Pi Event Handling

Runtime consumes `PiRuntimeEvent` values and maps each variant to state writes, live stream patches,
or terminal settlement. The required mapping table for implementation names, for every
`PiRuntimeEvent` variant, the state-port method if any, emitted runtime event, emitted
invalidation descriptor, idempotency key, and stale queue/turn recovery behavior. The variants that
must be covered include user-message commit, assistant text deltas, assistant thinking deltas,
tool-call started, tool-arguments delta, tool-call accepted, tool execution started/updated/finished,
and turn finished.

| `PiRuntimeEvent.type`          | Runtime implementation handler                         | State-port method(s)                                                                                                                                                                                                                                     | Emitted runtime event(s)                                                                                      | Emitted invalidation descriptor(s)                                                                                                            | Idempotency key                                                                                                | Stale queue/turn recovery behavior                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi.user_message.committed`    | `RuntimePiEventConsumer.onUserMessageCommitted(...)`   | none; the durable submitted-message row already exists from `RuntimeQueueStatePort.acceptSubmittedSurfaceMessage(...)` and turn ownership already exists from `startTurn(...)`                                                                           | optional `surface.stream` patch only when the renderer needs pi message reference metadata                    | none unless the implementation records additional prompt telemetry through a named state port                                                 | `{ turnId, type, piMessageRef }`                                                                               | If the turn id is not current for the surface, ignore the live patch and schedule stale-turn recovery through `RuntimeRecoveryStatePort`; never create a second submitted-message row. |
| `pi.assistant.text.delta`      | `RuntimePiEventConsumer.onAssistantTextDelta(...)`     | none for each delta; transcript persistence is finalized through turn/queue settlement or the state-port method named by the transcript implementation table                                                                                             | `surface.stream` text delta with target-local sequence                                                        | none per delta                                                                                                                                | `{ turnId, type, piMessageRef, contentIndex, sequence }` where `sequence` is runtime-assigned                  | If the surface stream generation is stale, publish a rebaseline-required event and let the UI refetch; do not replay deltas from state.                                                |
| `pi.assistant.thinking.delta`  | `RuntimePiEventConsumer.onAssistantThinkingDelta(...)` | none for each delta; final reasoning transcript state is committed by the turn settlement path when supported                                                                                                                                            | `surface.stream` thinking delta with target-local sequence                                                    | none per delta                                                                                                                                | `{ turnId, type, piMessageRef, contentIndex, sequence }` where `sequence` is runtime-assigned                  | Same as assistant text deltas; stale consumers rebaseline from authoritative read models instead of delta replay.                                                                      |
| `pi.tool_call.started`         | `RuntimePiEventConsumer.onToolCallStarted(...)`        | `RuntimeCommandStatePort.createOrReuseStreamingCommand(...)` when the tool card requires a durable command envelope before arguments finish                                                                                                              | `surface.stream` tool-call-started patch; `command.changed` only after a command row commits                  | `commandInspector` only when a command row is created                                                                                         | `{ turnId, toolCallId, type }`                                                                                 | If the command row already exists for the tool call, reuse it. If the owning turn is stale, terminalize any created row through recovery instead of running the tool.                  |
| `pi.tool_call.arguments.delta` | `RuntimePiEventConsumer.onToolArgumentsDelta(...)`     | `RuntimeCommandStatePort.recordCommandEvent(...)` for bounded argument snapshots; `RuntimeCommandStatePort.updateCommandArguments(...)` when accepted arguments are complete                                                                             | `surface.stream` tool-arguments delta or argument-snapshot patch; `command.changed` after committed snapshots | `commandInspector`; `surface` only when the command rollup read model depends on the committed argument snapshot                              | `{ turnId, toolCallId, type, sequence }` for live deltas; `{ commandId, snapshotIndex }` for durable snapshots | If a snapshot duplicates an already recorded command event, skip it. If the command row is missing, create/reuse by `toolCallId` before recording durable snapshots.                   |
| `pi.tool_call.accepted`        | `RuntimePiEventConsumer.onToolCallAccepted(...)`       | `RuntimeCommandStatePort.findCommandByToolCallId(...)`, `createOrReuseStreamingCommand(...)`, `updateCommandArguments(...)`, then accepted-tool runner command methods                                                                                   | `surface.stream` accepted-tool patch; `command.changed` after command state writes                            | `commandInspector`, `surface`, `requestInput`, or `appLogs` only through committed command/runtime-operation descriptors                      | `{ turnId, toolCallId, type }`                                                                                 | If accepted arguments decode fails, finish the command as failed and return a typed `NativeToolResult` to pi; stale turn ownership records recovery and does not execute the handler.  |
| `pi.tool_execution.started`    | `RuntimePiEventConsumer.onToolExecutionStarted(...)`   | `RuntimeCommandStatePort.startCommand(...)`                                                                                                                                                                                                              | `surface.stream` tool-execution-started patch; `command.changed` after commit                                 | `commandInspector`, and `surface` when command rollups are visible                                                                            | `{ turnId, toolCallId, type }`                                                                                 | Duplicate start is idempotent against the command row. Missing command row is recovery-required because execution cannot be attributed safely.                                         |
| `pi.tool_execution.updated`    | `RuntimePiEventConsumer.onToolExecutionUpdated(...)`   | `RuntimeCommandStatePort.recordCommandEvent(...)` for progress/output/diagnostic facts                                                                                                                                                                   | `surface.stream` tool-execution-updated patch; `command.changed` after committed command event                | `commandInspector`, plus artifact/read-model descriptors returned by command-state writes                                                     | `{ commandId, eventKind, eventSequence }`                                                                      | Duplicate event receipts are ignored by command-event idempotency. If the command is terminal, record recovery work rather than mutating terminal facts.                               |
| `pi.tool_execution.finished`   | `RuntimePiEventConsumer.onToolExecutionFinished(...)`  | `RuntimeCommandStatePort.finishCommand(...)`; accepted-tool runner applies ordered `ExtensionRuntimeOperation[]` before final command settlement                                                                                                         | `surface.stream` tool-execution-finished patch; `command.changed` after terminal command commit               | `commandInspector`, `surface`, `requestInput`, `extensions`, `appLogs`, and artifact read models as described by `afterCommit` descriptors    | `{ turnId, toolCallId, type }`                                                                                 | Terminal command finish is idempotent. Failed runtime operations finish the command with typed facts and enqueue recovery only for lanes whose owning spec says retry is safe.         |
| `pi.turn.finished`             | `RuntimePiEventConsumer.onTurnFinished(...)`           | `RuntimeTurnStatePort.finishTurn(...)`; `RuntimeQueueStatePort.markSurfaceMessageDelivered(...)` for completed status or `markSurfaceMessageFailed(...)` for failed/cancelled status; `RuntimeCommandStatePort.finishCommand(...)` for dangling commands | final `surface.stream` turn-settled patch; descriptor-derived read-model events after state commit            | `surface`, `sessionNavigation`, `commandInspector`, `requestInput`, `appLogs`, and any descriptor returned by turn/queue/command state writes | `{ turnId, type }`                                                                                             | If queue or turn ownership is stale, do not finish another owner's turn; record `RuntimeRecoveryStatePort` work for startup/stale-owner reconciliation and publish rebaseline.         |

No pi event is a durable read model. Runtime events are live notifications or invalidation signals;
consumers refetch authoritative transcript, command, request-input, queue, and surface read models
from `@svvy/state`.

### Accepted Native Tool Execution

Pi-adapter/runtime tool execution is split by native-tool command metadata. Generic command tools use
runtime-owned streaming/accepted command envelopes keyed by `toolCallId`. Self-recorded native tools
own their specialized command rows through their package/runtime lane and must still publish
committed command facts and invalidations through core-owned state ports.
`RuntimeAcceptedNativeToolExecution` is the package-private runtime control-tool service for
accepted native tools whose operation application is represented by package-private service methods
and command/session lanes. Its named methods include direct-tool launch-facts acquisition for
Shell, Apply Patch, and Execute TypeScript plus control-tool operations such as `load_extension`,
`request_user_input`, and `thread_start`. Top-level `write_stdin`, extension-facade child commands,
read-only thread state tools, and other command/file-effect tools are still runtime-owned
accepted-tool paths, but they use their specified runtime command/session/execution lanes rather
than adding public facade methods or entering extension handlers for built-in execution.

The accepted-tool input/result schemas must cover workspace/session/surface identity, `TurnId`,
`ToolCallId`, tool name, accepted arguments, argument snapshot provenance, command identity,
runtime-command target, and typed runtime-tool error mapping into `NativeToolResult`.

Runtime creates the command envelope through `RuntimeCommandStatePort` methods such as
`createCommand`, `createOrReuseStreamingCommand`, `findCommandByToolCallId`,
`updateCommandArguments`, `startCommand`, `recordCommandEvent`, and `finishCommand`.
Extensions supplies `Extensions.nativeTools.handler(input)` and the returned `ExtensionHandler`.
The handler returns one model-facing result plus ordered `ExtensionRuntimeOperation[]`; runtime
applies runtime-effect operations, delegates execution-plan operations to the package-private
executor, records facts, publishes events, and returns only the final `NativeToolResult` to pi.

### Extension Operation Application

Extension handlers may return only ordered `ExtensionRuntimeOperation` items wrapping a closed
`RuntimeEffectRequest` or immutable `ExtensionExecutionPlan`. Runtime applies runtime-effect items
in order through one package-private applier method per closed `RuntimeEffectRequest` variant.
`execution_plan` items decode through `ExtensionExecutionPlanSchema` and delegate to the
package-private, `Runtime.layer`-provided `RuntimeExecutionPlanExecutor`. The current base executor
is intentionally fail-closed: every plan type without a spec-defined concrete runtime-owned lane
returns typed `unsupported-operation`. Missing owning command context, prompt execution context, or
command id fails earlier through operation application with typed `unsupported-operation`:

- `RuntimeEffectApplier.applyHandlerThreadStart(...)`.
- `RuntimeEffectApplier.applyQueueInsert(...)`.
- `RuntimeEffectApplier.applyActorExtensionBindingUpdate(...)`.
- `RuntimeEffectApplier.applyEpisodeRecord(...)`.
- `RuntimeEffectApplier.applyRequestInputCreate(...)`.
- `RuntimeEffectApplier.applyGeneratedContextRefresh(...)`.
- `RuntimeEffectApplier.applyGeneratedPackagesRefresh(...)`.

If implementation chooses different internal names, this section must be updated before the code
lands. `@svvy/core` owns the closed algebra and schemas; runtime owns appliers; state owns committed
facts; extensions never writes product state, publishes runtime events, or executes runtime-owned
subprocess/file/approval work directly.

### Final Settlement And Recovery

After pi stream completion, typed failure, interruption, or shutdown, runtime settles the queue row
with `RuntimeQueueStatePort.markSurfaceMessageDelivered(...)` or
`RuntimeQueueStatePort.markSurfaceMessageFailed(...)`, settles the turn with
`RuntimeTurnStatePort.finishTurn(...)`, terminalizes dangling commands with
`RuntimeCommandStatePort.finishCommand(...)` when needed, and records recovery work through
`RuntimeRecoveryStatePort` when retry or startup recovery is required.

The settlement table for implementation must cover successful turn, pi adapter failure before first
token, pi stream failure mid-turn, tool execution typed failure, user abort, runtime shutdown,
surface close, stale queue or turn ownership, command cancellation, and recovery-required
terminalization. Each row names exact state-port methods, invalidated read models, live event
types, and retry/recovery ownership.

| Settlement case                       | Exact state-port method(s)                                                                                                                                                                                                              | Invalidated read model(s)                                                                    | Live runtime event type(s)                                                                                                                                  | Retry/recovery ownership                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| successful turn                       | `RuntimeTurnStatePort.finishTurn({ status: "completed" })`; `RuntimeQueueStatePort.markSurfaceMessageDelivered(...)`; terminal command rows already finished by tool handlers                                                           | `surface`, `sessionNavigation`, `commandInspector`, `requestInput` when affected             | final `surface.stream` turn-settled patch plus descriptor-derived `workspace_read_model.changed` events                                                     | No retry. Recovery scan only verifies no running turn/claimed queue row remains after restart.                                                                           |
| pi adapter failure before first token | `RuntimeTurnStatePort.finishTurn({ status: "failed" })`; `RuntimeQueueStatePort.markSurfaceMessageFailed(...)`; dangling command rows are absent                                                                                        | `surface`, `sessionNavigation`, `appLogs`                                                    | `surface.stream` error/rebaseline event; descriptor-derived read-model changed events                                                                       | Runtime records retryable recovery only when the failure reason is startup/session-reference recoverable; provider/auth/path failures remain terminal.                   |
| pi stream failure mid-turn            | `RuntimeTurnStatePort.finishTurn({ status: "failed" })`; `RuntimeQueueStatePort.markSurfaceMessageFailed(...)`; `RuntimeCommandStatePort.finishCommand(...)` for open commands                                                          | `surface`, `sessionNavigation`, `commandInspector`, `requestInput`, `appLogs`                | `surface.stream` interrupted/error patch; `command.changed`; descriptor-derived read-model changed events                                                   | Runtime recovery owns dangling command terminalization and stale stream rebaseline; it does not replay partial pi streams.                                               |
| tool execution typed failure          | `RuntimeCommandStatePort.finishCommand({ status: "failed" })`; turn may continue if pi receives a typed `NativeToolResult`; turn/queue settle only when pi later finishes                                                               | `commandInspector`, `surface`, `appLogs`; extension/request/artifact read models as affected | `surface.stream` tool-execution-finished failed patch; `command.changed`                                                                                    | Accepted-tool service owns typed failure mapping. Retry is allowed only for runtime-owned operations whose spec names retry/recovery; model-facing tool result is final. |
| user abort                            | `RuntimeQueueStatePort.cancelSurfaceMessage(...)` for queued rows; active turn path uses `RuntimeTurnStatePort.finishTurn({ status: "cancelled" })`, `RuntimeQueueStatePort.markSurfaceMessageFailed(...)`, and command terminalization | `surface`, `sessionNavigation`, `commandInspector`, `requestInput`                           | `surface.stream` cancellation patch; `queue.changed`; `command.changed`                                                                                     | Runtime active-turn fiber owns interruption. Recovery terminalizes any command still running after cancellation acceptance.                                              |
| runtime shutdown                      | `RuntimeRecoveryStatePort.recordRecoveryWork(...)` for claimed/running work that cannot settle before shutdown; terminal state writes only when shutdown policy safely owns them                                                        | `surface`, `sessionNavigation`, `commandInspector`, `appLogs` after recovery commits         | descriptor-derived read-model changed events; no new stream deltas after shutdown begins                                                                    | Runtime startup recovery owns rescan, stale claim release, command terminalization, and generated-package/source worker recovery.                                        |
| surface close                         | `RuntimeSurfaceLifecycleStatePort.closeSurface(...)`; active prompt cancellation uses `RuntimeTurnStatePort.finishTurn(...)`, queue failure/cancel methods, and command wait cleanup as needed                                          | `surface`, `sessionNavigation`, `requestInput`, `commandInspector`                           | `surface.changed` with reason `"surface.closed"` plus `surface.stream` cancellation/rebaseline when an active turn existed                                  | Surface scope close owns process-local waits and subscriptions; durable recovery owns any command/queue/turn row not terminalized before close completed.                |
| stale queue or turn ownership         | `RuntimeQueueStatePort.releaseExpiredSurfaceMessageClaims(...)`; `RuntimeRecoveryStatePort.recordRecoveryWork(...)`; owner-validated `finishTurn(...)` only when ownership matches                                                      | `surface`, `sessionNavigation`, `appLogs`                                                    | `surface.stream` `stream_reset` with reason `"rebaseline_required"`; descriptor-derived read-model changed events when recovery commits descriptors         | Runtime recovery coordinator owns stale lease release and terminalization. Live consumers mutate only rows covered by their current ownership lease.                     |
| command cancellation                  | `RuntimeCommandStatePort.findCommandById(...)`; `RuntimeLayerCommandControlPort.cancel(...)`; `RuntimeCommandStatePort.finishCommand({ status: "cancelled" })` when cancellation is accepted                                            | `commandInspector`, `surface`, `requestInput`                                                | `command.changed`; `surface.stream` command-card cancellation patch                                                                                         | Runtime command control owns live process cancellation; recovery terminalizes commands whose live process disappeared before final facts committed.                      |
| recovery-required terminalization     | `RuntimeRecoveryStatePort.claimRecoveryWork(...)`; relevant `RuntimeQueueStatePort`, `RuntimeTurnStatePort`, and `RuntimeCommandStatePort.finishCommand(...)` terminal writes; `completeRecoveryWork(...)`                              | affected surface/session/command/request/generated-package/app-log read models               | descriptor-derived read-model changed events; `surface.stream` `stream_reset` with reason `"runtime_recovered"` when recovery invalidates live stream state | Runtime recovery workers own idempotent terminalization. Failed recovery updates recovery row attempts/backoff and never fabricates successful command facts.            |

### Public Boundary Rule

No public facade, app/bootstrap helper, desktop bridge, browser tool, generated package, extension,
or renderer module may call accepted-tool runners, runtime-effect appliers, queue dispatchers, wait
registries, command session services, surface/workspace runtime scope services, or pi-adapter directly for
product prompt execution. Public consumers use runtime lifecycle groups, runtime message/control
groups, runtime events, and state read/command facades only.

The Promise/`AsyncIterable` facade has the same API groups and request payloads as the Effect
service, with these mechanical conversions only. `@svvy/core` owns the schema-backed DTOs, encoded
error contracts, and Effect service group contracts. `@svvy/runtime` owns the concrete Promise
facade adapter returned by `createRuntimeFacade(...)`, including local facade group shapes,
`RuntimeFacadeCallOptions`, close semantics, stream subscription handles, and JavaScript rejection
behavior at the app/browser edge. Public callers type the facade as
`ReturnType<typeof createRuntimeFacade>` or narrower local aliases derived from that return type;
`@svvy/core` does not export partial `Runtime*ApiPromise` facade group interfaces.

```ts
type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;

type RuntimeFacadeShape = {
  workspaces: RuntimeWorkspacesFacade;
  surfaces: RuntimeSurfacesFacade;
  messages: {
    submit(
      input: SubmitMessageInput,
      options?: RuntimeFacadeCallOptions,
    ): Promise<SubmitMessageResult>;
    abort(input: AbortPromptInput, options?: RuntimeFacadeCallOptions): Promise<void>;
  };
  queues: {
    steer(input: SteerQueuedMessageInput, options?: RuntimeFacadeCallOptions): Promise<void>;
  };
  commands: RuntimeCommandsFacade;
  approvals: RuntimeApprovalsFacade;
  requestInput: RuntimeRequestInputFacade;
  sourceEdits: RuntimeSourceEditsFacade;
  sourceInvalidation: RuntimeSourceInvalidationFacade;
  events(
    input?: RuntimeEventsInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RuntimeEventSubscription>;
  close(): Promise<void>;
};

type RuntimeFacadeCallOptions = {
  signal?: AbortSignal;
  abortPolicy?: "cancel-wait-only" | "request-runtime-cancel";
};

type RuntimeFacadeErrorContract =
  | {
      type: "runtime-facade-error";
      reason: "typed-failure";
      error: RuntimeContractError | RuntimeEventError;
    }
  | {
      type: "runtime-facade-error";
      reason: "defect";
      message: string;
      defectClass?: string;
      diagnosticAppLogEntryId?: AppLogEntryId;
    }
  | { type: "runtime-facade-error"; reason: "interrupted"; interruptReason?: string }
  | { type: "runtime-facade-error"; reason: "aborted" }
  | { type: "runtime-facade-error"; reason: "disposed" };
```

`RuntimeFacadeErrorContract` is the closed encoded bridge/RPC error payload owned by `@svvy/core`
schemas. `@svvy/runtime` uses a concrete package-internal `RuntimeFacadeError extends Error` class
whose `type`, `reason`, `error`, `defectClass`, `diagnosticAppLogEntryId`, and `interruptReason`
fields are projected from one decoded `RuntimeFacadeErrorContract`, but that class is not exported
from the package root. Promise rejections and `AsyncIterable` thrown errors use only the normalized
facade error shape, never raw `Cause`, thrown objects, stack traces, or foreign errors. Typed Effect
failures become
`reason: "typed-failure"` with their encoded tagged runtime error. Defects become
`reason: "defect"` with a redacted message/class and optional diagnostic app-log entry id.
Interruption, abort signals, and closed/disposed facades use the dedicated reasons above so callers
can distinguish cancellation from product failures.

`RuntimeFacadeCallOptions.signal` defaults to `abortPolicy: "cancel-wait-only"`. In that mode the
facade stops waiting for the current Promise, closes any facade-owned event subscription setup, and
rejects with `RuntimeFacadeError { reason: "aborted" }`; it does not mutate durable runtime state,
cancel a queued prompt, interrupt pi, kill a command, or close a runtime scope. Product cancellation
is explicit API behavior. Callers use `messages.abort(...)`, `commands.cancel(...)`, or
`RuntimeEventSubscription.close()` for durable/runtime-owned cancellation. The only valid use of
`abortPolicy: "request-runtime-cancel"` is on facade methods whose base runtime API already declares
runtime cancellation semantics; that set is `messages.abort(...)` and `commands.cancel(...)`.
`RuntimeEventSubscription.close()` is an explicit subscription close method with no facade call
options. Other methods must reject the option with a typed runtime
facade error instead of inventing cancellation semantics outside the declared runtime API.

### Workspace And Surface Lifecycle API

The public runtime lifecycle API exists so desktop, browser tools, headless automation, and tests can
drive the same agentic flow without UI-owned hidden setup. It creates or acquires runtime-owned
workspace and surface resources; it does not persist visual tabs, Dockview layout, pane focus, or
renderer state.

Effect API:

```ts
type RuntimeWorkspacesApiEffect = {
  acquire(
    input: AcquireWorkspaceInput,
  ): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError>;
  acquireDefault(
    input: AcquireDefaultWorkspaceInput,
  ): Effect.Effect<AcquireWorkspaceResult, RuntimeContractError>;
  release(
    input: ReleaseWorkspaceInput,
  ): Effect.Effect<ReleaseWorkspaceResult, RuntimeContractError>;
};

type RuntimeSurfacesApiEffect = {
  createOrchestrator(
    input: CreateOrchestratorSurfaceInput,
  ): Effect.Effect<CreateSurfaceResult, RuntimeContractError>;
  open(input: OpenSurfaceInput): Effect.Effect<OpenSurfaceResult, RuntimeContractError>;
  close(input: CloseSurfaceInput): Effect.Effect<CloseSurfaceResult, RuntimeContractError>;
};
```

Promise facade:

```ts
type RuntimeWorkspacesFacade = {
  acquire(
    input: AcquireWorkspaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AcquireWorkspaceResult>;
  acquireDefault(
    input: AcquireDefaultWorkspaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AcquireWorkspaceResult>;
  release(
    input: ReleaseWorkspaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<ReleaseWorkspaceResult>;
};

type RuntimeSurfacesFacade = {
  createOrchestrator(
    input: CreateOrchestratorSurfaceInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<CreateSurfaceResult>;
  open(input: OpenSurfaceInput, options?: RuntimeFacadeCallOptions): Promise<OpenSurfaceResult>;
  close(input: CloseSurfaceInput, options?: RuntimeFacadeCallOptions): Promise<CloseSurfaceResult>;
};
```

Contracts:

```ts
type RuntimeOwnerRef = {
  ownerId: RuntimeOwnerId;
  kind: "desktop-tab" | "browser-tool" | "headless" | "test" | "runtime-background";
};

type AcquireWorkspaceInput = {
  cwd: AbsolutePath;
  owner: RuntimeOwnerRef;
  openReason: "user-open" | "restore" | "headless" | "test" | "runtime-recovery";
};

type AcquireDefaultWorkspaceInput = {
  owner: RuntimeOwnerRef;
  openReason: "startup" | "new-tab" | "headless" | "test";
};

type AcquireWorkspaceResult = {
  workspaceId: WorkspaceId;
  cwd: AbsolutePath;
  kind: "user" | "default";
  acquired: "created" | "existing";
  readiness: "ready";
  readinessDetail:
    | { mode: "full" }
    | {
        mode: "degraded";
        disabledCapabilities: readonly ("generated-imports" | "source-watch" | "link-repair")[];
        recoveryWorkIds: readonly RecoveryWorkId[];
      };
  stateRevision: StateRevision;
};

type ReleaseWorkspaceInput = {
  workspaceId: WorkspaceId;
  owner: RuntimeOwnerRef;
  releaseReason: "tab-closed" | "workspace-replaced" | "headless-complete" | "shutdown" | "test";
};

type ReleaseWorkspaceResult = {
  workspaceId: WorkspaceId;
  released: true;
  remainingOwners: number;
  lifecycle: "active" | "idle" | "disposed";
};

type CreateOrchestratorSurfaceInput = {
  workspaceId: WorkspaceId;
  title?: string;
  profileId?: AgentProfileId;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type CreateSurfaceResult = {
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  target: RuntimeSurfaceTarget;
  created: "new" | "existing";
  stateRevision: StateRevision;
};

type OpenSurfaceInput = {
  workspaceId: WorkspaceId;
  target: RuntimeSurfaceTarget;
};

type OpenSurfaceResult = {
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  target: RuntimeSurfaceTarget;
  stateRevision: StateRevision;
};

type CloseSurfaceInput = {
  workspaceId: WorkspaceId;
  target: RuntimeSurfaceTarget;
  closeReason: "pane-closed" | "headless-complete" | "idle-dispose" | "shutdown" | "test";
};

type CloseSurfaceResult = {
  target: RuntimeSurfaceTarget;
  lifecycle: "open" | "idle" | "disposed";
};
```

Rules:

- Workspace ids are derived by runtime from canonical cwd for user workspaces and from the
  app-owned default workspace cwd for the default workspace. A generic unique same-cwd workspace API
  is not part of the product.
- `workspaces.acquire(...)` starts or reuses the runtime-owned workspace scope-manager entry, runs
  the workspace readiness gate, starts workspace-scoped workers/watchers/recovery in the workspace
  scope, and records workspace lifecycle/app-log facts through state ports before returning
  `readiness:
"ready"`.
- Workspace readiness is separate from app readiness. `AcquireWorkspaceResult.readiness: "ready"`
  requires workspace records loaded, prompt locks reconstructed, workspace source startup reconcile
  completed or a diagnostic/recovery row committed, and required workspace generated-package link
  repair completed or marked recovery-pending before generated imports are exposed as ready.
- `workspaces.release(...)` releases one owner ref. Runtime disposes the workspace scope only when no
  visual, headless, or background owner remains and runtime idle policy allows disposal.
- `surfaces.createOrchestrator(...)` commits durable surface/session and actor-binding facts first,
  then acquires or reuses the retained runtime-owned surface scope-manager entry under the owning
  workspace runtime scope.
  The pi session is created only inside that retained surface scope through
  `PiAdapter.sessions.create(...)`; it is not a method-local handle, desktop-pane resource, or
  app/bootstrap-owned session. The persisted `PiSessionReference` is written by pi-adapter through
  `PiSessionReferencePort` for the returned `surfacePiSessionId`. Closing the one-shot facade call
  must not release the live pi session; release follows normal surface owner, idle, invalidation, or
  app-shutdown policy. If pi session creation fails, runtime records the typed lifecycle failure or
  recovery fact and does not return a messageable ready target. It does not create a desktop pane.
- `surfaces.open(...)` opens an existing durable surface and acquires the live surface runtime scope
  when needed. It fails with `RuntimeContractError` when the session does not belong to the acquired
  workspace, the surface is hard-deleted, or startup is not ready.
- `surfaces.close(...)` releases a live surface consumer or runtime-owned idle handle. Runtime policy
  decides whether the live surface remains open, becomes idle, or disposes. The durable transcript
  and session state remain in `@svvy/state`. The caller supplies `workspaceId` because close
  publication is workspace-scoped and must not infer the event routing scope from renderer pane
  state.
- Every lifecycle method publishes only typed runtime lifecycle and read-model invalidation events
  after state commits. It never returns transcript arrays, generated-context read models, pi-native
  session objects, or renderer pane state.

Example programmatic flow:

```ts
const workspace = await runtime.workspaces.acquire({
  cwd: "/Users/me/code/project" as AbsolutePath,
  owner: { ownerId: "headless_01" as RuntimeOwnerId, kind: "headless" },
  openReason: "headless",
});

const surface = await runtime.surfaces.createOrchestrator({
  workspaceId: workspace.workspaceId,
  title: "Investigate failing tests",
});

await runtime.messages.submit({
  target: surface.target,
  message: { text: "Find the cause of the failing unit test." },
  delivery: "enqueue-and-run",
});
```

A public runtime API group must list its methods, schema-backed inputs/outputs, public typed error
reasons, state port calls, emitted runtime invalidations, and test-layer coverage in this spec.
Undefined groups are not part of the public runtime API. Package-private internal modules and tests
may contain helpers for future implementation slices, but public Effect services and Promise facades
must not expose callable groups without implemented runtime methods.

`createRuntimeFacade(managedRuntime)` is always a mechanical adapter over the caller-owned
app/bootstrap `ManagedRuntime`. It runs Effect service methods through that runtime, maps typed
Effect failures to the same core tagged errors, maps defects and interruption through stable
bridge/RPC/cancellation result shapes, and closes only facade-owned subscriptions, callback fibers,
and bridge scopes when `close()` is called. Facade methods that must distinguish typed failure,
defect, and interruption use `runPromiseExit(...)`, `runSyncExit(...)`, or callback `onExit`;
`runPromise(...)` is used only where Promise rejection is already the complete public error shape.
`RuntimeFacade.close()` never disposes the supplied `ManagedRuntime`; app/bootstrap exposes any app
shutdown or runtime disposal operation separately from runtime facades. Event iteration stops on
consumer cancellation and releases the runtime stream subscription.

Package-internal subsystem notes:

- Handler-thread lifecycle metadata and report/follow-up coordination remain runtime-owned, but
  `handlerThreads` is not a public API group in this spec. Runtime never introduces a public
  messageable surface named `thread`; all public contracts use `surface: "handler"` for
  delegated handler-thread surfaces.
- Runtime-level worktree alignment and switching remain runtime-owned, but `worktrees` is not a
  public API group in this spec. `@svvy/state` remains the durable store for worktree identity,
  context rows, and read-model projection.

`sourceEdits` owns renderer/headless source open and save requests for file-backed extension source
files. Runtime validates caller intent, asks `@svvy/extensions` to resolve/read the editable file,
asks `RuntimeSourceStatePort` for the current recorded source fact, and returns the file-backed
session with recorded source-version, fingerprint, and diagnostics when a state fact exists.
Runtime save requests first reject stale compare-and-swap attempts against the recorded source fact,
then delegate the file-level compare-and-swap or overwrite to `Extensions.sources.saveEditSession`.
After a saved result, runtime records the new source-version, fingerprint, diagnostics, command
lineage, and source path through `RuntimeSourceStatePort.recordSourceSave(...)`, then publishes only
the committed `afterCommit` read-model invalidation descriptors. `@svvy/extensions` writes source
files and computes source evidence; it does not persist durable source-version, fingerprint,
diagnostic, read-model, or invalidation facts. Renderer panes, browser tools, and headless callers
never write these source files directly or provide paths as authority.

`sourceInvalidation` owns runtime-level reaction to file-backed source hints, deterministic source
reconciliation, and generated refresh work. DB/product-state-backed settings, profile, and managed
snippet writes enter runtime notification publication only through committed after-commit
descriptors.

`SourceInvalidationHint` and `SourceReconcileRequest` validate scope/domain pairs.
`scope: { kind: "app-global" }` accepts only `extensions` and `workflows`.
`scope: { kind: "workspace", workspaceId }` accepts only `external_instructions` and
`host_snippets`. DB-backed settings, profile, and managed svvy snippet writes enter runtime
publication only through committed `afterCommit` descriptors returned by state ports; they are not
`SourceDomain` values and are never watcher hints.

## Runtime Message API

The programmatic message API is the primary seam for UI, tests, headless automation, and alternate
apps. Its boundary is a target surface plus one new user message, not renderer-shaped transcript or
prompt payloads. The public service is Effect-native; Promise methods exist only in the mechanical
facade created by `createRuntimeFacade(...)`.

```ts
type RuntimeMessagesApiEffect = {
  submit(input: SubmitMessageInput): Effect.Effect<SubmitMessageResult, RuntimeContractError>;
  abort(input: AbortPromptInput): Effect.Effect<void, RuntimeContractError>;
};

type RuntimeQueuesApiEffect = {
  steer(input: SteerQueuedMessageInput): Effect.Effect<void, RuntimeContractError>;
};

type RuntimeMessagesFacade = {
  submit(
    input: SubmitMessageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SubmitMessageResult>;
  abort(input: AbortPromptInput, options?: RuntimeFacadeCallOptions): Promise<void>;
};

type RuntimeQueuesFacade = {
  steer(input: SteerQueuedMessageInput, options?: RuntimeFacadeCallOptions): Promise<void>;
};
```

`SubmitMessageInput`, `SubmitMessageResult`, and `PromptTarget` are defined in `@svvy/core`. The
generated-contract shape is:

```ts
type PromptTarget =
  | {
      workspaceSessionId: WorkspaceSessionId;
      surface: "orchestrator";
      surfacePiSessionId: SurfacePiSessionId;
    }
  | {
      workspaceSessionId: WorkspaceSessionId;
      surface: "handler";
      surfacePiSessionId: SurfacePiSessionId;
      threadId: ThreadId;
    };

type SubmitMessageInput = {
  target: PromptTarget;
  message: RuntimeSubmittedMessage;
  delivery?: "enqueue-and-run" | "queue-only";
  clientSubmission?: RuntimeClientSubmissionInput;
};

type SubmitMessageResult = {
  queuedMessageId: QueueItemId;
  target: PromptTarget;
  status: "queued";
  receipt: {
    clientRequestId: string | null;
    outcome: "accepted" | "duplicate";
    acceptedAt: IsoDateTimeString;
    stateRevision: StateRevision;
  };
};
```

Full accepted orchestrator example:

```json
{
  "input": {
    "target": {
      "workspaceSessionId": "workspace_session_01",
      "surface": "orchestrator",
      "surfacePiSessionId": "pi_session_01"
    },
    "message": {
      "text": "Refactor the request-input tests to use the Effect lane.",
      "attachments": [],
      "snippetProvenance": []
    },
    "delivery": "enqueue-and-run",
    "clientSubmission": {
      "clientRequestId": "client_submit_01",
      "submittedAt": "2026-06-30T12:34:56.000Z",
      "source": "composer"
    }
  },
  "output": {
    "queuedMessageId": "queue_item_01",
    "target": {
      "workspaceSessionId": "workspace_session_01",
      "surface": "orchestrator",
      "surfacePiSessionId": "pi_session_01"
    },
    "status": "queued",
    "receipt": {
      "clientRequestId": "client_submit_01",
      "outcome": "accepted",
      "acceptedAt": "2026-06-30T12:34:56.125Z",
      "stateRevision": 42
    }
  }
}
```

Full duplicate replay example:

```json
{
  "input": {
    "target": {
      "workspaceSessionId": "workspace_session_01",
      "surface": "orchestrator",
      "surfacePiSessionId": "pi_session_01"
    },
    "message": {
      "text": "Refactor the request-input tests to use the Effect lane.",
      "attachments": [],
      "snippetProvenance": []
    },
    "delivery": "enqueue-and-run",
    "clientSubmission": {
      "clientRequestId": "client_submit_01",
      "submittedAt": "2026-06-30T12:34:56.000Z",
      "source": "composer"
    }
  },
  "output": {
    "queuedMessageId": "queue_item_01",
    "target": {
      "workspaceSessionId": "workspace_session_01",
      "surface": "orchestrator",
      "surfacePiSessionId": "pi_session_01"
    },
    "status": "queued",
    "receipt": {
      "clientRequestId": "client_submit_01",
      "outcome": "duplicate",
      "acceptedAt": "2026-06-30T12:34:56.125Z",
      "stateRevision": 42
    }
  }
}
```

Runtime command API:

```ts
type RuntimeCommandsApiEffect = {
  writeStdin(
    input: WriteCommandStdinInput,
  ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError>;
  cancel(input: CancelCommandInput): Effect.Effect<CancelCommandResult, RuntimeContractError>;
};

type RuntimeApprovalsApiEffect = {
  answer(
    input: AnswerRuntimeApprovalInput,
  ): Effect.Effect<AnswerRuntimeApprovalResult, RuntimeContractError>;
};

type RuntimeCommandsFacade = {
  writeStdin(
    input: WriteCommandStdinInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<WriteCommandStdinResult>;
  cancel(
    input: CancelCommandInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<CancelCommandResult>;
};

type WriteCommandStdinInput = {
  commandId: CommandId;
  text: string;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type WriteCommandStdinResult =
  | {
      commandId: CommandId;
      status: "accepted";
      acceptedBytes: NonNegativeSafeInteger;
    }
  | {
      commandId: CommandId;
      status: "stdin_closed" | "not_running" | "already_terminal";
    };

type RuntimeApprovalsFacade = {
  answer(
    input: AnswerRuntimeApprovalInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AnswerRuntimeApprovalResult>;
};

type AnswerRuntimeApprovalInput = {
  approvalId: RuntimeApprovalId;
  decision: "approved" | "denied";
  reason?: string;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type AnswerRuntimeApprovalResult = {
  approvalId: RuntimeApprovalId;
  commandId: CommandId;
  status: "approved" | "denied";
};

// Runtime publishes read-model invalidations after the approval and command transaction commits.
// Callers do not receive or fan out descriptors from `AnswerRuntimeApprovalResult`.

type AbortPromptInput =
  | {
      target: PromptTarget;
      mode: "queued";
      queuedMessageId: QueueItemId;
      reason?: string;
    }
  | {
      target: PromptTarget;
      mode: "active-turn";
      turnId?: TurnId;
      reason?: string;
    }
  | {
      target: PromptTarget;
      mode: "all-for-surface";
      reason?: string;
    };

type CancelCommandInput = {
  commandId: CommandId;
  reason?: string;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type CancelCommandResult = {
  commandId: CommandId;
  status: "cancelling" | "cancelled" | "already_terminal";
};
```

`clientSubmission` on `WriteCommandStdinInput` is client metadata, not a retry-safe idempotency
guarantee after live stdin admission has occurred. Runtime must not accept stdin into a live command
session and then silently treat a failed state receipt as idempotently replayable. Accepted stdin
becomes authoritative only through the durable stdin receipt written by `RuntimeCommandStatePort`.

Workspace-scoped bridge adapters may use `workspaceId` only for renderer transport placement or
optional bridge-level validation. They call the single bootstrap-provided runtime facade with
`WriteCommandStdinInput`; runtime derives workspace, surface, ownership, durable command status, and
live stdin routing from the durable `CommandId` state row. Cross-workspace command ids fail as
`target-not-found` or a typed bridge validation error. They are never retried against another
workspace, active tab, focused pane, or Shell `session_id`.

Concrete command and approval facade calls:

These examples are schema-backed by `packages/core/src/runtime-contracts.ts` and covered by
`packages/core/src/runtime-contracts.test.ts`: `WriteCommandStdinInput` is exactly
`{ commandId, text, clientSubmission? }`, not `{ input }`; accepted stdin results must include
`acceptedBytes`; closed/not-running/terminal stdin results must not include `acceptedBytes`;
`AnswerRuntimeApprovalInput` is exactly `{ approvalId, decision, reason?, clientSubmission? }`; and
`AnswerRuntimeApprovalResult` returns only `{ approvalId, commandId, status }`, without command
previews, invalidation arrays, workspace snapshots, or renderer descriptors.

```ts
const stdinResult = await runtime.commands.writeStdin({
  commandId: "cmd_44" as CommandId,
  text: "y\n",
  clientSubmission: {
    clientRequestId: "stdin_1",
    source: "desktop",
  },
});
// =>
// {
//   commandId: "cmd_44",
//   status: "accepted",
//   acceptedBytes: 2,
// }

const stdinClosedResult = await runtime.commands.writeStdin({
  commandId: "cmd_44" as CommandId,
  text: "next\n",
});
// =>
// {
//   commandId: "cmd_44",
//   status: "stdin_closed",
// }

const stdinNotRunningResult = await runtime.commands.writeStdin({
  commandId: "cmd_44" as CommandId,
  text: "next\n",
});
// =>
// {
//   commandId: "cmd_44",
//   status: "not_running",
// }

const stdinTerminalResult = await runtime.commands.writeStdin({
  commandId: "cmd_44" as CommandId,
  text: "next\n",
});
// =>
// {
//   commandId: "cmd_44",
//   status: "already_terminal",
// }

const cancelResult = await runtime.commands.cancel({
  commandId: "cmd_44" as CommandId,
  reason: "User stopped task",
});
// =>
// {
//   commandId: "cmd_44",
//   status: "cancelling",
// }

const approvalResult = await runtime.approvals.answer({
  approvalId: "approval_9" as RuntimeApprovalId,
  decision: "approved",
  reason: "User approved command execution.",
  clientSubmission: {
    clientRequestId: "approval_9_confirm",
    source: "desktop",
  },
});
// =>
// {
//   approvalId: "approval_9",
//   commandId: "cmd_shell_9",
//   status: "approved",
// }

const deniedApprovalResult = await runtime.approvals.answer({
  approvalId: "approval_10" as RuntimeApprovalId,
  decision: "denied",
  reason: "User denied command execution.",
});
// =>
// {
//   approvalId: "approval_10",
//   commandId: "cmd_shell_10",
//   status: "denied",
// }
```

`Runtime.approvals.answer(...)` is part of the canonical runtime service and facade. Approval waits
must not be answered through command cancellation, prompt abort, state facades, or renderer-only
adapters. Approval answers do not have a public `duplicate` result variant. Repeating the same
approval answer, reusing the same `clientSubmission`, or submitting the opposite decision after an
approval has terminalized either fails as `stale-state`, `state-conflict`, or `target-not-found`
according to the committed approval/command state, or returns the original result only if the
state-port contract explicitly includes tested idempotency. `AnswerRuntimeApprovalResult.status`
values are only the accepted terminal decision: `"approved" | "denied"`.
An already-created approval request may be classified with `approvalKind: "dependency"`, but
`Runtime.approvals.answer(...)` only answers that committed approval row; it does not create, plan,
start, continue, or resume extension dependency install/update work.

The shipped runtime public surface excludes user-clicked Extensions UI dependency install/update
admission. Dependency-action admission is absent from the shipped runtime public surface unless a
runtime-owned contract specifies app-global scope, immutable dependency planning through
`@svvy/extensions`, durable command and approval facts, sandboxed package-manager execution,
readiness refresh, command/read-model invalidation, cancellation, shutdown, and recovery. Renderer,
desktop bridge, browser tool, headless adapter, extension, generated package, and agent surfaces do
not receive dependency-action public facades,
unimplemented methods, or dependency-action continuation/admission calls.

There is no schema-backed dependency-action admission contract in `@svvy/core`, no
`Runtime.commands.runExtensionDependencyAction(...)` method, and no dependency-action result shape.
Runtime may already answer dependency approval requests through the generic
`runtime.approvals.answer(...)` contract when a command/approval fact exists, but that approval
answering API is not an install/update admission API and must not be treated as one. Callers cannot
start dependency install/update work through runtime; user-clicked install/update controls remain
unavailable or route through an explicitly separate, fully specified product path.

A dependency-action admission contract requires a method contract table naming exact `inputCodec`,
`resultCodec`, public error reasons, state-port methods, emitted events/invalidations, and tests.
That promotion must define one admission shape and must keep dependency approval answering
command-scoped through `runtime.approvals.answer(...)`. Runtime must
not infer dependency action admission or approval from renderer state, shell approval mode,
`full-access`, focused pane state, dependency readiness rows, or the existence of a dependency
approval fact alone.

Runtime does not create dependency-action command facts, select a package-manager `cwd`, derive a
sandbox launch scope, write dependency readiness facts, or start package-manager execution through a
public dependency-action admission method. Extension dependency artifacts are app-owned extension
package/install artifacts, not workspace-owned files; any promoted dependency-action admission must
keep workspace identity as UI lineage only and must not infer execution scope from the active tab,
focused pane, selected session, last opened workspace, shell approval mode, or `full-access` command
setting.

`cancel(...)` is the public command cancellation entrypoint for desktop and automation consumers.
The input carries only the durable `commandId`, optional caller-authored reason string, and optional
client submission telemetry. The public reason string is caller note metadata; runtime maps public
caller cancellation to the internal lifecycle reason `"user"` before entering command-session
cancellation. Runtime resolves workspace, surface, running process, approval wait, command
family, and ownership state from `@svvy/state`; callers do not duplicate workspace or surface
identity in the request. Cancelling a terminal command is a no-op only when the terminal command fact
has already committed; cancelling a running command interrupts the scoped runtime resource and
commits the terminal cancellation fact through state before publishing invalidations.
The result reports the durable command id plus whether runtime started cancellation, observed an
already committed cancellation, or found an already terminal command. UI callers still refetch the
command read model after `command.changed` or read-model invalidation events; the result is not a
command snapshot.

Desktop, browser-tools, and headless facade adapters must not approximate these command APIs through
prompt abort, transient CLI requirement helpers, or surface-level cancellation. The shipped app
bootstrap exposes these methods only when backed by `@svvy/runtime` command lifecycle services that
can resolve a durable `commandId`, interrupt the scoped resource that owns it, and commit the
terminal command fact through `@svvy/state`. Separately named test-only adapters that are not
returned by `createRuntimeFacade(...)` may omit command lifecycle methods entirely instead of
exposing unimplemented methods.

Source edit API:

```ts
type RuntimeSourceEditsService = {
  open(input: OpenExtensionSourceEditInput): Effect.Effect<SourceEditSession, RuntimeContractError>;
  save(
    input: SaveExtensionSourceEditInput,
  ): Effect.Effect<SourceEditSaveResult, RuntimeContractError>;
};

type RuntimeSourceEditsFacade = {
  open(
    input: OpenExtensionSourceEditInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceEditSession>;
  save(
    input: SaveExtensionSourceEditInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceEditSaveResult>;
};
```

`OpenExtensionSourceEditInput`, `SaveExtensionSourceEditInput`, `SourceEditSession`, and
`SourceEditSaveResult` are core-owned runtime source-edit contracts reused by runtime exactly.
`RuntimeSourceEditsService` and `RuntimeSourceEditsFacade` are runtime-owned service/facade
group shapes, not `@svvy/core` exports. Runtime does not define a renderer-specific source save shape. `open(...)` delegates the file read
to `@svvy/extensions`, then returns the source version, fingerprint, text, and diagnostics for the
draft editor. `save(...)` delegates compare-and-swap or explicit overwrite to `@svvy/extensions`;
the extension service atomically replaces the file and returns the file-write receipt, new
fingerprint, generated diagnostics, and source reference. Runtime records the source-version,
fingerprint, diagnostic, and read-model facts through `@svvy/state` ports after the file write,
then schedules source-invalidation recovery if reconciliation is required. Runtime publishes only
typed read-model invalidations after committed state changes. The result never includes generated
prompt read-model payloads, generated package contents, renderer draft state, or UI conflict-control fields;
callers refetch the affected read models after invalidation notifications.

Exact `open(...)` input:

```ts
type OpenExtensionSourceEditInput = {
  sourceKind:
    | "builtin-extension"
    | "user-extension"
    | "workflow-agent"
    | "workflow-prompt"
    | "workflow-component"
    | "workflow-workflow";
  sourceId: string;
};
```

Exact `open(...)` success result:

```ts
type SourceEditSession = {
  sourceKind: OpenExtensionSourceEditInput["sourceKind"];
  sourceId: string;
  path: AbsolutePath;
  sourceVersion: string;
  fingerprint: string;
  text: string;
  diagnostics: readonly SourceDiagnostic[];
};

type SourceDiagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
  code?: string;
  path?: AbsolutePath;
  line?: number;
  column?: number;
};
```

Example `open(...)` call and result:

```ts
await runtime.sourceEdits.open({
  sourceKind: "builtin-extension",
  sourceId: "base-common:instructions/full/010-base-common.mdx",
});

// {
//   sourceKind: "builtin-extension",
//   sourceId: "base-common:instructions/full/010-base-common.mdx",
//   path: "/Users/me/.config/svvy/extensions/sources/builtin/base-common/instructions/full/010-base-common.mdx",
//   sourceVersion: "sha256:6bb3...",
//   fingerprint: "sha256:6bb3...",
//   text: "Shared agent instructions...",
//   diagnostics: []
// }
```

Exact `save(...)` input:

```ts
type SaveExtensionSourceEditInput = {
  sourceKind: OpenExtensionSourceEditInput["sourceKind"];
  sourceId: string;
  expectedSourceVersion: string;
  text: string;
  saveMode: "compare-and-swap" | "overwrite";
  sourceCommandId?: CommandId;
};
```

Exact `save(...)` result variants:

```ts
type SourceEditSaveResult =
  | {
      status: "saved";
      sourceVersion: string;
      fingerprint: string;
      diagnostics: readonly SourceDiagnostic[];
      reconcileRequired: boolean;
    }
  | {
      status: "stale";
      current: SourceEditSession;
    };
```

Compare-and-swap save succeeds only when `expectedSourceVersion` matches the current DB-backed
source-version fact supplied by `RuntimeSourceStatePort`, and the extension-owned file evidence still
matches the source reference/fingerprint being saved. A stale save returns `status: "stale"` plus the
current source session and does not write the file, mutate state, publish invalidations, or schedule
source reconciliation. An overwrite save writes even when the supplied version is older, records the
new version/fingerprint through `RuntimeSourceStatePort`, publishes committed source/read-model
invalidations, and returns `status: "saved"`. Read-only or missing sources fail before file write with a typed
`RuntimeContractError` reason such as `read-only-source` or `target-not-found`; they do not return
derived read-model fields or incomplete write receipts.

Example stale `save(...)` result:

```ts
{
  status: "stale",
  current: {
    sourceKind: "builtin-extension",
    sourceId: "base-common:instructions/full/010-base-common.mdx",
    path: "/Users/me/.config/svvy/extensions/sources/builtin/base-common/instructions/full/010-base-common.mdx",
    sourceVersion: "sha256:newer",
    fingerprint: "sha256:newer",
    text: "Externally edited instructions...",
    diagnostics: [],
  },
}
```

Workflow source lifecycle methods such as `sourceEdits.createWorkflowAgent`,
`sourceEdits.duplicateWorkflowAgent`, `sourceEdits.deleteWorkflowAgent`,
`sourceEdits.createWorkflowPrompt`, `sourceEdits.deleteWorkflowPrompt`,
`sourceEdits.createWorkflowComponent`, `sourceEdits.deleteWorkflowComponent`,
`sourceEdits.createWorkflow`, and `sourceEdits.deleteWorkflow` are not public runtime
methods. They must not appear in `Runtime`, `createRuntimeFacade(...)`, desktop RPC handlers,
browser tools, or headless automation until the implementation, schemas, state-port calls, emitted
invalidations, and positive/negative contract tests are added to this spec's canonical method
ledger. No public runtime `sourceEdits.rename*` or `sourceEdits.move*` methods exist. Desktop,
browser tools, and headless adapters must not call `@svvy/extensions` directly, write workflow
source files directly, or expose workflow source lifecycle methods outside an implemented,
schema-backed runtime method.

Desktop, browser-tools, and headless facade adapters do not provide a source-edit callback table.
They compose the same app root graph as every other consumer. That root graph provides
`Extensions` by composing `Extensions.layer` with its direct requirements such as
`ExtensionSourceRootsPort`, `FileSystem.FileSystem`, `Path.Path`, and `Crypto.Crypto`; it also
provides runtime's direct `RuntimeSourceStatePort` requirement through the state layer.
`RuntimeLayerRequirements` itself requires the already-built `Extensions` service, not
`Extensions.layer`'s transitive source-root, file, path, or crypto ports. The runtime service owns
the `sourceEdits` orchestration and exposes the same implemented facade shape from
`createRuntimeFacade(...)`; adapters that cannot provide the root graph requirements fail
composition instead of exposing unimplemented source-edit methods.

Source invalidation API:

```ts
type RuntimeSourceInvalidationApiEffect = {
  hint(input: SourceInvalidationHint): Effect.Effect<void, RuntimeContractError>;
  reconcile(
    input: SourceReconcileRequest,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  applyCommittedScanEvent(
    input: ApplyCommittedSourceInvalidationEventInput,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  refreshGeneratedContext(
    input: RefreshGeneratedContextRequest,
  ): Effect.Effect<void, RuntimeContractError>;
  refreshGeneratedPackages(
    input: InternalRefreshGeneratedPackagesRequest,
  ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
};

type RuntimeSourceInvalidationFacade = {
  hint(input: SourceInvalidationHint, options?: RuntimeFacadeCallOptions): Promise<void>;
  reconcile(
    input: SourceReconcileRequest,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceReconcileResult>;
  applyCommittedScanEvent(
    input: ApplyCommittedSourceInvalidationEventInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SourceReconcileResult>;
  refreshGeneratedContext(
    input: RefreshGeneratedContextRequest,
    options?: RuntimeFacadeCallOptions,
  ): Promise<void>;
  refreshGeneratedPackages(
    input: RefreshGeneratedPackagesRequest,
    options?: RuntimeFacadeCallOptions,
  ): Promise<GeneratedPackagesRefreshResult>;
};
```

`SourceDomain`, `SourceInvalidationScope`, `SourceInvalidationHint`,
`CommittedSourceInvalidationEvent`, `ApplyCommittedSourceInvalidationEventInput`,
`SourceReconcileRequest`, `SourceReconcileResult`, `GeneratedPackagesRefreshResult`, and source
invalidation input shapes are imported from `@svvy/core`; runtime does not redefine
source-invalidation contract shapes.
`RefreshGeneratedPackagesRequest` is the public app-global request shape only. The runtime Effect
service may accept `InternalRefreshGeneratedPackagesRequest` so package-private recovery and
link-repair work can use `scope: "workspace-link-repair"`. Renderer, browser-tool, headless, and
Promise facade callers must use the public app-global request shape. App-global results always
return `workspaceLinks: []`.

Runtime owns source invalidation through package-private services, not through
`RuntimeLayerSourceInvalidationPort` or an app/bootstrap source callback table:

- `RuntimeSourceInvalidationService` implements `RuntimeSourceInvalidationApiEffect`. It validates
  decoded core inputs, delegates hint classification, scan requests, acquired workspace listing,
  and deterministic scan reconciliation to `RuntimeSourceInvalidationScanPort`. `reconcile(input)`
  obtains an already committed scan event from that scan port and then calls
  `applyCommittedScanEvent({ scope: input.scope, event })`. `applyCommittedScanEvent(input)`
  publishes the committed scan `afterCommit` descriptors through `RuntimeEventBus`, then invokes
  runtime-owned reactions for generated-package refresh and generated-context refresh. The scan port
  is the bootstrap composition seam for selecting app-global or workspace coordinator instances; it
  is not a semantic source-invalidation service, watcher table, state writer, descriptor publisher,
  or generated refresh callback.
- `RuntimeGeneratedPackageRefreshService` owns app-global generated-package refresh execution. It
  calls `Extensions.generatedPackages.refresh(...)`, commits generated-package build facts through
  `RuntimeGeneratedPackageStatePort`, publishes only committed after-commit descriptors through
  `RuntimeEventBus`, and schedules workspace-link repair after app-global facts commit. It never
  applies workspace links before generated-package facts are durable and never duplicates generated
  file lists into state when generated-package evidence manifests already provide file-backed detail.
- `RuntimeGeneratedContextRefreshService` owns the runtime-facing generated-context refresh boundary
  for `sourceInvalidation.refreshGeneratedContext(...)`. It delegates to the primitive
  `RuntimeGeneratedContextRefreshHostPort.refresh(...)` adapter and maps failures to
  `RuntimeContractError`; committed state facts and notifications are produced by that admitted host
  refresh path. General source invalidation routing does not carry broad generated-context refresh
  callbacks.
- Generated-package refresh owns workspace-link repair inside
  `RuntimeGeneratedPackageRefreshService`. The service wires
  `Extensions.generatedPackages.planWorkspaceLink(...)` as its package-private
  `planWorkspaceLinkRepair(...)` operation, combines it with bootstrap-provided
  `RuntimeGeneratedPackageRefreshHostPort` primitives such as
  `materializeCoreTypeContractPackage()`, `workspaceLinkFileHost`, workspace id listing, and
  `now()`, and records results through generated-package state ports. Runtime calls
  `materializeCoreTypeContractPackage()` only before a build that includes `@svvyx/workflows`;
  app/bootstrap writes the declaration-only app-owned `@svvy/core` type-contract package at
  `coreTypeContractPackageRoot`. Public app-global refresh results include package statuses and
  recovery work ids only; their `workspaceLinks` array is always empty. Workspace-link statuses are
  returned only by the internal
  `workspace-link-repair` lane and are committed through
  `RuntimeGeneratedPackageStatePort.recordWorkspaceLinkStatus(...)`. No separate public
  workspace-link repair facade is exported.

File-backed truth for source invalidation remains in `@svvy/extensions` source roots, generated
package roots, external instruction files, and discovered host Markdown sources. DB/product-state
truth remains in `@svvy/state` source-version/source-fact rows, generated-package facts,
workspace-link facts, generated-context binding facts, app logs, and recovery rows. Runtime
process-local queues, debouncers, coalescing maps, watcher close handles, and scoped fibers are only wake
and scheduling machinery. Lost watcher events cannot lose product work because each coordinator
also supports deterministic `reconcile(...)` and startup/recovery scans.

For workspace `host_snippets` scans, each configured watch input carries its authoritative host
source (`claude` or `pi`) and discovery scope (`user` or `workspace`). Runtime enumerates Claude
roots recursively and pi roots non-recursively, canonicalizes every absolute file identity, parses
Markdown frontmatter through the core-owned snippet parser, and calls
`RuntimeSourceStatePort.reconcileDiscoveredHostSnippets(...)` instead of recording a fingerprint-only
scan. A missing path is deletion evidence; a path or directory that still exists but cannot be read
is diagnostic/retention evidence. Runtime therefore passes unreadable file and root identities to
state so the previous row remains active until a readable scan can authoritatively replace or delete
it. Runtime emits the returned `snippets` invalidation only after that atomic reconciliation commit.

Watcher/debounce, generated-package refresh, and workspace-link repair services use the worker rules
from `effect-v4.spec.md`: bounded process-local queues, keyed coalescing by source domain/scope or
workspace/package, deterministic `drain(...)` / `drainKey(...)` test handles, adopted
`Effect.sleep` / `Duration` cadence loops for periodic reconciliation, adopted `Schedule` members
for bounded exponential retry calculations, `TestClock` in Effect tests, durable attempt rows for
product-visible retries, and typed app-log facts for terminal failures. App/bootstrap provides
primitive filesystem/path/crypto, packaged-root, and watcher-handle capabilities only; it does not
provide a semantic source invalidation service, generated-package refresh service,
workspace-link repair host-port primitives beyond the named bootstrap port, watcher callback table,
or source coordinator service. App/bootstrap may create and close app-global or workspace
coordinator handles only through `@svvy/runtime/source-invalidation-coordinator-adapter`, then bind
those handles behind `RuntimeSourceInvalidationScanPort`; source-invalidation classification,
fingerprint reconciliation, state commits, descriptor publication, generated refresh reactions, and
recovery semantics remain runtime-owned.

`sourceInvalidation` is a runtime coordination group, not a renderer state-write API. Browser tools,
headless automation, tests, app bootstrap, and runtime recovery may call its public methods when
they need to drive file-backed source reconciliation or generated refresh work programmatically.
Desktop renderer panes do not call it for DB/product-state-backed UI writes; they use state command
facades and then refetch read models from runtime notifications.

`hint(...)` is an advisory file-backed source hint that schedules deterministic source scans or
narrower source refresh work; it does not trust raw watcher events as authoritative state.
`reconcile(...)` runs deterministic scans for startup, periodic backstop, watcher-debounce,
ignored-path parent-domain scan, manual, or recovery reasons, then applies the committed scan event
through `applyCommittedScanEvent(...)`. `applyCommittedScanEvent(...)` accepts one committed
source-scan event from an acquired source coordinator or scan-port binding, publishes its
descriptor-derived events, runs runtime-owned generated-package/generated-context reactions, and
returns the same `SourceReconcileResult` receipt shape as `reconcile(...)`. It does not accept raw
watcher paths, renderer-authored descriptors, generated-output previews, or state read-model
payloads. `refreshGeneratedContext(...)` and `refreshGeneratedPackages(...)` call the corresponding
runtime refresh services at their existing safe scheduling boundaries.

`sourceInvalidation` methods fail only with `RuntimeContractError` and use these exact public
reasons:

- `invalid-input`: malformed source domain, unsupported scope/domain pair, path outside the
  configured source root for that scope, invalid reconcile reason, duplicate domains, or a request
  that attempts to refresh generated context/packages through a `RuntimeEffectRequest` envelope
  instead of the named public input.
- `target-not-found`: workspace-scoped request references a workspace/surface binding that state
  cannot find.
- `stale-state`: reconciliation, generated-context refresh, generated-package refresh, or link
  repair loses a compare-and-set/source-version race to a newer committed source fact.
- `state-conflict`: state rejects a transaction because committed product facts violate the
  expected invariant and retry/recovery must observe durable state before trying again.
- `unsupported-operation`: a scope/domain/method pair is deliberately outside the shipped contract,
  such as workspace-scoped Workflows source refresh or app-global external-instruction hints.
- `schema-error`: a decoded generated-context or generated-package evidence payload from
  `@svvy/extensions` fails the public `@svvy/core` schema.

`sourceInvalidation` does not return non-authoritative diagnostics. Durable diagnostics are
written as app-log, `runtime_source_root_fingerprint_fact`, generated-context, generated-package, or
recovery facts and then read through state read models.

Product-state invalidation enters runtime event publication only as committed
`afterCommit: readonly StateInvalidationDescriptor[]` values returned by state-backed write ports or
by `@svvy/state` command facades handing committed descriptors to the core-owned
`StateCommandPostCommitNotificationPort` implemented by `@svvy/runtime`, plus the narrow
`@svvy/runtime/app-log-commit-notification-adapter` path for a real committed append observed from
the owning state app-log facade. On that path app/bootstrap supplies only the app-global/workspace
source scope; the package-private runtime service constructs the fixed `appLogs` descriptor and
publishes it. App/bootstrap only wires
the layers and facades; it does not collect, transform, publish, or retry descriptors. Public runtime
facades do not accept raw `StateInvalidationDescriptor` values. The only public runtime
method whose input contains descriptors is
`sourceInvalidation.applyCommittedScanEvent(input)`, and those descriptors are valid only as part of
the committed source-scan event shape produced by an acquired source coordinator or scan-port
binding after the corresponding source-fingerprint write committed. Any other public
descriptor-driven invalidation method requires PRD and runtime/state spec updates, must require a
real state write result rather than caller-authored descriptors, and must reject descriptors supplied
by desktop, renderer, browser-tool, headless, generated-package, or extension callers.
DB/product-state-backed invalidations must not be implemented by watching generated outputs,
renderer panes, or caller-authored descriptor payloads. Product hosts always expose the complete
package-root `Runtime`/`RuntimeFacade` contract. Only separately named test adapters may omit
source-invalidation operations, and they must not approximate a missing refresh by emitting only a
notification without committed state facts.

Runtime publishes committed descriptors through the package-private runtime event bus via
`publishStateInvalidations({ afterCommit })`, preserving descriptor order and mapping each
descriptor to `app_read_model.changed` or `workspace_read_model.changed`. Publication failure never
rolls back committed state. It also must not silently drop post-commit work: the runtime-owned
post-commit lane records an app-log/recovery observation and wakes or creates the appropriate
recovery row when the committed descriptor or queue lane still needs downstream delivery. Duplicate
prevention belongs to the state write/idempotency boundary. Any
receipt contract used for publication idempotency must be named in both `@svvy/core` and
`@svvy/runtime` package specs before implementation.

`hint(...)` is a watcher hint. It schedules deterministic source-root fingerprint scans and never
treats the changed path as authoritative by itself. Only committed
`runtime_source_root_fingerprint_fact` changes, not raw watcher paths or `runtime_source_scan_fact`
receipts, drive source-derived refresh and invalidation decisions. App-global hints use
`scope: { kind: "app-global" }` and only cover Extensions and Workflows source roots. Workspace hints use
`scope: { kind: "workspace", workspaceId }` and only cover external instruction candidates and
discovered host snippet sources for that workspace. Runtime publication handles
DB/product-state-backed writes that already committed through `@svvy/state`, such as settings,
profile, or managed-snippet changes, only through the returned `afterCommit` descriptors. Source
diagnostics produced by source edits or source reconciliation publish the returned invalidation
descriptors through the source-invalidation flow, not as independent DB-backed write examples. The
two public refresh facade methods accept only the dedicated `RefreshGeneratedContextRequest` and
public app-global `RefreshGeneratedPackagesRequest` inputs. The runtime Effect service and closed
runtime-effect variants may use internal request contracts such as
`InternalRefreshGeneratedPackagesRequest`, but public runtime facades never accept a
`RuntimeEffectRequest` envelope or an internal workspace-link-repair request. The envelope is carried
only inside ordered `ExtensionRuntimeOperation` items returned from extension handlers to runtime.

Promoted `sourceInvalidation` method contracts:

| Method                            | State/package calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Emitted invalidations/events                                                                                                                                                                                                                                                                                                                                                                         | Required tests                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hint(input)`                     | validate scope/domain/root path; enqueue/coalesce coordinator work in the app-global or workspace source coordinator; no state write until deterministic scan confirms a change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | none for ignored duplicate hints; after scan commits, publish runtime events derived from returned `afterCommit` descriptors                                                                                                                                                                                                                                                                         | rejects invalid scope/domain/root path pairs; coalesces duplicate hints; ignores generated outputs; uses TestClock debounce                                                                                                                                                                                                                             |
| `reconcile(input)`                | delegate deterministic scan work to `RuntimeSourceInvalidationScanPort.reconcile(input)`; when the scan port returns a committed event, call `applyCommittedScanEvent({ scope: input.scope, event })`. `RuntimeSourceStatePort.recordSourceScan(...)` may be used by the coordinator/scan binding; source saves/deletes remain reserved for explicit `sourceEdits` operations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | return the `SourceReconcileResult` from committed event application, or an empty result when no domains changed. The returned count is a receipt only; callers refetch read models through state facades instead of receiving invalidation descriptors in the Promise result.                                                                                                                        | startup/periodic/manual/recovery reasons; all-domain default; one scan per coordinator/domain; failed scan recovery row                                                                                                                                                                                                                                 |
| `applyCommittedScanEvent(input)`  | validate the committed scan event scope/domain pair; publish `event.afterCommit` through `RuntimeEventBus`; for app-global changes, refresh affected generated packages; for app-global extension changes, refresh generated context for acquired workspaces; for workspace external-instruction or host-snippet changes, refresh generated context for that workspace. The input must come from an acquired source coordinator or scan-port binding after the scan state write committed; runtime does not accept renderer-authored descriptors, watcher paths, generated-output previews, or read-model payloads. Publication failure fails the method before refresh reactions run.                                                                                                                                                                                                                                                                                                                                                                                                                | return `changedReadModelCount`, `generatedPackageRefreshes`, and `recoveryWorkIds`; publish runtime events derived from committed state `afterCommit` descriptors plus app-log diagnostics. The result contains receipt facts only and never carries `StateInvalidationDescriptor` values or read-model payloads.                                                                                    | applies app-global and workspace committed scan events without calling scan reconciliation; rejects invalid scope/domain pairs; publication failure stops reactions; result schema rejects non-receipt payloads                                                                                                                                         |
| `refreshGeneratedContext(input)`  | schedule or run generated-context build through `@svvy/extensions`, persist actor binding and stale/freshness facts through `RuntimeActorExtensionBindingStatePort`; trusted context-impact transport is applied through runtime-effect requests rather than the public generated-context refresh facade                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | generated-context, Agents/Extensions, and affected surface stale/read-model invalidations after commit                                                                                                                                                                                                                                                                                               | safe pre-dispatch refresh; opt-out surfaces remain stale; invalid source keeps previous ready context                                                                                                                                                                                                                                                   |
| `refreshGeneratedPackages(input)` | public app-global input schedules generated-package refresh through `@svvy/extensions`, retains the returned build plan, and records app-global build/failure facts through generated-package state ports. The successful `@svvyx/workflows` write includes the plan's required build id and complete `workflowsExports` snapshot; the state transaction atomically replaces the current export rows with that snapshot. Extension writes and all failed writes omit export evidence, so a failed Workflows build preserves the last successful rows. Runtime then schedules workspace-link repair service work for acquired workspace scopes; each package-private repair lane separately asks `@svvy/extensions` for a `planWorkspaceLink(...)` result and records workspace-link facts only after applying runtime-owned link repair. For `scope: "app-global"`, the result's `workspaceLinks` array is always empty; acquired-workspace repair and unopened-workspace recovery are downstream runtime-owned work. Only the internal `workspace-link-repair` lane returns workspace-link receipts. | app-scoped `workflowsGenerated` invalidations for the atomically committed `@svvyx/workflows` fact/export snapshot and app-scoped `extensions` invalidations for `@svvyx/extensions` build facts; workspace-link repair emits later descriptor-derived app/workspace invalidations from committed link facts and never appears as app-global generated-package refresh payload or read-model payload | public caller policy rejects workspace-link-repair scope; `@svvyx/extensions` before dependent `@svvyx/workflows`; app-global build once; exact export evidence handoff; atomic Workflows fact/export replacement; failed build preserves prior rows; unopened workspace repair recovery; app-global refresh result never contains workspace-link plans |

`refreshGeneratedPackages(...)` returns only app-global build statuses and recovery work ids for
scheduled follow-up. Matching app read-model invalidations are published as runtime events after
committed generated-package state facts and, for Workflows success, its state-owned export snapshot.
The runtime must not project only `buildPlan.packages` and drop `buildPlan.workflowsExports` before
the state write. Workspace link repair is woken only after the
generated-package fact commit and is reported by later descriptor-derived `workflowsGenerated`,
`extensions`, workspace-link, app-log, or workspace readiness invalidations from committed
workspace-link facts. The app-global result must not include workspace-link plans, link operations,
per-workspace success/failure statuses, repaired paths, or read-model payloads, and must not imply
that synchronous workspace-link repair has completed.

Generated-package workspace-link repair is a package-private lane inside
`RuntimeGeneratedPackageRefreshService`. Runtime tests may exercise package-private drain handles
for that refresh service, but no separate public workspace-link repair facade or distinct result
type is exported. The internal lane uses the shared `GeneratedPackagesRefreshResult` union branch
with `scope: "workspace-link-repair"`, `packages: []`, committed `workspaceLinks`, and
`recoveryWorkIds`; public runtime facades reject that scope, and app-global generated-package
refresh never returns workspace-link receipts.

Generated-package invalidations are emitted only from descriptors returned by
`RuntimeGeneratedPackageStatePort` commits. `refreshGeneratedPackages(...)` records build and link
facts through state before returning or publishing any invalidation; build success alone is not
publishable product state.

Every source-invalidation state write returns after-commit `StateInvalidationDescriptor` values from
the state-backed port that performed the write. Runtime publishes notifications only from those
descriptors or live scoped stream patches. Runtime does not publish source contents, uncommitted
source diagnostics, generated package contents, generated-context text, or renderer cache payloads as
events.

Rules:

- Callers submit only the new user message, delivery intent, addressed target, and optional client
  submission metadata.
- Callers must not submit full pi message arrays.
- Callers must not submit `systemPrompt`, generated-context read-model data, generated prompt fingerprints,
  loaded extension ids, or available extension ids.
- Runtime reads the managed surface, queue state, prompt freshness state, model/provider/reasoning
  selection through `RuntimePromptDefaultsStatePort.resolvePromptDefaults(...)`, and the current
  bound generated-context/prompt binding through
  `RuntimeActorExtensionBindingStatePort.readRuntimePromptBinding(...)`.
- Runtime refreshes generated context at the safe pre-dispatch boundary when required.
- Runtime sends the new prompt body as the real pi user message through `@svvy/pi-adapter`.
- Runtime preserves committed conversation history in pi session history and durable product facts in
  `@svvy/state`.
- Desktop and automation adapters normalize their renderer-specific request payloads before calling
  the public runtime API.
- Steering is a queue operation over an existing queued row, not a `submit(...)` delivery mode and
  not a direct pi current-turn fast path.

Example input:

```ts
await runtime.messages.submit({
  target: {
    workspaceSessionId: "wsess_01" as WorkspaceSessionId,
    surface: "handler",
    surfacePiSessionId: "pi_handler_7" as SurfacePiSessionId,
    threadId: "thread_7" as ThreadId,
  },
  message: {
    text: "The failing test is `transcript-projection.test.ts`; inspect and report the contract issue.",
  },
  delivery: "enqueue-and-run",
  clientSubmission: {
    clientRequestId: "debug-run-17",
    source: "headless",
  },
});
```

Example acceptance result:

```json
{
  "queuedMessageId": "queue_17",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "handler",
    "surfacePiSessionId": "pi_handler_7",
    "threadId": "thread_7"
  },
  "status": "queued",
  "receipt": {
    "clientRequestId": "debug-run-17",
    "outcome": "accepted",
    "acceptedAt": "2026-06-20T12:30:00.000Z",
    "stateRevision": 42
  }
}
```

Queue-only and active-lock acceptance use the same result shape:

```json
{
  "queuedMessageId": "queue_18",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "handler",
    "surfacePiSessionId": "pi_handler_7",
    "threadId": "thread_7"
  },
  "status": "queued",
  "receipt": {
    "clientRequestId": "client_req_02",
    "outcome": "accepted",
    "acceptedAt": "2026-06-20T12:31:00.000Z",
    "stateRevision": 43
  }
}
```

`runtime.messages.submit(...)` always reports durable acceptance, not live dispatch state. A
successful submit means runtime validated the target, inserted one queue row through
`@svvy/state`, and handed post-commit work to the queue manager. It does not duplicate whether the
queue manager immediately claimed the row, started a turn, or remained queued behind an active
prompt, and it does not return `turnId`. Desktop and headless consumers refetch queue, composer,
surface, and turn read models from state and/or subscribe to runtime events for live dispatch state.

`RuntimeMessageSubmissionPostCommitLane` is a runtime-owned queue wakeup boundary used only after
`messages.submit(...)` has committed the queue row and `RuntimeEventBus.publishStateInvalidations`
has accepted the committed invalidations. Runtime owns this ordering. For enqueue-and-run delivery,
the post-commit lane issues only a primitive addressed-surface wake with reason `"message-submitted"`.
For queue-only delivery, it publishes the committed invalidations and does not wake the surface
queue. The wake host receives only the addressed surface target and wake reason. It must not receive
`queuedMessageId`, queued-row payloads, normalized delivery, client submission metadata, telemetry
summaries, receipts, event invalidation lists, state-port results, dispatch results, pi session
handles, callback functions, renderer snapshots, or any mutable runtime handle. It must not insert
queue rows, publish runtime events, mutate state directly, change the public submit result, or
decide that a failed pi dispatch means the durable submit did not happen. Queue workers and pi turn
dispatch are runtime-owned services that re-read authoritative queue state before claiming work.

Promoted message and queue method contracts:

| Method                   | State/package calls                                                                                                                                                                                                                                                        | Emitted invalidations/events                                                                                                                                                                                                 | Required tests                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages.submit(input)` | validate target surface and workspace ownership; call `RuntimeQueueStatePort.acceptSubmittedSurfaceMessage(...)` to insert one durable `user_message` queue row, clear the durable composer draft, and invalidate stale delayed draft persistence in one state transaction | publish composer, queue, surface, and session read-model invalidations only after commit; for `enqueue-and-run`, issue a primitive addressed-surface wake only after commit; for `queue-only`, do not wake the surface queue | idle submit, active-turn submit, invalid target, idempotent client request, composer draft clear, enqueue-and-run queue wake-after-commit, queue-only no-wake |
| `messages.abort(input)`  | cancel queued rows or interrupt the active turn through state and active-turn services according to `AbortPromptInput.mode`                                                                                                                                                | publish queue, turn, command, request-input, and surface invalidations only after terminal/cancel facts commit                                                                                                               | queued cancel, active-turn cancel, all-for-surface cancel, stale turn id, exactly-once prompt-lock release                                                    |
| `queues.steer(input)`    | validate the existing queued row belongs to the target, then move it to the front of the target queue through `RuntimeQueueStatePort.markSurfaceMessageQueued({ position: "front" })`                                                                                      | publish `queue.changed` and queue/composer read-model invalidations after commit; wake only the addressed surface queue                                                                                                      | same-surface validation, queued-only validation, claim order, no active-turn mutation                                                                         |

Desktop exposes `deleteQueuedSurfaceMessage` only as a renderer-safe adapter over
`runtime.messages.abort({ mode: "queued", target, queuedMessageId, reason })`; it is not a
product-state mutation API. The RPC may call a read-only catalog refresh helper only to return the
renderer-safe `SurfaceMutationResponse` snapshot shape.
No app handler may call `catalog.deleteQueuedSurfaceMessage(...)` or mutate the queue store directly
for queued deletion.

## Runtime Event API

Runtime exposes one typed event stream:

```ts
type RuntimeEventSubscriptionClose =
  | {
      reason: "closed";
      eventGenerationId: RuntimeEventGenerationId;
      lastContiguousSequence: RuntimeEventSequence;
      rebaselineRequired: false;
    }
  | {
      reason: "slow-consumer";
      eventGenerationId: RuntimeEventGenerationId;
      lastContiguousSequence: RuntimeEventSequence;
      rebaselineRequired: true;
    }
  | {
      reason: "runtime-shutdown" | "runtime-restart";
      eventGenerationId: RuntimeEventGenerationId;
      lastContiguousSequence: RuntimeEventSequence;
      rebaselineRequired: true;
    };

type RuntimeEventSubscription = AsyncIterable<RuntimeEvent> & {
  close(): Promise<void>;
  readonly closed: Promise<RuntimeEventSubscriptionClose>;
};

type RuntimeEventsApi = {
  events(input?: {
    workspaceId?: WorkspaceId;
    workspaceSessionId?: WorkspaceSessionId;
    includeAppEvents?: boolean;
    eventGenerationId?: RuntimeEventGenerationId;
    afterSequence?: RuntimeEventSequence;
  }): Promise<RuntimeEventSubscription>;
};
```

`lastContiguousSequence` is initialized when the subscription is admitted. If `afterSequence` is
provided, the initial value is that decoded sequence. If `afterSequence` is omitted, runtime uses
the event bus high-water sequence visible at subscription setup. A subscription that closes before
delivering any event returns that initialized value. After event delivery begins, the value is the
highest sequence delivered contiguously to that subscriber before close.

Facade event setup is asynchronous because replay-window validation and subscription setup may fail
before the stream is exposed. `RuntimeEventsInput` does not include `AbortSignal`; facades may
accept `RuntimeFacadeCallOptions` as a second parameter and bridge adapters may also translate
framework cancellation into async iterator closure without adding a second core event-input schema.
The package-private facade helper is `asyncIterableFromRuntimeEventSubscription(...)`. It converts
one acquired `RuntimeEventSubscriptionEffect` into the public `AsyncIterable` shape, owns the bridge
subscription scope, calls the subscription `close()` method on iterator `return()`, consumer
throw/early return, facade shutdown, and runtime disposal, and resolves `closed` exactly once with
natural completion, explicit unsubscribe, slow-consumer rebaseline, runtime shutdown, or runtime
restart. Public facade code does not call `Stream.toAsyncIterable*` directly.

The Effect-native API is:

```ts
type RuntimeEventSubscriptionEffect = {
  stream: Stream.Stream<RuntimeEvent, never>;
  close(): Effect.Effect<void>;
  readonly closed: Effect.Effect<RuntimeEventSubscriptionClose>;
};

type RuntimeEventsApiEffect = {
  events(
    input?: RuntimeEventsInput,
  ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
};
```

`RuntimeEvent`, `RuntimeEventsInputSchema`, and `RuntimeEventSequence` are defined in `@svvy/core`.
`RuntimeEventsInputSchema` decodes with `strictBoundaryParseOptions`; `afterSequence` is a branded
non-negative safe integer, not raw `number`.

Runtime events are notifications, not the durable state source. A consumer that needs current
surface, command, inspector, session-navigation, request-input, approval, app-log, generated
package, Agents, Extensions, Snippets, or Settings data must fetch a read model from `@svvy/state`.
`workspaceId` and `workspaceSessionId` filter workspace-scoped events after they are assigned an
app-runtime sequence. App-scoped events are included when no workspace filter is provided or when
`includeAppEvents` is true. Filtering does not renumber events.
`RuntimeEventsInput.afterSequence` is an in-process replay hint against the app-runtime event
sequence. Once a consumer has received an event or close receipt, future cursor-based
resubscriptions pass both `eventGenerationId` and `afterSequence`; `afterSequence` without a
matching generation is accepted only as a non-authoritative current-runtime cursor hint and must fail with
`RuntimeEventRebaselineRequired` when the runtime cannot prove it belongs to the active generation.
The Effect service returns `RuntimeEventSubscriptionEffect`; the Promise facade mechanically adapts
that object to `RuntimeEventSubscription`. Neither public API returns a bare event stream, because
public consumers must know why the stream closed. Iteration still yields only `RuntimeEvent` values.
Close receipts are edge delivery metadata, not runtime events, are not persisted, and are not
replayed. Consumers that receive `rebaselineRequired: false` and `reason: "closed"` may keep their
current read-model cache. Consumers that receive `rebaselineRequired: true`,
`reason: "slow-consumer"`, or any close reason other than explicit `"closed"` refetch affected state
read models before resubscribing from the returned `lastContiguousSequence` when it is still inside
the replay window.
Resubscription from `lastContiguousSequence` is an in-process event replay optimization only, not
durable catch-up. Runtime public event replay is served from the runtime-owned sequence ring/index,
not from PubSub replay or subscriber queues. Filtered per-subscriber queues own live delivery
pressure; the ring owns cursor semantics.
Every yielded `RuntimeEvent` carries the current `eventGenerationId` adjacent to its sequence so
consumers can persist `{ eventGenerationId, sequence }` as one cursor. The close receipt also
returns the generation that produced `lastContiguousSequence`. A sequence value without its
generation is not a durable or cross-process cursor.
`events({ afterSequence })` must create the per-subscriber queue in the returned subscription scope
while holding the event-bus publication lane, validate the ring high-water sequence, register that
queue in the live fanout map, and only then return the subscription. The implementation must not
create a process-local stream in a short-lived setup effect whose scope can close before the
returned stream is consumed. After subscription registration, runtime emits retained ring entries
with `sequence > afterSequence`, then emits live entries with `sequence > highWater`. If the
requested sequence is older than the retained replay window, belongs to a previous app runtime
instance, or cannot be served losslessly, `events(...)` fails before returning a stream with a typed
`RuntimeEventRebaselineRequired` error before the Promise facade resolves. Consumers then refetch
affected read models from `@svvy/state` and resubscribe from the current event stream.
`RuntimeEventRebaselineRequired` includes `reason`, `requestedAfterSequence`,
`retainedFromSequence`, `currentHighWaterSequence`, `eventGenerationId`, and
`affectedReadModels`. Consumers discard their cursor when `eventGenerationId` differs, when
`requestedAfterSequence < retainedFromSequence`, or when filtering cannot be served losslessly.
An empty `affectedReadModels` array on this error is the full-rebaseline signal for the subscription
scope because runtime cannot prove the exact missed read-model ids; it never means no read models
are affected.
The public event cursor is valid only for the current app `ManagedRuntime` event generation.
Desktop, browser-tool, and headless consumers discard stored `afterSequence` cursors whenever the
app runtime restarts, the bridge reconnects after process loss, or a rebaseline error is returned.
Runtime does not persist event-stream cursors in SQLite and does not promise cross-process sequence
continuity. Durable recovery is always a state/read-model refetch.

Event/read-model pattern:

```ts
for await (const event of await runtime.events({ workspaceId })) {
  if (event.type === "surface.stream") {
    transcript.assertNextStreamSequence(
      event.target,
      event.streamGenerationId,
      event.streamSequence,
    );
    transcript.applyPatch(event.target, event.patch);
  }

  if (
    event.type === "workspace_read_model.changed" &&
    event.invalidation.model === "commandInspector"
  ) {
    const inspector = await state.readModels.fetch({
      kind: "commandInspector",
      commandId: event.invalidation.ids[0],
    });
    renderInspector(inspector);
  }
}
```

Runtime, app/bootstrap bridge adapters, browser-tool adapters, and headless adapters must not emit
renderer-only `ConversationSurfaceSnapshot` objects or pi-native message/session/model objects as
public contracts. Desktop may derive UI-local view models from `SurfaceTranscriptReadModel`, other
state read models, and contiguous `surface.stream` patches inside renderer code, but those view
models stay renderer-private and are never Electrobun RPC request/response or push-message payloads.

Desktop and headless consumers handle runtime events in exactly two ways. Read-model invalidation
events cause the consumer to refetch the named state-backed read models and replace its warm cache
from that authoritative result. `surface.stream` events are live ordered patches only; consumers may
apply them without refetching while `streamSequence` is contiguous, but on any gap, reset, runtime
restart, stale `afterSequence`, or slow-subscriber close they discard the live patch state, refetch
the surface/transcript/command read models from state, and resubscribe. Event payloads are never
durable read models.

Bottom-up notification contract:

```text
PiRuntimeEvent
-> @svvy/runtime turn/command/surface coordinator
-> core-owned state-port write or ordered live-patch publication
-> committed after-commit descriptor or contiguous surface.stream patch
-> RuntimeEvent with runtime sequence and generation
-> app/bootstrap sequencing, buffering, gap detection, and fanout
-> renderer-safe DesktopRendererNotification or headless/browser-tool notification
-> approved @svvy/state read-model facade refetch or live stream rebaseline
```

Runtime events are invalidations, progress, or ordered live patches. They are never replacement
state stores. Programmatic consumers follow the same rule as desktop: they call runtime facade
methods, subscribe to renderer-safe or headless-safe notifications, and refetch durable read models
through approved state facades whenever an event names a committed state-backed invalidation or a
live stream rebaseline is required.

Queue notification example:

```json
{
  "type": "queue.changed",
  "sequence": 42,
  "eventGenerationId": "runtime_event_gen_01",
  "workspaceId": "wksp_01",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "handler",
    "surfacePiSessionId": "pi_handler_7",
    "threadId": "thread_7"
  },
  "queuedMessageId": "queue_17",
  "status": "dispatching"
}
```

Live stream rebaseline example:

```json
{
  "type": "surface.stream",
  "sequence": 109,
  "eventGenerationId": "runtime_event_gen_01",
  "streamGenerationId": "surface_stream_gen_01",
  "streamSequence": 23,
  "workspaceId": "wksp_01",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "orchestrator",
    "surfacePiSessionId": "pi_orch_01"
  },
  "patch": {
    "type": "stream_reset",
    "reason": "rebaseline_required",
    "latestStreamSequence": 22
  }
}
```

Runtime event bus rules:

- Runtime owns a package-private event bus service with setup failures in the outer Effect channel
  and non-failing subscriptions after setup:

  ```ts
  type RuntimeEventBus = {
    publishLive(input: {
      event: Omit<RuntimeEvent, "eventGenerationId" | "sequence">;
    }): Effect.Effect<RuntimeEvent, RuntimeEventError>;

    publishStateInvalidations(input: {
      afterCommit: readonly StateInvalidationDescriptor[];
    }): Effect.Effect<readonly RuntimeEvent[], RuntimeEventError>;

    subscribe(
      input?: RuntimeEventsInput,
    ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
  };
  ```

- The event bus is not part of the package-root public runtime API. Package-root exports expose only
  `Runtime.events(...)` through the runtime service/facade. Any event-bus constructor, layer, or
  direct publisher is package-private or test-only and must not be imported by desktop, browser
  tools, headless callers, state ports, or extension handlers.
- `RuntimeEventBus` is constructed inside `Runtime.layer`. App/bootstrap must not provide a
  production event publisher port, event sequencing callback, replay buffer, subscriber queue,
  invalidation publication callback, or alternate event-bus implementation. Desktop, browser-tool,
  and headless consumers observe runtime events only through `Runtime.events(...)` on the promoted
  runtime service/facade; they cannot replace event sequencing, replay, subscriber close receipts,
  or after-commit publication policy.

  Runtime state ports return mutation receipts containing `afterCommit`. Runtime calls
  `publishStateInvalidations(...)` only after the state effect has returned successfully. State
  ports and extension handlers never publish runtime events.

  `publishLive(...)` is callable only by runtime-owned coordinators while creating an authoritative
  live stream patch. `publishStateInvalidations(...)` is callable only after the relevant state
  commit. `afterCommit` descriptors are state-invalidating facts returned by `@svvy/state`
  transaction ports; runtime publishes the matching read-model invalidation events only after the
  transaction has committed.

  `RuntimeSurfaceEventPublisher` is the package-private runtime-owned service for constructing
  `surface.stream` and `surface.changed` events before handing them to `RuntimeEventBus`. It owns
  target-local stream cursors only:

  ```ts
  type RuntimeSurfaceEventPublisher = {
    publishSurfaceChanged(input: {
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      reason:
        | "surface.updated"
        | "prompt.started"
        | "prompt.settled"
        | "background.started"
        | "surface.closed";
    }): Effect.Effect<RuntimeEvent, RuntimeEventError>;

    publishStreamPatch(input: {
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      streamGenerationId: SurfaceStreamGenerationId;
      patch: SurfaceStreamPatchInput;
    }): Effect.Effect<RuntimeEvent, RuntimeEventError>;

    resetSurfaceStream(input: {
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      streamGenerationId: SurfaceStreamGenerationId;
      reason: "rebaseline_required" | "runtime_recovered" | "surface_reopened";
    }): Effect.Effect<RuntimeEvent, RuntimeEventError>;
  };
  ```

  The publisher stores one active cursor per durable `surfacePiSessionId`. Each cursor records the
  current `streamGenerationId` plus the latest sequence for that generation; when the generation
  changes, the previous generation cursor is discarded and the target-local stream sequence starts at
  `1`. `publishStreamPatch(...)` assigns the next `streamSequence` for the target's active
  generation and never writes product state. `resetSurfaceStream(...)` publishes a `stream_reset`
  patch under the `streamGenerationId` passed by the caller. The reset patch's
  `latestStreamSequence` is the last sequence already published for that same target/generation, or
  `0` when no patch has been published for that active generation; the reset event itself receives
  the next `streamSequence`. `RuntimeEventBus` remains the sole owner of app-wide
  `eventGenerationId`, app-wide `sequence`, replay, filtering, subscriber backpressure, and close
  receipts. Desktop, browser-tool, headless, state, and extension code do not import or call
  `RuntimeSurfaceEventPublisher`.

  Runtime also implements the core-owned `StateCommandPostCommitNotificationPort` inside the
  composed app `ManagedRuntime`. App/bootstrap wires that implementation to state command facade
  transactions only after a state command returns its committed mutation receipt. The port accepts
  only those committed `afterCommit` descriptors, publishes descriptor-derived events through
  `RuntimeEventBus`, and runs runtime-owned follow-up. It is not exported from the `@svvy/runtime`
  root, not implemented by app/bootstrap, and not available to `@svvy/state`, desktop, renderer,
  extensions, browser tools, or headless callers as a generic descriptor fabrication or event
  publication surface.

- Runtime exposes one app-scoped public event stream per app `ManagedRuntime`. Workspace runtime
  scope services may use internal workspace-local hubs, but public `RuntimeEvent.sequence` values come from
  one app-wide monotonically increasing counter so app-scoped events such as
  `app_read_model.changed` and workspace-scoped events share one cursor space.
- Runtime-event ownership and app-runtime ownership are inseparable. `RuntimeEventBus` is acquired
  once inside the single app-owned `ManagedRuntime` layer graph that also owns all workspace keyed
  runtime scope entries. A per-workspace `ManagedRuntime` or per-workspace
  `RuntimeEventBus` is invalid even if each individual bus is package-private, because it creates
  multiple public cursor spaces and breaks app-scoped replay/rebaseline semantics.
- Desktop, browser-tools, and headless facade adapters delegate `events(...)` through the
  bootstrap-created runtime facade. An adapter whose facade call fails during subscription setup
  fails before returning a stream with `RuntimeEventStreamError` and reason `"stream-failed"`. It
  must not return `Stream.empty` to represent an unavailable stream, because an empty stream means the runtime is
  correctly connected and has no notifications to deliver at that moment.
- Runtime event fanout uses runtime-owned per-subscriber bounded queues acquired by the event bus
  layer. A shared `PubSub` is not the public event authority because a single `publishUnsafe(false)`
  result cannot identify the subscriber that failed to accept a live event.
- `RuntimeEventBus` owns one app-scoped publication lane guarded by the manifest-adopted
  `Semaphore.withPermit` callsite named for runtime event publication.
  `RuntimeSurfaceEventPublisher` owns one target-local cursor lane per durable
  `surfacePiSessionId`, also guarded by the manifest-adopted `Semaphore.withPermit` callsite named
  for surface stream cursor serialization. Permit scopes cover only sequence/cursor assignment,
  replay-ring append, subscriber-map snapshot, and event object construction; they must not include
  state-port writes, pi stream reads, extension handlers, command execution, renderer fanout, or
  consumer iteration.
- Runtime event fanout uses `RuntimeLayerConfig.eventSubscriberBufferCapacity` and
  `RuntimeLayerConfig.eventReplayCapacity`; their defaults are `256` and `100`. Live fanout is a
  nonblocking bounded attempt after the runtime replay ring has already accepted the notification.
  Changing those defaults requires a spec update backed by implementation benchmarks.
- Runtime event publication is serialized inside the package-private event bus. Sequence assignment,
  replay-ring append/index update, bounded live fanout attempt, and publication receipt recording
  happen in one ordered lane guarded by a one-permit `Semaphore`, `SynchronizedRef` state machine,
  or internal ordered queue. Concurrent state commits may enqueue notifications, but they must not
  publish a later sequence before an earlier sequence or append replay entries out of cursor order.
- `publishLive(...)` and `publishStateInvalidations(...)` append to the runtime-owned replay ring,
  then nonblockingly offer the accepted event to each matching active subscription queue while
  holding the ordered publication lane. The live fanout map stores each subscriber's
  `RuntimeEventsInput`; events outside that filter are not offered and cannot fill or close that
  subscriber's queue. Each public subscription owns a bounded runtime-event queue sized by
  `eventSubscriberBufferCapacity`. Runtime uses `Queue.dropping(eventSubscriberBufferCapacity)` or
  an equivalent nonblocking queue that preserves already-buffered events. It does not use
  `Queue.bounded` in a way that can suspend publication, and it does not use `Queue.sliding` where
  unseen events would be silently replaced. If the offer cannot accept the event because the
  subscriber buffer is full or closed, runtime closes only that subscription with `reason:
"slow-consumer"` and removes it from the live fanout map before publish returns. Runtime continues
  from the durable state/replay cursor and does not silently treat the event as delivered to that
  subscriber.
- Runtime public event replay is served from the runtime-owned sequence ring/index.
  `eventReplayCapacity` sizes the explicit ring. `eventSubscriberBufferCapacity` sizes each live
  subscriber queue; it is not durable state and it is not a replay window.
- `RuntimeEventBus.subscribe(...)` returns `RuntimeEventSubscriptionEffect`, never a bare
  `Stream<RuntimeEvent, ...>`. It must not expose a raw `Stream.fromPubSub(...)`,
  `Stream.fromQueue(...)`, or any process-local stream primitive directly to facade, browser-tool,
  desktop, or headless consumers. It creates one runtime-owned per-subscriber queue in the returned
  subscription scope and returns a stream over that queue plus the runtime-owned `close()` effect and
  `closed` receipt. Publication uses a nonblocking `Queue.offer(...)` for each per-subscriber queue.
  If the yielded `Queue.offer(...)` result is `false`, the subscriber buffer is full or closed:
  runtime closes only that subscription with a bridge/subscription close payload carrying
  `{ reason: "slow-consumer", eventGenerationId, lastContiguousSequence, rebaselineRequired: true }`,
  completes the exposed stream normally, and resolves the facade subscription's `closed` promise
  with that payload. Runtime shutdown and restart resolve `closed` with the matching reason and
  `rebaselineRequired: true`. Explicit consumer unsubscribe resolves `closed` with
  `{ reason: "closed", eventGenerationId, lastContiguousSequence }`. Close payloads are not
  `RuntimeEvent` values, are not appended to the replay ring, and are not visible to other
  subscribers. Runtime records the receipt/app-log diagnostic and releases the subscription queue.
  `Runtime.events(...)` remains non-failing after subscription setup. The fanout loop must never wait
  for renderer IPC, browser-tool callbacks, or consumer iteration while holding the ordered
  publication lane.
- Slow consumers never block event sequence assignment, replay-ring append, notification
  publication, queue progress, turn terminalization, or state commits after those commits are
  durable. The consumer must refetch state-backed read models and resubscribe from a valid cursor.
- The event bus layer owns the replay ring, publication lane, subscriber map, and shutdown
  finalizer inside the app-runtime scope. Subscription setup creates one queue in the subscription
  scope and closes that scope on iterator return/throw, facade close, window/workspace close,
  runtime shutdown, or setup failure. App shutdown closes every registered subscriber with
  `reason: "runtime-shutdown"` exactly once; subscription finalizers release only their own queue
  and receipt.
- Every runtime event carries a monotonically increasing app-runtime `sequence`. This is the public
  notification cursor used by `afterSequence`, replay, filtering, and bridge gap handling.
- `surface.stream` events additionally carry `{ streamGenerationId, streamSequence }` as the
  target-local live transcript patch cursor. `streamSequence` is monotonic within one stream
  generation and resets only when `streamGenerationId` changes. Runtime increments it per
  `surfacePiSessionId` for the active stream generation. A `stream_reset` patch is the reset marker
  for the generation named by that event and includes the last stream sequence that the runtime had
  already published for that same generation. Consumers discard all buffered live patches for that
  surface, refetch the authoritative transcript/read model, and only then accept later patches for
  that surface generation or its successor generation. Consumers use `streamSequence` to detect
  missed live patches for one surface and use
  `SurfaceStreamPatchInput.stream_reset.latestStreamSequence` to rebaseline that surface. Consumers
  must not use app-runtime `sequence` as a transcript patch cursor.
- Every runtime event that refers to a workspace or surface carries stable identity: `workspaceId`
  when known, `workspaceSessionId` when relevant, `surfacePiSessionId` for pi-backed surfaces,
  `turnId` or `workflowTaskAttemptId` when relevant, `commandId` for command changes, and a
  read-model invalidation key for read-model change notifications.
- Facade cancellation uses `RuntimeFacadeCallOptions.signal` before the stream is exposed and async
  iterator return/consumer cancellation after the stream is exposed. Both paths interrupt the Effect
  stream subscription scope.
- Closing a workspace, surface, window, or app scope interrupts owned event subscription fibers.
- Runtime event subscribe/setup failures use the outer Effect error channel before the stream is
  exposed; the exposed notification stream and close receipt are non-failing. Post-setup shutdown,
  restart, slow-consumer, and unsubscribe outcomes are delivered through
  `RuntimeEventSubscriptionClose`, not through stream failure. Post-subscription stream failure is
  not part of the runtime event contract. Any design that allows post-subscription stream failure
  must update this event-bus section and the Effect v4 primitive record in the same change, naming
  either per-subscriber `Queue<Take.Take<RuntimeEvent, RuntimeEventError>>` or a `PubSubTake` hub
  with explicit cursor, replay, and slow-subscriber semantics.

## Runtime Resource Lifetimes

| Resource                                      | Owner package/service                                                                                                            | Backing kind                                                                                                                                                                                                                                                                | Lifetime kind                                                            | Acquired by                                                                                                                                                              | Released by                                                                                                                        | Reused across calls    | Interruption behavior                                                                                                                                         | Required receipts/tests                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Runtime event bus                             | `@svvy/runtime` `RuntimeEventBus`                                                                                                | replay ring, sequence state, per-subscriber bounded queues, and one app-scoped one-permit `Semaphore` publication lane                                                                                                                                                      | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | app runtime shutdown/restart                                                                                                       | yes                    | shutdown closes subscribers with typed shutdown/rebaseline, not success                                                                                       | event published, subscription attached/closed, slow-consumer and shutdown tests            |
| Surface stream cursor lane                    | `@svvy/runtime` `RuntimeSurfaceEventPublisher`                                                                                   | target-local stream cursor map keyed by durable `surfacePiSessionId` with active `streamGenerationId`, latest `streamSequence`, and one runtime-owned one-permit `Semaphore` lane for cursor mutation                                                                       | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | app runtime shutdown/restart                                                                                                       | yes within runtime     | automatic permit release on publication success, failure, interruption, or shutdown; durable transcript/read-model state remains authoritative                | stream sequence, reset, failure propagation, and permit-release tests                      |
| Workspace runtime scope service               | `@svvy/runtime` package-private `RuntimeWorkspaceScopeService` / `layerRuntimeWorkspaceScopeService`                             | `Ref`-backed live owner membership map keyed by durable `workspaceId`; durable workspace rows remain in `@svvy/state`                                                                                                                                                       | `layer-acquired` service tracking `keyedOwnerScoped` workspace ownership | `Runtime.layer` acquisition; `workspaces.acquire(...)` records committed owners after state-port success                                                                 | `workspaces.release(...)`, owner release, invalidation, idle TTL, app shutdown remove live membership                              | yes within app runtime | interruption drops only live membership; durable workspace state and recovery facts remain authoritative                                                      | workspace owner acquire/release/snapshot tests; no public root/bootstrap export tests      |
| Surface runtime scope service                 | `@svvy/runtime` surface scope service                                                                                            | runtime-owned keyed child scope                                                                                                                                                                                                                                             | `keyedOwnerScoped`                                                       | `surfaces.open(...)`, turn delivery, wait/command retention                                                                                                              | release, invalidation, idle TTL, app shutdown                                                                                      | yes                    | finalizers interrupt pi streams, waits, command sessions; state recovery owns restart                                                                         | surface acquired/released/finalized receipts                                               |
| Workflow task-attempt runtime                 | `@svvy/runtime` workflow task bridge                                                                                             | runtime-owned keyed child scope                                                                                                                                                                                                                                             | `keyedOwnerScoped`                                                       | authenticated `runTaskAgent` bridge acceptance                                                                                                                           | terminal attempt, invalidation, idle TTL, app shutdown                                                                             | yes for attempt        | interruption records task-attempt recovery/terminal facts when required                                                                                       | task attempt acquired/terminalized/finalized receipts                                      |
| Prompt lock                                   | `@svvy/runtime` surface turn manager                                                                                             | `Semaphore` or equivalent scoped lock                                                                                                                                                                                                                                       | `keyedOwnerScoped`                                                       | `SurfaceRuntime.layer(...)`                                                                                                                                              | surface scope close                                                                                                                | yes                    | interruption releases once; durable active-turn recovery decides next work                                                                                    | prompt lock acquired/released and no double-release tests                                  |
| Active turn fiber                             | `@svvy/runtime` active turn manager                                                                                              | package-private active-turn registry built from manifest-adopted primitives; `FiberMap` requires promotion before use                                                                                                                                                       | `operationScoped`                                                        | durable turn claim after prompt lock                                                                                                                                     | terminal settlement, cancel, timeout, interruption                                                                                 | no                     | interruption terminalizes or records recovery and releases prompt lock exactly once                                                                           | turn dispatched/terminalized, busy/requeue tests                                           |
| Queue dispatcher and wakeup queue             | `@svvy/runtime` surface queue dispatcher service                                                                                 | bounded queue plus scoped fiber                                                                                                                                                                                                                                             | `keyedOwnerScoped`                                                       | workspace/runtime scope acquisition                                                                                                                                      | workspace/app scope close                                                                                                          | yes                    | per-row failures persist retry/failed facts; dispatcher failure follows runtime service policy                                                                | queue row claimed, retry, terminal, drain receipts                                         |
| Recovery coordinator                          | `@svvy/runtime` workspace/app recovery worker                                                                                    | scoped fiber and durable leases                                                                                                                                                                                                                                             | `layer-acquired` / `keyedOwnerScoped`                                    | runtime/workspace acquisition                                                                                                                                            | workspace/app scope close                                                                                                          | yes                    | active claims settle or expire by durable lease; no process-local truth                                                                                       | recovery sweep completed receipts                                                          |
| Title worker                                  | `@svvy/runtime` title service                                                                                                    | scoped fiber plus helper pi operation                                                                                                                                                                                                                                       | `keyedOwnerScoped`                                                       | workspace runtime scope acquisition                                                                                                                                      | workspace/app scope close                                                                                                          | yes                    | active helper interruption records retry/recovery when needed                                                                                                 | title claimed/terminalized receipts                                                        |
| Approval wait registry                        | `@svvy/runtime` `RuntimeApprovalWaitService`                                                                                     | `Ref` map keyed by durable approval request id; each live wait owns one single-use `Deferred<RuntimeApprovalDecision>`                                                                                                                                                      | `layer-acquired`                                                         | `Runtime.layer` acquisition; app/bootstrap only provides the composed layer and never constructs the registry                                                            | explicit approval shutdown cancellation; layer finalizer as cleanup backstop                                                       | yes within runtime     | interruption removes only the process-local waiter; durable approval, command, and session-wait rows stay authoritative                                       | duplicate wait, interruption cleanup, cancel-all shutdown tests                            |
| Request-input wait registry                   | `@svvy/runtime` `RuntimeRequestInputWaitService`                                                                                 | process-local registry keyed by durable wait id with surface ids stored on entries                                                                                                                                                                                          | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | explicit surface cancellation, workspace/app shutdown, and layer finalizer cleanup                                                 | yes within runtime     | interruption releases only matching process-local waiters; durable wait/recovery rows remain authoritative                                                    | registry acquired once, per-surface cancellation, no durable-truth tests                   |
| Request-input wait entry                      | `@svvy/runtime` request-input service                                                                                            | scoped single-use `Deferred` plus durable wait row reference                                                                                                                                                                                                                | `operationScoped`                                                        | `request_input.create` after durable wait/request facts commit                                                                                                           | answer, timeout, cancel, turn interruption, recovery terminalization, surface/workspace close                                      | no                     | interruption keeps durable wait/recovery rows authoritative and resolves/fails the scoped deferred once                                                       | wait created/resolved/timeout/interrupted receipts                                         |
| App-log commit notification service           | `@svvy/runtime` `RuntimeAppLogCommitNotification`                                                                                | package-private app-global/workspace scope mapper over the runtime event bus                                                                                                                                                                                                | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | app runtime shutdown/restart                                                                                                       | yes within runtime     | publication emits the runtime-owned `appLogs` descriptor or fails through the adapter's observable diagnostics path                                           | scope mapping and renderer refetch integration tests                                       |
| Accepted native-tool execution service        | `@svvy/runtime` accepted tool execution service                                                                                  | package-private service over runtime command/effect dependencies                                                                                                                                                                                                            | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | app runtime shutdown/restart                                                                                                       | yes within runtime     | shutdown rejects new accepted-tool work and drains/settles admitted command lanes                                                                             | service available through root layer, no public facade/export/import tests                 |
| Accepted native-tool execution lane           | `@svvy/runtime` accepted tool execution service                                                                                  | command-scoped Effect operation plus ordered operation queue/command context                                                                                                                                                                                                | `operationScoped`                                                        | package-private accepted tool execution service handles `pi.tool_call.accepted` after creating or reusing the durable command row                                        | model-facing tool result, waiting state, failure, cancellation, or recovery fact committed                                         | no                     | interruption terminalizes or records recovery before returning a pi tool result/error                                                                         | ordered operation application, command fact before pi acknowledgement                      |
| RuntimeLaunchPolicyService                    | `@svvy/runtime` launch-policy adapter service                                                                                    | package-private adapter over `@svvy/sandbox` `Sandbox.buildLaunchPolicy(...)` that maps sandbox policy failures into runtime contract failures while preserving scoped `SandboxLaunchFacts` acquisition requirements                                                        | `layer-acquired`                                                         | runtime command/session execution layer composition and `RuntimeAcceptedNativeToolExecution.acquireDirectToolLaunch(...)` when sandbox-backed command lanes are admitted | app runtime shutdown/restart                                                                                                       | yes within runtime     | interruption follows the scoped `Sandbox.buildLaunchPolicy(...)` effect; returned launch facts remain operation-scoped to the owning command session          | forwarding/error-mapping service tests; no public root/bootstrap export tests              |
| RuntimeExecutionPlanExecutor                  | `@svvy/runtime` accepted tool execution service                                                                                  | package-private interpreter service over immutable `ExtensionExecutionPlan` values; the base `Runtime.layer` executor fail-closes every plan type that does not have a spec-defined concrete runtime-owned lane with typed `unsupported-operation`                          | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | app runtime shutdown/restart                                                                                                       | yes within runtime     | shutdown has no admitted plan lane to drain for unsupported plan types                                                                                        | executor available only inside runtime accepted-tool paths; unsupported-operation behavior |
| RuntimeExecutionPlanExecutor execution lane   | `@svvy/runtime` accepted tool execution service                                                                                  | command-scoped validation/delegation point for immutable `ExtensionExecutionPlan` values; concrete child-process and apply-patch lanes require spec-defined runtime-owned host-ported execution lanes                                                                       | `operationScoped`                                                        | accepted native-tool operation list contains an `execution_plan` item after the durable command envelope exists                                                          | typed unsupported-operation failure through the owning command path when no concrete lane is specified                             | no                     | interruption follows the concrete lane when specified; unsupported plan kinds have no subprocess/file lane to drain                                           | execution-plan delegation, context validation, unsupported-operation tests                 |
| Artifact file materialization lane            | `@svvy/runtime` artifact materialization service                                                                                 | file-backed staged bytes, final artifact bytes, digest/byte-size observation, and recovery work facts                                                                                                                                                                       | `operationScoped`                                                        | accepted artifact command, retained command-output artifact creation, `execute_typescript` diagnostic/log capture, or artifact recovery claim                            | terminal artifact metadata commit, delete completion, recovery completion, cancellation, or app/workspace scope close              | no                     | interruption removes staged bytes when possible and records `artifact_materialization` recovery for promoted or delete-pending bytes that need reconciliation | staged-write cleanup, digest verification, delete retry, recovery receipt tests            |
| RuntimeSourceInvalidationScanPort             | `@svvy/runtime` coordinator selection adapter                                                                                    | public bootstrap composition tag that lets runtime-owned source invalidation services request app-global or workspace source scans inside the single app runtime; it is not a filesystem scanner, watcher table, state writer, or app/bootstrap routing callback            | `layer-acquired`                                                         | `Runtime.layer` acquisition through app/bootstrap binding around primitive scan handles                                                                                  | app runtime shutdown/restart                                                                                                       | yes                    | scan failures map to typed `RuntimeContractError`; successful scans return source evidence only                                                               | public `sourceInvalidation.hint/reconcile` scans and reaction tests                        |
| Runtime startup readiness barrier             | `@svvy/runtime/bootstrap` `RuntimeStartupReadiness` / `layerRuntimeStartupReadiness`                                             | bootstrap composition service plus timeout gate over app-scope startup phases                                                                                                                                                                                               | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | app runtime shutdown/restart                                                                                                       | yes                    | readiness timeout fails before facades are exposed; degraded-ready returns typed receipt                                                                      | bootstrap waits for readiness, timeout, failure, degraded receipt tests                    |
| Runtime shutdown preparation service          | `@svvy/runtime/bootstrap` `RuntimeShutdownPreparation` / `layerRuntimeShutdownPreparation`                                       | bootstrap composition service over runtime-owned turn, command, queue, wait, and recovery lanes                                                                                                                                                                             | `layer-acquired`                                                         | `Runtime.layer` acquisition                                                                                                                                              | app runtime shutdown/restart                                                                                                       | yes                    | shutdown rejects new work, drains bounded work, then records forced interruption/recovery facts where required                                                | shutdown drain/forced receipt and no-new-work tests                                        |
| App/workspace source coordinators             | `@svvy/runtime` `RuntimeSourceInvalidationCoordinator` instances                                                                 | watcher close handles, debounce timer state, pending scan state, periodic scan fiber, and retry state                                                                                                                                                                       | `layer-acquired` / `keyedOwnerScoped`                                    | app runtime acquisition for app-global sources; runtime-owned keyed workspace child-scope acquisition for workspace sources                                              | scope close                                                                                                                        | yes                    | watcher failures become diagnostics/recovery after retry exhaustion                                                                                           | source reconcile and recovery receipts                                                     |
| Generated-package refresh worker              | `@svvy/runtime` generated package worker                                                                                         | scoped fiber plus command/recovery rows                                                                                                                                                                                                                                     | `layer-acquired`                                                         | `Runtime.layer` acquisition; source invalidation, explicit build, and recovery rows wake/claim work inside that worker                                                   | app/workspace scope close                                                                                                          | yes                    | keeps prior ready output on build failure; scope close interrupts active build and records recovery where needed                                              | generated package refresh completed receipts                                               |
| Workspace link-repair worker                  | `@svvy/runtime` workspace generated-link repair                                                                                  | scoped fiber plus workspace link plan                                                                                                                                                                                                                                       | `keyedOwnerScoped`                                                       | workspace acquisition, app-global generated-package facts commit, or generated-package link-repair recovery wake                                                         | workspace/app scope close                                                                                                          | yes                    | unopened workspaces receive recovery rows; acquired workspaces retry through recovery                                                                         | link repair completed/recovery receipts                                                    |
| Command sessions/subprocess handles           | `@svvy/runtime` command/session service                                                                                          | pipe-backed child process handles, bounded stdin queue, stdout/stderr pump fibers, terminal observer fiber, output batcher state                                                                                                                                            | `operationScoped`                                                        | accepted command plan launch                                                                                                                                             | process exit after output flush, cancel/timeout after stdin close and process stop/kill, app shutdown after terminal/recovery fact | no                     | stdin closes deterministically; output terminal facts/recovery remain durable                                                                                 | command terminalized, output ordering, closed-stdin receipts                               |
| Workflow task-agent bridge operation registry | app/bootstrap loopback transport plus `RuntimeWorkflowTaskAgentBridgeService` and `RuntimeWorkflowTaskAgentBridgeBearerVerifier` | bootstrap-owned `POST /runTaskAgent` binding plus runtime-owned bearer-lineage verifier and authenticated operation service, idempotency keying, queue admission, task-attempt surface lifecycle, generated-context binding, command facts, and pi-adapter delivery handoff | `appBootstrapScoped` + `layer-acquired`                                  | app bootstrap creates command-scoped transport and provides the verifier; `Runtime.layer` creates the package-private bridge service                                     | app shutdown/restart                                                                                                               | yes                    | restart invalidates tokens; forged bearer lineage is rejected before durable writes; in-flight attempts settle/recover through state                          | bridge accepted/rejected/finalized receipts                                                |
| Facade event subscriptions                    | runtime facade adapter                                                                                                           | scoped stream subscription                                                                                                                                                                                                                                                  | `bridgeSubscriptionScoped`                                               | `events(...)` facade call                                                                                                                                                | unsubscribe, iterator return/throw, runtime close                                                                                  | no                     | captured `Exit` closes subscription; gaps require rebaseline                                                                                                  | subscription attached/closed tests                                                         |
| Bridge `AsyncIterable` scopes                 | browser/headless bridge adapter                                                                                                  | adapter fiber over runtime stream                                                                                                                                                                                                                                           | `bridgeSubscriptionScoped`                                               | browser/headless subscription call                                                                                                                                       | caller abort/return, runtime close                                                                                                 | no                     | captured `Exit` closes iterator; stale cursors rejected                                                                                                       | iterator close, abort, rebaseline tests                                                    |

Finalizers run sequentially by default so terminal/recovery facts, output flushes, queue release
receipts, and subscription close receipts have deterministic ordering. A package may use parallel
finalization only for named sibling resources that have no ordering dependency and whose tests prove
their receipts are independent, such as closing two watcher handles after their shared scan fiber
has already stopped. Command sessions close stdin, stop/kill the process as required, flush
stdout/stderr batches, record terminal/recovery facts, and release process handles in that order.

Workspace and surface runtime scope maps use package-private keyed owner services for acquisition,
invalidation, idle disposal, and app shutdown finalization. Runtime acquires live surface entries
through the workspace-owned surface lifecycle service when the intended lifetime is the live
surface; it must not acquire a surface scope only inside a one-shot facade method scope for that
case. A workspace-owned surface lifecycle service owns the retained surface borrow and scope.
One-shot operations borrow the already-acquired surface through an internal `withSurface(...)`
helper; releasing that operation borrow must not dispose a surface still retained by runtime policy,
active turn state, waits, command sessions, workflow task-attempt state, or open UI/headless
consumers.

Package-private keyed runtime scope managers are config-driven. They resolve TTL fields from
`RuntimeLayerConfigService` during layer acquisition and do not hard-code idle values. The target
contract is a runtime-owned keyed scope manager, not a public registry, cache, or separate
`ManagedRuntime`.

Exact keyed-scope domains:

| Scope manager                        | Key type                                                                            | Owner service acquired in the keyed scope                                                                                                                                                           | Retained by                                                                                                                                                    | Idle TTL config field                 |
| ------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `WorkspaceRuntimeScopeMap`           | `WorkspaceId`                                                                       | `RuntimeWorkspaceScopeService`, provided by package-private `layerRuntimeWorkspaceScopeService`, with workspace source coordinator, queue dispatcher, recovery lanes, title worker, and link repair | open workspace owner refs, active/open surface scopes under that workspace, active workspace-scoped recovery/link-repair/title work, and explicit borrows      | `workspaceRuntimeIdleTtlMs`           |
| `SurfaceRuntimeScopeMap`             | `SurfacePiSessionId`                                                                | `RuntimeSurfaceRuntimeService` with live pi session access, prompt locks, request-input wait registry, and command registry                                                                         | open UI/headless/browser-tool consumers, active turn work, blocking waits, command sessions, workflow task-attempt work, queue dispatcher borrows, and borrows | `surfaceRuntimeIdleTtlMs`             |
| `WorkflowTaskAttemptRuntimeScopeMap` | `WorkflowTaskAttemptId` plus owning `WorkspaceSessionId` and source command lineage | `WorkflowTaskAttemptRuntimeScopeService` with task-agent bridge attempt state and command-scoped lineage                                                                                            | accepted task-agent bridge call, in-flight handler-thread creation, attempt recovery/terminalization, and explicit borrows                                     | `workflowTaskAttemptRuntimeIdleTtlMs` |

`RuntimeSurfaceRuntimeService` is package-private. The minimal surface runtime service shape is:

```ts
type RuntimeSurfacePromptInterruptReason =
  | "user-abort"
  | "surface-close"
  | "runtime-shutdown"
  | "recovery-cancel";

type RuntimeSurfaceRuntimeService = {
  readonly surfacePiSessionId: SurfacePiSessionId;

  withPromptLock<A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | RuntimeContractError, R>;

  runPiTurn(input: RunPiTurnInput): Effect.Effect<PiAdapterTurnStream, RuntimeContractError>;

  interruptPrompt(input: {
    turnId: TurnId;
    reason: RuntimeSurfacePromptInterruptReason;
  }): Effect.Effect<void, RuntimeContractError>;
};
```

The service does not expose pi-native session objects, prompt text, generated-context previews,
queue rows, command rows, or renderer state. `runPiTurn(...)` is the scoped runtime-owned call into
`PiAdapter.turns.run(...)` for the already acquired surface session. The package-private surface
scope implementation owns the live pi session handle, active prompt fiber, wait registries, command
session registry, and finalizers behind this shape; DB/product-state-backed references and facts
remain behind core-owned state ports.

Runtime resolves durable identity before acquiring a keyed scope. Public workspace methods that
receive or create a `WorkspaceId` first commit or read durable workspace/session facts through state
ports, then acquire by the resulting `WorkspaceSessionId`. Surface methods acquire by the durable
`SurfacePiSessionId` recorded for that surface. Workflow task-agent bridge calls acquire by the
durable task-attempt id returned by state plus the owning workspace/session lineage; a task attempt
cannot be keyed by the bridge token, HTTP request id, renderer surface id, or Smithers
runtime-local id.

The package-private manager interface is exact:

```ts
type RuntimeScopeOwner =
  | { kind: "workspace-owner"; ownerId: string; workspaceSessionId: WorkspaceSessionId }
  | { kind: "surface-owner"; ownerId: string; surfacePiSessionId: SurfacePiSessionId }
  | { kind: "desktop-window"; ownerId: string }
  | { kind: "browser-tool"; ownerId: string }
  | { kind: "headless-client"; ownerId: string }
  | { kind: "turn"; ownerId: TurnId }
  | { kind: "command"; ownerId: CommandId }
  | { kind: "request-input-wait"; ownerId: RequestInputRequestId }
  | { kind: "workflow-task-attempt"; ownerId: WorkflowTaskAttemptId }
  | { kind: "runtime-worker"; ownerId: string };

type RuntimeScopeLease<Service> = {
  key: string;
  owner: RuntimeScopeOwner;
  service: Service;
  release: Effect.Effect<RuntimeScopeReleaseReceipt, RuntimeContractError>;
};

type RuntimeScopeReleaseReceipt = {
  key: string;
  owner: RuntimeScopeOwner;
  released: boolean;
  retainedOwnerCount: number;
  activeBorrowCount: number;
  disposal: "not-eligible" | "idle-timer-scheduled" | "closed";
};

type RuntimeScopeInvalidationReceipt = {
  key: string;
  accepted: boolean;
  activeOwnerCount: number;
  activeBorrowCount: number;
  closeState: "closing" | "closed";
};

type KeyedRuntimeScopeMap<Key, Service> = {
  acquire(
    key: Key,
    owner: RuntimeScopeOwner,
  ): Effect.Effect<RuntimeScopeLease<Service>, RuntimeContractError>;
  withBorrow<A, E, R>(
    key: Key,
    owner: RuntimeScopeOwner,
    effect: Effect.Effect<A, E, R | Service>,
  ): Effect.Effect<A, E | RuntimeContractError, R>;
  release(
    key: Key,
    owner: RuntimeScopeOwner,
  ): Effect.Effect<RuntimeScopeReleaseReceipt, RuntimeContractError>;
  invalidate(key: Key): Effect.Effect<RuntimeScopeInvalidationReceipt, RuntimeContractError>;
};
```

`ownerId` is stable within one app runtime graph and is not persisted as durable recovery evidence.
Durable state stores workspace/surface/task lifecycle facts; the keyed scope manager stores only
process-local owner refs and active borrow counts. Acquiring the same key with the same owner is
idempotent and returns a lease over the existing keyed service. Acquiring the same key with a
different owner adds one retained owner ref. `release(...)` for an unknown owner is idempotent and
returns a receipt with `released: false`; it must not close the keyed scope. `withBorrow(...)` does
not create a retained owner ref; it increments the active borrow count for the caller's operation
scope and releases that borrow when the operation exits.

Idle TTL begins only after `retainedOwnerCount === 0`, `activeBorrowCount === 0`, and no
domain-specific retained work remains for that keyed scope. Reacquiring the key before the TTL fires
cancels the pending idle disposal. Open surface scopes suppress workspace idle close; active command
sessions, blocking waits, turn fibers, workflow task attempts, and bridge subscriptions suppress
surface idle close until their domain terminalization path records or observes terminal/recovery
facts. TTL disposal is process-local cleanup and does not by itself write product lifecycle rows.
When disposal requires visible cancellation, recovery, or terminal facts, the owning domain service
must commit those facts before the keyed scope finalizer runs.

`Runtime.layer` owns the map services and wires package-private
`layerRuntimeWorkspaceScopeService` into `WorkspaceRuntimeScopeMap` acquisition.
`RuntimeWorkspaceScopeService`, `WorkspaceRuntimeScopeMap`, `SurfaceRuntimeScopeMap`, and
`WorkflowTaskAttemptRuntimeScopeMap` are keyed runtime internals, not app-visible registries,
caches, facades, or public package APIs.
Borrowing a keyed scope retains that keyed resource in the caller's current Effect scope. Callers
run borrowed work inside the smallest semantic scope that matches the operation; closing the caller
scope releases only that borrow. The keyed resource remains live until the final retained owner and
borrow are released and its idle TTL, explicit invalidation, owner shutdown, or app runtime disposal
closes it. Workspace acquisition retains workspace runtime entries until the workspace is released,
invalidated, idle for the TTL, or the app runtime scope closes. Workspace-owned surface lifecycle
retains surface runtime entries while a surface is active, waiting, streaming, command-running,
attached to UI/headless consumers, or otherwise retained by runtime policy; release, invalidation,
idle TTL, or app shutdown are the only disposal paths. Workflow task-agent bridge acceptance retains
workflow task-attempt entries until the attempt reaches terminal state, is invalidated by recovery,
idles past the TTL, or app shutdown closes the scope. Runtime tests use local Effect harnesses,
`TestClock`, and scoped finalizer assertions for acquisitions, releases, invalidations, and scope
finalizers; they must not rely on sleeping past TTLs or a public runtime test-fixture export.

Workspace and surface owner services retain long-lived borrows by creating explicit closeable
scopes. The acquire path creates a sequential `Scope.Scope`, acquires the keyed runtime scope inside
that owner scope, and stores a package-private owner handle containing only the durable key plus
close action. The matching release path closes that same scope with
`Scope.close(scope, Exit.void)` after durable state says the workspace/surface/attempt has zero live
owners. Runtime does not store or
expose `ManagedRuntime`, public facades, app registry records, renderer pane ids, or raw Effect
contexts as product state. `RcMap`, `ScopedCache`, `ScopedRef`, `FiberMap`, and `FiberSet` are
conditional implementation candidates only. Runtime may use them for keyed scoped values or worker
supervision only after the exact module/member imports are promoted in
`packages/effect-adoption-manifest.ts` with owning tests. Until then, package-private keyed scope
services must be implemented with already adopted primitives.

Normal close ordering is parent-to-child for admission and child-to-parent for finalizers. Workspace
release first rejects or reroutes new workspace-scoped public work, then closes or terminalizes child
surface, workflow task-attempt, queue, title, source, and link-repair work through their domain
services, then releases the workspace owner ref. Surface close first rejects new surface-scoped
turns and queue claims, then terminalizes or records recovery for active turn fibers, accepted-tool
fibers, request-input waits, command sessions, and pi stream subscriptions, then closes the scoped pi
session handle through `@svvy/pi-adapter`, then releases the surface owner ref. Workflow task-attempt
close first rejects bridge calls for that attempt, then records terminal/recovery facts for
in-flight handler-thread creation or task-agent response delivery, then releases the attempt owner
ref. App shutdown closes public facade admission, runs runtime shutdown preparation, waits for
bounded drain, records forced recovery/cancellation facts where required, invalidates all keyed
scope maps, then disposes the app-owned `ManagedRuntime`.

Startup recovery reads durable workspace, surface, queue, command, request-input, and workflow
task-attempt facts before acquiring child scopes for live work. Open workspace/surface facts acquire
their keyed scopes during startup readiness. Unopened workspaces with recoverable generated-link or
command facts receive recovery rows or app-log diagnostics without acquiring a workspace runtime
scope unless the recovery lane explicitly needs workspace-scoped services. Orphaned process-local
owner refs do not survive restart and are never interpreted as durable evidence.

Readiness-sensitive workspace, surface, and workflow task-attempt acquisition uses the keyed scope
map's `acquire(...)` path in the owning scope with the map service already provided. One-shot
borrows may be used only to provide a keyed resource to an already-scoped operation; they are not the
readiness signal for `AcquireWorkspaceResult.readiness`, `OpenSurfaceResult`, worker attachment,
generated-context binding, or workflow task-agent bridge acceptance.

`AcquireSurfaceRuntimeInput` uses `SurfacePiSessionId` and a `RuntimeScopeOwner` whose kind is one
of `surface-owner`, `desktop-window`, `browser-tool`, `headless-client`, `turn`, `command`,
`request-input-wait`, or `workflow-task-attempt`. During tab retarget, runtime acquires the new
owner before releasing the prior owner so there is no disposal gap. Invalidation marks the entry
closing, rejects new owners, waits for current borrows to leave or terminalizes them by runtime
policy, then closes the keyed scope. Tests cover duplicate acquire, double release, owner
replacement, borrow during invalidation, TTL cancellation by reacquire, shutdown close ordering, and
finalizer ordering.

Keyed-scope invalidation is not treated as revocation of active work by itself. Active borrowed
contexts keep running until their scoped operation exits, is interrupted by an explicit runtime
policy decision, or records a terminal/recovery fact. Invalidation first marks the runtime entry
closing in package-private registry state so no new owners/borrows are accepted; then runtime either
lets active turns, waits, command sessions, subscriptions, and workflow task attempts drain, or
interrupts them through the domain-specific terminalization/recovery path named in this spec. Only
after those domain receipts exist may the keyed scope close and finalizers run.

Runtime keeps in-memory state only for active coordination. Durable state remains in
`@svvy/state`.
Pending user messages are durable queue rows in `@svvy/state`. Runtime owns claiming, delivery,
retry, cancellation, and event publication for those rows.

Runtime state ownership matrix:

| Category                             | Backing                                                                                                                                                                         | Examples                                                                                                                                                                                                                                               | Owner rule                                                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable queue and turn state         | SQLite/product state                                                                                                                                                            | queue rows, queue claim owner/lease, turn rows, delivered/failed/cancelled facts, active-turn recovery rows                                                                                                                                            | `@svvy/state` stores; `@svvy/runtime` mutates only through state ports and publishes after-commit notifications                                                                                                                               |
| Durable command state                | SQLite/product state plus runtime-owned file-backed artifact bytes                                                                                                              | command rows, command events, argument snapshots, stdout/stderr/output facts, child-command links, terminal facts, artifact metadata and stored-path/byte-size/digest facts                                                                            | runtime command/session services materialize artifact bytes through runtime artifact file-effect services, write metadata through state/artifact ports, and publish after-commit notifications; extension handlers produce results/plans only |
| Durable request/input/wait state     | SQLite/product state                                                                                                                                                            | request-input requests, questions, options, answers, blocking wait timeout facts, nonblocking answer delivery queue rows                                                                                                                               | runtime request-input services own waits and answer delivery; state stores facts                                                                                                                                                              |
| Durable source/generated facts       | SQLite/product state plus file-backed source inputs; generated output is `@svvy/extensions`-owned build output indexed by state facts, not a watcher trigger or source of truth | source fingerprints, source versions, diagnostics, generated-context bindings, generated package manifests, workspace-link facts                                                                                                                       | source-owning packages mutate files, state stores fingerprints/manifests/link facts, and runtime schedules invalidation and refresh work                                                                                                      |
| Durable recovery/title/app-log state | SQLite/product state                                                                                                                                                            | recovery work rows, title job rows, app log rows, normalized error rows                                                                                                                                                                                | runtime/state workers claim and settle through state ports                                                                                                                                                                                    |
| Process-local runtime coordination   | Effect runtime memory                                                                                                                                                           | prompt locks, active turn fibers, command-session handles, pi handles, wait registries, queue wakeup channels, explicit runtime event replay rings, subscriber queues, source watcher handles, debounce queues, readiness latches, keyed scope borrows | runtime owns in scoped services; state is re-read after restart and no process-local value is treated as durable evidence                                                                                                                     |
| UI-only view state                   | renderer memory                                                                                                                                                                 | focus, scroll, open menus, warm read-model caches, pane layout drag state, optimistic draft UI                                                                                                                                                         | desktop owns; it never replaces state read models or runtime events                                                                                                                                                                           |

If a value must survive app restart, rebaseline another process, appear in command inspectors, or
participate in recovery, it is DB/product-state-backed or file-backed source evidence. If it only
orders live work, wakes a worker, fans out recent notifications, cancels a running handle, or
coordinates one scoped session, it is Effect process-local state.

Runtime live-state primitives are chosen per lane:

| Runtime lane                                                                                                                                                                     | Effect primitive                                                                                                                 | Why                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Low-cardinality process-local status snapshots, such as surface runtime scope status, command-session status, source-coordinator status, and workflow bridge subscription status | manifest-adopted `Ref` plus explicit stream/queue projection when needed; `SubscriptionRef` requires promotion                   | exposes process-local status to runtime services without turning it into durable event history |
| Prompt locks, wait registries, queue wakeup state, tool-call-to-command maps, last emitted argument snapshot maps, and cancellation bookkeeping                                  | manifest-adopted `Ref`, `Semaphore`, `Deferred`, or `Queue` as appropriate; `SynchronizedRef` requires promotion                 | coordinates live work without snapshot/change-stream semantics                                 |
| Runtime event fanout and live surface stream patches                                                                                                                             | replay ring plus manifest-adopted `Queue` / `Stream` owned by the event service                                                  | notifications and live patches only; durable recovery uses state                               |
| Replaceable watcher, scan, turn, or helper lanes                                                                                                                                 | package-private services built from adopted primitives; `FiberHandle`, `FiberMap`, `FiberSet`, and `ScopedRef` require promotion | ensures replacement interrupts/closes the prior scoped resource                                |

Do not introduce another mutable live-state abstraction for these lanes. Lanes that need both
snapshot reads and a change stream use a manifest-adopted projection. `effect/SubscriptionRef` is
unavailable in production unless the Effect manifest, package-boundary policy, owning spec, and
focused tests adopt it for low-frequency, low-cardinality process-local status. It must not be used
for runtime events, `surface.stream` patches, command output, queue wakeups, app logs, or any
high-rate lane. Each `SubscriptionRef` owner names its scope, expected update cardinality/frequency,
and subscriber close path in the owning package spec or service contract.

Runtime startup side effects begin only when app/bootstrap acquires `Runtime.layer` through the
app-owned `ManagedRuntime`. Constructing a `Layer` value or importing a module does not start
watchers, workers, source scans, or event hubs. `managedRuntime.context()` proves the layer graph
was acquired; it is not by itself semantic startup readiness. App/bootstrap then calls
`awaitRuntimeStartupReadiness(managedRuntime)` before constructing or exposing facades. That helper
waits until app-scoped startup checks, initial app source reconciliation, required recovery scans,
and generated-package startup reconciliation have either completed, committed allowed degraded
diagnostic/recovery facts, or failed startup. The runtime-owned readiness service must bound this wait by
`RuntimeLayerConfig.runtimeStartupReadinessTimeoutMs`; timeout fails startup with a typed runtime
startup error and app/bootstrap disposes the acquired `ManagedRuntime` before retrying.

Runtime startup effects are split by ownership scope:

- `Runtime.layer` acquisition starts only app-scoped services: the package-private runtime event bus
  that backs public `Runtime.events(...)`, app-runtime sequence state, workspace/surface keyed scope
  services, app-global recovery lanes, and the app-global source coordinator.
- The app-global source coordinator watches only Workflows and Extensions source roots, treats
  watcher events as hints, runs deterministic fingerprint scans, schedules app-global generated
  package refresh for startup/source/manual/recovery reasons, and fans out workspace-link repair to
  acquired workspace runtime scopes only after generated-package facts commit. App-global
  generated-package refresh never runs once per workspace runtime scope.
- Package-private workspace keyed scope acquisition uses `layerRuntimeWorkspaceScopeService` to
  provide `RuntimeWorkspaceScopeService`, which starts workspace-scoped queue dispatch services, one
  workspace source coordinator, generated-package workspace-link repair, workspace recovery lanes,
  and descriptor-derived notification handoff through the app-scoped `RuntimeEventBus` inside the
  single app-owned `ManagedRuntime`.
- Each workspace source coordinator watches only external instruction candidates and discovered
  read-only host snippet Markdown sources for that workspace. Generated package outputs, extension
  build output, and workspace `.smithers/node_modules/@svvyx/*` links are never watcher triggers.
  DB-backed settings, profile, and managed snippet writes return
  committed state results plus `afterCommit` descriptors; runtime publishes public notifications
  from those descriptors rather than from file watchers.
- Surface runtime scope acquisition starts only surface-scoped coordinators: prompt locks,
  queue/recovery subscriptions for that surface, and command-session registries. The
  runtime-acquired `RuntimeRequestInputWaitService` owns request-input timer/wait registry state and
  keys entries by durable surface/request ids; a surface scope cancels only its own live wait
  entries through that service during release. Surface acquisition does not start a turn fiber or
  subscribe to a pi turn stream until a durable queue claim and turn-row commit creates concrete
  turn work. Active turn fibers, pi stream subscriptions, accepted-tool fibers, lease-refresh
  fibers, and blocking request-input handoffs are operation-scoped children owned by the claimed
  turn/command/wait scope.
- Every long-lived loop started during layer acquisition forks with the currently adopted
  `Effect.forkIn(ownerScope)` form and returns promptly after recording any required readiness
  receipt. Package layers must not hide unscoped background promises, global timers, or
  process-lifetime watchers. `Effect.forkScoped` and `Effect.forkChild` require exact manifest
  promotion before production use.

Runtime layer cadence and buffer policy comes from one typed config snapshot:

```ts
type RuntimeLayerConfig = {
  queueWakeupCapacity: PositiveSafeInteger; // default 1024
  eventReplayCapacity: PositiveSafeInteger; // default 100
  eventSubscriberBufferCapacity: PositiveSafeInteger; // default 256
  sourceHintQueueCapacity: PositiveSafeInteger; // default 1024
  workspaceRuntimeIdleTtlMs: PositiveDurationMs; // default 600000
  surfaceRuntimeIdleTtlMs: PositiveDurationMs; // default 600000
  workflowTaskAttemptRuntimeIdleTtlMs: PositiveDurationMs; // default 600000
  runtimeStartupReadinessTimeoutMs: PositiveDurationMs; // default 30000
  runtimeStartupWorkspaceAdmissionCapacity: PositiveSafeInteger; // default 64
  workerRestartInitialDelayMs: PositiveDurationMs; // default 250
  workerRestartMaxDelayMs: PositiveDurationMs; // default 10000
  workerRestartMaxAttempts: NonNegativeSafeInteger; // default 5; 0 disables restart attempts
  queueRetryInitialDelayMs: PositiveDurationMs; // default 500
  queueRetryMaxDelayMs: PositiveDurationMs; // default 10000
  queueRetryMaxAttempts: NonNegativeSafeInteger; // default 3; 0 disables retry attempts
  queueClaimLeaseMs: PositiveDurationMs; // default 30000
  queueClaimLeaseRefreshIntervalMs: PositiveDurationMs; // default min(10000, floor(queueClaimLeaseMs / 3))
  requestInputAnswerDeliveryLeaseMs: PositiveDurationMs; // default 30000
  sourceDebounceMs: PositiveDurationMs; // default 250
  sourceMaxCoalescingLatencyMs: PositiveDurationMs; // default 2000
  appSourceReconcileIntervalMs: PositiveDurationMs; // default 60000
  workspaceSourceReconcileIntervalMs: PositiveDurationMs; // default 60000
  sourceRetryInitialDelayMs: PositiveDurationMs; // default 500
  sourceRetryMaxDelayMs: PositiveDurationMs; // default 10000
  sourceRetryMaxAttempts: NonNegativeSafeInteger; // default 5; 0 disables retry attempts
  recoveryRetryInitialDelayMs: PositiveDurationMs; // default 500
  recoveryRetryMaxDelayMs: PositiveDurationMs; // default 10000
  recoveryRetryMaxAttempts: NonNegativeSafeInteger; // default 5; 0 disables retry attempts
  recoveryScanIntervalMs: PositiveDurationMs; // default 10000
  recoveryClaimLeaseMs: PositiveDurationMs; // default 60000
  generatedPackageWorkspaceLinkRepairConcurrency: PositiveSafeInteger; // default 2
  generatedPackageBuildTimeoutMs: PositiveDurationMs; // default 120000
  generatedPackageLinkRepairTimeoutMs: PositiveDurationMs; // default 30000
  titleJobScanIntervalMs: PositiveDurationMs; // default 5000
  titleJobClaimLeaseMs: PositiveDurationMs; // default 30000
  requestInputTimeoutScanIntervalMs: PositiveDurationMs; // default 1000
  commandStdinQueueCapacity: PositiveSafeInteger; // default 64
  commandOutputBatchMaxChunks: PositiveSafeInteger; // default 32
  commandOutputBatchMaxLatencyMs: PositiveDurationMs; // default 50
  commandOutputBatchMaxBytes: ByteCount; // default 65536
  commandOutputArtifactThresholdBytes: ByteCount; // default 1048576
  commandGracefulShutdownMs: PositiveDurationMs; // default 5000
  commandForceKillGraceMs: PositiveDurationMs; // default 2000
  workflowTaskAgentBridgeRequestTimeoutMs: PositiveDurationMs; // default 300000
  workflowTaskAgentBridgeMaxRequestBytes: ByteCount; // default 1048576
  workflowTaskAgentBridgeMaxResponseBytes: ByteCount; // default 1048576
  runtimeShutdownDrainTimeoutMs: PositiveDurationMs; // default 5000
};
```

Runtime exposes bootstrap-only config schema and helpers from `@svvy/runtime/bootstrap`:

```ts
export type RuntimeLayerConfig = {
  // see the canonical field list above
};
export const RuntimeLayerConfigInputSchema: Schema.Codec<
  RuntimeLayerConfig,
  Partial<RuntimeLayerConfig>
>;
export const RuntimeLayerConfigSchema: Schema.Codec<RuntimeLayerConfig, RuntimeLayerConfig>;
export const RuntimeLayerConfigFromEnv: Config.Config<RuntimeLayerConfig>;
export const defaultRuntimeLayerConfig: RuntimeLayerConfig;
export class RuntimeLayerConfigService extends Context.Service<
  RuntimeLayerConfigService,
  RuntimeLayerConfig
>()("@svvy/runtime/RuntimeLayerConfigService") {}
// `RuntimeLayerRequirements` is intentionally omitted here. It is a package-private
// implementation-module alias in `runtime-layer.ts`, not a bootstrap export.
export class RuntimeLayerError extends Schema.TaggedErrorClass<RuntimeLayerError>()(
  "RuntimeLayerError",
  {
    operation: Schema.String,
    reason: Schema.Literals(["startup-not-ready", "shutdown-failed"]),
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export const RuntimeLayerErrorSchema = RuntimeLayerError;
export const decodeUnknownRuntimeLayerErrorEffect = Schema.decodeUnknownEffect(
  RuntimeLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeLayerErrorExit = Schema.decodeUnknownExit(
  RuntimeLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeRuntimeLayerErrorEffect = Schema.encodeEffect(
  RuntimeLayerErrorSchema,
  strictBoundaryParseOptions,
);
export const encodeRuntimeLayerErrorExit = Schema.encodeExit(
  RuntimeLayerErrorSchema,
  strictBoundaryParseOptions,
);

export const createRuntimeLayerConfigLayer: (
  config: RuntimeLayerConfig,
) => Layer.Layer<RuntimeLayerConfigService, never, never>;

export const RuntimeStartupPhase = Schema.Literals([
  "layer-acquisition",
  "app-source-reconcile",
  "generated-package-reconcile",
  "recovery-startup-scan",
  "event-bus",
]);
export type RuntimeStartupPhase = typeof RuntimeStartupPhase.Type;

export type RuntimeStartupDegradedPhase = {
  phase: RuntimeStartupPhase;
  diagnosticEventId?: string;
  recoveryWorkId?: RecoveryWorkId;
  disabledApiGroups: readonly string[];
  staleReadModels: readonly string[];
  message: string;
};

export type RuntimeStartupReadinessReceipt = {
  status: "ready" | "degraded-ready";
  readyAt: IsoDateTimeString;
  completedPhases: readonly RuntimeStartupPhase[];
  degradedPhases: readonly RuntimeStartupDegradedPhase[];
};

export class RuntimeStartupError extends Schema.TaggedErrorClass<RuntimeStartupError>()(
  "RuntimeStartupError",
  {
    operation: Schema.String,
    phase: RuntimeStartupPhase,
    reason: Schema.Literals([
      "config-invalid",
      "layer-acquisition-failed",
      "readiness-timeout",
      "required-startup-check-failed",
      "runtime-shutdown",
      "runtime-disposed",
    ]),
    message: Schema.String,
    diagnosticEventId: Schema.optionalKey(Schema.String),
    recoveryWorkId: Schema.optionalKey(RecoveryWorkId),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export const RuntimeStartupErrorSchema = RuntimeStartupError;
export const awaitRuntimeStartupReadiness: <R, E>(
  managedRuntime: ManagedRuntime.ManagedRuntime<R, E>,
) => Promise<RuntimeStartupReadinessReceipt>;
```

`awaitRuntimeStartupReadiness(...)` accepts the full app-owned `ManagedRuntime` as long as its
context contains the `Runtime` service. The generic `R` must include `Runtime`; app/bootstrap passes
the full app runtime context rather than narrowing or rebuilding a separate runtime. The helper
normalizes layer acquisition defects, runtime startup
failures, shutdown interruption, and disposed-runtime defects into `RuntimeStartupError` before
rejecting. The helper does not require the app layer to expose only `Runtime`; the canonical app
runtime also exposes state services, state facades, command facades, and the core-owned
`StateCommandPostCommitNotificationPort`.

The package root value exports only the explicit root symbol surface listed in the package API
section above. `layerConfig`, `layerWithConfig`, bootstrap config helpers, transport host helpers,
queue dispatch services, prompt runners, request appliers, and event-bus internals are not public
root exports.

`RuntimeLayerConfigSchema` validates every `*Ms` field with the shared
`FiniteDurationMsSchema` or `PositiveDurationMsSchema` according to whether zero is meaningful.
Capacity, byte-count, and retry-count fields use shared finite safe-integer schemas.
`RuntimeLayerConfigInputSchema` accepts optional encoded fields, applies decoding defaults from
`defaultRuntimeLayerConfig`, and decodes to a fully required `RuntimeLayerConfig`.
`RuntimeLayerConfigSchema` validates already-complete runtime config values.
`RuntimeLayerConfigFromEnv` is implemented with `Config.all(...)` over explicit
`SVVY_RUNTIME_*` env keys plus the same cross-field validation invariants as the schema. Defaults
fill only missing optional values; an explicitly configured invalid value fails startup through
`Config.ConfigError`.
`Clock.Clock` is an Effect runtime/test service, not an app-bootstrap host adapter. Production
layers use Effect's default clock, and Effect-lane tests override time through `@effect/vitest`
`TestClock`. Package root external production requirement aliases must not list `Clock.Clock`
unless the same spec names the bootstrap layer that provides it.

`RuntimeLayerConfigService` is a runtime-owned `Context.Service` carrying the decoded
`RuntimeLayerConfig` snapshot for one acquired runtime graph. App/bootstrap provides that service
once from bootstrap config/defaults before acquiring `Runtime.layer`; package services do not read
global env, renderer state, or durable product settings for cadence or buffer settings. Tests
override it through `createRuntimeLayerConfigLayer(...)`. Every runtime worker reads queue
capacity, event replay and subscriber buffer sizes, debounce, reconciliation, recovery,
generated-package recovery, title, request-input timeout cadence, queue/recovery/title/request-input
delivery claim lease durations, and bounded restart policy from this service. The config is a
scoped runtime snapshot: changing durable app settings does not mutate this service in place; the
owning runtime service must rebuild or explicitly reschedule affected workers. Workers do not poll
config state.

Runtime config is Schema-decoded before `Runtime.layer` acquisition. Capacities are positive safe
integers, durations are finite positive milliseconds, and max-attempt fields are non-negative safe
integers where `0` means the
initial attempt is made but no retry/restart attempts are scheduled after failure. Invalid config
fails startup before worker, watcher, queue, runtime event, or database-backed runtime services are
acquired.
Defaults are applied only for missing optional config values. Runtime config decoding must not use a
catch-all `Config.orElse` fallback that turns schema validation failures into defaults.

Every long-lived queue or fanout lane uses the decoded capacity from this config and names its
overflow behavior:

- queue wakeups use a bounded, non-authoritative hint queue plus a dirty-key set; dropped or
  coalesced wakeups are harmless because the worker rereads durable queue rows. `Queue.sliding`
  requires exact manifest promotion before production use.
- source invalidation hints use a bounded, non-authoritative hint queue plus dirty-domain tracking;
  dropped or coalesced hints are harmless because scans recompute deterministic fingerprints.
  `Queue.sliding` requires exact manifest promotion before production use.
- event fanout uses the runtime-owned replay ring plus one bounded runtime-event queue sized by
  `eventSubscriberBufferCapacity` per public subscription. Publication appends to the replay ring and
  then performs a nonblocking bounded offer only to subscribers whose filters match the event.
  Per-subscriber overflow closes that subscriber with a bridge/subscription close payload and normal
  stream completion. Overflow may not block state commits, queue claims, command settlement, or
  prompt turns after durable state has committed.
- command stdin uses a per-command `Queue.bounded(commandStdinQueueCapacity)` admission queue.
  `RuntimeLayerCommandStdinPort.writeStdin(...)` waits until the chunk is accepted, the caller is
  interrupted/cancelled, or the command session closes. Bounded capacity applies backpressure rather
  than dropping stdin text. The command stdin writer drains accepted chunks losslessly and in FIFO
  order. Runtime never drops accepted stdin text silently.
- command output is batched with `commandOutputBatchMaxChunks`,
  `commandOutputBatchMaxLatencyMs`, and `commandOutputBatchMaxBytes`. A batch flushes when any
  threshold is reached, when the process exits, before terminal command settlement, and before a
  command-session handle is released. Output above `commandOutputArtifactThresholdBytes` is retained
  through the state/artifact command-output path instead of duplicating unbounded text in live
  events or command result summaries.

Every runtime worker uses `Clock`/`Schedule` and test layers can override this config. Worker cadence
is:

Workflow task-agent bridge request and response limits also come from `RuntimeLayerConfig`. The
loopback transport rejects request bodies above `workflowTaskAgentBridgeMaxRequestBytes` before JSON
decode with bridge error code `payload_too_large`, and the generated client rejects decoded success
or error bodies above `workflowTaskAgentBridgeMaxResponseBytes` before returning to Smithers user
code. `SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS`, when injected, is the decoded
`workflowTaskAgentBridgeRequestTimeoutMs`; generated packages may read that env var only as a
positive integer timeout and must not invent their own default.
`SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES`, when injected, is the decoded
`workflowTaskAgentBridgeMaxResponseBytes`; generated packages use it as the default response body
cap unless Smithers passes a smaller or larger per-call `maxOutputBytes` option. The runtime-owned
bridge service still enforces the configured timeout on the app side so a malicious or stale
generated client cannot hold command-scoped bridge work open indefinitely.

Source scan/build retry uses typed retryability classification and `Schedule.exponential(...)`
capped by `sourceRetryInitialDelayMs`, `sourceRetryMaxDelayMs`, and `sourceRetryMaxAttempts`. After
exhaustion, runtime records a diagnostic/recovery row and keeps prior ready generated context or
generated package output when one exists.
Pre-accept queue delivery retry uses typed retryability classification and a bounded exponential
schedule capped by `queueRetryInitialDelayMs`, `queueRetryMaxDelayMs`, and
`queueRetryMaxAttempts`. Those values are written into durable queue attempt facts; Effect
`Schedule` computes candidate delays only and is never the source of persisted attempt count.
Recovery retry uses the same pattern with `recoveryRetryInitialDelayMs`,
`recoveryRetryMaxDelayMs`, and `recoveryRetryMaxAttempts`, persisted on recovery rows.

| Worker                           | First run                                                                   | Steady cadence                                                                                                                                                                            | Persisted facts touched                                                                                                     | Scope shutdown                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| App source coordinator           | immediate startup reconcile after `Runtime.layer` acquisition               | debounce watcher hints with `sourceDebounceMs`, force one scan by `sourceMaxCoalescingLatencyMs` under continuous hints; periodic sleep-loop scan by `appSourceReconcileIntervalMs`       | app-global source fingerprints, generated-package facts, diagnostics, app read-model invalidations                          | forked with `Effect.forkIn(appScope)`; closes watchers, debounce fibers, and scan fibers                     |
| Workspace source coordinator     | immediate reconcile after `WorkspaceRuntime.layer(workspaceId)` acquisition | debounce watcher hints with `sourceDebounceMs`, force one scan by `sourceMaxCoalescingLatencyMs` under continuous hints; periodic sleep-loop scan by `workspaceSourceReconcileIntervalMs` | workspace external-instruction and host-snippet fingerprints, diagnostics, workspace/app invalidations                      | workspace scope close interrupts watchers, debounce fibers, and scans                                        |
| Queue dispatcher                 | wakes after queue-row commits and during workspace startup recovery         | wakeup queue drain plus periodic recovery scan through a sleep loop by `recoveryScanIntervalMs`                                                                                           | queue claims, turn rows, delivery/failed/cancelled facts, recovery leases                                                   | workspace/surface scope close interrupts drain fibers; durable rows remain recoverable                       |
| Recovery coordinator             | immediate startup scan                                                      | sleep loop by `recoveryScanIntervalMs`                                                                                                                                                    | recovery work rows, command/turn/queue/request-input recovery facts                                                         | workspace/app scope close releases claims by lease expiry or terminal facts already committed                |
| Title job worker                 | immediate scan for pending title jobs                                       | sleep loop by `titleJobScanIntervalMs`                                                                                                                                                    | title job claim/terminal facts and session/thread title rows                                                                | workspace scope close interrupts active helper job and leaves durable retry state                            |
| Request-input timeout worker     | immediate scan for overdue blocking waits                                   | sleep loop by `requestInputTimeoutScanIntervalMs`                                                                                                                                         | request-input timeout facts, timeout-default answer facts, command waiting/terminal facts through `RuntimeCommandStatePort` | surface/workspace scope close interrupts only process-local waits; durable timeout rows remain authoritative |
| Generated-package refresh worker | wakes after source invalidation, explicit build, and recovery rows          | event-driven plus recovery scan through a sleep loop by `recoveryScanIntervalMs`                                                                                                          | generated-package build/link facts, diagnostics, app/workspace invalidations                                                | app/workspace scope close interrupts builds at safe boundaries and records recovery rows where needed        |
| Runtime event bus                | starts at `Runtime.layer` acquisition                                       | no periodic schedule; explicit runtime replay ring uses `eventReplayCapacity`; subscriber queues use `eventSubscriberBufferCapacity`                                                      | no durable facts; emits typed runtime events after committed state writes                                                   | app scope shutdown closes subscription queues and receipts                                                   |

Runtime keyed workers use these canonical keys. The key string is process-local and may be encoded
as a tuple/object internally, but tests use these logical names:

| Worker lane                | Canonical key                                                     | Merge rule                                                                                                              |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| App source scan            | `app-source:{domain}`                                             | keep one pending scan per app-global source domain; merge reasons by priority                                           |
| Workspace source scan      | `workspace-source:{workspaceId}:{domain}`                         | keep one pending scan per workspace/source domain; merge paths into a deterministic set                                 |
| Generated-package refresh  | `generated-package:{packageName}`                                 | keep one pending app-global package refresh per canonical package name                                                  |
| Workspace link repair      | `workspace-link:{workspaceId}:{packageName}`                      | keep one pending repair per acquired workspace/package pair                                                             |
| Queue dispatch             | `queue-dispatch:{workspaceId}:{surfacePiSessionId}:{orderingKey}` | keep latest wake reason while preserving durable queue-row FIFO in state                                                |
| Command output event flush | `command-output:{commandId}`                                      | preserve admitted output-event order while bounding live event text and retaining oversized output as command artifacts |

App-global generated-package graph builds are serialized per canonical package graph. The graph preserves
strict `@svvyx/extensions` before dependent `@svvyx/workflows` ordering and exposes no
generated-package build concurrency setting. Independent build keys require
`generated-packages.spec.md` to define the keys, dependency graph, scheduling semantics, state facts,
tests, and runtime config field before runtime admits concurrent graph builds. Workspace link repair
concurrency is controlled only by `generatedPackageWorkspaceLinkRepairConcurrency`; link repair is keyed by
`workspace-link:{workspaceId}:{packageName}` and is not part of the app-global generated-package
build result.

Worker terminal policies:

| Worker                           | Item failure policy                                                                                                         | Worker fiber failure policy                                                                          | Retry classification                                                                         | Drain/test receipt                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| App source coordinator           | classify scan/build failure, retry transient failures, record diagnostic/recovery after exhaustion, keep prior ready output | fail readiness during startup; after ready, record unhealthy lane and continue after bounded restart | transient IO/build errors retry by source retry config; invalid source is durable diagnostic | source reconcile completed or recovery row recorded          |
| Workspace source coordinator     | same as app source coordinator for workspace domains                                                                        | workspace readiness fails before ready; after ready, unhealthy lane plus bounded restart             | same source retry config                                                                     | workspace reconcile completed or recovery row recorded       |
| Queue dispatcher                 | catch per-row failures, commit retry/failed/cancelled facts, continue draining                                              | bounded restart; repeated worker failure records unhealthy runtime app-log and recovery row          | retry only typed retryable pre-accept failures                                               | queue row claimed and terminal/retry fact committed          |
| Recovery coordinator             | per-row failure updates recovery row with retry/failed facts                                                                | bounded restart; readiness fails if startup recovery cannot scan required rows                       | retry typed transient state/host failures by recovery policy                                 | recovery sweep completed                                     |
| Title job worker                 | terminal title failure records title-job fact and app-log, prior title remains                                              | bounded restart; active helper interruption records retry/recovery                                   | retry transient provider/pi/helper failures only                                             | title job terminalized                                       |
| Request-input timeout worker     | overdue wait failure records retry/recovery row, does not drop durable wait                                                 | bounded restart                                                                                      | retry transient state write failures; timeouts are deterministic terminal facts              | wait resolved/timeout receipt                                |
| Generated-package refresh worker | build failure records diagnostics and keeps prior ready generated output                                                    | bounded restart; startup build failure does not delete ready output                                  | retry transient IO/package/build infrastructure; invalid source is durable diagnostic        | generated-package refresh completed or recovery row recorded |
| Runtime event bus                | closed bus maps to shutdown/rebaseline, not success                                                                         | app runtime shutdown closes bus; unexpected bus failure fails runtime scope                          | no retry inside closed bus; publisher receives typed failure                                 | event published or shutdown/rebaseline receipt               |

Worker fiber restart uses one shared runtime policy: after a worker fiber fails unexpectedly after
readiness, runtime records the lane failure, restarts it with `Schedule.exponential(...)` using
`workerRestartInitialDelayMs` capped by `workerRestartMaxDelayMs`, and stops after
`workerRestartMaxAttempts`. Jitter is not used unless a worker spec names a concrete host-resource
reason. Exhaustion records an unhealthy-lane app log and recovery fact; if the failed worker was
still inside startup readiness, startup fails instead of exposing a partially ready runtime. Tests
use `@effect/vitest` test helpers with `TestClock` imported from `effect/testing` to prove restart
timing, cap behavior, exhaustion, and readiness failure.

Runtime owner services expose package-private readiness only for runtime-owned app/workspace/surface
scopes after their startup effects have acquired resources and state-backed checks have succeeded.
The readiness service is package-private and has this shape:

```ts
type RuntimeOwnerReadiness = {
  awaitReady: Effect.Effect<RuntimeStartupReadinessReceipt, RuntimeStartupError>;
  markReady(input: RuntimeStartupReadinessReceipt): Effect.Effect<void, never>;
  failReady(error: RuntimeStartupError): Effect.Effect<void, never>;
  runWhenReady<A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | RuntimeStartupError, R>;
};
```

Public facades are constructed only after `managedRuntime.context()` completes layer acquisition and
`awaitRuntimeStartupReadiness(managedRuntime)` completes the runtime-owned app-readiness barrier.
Facade methods still validate workspace/surface readiness for resources acquired after app startup.
If bootstrap readiness fails, no facade is exposed; pending bridge calls fail with the normalized
startup failure and app/bootstrap disposes that `ManagedRuntime` before retry.
`awaitRuntimeStartupReadiness(...)` has exactly two outcomes: it resolves with
`RuntimeStartupReadinessReceipt` when the app scope is ready or degraded-ready according to the gate
table below, or rejects with encoded/decoded `RuntimeStartupError` when startup is terminal. It does
not return read-model snapshots, recovery payloads, generated package contents, queue depths, or
state rows. Bootstrap logs or publishes only the typed lifecycle notification, then callers refetch
state-backed read models through the ordinary state/runtime facades after the facade is exposed.

`RuntimeStartupAdmissionPolicy`:

| State                                    | Groups                                                                                                               | Pending policy | Capacity                                              | Overflow / terminal error                                                                                                                                         | Required tests                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Before app readiness                     | all public facade groups                                                                                             | fail           | 0                                                     | bridge callers receive typed `startup-pending` / `startup-failed`; no Effect is admitted                                                                          | no domain effect runs before readiness, startup failure rejects caller, no queued work drains after failure |
| App ready, workspace not acquired        | `workspaces.acquire` / `workspaces.acquireDefault`                                                                   | wait           | bounded by `runtimeStartupWorkspaceAdmissionCapacity` | overflow returns typed `backpressure`; terminal startup failure returns typed startup failure; workspace readiness timeout returns typed target/readiness failure | workspace acquire waits only for bounded readiness, overflow, timeout, shutdown while waiting               |
| App ready, target workspace/surface dead | surfaces, messages, queues, commands, approvals, request-input, source-edits, events                                 | fail           | 0                                                     | typed `target-not-ready` or `target-not-found`; no unbounded wait                                                                                                 | dead workspace/surface fails without acquiring new surface runtime resources                                |
| Shutdown started                         | all public facade groups and task-agent bridge calls; bootstrap shutdown helper remains the only admitted entrypoint | fail           | 0                                                     | typed shutdown error; no new queue wakeups, event subscriptions, commands, source scans, task-agent bridge calls, or waits are admitted                           | shutdown rejection for every facade group; idempotent bootstrap shutdown preparation                        |
| `ManagedRuntime` disposed                | all groups                                                                                                           | fail           | 0                                                     | typed disposed/runtime-closed error mapped from Effect defect/interruption; app/bootstrap must create a new runtime before retrying                               | disposed runtime mapping and no reuse                                                                       |

Readiness gates are explicit:

| Gate                                    | Scope         | Primitive                        | Required before                                                  | Success condition                                                                          | Degraded-ready condition                                                                                       | Terminal failure                                                                                    |
| --------------------------------------- | ------------- | -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| State migrations and schema checks      | app           | layer acquisition                | any runtime/state facade exposure                                | migrations complete and schema/version checks pass                                         | none                                                                                                           | migration, schema, or database open failure                                                         |
| App source reconcile                    | app           | startup readiness receipt        | runtime facade exposure and generated import claims              | app-global fingerprints, generated-package facts, diagnostics, and invalidations committed | diagnostic plus recovery row committed while a previous ready generated package remains available              | no readable previous ready output for an import surface that would be exposed as ready              |
| Runtime event bus acquisition           | app           | layer acquisition plus receipt   | event facade exposure and after-commit notification              | replay ring, generation id, subscriber map, publication lane, and shutdown hooks acquired  | none                                                                                                           | event bus acquisition failure                                                                       |
| Recovery startup scan                   | app/workspace | readiness receipt                | app readiness for app rows; workspace acquire for workspace rows | eligible recovery rows scanned, claimed work scheduled, and stale claims reconciled        | diagnostic plus recovery row committed for noncritical work that can be retried by the recovery worker         | unable to scan required recovery rows or commit recovery facts                                      |
| Workspace source reconcile              | workspace     | `Latch` plus workspace readiness | `workspaces.acquire(...).readiness: "ready"`                     | workspace external-instruction and host-snippet facts committed                            | diagnostic plus recovery row committed; affected read models show diagnostics and generated imports stay stale | workspace facts cannot be loaded or diagnostics/recovery rows cannot be committed                   |
| Workspace generated-package link repair | workspace     | readiness receipt                | generated imports are reported ready for a workspace             | required links are applied and workspace-link facts committed                              | blocked/missing link status committed and read models report the workspace link as not ready                   | link state cannot be inspected or workspace-link facts cannot be committed                          |
| Surface prompt binding restore          | surface       | owner readiness receipt          | `surfaces.open(...)` and prompt-bearing dispatch                 | persisted pi session reference and generated-context binding are loaded                    | stale binding loaded with opted-out stale state visible                                                        | surface belongs to another workspace, is hard-deleted, or required prompt-binding facts cannot load |

Every degraded-ready condition must name the committed diagnostic, recovery, or read-model fact that
proves the degraded state and must name which API groups or generated imports remain disabled or
stale. A method may return `readiness: "ready"` only after the table's success or degraded-ready
condition for that scope is satisfied.
For app-scope degraded readiness, the same degraded phases must be represented in
`RuntimeStartupReadinessReceipt.degradedPhases`; consumers must not infer degraded state from
lifecycle events. Startup readiness is not a `RuntimeEventSchema` event. App/bootstrap observes the
runtime startup readiness receipt before exposing facades and records startup failure through the
startup failure surface and app-owned logs. Runtime events after readiness use only the concrete
`RuntimeEventSchema` variants in `@svvy/core`: `surface.stream`, `surface.changed`,
`command.changed`, `queue.changed`, `turn.changed`, `workflow_task_attempt.changed`,
`workspace_read_model.changed`, `app_read_model.changed`, and `runtime.recovery`.

Lifecycle events do not carry read-model snapshots, state rows, command summaries, queue depths, or
provider/session details. Consumers refetch state-backed read models after receiving them.

Runtime owns one package-private shutdown service and exposes only the app-bootstrap helper
`prepareRuntimeShutdown(managedRuntime, input)` that runs that service through the app
`ManagedRuntime`. It is not a renderer facade, extension tool, Smithers bridge operation, or
`@svvy/core` public command:

```ts
type RuntimePrepareShutdownRequest = {
  reason: "app-shutdown" | "runtime-restart" | "startup-failure";
  drainTimeoutMs?: number;
};

type RuntimePrepareShutdownResult = {
  status: "drained" | "forced";
  interruptedTurns: number;
  interruptedCommands: number;
  releasedQueueClaims: number;
  recoveryRowsScheduled: number;
};

declare function prepareRuntimeShutdown(
  managedRuntime: ManagedRuntime.ManagedRuntime<
    RuntimeShutdownPreparation | RuntimeLayerConfigService,
    unknown
  >,
  input: RuntimePrepareShutdownRequest,
): Promise<RuntimePrepareShutdownResult>;

type RuntimeShutdownService = {
  prepareShutdown(
    input: RuntimePrepareShutdownInput,
  ): Effect.Effect<RuntimePrepareShutdownResult, RuntimeContractError>;
};

type RuntimePrepareShutdownInput = {
  reason: "app-shutdown" | "runtime-restart" | "startup-failure";
  requestedAt: IsoDateTimeString;
  drainTimeoutMs: number;
};
```

The public helper input is bootstrap intent only. App/bootstrap supplies `reason` and optionally
overrides `drainTimeoutMs`; it does not stamp `requestedAt` itself. The helper reads the
runtime-layer config for the default drain timeout, stamps `requestedAt` from the Effect `Clock`,
calls the package-private shutdown service with the full internal `RuntimePrepareShutdownInput`,
and returns the exact `RuntimePrepareShutdownResult`.

App/bootstrap calls `prepareShutdown(...)` after it has stopped accepting new bridge calls and
before `ManagedRuntime.dispose()`. The shutdown service closes event subscriptions, stops queue
wakeups, prevents new queue claims, requests active turn/command cancellation, waits up to
`drainTimeoutMs` for graceful terminal facts, records app-log/recovery receipts for visible
interrupted work, and returns a forced result if the deadline expires. Queued rows that have not
been claimed stay queued. Claimed rows that have not been accepted by pi are released or retried
through durable queue facts. Pi-accepted active turns and launched commands are terminalized as
cancelled with reason `runtime_shutdown` or get recovery rows when terminalization cannot be
completed before disposal. After shutdown preparation starts, runtime publishes no new success
wakeups and every public facade call fails with the typed shutdown/disposed error.

## Workflow Task-Agent Bridge

Runtime owns the app-side workflow task-agent bridge used by generated
`@svvyx/workflows` `Agents.defineTaskAgent(...)` values.
This bridge is only the generated Smithers task-agent `runTaskAgent` operation for
`<Task agent={...}>`. It is not an agent-facing Smithers workflow-control API and does not run,
resume, approve, inspect, or debug Smithers workflow executions.

Runtime owns the bridge operation semantics: source DTO decoding, bearer-token lineage
authorization through decoded `workspaceSessionId` / `sourceCommandId`, workflow-task-attempt
surface creation, queue insertion, pi-adapter task-agent delivery handoff, response DTO mapping,
command facts, recovery, and notifications. App/bootstrap owns only the transport binding and
pre-decode HTTP envelope checks. The shipped transport is an app-bootstrap Bun loopback HTTP adapter
using `Bun.serve` on `127.0.0.1` with a command-scoped bearer token and generated environment
variables. It exposes exactly `POST /runTaskAgent`, rejects request bodies above
`RuntimeLayerConfig.workflowTaskAgentBridgeMaxRequestBytes` before JSON decode, rejects missing or
malformed bearer headers before body decode, passes accepted bytes and auth envelope facts to the
runtime-owned bridge decoder/authorizer, encodes the closed core result/error DTOs returned by
runtime, and closes with app/runtime shutdown. Token lineage checks that depend on decoded ids
happen only after `RunTaskAgentSourceInput` decode inside runtime. This transport is not an Effect
`HttpServer` / `HttpRouter` layer, and the base `Runtime.layer` has no Effect HTTP server
requirement. Alternate transports are outside the shipped contract unless a separate spec defines a
named app-bootstrap bridge layer that preserves the same one-operation runtime bridge contract.

The bridge exposes exactly one operation, `runTaskAgent`. Generated package code sends
`RunTaskAgentSourceInput`, a plain source DTO whose ids and paths are strings. Runtime decodes and
validates that source DTO into the branded `RunTaskAgentInput` before authorization, queueing,
state writes, command facts, or pi-adapter delivery handoff. `RunTaskAgentSourceInput`, `RunTaskAgentInput`,
`RunTaskAgentResult`, bridge prompt-source helper types, and JSON-safe usage and output contracts
are imported from `@svvy/core`'s `workflow-task-agent-bridge-contracts` module. Runtime owns
validation, queueing, lifecycle, and orchestration, but not a second bridge contract shape.

Generated `@svvyx/workflows` bridge client code is value-level plain TypeScript, not an Effect
client and not a runtime SDK. It may read only the command-scoped environment variables injected by
`@svvy/runtime` for the eligible Smithers task-agent command: loopback URL, bearer token, source
command id, workspace session id, and optional bridge request timeout. It sends one JSON
`RunTaskAgentSourceInput` request to `POST /runTaskAgent` using the host fetch-compatible API
available inside the Smithers task process, with an `AbortController` only for the request timeout.
It validates success and error JSON through local generated structural guards that mirror the public
core bridge DTOs, rejects response bodies above
`RuntimeLayerConfig.workflowTaskAgentBridgeMaxResponseBytes`, while app/runtime remains the owner of
schema decoding with `@svvy/core`. It maps transport failure into the closed `RunTaskAgentError`
contract, and never imports `@svvy/runtime`,
`@svvy/state`, `@svvy/extensions`, Effect, Electrobun APIs, app bridge APIs, Smithers internals, or
broad process environment values.
The generated client cannot inspect, resume, approve, list, or debug Smithers workflows; it only
submits the current task-agent prompt to the authenticated runtime bridge.

Canonical command-scoped bridge environment:

| Env var                                         | Required | Value owner     | Meaning                                                                               |
| ----------------------------------------------- | -------- | --------------- | ------------------------------------------------------------------------------------- |
| `SVVY_WORKFLOW_AGENT_BRIDGE_URL`                | yes      | `@svvy/runtime` | Exact local `POST /runTaskAgent` endpoint URL for the command-scoped bridge instance. |
| `SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN`              | yes      | `@svvy/runtime` | Unguessable bearer token scoped to `(workspaceSessionId, sourceCommandId)`.           |
| `SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID`      | yes      | `@svvy/runtime` | Owning top-level workspace session id carried as an unbranded source DTO string.      |
| `SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID`         | yes      | `@svvy/runtime` | Owning handler-thread command id carried as an unbranded source DTO string.           |
| `SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS`         | no       | `@svvy/runtime` | Positive integer request timeout in milliseconds for the generated bridge client.     |
| `SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES` | no       | `@svvy/runtime` | Positive integer response byte cap for the generated bridge client.                   |

No other environment variable is part of the generated bridge contract. Generated package
instructions must not document or accept short aliases. The request byte limit is not a generated
client environment variable and is not agent-configurable; it is a runtime config value applied
only by the app-owned loopback transport before request JSON decode.

Adapter-only bridge operation:

```ts
type AuthenticatedRunTaskAgentInput = {
  auth: {
    kind: "bearer";
    token: string;
    transport: "loopback-http";
  };
  request: RunTaskAgentSourceInput;
};

type RuntimeWorkflowTaskAgentBridgeOperation = {
  runTaskAgent(
    input: AuthenticatedRunTaskAgentInput,
  ): Effect.Effect<RunTaskAgentResult, RuntimeContractError>;
};
```

`runTaskAgent(...)` is a runtime-owned bridge operation available only to authenticated app-owned
bridge transport adapters that receive generated `@svvyx/workflows` `Agents.defineTaskAgent(...)`
calls carrying the command-scoped bridge token. The adapter validates auth header presence/shape and
body size first, decodes `input.request` as `RunTaskAgentSourceInput`, then runtime validates
`input.auth` lineage against the decoded `workspaceSessionId` and `sourceCommandId` before applying
the request. Desktop panes, browser tools, ordinary agents, Shell commands, extension handlers, and
headless prompt automation do not receive a `workflowTaskAgentBridge` public facade group and must
not call this operation as general app RPC. The app-owned loopback bridge adapter invokes the
Effect service inside the already-acquired app `ManagedRuntime`; it is not part of
`createRuntimeFacade(...)`.

Concrete bridge request:

```ts
const request: RunTaskAgentSourceInput = {
  operation: "runTaskAgent",
  bridgeRequestId: "smithers-run_42-node_review-0-1",
  agent: {
    id: "reviewerAgent",
    label: "Reviewer",
    provider: "openai",
    model: "<model-id-from-pi-metadata>",
    reasoning: { effort: "high" },
    instructions: "Review the implementation and return the highest-risk findings.",
    overrides: {
      git: "loaded",
      github: "loaded",
      web: "available",
    },
  },
  taskIdentity: {
    runId: "run_42",
    nodeId: "review",
    iteration: 0,
    attempt: 1,
  },
  smithersContext: {
    rootDir: "/Users/me/code/project",
    run: { id: "run_42", status: "running" },
    node: { id: "review", type: "Task" },
  },
  promptSource: {
    kind: "prompt",
    prompt: "Review the staged changes and report actionable issues.",
  },
  workspaceSessionId: "wsess_main",
  sourceCommandId: "cmd_handler_smithers_run",
};
```

Authenticated loopback transport payload:

```ts
const authenticatedInput: AuthenticatedRunTaskAgentInput = {
  auth: {
    kind: "bearer",
    token: process.env.SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN!,
    transport: "loopback-http",
  },
  request,
};
```

Only the app-owned loopback adapter receives this authenticated envelope. Generated workflow code
constructs the `RunTaskAgentSourceInput` request and sends it to the command-scoped bridge endpoint
with the bearer token; runtime validates the token lineage against `request.workspaceSessionId` and
`request.sourceCommandId`.

Equivalent message-list prompt source:

```ts
const promptSource: RunTaskAgentSourceInput["promptSource"] = {
  kind: "messages",
  messages: [
    { role: "user", text: "Inspect the diff." },
    { role: "assistant", text: "I will focus on correctness and missing tests." },
    { role: "user", text: "Return only findings with file references." },
  ],
};
```

Concrete bridge result:

```ts
const result: RunTaskAgentResult = {
  text: "No blocking issues found. One residual risk: generated package refresh is not covered by this task.",
  usage: { inputTokens: 18_240, outputTokens: 312 },
  output: {
    findings: [],
    residualRisks: ["Generated package refresh was not exercised."],
  },
};
```

Invalid examples:

- both `promptSource.kind: "prompt"` and `messages` material, or neither, returns bridge code
  `invalid_request` and maps to `RuntimeContractError.reason: "bridge-invalid-request"`
- an empty `prompt`, empty `messages`, or message role outside `user` / `assistant` returns bridge
  code `invalid_request` and maps to `RuntimeContractError.reason: "bridge-invalid-request"`
- a request body above `workflowTaskAgentBridgeMaxRequestBytes` returns bridge code
  `payload_too_large` before JSON decode and maps to
  `RuntimeContractError.reason: "bridge-payload-too-large"` when runtime diagnostics need a typed
  product reason
- a valid token for a different `(workspaceSessionId, sourceCommandId)` pair returns bridge code
  `forbidden` and maps to `RuntimeContractError.reason: "bridge-forbidden"`
- an unknown source command returns bridge code `source_command_not_found` and maps to
  `RuntimeContractError.reason: "source-command-not-found"`
- a source command not owned by a handler-thread surface returns bridge code
  `source_command_not_handler_owned` and maps to
  `RuntimeContractError.reason: "source-command-not-handler-owned"`

Rules:

- App/bootstrap creates the local loopback bridge endpoint for handler-thread command environments
  that may run Smithers workflow source. Runtime creates and validates the unguessable operation
  token lineage for that endpoint.
- The endpoint/token, owning `workspaceSessionId`, and owning `sourceCommandId` are injected only into
  the child environment for the specific handler-thread `exec_command` invocation that owns the
  structured source command. Bridge availability is not based on command-string parsing, binary
  shadowing, a user-facing `svvy` command, or global shell environment.
- Runtime validates the bearer token, `workspaceSessionId`, and `sourceCommandId` before accepting a
  request. Invalid, missing, or stale identity fails closed and records command/recovery facts through
  state.
- A request carries exactly one `promptSource` value: either `{ kind: "prompt" }` with one
  non-empty prompt string or `{ kind: "messages" }` with non-empty user/assistant text messages.
  Supplying both semantic variants or neither is a schema error. System prompt material is never
  accepted through this bridge.
- Each accepted bridge call creates or reuses the workflow-task-attempt surface for the supplied
  Smithers run/node/iteration/attempt identity, binds the current workflow task-agent generated
  context, inserts a durable `workflow_task_agent_start` queue row for that surface, and lets the
  normal runtime queue claim and delivery path drive the pi turn through `@svvy/pi-adapter`.
- Runtime derives the workflow task-attempt `threadId` from the validated `sourceCommandId`: the
  source command must belong to a handler-thread surface, and the resulting workflow-task surface
  inherits that handler thread as its root thread. If `sourceCommandId` does not resolve to a
  handler-owned command in the supplied `workspaceSessionId`, the bridge request is rejected before
  queue insertion.
- Bridge callers cannot supply system-role messages. The task-agent system prompt comes only from
  generated package/extension context owned by `@svvy/extensions` and bound by runtime.
- Bridge calls may run concurrently. Each accepted call is scoped to one workflow task-attempt
  surface and one source command lineage.
- The bridge exposes no arbitrary app RPC, Shell access, settings mutation, orchestrator controls, or
  workflow/run-state mutation. Smithers remains the owner of workflow graph execution and
  workflow/run state.
- `@svvy/state` owns durable command facts, task-attempt surface facts, recovery facts, read-model
  projections, and CLI-observed Smithers facts. Runtime owns endpoint/token validation, queueing,
  task-attempt lifecycle, generated-context binding, recovery scheduling, and pi-adapter delivery
  handoff.

## Prompt Execution Context

Runtime constructs the extension invocation context for every prompt-bearing item from durable target
and surface state. Extensions receive this context through runtime-owned tool invocation ports; they
must not depend on `WorkspaceSessionCatalog` internals.

The context carries:

- workspace session id
- runtime-derived workspace id
- turn id
- workflow run id and workflow task-attempt id when relevant
- surface pi session id
- surface thread id when relevant
- surface kind: `orchestrator`, `handler`, or `workflow-task`
- root thread id when work is nested under a handler objective
- default episode kind
- root episode kind
- wait-state flags
- loaded and available extension ids
- external instruction source summaries
- generated-context fingerprint, generated-context revision, and prompt-binding metadata
- queue item id when the prompt was delivered from a durable queue row

Production context input is derived only by `@svvy/runtime` after queue claim and state reads,
including `RuntimeActorExtensionBindingStatePort.readRuntimePromptBinding(...)` for prompt binding
identity, generated-context fingerprint/revision, and bound extension ids. It is never accepted from
the UI, desktop bridge, browser tools, headless callers, Smithers bridge callers, or generated
packages. `SubmitMessageInput` remains only target, message, delivery intent, and client telemetry.
Workflow task-agent attempts receive a normal `TurnId` plus task-attempt identity;
`workflowTaskAttemptId` never replaces the turn identity used by command facts, transcript
projection, or runtime events.

`@svvy/core` exports the prompt execution context shape, derived type, and boundary codecs only.
Runtime owns the content-stripping constructor and live `PromptExecutionRuntimeHandle` holder used
only by runtime-owned accepted-tool runners and extension handler invocation. That constructor and live handle type are exported
only from `@svvy/runtime/prompt-execution-context`; `@svvy/runtime` root and
`@svvy/runtime/bootstrap` must not re-export prompt execution context construction or live handle
APIs. Runtime owns production derivation and lifecycle: it passes state-derived identities, bindings,
wait facts, generated-context facts, queue identity, and external-instruction summaries into the
runtime-owned constructor. The constructor normalizes optional/null fields and strips accidental
external-instruction `content`; it is not a UI, bridge, browser-tool, headless, extension-handler,
or generated-package submission surface. The
schema below is not a second runtime-local contract;
it is the core-exported `PromptExecutionContext`.

Exact core schema:

```ts
type PromptExecutionContext = {
  workspaceSessionId: WorkspaceSessionId;
  turnId: TurnId;
  workflowTaskAttemptId?: WorkflowTaskAttemptId;
  workflowRunId?: WorkflowRunId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId?: ThreadId;
  surfaceKind: PromptExecutionSurfaceKind;
  rootThreadId: ThreadId | null;
  defaultEpisodeKind: PromptExecutionEpisodeKind;
  rootEpisodeKind: PromptExecutionEpisodeKind;
  sessionWaitApplied: boolean;
  threadWasTerminalAtStart: boolean;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  externalInstructionSources?: readonly PromptExecutionExternalInstructionSource[];
  generatedAgentContextFingerprint: GeneratedContextFingerprint;
  generatedAgentContextRevision: GeneratedContextRevision;
  suppressPendingWorkflowAttentionDelivery?: boolean;
  queueItemId?: QueueItemId;
};

type PromptExecutionExternalInstructionSource = {
  id: ExternalInstructionSourceId;
  kind: "AGENTS.md" | "CLAUDE.md";
  title: string;
  path: AbsolutePath;
  contentHash: string;
  order: number;
  enabled: boolean;
  actors: readonly ActorKind[];
  sourceGroup: "builtin_global_root" | "custom_global_root" | "workspace_chain";
  rootId?: string;
  rootLabel?: string;
  readStatus: {
    status: "readable" | "unreadable";
    error?: string;
  };
};
```

Only `@svvy/runtime` constructs this context. Extension handlers and `execute_typescript` facades may
receive a redacted view of it through typed invocation APIs. The UI, desktop bridge, tests, browser
tools, headless callers, Smithers task-agent bridge callers, and generated packages never submit
this context.

The prompt execution context does not carry submitted prompt text, generated system prompt text, or
external instruction file content. It carries only stable identity, binding, fingerprint/revision,
wait-state, extension ids, and redacted external-instruction source summaries. Prompt bodies are
delivered only through `@svvy/pi-adapter`; extension handlers receive no prompt body or instruction
content through `PromptExecutionContext`.

Construction rules:

- Production prompt-context construction never defaults actor identity, target identity,
  generated-context binding, or extension binding. Runtime derives `surfaceKind`,
  `loadedExtensionIds`, `availableExtensionIds`, external instruction summaries, fingerprint, and
  revision from validated state after queue claim, with
  `RuntimeActorExtensionBindingStatePort.readRuntimePromptBinding(...)` providing the committed
  prompt binding facts for orchestrator and handler targets. Missing production state is a
  contract/state error.
- Handler contexts require a handler thread id.
- Workflow task-agent contexts require a workflow task-attempt id.
- Every prompt-bearing context requires a concrete turn id. Workflow task-agent contexts carry both
  `turnId` and `workflowTaskAttemptId`; task-attempt identity never replaces the turn identity used
  by command facts, transcript projection, or runtime events.
- Runtime derives `threadId`, `rootThreadId`, `defaultEpisodeKind`, `rootEpisodeKind`,
  `sessionWaitApplied`, and `threadWasTerminalAtStart` from durable surface, thread, queue, and
  wait-state facts. Missing required facts fail prompt-context construction.
- Test-only fixture builders may provide explicit defaults under test helper names. Those defaults
  are not part of runtime construction semantics.
- Runtime production prompt-context derivation must provide every field that runtime derives from
  state and must not rely on constructor normalization as a replacement for actor identity,
  extension binding, wait-state, surface kind, thread identity, generated-context identity, or queue
  identity. Test fixtures that need fixture defaults use test helpers or explicit constructor
  inputs; app/bootstrap does not expose a runtime-local constructor or handle.
- The true system prompt text is not included in the context value. Runtime binds the generated
  context through pi-adapter's `systemPrompt` channel before dispatch and exposes only the bound
  generated-context fingerprint/revision through this invocation context.
- The bound system prompt text is passed only to `@svvy/pi-adapter` through
  `RunPiTurnInput.systemPromptBinding.text`. Extension handlers and `execute_typescript` facades
  receive no generated prompt body.
- `queueItemId` is present only when the prompt was delivered from a durable queue row.

Rejected prompt execution contexts:

```json
{
  "surfaceKind": "workflow-task",
  "workflowTaskAttemptId": "wta_01",
  "surfacePiSessionId": "pi_wta_01",
  "generatedAgentContextFingerprint": "gctx_01",
  "generatedAgentContextRevision": "rev_01"
}
```

```json
{
  "workspaceSessionId": "wsess_01",
  "turnId": "turn_01",
  "surfacePiSessionId": "pi_orch_01",
  "sessionId": "unsupported_session_alias_01",
  "surfaceThreadId": "unsupported_thread_alias_01",
  "queuedMessageId": "queue_01",
  "systemPrompt": "Do not put system prompts in invocation context.",
  "content": "Do not duplicate submitted message content here."
}
```

## Queue Delivery

Surface queues are keyed by `surfacePiSessionId`. State persists rows transactionally; runtime owns
claiming, ordering, retries, recovery, and delivery.

Queue item kinds are:

- `user_message`
- `initial_handler_start`
- `thread_followup`
- `report_request`
- `thread_report_notification`
- `request_user_input_answer`
- `workflow_task_agent_start`

Runtime drains queued items into real pi user-message deliveries. Some queue kinds use
runtime-authored prompt text rather than user-authored text:

- `initial_handler_start` delivers the handler objective and any allowed inherited-history block.
- `thread_followup` delivers an orchestrator or user correction/follow-up to the handler surface.
- `report_request` asks a handler to call `thread_report`.
- `thread_report_notification` notifies the orchestrator that a handler emitted an update or
  conclusion episode.
- `request_user_input_answer` delivers a later nonblocking selected or custom answer back to the
  owning surface.
- `workflow_task_agent_start` delivers an accepted `Agents.defineTaskAgent(...)` bridge request into
  its workflow task-attempt surface.

Queue delivery must be idempotent, recoverable after restart, and scoped to the addressed
`surfacePiSessionId`.

Execution identity matrix:

| Surface kind    | Public message target | Queue kinds delivered to it                                                                                           | Turn id | Extra required identity                                       | Command context identity                                       |
| --------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------- | -------------------------------------------------------------- |
| `orchestrator`  | yes                   | `user_message`, `thread_report_notification`, nonblocking `request_user_input_answer`                                 | yes     | `workspaceSessionId`, `surfacePiSessionId`                    | `turnId`, `target`, optional `sourceCommandId`                 |
| `handler`       | yes                   | `user_message`, `initial_handler_start`, `thread_followup`, `report_request`, nonblocking `request_user_input_answer` | yes     | `threadId`, `workspaceSessionId`, `surfacePiSessionId`        | `turnId`, `threadId`, `target`, optional `sourceCommandId`     |
| `workflow-task` | no                    | `workflow_task_agent_start`                                                                                           | yes     | `threadId`, `workflowTaskAttemptId`, optional `workflowRunId` | `turnId`, `workflowTaskAttemptId`, `target`, `sourceCommandId` |

`workflow-task` surfaces are not user-messageable through `runtime.messages.submit(...)`; they are
created and driven by accepted Smithers task-agent bridge requests. They still run normal pi turns
and normal extension tool calls, so every task-agent attempt delivery has a real `TurnId`.
`request_user_input_answer` delivery is limited to nonblocking answers for orchestrator and handler
surfaces in this target spec. Blocking answers record answer facts against the waiting command,
resolve that command only when the final open question is answered, and never create a
`request_user_input_answer` queue row.

Durable queue row schema:

```ts
type SurfaceQueueRow = {
  id: QueueItemId;
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId: ThreadId | null;
  workflowTaskAttemptId: WorkflowTaskAttemptId | null;
  kind:
    | "user_message"
    | "initial_handler_start"
    | "thread_followup"
    | "report_request"
    | "thread_report_notification"
    | "request_user_input_answer"
    | "workflow_task_agent_start";
  status: "queued" | "steering" | "dispatching" | "delivered" | "failed" | "cancelled";
  priority: "interactive" | "runtime" | "background";
  orderingKey: string;
  sequence: number;
  position: number;
  steerSequence: number | null;
  payload: QueueItemPayload;
  idempotencyKey: string;
  deliveredAt: IsoDateTimeString | null;
  failedAt: IsoDateTimeString | null;
  terminalFailure: StateStoredError | null;
  sourceCommandId: CommandId | null;
  claimOwnerId: RuntimeOwnerId | null;
  claimLeaseExpiresAt: IsoDateTimeString | null;
  leaseVersion: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: IsoDateTimeString | null;
  lastRetryableError: StateStoredError | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  cancelledAt: IsoDateTimeString | null;
};
```

For every prompt-bearing surface queue row, `orderingKey` is the canonical surface key for
`surfacePiSessionId`. Runtime must not use alternate ordering keys to create parallel or overtaking
lanes for transcript-affecting work on one surface. Claim order for prompt-bearing rows is:
steered rows first, then `request_user_input_answer` rows ahead of ordinary `user_message` rows,
then priority `interactive > runtime > background`, then FIFO sequence. Narrower ordering keys are
allowed only for non-transcript internal recovery/work queues whose owning contract explicitly
defines independent execution.

Per-kind `payload` is decoded by a hoisted schema before delivery:

- `user_message`: submitted runtime message and optional client submission metadata.
- `initial_handler_start`: handler objective, thread id, thread group id, optional inherited-history
  block, worktree id, and extension overrides applied at creation.
- `thread_followup`: target thread/group identity, follow-up text, sender kind, and whether the
  follow-up reactivates a concluded handler.
- `report_request`: requested thread id or thread group id, requested report reason, and expected
  report episode kind.
- `thread_report_notification`: source handler thread id, report episode id, and notification kind.
  The delivered prompt text and display summary are generated by runtime from the canonical
  episode/thread read models.
- `request_user_input_answer`: compact request, question, answer, and delivery ids for the
  nonblocking durable queue row. The generated prompt-bearing delivery JSON is a separate id-free
  `request_user_input.answer` payload containing title, question text, original answer, and user
  answer. Timeout facts, mode, UI display metadata, and lifecycle state remain in persisted
  request-input records and queue rows instead of being duplicated in the queue payload.
- `workflow_task_agent_start`: workflow task-attempt id, validated task-agent parameters,
  Smithers run/node/iteration/attempt identity, optional observed Smithers context
  `{ run, node, rootDir }`, and exactly one `promptSource` value as either `{ kind: "prompt" }`
  with a non-empty prompt string or `{ kind: "messages" }` with non-empty user/assistant messages.
  The payload has no top-level `rootDir`, no caller-supplied `threadId`, and no duplicated
  `sourceCommandId`.

`sourceCommandId` is row-level queue metadata. It is not duplicated in the queue payload. Runtime
requires row-level `sourceCommandId` for `workflow_task_agent_start` so workflow task-agent turns can
be traced to the command-scoped bridge invocation that requested them.

Queue rows do not store `requestSummary`. Runtime/state read models may expose
`QueueReadModel.displaySummary`, but it is derived from row kind, payload, and linked state instead
of submitted as a second mutable summary field.

Valid `user_message` payload:

```json
{
  "kind": "user_message",
  "message": {
    "text": "Run the next check."
  },
  "clientSubmission": {
    "clientRequestId": "desktop-submit-218",
    "source": "desktop"
  }
}
```

Rejected `user_message` payload:

```json
{
  "kind": "user_message",
  "message": {
    "text": "Run the next check."
  },
  "requestSummary": "Run the next check."
}
```

Valid `thread_report_notification` payload:

```json
{
  "kind": "thread_report_notification",
  "sourceThreadId": "thread_7",
  "episodeId": "episode_42",
  "notificationKind": "conclusion"
}
```

`thread_report_notification` payloads do not carry `summary`, `outcome`, or `concluded`; runtime
derives display text and state from linked thread/episode read models.

The `workflow_task_agent_start` idempotency key is:

```text
workflow-task-agent-start:<workspaceSessionId>:<sourceCommandId>:<runId>:<nodeId>:<iteration>:<attempt>:<agent.id>
```

The same key is used for the workflow task-attempt surface creation and queue row insertion. A
duplicate accepted bridge request with the same key returns the existing pending/running/completed
task-agent result when available, or waits on the same durable queue/turn state. It must not enqueue
another prompt for the same Smithers run/node/iteration/attempt/agent identity.

Queue implementation rules:

- Queue rows are claimed through `@svvy/state` transaction ports.
- Claiming a row and marking it `dispatching` is one transaction.
- The claim/mark-dispatching transition is a short uninterruptible section. Runtime restores
  interruptibility before generated-context refresh, pi turn execution, tool execution, extension
  handler invocation, generated-package build work, or any blocking wait.
- Claimable rows have `status` in `queued` or `steering`, `nextAttemptAt` absent or due, and no
  active unexpired claim lease. `@svvy/state` atomically orders eligible rows by `steering` rows
  first, then `request_user_input_answer` rows ahead of ordinary `user_message` rows, then priority
  `interactive > runtime > background`, then FIFO `sequence` inside the same `surfacePiSessionId`
  and `orderingKey`. State derives and stores the durable `orderingKey` when the row is enqueued.
  Runtime owns the policy that writes priority, steering facts, retry timing, cancellation state, and
  the typed queue item kind/payload before claim.
- Runtime uses Effect `Queue` only as a bounded wakeup channel after durable changes. Effect queues
  never hold authoritative prompt payloads, retry counters, or delivery state.
- `RuntimeSurfaceQueueDispatcherService` uses a coalesced bounded hint queue plus a process-local
  dirty-key set implemented only with manifest-adopted primitives. Producers enqueue only
  non-authoritative keys after the state transaction commits. The drain loop reads durable rows until
  empty, so correctness never depends on preserving every wakeup hint. `Queue.sliding` and
  `SynchronizedRef` require exact manifest promotion before production use.
- `RuntimeSurfaceQueueDispatcherService` is a scoped supervisor with an active-drain registry keyed
  by `(workspaceId, surfacePiSessionId, orderingKey)` and implemented only with manifest-adopted
  primitives. At most one drain fiber may run for a key at a time. A wake for an active key marks it
  dirty but does not fork another drain. The active drain owns the follow-up pass before clearing the
  key. A `FiberMap` implementation requires exact manifest promotion before production use.
- Runtime owns an internal surface queue dispatcher service:

  ```ts
  type QueueWakeup = {
    workspaceId: WorkspaceId;
    surfacePiSessionId: SurfacePiSessionId;
    orderingKey: string;
    reason: "enqueue" | "steer" | "retry_due" | "lease_released" | "recovery";
  };

  type RuntimeSurfaceQueueDispatcherService = {
    acceptWakeHint(input: QueueWakeup): Effect.Effect<void, RuntimeContractError>;
    drain(input: {
      surfacePiSessionId: SurfacePiSessionId;
      orderingKey: string;
    }): Effect.Effect<void, RuntimeContractError>;
  };
  ```

  `RuntimeQueueWakeService` maps semantic committed-state reasons to dispatcher hints:
  `message-submitted -> enqueue`, `request-input-answer-queued -> enqueue`,
  `queue-steered -> steer`, and `runtime-queue-inserted -> enqueue`. Recovery, `retry_due`, and
  `lease_released` hints may be emitted only by runtime recovery and lease workers after reading
  due durable rows. No public or app-edge caller can construct `QueueWakeup` directly.

The target `RuntimeSurfaceQueueDispatcherService` is an internal runtime service, not a package-root
generic host adapter. It claims through state ports using `surfacePiSessionId` plus committed
`orderingKey`, owner id, and lease version, and it accepts wake hints only from
`RuntimeQueueWakeService` after committed state changes or recovery scans. Generic promise-host
dispatch helpers may exist only as test-only utilities and must not satisfy the target queue
delivery contract.

Wakeups are coalescible hints. `drain(...)` loops claim/process work until
`RuntimeQueueStatePort.claimNextQueuedSurfaceMessage(...)` returns `null`.
`acceptWakeHint(...)` adds the canonical key to the dirty set before offering it to the adopted
bounded wakeup queue. `drain(...)` clears a key only after the durable claim loop returns empty and
the key was not dirtied while active. If the key was dirtied while active, `drain(...)` runs one
follow-up durable claim pass before clearing it. If the yielded `Queue.offer(...)` result is `false`
after shutdown, runtime maps it to the typed shutdown/no-op path, not to an accepted wakeup.
Periodic recovery and lease-release work wake due retry/lease rows. Correctness
comes from durable queue rows, transactional claim order, and recovery scans, not from receiving
every in-memory wakeup value.

`queue_delivery` recovery rows use the same dirty-set semantics durably. A wake that arrives while
the existing `queue_delivery` recovery row for a surface is `claimed` records a new pending row with
the same logical idempotency key rather than treating the claimed row as the dedupe winner. When the
claimed drain completes, the pending row remains claimable and forces one follow-up drain.

- A claimed queue row remains owned by one app-runtime `RuntimeOwnerId` and `leaseVersion` until
  runtime marks it delivered, failed, cancelled, or explicitly releases the claim. If dispatch work
  between claim commit and pi acceptance can exceed the initial lease duration, runtime starts a
  scoped lease refresh fiber for that queue item at `queueClaimLeaseRefreshIntervalMs`. Each refresh
  is a compare-and-set using `queuedMessageId`, `ownerId`, current `leaseVersion`, and current
  nonterminal claim status; a failed refresh records retry/recovery facts or releases the claim
  according to the same queue failure policy instead of extending an unknown owner. Settlement
  methods must pass `ownerId` and
  `leaseVersion`; state rejects stale owners or stale lease versions. A lease expiry may make the
  row claimable only after recovery releases or requeues it according to persisted attempt facts.
- Delivery order is: resolve the owning surface scope, acquire the surface prompt lock, confirm that
  no turn is currently active for the surface, claim the durable queue row and mark it
  `dispatching`, commit that claim, refresh stale generated context if required by invalidation state
  and opted in for that surface, prepare the exact turn-start input from the materialized queue
  message and target surface, create and commit the turn record, send the user/control message to
  `@svvy/pi-adapter` for pi acceptance, then settle the queue row from the pi accept/delivery
  outcome.
- Delivery into pi occurs only after a successful claim commit.
- Successful delivery and failed delivery are recorded transactionally.
- Active turns are keyed by `surfacePiSessionId` in the process-local active turn manager. Queue
  delivery under the surface prompt lock checks both durable active-turn state and a package-private
  process-local active-turn registry implemented only with manifest-adopted primitives. Any
  `FiberMap.run(..., { onlyIfMissing: true })` implementation requires manifest promotion first. An
  already-active result maps to a typed busy/requeue outcome without claiming another row or
  interrupting the existing turn.
  Blocking request-input keeps the turn fiber and prompt lock until answer, timeout, cancel, or
  interruption. Terminal settlement removes the active fiber and releases the prompt lock exactly
  once.
- The active turn manager observes every active turn fiber exit through its package-private registry
  and maps it to exactly one terminal durable outcome: success commits completed turn/queue facts,
  typed failure commits the corresponding failed/cancelled/retryable facts, defects are normalized
  into app-log plus turn/queue recovery or terminal failure facts, and interruption commits
  cancellation/recovery facts according to the interrupt reason. The manager completes or fails
  waiters, settles stream generation, releases the prompt lock once, removes the active-fiber entry,
  and publishes invalidations only after the terminal transaction commits. A turn fiber exit is never
  ignored and never produces more than one terminal state transition. A `FiberMap` implementation
  requires exact manifest promotion before production use.
- Retry scheduling uses Effect `Schedule` paired with persisted retry facts, not in-memory counters
  only. Persisted queue/recovery rows include attempt count, last error, next attempt timestamp, and
  claim lease expiration when the work is claimable. Claiming increments persisted `attemptCount`
  and `leaseVersion`; expired lease release clears claim owner and lease fields without erasing
  attempt history. Newly enqueued surface rows default to
  `maxAttempts = queueRetryMaxAttempts` unless runtime writes a more specific value for a concrete
  product reason. If the queue row belongs to a bridge/task-agent operation with a stronger
  idempotency key, runtime may choose a higher max-attempt value explicitly in the row and tests
  must cover that product reason.
- Retry semantics distinguish pre-accept delivery failures from post-accept turn failures. A
  pre-accept failure may retry the same queue item when idempotency allows it. Once pi accepts the
  user message or begins the turn, later failure is a turn failure recorded against that turn and is
  not silently replayed as the same user message.
- Max-attempt policy is explicit in code and tests. If using `Schedule.recurs(n)`, tests document
  that `n` is the number of retries after the first attempt.
- Interruption during delivery records a recoverable state unless pi confirms terminal failure.
- Idempotency is keyed by durable queue item id plus target `surfacePiSessionId`.
- Runtime publishes `queue.changed` only after the related state commit.

Prompt-bearing turn program:

After a queue claim commits, runtime creates and commits the durable turn row before sending the
prompt-bearing item to pi. Runtime then starts one active turn fiber under the surface prompt lock
and receives `PiAdapterTurnStream` from `@svvy/pi-adapter`. Runtime consumes
`PiAdapterTurnStream.stream` as the sequential `Stream<PiRuntimeEvent, PiAdapterError>` for that
turn and owns explicit cleanup through the stream's `close()` and `closed` receipt. The stream
consumer is the only owner that may translate pi deltas into live `surface.stream` patches, streamed
tool argument snapshots, accepted tool calls, assistant output commits, turn terminal facts, queue
settlement, and recovery rows for that turn.

The turn program processes transcript-affecting pi events in stream order for one
`surfacePiSessionId`. It may run independent accepted tool calls concurrently only when pi has
accepted them as independent tool calls and the command/effect contracts prove their state writes do
not race. Final turn settlement commits queue, turn, transcript, and command terminal facts before
publishing read-model invalidations. A pi-accepted turn is never replayed as the same queue row
unless recovery can prove pi did not accept the message.

Blocking waits are represented as durable wait/request/approval/recovery facts plus active
in-memory `Deferred` handoffs for the currently running scope. `Deferred` values are single-use
coordination gates only; restart, rebaseline, timeout, and recovery are driven from persisted facts
and `Clock`/`Schedule` deadlines.
Runtime owns one package-private `RuntimeWaitRegistry` for process-local wait handoffs. Entries are
keyed by durable wait id and include wait kind, owning `surfacePiSessionId`, owning command/turn id,
timer version when applicable, a scoped single-use `Deferred`, and the scope that owns its cleanup.
The registry may contain request-input and approval waits, but it is never the source of truth. It
is a runtime-owned internal service, not a durable wait store and not a state
port. Durable wait entries live in `RuntimeSessionWaitStatePort`, `RuntimeRequestStatePort`,
`RuntimeApprovalStatePort`, and `RuntimeCommandStatePort` rows. The registry contains only live
handoff resources needed to resume an already accepted command: `Deferred`s, timeout fibers,
current timer versions, owner ids, and close finalizers. Runtime may recreate or complete registry
entries only after reading durable wait state; no UI, desktop bridge, state facade, or extension
handler may read or mutate the registry directly. Every resolution path first commits the durable
wait transition through state ports, then resolves the live `Deferred` only if the committed version
still matches the registry entry.

Runtime owns one package-private `RuntimeRecoveryCoordinator` for durable recovery work. It is a
scoped service acquired by `Runtime.layer`, not a public facade group and not a renderer/browser-tool
surface:

```ts
interface RuntimeRecoveryCoordinator {
  wake(input: {
    scope: RecoveryWorkScope;
    kind?: RecoveryWorkKind;
    reason: "startup" | "lease-expired" | "row-created" | "manual";
  }): Effect.Effect<void, RuntimeContractError>;

  drain(input: {
    scope: RecoveryWorkScope;
    orderingKey?: string;
  }): Effect.Effect<RuntimeRecoveryDrainReceipt, RuntimeContractError>;
}

type RuntimeRecoveryDrainReceipt = {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  blocked: number;
  nextScanAt: IsoDateTimeString | null;
};
```

`wake(...)` is nonblocking scheduling intent after a committed state row or startup scan. `drain(...)`
is used by tests, shutdown preparation, and controlled startup readiness. Both methods acquire work
only through state recovery ports, normalize failures into `StateStoredError`, and publish
read-model invalidations only from committed after-commit descriptors.

Cancellation semantics:

- `AbortPromptInput.mode` selects exactly one cancellation path. `mode: "queued"` cancels only the
  addressed queued row. `mode: "active-turn"` interrupts the current active turn for the target; if
  `turnId` is omitted, runtime proceeds only when exactly one active turn exists for that
  `surfacePiSessionId`. `mode: "all-for-surface"` cancels queued rows for the addressed surface and
  interrupts the active turn owned by that same surface, if present.
- queued and unclaimed items are marked `cancelled` transactionally
- claimed but not pi-accepted items release or expire their claim lease and record the cancellation
  reason
- pi-accepted turns ask `@svvy/pi-adapter` to interrupt the active turn stream, then terminalize the
  turn from the resulting pi/adapter outcome
- active-turn cancellation first marks the active turn/commands as cancellation-requested through
  state ports, publishes only committed invalidations, interrupts the active turn `FiberMap` entry
  and any accepted-tool fibers, asks `@svvy/pi-adapter` to abort the scoped turn stream, waits for
  the adapter outcome or cancellation timeout, then commits the terminal turn/queue/command facts.
  If the process dies after the cancellation-requested commit, recovery sees the durable request and
  terminalizes or retries according to the active-turn recovery policy.
- terminal commands ignore late callback/output events except for app-log diagnostics
- closing a surface interrupts active turn fibers, queue wakeups, event subscriptions, request-input
  waiters, and helper jobs owned by that surface scope
- closing a workspace interrupts every child surface/workflow/task/title/recovery scope for that
  workspace

## Runtime Reliability Policy

Runtime reliability policy is lane-specific and closed. Runtime never lets foreign package errors,
raw `Cause`, thrown objects, process exceptions, pi-native errors, or extension errors cross a
public runtime or facade boundary directly.

### Error Normalization Matrix

| Source failure                                                                  | Runtime lane                                                                | Public mapping                                                                                                         | Durable/app-log handling                                                                                                     |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `StateContractError.reason === "invalid-input"`                                 | any public method before state mutation                                     | `RuntimeContractError` with the method operation and reason `"invalid-input"`                                          | no recovery row; app-log only when the caller is not the user-facing source of the invalid payload                           |
| `StateContractError.reason === "not-found"` / stale owner or lease              | lifecycle, queue, command, request-input, recovery                          | `target-not-found` or `stale-state` according to the method ledger                                                     | no retry unless a recovery row already owns the stale durable condition                                                      |
| transient SQLite busy/locked, transaction contention, or state commit conflict  | queue claim, command settlement, source/generation commit, recovery         | `state-conflict` for synchronous public calls; worker lanes record retryable `StateStoredError`                        | retryable when idempotency key and lane policy permit; otherwise terminal failed fact                                        |
| `PiAdapterError` before pi accepts a prompt-bearing item                        | queue delivery / surface materialization                                    | `target-not-ready`, `state-conflict`, or `runtime-shutdown` only when the ledger names that reason                     | queue row may retry pre-accept; surface lifecycle failure is recorded through surface/recovery/app-log facts                 |
| `PiAdapterError` after pi accepts a turn or while consuming the pi event stream | active turn fiber                                                           | not returned to the original submit caller; active turn terminalizes as failed/cancelled/recoverable                   | turn, queue, command, and recovery facts record the normalized `StateStoredError`                                            |
| `ExtensionError` from declaration build or accepted tool handler                | generated-context refresh, native tool declaration, accepted tool execution | mapped to ledger reason `schema-error`, `unsupported-operation`, `target-not-found`, or `state-conflict` as applicable | command/tool facts and app-log diagnostics are committed; extensions do not publish runtime events directly                  |
| `SandboxPolicyError` or sandbox launch denial                                   | command/session execution                                                   | command terminal facts, not a public `RuntimeContractError.reason`                                                     | command facts include sandbox-denial classification and redacted policy path facts; no retry unless policy source changes    |
| child-process spawn/stdio/exit errors                                           | command/session execution                                                   | command terminal facts, not raw process errors on public facades except command-control admission errors               | stdout/stderr facts flush before terminal settlement; recovery row only when process state is ambiguous                      |
| schema decode/encode failure for persisted JSON or generated transport payloads | bridge, recovery, source/generation, command signed-result transport        | `invalid-input`, `schema-error`, or closed bridge error according to the lane                                          | redacted `StateStoredError` plus app-log diagnostic; no retry unless the payload source is mutable and a new scan can fix it |
| app/runtime shutdown or disposed runtime                                        | any lane                                                                    | `runtime-shutdown` or `runtime-disposed`                                                                               | shutdown preparation records visible cancellation/recovery receipts before scope finalizers release resources where possible |

Every mapping above preserves the originating package error tag, operation, reason, and redacted
message inside `StateStoredError.cause` or app-log details when durable diagnostics are required.
The user-visible `RuntimeContractError.message` must be derived from the runtime operation and
closed reason, not from an unredacted foreign error string.

### Cause Classification

Runtime has one package-private cause classifier used by facade runners, worker-fiber supervisors,
active-turn exit observers, command-session supervisors, and accepted-tool runners:

```ts
type RuntimeCauseClassification =
  | { kind: "typed-failure"; error: RuntimeContractError | RuntimeEventError }
  | { kind: "foreign-typed-failure"; stored: StateStoredError; mapped: RuntimeContractError }
  | { kind: "defect"; stored: StateStoredError; facade: RuntimeFacadeErrorContract }
  | {
      kind: "interrupted";
      interruptReason: "caller-abort" | "runtime-cancel" | "shutdown" | "scope-close";
    };
```

The classifier inspects the full Effect v4 `Cause`, including mixed fail/die/interrupt cases. If a
cause contains an interrupt and a typed failure, the owner lane decides from its committed durable
state whether the result is terminal failure, cancellation, or recoverable ambiguity; it does not
drop either reason. Defects are programming defects or impossible states only. Runtime records a
redacted defect app-log entry and either terminalizes the affected command/turn/recovery row or
creates a recovery row before exposing a facade `reason: "defect"` result. Worker-fiber defects do
not escape as unhandled detached promises.

### Facade Abort And Runtime Cancellation

`cancel-wait-only` is implemented by interrupting only the facade runner fiber or bridge callback
waiting on the result. The underlying runtime-owned effect continues under its owning surface,
workspace, command, or app scope. The facade must not implement this by racing an unrelated Promise
against an abort listener while the Effect fiber remains unobserved. Facade implementations keep the
underlying runtime run observed through `runPromiseExit(...)` and close only the caller wait/callback
for `cancel-wait-only`; they pass the caller `AbortSignal` into the runtime run only for APIs whose
facade policy is `request-runtime-cancel`. If the owner-managed effect later commits state, it
publishes ordinary runtime events and app-log facts.

Runtime cancellation APIs (`messages.abort`, `commands.cancel`, and subscription `close`) are
separate durable requests. When cancellation requires a host operation that may not settle, such as
pi turn interruption, stream cleanup, child-process graceful termination, or subscription drain,
runtime uses a bounded owner-lane timeout from `RuntimeLayerConfig`. Timeout does not mean success:
runtime records a cancellation-recovery fact or command/process reconciliation row before returning
or completing the worker receipt.

### Retry Schedules

Runtime retries use Effect `Schedule` for timing and durable state rows for truth. No retry policy
depends only on in-memory counters. Startup/runtime reacquisition retry is not `Layer.retry`;
app/bootstrap disposes a failed `ManagedRuntime`, then constructs a new root layer/runtime under a
bounded startup schedule. A layer-level retry API may be introduced only after an installed Effect
v4 export audit proves the exact API exists and the package spec names its scope/finalizer behavior.

| Lane                                              | Retryable reasons                                                                                            | Non-retryable reasons                                                              | Schedule source                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| queue delivery before pi acceptance               | transient state conflict, pi target temporarily unavailable, generated-context refresh retryable failure     | invalid input, target deleted, user cancellation, pi accepted the message          | `queueRetryInitialDelayMs`, `queueRetryMaxDelayMs`, `queueRetryMaxAttempts`    |
| active turn after pi acceptance                   | none as same-message replay; recovery may reattach or terminalize                                            | pi accepted prompt then failed, defect after committed turn                        | `active_turn_recovery` row, not queue retry                                    |
| source reconcile / generated context refresh      | transient filesystem/read errors, transient generated-package build dependency readiness                     | schema-invalid source, deleted source, stale save conflict                         | `sourceRetryInitialDelayMs`, `sourceRetryMaxDelayMs`, `sourceRetryMaxAttempts` |
| generated-package refresh / workspace link repair | transient filesystem/package-link errors, missing generated output while another app-global build is pending | schema-invalid generated source, unapproved dependency, deleted workspace          | recovery retry config plus per-kind `orderingKey`                              |
| command process reconciliation                    | ambiguous process state, transient state write conflict                                                      | observed terminal process exit already committed, sandbox denied by current policy | recovery retry config                                                          |
| title generation                                  | transient provider/pi helper failure                                                                         | deleted surface, unsupported model, user-disabled title generation                 | title worker schedule plus terminal title-job facts                            |
| request-input / approval wait recovery            | missed timer wake, state conflict, runtime restart                                                           | answered/denied/cancelled terminal row, owning surface deleted                     | recovery retry config with `notBefore` from timeout/deadline                   |
| worker restart                                    | worker fiber defect or typed transient failure after durable recovery fact exists                            | repeated startup scan failure beyond max attempts, configuration invalid           | bounded supervisor schedule; readiness fails only for required startup rows    |

### Runtime Observability

Runtime services may append durable product app-log facts only through the core-owned
`AppLogWritePort` implementation backed by `@svvy/state`, after redaction. Metrics stay separate.
Observability is not a second state channel and does not carry raw prompts, secrets, full
stdout/stderr, unredacted schema payloads, or renderer snapshots.

| Runtime lane                   | Span/metric boundary                                       | App-log facts                                                               | Required span/log/app-log annotations                      |
| ------------------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| queue claim/delivery           | claim attempt, delivery attempt, terminal settlement       | retry/failed/cancelled delivery, stale lease, repeated worker failure       | workspace id, surface kind, queue row kind, reason         |
| pi turn execution              | turn start, pi stream consumption, terminal settlement     | pi adapter failure, defect, recovery row creation, stale generated context  | actor kind, surface kind, model provider id, closed reason |
| accepted native-tool execution | accepted tool call, handler result, operation application  | handler failure, invalid runtime operation, no direct extension state write | extension id, tool name, command id, reason                |
| command lifecycle              | spawn, stdout/stderr pump, stdin write, cancel, terminal   | sandbox denial, spawn failure, terminal failure, cancellation timeout       | command kind, sandbox mode, exit class, reason             |
| source/generation/recovery     | scan/build/link attempt, recovery claim, terminal recovery | source diagnostics, build failure, recovery blocked/failed/completed        | recovery kind, source kind, generated package name, reason |
| shutdown                       | prepare, drain, forced close, finalizer completion         | interrupted visible work, recovery receipts, timeout forcing scope release  | scope kind, owner id/link, shutdown reason                 |

Metrics are low-cardinality counts/durations/gauges matching the lane and outcome classes above,
but the table's annotation column is not a metric-label allowlist. Metric attributes remain limited
to the Effect observability catalog in `effect-v4.spec.md`: package, operation, status, reason
class, and similarly finite enumerations explicitly approved by a metric catalog entry. Workspace,
session, surface, thread, turn, command, queue, request, artifact, provider, model, extension,
tool, generated-package, and owner ids may appear only as span/log annotations, app-log related
links, command facts, or state-backed read-model fields after redaction. They must not be metric
attributes even when hashed. Raw command output stays in command-output/artifact state, not in
metrics, logs, or spans.

Runtime uses the core-owned `SvvyObservationAnnotation` and `AppLogRelatedLink` schemas as the exact
encoded observation boundary. Product ids in app-log rows are internal product links or schema-backed
observation annotations, not custom `*_hash` keys. External telemetry exporters may hash or drop
those ids at the app/bootstrap export edge, but the hash is an exporter transformation and is never a
new runtime/state/app-log contract unless `@svvy/core` adds the exact schema key. App-log `details`
are owner-redacted before calling `AppLogWritePort`; `AppLogWritePort` validates shape and storage
contracts, while the app-log writer service that creates each input owns the source-specific allowlist
for `details`, `normalizedError`, `related`, and `idempotencyKey`. Runtime app-log writes are
diagnostic records unless the owning method contract explicitly says the app-log row is a
required durable state transition; required state transitions are represented by state ports and
recovery facts, not by relying on diagnostic app-log persistence.

## Recovery Work Contract

Runtime recovery work is durable state claimed by `@svvy/runtime` and stored by `@svvy/state`.
Effect fibers, queues, schedules, and event replay are never the authoritative recovery source.

```ts
type RuntimeRecoveryWork = {
  id: RecoveryWorkId;
  scope: RecoveryWorkScope;
  kind: RecoveryWorkKind;
  status: "pending" | "claimed" | "blocked" | "completed" | "failed" | "cancelled";
  ownerScope: RuntimeRecoveryWorkOwnerScope;
  priority: "interactive" | "runtime" | "background";
  orderingKey: string;
  idempotencyKey: string;
  payload: RecoveryWorkPayloadByKind[RecoveryWorkKind];
  notBefore: IsoDateTimeString;
  claimOwnerId: RuntimeOwnerId | null;
  claimedAt: IsoDateTimeString | null;
  claimLeaseExpiresAt: IsoDateTimeString | null;
  leaseVersion: number;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: IsoDateTimeString | null;
  lastError: StateStoredError | null;
  cancellationReason: "runtime_shutdown" | "source_deleted" | "superseded" | "user" | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  completedAt: IsoDateTimeString | null;
  failedAt: IsoDateTimeString | null;
  cancelledAt: IsoDateTimeString | null;
};
```

```ts
type RecoveryWorkKind = CoreRecoveryWorkKind;

type RecoveryWorkScope = { kind: "app" } | { kind: "workspace"; workspaceId: WorkspaceId };

type RecoveryWorkPayloadByKind = {
  source_reconcile: SourceReconcileRecoveryPayload;
  generated_package_refresh: RefreshGeneratedPackagesRequest;
  workspace_generated_package_link_repair: Extract<
    InternalRefreshGeneratedPackagesRequest,
    { scope: "workspace-link-repair" }
  >;
  generated_context_refresh: RefreshGeneratedContextRequest;
  queue_delivery: QueueDeliveryRecoveryPayload;
  active_turn_recovery: ActiveTurnRecoveryPayload;
  workflow_task_attempt_recovery: WorkflowTaskAttemptRecoveryPayload;
  artifact_materialization: {
    workspaceSessionId: WorkspaceSessionId;
    artifactId?: ArtifactId | null;
    sourceCommandId?: CommandId | null;
    storedPath?: AbsolutePath | null;
    stagedPath?: AbsolutePath | null;
    expectedSha256?: string | null;
    expectedByteSize?: NonNegativeSafeInteger | null;
    operation:
      | "finalize-promoted-file"
      | "cleanup-staged-file"
      | "cleanup-orphan-ready-file"
      | "retry-delete-file";
  };
  command_process_reconciliation: RuntimeCommandSessionReconcileInput;
  title_generation: TitleGenerationRecoveryPayload;
  request_input_wait: RequestInputWaitRecoveryPayload;
  approval_wait: ApprovalWaitRecoveryPayload;
};
```

The concrete union is imported from `@svvy/core`. Runtime docs may discuss per-kind behavior, but
runtime must not define a second recovery-kind string union.

Rules:

- `kind` determines the payload schema. Payloads are decoded with hoisted core/state schemas before
  any work starts.
- Each kind owns one hoisted schema-backed payload. `source_reconcile` is used when source edits,
  startup, watcher debounce, periodic scans, manual repair, or recovery must rescan file-backed
  source. `generated_package_refresh` is app-global build/manifest work.
  `workspace_generated_package_link_repair` is workspace-scoped link repair after an app-global
  generated-package facts commit.
- `orderingKey` serializes recovery that must not race for the same workspace, surface, command,
  workflow task attempt, generated package, request-input row, or title job.
- `idempotencyKey` prevents duplicate recovery rows for the same durable condition.
- Claims, lease refresh, retry scheduling, terminal status updates, and event publication happen
  through state transaction ports.
- `queue_delivery` recovery wakes the queue dispatcher for claimable queue rows; it does not copy
  queue payloads into recovery payloads.
- `active_turn_recovery` inspects persisted turn/command/surface state and either reattaches to live
  pi state when available or terminalizes/requeues only through the explicit queue/turn rules.
- `workflow_task_attempt_recovery` restores or terminalizes task-attempt surfaces and generated
  context binding from durable workflow task-attempt facts.
- `generated_context_refresh` and `generated_package_refresh` carry the same core refresh request
  payloads exposed by runtime service methods and extension `RuntimeEffectRequest` values.
- `title_generation`, `request_input_wait`, and `approval_wait` recover persisted jobs/waits from
  state rows, not in-memory `Deferred` values.
- `command_process_reconciliation` records facts for command processes whose state is ambiguous
  after interruption or restart; it does not invent output not observed through command streams or
  durable command facts.
- A completed, failed, or cancelled recovery row is terminal. Late duplicate workers may record
  diagnostics but must not rewrite terminal facts.

Main-flow recovery points:

| Last durable point                                      | Recovery behavior                                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| queue row committed, not claimed                        | `queue_delivery` wakes/drains the surface queue; no prompt text is copied into recovery payloads                                                                                   |
| row claimed/dispatching before pi acceptance            | release, retry, fail, or cancel the queue row by owner/lease facts; do not create a transcript message                                                                             |
| pi accepted message / turn row active                   | `active_turn_recovery` reattaches when live pi state exists, otherwise terminalizes the turn or records recovery; it does not replay the same user message as a new queue delivery |
| streamed tool command exists without accepted execution | terminalize dangling streamed command facts as failed/cancelled during turn cleanup                                                                                                |
| accepted tool or execution plan running                 | command/process recovery reconciles observed output and terminal state; it never invents output or lets extension code repair state directly                                       |
| runtime effect request partially applied                | idempotent recovery resumes from committed facts and operation idempotency keys; already terminal facts are immutable                                                              |
| state commit succeeded but notification was missed      | no state rollback; consumers rebaseline from state read models and runtime may publish later invalidations only from committed descriptors                                         |
| UI missed or dropped events                             | UI refetch/rebaseline only; no runtime recovery row is created solely for a renderer cache miss                                                                                    |

## RuntimeEffectRequest Values

Extension handlers may return declarative runtime operations. A runtime effect operation wraps one
`RuntimeEffectRequest`, which is defined in `@svvy/core`. Runtime is the only package that applies
it.

Trusted `svvyx` subprocess results are handled inside the parent runtime command-session pipeline.
There is no public `@svvy/runtime/sidecar` subpath and no separate runtime facade for replay.
Runtime validates the signed subprocess result, decodes core schema-backed
`SvvyxRuntimeEffectTransportRequest` values, and applies only
`extension_usage.context_impact` and `extension_snapshot.context_impact` requests through
runtime-owned services and `@svvy/state` ports. Any additional transport request kind requires a
core-owned schema, runtime-owned apply path, package-boundary tests, and source-of-truth spec
updates before it can be accepted. The replay path returns patched command facts/output to the
owning command session and does not own subprocess launch, profile snapshot mutation, artifact
replay, or UI notification publication outside the normal command-session flow.

When an extension handler returns more than one runtime operation, the handler result carries an
ordered runtime-operation list whose items are
`{ kind: "runtime_effect", request: RuntimeEffectRequest }` or
`{ kind: "execution_plan", plan: ExtensionExecutionPlan }`. Runtime processes that list
sequentially in the owning command lane unless a specific operation contract declares safe
independent execution. Each item must either commit its state/facts or record durable
recovery/failure before the next item starts. Partial completion is represented by committed command
facts plus recovery rows, never by replaying the handler or by extension-owned compensating writes.

Rules:

- Runtime validates ordering and target identity before applying a request.
- Runtime derives `workspaceId` from `workspaceSessionId` or the validated `RuntimeSurfaceTarget`.
  Runtime-effect operation items do not introduce a second caller-provided workspace id.
- State mutations happen through state transaction ports.
- Runtime events publish only after state commits.
- Extensions cannot request arbitrary event publication. Runtime derives events from applied
  requests, pi stream patches, command lifecycle updates, and after-commit invalidation descriptors.
- Queue and surface requests never execute immediately inside extension code.
- `generated_packages.refresh` requests enter runtime scheduling and recovery, then call the
  `@svvy/extensions` generated-package refresh service at the ordered boundary. Runtime maps refresh
  requests to `GeneratedPackageBuildInput` before calling extensions. Refresh returns build
  status/evidence only. Runtime separately calls `Extensions.generatedPackages.planWorkspaceLink(...)`
  for each acquired workspace/package repair target and applies the returned declarative plan itself.
- `RuntimeEffectRequest` application is an internal runtime service lane. Extension handlers return
  `ExtensionRuntimeOperation` items wrapping the closed request algebra; runtime validates, orders,
  transactionally applies wrapped requests, records command facts, receives after-commit descriptors,
  and publishes runtime notifications. Extension handlers never call runtime service methods
  directly.
- Runtime assigns a deterministic `RuntimeOperationExecutionId` to every returned
  `ExtensionRuntimeOperation` before applying it:
  `runtime-operation:<commandId>:<handlerResultSequence>:<operationIndex>:<operationKind>:<stableTargetId>`.
  The id is the state idempotency/recovery key for the operation. `handlerResultSequence` is the
  runtime-owned sequence of the committed handler result for the command, `operationIndex` is the
  zero-based index inside the returned operation array, `operationKind` is the closed operation
  variant, and `stableTargetId` is the canonical durable target id named by the operation
  (`queuedMessageId`, `threadId`, `requestId`, generated package id, or an explicit core-defined
  stable target for variants that allocate new rows). Recovery resumes from committed operation
  facts and never re-invokes the extension handler to rediscover operations.
- The target `@svvy/runtime` application lane promotes every state-backed `RuntimeEffectRequest`
  variant and scope listed in `@svvy/core`. Unknown variants fail core schema decode. Runtime is
  incomplete, not correctly narrowed, if a decoded target variant or state-backed scope fails only
  because its applier, transaction ports, command fact contract, failure mapping, or event
  invalidation contract is not owned by the package-owned runtime/state boundary. A branch that has
  no product state model must not be decoded by `@svvy/core`.
- Every decoded `RuntimeEffectRequest` variant in `@svvy/core`, including `handler_thread.start`,
  has a runtime-owned applier. A decoded target variant reaching a default unsupported branch is an
  implementation defect, not a valid runtime status.
- Desktop pane creation is never a `RuntimeEffectRequest`.
- The algebra is closed; adding a new variant requires a core/runtime contract update and tests.

RuntimeEffectRequest application matrix:

| Variant                          | Runtime applier lane                                                                                                                                                                                                                  | State/product facts touched                                                                                                                                                                                                                                                                                                                                    | Required notification behavior                                                                                                                                                                                                                                                                                                                                     | Required tests                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler_thread.start`           | handler-thread lifecycle service under the owning orchestrator command context; enriches one full `threads[]` batch and commits it through `RuntimeThreadStatePort.startHandlerThreads(...)` atomically                               | state-owned commit: one or more handler-thread rows, one generated-context binding row per thread, one `initial_handler_start` queue row per thread with `sourceCommandId`; runtime/pi-adapter-owned preparation: handler pi surface/session allocation, profile/override resolution, generated context, forked-history queue payloads, command terminal facts | publish thread/session/navigation/read-model invalidations after the state transaction commits; wake each target handler surface queue through the runtime queue-insert post-commit lane after commit with `RuntimeQueueWakeService.wakeSurface({ target, reason: "message-submitted" })`; return applied committed ids for final `ThreadStartResult` construction | schema decode, multi-thread batch atomicity, generated-context binding, forked-history payload placement, command linkage on queue rows, `sourceCommandId` replay idempotency, exact wakeup-after-commit, no per-thread split effects |
| `queue.insert`                   | queue insertion service under the active command/turn context                                                                                                                                                                         | one durable queue row for allowed internal runtime queue-control kinds only, source command id, idempotency key, queue ordering facts                                                                                                                                                                                                                          | publish `queue.changed` and affected read-model invalidations after commit; wake only the addressed surface queue with `RuntimeQueueWakeService.wakeSurface({ target, reason: "runtime-queue-inserted" })`                                                                                                                                                         | kind/payload match, idempotent replay, source command linkage, answer-row precedence, exact `runtime-queue-inserted` wakeup-after-commit, no ordinary `user_message` insertion from extension-produced effects                        |
| `actor_extension_binding.update` | `RuntimeActorExtensionBindingStatePort.updateActorExtensionBinding(...)` plus target generated-context refresh scheduling; read-only `readRuntimePromptBinding(...)` is prompt-dispatch state read, not a runtime-effect applier lane | current orchestrator or handler actor surface binding rows and generated-context freshness/stale facts; no workflow-task target and no profile-default mutation                                                                                                                                                                                                | publish Agents/Extensions/surface stale/read-model invalidations after commit; never rewrite an active turn context mid-turn; require source-invalidation refresh service before mutating binding state                                                                                                                                                            | loaded/available/unavailable validation, target validation, ready-extension validation, stale fingerprint marking, opted-in pre-dispatch refresh scheduling, no profile default writes                                                |
| `episode.record`                 | `RuntimeEpisodeStatePort.recordHandlerThreadEpisode(...)` for `scope: "handler-thread"` only                                                                                                                                          | handler-thread episode row, thread/group summary facts, optional command/thread report linkage; outcome-bearing requests conclude the handler thread through the same state boundary                                                                                                                                                                           | publish thread episodes/read-model invalidations after commit; schedule orchestrator reconciliation only when the episode outcome requires it                                                                                                                                                                                                                      | episode kind validation, handler ownership, thread-group ownership, conclusion ordering, duplicate/idempotency behavior                                                                                                               |
| `request_input.create`           | request-input accepted-tool service                                                                                                                                                                                                   | request/question/option rows, default answer derivation facts, nonblocking default answer records, blocking wait records, command progress/wait/settlement facts through `RuntimeCommandStatePort`                                                                                                                                                             | publish request-input/read-model/command invalidations after commit; for later nonblocking user answers, `runtime.requestInput.answer` may enqueue `request_user_input_answer` and wake after commit                                                                                                                                                               | option/default validation, blocking timeout, nonblocking default result, user answer queue delivery, command settlement                                                                                                               |
| `generated_context.refresh`      | runtime-owned generated-context refresh service/worker                                                                                                                                                                                | recovery row or immediate refresh work, generated-context build facts, surface binding/stale facts when the safe boundary refresh commits                                                                                                                                                                                                                      | publish generated-context, Agents/Extensions, and affected surface stale/read-model invalidations after commit; no generated preview payload in events                                                                                                                                                                                                             | safe-boundary scheduling, opt-out stale surface behavior, invalid source keeps previous ready context, failure diagnostics                                                                                                            |
| `generated_packages.refresh`     | `RuntimeGeneratedPackageRefreshService` for app-global refresh and workspace link repair through `RuntimeGeneratedPackageRefreshHostPort` primitives                                                                                  | generated-package build/recovery rows, manifest/build facts committed through `RuntimeGeneratedPackageStatePort.recordGeneratedPackageBuild(...)` / `recordGeneratedPackageFailure(...)`, workspace link facts committed through `RuntimeGeneratedPackageStatePort.recordWorkspaceLinkStatus(...)`                                                             | publish generated-package, Workflows/Extensions, link-status, diagnostics, and affected workspace read-model invalidations after commit; wake acquired workspace link-repair workers only after app-global build commit                                                                                                                                            | dependency order `@svvyx/extensions` before dependent `@svvyx/workflows`, app-global once per build, unopened workspace repair recovery, failure keeps prior ready package active                                                     |

`RuntimeQueueInsertPostCommitLane` is a runtime-owned queue wakeup boundary used only after
`queue.insert` has committed the queue row through `RuntimeQueueStatePort` and
`RuntimeEventBus.publishStateInvalidations` has accepted the committed invalidations. Runtime owns
this ordering. The applied-effect post-commit lane may know the committed queue item id and kind as
runtime-local facts for logging, recovery, and state-port coordination, but any host wake receives
only the addressed surface target and a closed primitive wake reason. It may wake the addressed
queue lane, but it must not receive queued-row payloads, `queuedMessageId`, queue item kind,
dispatch results, pi session handles, callback functions, state-port results, renderer snapshots, or
live turn state. It must not insert queue rows, publish runtime events, mutate state, materialize pi
prompts, change the applied-effect result, or inspect renderer state. Queue workers and pi turn
dispatch are runtime-owned services that re-read authoritative queue state before claiming work.

Every matrix row is a public runtime behavior and must have a runtime-owned applier that commits
the required state facts before publishing events. A decoded variant that lacks an applier, writes
only command facts, publishes events before state commit, returns a result without committed state
facts, or relies on a desktop/catalog adapter to complete the work is outside the shipped contract.
`handler_thread.start` is accepted only through `RuntimeAcceptedNativeToolExecution` and a
runtime-owned handler-thread preparation service; unsupported preparation paths are composition
failures and cannot produce a shipped `thread_start` result.

## Accepted Native Tool Operations

Accepted native tool execution is runtime-owned. The pi-adapter's turn-scoped custom-tool bridge is
a runtime-supplied callback for the active pi turn; `@svvy/pi-adapter` does not import
`@svvy/runtime`, hold runtime services, or route accepted tools by itself. That callback enters the
package-private accepted native-tool runner and receives only the model-facing tool result. App, UI,
desktop, browser-tool, and headless adapters submit messages and command-control requests through
public runtime facades; they do not submit accepted tool calls, invoke extension handlers, apply
runtime operations, decode extension command facts, write command lifecycle rows, or write
tool-owned durable state directly. Runtime allocates or reuses the product command envelope,
decodes accepted arguments, dispatches to either a runtime-owned built-in runner or an extension
handler according to the accepted tool identity, applies `RuntimeEffectRequest` values when a
handler returns them, persists command lifecycle and tool-owned durable facts through state ports,
and publishes events after commit.

Package-private accepted native tool execution service:

The concrete methods below show named control-tool operations, not an exhaustive list of accepted
native-tool families. The runtime-owned accepted-tool path covers every model-callable native tool:
`exec_command`, `write_stdin`, `apply_patch`, `execute_typescript`, `list_extensions`,
`load_extension`, `request_user_input`, `thread_start`, read-only thread state tools, and generated
extension-facade child commands. `RuntimeAcceptedNativeToolExecution` is the current named
package-private service for control tools whose output is driven by runtime-effect application.
Command/file-effect families enter their own runtime-owned command/session/execution lanes with the
same command-state, approval, launch-policy, event-publication, and state-port constraints. Adding a
native tool that allocates command state, invokes an extension handler, applies runtime effects, or
publishes notifications outside a runtime-owned accepted-tool lane is a package-boundary violation.

```ts
type RuntimeAcceptedNativeToolExecutionService = {
  acquireDirectToolLaunch(
    input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
      toolName: "exec_command" | "apply_patch" | "execute_typescript";
    },
  ): Effect.Effect<SandboxLaunchFacts, RuntimeContractError, Scope.Scope>;

  runLoadExtension(
    input: RunAcceptedLoadExtensionThroughRuntimeInput,
  ): Effect.Effect<RunAcceptedLoadExtensionToolCallResult, RuntimeContractError>;

  runRequestUserInput(
    input: RunAcceptedRequestUserInputToolCallInput,
  ): Effect.Effect<RunAcceptedRequestUserInputToolCallResult, RuntimeContractError>;

  runThreadStart(
    input: RunAcceptedThreadStartToolCallInput,
  ): Effect.Effect<RunAcceptedThreadStartToolCallResult, RuntimeContractError>;
};
```

`RuntimeAcceptedNativeToolExecution` is package-private accepted native-tool execution context. It
is provided by `Runtime.layer` for runtime/pi turn composition, but it is not exported from
`@svvy/runtime`, not exported from `@svvy/runtime/bootstrap`, and not part of `Runtime.commands` or
`createRuntimeFacade(...)`. Generic accepted-tool dispatch, streamed argument append, and dangling
tool-call terminalization remain internal service responsibilities unless a concrete runtime service
implements them and this spec names their exact contracts. Public `Runtime.commands` remains
desktop/headless command control only. Pi-adapter accepted tool callbacks enter runtime through the
package-private execution context. App/bootstrap accepted native-tool entry points use only
`@svvy/runtime/accepted-native-tool-execution`, whose public API is:

```ts
type AcceptedDirectToolLaunchHandle = {
  facts: SandboxLaunchFacts;
  close(): Promise<void>;
};

type AcceptedDirectToolLaunchInput = Parameters<
  RuntimeAcceptedNativeToolExecutionService["acquireDirectToolLaunch"]
>[0];
type AcceptedDirectToolApprovalInput = Parameters<
  RuntimeAcceptedNativeToolExecutionService["requestDirectToolApproval"]
>[0];
type AcceptedDirectToolApprovalDecision = RuntimeDirectToolApprovalDecision;

function acquireAcceptedDirectToolLaunch<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: AcceptedDirectToolLaunchInput,
): Promise<AcceptedDirectToolLaunchHandle>;

function requestAcceptedDirectToolApproval<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: AcceptedDirectToolApprovalInput,
): Promise<AcceptedDirectToolApprovalDecision>;

function runAcceptedLoadExtension<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: RunAcceptedLoadExtensionThroughRuntimeInput,
): Promise<RunAcceptedLoadExtensionToolCallResult>;

function runAcceptedRequestUserInput<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: RunAcceptedRequestUserInputToolCallInput,
): Promise<RunAcceptedRequestUserInputToolCallResult>;
```

That subpath adapts an existing runtime instance to the app edge only. It does not create a runtime,
hold its own singleton services, expose the service tag, expose the service interface, expose the
service layer, call extension handlers directly from app code, expose state command ports, or add a
desktop/headless facade group.
Direct-tool approval input for a normal Shell, Apply Patch, or Execute TypeScript action describes
the tool request itself. The approval-boundary request `context` field is edge metadata: Execute
TypeScript may include prompt execution context there for app-edge approval UI and logs, while
runtime persists only closed approval-record context variants that `@svvy/core` explicitly owns. If
a managed sandbox launch returns a confirmed sandbox denial and the direct tool wants to retry
without the managed sandbox, the retry approval request must include the durable approval-record
context variant:

```ts
context: {
  reason: "sandbox_denial_escalation";
  sandboxDenied: true;
}
```

Runtime copies only that exact `{ reason: "sandbox_denial_escalation"; sandboxDenied: true }`
subshape into `RuntimeApprovalRecord.context`; broad prompt execution context, UI hints, command
previews, and other edge metadata are not persisted as approval-record context. Full-access mode
bypasses both the approval boundary and the managed sandbox according to the execution settings
contract; other approval modes must not silently retry outside the sandbox without this second
approval request.
Thread-start remains a package-private accepted native-tool service method used by runtime-owned pi
accepted-tool wiring; this subpath does not export a public `runAcceptedThreadStart(...)` adapter.

`acquireDirectToolLaunch(...)` is the accepted-tool helper for Shell, Apply Patch, and Execute
TypeScript direct launches only. It derives the closed runtime `launchKind` from the accepted tool
name, forwards to `RuntimeLaunchPolicyService.build(...)` through the package-private
direct-tool mapper, and returns scoped `SandboxLaunchFacts` to the owning command/session lane. It
does not expose sandbox policy construction, helper argv assembly, command spawning, or
app/bootstrap launch control.

Runtime-owned command/session lanes acquire scoped launch facts through
`RuntimeLaunchPolicyService`. App/bootstrap supplies primitive host process capability only through
approved runtime layer ports; it does not own a direct-tool launch lane, synthesize launch policy,
or assemble sandbox helper argv. Host process adapters receive only runtime-approved spawn facts for
the concrete command scope, not package-private launch-policy services:

```ts
type DirectToolLaunchHandle = {
  facts: SandboxLaunchFacts;
  close(): Promise<void>;
};

type RuntimeDirectToolLaunchAcquisition = {
  acquireDirectToolLaunch(
    input: Omit<BuildLaunchPolicyInput, "launchKind"> & {
      toolName: "exec_command" | "apply_patch" | "execute_typescript";
    },
  ): Promise<DirectToolLaunchHandle>;
};
```

The launch handle creates an explicit Effect `Scope`, runs
`RuntimeAcceptedNativeToolExecution.acquireDirectToolLaunch(input)` inside that scope, returns the
resulting `SandboxLaunchFacts`, and closes the scope only after the owning child-process lane settles
or is cancelled. Shell, Apply Patch, and Execute TypeScript all use
`acquireDirectToolLaunch(...)` with their own `toolName`; Execute TypeScript does not have a
separate launch-policy contract. The adapter must not use `Effect.scoped(...)` around the
acquisition before returning the facts, because that would close the launch scope before the process
has used the receipt. The only spawning data the host-process lane may use is
`facts.spawn.executable`, `facts.spawn.args`, and `facts.spawn.cwd`; raw helper argv/path fields
remain runtime/sandbox diagnostics and are not recomputed or assembled by app-edge code. Submitted
TypeScript snippets never receive the handle, `SandboxLaunchFacts`, sandbox snapshots, helper argv,
filesystem policy entries, or launch-policy services.

Accepted native tool execution uses one runtime-owned operation boundary: accepted tool identity,
raw accepted arguments, `PromptExecutionContext`, actor binding, and runtime route identity enter
the runner; runtime then allocates or reuses the command envelope, decodes arguments, derives the
`CommandInvocationContext`, and dispatches by tool family. Extension-backed tools invoke the
matching `@svvy/extensions` handler. Runtime-built-in tools use runtime-private runners and
extension-owned declaration/metadata only; they do not call an extension handler for execution. The
model-facing tool result is the only successful operation output. Applied effect diagnostics,
allocated ids, progress events, and command settlement metadata commit through runtime-owned
state-port calls and are later projected by `@svvy/state` read models instead of leaving as adapter
return fields. Tool-specific runners such as `request_user_input`, Shell, Apply Patch, Execute
TypeScript, and extension-facade child commands implement this boundary. The `request_user_input`
shape below is the concrete request-input specialization, not the only runtime-owned accepted tool
path.

Shell `exec_command`, Apply Patch, and Execute TypeScript are built-in accepted native-tool runners
owned by runtime. `@svvy/extensions` owns their model-facing declaration, loaded-instruction
eligibility, actor availability, and extension inventory metadata; runtime owns accepted argument
decoding, approval, command lifecycle, launch-policy acquisition, subprocess/file-effect execution,
artifact/log/result facts, and event publication for the accepted tool call. These built-ins may
reuse the same immutable execution-plan data shapes and command-session executor used for
extension-authored plans, but there is no app-edge direct launch path and no extension-handler
alternate path for these built-in tool launches. `request_user_input`, `thread_start`, and
`load_extension` are tool-specific control runners. Shell, Apply Patch, Execute TypeScript, and
extension child commands are command or file-effect runners that enter the same runtime-owned
command lifecycle, approval, launch-policy, event, and state-port path.

The top-level `apply_patch` native tool records a semantic patch command and executes the accepted
patch through the runtime-owned file-effect lane. When process isolation is required, runtime uses
the `direct_apply_patch` launch kind for worker command facts. `file_effect.apply_patch` is the same
package-private file-effect lane represented as an immutable execution-plan kind for
extension-authored patch plans; it is not an un-sandboxed in-process shortcut.

The top-level `execute_typescript` native tool owns a parent command whose submitted source,
diagnostics, logs, sandbox facts, and runtime subprocess result are recorded under the
`execute_typescript_runtime` launch kind when execution requires a subprocess. Generated facade
calls made from the snippet create child command/facade facts under that parent command with
separate child ids. Child facade execution does not expose the parent runtime facade, state store, or
generic app-action channel to the snippet.

Runtime processes accepted native tool calls serially within a turn by default. It may run multiple
accepted native tool calls concurrently only when the pi acceptance event identifies independent
tool calls and the native tool declaration includes a runtime-owned `concurrency` contract naming
the affected durable state domains and proving those domains cannot race. Runtime tracks every
concurrent accepted-tool fiber in a package-private registry built from manifest-adopted primitives;
a `FiberMap` implementation requires manifest promotion first. Tool handlers cannot opt into
concurrency through returned data alone.

Runtime does not acknowledge an accepted tool result back to pi until accepted arguments, command
lifecycle transition, handler fact payloads, returned `ExtensionRuntimeOperation` items, and
terminal/waiting command facts have either committed or recorded durable recovery/failure state.
Runtime applies `runtime_effect` operation items and executes `execution_plan` operation items in
the owning command lane. If the tool cannot produce a successful model-facing result, runtime
commits the failed, cancelled, or waiting command facts first, then returns the corresponding typed
tool error/result to pi-adapter. Extension handlers never return directly to pi.
Accepted-tool code must use the real runtime event bus from `Runtime.layer`; it must not install a
no-op event bus, collect `afterCommit` descriptors without publishing them, or return those
descriptors to app/bootstrap for deferred publication. The only successful model-facing
operation output is `toolResult`. Applied effect receipts, decoded handler details, allocated ids,
recovery ids, command facts, approval ids, request ids, and generated package refresh facts are
durable state/read-model details and do not leave the accepted-tool lane as return fields.
For `thread_start`, this commit-before-acknowledgement guarantee includes runtime-owned
handler-thread preparation. A composition without that preparation service fails before
handler-thread start state can commit.

`execute_typescript` follows the same accepted-tool lane. Its runtime operation receives accepted
tool identity, decoded TypeScript source, prompt execution context, actor binding, and state-port
services; it must not receive `StructuredSessionStateStore` or any state implementation object.
Runtime owns source/log/diagnostic artifact byte materialization, parent and child command
lifecycle, output/diagnostic events, handler-thread runnable projection, approval facts, sandbox
facts, subprocess result facts, cancellation facts, and extension-facade child-command rollups.
`RuntimeArtifactStatePort` records committed artifact metadata only: stored-path, byte-size, digest,
lifecycle, immutability, and linkage facts.
Host process spawning remains a primitive app/bootstrap host capability invoked only by
runtime-owned command/session lanes after `RuntimeAcceptedNativeToolExecution` acquires
direct-tool launch facts through `RuntimeLaunchPolicyService`; sandbox policy construction and
helper argv remain owned by `@svvy/sandbox`, not by app-edge launch wrappers or execution-plan
payloads.

Extension handlers may also return `execution_plan` operation items wrapping immutable execution
plans when the useful work requires runtime-owned approval, sandbox, subprocess, file-effect,
stdin/stdout/stderr, child-command, or cancellation behavior. Runtime executes those plans after
validating the current command envelope, target source version, approval identity key, sandbox
snapshot, expected binary/artifact identity, and readiness facts from runtime context, extension
metadata, and state. Those values are not copied into handler-authored plan payloads. Runtime
decodes every handler-returned plan with `ExtensionExecutionPlanSchema` before side effects;
unknown plan kinds, unsupported variants, excess fields, and dependency install/update plans
returned through handler operations fail as typed runtime/command contract errors after the owning
command envelope records the failure facts when one exists.

`RuntimeExecutionPlanExecutor` is the package-private service that executes
`ExtensionExecutionPlan` values in the owning command lane:

```ts
type RuntimeExecutionPlanExecutor = {
  execute(input: {
    commandId: CommandId;
    target: RuntimeSurfaceTarget;
    plan: ExtensionExecutionPlan;
    invocationContext: CommandInvocationContext;
    promptExecutionContext: PromptExecutionContext;
  }): Effect.Effect<RuntimeExecutionPlanReceipt, RuntimeContractError>;
};

type RuntimeExecutionPlanReceipt = {
  commandId: CommandId;
};
```

The receipt is package-private and exists only to sequence subsequent runtime operations. It is not a
facade result and not a transcript/read-model payload. The executor is package-private and
`Runtime.layer`-provided. Plan execution is fail-closed: any plan type without a spec-defined
concrete lane fails with typed `unsupported-operation` using operation
`runtime.executionPlan.execute` and a cause containing `commandId`, `planId`, and `planType`. A
concrete lane may exist only for plan types whose child-process, apply-patch/file-effect, approval,
sandbox launch, command-host, and publication semantics are fully specified.

| Plan kind                    | Extension responsibility                                                      | Runtime responsibility                                                                                                                                                                            | State/fact responsibility                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `none` / handler result only | Return a model-facing result and typed durable fact payloads.                 | Persist command lifecycle and fact payloads through state ports; publish invalidations only after commit.                                                                                         | `@svvy/state` owns rows/read models for the command and package-specific facts.                 |
| `child_process.command`      | Return immutable `argv`, `cwd`, command family, stdin mode, and env key plan. | Execute only through a spec-defined runtime-owned child-process lane. Without that lane, return typed `unsupported-operation` and write no concrete process facts beyond the owning failure path. | No concrete command/process facts are written by this plan lane beyond the owning failure path. |
| `file_effect.apply_patch`    | Return validated patch text and `cwd` only.                                   | Execute only through a spec-defined runtime-owned file-effect lane. Without that lane, return typed `unsupported-operation` and write no concrete patch facts beyond the owning failure path.     | No concrete patch facts are written by this plan lane beyond the owning failure path.           |

Runtime tests cover decode failure, missing command/context rejection, package-private executor
composition, and typed `unsupported-operation` for plan lanes without concrete runtime ownership.
Approval handoff, cancellation, state commit ordering, subprocess/file execution, and adapter
non-ownership tests are required for any concrete host-ported plan lane. Child-process lanes
materialize plans with explicit launch options:
`shell: false`, `extendEnv: false`, `detached: false`, `stdin` derived only from the plan's stdin
mode, and `stdout`/`stderr` set to pipe-backed capture. Decoded `child_process.command` plans
without a specified host-ported lane fail through `RuntimeExecutionPlanExecutor` with typed
`unsupported-operation`.

Extension dependency install/update is not a handler-returned execution-plan variant and has no
public runtime facade or core/runtime admission schema. A promoted runtime-owned lifecycle must ask
`@svvy/extensions` for the exact package/binary/trusted-identity requirement and install/update
command plan, then own user approval, controlled package-manager/subprocess execution,
lifecycle-script policy, installed artifact verification, cancellation, readiness invalidation,
command facts, and recovery behavior.

The concrete operation for `request_user_input` is:

```ts
type RunAcceptedRequestUserInputToolCallInput = {
  toolCallId: ToolCallId;
  toolItemId: ToolItemId;
  arguments: RequestUserInputInput;
  context: PromptExecutionContext;
  actorBinding: ActorExtensionBinding;
  command: {
    commandId: CommandId;
    target: PromptTarget;
    turnId: TurnId;
    approvalMode: ApprovalMode;
    approvalFacts?: RuntimeApprovalDecisionFacts;
  };
  commandRecord: RuntimeCommandRecord;
  requestInput: {
    mode: "nonblocking" | "blocking";
    blockingTimeout: {
      enabled: boolean;
      durationMs: PositiveDurationMs;
    };
  };
};

type RunAcceptedRequestUserInputToolCallResult = {
  toolResult: NativeToolResult;
  result: RequestUserInputResult;
};
```

`toolResult` is the only model-facing pi result. `result` is the decoded extension handler result
that runtime consumes to apply request-input runtime operations, update command facts, and decide
blocking/nonblocking wait behavior.

Example input:

```ts
{
  toolCallId: "tool_call_01" as ToolCallId,
  toolItemId: "tool_call_01" as ToolItemId,
  arguments: {
    questions: [
      {
        title: "CI scope",
        question: "Should I run the full suite?",
        options: [
          {
            label: "Unit checks only",
            description: "Faster, enough for a docs-only patch.",
            recommended: true,
          },
          {
            label: "Full preflight",
            description: "Slower, covers typecheck, unit tests, lint, format, and build.",
          },
        ],
      },
    ],
  },
  context: promptExecutionContext,
  actorBinding: {
    loadedExtensionIds: ["request-user-input"],
    availableExtensionIds: ["request-user-input"],
  },
  command: {
    commandId: "command_01" as CommandId,
    target: {
      workspaceSessionId: "workspace_session_01" as WorkspaceSessionId,
      surface: "orchestrator",
      surfacePiSessionId: "pi_session_01" as SurfacePiSessionId,
    },
    turnId: "turn_01" as TurnId,
    approvalMode: "auto-review",
    approvalFacts: {
      mode: "auto-review",
      requiredApproval: false,
      decision: "approved",
      reason: "read-only request_user_input validation",
      decidedAt: "2026-06-20T12:30:00.000Z",
    },
  },
}
```

Example output:

```ts
{
  toolResult: {
    content: [
      {
        type: "text",
        text: "{\"answers\":[{\"title\":\"CI scope\",\"question\":\"Should I run the full suite?\",\"answer\":{\"kind\":\"option\",\"label\":\"Unit checks only\",\"text\":\"Unit checks only\"},\"answeredBy\":\"default\"}]}",
      },
    ],
    details: {
      status: "succeeded",
      summary: "Answered 1 request_user_input question with the default answer.",
      commandFacts: {
        answeredBy: "default",
        questionCount: 1,
        result: {
          answers: [
            {
              title: "CI scope",
              question: "Should I run the full suite?",
              answer: {
                kind: "option",
                label: "Unit checks only",
                text: "Unit checks only",
              },
              answeredBy: "default",
            },
          ],
        },
      },
    },
  },
}
```

Use cases:

- `toolResult` is the exact value returned to pi. It contains no request ids, question ids, mode,
  timeout, timer state, queue ids, or UI metadata.
- Request-input answer data is returned to the model as `NativeToolResult.content` text containing
  JSON serialized from the decoded `RequestUserInputResult` shape. `NativeToolResult.details`
  remains the command result envelope: `status`, `summary`, and optional `commandFacts`.
- The accepted-tool public result has no internal ids, applied-effect records, timer metadata, queue
  ids, or command-settlement fields. Runtime persists request records, command progress, and
  terminal command facts through state ports. UI, tests, browser tools, and diagnostics read them
  through request-input and command read models instead of from this operation output.

The operation input contains only the accepted native tool identity, decoded
`RequestUserInputInput`, prompt execution context, actor binding, and runtime-owned command context.
Mode, timeout, timer defaults, and blocking/nonblocking behavior are resolved by runtime from the
loaded `request_user_input` extension record and actor binding before invocation. Extension handlers
receive only the decoded tool arguments plus `CommandInvocationContext`; they do not receive a
generic `runtimeControls` object or caller-supplied request-input policy.

Package-private command sessions are runtime-owned. They are used by Shell, Smithers-through-Shell,
Apply Patch, Execute TypeScript, generated extension facades, and other accepted tools that need
stdin, cancellation, subprocess/file lifecycle, command output capture, or child-command facts:

```ts
type RuntimeCommandSessionService = {
  startPlan(
    input: RuntimeCommandSessionStartInput,
  ): Effect.Effect<RuntimeCommandSessionHandle, RuntimeContractError>;
  writeStdin(
    input: RuntimeCommandSessionStdinInput,
  ): Effect.Effect<RuntimeCommandSessionStdinResult, RuntimeContractError>;
  cancel(
    input: RuntimeCommandSessionCancelInput,
  ): Effect.Effect<RuntimeCommandSessionCancelResult, RuntimeContractError>;
  reconcile(
    input: RuntimeCommandSessionReconcileInput,
  ): Effect.Effect<RuntimeCommandSessionReconcileResult, RuntimeContractError>;
};

type RuntimeCommandSessionStartInput = {
  commandId: CommandId;
  target: RuntimeSurfaceTarget;
  plan: ExtensionExecutionPlan;
  invocationContext: CommandInvocationContext;
};

type RuntimeCommandSessionHandle = {
  commandId: CommandId;
  startedAt: IsoDateTimeString;
};

type RuntimeCommandSessionStdinInput = {
  commandId: CommandId;
  text: string;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type RuntimeCommandSessionStdinResult =
  | {
      commandId: CommandId;
      status: "accepted";
      acceptedBytes: NonNegativeSafeInteger;
    }
  | {
      commandId: CommandId;
      status: "stdin_closed" | "not_running" | "already_terminal";
    };

type RuntimeCommandSessionCancelInput = {
  commandId: CommandId;
  reason: "user" | "surface-closed" | "turn-cancelled" | "shutdown";
  clientSubmission?: RuntimeClientSubmissionInput;
};

type RuntimeCommandSessionCancelResult = {
  commandId: CommandId;
  status: "cancelling" | "cancelled" | "already_terminal";
};

type RuntimeCommandSessionReconcileInput = {
  commandId: CommandId;
  reason: "startup-recovery" | "process-exit" | "state-reload";
};

type RuntimeCommandSessionReconcileResult = {
  commandId: CommandId;
  status: "unchanged" | "settled" | "recovery_scheduled";
};

type RuntimeCommandOutputEvent = {
  stream: "stdout" | "stderr";
  source?: "live-stream" | "final-result" | "execute_typescript" | "retained-log-artifact";
  chunkRef?: ToolItemId;
  text?: string;
  truncated?: boolean;
};

type RuntimeCommandTerminalFacts = {
  commandId: CommandId;
  status: "succeeded" | "failed" | "cancelled";
  exitCode: number | null;
  signal: string | null;
  outputComplete: boolean;
  outputIncompleteReason?:
    | "stdout-pump-failed"
    | "stderr-pump-failed"
    | "force-kill-timeout"
    | "runtime-shutdown";
  finishedAt: IsoDateTimeString;
};
```

`RuntimeCommandSessionCancelInput.reason` is runtime-internal lifecycle classification. Public
`commands.cancel(...)` accepts only optional caller note text and maps admitted desktop/headless
caller cancellation to `"user"` before invoking this service. `"surface-closed"`, `"turn-cancelled"`,
and `"shutdown"` are runtime-owned reasons produced by surface lifecycle, turn cancellation, and
runtime shutdown paths.

`Runtime.commands` public methods delegate to this service after authorization and state validation;
desktop, browser tools, headless tests, pi-adapter, and extension handlers never own live command
session maps or subprocess handles directly.

The live command-session registry is process-local runtime state keyed by durable `CommandId`.
Registry entries contain only runtime resources needed to continue an already accepted command:
child-process handle or equivalent stdin sink, stdin lane state, stdout/stderr pump fibers, terminal
watcher, cancellation finalizer, and close state. Registry entries never cross the state, desktop,
renderer, browser-tool, headless facade, extension, pi-adapter, generated-package, or Smithers
workflow-source boundary. State stores durable command rows, lifecycle events, output facts,
accepted stdin receipts, artifacts, and terminal facts; it does not store or reconstruct live stdin
handles.

`writeStdin(...)` admission is all-or-nothing. Runtime first validates command identity and caller
authority through `RuntimeCommandStatePort.findCommandById(...)`. Missing or unauthorized command
ids fail with `target-not-found`; they do not return `not_running`. Commands whose durable status is
`succeeded`, `failed`, or `cancelled` return `already_terminal` without touching the live registry.
For every nonterminal durable command, runtime asks `RuntimeLayerCommandStdinPort.writeStdin(...)`
to admit the complete text chunk into the live command session's FIFO stdin lane. A durable
nonterminal command with no live registry entry returns `not_running`; runtime does not
reconstruct, restart, or reattach a command solely to satisfy stdin. A closed or non-continuable
live stdin lane returns `stdin_closed`.

Only an `accepted` live admission records a stdin receipt through
`RuntimeCommandStatePort.recordStdinWrite(...)`. The receipt contains the durable `commandId`,
owning `workspaceSessionId` / `surfacePiSessionId` when needed for read-model projection, the exact
submitted `text`, and `acceptedBytes`, which is the UTF-8 byte length of that exact text. It never
records or exposes Shell `session_id`, process id, or live handle identity as stdin authority.
Runtime returns `status: "accepted"` and publishes `command.changed`
only after the state mutation commits. If receipt recording fails after live admission, runtime
surfaces the typed runtime/state failure, such as `state-conflict` or `stale-state`; it must not
synthesize an accepted result, duplicate a receipt, or treat `clientSubmission` as replay-safe.
This architecture has no pre-admission stdin idempotency ledger. `clientSubmission` remains
metadata only for stdin writes.

The command-session service owns the complete scoped command lifecycle:

- stdout and stderr pumps record `command.output` events through state ports before
  renderer/browser-tool projections can observe them. The persisted payload is the core
  `CommandOutputEventPayload` shape: `stream`, optional runtime-owned `source`, optional `text`,
  optional `chunkRef`, and optional `truncated`. It does not carry raw bytes, base64 bytes, byte
  counts, or a command-output sequence field.
- event ordering is the state event append order. Runtime preserves per-command output order by
  committing output events in the order it admits them into the command event lane; callers that need
  durable large-output bytes use command-linked artifacts and artifact metadata instead of embedding
  large raw output into `command.output` events.
- terminal process observation emits exactly one `RuntimeCommandTerminalFacts` value before command
  settlement invalidations are published.
- retained large stdout/stderr streams are file-backed artifacts linked to the command and referenced
  from command terminal facts such as `retainedOutputArtifacts[]`. Runtime writes or deletes the
  bytes and commits metadata facts for `byteSize`, `sha256`, stored path, MIME type, immutability,
  materialization status, and deletion state through `RuntimeArtifactStatePort`. Signed extension
  subprocess result payloads may contain structured JSON output, but never duplicate raw
  stdout/stderr streams.

- a runtime-scoped handle registry keyed by `commandId`; duplicate `startPlan(...)` for a live
  command fails with a typed stale-state error unless recovery proves the prior handle is gone
- subprocess acquisition through sandbox launch policy and the injected child-process service
- stdout/stderr pump fibers, terminal exit observation, output batching, and output flush before
  terminal settlement
- a bounded stdin queue of `commandStdinQueueCapacity`, deterministic stdin close, and explicit
  `writeStdin(...)` results for `accepted`, `stdin_closed`, `not_running`, and `already_terminal`;
  if `Queue.offer(...)` on the admission queue yields `false`, `writeStdin(...)` fails with
  `RuntimeContractError` reason `"backpressure"` and records no stdin command event, accepts no bytes, and emits no
  `command.changed` event for that attempt
- cancellation order: stop accepting stdin, request graceful process termination, wait
  `commandGracefulShutdownMs`, force-kill if still running, wait `commandForceKillGraceMs`, then
  record a terminal or recovery fact
- reconciliation receipts for process exit, runtime startup recovery, app shutdown, and state reload

Output pumps write command output through runtime/state ports in stream order per command. They may
batch adjacent stdout/stderr chunks only up to the configured chunk, byte, and latency limits. Final
process output is not duplicated when live output has already been recorded; terminal facts point to
the retained output/read-model rows. Command-session finalizers must not infer user cancellation
from scope close alone; the runtime service records the intended reason before interrupting the
scope.

If a stdout or stderr pump fails before the process terminal observation is recorded, runtime
records a command failure or recovery fact with `outputIncomplete: true`, flushes retained partial
output, and never converts that stream failure into command success with `Channel.ignore`,
or an equivalent swallowing stream recovery combinator. A command whose output stream failed can
only be reported successful if the terminal command fact explicitly records incomplete output and
the owning command family defines that as acceptable.

The desktop/user answer path is also runtime-owned. It is a public runtime facade group because it
may enqueue prompt delivery, resolve blocking waits, update timer state, and settle command/request
facts:

```ts
type RuntimeRequestInputApiEffect = {
  answer(
    input: AnswerRequestInputInput,
  ): Effect.Effect<AnswerRequestInputResult, RuntimeContractError>;
  setTimerPaused(
    input: SetRequestInputTimerPausedInput,
  ): Effect.Effect<SetRequestInputTimerPausedResult, RuntimeContractError>;
};

type RuntimeRequestInputFacade = {
  answer(
    input: AnswerRequestInputInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<AnswerRequestInputResult>;
  setTimerPaused(
    input: SetRequestInputTimerPausedInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SetRequestInputTimerPausedResult>;
};

type AnswerRequestInputInput = {
  surfacePiSessionId: SurfacePiSessionId;
  requestId: RequestInputRequestId;
  questionId: RequestInputQuestionId;
  answer: { kind: "option"; optionId: RequestInputOptionId } | { kind: "custom"; text: string };
  delivery: RuntimeMessageDelivery;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type AnswerRequestInputResult = {
  requestId: RequestInputRequestId;
  questionId: RequestInputQuestionId;
  status: "recorded" | "duplicate";
  delivery:
    | { kind: "blocking-resolved"; queuedItemId: null }
    | { kind: "blocking-open"; queuedItemId: null }
    | { kind: "nonblocking-queued"; queuedItemId: QueueItemId }
    | { kind: "nonblocking-recorded"; queuedItemId: null };
};

type SetRequestInputTimerPausedInput = {
  surfacePiSessionId: SurfacePiSessionId;
  requestId: RequestInputRequestId;
  paused: boolean;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type SetRequestInputTimerPausedResult = {
  requestId: RequestInputRequestId;
};
```

Schema-backed answer input example from `AnswerRequestInputInputSchema`:

```json
{
  "surfacePiSessionId": "pi_orch_01",
  "requestId": "rui_01",
  "questionId": "ruiq_01",
  "answer": { "kind": "option", "optionId": "ruio_01" },
  "delivery": "enqueue-and-run",
  "clientSubmission": {
    "correlationId": "visual-test-answer-42",
    "source": "request-input-panel"
  }
}
```

Schema-backed answer result example from `AnswerRequestInputResultSchema`:

```json
{
  "requestId": "rui_01",
  "questionId": "ruiq_01",
  "status": "recorded",
  "delivery": {
    "kind": "nonblocking-queued",
    "queuedItemId": "queue_01"
  }
}
```

These examples intentionally include no renderer-local panel identity; fields such as `panelId` are
rejected by the runtime boundary schema.

Schema-backed timer pause input example from `SetRequestInputTimerPausedInputSchema`:

```json
{
  "surfacePiSessionId": "pi_orch_01",
  "requestId": "rui_01",
  "paused": true,
  "clientSubmission": {
    "correlationId": "visual-test-timer-42",
    "source": "request-input-panel"
  }
}
```

Schema-backed timer pause result example from `SetRequestInputTimerPausedResultSchema`:

```json
{
  "requestId": "rui_01"
}
```

The same input shape resumes the timer with `"paused": false`; no separate resume request type
exists.

`answer(...)` validates that the request is open, the addressed question/option exists, the submitted
`surfacePiSessionId` owns the request, and the client submission is idempotent. It records exactly
one answer through a state transition that returns the public `delivery` variant. For blocking
requests, a partial answer records the answer and leaves the wait open while any question remains
open; the final answer resolves the wait and marks the command terminal. For nonblocking
requests, the committed transition records the answer and creates a `request_user_input_answer`
queue row only when model delivery is still required. Runtime publishes committed
after-commit descriptors, then calls the request-input post-commit boundary to
resolve the live wait or wake the queue, and returns `AnswerRequestInputResult`. The state-port
mutation value is `RuntimeAnswerRequestInputCommitResult`: `answer` is the public
`AnswerRequestInputResult`, and `target` is the committed owning `PromptTarget` used by the
post-commit wait boundary. Runtime must not call `RuntimeRequestStatePort.getRequestInput(...)`
after the answer transaction just to decide whether to resolve a wait or wake a queue. The returned
`delivery` variant tells the caller whether a blocking runtime wait remains open, a blocking
runtime wait was resolved, a nonblocking delivery row was queued, or the answer was recorded only
because model delivery is unnecessary. The
answer payload sent back to the model contains the display `title`, `question`, `originalAnswer`,
and `userAnswer` only; request ids, question ids, option ids, timeout state, and queue ids remain
product-state details.

`RuntimeRequestInputWaitService` is a runtime-owned request-input wait and wakeup boundary. During
blocking accepted-tool execution, runtime calls `waitForBlockingRequest(...)` only after the
request and command are committed. After `requestInput.answer(...)` or
`requestInput.setTimerPaused(...)` commits state through `RuntimeRequestStatePort` and
`RuntimeEventBus.publishStateInvalidations` has accepted the committed invalidations, runtime calls
the same service for post-commit wakeup or timer rescheduling. Runtime owns this ordering. For
answers the wake boundary receives `surfacePiSessionId`, `requestId`, the committed `delivery`
discriminant, and the committed `PromptTarget` returned by the state port. The `queuedItemId` is
present only for `delivery.kind === "nonblocking-queued"`. For timer pause/resume it receives only
`requestId`. It may wake the addressed queue lane, resolve a current blocking wait, or reschedule
the current process-local timeout, but it must not record answers, mutate timer state, publish
runtime events, change public request-input results, call `RuntimeRequestStatePort.getRequestInput(...)`
to reconstruct answer wake metadata, or read renderer state. Request-input wait resolution, timer
scheduling, and queue wakeups are runtime-owned services.

Public request-input facade failures are closed to:
`invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `backpressure`,
`runtime-shutdown`, and `runtime-disposed`. Timeout fibers, duplicate submissions, queue wakes, and
blocking wait completion must map into that set; raw state errors, fiber defects, timer defects, and
queue dispatcher causes are logged through app logs and normalized `StateStoredError` facts, not
exposed through facade error payloads.

`setTimerPaused(...)` validates that the submitted surface owns the request, records the paused timer
state through `@svvy/state`, reschedules or clears the process-local timer after commit, publishes
the workspace state update from the committed descriptor, and returns only `{ requestId }`. Timer
state is DB/product-state-backed and read through request-input read models; the mutation result does
not duplicate `pausedAt`, `remainingMsWhenPaused`, or `expiresAt`. Timer pause/resume is available
only for an open blocking request that has a timeout. A nonblocking request, already-terminal
request, request without timeout, or request owned by another surface returns `stale-state` or
`invalid-input` as appropriate. Pausing the timer does not release the prompt lock, command wait, or
blocking tool call; it only freezes timeout countdown. App shutdown and runtime restart preserve the
paused fact and must not refork a timeout fiber until the request is resumed. Resuming recomputes a
new persisted deadline from the stored remaining duration and commits that version before starting a
new process-local timer.

For nonblocking request-input, runtime creates the request, records the derived default answer,
settles the command, and returns that default answer to pi immediately. Later user answers are
ordinary nonblocking answer records and may enqueue `request_user_input_answer`.

For blocking request-input, runtime creates the request, records the command as waiting on that
request, schedules the timeout when enabled, and parks the accepted tool call on a surface-scoped
wait. The model-facing tool result is not returned until all questions have user answers or timeout
defaults. The wait is represented durably by request/command/turn facts; the process-local Deferred
is only a live handoff and is recreated or completed by recovery.
The process-local timeout scheduler keeps at most one live timeout entry per
`{ requestId, timerVersion }` using manifest-adopted primitives. `FiberHandle`/`FiberMap`
implementations require manifest promotion before production use. Pause, resume, answer,
cancellation, and recovery commits always compare the committed timer version before interrupting or
replacing a live timeout fiber. A stale timeout fiber that wakes after a newer timer version exists
must observe `stale-state`, release only its own live resources, and leave durable request/command
facts unchanged.

Blocking request-input resolution is a single state compare-and-set transition keyed by
`requestId`, owning command id, current wait status, and timer version/deadline. User answers, live
timeout fibers, the timeout scan worker, request cancellation, turn interruption, surface/workspace
close recovery, and startup recovery all call that same runtime-owned transition. The first
committed terminal transition wins and is the only path allowed to resolve the live `Deferred`,
settle the command, release the prompt lock, publish request-input/command/turn invalidations, and
return a tool result to pi. Losing contenders observe `stale-state`, release only their
process-local resources, and must not publish duplicate invalidations, resolve a `Deferred`, insert
answer queue rows, or settle the command. Recovery reconstructs live waits from persisted
request/command/turn facts and completes or reforks them only after reading the durable terminal or
open state.

Errors are `RuntimeContractError` only:

- `invalid-input`: malformed accepted arguments, unsupported target surface, extension handler
  validation failure, missing request-input effect, or invalid handler command facts.
- `target-not-found`: state cannot find the target surface/session for `request_input.create`.
- `stale-state`: state rejects the transition because the target/command/request has already moved.

Unknown `RuntimeEffectRequest` variants fail schema decode before runtime application. A decoded
variant without an applier is a programming defect covered by package tests, not a model-facing
runtime status.

## Streamed Tool Lifecycle

Runtime uses two-phase command projection:

1. When pi streams a tool call, runtime creates or updates a command record keyed by `toolCallId` and
   records streamed argument snapshots before runtime execution starts.
2. When pi accepts the completed call and execution starts, runtime reuses the same command record
   when one exists, resolves approval and sandbox launch facts, creates the `CommandInvocationContext`
   for the extension handler, starts execution, and records accepted arguments and runtime events.
3. If the prompt ends before execution starts, runtime terminalizes dangling streamed commands as
   failed or cancelled.
4. Terminal command facts are immutable after `succeeded`, `failed`, or `cancelled`.

Specialized tools may provide tool-specific command facts, child-command descriptors, progress
metadata, artifact links, or final summaries through extension handler results, but runtime allocates
and persists the surface-visible command envelopes. The decision about which tools are specialized
must come from `@svvy/extensions` metadata rather than duplicated hard-coded lists in runtime
command lifecycle/projection services. Extension handlers do not create command rows directly and
`RuntimeEffectRequest` values do not record the currently executing command.

Runtime receives pi turn output as a `PiAdapterTurnStream` and consumes its
`stream: Stream<PiRuntimeEvent, PiAdapterError>`. The streamed tool lifecycle projection service is
scoped to the active turn/surface and stores only live coordination state in manifest-adopted
primitives, such as a `Ref`-backed `toolCallId -> commandId` map and the last emitted argument
snapshot metadata. `SynchronizedRef` may be used here only after exact manifest promotion,
service-instance policy when required, and focused tests. Streaming argument snapshots may be
sampled or throttled because the final accepted
arguments are persisted losslessly. Snapshot timing uses `Clock` / `DateTime` and is tested with
`TestClock`; runtime command lifecycle/projection code must not use `Date.now()`, `new Date()`,
`DateTime.nowUnsafe()`, `clock.currentTimeMillisUnsafe()`, or `clock.currentTimeNanosUnsafe()`.
Runtime uses `DateTime.now` only to create persisted UTC instants such as `notBefore`,
`nextAttemptAt`, `expiresAt`, and committed timestamps. Runtime uses `Clock` / `Schedule` for
elapsed durations, sleeps, retries, worker cadence, shutdown drain windows, and graceful/force-kill
timers. Tests advance elapsed-time paths through Effect test clock layers; implementation must not
compare wall-clock `DateTime` values to measure elapsed process or worker duration.

Accepted arguments, command output required for facts, child-command links, waits, approvals, and
terminal facts are persisted transactionally through `@svvy/state`. `command.changed` publishes only
after the corresponding state commit. Terminal command immutability is enforced by state transaction
guards; late stream callbacks, duplicate prompt cleanup, or interrupted fibers may emit diagnostics
but must not rewrite terminal facts.

## Runtime Rules

- One strategic brain: the orchestrator owns strategy and final decisions.
- Handler threads are delegated conversation surfaces, not raw worker processes.
- Runtime never delegates directly to raw Smithers runs.
- Runtime routes model tool calls through `@svvy/extensions`.
- Native control tools remain explicit extension tools.
- Tool cards render from streamed tool-call intent and settle from authoritative command facts.
- Smithers execution remains Shell `exec_command` work chosen by agents in handler threads.
- Runtime does not invent `workflow.*` APIs.
- Runtime does not own Workflows extension guidance or Smithers extension guidance.
- Runtime applies typed effects returned by extension handlers. Extension handlers validate inputs
  and describe requested work; runtime schedules turns, creates surfaces, inserts queue messages,
  and performs delivery.
- State persists queue rows transactionally, but runtime owns claim policy, delivery ordering,
  retry policy, and recovery behavior.
- Runtime keeps worktree context aligned across surfaces, handler threads, Shell/Smithers command
  cwd, and default workspace behavior.
- Runtime never reconstructs lifecycle by parsing transcript prose.
- Runtime records streamed tool-call argument snapshots before runtime execution and settles command
  spans from immutable terminal command facts.
- Runtime does not treat UI panel focus or Dockview binding as part of prompt dispatch.
- Runtime code uses only the exact Effect modules and members adopted in
  `packages/effect-adoption-manifest.ts` for time, waiting, readiness, locks, concurrency limits,
  replaceable lanes, active fibers, replaceable scoped handles, and keyed workspace/surface runtime
  lifetimes. `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`, `SynchronizedRef`, and `LayerMap`
  are not adopted runtime APIs unless the manifest names the exact installed export and call sites.
- Runtime consumes pi turns by first receiving `PiAdapterTurnStream` from `@svvy/pi-adapter`, then
  consuming its `stream: Stream<PiRuntimeEvent, PiAdapterError>` value. Each active surface has at
  most one prompt-bearing pi turn fiber at a time, guarded by the prompt lock. Callback-style pi APIs
  are adapted into scoped streams with acquire/release finalizers, not by storing unscoped
  listeners.
- Runtime code does not use Effect AI, Workflow, Cluster, or durable workflow queues as product
  primitives.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on Effect v4.
- Does not depend on `@svvy/state` as a package. Runtime-owned state changes go through core-owned
  Effect state port service tags that app/bootstrap satisfies with `@svvy/state` layers. Runtime
  service code must not import or call `createStateFacade(...)`, `createStateCommandsFacade(...)`,
  state Promise facades, state command facades, read-model facades, repositories, table modules,
  migrations, SQL helpers, `StateStore`, or state test fixtures.
- Has package dependencies on `@svvy/sandbox` and `@svvy/pi-adapter` for runtime-owned execution and
  pi adaptation work. The public `Runtime.layer` requirement type does not require ready `Sandbox`
  or `PiAdapter` service tags. It does require the exact core-owned ports, runtime bootstrap host
  ports, sandbox host-support ports, `SandboxPolicySource`, and platform services named above so
  runtime-owned internal services can compose the sandbox launch-policy adapter without app-edge
  policy synthesis.
- Depends on `@svvy/extensions`.
- Must not depend on `@svvy/desktop`.

## Product Source Ownership

Target package paths:

- `packages/runtime/src/**`

## Acceptance Criteria

- `@svvy/runtime` accepts target-plus-message submissions and runtime-facing commands only; callers do
  not submit pi message arrays, system prompts, transcript fragments, or generated tool definitions.
- Runtime owns queue orchestration, turn orchestration, pi session lifetimes, recovery scheduling,
  tool/event sequencing, and after-commit event publication.
- Runtime applies only the closed declarative `RuntimeEffectRequest` values defined by
  core/extension contracts.
- Runtime emits typed events after authoritative state commits and can rebuild active work from
  persisted state without replaying event streams.
- Runtime can run headless without desktop imports and without a parallel `workflow.*` abstraction
  over Smithers-native tool names.

## Tests

Runtime does not export package-root test fixtures. There is no public `layerTest`,
`Runtime.layerTest`, `RuntimeTestHarness`, or test-only package subpath. Test-only composition stays
inside `packages/runtime/src/*.effect.test.ts` files or colocated test-support modules that are not
reachable through the `@svvy/runtime` package export map.

Effect service/layer behavior is tested in the `bun run test:effect` lane with `@effect/vitest`.
Those tests provide fake direct dependencies with local `Layer.succeed(...)` layers, fake state
ports, fake pi/extension/package services, and local semantic harnesses tailored to the behavior
under test. Completion is proven with Effect values, local receipt arrays/queues, `TestClock`,
scoped finalizer assertions, and authoritative state-port assertions. Effect-lane tests do not
sleep, poll read models, poll filesystem contents, inspect git refs, create per-test product
`ManagedRuntime` instances, or inspect private fibers to infer completion.

Bun unit tests may cover pure schemas, pure contracts, generated/package-boundary assertions,
bootstrap config decoding, prompt-execution-context construction, and the Promise/`AsyncIterable`
facade adapter edge. Facade adapter tests may create a minimal caller-owned `ManagedRuntime` from
`Layer.succeed(Runtime, fakeService)` solely to prove facade mapping, cancellation, stream,
disposal, and error behavior over an already-owned runtime. That pattern is not a runtime
service/layer fixture and must not be used to test runtime-owned queue, prompt, state, recovery,
command, source-invalidation, event-publication, or generated-package semantics.

Runtime receipt buses are package-private implementation services only. They are not root exports,
bootstrap exports, facade groups, or public test fixtures. Tests that need semantic receipts define
local package-private test layers or local harnesses in the relevant `*.effect.test.ts` file and
assert that production `Runtime.layer` exposes no additional public test surface.

- Runtime tests with fake pi and fake extensions.
- `@effect/vitest` service/layer tests.
- Runtime event stream contract tests.
- Runtime event replay capacity, subscriber-buffer backpressure, and slow-consumer close tests.
- Runtime message submission tests proving public API does not accept full messages or system
  prompts.
- Workspace/default workspace recovery tests.
- Scoped workspace/surface resource disposal tests.
- Lifecycle primitive tests for every promoted scoped/concurrency primitive used by runtime.
  Candidate primitives such as `FiberHandle`, `FiberMap`, `FiberSet`, `ScopedRef`, `RcMap`, and
  `Resource` get focused tests in the same change that promotes their exact imports in the adoption
  manifest.
- Queue ordering, idempotency, and recovery tests for every queue item kind.
- Queue transaction/commit/event-publication ordering tests.
- TestClock-based retry, timeout, title-job, and recovery schedule tests.
- Handler-thread lifecycle tests.
- Prompt refresh scheduling tests.
- Streamed tool lifecycle tests for argument snapshots, execution reuse, dangling command
  terminalization, and immutable terminal facts.
- Runtime effect request algebra tests.
- Request-input delivery tests.
- Title-generation scheduling/recovery tests.
- Tests proving runtime can be used without Electrobun/Svelte.
- Tests proving runtime does not import Effect AI, Workflow, or Cluster modules.
- Runtime facade tests proving facades use the provided, already-started `ManagedRuntime` without
  creating or owning product runtime authority, map
  typed failures/defects to stable bridge errors, propagate cancellation, close stream scopes, fail
  after runtime disposal, and contain no queue claiming, prompt dispatch, state mutation,
  tool-execution, or recovery policy. App-bootstrap integration tests prove
  `managedRuntime.context()` is awaited before facades are exposed when startup effects matter.
- Runtime event tests proving bounded replay succeeds inside the retained window, stale
  `afterSequence` requests fail before a stream is exposed, slow subscribers observe the intended
  backpressure policy, and event publication happens only after authoritative state commits.
- Source invalidation tests proving watcher handles open with the coordinator handle and close on
  coordinator shutdown, scope shutdown interrupts watchers/debounce/scan fibers, dirty domains coalesce while a scan is active,
  generated output is ignored, DB-backed settings/snippets bypass file watchers, stale surfaces are
  marked by fingerprint comparison only, refresh happens only at prompt-bearing pre-dispatch
  boundaries, and all debounce/retry timing uses `TestClock`.
- Command-output batching tests proving size-based flush, time-based flush, terminal flush,
  stdout/stderr ordering, command-fact completeness, and UI patch frequency reduction without
  dropping facts, summaries, artifacts, or inspector state.
- Interruption tests proving long-running turns, tools, subprocesses, source scans, and queue
  claims settle durable facts exactly once, release prompt locks, remove active fibers, complete or
  fail local waiters, terminalize or release queue claims, and ignore late callbacks except for
  diagnostics.
