# `@svvy/runtime` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/runtime`

## Purpose

`@svvy/runtime` is the reusable orchestration kernel.

It coordinates the shared execution model:

```text
message submit -> durable queue commit -> queue wake/claim -> turn record commit -> pi stream -> streamed tool intent -> accepted tool call -> runtime command envelope -> extension handler -> ExtensionRuntimeOperation processing -> runtime_effect application / execution_plan execution -> state commit -> runtime notification/live patch -> UI refetch or stream rebaseline -> recovery scan
```

It is the package another app imports when it wants `svvy` behavior without the desktop UI.

`@svvy/runtime` is the primary Effect-native orchestration package. Package-to-package consumers use
its Effect service and layers. Desktop, browser tools, headless scripts, and other non-Effect
consumers use Promise, callback, or `AsyncIterable` facades/adapters over a scoped
`ManagedRuntime`.

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

## Does Not Own

- Durable storage implementation.
- pi internals or pi transcript storage.
- Extension catalog definitions.
- Native tool declaration schema ownership.
- Prompt or instruction source files.
- Sandbox policy semantics.
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
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { Extensions } from "@svvy/extensions";
import { PiAdapter } from "@svvy/pi-adapter";
import { Sandbox } from "@svvy/sandbox";
import type { RuntimeLayerError, RuntimeLayerRequirements } from "@svvy/runtime/bootstrap";
import {
  AppLogWritePort,
  RuntimeContractError,
  type RuntimeEvent,
  type RuntimeEventError,
  type RuntimeEventsInput,
  type SandboxLaunchFacts,
} from "@svvy/core";

// Runtime owns the public service/facade group types below. `@svvy/core` exports only shared ids,
// DTO schemas, tagged errors, runtime events, `RuntimeEffectRequest`, `ExtensionExecutionPlan`,
// state-port tags, and other pi-free cross-package contracts.

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
    sourceEdits: RuntimeSourceEditsApiEffect;
    sourceInvalidation: RuntimeSourceInvalidationApiEffect;
    events(
      input?: RuntimeEventsInput,
    ): Effect.Effect<RuntimeEventSubscriptionEffect, RuntimeEventError>;
  }
>()("@svvy/runtime/Runtime") {}

export namespace Runtime {
  export const layer: Layer.Layer<Runtime, RuntimeLayerError, RuntimeLayerRequirements> =
    Layer.effect(Runtime, makeRuntime);
}

export const layer = Runtime.layer;
```

`HttpClient.HttpClient` is not a base `Runtime.layer` requirement. Runtime-owned outbound
helper/protocol calls use a separately named transport layer that composes the base runtime service
with the concrete guarded HTTP services needed by that transport. Runtime domain services do not
call global `fetch`, Bun, Node HTTP APIs, or extension-owned HTTP clients directly.
`RuntimeLayerRequirements` is the complete external production dependency set for `Runtime.layer`.
Every state port, package service, platform service, and host capability named by the promoted
runtime method ledger must appear in this type, or the ledger must name an already-listed service
that owns the behavior. Runtime-owned implementation services such as `RuntimeEventBus`,
`RuntimeWaitRegistry`, `RuntimeCommandSessionService`, `SourceInvalidationCoordinator`, and
`RuntimeRecoveryCoordinator` are named internal sublayers built by `Runtime.layer` and hidden with
`Layer.provide(...)`; app/bootstrap does not provide them and package code must not satisfy them
through package-private singletons, direct `@svvy/state` implementation imports, app/bootstrap
callback objects, source-checkout-relative helpers, or per-request layer graphs.

Every runtime API group exposed by `Runtime`, `Runtime.layer`, and `createRuntimeFacade(...)` has a
complete production dependency path through `RuntimeLayerRequirements` and runtime-owned internal
services. A promoted method is invalid if it relies on an optional app/bootstrap callback,
returns `unsupported-operation` because the method is a placeholder, or delegates product policy to
a broad catalog object. `unsupported-operation` is a valid public failure only when a promoted
method is fully implemented and the decoded input asks for a domain, scope, transport, or capability
that the method contract ledger explicitly lists as unsupported. Source invalidation requires the
complete source invalidation service surface: `hint`, `reconcile`, `refreshGeneratedContext`, and
`refreshGeneratedPackages`. Missing source invalidation wiring is a composition error, while
unsupported source domain/scope combinations are explicit product contract errors returned by the
method implementation.

Command stdin uses `RuntimeCommandSessionService.writeStdin(...)` in the production runtime. The
service admits text only by durable `CommandId`, never by shell session id or process handle, and
keeps live process handles package-private. App/bootstrap may provide primitive process and stdin
host capabilities only as named dependencies of `RuntimeCommandSessionService`; it does not own
command-session lookup, admission policy, durable stdin receipt recording, or command terminal state.

No production `RuntimeLayerCatalogPort` exists in the target architecture. Routeable lookup belongs
in runtime-owned services such as `WorkspaceRuntimeMap`, `SurfaceRuntimeMap`, direct core-owned
state ports, or package service requirements in `RuntimeLayerRequirements`. App/bootstrap does not
provide a workspace registry, route resolver, callback table, or fallback runtime implementation,
and it is never authoritative for workspace, queue, prompt, event, recovery, generated-package, or
command policy.

Runtime-owned routing is package-private and deterministic:

- Workspace-addressed public methods use an explicit `workspaceId` from the decoded input or the
  workspace id returned by the state port commit they just performed. They then borrow
  `WorkspaceRuntimeMap.contextEffect(workspaceId)` inside the caller effect scope when they need
  scoped workspace services such as queue dispatch, source coordination, recovery, app-log routing,
  generated-package link repair, or workspace shutdown state.
- Surface-addressed public methods use the decoded `surfacePiSessionId` from the public target.
  Runtime reads the owning workspace/session facts through core-owned state ports when the method
  needs workspace-scoped services, validates that the surface belongs to the addressed workspace
  when both ids are present, and borrows `SurfaceRuntimeMap.contextEffect(surfacePiSessionId)` only
  for live surface services such as pi session materialization, prompt locks, active stream fibers,
  blocking wait ownership, and surface-local command sessions.
- Command-addressed public methods such as `commands.writeStdin(...)`,
  `commands.cancel(...)`, dependency action continuation, approval resolution, and command-linked
  workflow task-agent bridge work first read the durable command row through
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
  entry, or a best-effort route.

Promise/`AsyncIterable` facade:

```ts
import { createRuntimeFacade } from "@svvy/runtime";

const runtime = createRuntimeFacade(managedRuntime);

await runtime.messages.submit({ target, message: { text }, delivery: "enqueue-and-run" });

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

Package root API surface includes only `Runtime`, `Runtime.layer`, the root `layer` alias, and
`createRuntimeFacade(...)`. `Runtime.layer` is the production package-owned Effect layer for the
complete `Runtime` service; the root `layer` export is only an alias of `Runtime.layer`.
`createRuntimeFacade(...)` is a mechanical adapter over an app/bootstrap-owned `ManagedRuntime` and
exposes the same public API groups as the `Runtime` service plus facade-owned lifecycle cleanup
through `close()`. `close()` is not a runtime service API group. `Runtime.layer` is not parameterized by an
app-supplied `RuntimeService`, callback table, catalog, workspace registry, or fake service object.
No service-lifting helper such as `Runtime.layer(service)` or `layerRuntime(service)` is part of the
package-root API. A `Layer.succeed(Runtime, fake)` helper is allowed only inside tests or internal
fixtures and is never exported from the package root as a promoted runtime layer. App bootstrap
composes concrete services, awaits `managedRuntime.context()`,
awaits runtime-owned startup readiness, exposes facades only after readiness, and owns shutdown
preparation plus disposal. The single canonical public service shape is the `Runtime` class above.
Package code and tests must not maintain either a narrower facade for implemented methods or a wider
facade with placeholder groups.

A runtime method may appear in target design tables before its implementation is complete, but it is
not a promoted public runtime method until its schema-backed input/result contracts, public error
mapping, state ports, runtime-owned services, emitted invalidations/events, shutdown behavior, and
Effect-lane tests exist. Package-private scaffolding may live in internal modules only. `Runtime`,
`Runtime.layer`, and `createRuntimeFacade(...)` must not expose a method that returns
`unsupported-operation` as an implementation placeholder, delegates product policy to app/bootstrap
callback objects, or admits work without the owning Effect service and state-port contract in place.
When `unsupported-operation` appears in a method contract table, tests prove it is reached only
after schema decoding and explicit domain/scope/capability validation, not because the service path
is unwired.

The `@svvy/runtime` package export map exposes only `.` and `./bootstrap`. The package root value
surface is explicit: `Runtime`, `Runtime.layer`, `layer`, and `createRuntimeFacade(...)`. These are
boundary-tested root contracts. Public callers type the facade as
`ReturnType<typeof createRuntimeFacade>` or narrower local aliases derived from that return type.
`@svvy/runtime` does not export a separate executable facade service, facade class, facade group type
namespace, or concrete facade error class from the package root. Runtime event subscription payload
contracts come from `@svvy/core`; RuntimeEffectRequest appliers, svvyx runtime-effect transport
helpers, event-bus internals, prompt-execution handles, layer config helpers, and bootstrap helpers
remain off the package root. Public callers use core-owned encoded error contracts and facade
Promise/stream rejection behavior; they do not import a runtime-owned error class from the package
root.

App-bootstrap-only helpers live under `@svvy/runtime/bootstrap`: `RuntimeLayerConfig`,
`RuntimeLayerConfigInputSchema`, `RuntimeLayerConfigSchema`, `RuntimeLayerConfigFromEnv`,
`defaultRuntimeLayerConfig`, `RuntimeLayerConfigService`, `RuntimeLayerRequirements`,
`RuntimeLayerError`, `createRuntimeLayerConfigLayer(...)`, `awaitRuntimeStartupReadiness(...)`,
`prepareRuntimeShutdown(...)`, `layerRuntimeBunPlatform`, and `RuntimeBunPlatformServices`. The
same bootstrap subpath may expose
`createRunTaskAgentLoopbackBridge(managedRuntime)` only for the Smithers workflow task-agent bridge
binding named in this spec; it is not a package-root API, not a public runtime facade group, and not
a general workflow or Smithers command surface. App/bootstrap owns the Bun HTTP route binding,
request-body decoding, host server lifecycle, and transport-level response writing; runtime owns
token-lineage authorization, command/source identity validation, task-attempt surface creation,
queue insertion, event publication, recovery facts, bridge shutdown behavior, and typed result/error
mapping. That subpath is consumed only by product app bootstrap and package tests. Renderer code,
`@svvy/desktop` package modules, extensions, generated packages, browser-tool adapters, headless
automation adapters, and alternate app consumers do not import it. Prompt execution context
contracts, the content-stripping context constructor, and live `PromptExecutionRuntimeHandle` shape
are core-owned structural APIs. They are not bootstrap APIs, not public app-developer workflow
APIs, not renderer bridge payloads, not browser-tool inputs, and not headless automation inputs.
Runtime owns production derivation of prompt execution context input from durable state and queue
claims; app developers receive prompt execution information through state-backed read models and
runtime events, not by constructing turn contexts directly.

`prepareRuntimeShutdown(managedRuntime, input)` is the bootstrap-only pre-disposal shutdown barrier.
It marks runtime shutdown as started, rejects new facade and task-agent bridge admissions, closes
event subscriptions with typed close receipts, requests bounded queue/recovery/command/request-input
drain or terminalization, records shutdown receipts and app-log facts for interrupted user-visible
work through state ports, releases queue claims and runtime-local waiters, revokes task-agent bridge
tokens, and returns a shutdown receipt before app/bootstrap calls `managedRuntime.dispose()` /
`disposeEffect`. It does not close the database or platform resources itself; those resources close
when the app-owned `ManagedRuntime` disposes the acquired layer scope.

`RuntimeLayerConfigService` is a bootstrap-only service token exported from
`@svvy/runtime/bootstrap`, not from the package root. `Runtime.layer` may mention it only through an
exported bootstrap type alias such as `RuntimeLayerRequirements`. Application bootstrap code that
builds the root layer imports that type and `createRuntimeLayerConfigLayer(...)` from
`@svvy/runtime/bootstrap`.

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

`Events` names live runtime event types only: non-authoritative progress, stream, queue, command, or
read-model invalidation notifications published by runtime. `Invalidations` names the
`StateInvalidationDescriptor.invalidation.model` values returned by committed state writes. It does
not let callers fabricate descriptors.

Canonical promoted runtime method contract ledger:

| Method                                        | Input codec                               | Result codec                               | Public errors                                                                                                                                         | State/package ports                                                                                                                                                                                                                                                                                                                                                                                                              | Events                                                                                                                                                              | Invalidations                                                                                                  | Required tests                                                                               |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `workspaces.acquire`                          | `AcquireWorkspaceInputSchema`             | `AcquireWorkspaceResultSchema`             | `invalid-input`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                                             | `RuntimeWorkspaceStatePort.acquireWorkspace(...)` for durable workspace/session ownership facts; owner-scope `WorkspaceRuntimeMap.contextEffect(workspaceId)` for readiness-sensitive scoped runtime acquisition; `SourceInvalidationCoordinator.wake(...)`                                                                                                                                                                      | `runtime.lifecycle`                                                                                                                                                 | `sessionNavigation`                                                                                            | workspace acquire/create/reopen, duplicate owner, shutdown rejection                         |
| `workspaces.acquireDefault`                   | `AcquireDefaultWorkspaceInputSchema`      | `AcquireWorkspaceResultSchema`             | `invalid-input`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                                             | `RuntimeWorkspaceStatePort.acquireDefaultWorkspace(...)` for durable default-workspace facts; owner-scope `WorkspaceRuntimeMap.contextEffect(workspaceId)` for readiness-sensitive scoped runtime acquisition; `SourceInvalidationCoordinator.wake(...)`                                                                                                                                                                         | `runtime.lifecycle`                                                                                                                                                 | `sessionNavigation`                                                                                            | default workspace acquire, persisted cwd, startup readiness                                  |
| `workspaces.release`                          | `ReleaseWorkspaceInputSchema`             | `ReleaseWorkspaceResultSchema`             | `invalid-input`, `target-not-found`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                         | `RuntimeWorkspaceStatePort.releaseWorkspace(...)` for durable owner/reference facts; runtime closes the keyed workspace scope only when release policy says no live owner remains; `RuntimeRecoveryCoordinator.wake(...)`                                                                                                                                                                                                        | `runtime.lifecycle`                                                                                                                                                 | `surface`, `sessionNavigation`                                                                                 | release last owner, retained active surface, shutdown finalizer                              |
| `surfaces.createOrchestrator`                 | `CreateOrchestratorSurfaceInputSchema`    | `CreateSurfaceResultSchema`                | `invalid-input`, `target-not-found`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                         | `RuntimeSurfaceLifecycleStatePort.createOrchestratorSurface(...)` for durable surface/session facts; `RuntimeActorExtensionBindingStatePort.setActorExtensionBinding(...)` for initial generated-context binding facts; owner-scope `WorkspaceRuntimeMap.contextEffect(workspaceId)` followed by retained `SurfaceRuntimeMap.contextEffect(surfacePiSessionId)` acquisition for the live surface; `PiAdapter.sessions.create(...)` inside that retained surface scope only | `runtime.lifecycle`                                                                                                                                                 | `surface`, `sessionNavigation`                                                                                 | create surface, pi session reference, generated-context binding, invalid profile             |
| `surfaces.open`                               | `OpenSurfaceInputSchema`                  | `OpenSurfaceResultSchema`                  | `invalid-input`, `target-not-found`, `stale-state`, `runtime-shutdown`, `runtime-disposed`                                                            | `RuntimeSurfaceLifecycleStatePort.openSurface(...)` for durable open/reference facts; owner-scope `SurfaceRuntimeMap.contextEffect(surfacePiSessionId)` and `PiAdapter` for live scoped materialization; `PiSessionReferencePort.get(...)` / `validate(...)` for durable pi references                                                                                                                                           | `runtime.lifecycle`                                                                                                                                                 | `surface`, `sessionNavigation`                                                                                 | reopen existing pi session, missing reference, stale context                                 |
| `surfaces.close`                              | `CloseSurfaceInputSchema`                 | `CloseSurfaceResultSchema`                 | `invalid-input`, `target-not-found`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                         | `RuntimeSurfaceLifecycleStatePort.closeSurface(...)` for durable close/reference facts; runtime closes or interrupts keyed surface resources only after prompt-lock, wait, command, and retention policy allows it; `RuntimeCommandStatePort`, `RuntimeSessionWaitStatePort`, `RuntimeRequestStatePort` cleanup methods                                                                                                          | `runtime.lifecycle`, `surface.stream`                                                                                                                               | `surface`, `requestInput`, `commandInspector`                                                                  | close idle/running/waiting surface, active turn cancellation, wait cleanup                   |
| `messages.submit`                             | `SubmitMessageInputSchema`                | `SubmitMessageResultSchema`                | `invalid-input`, `target-not-found`, `target-not-ready`, `stale-state`, `state-conflict`, `backpressure`, `runtime-shutdown`, `runtime-disposed`      | `RuntimeQueueStatePort.acceptSubmittedSurfaceMessage(...)`                                                                                                                                                                                                                                                                                                                                                                       | `queue.changed`                                                                                                                                                     | `surface`, `requestInput`                                                                                      | enqueue-and-run, queue-only, idempotency, renderer-field rejection, after-commit publication |
| `messages.abort`                              | `AbortPromptInputSchema`                  | null                                       | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                          | `RuntimeQueueStatePort.cancelSurfaceMessage(...)` for queued rows; active-turn cancellation interrupts the runtime-owned active-turn fiber and records the terminal turn through `RuntimeTurnStatePort.finishTurn(...)`; affected command rows terminalize through `RuntimeCommandStatePort.finishCommand(...)` after live command/session cancellation is accepted or recovered                                                 | `queue.changed`, `surface.stream`                                                                                                                                   | `surface`, `commandInspector`, `requestInput`                                                                  | queued abort, active-turn abort, all-for-surface abort, terminal idempotency                 |
| `queues.steer`                                | `SteerQueuedMessageInputSchema`           | null                                       | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                          | `RuntimeQueueStatePort.markSurfaceMessageSteering(...)`                                                                                                                                                                                                                                                                                                                                                                          | `queue.changed`                                                                                                                                                     | `surface`, `sessionNavigation`                                                                                 | reorder FIFO, claimed-row rejection, duplicate steer idempotency                             |
| `commands.writeStdin`                         | `WriteCommandStdinInputSchema`            | `WriteCommandStdinResultSchema`            | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `backpressure`, `runtime-shutdown`, `runtime-disposed`                          | `RuntimeCommandStatePort.findCommandById(...)`, `RuntimeCommandSessionService.writeStdin(...)`, then `RuntimeCommandStatePort.recordStdinWrite(...)`                                                                                                                                                                                                                                                                             | `command.changed`                                                                                                                                                   | `commandInspector`                                                                                             | durable lookup, open stdin, closed stdin, backpressure, terminal command                     |
| `commands.cancel`                             | `CancelCommandInputSchema`                | `CancelCommandResultSchema`                | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                          | `RuntimeCommandStatePort.findCommandById(...)`, `RuntimeCommandSessionService.cancel(...)`, then `RuntimeCommandStatePort.finishCommand(...)` with cancelled terminal facts when the command is cancelable and not already terminal                                                                                                                                                                                              | `command.changed`                                                                                                                                                   | `commandInspector`, `surface`, `requestInput`                                                                  | running process cancel, already-terminal no-op, wait cleanup                                 |
| `commands.runExtensionDependencyAction`       | `RunExtensionDependencyActionInputSchema` | `RunExtensionDependencyActionResultSchema` | `invalid-input`, `target-not-found`, `approval-required`, `dependency-not-ready`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`            | `Extensions.dependencies.planInstallOrUpdate(...)`, `Sandbox.buildLaunchPolicy(...)`, `RuntimeCommandStatePort.startCommand(...)`, `Extensions.dependencies.refreshReadiness(...)` for immutable readiness evidence, `RuntimeExtensionStatePort.recordDependencyReadiness(...)` for persisted readiness facts after the runtime-owned command completes                                                                          | `command.changed`, descriptor-derived `app_read_model.changed`                                                                                                      | `commandInspector`, `extensions`, `appLogs`                                                                    | immutable plan validation, approval ledger mismatch, sandboxed subprocess                    |
| `approvals.answer`                            | `AnswerRuntimeApprovalInputSchema`        | `AnswerRuntimeApprovalResultSchema`        | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                          | `RuntimeApprovalStatePort.resolveApprovalRequest(...)`, `RuntimeWaitRegistry.resolve(...)`                                                                                                                                                                                                                                                                                                                                       | `workspace_read_model.changed`, `command.changed`                                                                                                                   | `runtimeApprovals`, `commandInspector`                                                                         | approve/deny, stale answer, wait resolution                                                  |
| `requestInput.answer`                         | `AnswerRequestInputInputSchema`           | `AnswerRequestInputResultSchema`           | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `backpressure`, `runtime-shutdown`, `runtime-disposed`                          | `RuntimeRequestStatePort.answerRequestInput(...)`, `RuntimeQueueStatePort.enqueueSurfaceMessage(...)` only when model delivery is required for a `request_user_input_answer` queue row, `RuntimeWaitRegistry.resolve(...)`                                                                                                                                                                                                       | always `workspace_read_model.changed`; `queue.changed` only when `delivery.kind === "nonblocking-queued"` and a `request_user_input_answer` queue row was committed | `requestInput`, `surface`, `commandInspector`; queue read-model invalidation only for committed queue delivery | blocking resolved, nonblocking queued, nonblocking recorded-only, duplicate submission       |
| `requestInput.setTimerPaused`                 | `SetRequestInputTimerPausedInputSchema`   | `SetRequestInputTimerPausedResultSchema`   | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                          | `RuntimeRequestStatePort.setRequestInputTimerPaused(...)`, `RuntimeWaitRegistry.updateTimer(...)`                                                                                                                                                                                                                                                                                                                                | `workspace_read_model.changed`                                                                                                                                      | `requestInput`                                                                                                 | pause/resume, no-timeout rejection, restart preserved pause                                  |
| `sourceEdits.open`                            | `OpenExtensionSourceEditInputSchema`      | `SourceEditSessionSchema`                  | `invalid-input`, `target-not-found`, `read-only-source`, `runtime-shutdown`, `runtime-disposed`                                                       | `Extensions.sources.openEditSession(...)`, `RuntimeSourceStatePort.readSourceVersion(...)`                                                                                                                                                                                                                                                                                                                                       | none                                                                                                                                                                | none                                                                                                           | extension open, read-only generated output, path authority rejection                         |
| `sourceEdits.save`                            | `SaveExtensionSourceEditInputSchema`      | `SourceEditSaveResultSchema`               | `invalid-input`, `target-not-found`, `read-only-source`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                      | `Extensions.sources.saveEditSession(...)`, `RuntimeSourceStatePort.recordSourceSave(...)`, `RuntimeRecoveryCoordinator.wake(...)`                                                                                                                                                                                                                                                                                                | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                        | `extensions`, `agents`, `workflowsGenerated`, `appLogs`                                                        | compare-and-swap save, stale save, overwrite, recovery after file-write/state-fail           |
| `sourceInvalidation.hint`                     | `SourceInvalidationHintSchema`            | null                                       | `invalid-input`, `unsupported-operation`, `runtime-shutdown`, `runtime-disposed`                                                                      | `RuntimeAppSourceInvalidationCoordinator.hint(...)` or `RuntimeWorkspaceSourceInvalidationCoordinator.hint(...)` after scope/domain validation                                                                                                                                                                                                                                                                                   | none for duplicate or ignored hints; committed scan work later publishes descriptor-derived events                                                                  | none directly                                                                                                  | scope/domain validation, generated-output ignored, debounce with TestClock                   |
| `sourceInvalidation.reconcile`                | `SourceReconcileRequestSchema`            | `SourceReconcileResultSchema`              | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `unsupported-operation`, `schema-error`, `runtime-shutdown`, `runtime-disposed` | `RuntimeAppSourceInvalidationCoordinator.reconcile(...)` for `scope: { kind: "app-global" }` domains `extensions` and `workflows`, or `RuntimeWorkspaceSourceInvalidationCoordinator.reconcile(...)` for `scope: { kind: "workspace" }` domains `external_instructions` and `host_snippets`; concrete calls listed in the source-invalidation section below                                                                 | descriptor-derived events after committed source facts, generated-package facts, link facts, app-log diagnostics, or recovery rows                                  | affected source/read-model invalidations only after commits                                                    | startup/manual/recovery scans, one scan per domain, failed scan recovery                     |
| `sourceInvalidation.refreshGeneratedContext`  | `RefreshGeneratedContextRequestSchema`    | null                                       | `invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                          | `Extensions.generatedContext.build(...)`, `RuntimeActorExtensionBindingStatePort.updateActorExtensionBinding(...)` when the refresh commits a new bound generated-context fingerprint, `RuntimeExtensionContextImpactStatePort.applySnapshotContextImpact(...)` when triggered by trusted context-impact transport, and `RuntimeGeneratedPackageStatePort` only when generated-package facts are refreshed in the same operation | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                        | `surface`, `extensions`                                                                                        | target refresh, workspace refresh, stale context banner                                      |
| `sourceInvalidation.refreshGeneratedPackages` | `RefreshGeneratedPackagesRequestSchema`   | `GeneratedPackagesRefreshResultSchema`     | `invalid-input`, `target-not-found`, `state-conflict`, `runtime-shutdown`, `runtime-disposed`                                                         | `Extensions.generatedPackages.refresh(...)`, `RuntimeGeneratedPackageStatePort.recordGeneratedPackageBuild(...)`, `Extensions.generatedPackages.planWorkspaceLink(...)`, `RuntimeGeneratedPackageStatePort.recordWorkspaceLinkStatus(...)`                                                                                                                                                                                       | descriptor-derived `app_read_model.changed` / `workspace_read_model.changed`                                                                                        | `workflowsGenerated`, `extensions`, `appLogs`                                                                  | app-global build, workspace-link repair, build failure keeps last ready                      |
| `events`                                      | `RuntimeEventsInputSchema`                | live `RuntimeEventSubscriptionEffect` / facade `RuntimeEventSubscription`; event values use `RuntimeEventSchema` and close receipts use `RuntimeEventSubscriptionCloseSchema` | `invalid-input`, `event-replay-unavailable`, `stream-failed`, `runtime-shutdown`, `runtime-disposed`                                                  | `RuntimeEventBus.subscribe(...)`                                                                                                                                                                                                                                                                                                                                                                                                 | subscribed runtime events                                                                                                                                           | none                                                                                                           | replay cursor, gap/rebaseline error, slow consumer close, close receipt                      |

Later domain tables may add detail, but they must not contradict this ledger or omit one of the
contract dimensions above.

The Promise/`AsyncIterable` facade has the same API groups and request payloads as the Effect
service, with these mechanical conversions only:

```ts
type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;

type RuntimeFacadeShape = {
  workspaces: RuntimeWorkspacesApiPromise;
  surfaces: RuntimeSurfacesApiPromise;
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
  commands: RuntimeCommandsApiPromise;
  approvals: RuntimeApprovalsApiPromise;
  requestInput: RuntimeRequestInputApiPromise;
  sourceEdits: RuntimeSourceEditsApiPromise;
  sourceInvalidation: RuntimeSourceInvalidationApiPromise;
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
runtime cancellation semantics; currently that means `messages.abort(...)`, `commands.cancel(...)`,
and subscription `close()` implementations. Other methods must reject the option with a typed
runtime facade error instead of inventing best-effort cancellation.

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
type RuntimeWorkspacesApiPromise = {
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

type RuntimeSurfacesApiPromise = {
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
- `workspaces.acquire(...)` starts or reuses the `WorkspaceRuntimeMap` entry, runs the workspace
  readiness gate, starts workspace-scoped workers/watchers/recovery in the workspace scope, and
  records workspace lifecycle/app-log facts through state ports before returning `readiness:
"ready"`.
- Workspace readiness is separate from app readiness. `AcquireWorkspaceResult.readiness: "ready"`
  requires workspace records loaded, prompt locks reconstructed, workspace source startup reconcile
  completed or a diagnostic/recovery row committed, and required workspace generated-package link
  repair completed or marked recovery-pending before generated imports are exposed as ready.
- `workspaces.release(...)` releases one owner ref. Runtime disposes the workspace scope only when no
  visual, headless, or background owner remains and runtime idle policy allows disposal.
- `surfaces.createOrchestrator(...)` commits durable surface/session and actor-binding facts first,
  then acquires or reuses the retained `SurfaceRuntimeMap` entry under the owning workspace runtime scope.
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
  and session state remain in `@svvy/state`.
- Every lifecycle method publishes only typed runtime lifecycle and read-model invalidation events
  after state commits. It never returns transcript arrays, generated prompt previews, pi-native
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

A promoted runtime API group must list its methods, schema-backed inputs/outputs, public typed error
reasons, state port calls, emitted runtime invalidations, and test-layer coverage in this spec.
Undefined groups are not part of the public runtime API. Package-private implementation scaffolding
may exist behind internal modules and tests only; public Effect services and Promise facades must
not expose callable placeholder groups.

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
  messageable surface named `thread`; all public target contracts use `surface: "handler"` for
  delegated handler-thread surfaces.
- Runtime-level worktree alignment and switching remain runtime-owned, but `worktrees` is not a
  public API group in this spec. `@svvy/state` remains the durable store for worktree identity,
  context rows, and read-model projection.

`sourceEdits` owns renderer/headless source open and save requests for file-backed extension and
Workflows source files. Runtime validates caller intent, delegates the actual file read or
compare-and-swap write to `@svvy/extensions`, receives the file-write receipt, fingerprint,
diagnostics, and source reference, then records the source-version, fingerprint, diagnostic, and
read-model facts through `@svvy/state` ports before scheduling the smallest required invalidation
and refresh work. `@svvy/extensions` writes source files and computes source evidence; it does not
persist durable source-version, fingerprint, diagnostic, read-model, or invalidation facts. Renderer
panes, browser tools, and headless callers never write these source files directly.

`sourceInvalidation` owns runtime-level reaction to file-backed source fingerprints and
DB/product-state-backed settings or snippet invalidations. It does not write source files and does
not treat generated output directories as watched inputs.

`SourceInvalidationHint` and `SourceReconcileRequest` validate scope/domain pairs. `scope:
"app-global"` accepts only `extensions` and `workflows`. `scope: "workspace"` accepts only
`external_instructions` and `host_snippets`. DB-backed settings, profile, and managed svvy snippet
writes enter runtime publication only through committed `afterCommit` descriptors returned by state
ports; they are not `SourceDomain` values and are never watcher hints.

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

type RuntimeMessagesApiPromise = {
  submit(
    input: SubmitMessageInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<SubmitMessageResult>;
  abort(input: AbortPromptInput, options?: RuntimeFacadeCallOptions): Promise<void>;
};

type RuntimeQueuesApiPromise = {
  steer(input: SteerQueuedMessageInput, options?: RuntimeFacadeCallOptions): Promise<void>;
};
```

`SubmitMessageInput`, `SubmitMessageResult`, and `PromptTarget` are defined in `@svvy/core`.

Runtime command API:

```ts
type RuntimeCommandsApiEffect = {
  runExtensionDependencyAction(
    input: RunExtensionDependencyActionInput,
  ): Effect.Effect<RunExtensionDependencyActionResult, RuntimeContractError>;
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

type RuntimeCommandsApiPromise = {
  runExtensionDependencyAction(
    input: RunExtensionDependencyActionInput,
    options?: RuntimeFacadeCallOptions,
  ): Promise<RunExtensionDependencyActionResult>;
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
      acceptedBytes: ByteCount;
    }
  | {
      commandId: CommandId;
      status: "stdin_closed" | "not_running" | "already_terminal";
    };

type RuntimeApprovalsApiPromise = {
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

type RunExtensionDependencyActionInput = {
  scope: {
    kind: "app-global";
    originWorkspaceId?: WorkspaceId;
  };
  extensionId: ExtensionId;
  requirementId: string;
  action: "install" | "update";
  targetVersion?: string;
  clientSubmission?: RuntimeClientSubmissionInput;
};

type RunExtensionDependencyActionResult = {
  commandId: CommandId;
  status: "running" | "queued";
};

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

Workspace-scoped bridge adapters may use `workspaceId` only to select the already-acquired
workspace runtime scope before calling this facade. `workspaceId` is not part of
`WriteCommandStdinInput`; command authority is validated by durable `CommandId` inside the
addressed runtime/state port. Cross-workspace command ids fail as `target-not-found` or a typed
bridge validation error. They are never retried against another workspace, active tab, focused
pane, or Shell `session_id`.

Concrete command and approval facade calls:

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
  reason: "User approved dependency install.",
  clientSubmission: {
    clientRequestId: "approval_9_confirm",
    source: "desktop",
  },
});
// =>
// {
//   approvalId: "approval_9",
//   commandId: "cmd_dep_9",
//   status: "approved",
// }
```

`Runtime.approvals.answer(...)` is part of the canonical runtime service and facade. Approval waits
must not be answered through command cancellation, prompt abort, state facades, or renderer-only
adapters.

`runExtensionDependencyAction(...)` is the user-clicked Extensions UI dependency command path.
Runtime asks the `@svvy/extensions` dependency planning service for an immutable command plan, then
runs the child process through the normal command lifecycle: approval linkage, sandbox launch
policy, scoped process, stdout/stderr streaming, terminal command facts, dependency readiness
refresh, app-log facts, and read-model invalidations. It is not available to agents as a model tool;
agent-initiated installs remain ordinary Shell `exec_command` work.

Dependency install/update actions are app-global because extension dependency artifacts live
under the app-owned extension package/install root, not inside a user workspace. `scope.kind` is
therefore required and must be `"app-global"`. `scope.originWorkspaceId` is optional UI lineage for
routing the inline output panel and related app-log links back to the workspace from which the user
clicked the action; it is not a workspace execution scope, does not grant workspace filesystem
writes, and must not affect the dependency approval ledger key. Runtime uses the app-owned
extension package/install root as `cwd`, records app-scoped command and dependency facts, uses the
app-global dependency approval ledger key from the immutable plan, and builds a sandbox snapshot
whose writable roots are limited to the extension package install area plus app-owned temp/cache
roots needed by the selected package manager. Runtime must not infer dependency-action scope from
the active tab, focused pane, selected session, last opened workspace, shell approval mode, or
`full-access` command setting. The returned `commandId` is enough for later cancellation and
inspection; callers refetch app-scoped command/readiness read models from state and may use
`originWorkspaceId` only to place those product links near the originating workspace UI.

Before calling `@svvy/sandbox`, runtime maps this public dependency-action scope to the core-owned
sandbox launch scope `{ kind: "app-global-extension-dependency", originWorkspaceId }` and uses
`launchKind: "extension_dependency_action"`. That mapping is the only place the shorter public
`"app-global"` dependency-action label is translated into sandbox launch policy.

`cancel(...)` is the public command cancellation entrypoint for desktop and automation consumers.
The input carries only the durable `commandId`, optional user/runtime reason, and optional client
submission telemetry. Runtime resolves workspace, surface, running process, approval wait, command
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
installing placeholder methods.

Source edit API:

```ts
type RuntimeSourceEditsApiEffect = {
  open(input: OpenExtensionSourceEditInput): Effect.Effect<SourceEditSession, RuntimeContractError>;
  save(
    input: SaveExtensionSourceEditInput,
  ): Effect.Effect<SourceEditSaveResult, RuntimeContractError>;
};

type RuntimeSourceEditsApiPromise = {
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
Runtime does not define a renderer-specific source save shape. `open(...)` delegates the file read
to `@svvy/extensions`, then returns the source version, fingerprint, text, and diagnostics for the
draft editor. `save(...)` delegates compare-and-swap or explicit overwrite to `@svvy/extensions`;
the extension service atomically replaces the file and returns the file-write receipt, new
fingerprint, generated diagnostics, and source reference. Runtime records the source-version,
fingerprint, diagnostic, and read-model facts through `@svvy/state` ports after the file write,
then schedules source-invalidation recovery if reconciliation is required. Runtime publishes only
typed read-model invalidations after committed state changes. The result never includes generated
prompt previews, generated package contents, renderer draft state, or UI conflict-control fields;
callers refetch the affected read models after invalidation notifications.

Workflow-agent, workflow-prompt, workflow-component, and workflow source create/duplicate/delete are
not promoted runtime APIs in this spec revision. They are app-owned Workflows source-library
operations and may become `sourceEdits` methods only when one patch lands all of the following:
exact `@svvy/core` schemas and result types; `@svvy/extensions` source operations that perform the
file write/delete; `@svvy/state` source-fact write ports with `StateInvalidationDescriptor`
after-commit values; `@svvy/runtime` Effect service methods; Promise facade wiring; package
boundary tests; positive and negative contract tests for collisions, stale source versions,
read-only generated output, invalid owners, and generated-package refresh scheduling. Until that
patch lands, desktop, browser-tools, headless adapters, and generated packages must not expose
placeholder lifecycle methods or approximate them by direct file writes.

Desktop, browser-tools, and headless facade adapters delegate `sourceEdits` through an explicit
source-edit port. The adapter does not read or write source files itself. The shipped app bootstrap
provides this port before exposing the full source-edit facade. Separately named test-only
adapters that are not returned by `createRuntimeFacade(...)` may omit `sourceEdits` instead of
installing placeholder methods.

Source invalidation API:

```ts
type RuntimeSourceInvalidationApiEffect = {
  hint(input: SourceInvalidationHint): Effect.Effect<void, RuntimeContractError>;
  reconcile(
    input: SourceReconcileRequest,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  refreshGeneratedContext(
    input: RefreshGeneratedContextRequest,
  ): Effect.Effect<void, RuntimeContractError>;
  refreshGeneratedPackages(
    input: RefreshGeneratedPackagesRequest,
  ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
};

type RuntimeSourceInvalidationApiPromise = {
  hint(input: SourceInvalidationHint, options?: RuntimeFacadeCallOptions): Promise<void>;
  reconcile(
    input: SourceReconcileRequest,
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

`SourceDomain`, `SourceInvalidationScope`, `SourceInvalidationHint`, `SourceReconcileRequest`,
`SourceReconcileResult`, `GeneratedPackagesRefreshResult`, and
source invalidation input shapes are imported from `@svvy/core`; runtime does not redefine
source-invalidation contract shapes.

`sourceInvalidation` is a runtime coordination group, not a renderer state-write API. Browser tools,
headless automation, tests, app bootstrap, and runtime recovery may call its public methods when
they need to drive file-backed source reconciliation or generated refresh work programmatically.
Desktop renderer panes do not call it for DB/product-state-backed UI writes; they use state command
facades and then refetch read models from runtime notifications.

`hint(...)` is an advisory file-backed source hint that schedules deterministic source scans or
narrower source refresh work; it does not trust raw watcher events as authoritative state.
`reconcile(...)` runs deterministic scans for startup, periodic backstop, watcher-debounce, manual,
or recovery reasons. `refreshGeneratedContext(...)` and `refreshGeneratedPackages(...)` call the
corresponding runtime refresh services at their existing safe scheduling boundaries.

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

`sourceInvalidation` does not return best-effort preview diagnostics. Durable diagnostics are
written as app-log, source-fingerprint, generated-context, generated-package, or recovery facts and
then read through state read models.

Product-state invalidation enters runtime event publication only as committed
`afterCommit: readonly StateInvalidationDescriptor[]` values returned by state-backed write ports or
collected by app-owned command/runtime boundary adapters after successful state writes. Public
runtime facades do not accept raw `StateInvalidationDescriptor` values. Any public
descriptor-driven invalidation method requires PRD and runtime/state spec updates, must require a
real state write result rather than caller-authored descriptors, and must reject descriptors supplied
by desktop, renderer, browser-tool, headless, generated-package, or extension callers.
DB/product-state-backed invalidations must not be implemented by watching generated outputs,
renderer panes, or caller-authored descriptor payloads. Product hosts always expose the complete
package-root `Runtime`/`RuntimeFacade` contract. Only separately named test adapters may omit
source-invalidation operations, and they must not approximate a missing refresh by emitting only a
preview event.

Runtime publishes committed descriptors through the package-private runtime event bus via
`publishStateInvalidations({ afterCommit })`, preserving descriptor order and mapping each
descriptor to `app_read_model.changed` or `workspace_read_model.changed`. Publication failure never
rolls back committed state. It also must not silently drop post-commit work: the runtime-owned
post-commit lane records an app-log/recovery observation and wakes or creates the appropriate
recovery row when the committed descriptor or queue lane still needs downstream delivery. Duplicate
prevention belongs to the state write/idempotency boundary. Any
receipt contract used for publication idempotency must be named in both `@svvy/core` and
`@svvy/runtime` package specs before implementation.

`hint(...)` is a watcher hint. It schedules deterministic fingerprint scans and never treats the
changed path as authoritative by itself. App-global hints use `scope: { kind: "app-global" }` and
only cover Extensions and Workflows source roots. Workspace hints use
`scope: { kind: "workspace", workspaceId }` and only cover external instruction candidates and
discovered host snippet sources for that workspace. Runtime publication handles
DB/product-state-backed writes that already committed through `@svvy/state`, such as settings,
profile, or managed-snippet changes, only through the returned `afterCommit` descriptors. Source
diagnostics produced by source edits or source reconciliation publish the returned invalidation
descriptors through the source-invalidation flow, not as independent DB-backed write examples. The
two refresh methods accept only the dedicated
`RefreshGeneratedContextRequest` and `RefreshGeneratedPackagesRequest` inputs. Those inputs may share
inner payload schemas with closed runtime-effect variants, but public runtime facades never accept a
`RuntimeEffectRequest` envelope. The envelope is carried only inside ordered
`ExtensionRuntimeOperation` items returned from extension handlers to runtime.

Promoted `sourceInvalidation` method contracts:

| Method                            | State/package calls                                                                                                                                                                                                                                                                                                                                                          | Emitted invalidations/events                                                                                                                                                                                                                                                                                                                             | Required tests                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hint(input)`                     | validate scope/domain/root path; enqueue/coalesce coordinator work in the app-global or workspace source coordinator; no state write until deterministic scan confirms a change                                                                                                                                                                                              | none for ignored duplicate hints; after scan commits, publish runtime events derived from returned `afterCommit` descriptors                                                                                                                                                                                                                             | rejects invalid scope/domain/root path pairs; coalesces duplicate hints; ignores generated outputs; uses TestClock debounce                                                                              |
| `reconcile(input)`                | dispatch to `RuntimeAppSourceInvalidationCoordinator.reconcile(...)` for app-global `extensions` / `workflows` domains or `RuntimeWorkspaceSourceInvalidationCoordinator.reconcile(...)` for workspace `external_instructions` / `host_snippets` domains; coordinators may call only `Extensions.sources.*` source evidence methods, `Extensions.externalInstructions.scan(...)`, `Extensions.externalInstructions.validateActorUsage(...)`, `Extensions.generatedContext.build(...)`, `Extensions.generatedPackages.refresh(...)`, `Extensions.generatedPackages.planWorkspaceLink(...)`, `RuntimeSourceStatePort.recordSourceSave(...)` / `recordSourceDelete(...)`, `RuntimeActorExtensionBindingStatePort.setActorExtensionBinding(...)` / `updateActorExtensionBinding(...)`, `RuntimeGeneratedPackageStatePort.recordGeneratedPackageBuild(...)` / `recordGeneratedPackageFailure(...)` / `reconcileGeneratedPackageManifest(...)` / `markGeneratedPackageRefreshNeeded(...)` / `recordWorkspaceLinkStatus(...)`, and `RuntimeRecoveryStatePort.ensureRecoveryWork(...)` / `failOrRetryRecoveryWork(...)` | return `changedReadModelCount`, `generatedPackageRefreshes`, and `recoveryWorkIds`; publish runtime events derived from committed state `afterCommit` descriptors plus app-log diagnostics. The returned count is a receipt only; callers refetch read models through state facades instead of receiving invalidation descriptors in the Promise result. | startup/periodic/manual/recovery reasons; all-domain default; one scan per coordinator/domain; failed scan recovery row                                                                                  |
| `refreshGeneratedContext(input)`  | schedule or run generated-context build through `@svvy/extensions`, persist actor binding and stale/freshness facts through `RuntimeActorExtensionBindingStatePort` and `RuntimeExtensionContextImpactStatePort`                                                                                                                                                             | generated-context, Agents/Extensions, and affected surface stale/read-model invalidations after commit                                                                                                                                                                                                                                                   | safe pre-dispatch refresh; opt-out surfaces remain stale; invalid source keeps previous ready context                                                                                                    |
| `refreshGeneratedPackages(input)` | schedule app-global generated-package refresh through `@svvy/extensions`, record app-global build/failure facts through generated-package state ports, then wake acquired workspace link-repair workers; each worker separately asks `@svvy/extensions` for a `planWorkspaceLink(...)` result and records workspace-link facts only after applying runtime-owned link repair | app-scoped `workflowsGenerated` invalidations for `@svvyx/workflows` build and workspace-link facts, and app-scoped `extensions` invalidations for `@svvyx/extensions` build and workspace-link facts; explicit workspace-link repair calls return `workspaceLinks` in `GeneratedPackagesRefreshResult` as a command receipt, not as read-model payload  | `@svvyx/extensions` before dependent `@svvyx/workflows`; app-global build once; unopened workspace repair recovery; refresh result never contains workspace-link plans; failure keeps prior ready output |

For `scope: "app-global"`, `refreshGeneratedPackages(...)` returns only app-global build statuses,
and recovery work ids for any scheduled follow-up. Matching app read-model invalidations are
published as runtime events after committed generated-package state facts. Workspace link repair is
woken only after the generated-package fact commit and is reported by later `workflowsGenerated` or
`extensions` app read-model invalidations, depending on the repaired generated package, or by
explicit `scope: "workspace-link-repair"` command receipts. The app-global result must not
pretend synchronous workspace-link repair has completed unless the request scope is
`workspace-link-repair`.

Generated-package invalidations are emitted only from descriptors returned by
`RuntimeGeneratedPackageStatePort` commits. `refreshGeneratedPackages(...)` records build and link
facts through state before returning or publishing any invalidation; build success alone is not
publishable product state.

Every source-invalidation state write returns after-commit `StateInvalidationDescriptor` values from
the state-backed port that performed the write. Runtime publishes notifications only from those
descriptors or live scoped stream patches. Runtime does not publish source previews, generated
package contents, generated-context text, or renderer cache payloads as events.

Rules:

- Callers submit only the new user message, delivery intent, addressed target, and optional client
  submission metadata.
- Callers must not submit full pi message arrays.
- Callers must not submit `systemPrompt`, generated-context previews, generated prompt fingerprints,
  loaded extension ids, or available extension ids.
- Runtime reads the managed surface, bound generated-context record, model/provider/reasoning
  selection, queue state, prompt freshness state, and extension usage from `@svvy/state`.
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
has accepted the committed invalidations. Runtime owns this ordering. The wake boundary receives
only post-submit facts needed to wake the addressed queue lane: `target`, `queuedMessageId`,
normalized `delivery`, optional `clientSubmission`, computed `RuntimePromptTelemetrySummary`, and
the public acceptance `receipt`. It does not receive the authoritative queued message payload, raw
submit input, event invalidation list, state-port result, or any mutable runtime handle. It must not
insert queue rows, publish runtime events, mutate state directly, change the public submit result,
or decide that a failed pi dispatch means the durable submit did not happen. Queue workers and pi
turn dispatch are runtime-owned services.

Promoted message and queue method contracts:

| Method                   | State/package calls                                                                                                                                                                                                                                                        | Emitted invalidations/events                                                                                                          | Required tests                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `messages.submit(input)` | validate target surface and workspace ownership; call `RuntimeQueueStatePort.acceptSubmittedSurfaceMessage(...)` to insert one durable `user_message` queue row, clear the durable composer draft, and invalidate stale delayed draft persistence in one state transaction | publish composer, queue, surface, and session read-model invalidations only after commit; wake the queue dispatcher only after commit | idle submit, active-turn submit, invalid target, idempotent client request, composer draft clear, queue wake-after-commit |
| `messages.abort(input)`  | cancel queued rows or interrupt the active turn through state and active-turn services according to `AbortPromptInput.mode`                                                                                                                                                | publish queue, turn, command, request-input, and surface invalidations only after terminal/cancel facts commit                        | queued cancel, active-turn cancel, all-for-surface cancel, stale turn id, exactly-once prompt-lock release                |
| `queues.steer(input)`    | update only an existing queued row's steering status/sequence through `RuntimeQueueStatePort`                                                                                                                                                                              | publish `queue.changed` and queue/composer read-model invalidations after commit; wake only the addressed surface queue               | same-surface validation, queued-only validation, claim order, no active-turn mutation                                     |

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
  close(): Effect.Effect<void, never>;
  readonly closed: Effect.Effect<RuntimeEventSubscriptionClose, never>;
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
matching generation is accepted only as a best-effort current-runtime hint and must fail with
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
  "streamSequence": 22,
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
  production `RuntimeLayerEventsPort`, event sequencing callback, replay buffer, subscriber queue,
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

- Runtime exposes one app-scoped public event stream per app `ManagedRuntime`. Workspace runtime
  scope services may use internal workspace-local hubs, but public `RuntimeEvent.sequence` values come from
  one app-wide monotonically increasing counter so app-scoped events such as
  `app_read_model.changed` and workspace-scoped events share one cursor space.
- Runtime-event ownership and app-runtime ownership are inseparable. `RuntimeEventBus` is acquired
  once inside the single app-owned `ManagedRuntime` layer graph that also owns all
  `WorkspaceRuntimeMap` entries. A per-workspace `ManagedRuntime` or per-workspace
  `RuntimeEventBus` is invalid even if each individual bus is package-private, because it creates
  multiple public cursor spaces and breaks app-scoped replay/rebaseline semantics.
- Desktop, browser-tools, and headless facade adapters delegate `events(...)` through the
  bootstrap-created runtime facade. An adapter whose facade call fails during subscription setup
  fails before returning a stream with `RuntimeEventStreamError` and reason `"stream-failed"`. It
  must not return `Stream.empty` as a placeholder, because an empty stream means the runtime is
  correctly connected and has no notifications to deliver at that moment.
- Runtime event fanout uses runtime-owned per-subscriber bounded queues acquired by the event bus
  layer. A shared `PubSub` is not the public event authority because a single `publishUnsafe(false)`
  result cannot identify the subscriber that failed to accept a live event.
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
  `surfacePiSessionId` for the active stream generation. A `stream_reset` patch is the terminal
  patch for the old generation and includes the current authoritative transcript/read-model cursor.
  Consumers discard all buffered live patches for that surface, refetch the authoritative
  transcript/read model, and only then accept patches from the new generation. Consumers use
  `streamSequence` to detect missed live patches for one surface and use
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
  `RuntimeEventSubscriptionClose`, not through stream failure. If a future design needs failing
  post-subscription streams, it must update this event-bus section and the Effect v4 primitive
  record in the same change, choosing either per-subscriber
  `Queue<Take.Take<RuntimeEvent, RuntimeEventError>>` or a named `PubSubTake` hub with explicit
  cursor, replay, and slow-subscriber semantics.

## Runtime Resource Lifetimes

| Resource                                      | Owner package/service                                                | Backing kind                                                                                                                     | Lifetime kind                            | Acquired by                                                                                                            | Released by                                                                                                                        | Reused across calls | Interruption behavior                                                                                            | Required receipts/tests                                                         |
| --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| App runtime event bus                         | `@svvy/runtime` `RuntimeEventBus`                                    | replay ring, sequence state, per-subscriber bounded queues                                                                       | `layer-acquired`                         | `Runtime.layer` acquisition                                                                                            | app runtime shutdown/restart                                                                                                       | yes                 | shutdown closes subscribers with typed shutdown/rebaseline, not success                                          | event published, subscription attached/closed, slow-consumer and shutdown tests |
| `WorkspaceRuntimeMap` entry                   | `@svvy/runtime` workspace registry                                   | `LayerMap.Service` child scope                                                                                                   | `keyedLayerMapScoped`                    | `workspaces.acquire(...)`                                                                                              | owner release, invalidation, idle TTL, app shutdown                                                                                | yes                 | finalizers release workers/watchers; durable rows remain recoverable                                             | workspace acquired/released/finalized receipts                                  |
| `SurfaceRuntimeMap` entry                     | `@svvy/runtime` surface registry                                     | `LayerMap.Service` child scope                                                                                                   | `keyedLayerMapScoped`                    | `surfaces.open(...)`, turn delivery, wait/command retention                                                            | release, invalidation, idle TTL, app shutdown                                                                                      | yes                 | finalizers interrupt pi streams, waits, command sessions; state recovery owns restart                            | surface acquired/released/finalized receipts                                    |
| Workflow task-attempt runtime                 | `@svvy/runtime` workflow task bridge                                 | `LayerMap.Service` child scope                                                                                                   | `keyedLayerMapScoped`                    | authenticated `runTaskAgent` bridge acceptance                                                                         | terminal attempt, invalidation, idle TTL, app shutdown                                                                             | yes for attempt     | interruption records task-attempt recovery/terminal facts when required                                          | task attempt acquired/terminalized/finalized receipts                           |
| Prompt lock                                   | `@svvy/runtime` surface turn manager                                 | `Semaphore` or equivalent scoped lock                                                                                            | `keyedLayerMapScoped`                    | `SurfaceRuntime.layer(...)`                                                                                            | surface scope close                                                                                                                | yes                 | interruption releases once; durable active-turn recovery decides next work                                       | prompt lock acquired/released and no double-release tests                       |
| Active turn fiber                             | `@svvy/runtime` active turn manager                                  | `FiberMap` keyed by `surfacePiSessionId`                                                                                         | `operationScoped`                        | durable turn claim after prompt lock                                                                                   | terminal settlement, cancel, timeout, interruption                                                                                 | no                  | interruption terminalizes or records recovery and releases prompt lock exactly once                              | turn dispatched/terminalized, busy/requeue tests                                |
| Queue dispatcher and wakeup queue             | `@svvy/runtime` workspace queue worker                               | bounded queue plus scoped fiber                                                                                                  | `keyedLayerMapScoped`                    | workspace runtime scope acquisition                                                                                          | workspace/app scope close                                                                                                          | yes                 | per-row failures persist retry/failed facts; worker failure follows worker policy                                | queue row claimed, retry, terminal, drain receipts                              |
| Recovery coordinator                          | `@svvy/runtime` workspace/app recovery worker                        | scoped fiber and durable leases                                                                                                  | `layer-acquired` / `keyedLayerMapScoped` | runtime/workspace acquisition                                                                                          | workspace/app scope close                                                                                                          | yes                 | active claims settle or expire by durable lease; no process-local truth                                          | recovery sweep completed receipts                                               |
| Title worker                                  | `@svvy/runtime` title service                                        | scoped fiber plus helper pi operation                                                                                            | `keyedLayerMapScoped`                    | workspace runtime scope acquisition                                                                                          | workspace/app scope close                                                                                                          | yes                 | active helper interruption records retry/recovery when needed                                                    | title claimed/terminalized receipts                                             |
| Request-input wait registry                   | `@svvy/runtime` request-input/approval wait service                  | process-local registry keyed by durable wait id; service acquired with the surface runtime scope, entries acquired per wait              | `keyedLayerMapScoped`                    | `SurfaceRuntime.layer(surfacePiSessionId)`                                                                             | surface/workspace/app scope close                                                                                                  | yes within scope    | interruption releases process-local waiters; durable wait/recovery rows remain authoritative                     | registry acquired/released, no durable-truth tests                              |
| Request-input wait entry                      | `@svvy/runtime` request-input service                                | scoped single-use `Deferred` plus durable wait row reference                                                                      | `operationScoped`                        | `request_input.create` after durable wait/request facts commit                                                         | answer, timeout, cancel, turn interruption, recovery terminalization, surface/workspace close                                      | no                  | interruption keeps durable wait/recovery rows authoritative and resolves/fails the scoped deferred once           | wait created/resolved/timeout/interrupted receipts                              |
| Accepted native-tool execution lane           | `@svvy/runtime` accepted tool runner                                 | command-scoped Effect operation plus ordered operation queue/command context                                                      | `operationScoped`                        | `pi.tool_call.accepted` after creating or reusing the durable command row                                               | model-facing tool result, waiting state, failure, cancellation, or recovery fact committed                                         | no                  | interruption terminalizes or records recovery before returning a pi tool result/error                             | ordered operation application, command fact before pi acknowledgement            |
| App/workspace source coordinators             | `@svvy/runtime` source services                                      | watchers, debounce queues, scan fibers                                                                                           | `layer-acquired` / `keyedLayerMapScoped` | runtime/workspace acquisition                                                                                          | scope close                                                                                                                        | yes                 | watcher failures become diagnostics/recovery after retry exhaustion                                              | source reconcile and recovery receipts                                          |
| Generated-package refresh worker              | `@svvy/runtime` generated package worker                             | scoped fiber plus command/recovery rows                                                                                          | `layer-acquired`                         | `Runtime.layer` acquisition; source invalidation, explicit build, and recovery rows wake/claim work inside that worker | app/workspace scope close                                                                                                          | yes                 | keeps prior ready output on build failure; scope close interrupts active build and records recovery where needed | generated package refresh completed receipts                                    |
| Workspace link-repair worker                  | `@svvy/runtime` workspace generated-link repair                      | scoped fiber plus workspace link plan                                                                                            | `keyedLayerMapScoped`                    | workspace acquisition or generated root commit                                                                         | workspace/app scope close                                                                                                          | yes                 | unopened workspaces receive recovery rows; acquired workspaces retry through recovery                            | link repair completed/recovery receipts                                         |
| Command sessions/subprocess handles           | `@svvy/runtime` command/session service                              | pipe-backed child process handles, bounded stdin queue, stdout/stderr pump fibers, terminal observer fiber, output batcher state | `operationScoped`                        | accepted command plan launch                                                                                           | process exit after output flush, cancel/timeout after stdin close and process stop/kill, app shutdown after terminal/recovery fact | no                  | stdin closes deterministically; output terminal facts/recovery remain durable                                    | command terminalized, output ordering, closed-stdin receipts                    |
| Workflow task-agent bridge operation registry | app/bootstrap loopback transport plus `@svvy/runtime` bridge service | bootstrap-owned `POST /runTaskAgent` binding plus runtime-owned token lineage map and operation registry                         | `appBootstrapScoped` + `layer-acquired`  | app bootstrap creates transport; runtime acquisition creates operation service                                         | app shutdown/restart                                                                                                               | yes                 | restart invalidates tokens; in-flight attempts settle/recover through state                                      | bridge accepted/rejected/finalized receipts                                     |
| Facade event subscriptions                    | runtime facade adapter                                               | scoped stream subscription                                                                                                       | `bridgeSubscriptionScoped`               | `events(...)` facade call                                                                                              | unsubscribe, iterator return/throw, runtime close                                                                                  | no                  | captured `Exit` closes subscription; gaps require rebaseline                                                     | subscription attached/closed tests                                              |
| Bridge `AsyncIterable` scopes                 | browser/headless bridge adapter                                      | adapter fiber over runtime stream                                                                                                | `bridgeSubscriptionScoped`               | browser/headless subscription call                                                                                     | caller abort/return, runtime close                                                                                                 | no                  | captured `Exit` closes iterator; stale cursors rejected                                                          | iterator close, abort, rebaseline tests                                         |

Finalizers run sequentially by default so terminal/recovery facts, output flushes, queue release
receipts, and subscription close receipts have deterministic ordering. A package may use parallel
finalization only for named sibling resources that have no ordering dependency and whose tests prove
their receipts are independent, such as closing two watcher handles after their shared scan fiber
has already stopped. Command sessions close stdin, stop/kill the process as required, flush
stdout/stderr batches, record terminal/recovery facts, and release process handles in that order.

Workspace and surface runtime scope maps use `LayerMap.Service` for keyed acquisition, invalidation, idle
disposal, and app shutdown finalization. Runtime acquires live surface entries through the
workspace-owned surface lifecycle service when the intended lifetime is the live surface; it must
not acquire `SurfaceRuntimeMap.get(surfacePiSessionId)` only inside a one-shot facade method scope
for that case. A workspace-owned surface lifecycle service owns the retained surface borrow and
scope. One-shot operations borrow the already-acquired surface through an internal `withSurface(...)`
helper; releasing that operation borrow must not dispose a surface still retained by runtime policy,
active turn state, waits, command sessions, workflow task-attempt state, or open UI/headless
consumers.

Package-private keyed runtime maps are config-driven. The snippet is illustrative; the actual
implementation resolves the TTL fields from `RuntimeLayerConfigService` during layer acquisition and
does not hard-code idle values:

```ts
const makeRuntimeMapLayers = Effect.gen(function* () {
  const runtimeLayerConfig = yield* RuntimeLayerConfigService;

  class WorkspaceRuntimeMap extends LayerMap.Service<WorkspaceRuntimeMap>()(
    "@svvy/runtime/WorkspaceRuntimeMap",
    {
      lookup: (workspaceId: WorkspaceId) => WorkspaceRuntime.layer(workspaceId),
      idleTimeToLive: runtimeLayerConfig.workspaceRuntimeIdleTtlMs,
    },
  ) {}

  class SurfaceRuntimeMap extends LayerMap.Service<SurfaceRuntimeMap>()(
    "@svvy/runtime/SurfaceRuntimeMap",
    {
      lookup: (surfacePiSessionId: SurfacePiSessionId) => SurfaceRuntime.layer(surfacePiSessionId),
      idleTimeToLive: runtimeLayerConfig.surfaceRuntimeIdleTtlMs,
    },
  ) {}

  class WorkflowTaskAttemptRuntimeMap extends LayerMap.Service<WorkflowTaskAttemptRuntimeMap>()(
    "@svvy/runtime/WorkflowTaskAttemptRuntimeMap",
    {
      lookup: (workflowTaskAttemptId: WorkflowTaskAttemptId) =>
        WorkflowTaskAttemptRuntime.layer(workflowTaskAttemptId),
      idleTimeToLive: runtimeLayerConfig.workflowTaskAttemptRuntimeIdleTtlMs,
    },
  ) {}

  return { WorkspaceRuntimeMap, SurfaceRuntimeMap, WorkflowTaskAttemptRuntimeMap };
});
```

`Runtime.layer` owns the map services. Workspace acquisition retains `WorkspaceRuntimeMap` entries
until the workspace is released, invalidated, idle for the TTL, or the app runtime scope closes.
Workspace-owned surface lifecycle retains `SurfaceRuntimeMap` entries while a surface is active,
waiting, streaming, command-running, attached to UI/headless consumers, or otherwise retained by
runtime policy; release, invalidation, idle TTL, or app shutdown are the only disposal paths.
Workflow task-agent bridge acceptance retains `WorkflowTaskAttemptRuntimeMap` entries until the
attempt reaches terminal state, is invalidated by recovery, idles past the TTL, or app shutdown
closes the scope. Runtime tests use `layerTest` plus `RuntimeTestHarness` receipts for acquisitions,
releases, invalidations, and scope finalizers; they must not rely on sleeping past TTLs.

Readiness-sensitive workspace, surface, and workflow task-attempt acquisition uses
`*.contextEffect(key)` in the owning scope with the map service already provided. `*.get(key)` may be
used only to provide a keyed resource to an already-scoped operation; it is not the readiness signal
for `AcquireWorkspaceResult.readiness`, `OpenSurfaceResult`, worker attachment, generated-context
binding, or workflow task-agent bridge acceptance.

```ts
type SurfaceRuntimeRegistry = {
  acquire(
    input: AcquireSurfaceRuntimeInput,
  ): Effect.Effect<SurfaceRuntimeLease, RuntimeContractError>;
  release(input: ReleaseSurfaceRuntimeInput): Effect.Effect<void, RuntimeContractError>;
  withSurface<A, E, R>(
    input: SurfaceRuntimeTarget,
    effect: Effect.Effect<A, E, R | SurfaceRuntime>,
  ): Effect.Effect<A, E | RuntimeContractError, R>;
  invalidate(input: SurfaceRuntimeTarget): Effect.Effect<void, RuntimeContractError>;
};
```

`AcquireSurfaceRuntimeInput` includes a stable `ownerId` and `ownerKind`
(`"workspace" | "desktop-window" | "browser-tool" | "headless" | "turn" | "command" | "wait" |
"workflow-task"`). Acquiring the same surface with the same owner id is idempotent and returns the
existing lease. Acquiring with a different owner id increments a retained-owner count and records
the owner for diagnostics. Releasing an unknown owner is an idempotent no-op with a receipt, not a
reason to dispose the surface. Releasing the final owner schedules idle disposal; it does not
interrupt an active turn, wait, command session, workflow task-attempt, or open subscription until
that retained work also releases. Owner ids are unique within one app runtime graph and are not
persisted as durable recovery evidence. During tab retarget, runtime acquires the new owner before
releasing the old owner so there is no disposal gap. Invalidation marks the entry closing, rejects
new owners, waits for current borrows to leave or terminalizes them by runtime policy, then
invalidates the `LayerMap` key. Tests cover duplicate acquire, double release, owner replacement,
borrow during invalidation, and finalizer ordering.

`LayerMap.invalidate(key)` is not treated as revocation of active work by itself. Active borrowed
contexts keep running until their scoped operation exits, is interrupted by an explicit runtime
policy decision, or records a terminal/recovery fact. Invalidation first marks the runtime entry
closing in package-private registry state so no new owners/borrows are accepted; then runtime either
lets active turns, waits, command sessions, subscriptions, and workflow task attempts drain, or
interrupts them through the domain-specific terminalization/recovery path named in this spec. Only
after those domain receipts exist may the `LayerMap` key be invalidated and finalizers run.

Runtime keeps in-memory state only for active coordination. Durable state remains in
`@svvy/state`.
Pending user messages are durable queue rows in `@svvy/state`. Runtime owns claiming, delivery,
retry, cancellation, and event publication for those rows.

Runtime state ownership matrix:

| Category                             | Backing                                                                                                                                                                         | Examples                                                                                                                                                                                                                                                        | Owner rule                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Durable queue and turn state         | SQLite/product state                                                                                                                                                            | queue rows, queue claim owner/lease, turn rows, delivered/failed/cancelled facts, active-turn recovery rows                                                                                                                                                     | `@svvy/state` stores; `@svvy/runtime` mutates only through state ports and publishes after-commit notifications                          |
| Durable command state                | SQLite/product state plus artifact files                                                                                                                                        | command rows, command events, argument snapshots, stdout/stderr/output facts, child-command links, terminal facts, artifact metadata                                                                                                                            | runtime command/session services write through state/artifact ports; extension handlers produce results/plans only                       |
| Durable request/input/wait state     | SQLite/product state                                                                                                                                                            | request-input requests, questions, options, answers, blocking wait timeout facts, nonblocking answer delivery queue rows                                                                                                                                        | runtime request-input services own waits and answer delivery; state stores facts                                                         |
| Durable source/generated facts       | SQLite/product state plus file-backed source inputs; generated output is `@svvy/extensions`-owned build output indexed by state facts, not a watcher trigger or source of truth | source fingerprints, source versions, diagnostics, generated-context bindings, generated package manifests, workspace-link facts                                                                                                                                | source-owning packages mutate files, state stores fingerprints/manifests/link facts, and runtime schedules invalidation and refresh work |
| Durable recovery/title/app-log state | SQLite/product state                                                                                                                                                            | recovery work rows, title job rows, app log rows, normalized error rows                                                                                                                                                                                         | runtime/state workers claim and settle through state ports                                                                               |
| Process-local runtime coordination   | Effect runtime memory                                                                                                                                                           | prompt locks, active turn fibers, command-session handles, pi handles, wait registries, queue wakeup channels, explicit runtime event replay rings, subscriber queues, source watcher handles, debounce queues, readiness latches, `LayerMap` borrowed contexts | runtime owns in scoped services; state is re-read after restart and no process-local value is treated as durable evidence                |
| UI-only view state                   | renderer memory                                                                                                                                                                 | focus, scroll, open menus, warm read-model caches, pane layout drag state, optimistic draft UI                                                                                                                                                                  | desktop owns; it never replaces state read models or runtime events                                                                      |

If a value must survive app restart, rebaseline another process, appear in command inspectors, or
participate in recovery, it is DB/product-state-backed or file-backed source evidence. If it only
orders live work, wakes a worker, fans out recent notifications, cancels a running handle, or
coordinates one scoped session, it is Effect process-local state.

Runtime live-state primitives are chosen per lane:

| Runtime lane                                                                                                                                                               | Effect primitive                                                                                                               | Why                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low-cardinality process-local status snapshots, such as surface runtime scope status, command-session status, source-coordinator status, and workflow bridge subscription status | `SubscriptionRef` only when code needs both a current snapshot and a scoped change stream; otherwise `Ref` / `SynchronizedRef` | exposes process-local status to runtime services without turning it into durable event history; active-turn ownership still lives in durable state plus prompt locks and `FiberMap`, not in `SubscriptionRef` |
| Prompt locks, wait registries, queue wakeup state, tool-call-to-command maps, last emitted argument snapshot maps, and cancellation bookkeeping                            | `SynchronizedRef`, `Ref`, `Semaphore`, `Deferred`, or `Queue` as appropriate                                                   | coordinates live work without snapshot/change-stream semantics                                                                                                                                                |
| Runtime event fanout and live surface stream patches                                                                                                                       | replay ring plus `Queue` / `Stream` owned by the event service                                                                 | notifications and live patches only; durable recovery uses state                                                                                                                                              |
| Replaceable watcher, scan, turn, or helper lanes                                                                                                                           | `FiberHandle`, `FiberMap`, `FiberSet`, or `ScopedRef`                                                                          | ensures replacement interrupts/closes the prior scoped resource                                                                                                                                               |

Do not introduce another mutable live-state abstraction for these lanes. If a new lane needs both
snapshot reads and a change stream, use `SubscriptionRef`; otherwise use the narrower primitive that
matches the coordination need. `SubscriptionRef` is allowed only for low-frequency,
low-cardinality, process-local status. Do not use it for runtime events, `surface.stream` patches,
command output, queue wakeups, app logs, or any high-rate lane. Each `SubscriptionRef` owner names
its scope, expected update cardinality/frequency, and subscriber close path in the owning package
spec or service contract.

Runtime startup side effects begin only when app/bootstrap acquires `Runtime.layer` through the
app-owned `ManagedRuntime`. Constructing a `Layer` value or importing a module does not start
watchers, workers, source scans, or event hubs. `managedRuntime.context()` proves the layer graph
was acquired; it is not by itself semantic startup readiness. App/bootstrap then calls
`awaitRuntimeStartupReadiness(managedRuntime)` before constructing or exposing facades. That helper
waits until app-scoped startup checks, initial app source reconciliation, required recovery scans,
and generated-package startup reconciliation have either completed, committed allowed degraded
diagnostic/recovery facts, or failed startup. The wait is bounded by
`RuntimeLayerConfig.runtimeStartupReadinessTimeoutMs`; timeout fails startup with a typed runtime
startup error and app/bootstrap disposes the acquired `ManagedRuntime` before retrying.

Runtime startup effects are split by ownership scope:

- `Runtime.layer` acquisition starts only app-scoped services: the package-private runtime event bus
  that backs public `Runtime.events(...)`, app-runtime sequence state, workspace/surface `LayerMap`
  services, app-global recovery lanes, and the app-global source coordinator.
- The app-global source coordinator watches only Workflows and Extensions source roots, treats
  watcher events as hints, runs deterministic fingerprint scans, schedules app-global generated
  package refresh for startup/source/manual/recovery reasons, and fans out workspace-link repair to
  acquired workspace runtime scopes only after generated-package facts commit. App-global
  generated-package refresh never runs once per workspace runtime scope.
- Package-private `WorkspaceRuntimeMap` entry acquisition starts workspace-scoped queue workers, one
  workspace source coordinator, generated-package workspace-link repair, workspace recovery lanes,
  and workspace read-model publication subscriptions inside the single app-owned `ManagedRuntime`.
- Each workspace source coordinator watches only external instruction candidates and discovered
  read-only host snippet Markdown sources for that workspace. Generated package outputs, extension
  build output, workspace `.smithers/node_modules/@svvyx/*` links, and `.svvy/generated` previews
  are never watcher triggers. DB-backed settings, profile, and managed snippet writes return
  committed state results plus `afterCommit` descriptors; runtime publishes public notifications
  from those descriptors rather than from file watchers.
- `SurfaceRuntime.layer(surfacePiSessionId)` acquisition starts only surface-scoped coordinators:
  prompt locks, request-input timer/wait supervisors, queue/recovery subscriptions for that
  surface, and command-session registries. It does not start a turn fiber or subscribe to a pi turn
  stream until a durable queue claim and turn-row commit creates concrete turn work. Active turn
  fibers, pi stream subscriptions, accepted-tool fibers, lease-refresh fibers, and blocking
  request-input handoffs are operation-scoped children owned by the claimed turn/command/wait scope.
- Every long-lived loop started during layer acquisition uses `Effect.forkScoped` and returns
  promptly. Package layers must not hide unscoped background promises, global timers, or
  process-lifetime watchers.

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
  generatedPackageBuildConcurrency: PositiveSafeInteger; // default 1
  generatedPackageWorkspaceLinkRepairConcurrency: PositiveSafeInteger; // default 2
  generatedPackageGlobalLinkRepairConcurrency: PositiveSafeInteger; // default 1
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
export type RuntimeLayerRequirements =
  | RuntimeLayerConfigService
  | AppLogWritePort
  | RuntimeWorkspaceStatePort
  | RuntimeSurfaceLifecycleStatePort
  | RuntimeComposerDraftStatePort
  | RuntimeArtifactStatePort
  | RuntimeQueueStatePort
  | RuntimeTurnStatePort
  | RuntimeCommandStatePort
  | RuntimeApprovalStatePort
  | RuntimeThreadStatePort
  | RuntimeActorExtensionBindingStatePort
  | RuntimeEpisodeStatePort
  | RuntimeRequestStatePort
  | RuntimeSessionWaitStatePort
  | RuntimeSourceStatePort
  | RuntimeExtensionContextImpactStatePort
  | RuntimeGeneratedPackageStatePort
  | RuntimeRecoveryStatePort
  | RuntimeReadModelStatePort
  | ExtensionStatePort
  | PiSessionReferencePort
  | Sandbox
  | PiAdapter
  | Extensions
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | Clock.Clock;
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
```

The package root value exports only the explicit root symbol surface listed in the package API
section above. `layerConfig`, `layerWithConfig`, bootstrap config helpers, transport host helpers,
queue workers, prompt runners, request appliers, and event-bus internals are not public root exports.

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

- queue wakeups use `Queue.sliding(queueWakeupCapacity)` plus a dirty-key set; dropped wakeups are
  harmless hints because the worker rereads durable queue rows.
- source invalidation hints use `Queue.sliding(sourceHintQueueCapacity)` plus dirty-domain tracking;
  dropped hints are harmless because scans recompute deterministic fingerprints.
- event fanout uses the runtime-owned replay ring plus one bounded runtime-event queue sized by
  `eventSubscriberBufferCapacity` per public subscription. Publication appends to the replay ring and
  then performs a nonblocking bounded offer only to subscribers whose filters match the event.
  Per-subscriber overflow closes that subscriber with a bridge/subscription close payload and normal
  stream completion. Overflow may not block state commits, queue claims, command settlement, or
  prompt turns after durable state has committed.
- command stdin uses a per-command `Queue.dropping(commandStdinQueueCapacity)` admission queue.
  Effect v4 `Queue.offer(...)` on a dropping queue yields `false` when a full queue rejects the new
  value; the queue itself does not raise typed backpressure. `RuntimeCommandSessionService.writeStdin(...)`
  must check that boolean result and map `false` to `RuntimeContractError` reason `"backpressure"`
  while recording no stdin event. The command stdin writer drains accepted chunks losslessly and in
  FIFO order. Runtime never drops accepted stdin text silently.
- command output is batched with `commandOutputBatchMaxChunks`,
  `commandOutputBatchMaxLatencyMs`, and `commandOutputBatchMaxBytes`. A batch flushes when any
  threshold is reached, when the process exits, before terminal command settlement, and before a
  command-session handle is released. Output above `commandOutputArtifactThresholdBytes` is retained
  through the state/artifact command-output path instead of duplicating unbounded text in live
  events or command result summaries.

Every runtime worker uses `Clock`/`Schedule` and test layers can override this config. Worker cadence
is:

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

| Worker                           | First run                                                                   | Steady cadence                                                                                                                       | Persisted facts touched                                                                                                     | Scope shutdown                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| App source coordinator           | immediate startup reconcile after `Runtime.layer` acquisition               | debounce watcher hints with `sourceDebounceMs`; periodic `Schedule.fixed(appSourceReconcileIntervalMs)`                              | app-global source fingerprints, generated-package facts, diagnostics, app read-model invalidations                          | `Effect.forkScoped`; closes watchers, debounce fibers, and scan fibers                                       |
| Workspace source coordinator     | immediate reconcile after `WorkspaceRuntime.layer(workspaceId)` acquisition | debounce watcher hints with `sourceDebounceMs`; periodic `Schedule.fixed(workspaceSourceReconcileIntervalMs)`                        | workspace external-instruction and host-snippet fingerprints, diagnostics, workspace/app invalidations                      | workspace scope close interrupts watchers, debounce fibers, and scans                                        |
| Queue dispatcher                 | wakes after queue-row commits and during workspace startup recovery         | wakeup queue drain plus periodic recovery scan through `Schedule.fixed(recoveryScanIntervalMs)`                                      | queue claims, turn rows, delivery/failed/cancelled facts, recovery leases                                                   | workspace/surface scope close interrupts drain fibers; durable rows remain recoverable                       |
| Recovery coordinator             | immediate startup scan                                                      | `Schedule.fixed(recoveryScanIntervalMs)`                                                                                             | recovery work rows, command/turn/queue/request-input recovery facts                                                         | workspace/app scope close releases claims by lease expiry or terminal facts already committed                |
| Title job worker                 | immediate scan for pending title jobs                                       | `Schedule.fixed(titleJobScanIntervalMs)`                                                                                             | title job claim/terminal facts and session/thread title rows                                                                | workspace scope close interrupts active helper job and leaves durable retry state                            |
| Request-input timeout worker     | immediate scan for overdue blocking waits                                   | `Schedule.fixed(requestInputTimeoutScanIntervalMs)`                                                                                  | request-input timeout facts, timeout-default answer facts, command waiting/terminal facts through `RuntimeCommandStatePort` | surface/workspace scope close interrupts only process-local waits; durable timeout rows remain authoritative |
| Generated-package refresh worker | wakes after source invalidation, explicit build, and recovery rows          | event-driven plus recovery scan through `Schedule.fixed(recoveryScanIntervalMs)`                                                     | generated-package build/link facts, diagnostics, app/workspace invalidations                                                | app/workspace scope close interrupts builds at safe boundaries and records recovery rows where needed        |
| Runtime event bus                | starts at `Runtime.layer` acquisition                                       | no periodic schedule; explicit runtime replay ring uses `eventReplayCapacity`; subscriber queues use `eventSubscriberBufferCapacity` | no durable facts; publishes after committed state writes                                                                    | app scope shutdown closes subscription queues and receipts                                                   |

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
use `@effect/vitest` `TestClock` to prove restart timing, cap behavior, exhaustion, and readiness
failure.

Runtime owner services expose package-private readiness only for runtime-owned app/workspace/surface
scopes after their startup effects have acquired resources and state-backed checks have succeeded.
The readiness service is package-private and has this shape:

```ts
type RuntimeOwnerReadiness = {
  awaitReady(): Effect.Effect<void, RuntimeStartupError>;
  markReady(input: { at: IsoDateTimeString }): Effect.Effect<void, never>;
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

Facade pending-call policy:

| State                                    | Groups                                                                               | Policy                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Before app readiness                     | all public facade groups                                                             | fail, capacity 0; bridge callers receive a typed startup-pending/startup-failed error and no Effect is admitted                               |
| App ready, workspace not acquired        | `workspaces.acquire` / `workspaces.acquireDefault`                                   | admitted; waits only for workspace readiness bounded by runtime config                                                                        |
| App ready, target workspace/surface dead | surfaces, messages, queues, commands, approvals, request-input, source-edits, events | fail with typed target-not-ready or target-not-found; no unbounded wait                                                                       |
| Shutdown started                         | all groups                                                                           | fail immediately with typed shutdown error; no new queue wakeups, event subscriptions, commands, source scans, or waits are admitted          |
| `ManagedRuntime` disposed                | all groups                                                                           | fail with typed disposed/runtime-closed error mapped from Effect defect/interruption; app/bootstrap must create a new runtime before retrying |

Readiness gates are explicit:

| Gate                                    | Scope         | Primitive                        | Required before                                                  | Success condition                                                                          | Degraded-ready condition                                                                                       | Terminal failure                                                                                    |
| --------------------------------------- | ------------- | -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| State migrations and schema checks      | app           | layer acquisition                | any runtime/state facade exposure                                | migrations complete and schema/version checks pass                                         | none                                                                                                           | migration, schema, or database open failure                                                         |
| App source reconcile                    | app           | `Latch` plus startup readiness   | runtime facade exposure and generated import claims              | app-global fingerprints, generated-package facts, diagnostics, and invalidations committed | diagnostic plus recovery row committed while a previous ready generated package remains available              | no readable previous ready output for an import surface that would be exposed as ready              |
| Runtime event bus acquisition           | app           | layer acquisition plus receipt   | event facade exposure and after-commit notification              | replay ring, generation id, subscriber map, publication lane, and shutdown hooks acquired  | none                                                                                                           | event bus acquisition failure                                                                       |
| Recovery startup scan                   | app/workspace | readiness receipt                | app readiness for app rows; workspace acquire for workspace rows | eligible recovery rows scanned, claimed work scheduled, and stale claims reconciled        | diagnostic plus recovery row committed for noncritical work that can be retried by the recovery worker         | unable to scan required recovery rows or commit recovery facts                                      |
| Workspace source reconcile              | workspace     | `Latch` plus workspace readiness | `workspaces.acquire(...).readiness: "ready"`                     | workspace external-instruction and host-snippet facts committed                            | diagnostic plus recovery row committed; affected read models show diagnostics and generated imports stay stale | workspace facts cannot be loaded or diagnostics/recovery rows cannot be committed                   |
| Workspace generated-package link repair | workspace     | readiness receipt                | generated imports are reported ready for a workspace             | required links are applied and workspace-link facts committed                              | blocked/missing link status committed and read models report the workspace link as not ready                   | link state cannot be inspected or workspace-link facts cannot be committed                          |
| Surface prompt binding restore          | surface       | owner readiness receipt          | `surfaces.open(...)` and prompt-bearing dispatch                 | persisted pi session reference and generated-context binding are loaded                    | stale binding loaded with opted-out stale state visible                                                        | surface belongs to another workspace, is hard-deleted, or required prompt-binding facts cannot load |

Every degraded-ready condition must name the committed diagnostic, recovery, or read-model fact that
proves the degraded state and must name which API groups or generated imports remain disabled or
stale. A method may return `readiness: "ready"` only after the table's success or degraded-ready
condition for that scope is satisfied.
Startup readiness events are published as app-scoped lifecycle notifications only:

```ts
type RuntimeLifecycleEvent =
  | {
      type: "runtime.lifecycle";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      status: "ready";
      at: IsoDateTimeString;
    }
  | {
      type: "runtime.lifecycle";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      status: "startup_failed";
      at: IsoDateTimeString;
    }
  | {
      type: "runtime.lifecycle";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      status: "shutting_down";
      at: IsoDateTimeString;
    };
```

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

Runtime owns the bridge operation semantics: transport auth shape/body-size validation, request
decoding, bearer-token lineage authorization through decoded `workspaceSessionId` /
`sourceCommandId`, workflow-task-attempt surface
creation, queueing, pi turn orchestration, response encoding, command facts, recovery, and
notifications. App/bootstrap owns the transport binding. The shipped transport is an
app-bootstrap Bun loopback HTTP adapter using `Bun.serve` on `127.0.0.1` with a command-scoped
bearer token and generated environment variables. It exposes exactly `POST /runTaskAgent`, decodes
the source DTO with `@svvy/core`, validates token and command lineage after decode and before
idempotency, state writes, command facts, queueing, or pi orchestration, encodes the closed core
result/error DTOs, and closes with app/runtime shutdown. Transport adapters may reject missing or
malformed auth headers and oversized bodies before body decode; token lineage checks that depend on
decoded ids happen only after `RunTaskAgentSourceInput` decode. This transport is not an Effect
`HttpServer` / `HttpRouter` layer, and the base `Runtime.layer` has no Effect HTTP server
requirement. Alternate transports are outside the shipped contract unless a separate spec defines a
named app-bootstrap bridge layer that preserves the same one-operation runtime bridge contract.

The bridge exposes exactly one operation, `runTaskAgent`. Generated package code sends
`RunTaskAgentSourceInput`, a plain source DTO whose ids and paths are strings. Runtime decodes and
validates that source DTO into the branded `RunTaskAgentInput` before authorization, queueing,
state writes, command facts, or pi orchestration. `RunTaskAgentSourceInput`, `RunTaskAgentInput`,
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
core bridge DTOs, while app/runtime remains the owner of schema decoding with `@svvy/core`. It maps
transport failure into the closed `RunTaskAgentError` contract, and never imports `@svvy/runtime`,
`@svvy/state`, `@svvy/extensions`, Effect, Electrobun APIs, app bridge APIs, Smithers internals, or
broad process environment values.
The generated client cannot inspect, resume, approve, list, or debug Smithers workflows; it only
submits the current task-agent prompt to the authenticated runtime bridge.

Canonical command-scoped bridge environment:

| Env var                                    | Required | Value owner     | Meaning                                                                               |
| ------------------------------------------ | -------- | --------------- | ------------------------------------------------------------------------------------- |
| `SVVY_WORKFLOW_AGENT_BRIDGE_URL`           | yes      | `@svvy/runtime` | Exact local `POST /runTaskAgent` endpoint URL for the command-scoped bridge instance. |
| `SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN`         | yes      | `@svvy/runtime` | Unguessable bearer token scoped to `(workspaceSessionId, sourceCommandId)`.           |
| `SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID` | yes      | `@svvy/runtime` | Owning top-level workspace session id carried as an unbranded source DTO string.      |
| `SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID`    | yes      | `@svvy/runtime` | Owning handler-thread command id carried as an unbranded source DTO string.           |
| `SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS`    | no       | `@svvy/runtime` | Positive integer request timeout in milliseconds for the generated bridge client.     |

No other environment variable is part of the generated bridge contract. Generated package
instructions must not document or accept short aliases.

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
    model: "gpt-5.4",
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

Equivalent message-list prompt source:

```ts
const promptSource: RunTaskAgentInput["promptSource"] = {
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
- A request carries exactly one prompt source: either `prompt` or `messages`. Supplying both or
  neither is a schema error. `messages` may contain only user and assistant text messages; system
  prompt material is never accepted through this bridge.
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
  task-attempt lifecycle, generated-context binding, recovery scheduling, and pi turn orchestration.

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

Production context input is derived only by `@svvy/runtime` after queue claim and state reads. It is
never accepted from the UI, desktop bridge, browser tools, headless callers, Smithers bridge
callers, or generated packages. `SubmitMessageInput` remains only target, message, delivery intent,
and client telemetry. Workflow task-agent attempts receive a normal `TurnId` plus task-attempt
identity; `workflowTaskAttemptId` never replaces the turn identity used by command facts,
transcript projection, or runtime events.

The context shape, content-stripping `createPromptExecutionContext(...)` constructor, and live
`PromptExecutionRuntimeHandle` holder type are exported by `@svvy/core` because app-edge tool
wrappers and extension handlers need structural prompt invocation context without depending on
`@svvy/runtime/bootstrap`. `@svvy/runtime/bootstrap` must not re-export those names. Runtime still
owns production derivation and lifecycle: it passes state-derived identities, bindings, wait facts,
generated-context facts, queue identity, and external-instruction summaries into the core
constructor. The core constructor may normalize optional/null fields and strips accidental
external-instruction `content`; it is not a UI, bridge, browser-tool, headless, extension-handler,
or generated-package submission surface. The schema below is not a second runtime-local contract;
it is the core-exported `PromptExecutionContext`.

Exact core schema:

```ts
type PromptExecutionContext = {
  workspaceId: WorkspaceId;
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
  revision from validated state after queue claim. Missing production state is a contract/state
  error.
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
surfaces in this target spec. Blocking answers resolve the waiting command directly, record the
answer in request-input product state, and never create a `request_user_input_answer` queue row.

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
  `{ run, node, rootDir }`, and exactly one prompt source as either a prompt string or non-empty
  user/assistant messages. The payload has no top-level `rootDir`, no caller-supplied `threadId`,
  and no duplicated `sourceCommandId`.

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
  and `orderingKey`. Runtime owns the policy that writes priority, `orderingKey`, steering facts,
  retry timing, and cancellation state before claim.
- Runtime uses Effect `Queue` only as a bounded wakeup channel after durable changes. Effect queues
  never hold authoritative prompt payloads, retry counters, or delivery state.
- `RuntimeQueueDispatcher` uses a coalesced `Queue.sliding<QueueWakeupKey>(queueWakeupCapacity)`
  plus a `SynchronizedRef` dirty-key set. Producers enqueue only non-authoritative keys after the
  state transaction commits. The drain loop reads durable rows until empty, so correctness never
  depends on preserving every wakeup hint.
- `RuntimeQueueDispatcher` is a scoped supervisor plus a `FiberMap` of active drain fibers keyed by
  `(workspaceId, surfacePiSessionId, orderingKey)`. It keeps an `activeKeys` set in the same
  `SynchronizedRef` state as the dirty set. At most one drain fiber may run for a key at a time. A
  wake for an active key marks it dirty but does not fork another drain. The active drain owns the
  follow-up pass before clearing the key.
- Runtime owns an internal queue dispatcher service:

  ```ts
  type QueueWakeup = {
    workspaceId: WorkspaceId;
    surfacePiSessionId: SurfacePiSessionId;
    orderingKey: string;
    reason: "enqueue" | "steer" | "retry_due" | "lease_released" | "recovery";
  };

  type RuntimeQueueDispatcher = {
    wake(input: QueueWakeup): Effect.Effect<void, RuntimeContractError>;
    drain(input: {
      surfacePiSessionId: SurfacePiSessionId;
      orderingKey: string;
    }): Effect.Effect<void, RuntimeContractError>;
  };
  ```

The target `RuntimeQueueDispatcher` is an internal runtime service, not a package-root generic host
adapter. It claims through state ports using `surfacePiSessionId` plus `orderingKey`, owner id, and
lease version, and it wakes only from after-commit hints or recovery scans. Generic promise-host
dispatch helpers may exist only as test-only utilities and must not satisfy the target queue
delivery contract.

Wakeups are coalescible hints. `drain(...)` loops claim/process work until
`RuntimeQueueStatePort.claimNextQueuedSurfaceMessage(...)` returns `null`. `wake(...)` adds the
canonical key to the dirty set before offering it to the sliding queue. `drain(...)` clears a key
only after the durable claim loop returns empty and the key was not dirtied while active. If the key
was dirtied while active, `drain(...)` runs one follow-up durable claim pass before clearing it. If
the yielded `Queue.offer(...)` result is `false` after shutdown, runtime maps it to the typed
shutdown/no-op path, not to an accepted wakeup. Periodic recovery and lease-release work wake due
retry/lease rows. Correctness
comes from durable queue rows, transactional claim order, and recovery scans, not from receiving
every in-memory wakeup value.

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
  and opted in for that surface, create the turn record, send the accepted user/control message
  through `@svvy/pi-adapter`, then settle the queue row from the pi accept/delivery outcome.
- Delivery into pi occurs only after a successful claim commit.
- Successful delivery and failed delivery are recorded transactionally.
- Active turns are keyed by `surfacePiSessionId` in the process-local active turn manager. Queue
  delivery under the surface prompt lock checks both durable active-turn state and the process-local
  `FiberMap` before claiming another prompt-bearing row. `FiberMap.run(..., { onlyIfMissing: true })`
  is used only after the durable turn row/claim boundary commits. An already-active result maps to a
  typed busy/requeue outcome without claiming another row or interrupting the existing turn.
  Blocking request-input keeps the turn fiber and prompt lock until answer, timeout, cancel, or
  interruption. Terminal settlement removes the active fiber and releases the prompt lock exactly
  once.
- The active turn manager observes every `FiberMap` turn-fiber exit and maps it to exactly one
  terminal durable outcome: success commits completed turn/queue facts, typed failure commits the
  corresponding failed/cancelled/retryable facts, defects are normalized into app-log plus
  turn/queue recovery or terminal failure facts, and interruption commits cancellation/recovery
  facts according to the interrupt reason. The manager completes or fails waiters, settles stream
  generation, releases the prompt lock once, removes the active-fiber entry, and publishes
  invalidations only after the terminal transaction commits. A turn fiber exit is never ignored and
  never produces more than one terminal state transition.
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
and consumes `@svvy/pi-adapter` output as a sequential `Stream<PiRuntimeEvent, PiAdapterError>`.
The stream consumer is the only owner that may translate pi deltas into live `surface.stream`
patches, streamed tool argument snapshots, accepted tool calls, assistant output commits, turn
terminal facts, queue settlement, and recovery rows for that turn.

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
The registry may contain request-input, approval, and external-dependency waits, but it is never the
source of truth. It is a runtime-owned internal service, not a durable wait store and not a state
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
read-model invalidations only from committed `StateMutationResult.afterCommit` descriptors.

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

| Source failure                                                                 | Runtime lane                                                                                   | Public mapping                                                                                                           | Durable/app-log handling                                                                                                      |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `StateContractError.reason === "invalid-input"`                                | any public method before state mutation                                                         | `RuntimeContractError` with the method operation and reason `"invalid-input"`                                             | no recovery row; app-log only when the caller is not the user-facing source of the invalid payload                            |
| `StateContractError.reason === "target-not-found"` / stale owner or lease       | lifecycle, queue, command, request-input, recovery                                              | `target-not-found` or `stale-state` according to the method ledger                                                        | no retry unless a recovery row already owns the stale durable condition                                                        |
| transient SQLite busy/locked, transaction contention, or state commit conflict   | queue claim, command settlement, source/generation commit, recovery                             | `state-conflict` for synchronous public calls; worker lanes record retryable `StateStoredError`                           | retryable when idempotency key and lane policy permit; otherwise terminal failed fact                                          |
| `PiAdapterError` before pi accepts a prompt-bearing item                         | queue delivery / surface materialization                                                        | `target-not-ready`, `state-conflict`, or `runtime-shutdown` only when the ledger names that reason                        | queue row may retry pre-accept; surface lifecycle failure is recorded through surface/recovery/app-log facts                   |
| `PiAdapterError` after pi accepts a turn or while consuming the pi event stream  | active turn fiber                                                                               | not returned to the original submit caller; active turn terminalizes as failed/cancelled/recoverable                      | turn, queue, command, and recovery facts record the normalized `StateStoredError`                                              |
| `ExtensionError` from declaration build or accepted tool handler                | generated-context refresh, native tool declaration, accepted tool execution                     | mapped to ledger reason `schema-error`, `unsupported-operation`, `target-not-found`, or `state-conflict` as applicable    | command/tool facts and app-log diagnostics are committed; extensions do not publish runtime events directly                    |
| `SandboxPolicyError` or sandbox launch denial                                   | command/session/dependency-action execution                                                     | `RuntimeContractError` reason `"sandbox-denied"` only on methods whose ledger names it; otherwise command terminal facts  | command facts include sandbox-denial classification and redacted policy path facts; no retry unless policy source changes      |
| child-process spawn/stdio/exit errors                                           | command/session execution                                                                       | command terminal facts, not raw process errors on public facades except command-control admission errors                  | stdout/stderr facts flush before terminal settlement; recovery row only when process state is ambiguous                        |
| schema decode/encode failure for persisted JSON or generated transport payloads | bridge, recovery, source/generation, command signed-result transport                            | `invalid-input`, `schema-error`, or closed bridge error according to the lane                                             | redacted `StateStoredError` plus app-log diagnostic; no retry unless the payload source is mutable and a new scan can fix it   |
| app/runtime shutdown or disposed runtime                                        | any lane                                                                                        | `runtime-shutdown` or `runtime-disposed`                                                                                 | shutdown preparation records visible cancellation/recovery receipts before scope finalizers release resources where possible   |

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
  | { kind: "interrupted"; interruptReason: "caller-abort" | "runtime-cancel" | "shutdown" | "scope-close" };
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
against an abort listener while the Effect fiber remains unobserved; it uses the caller
`AbortSignal` supported by `ManagedRuntime.runPromise(...)`, `runPromiseExit(...)`, or
`runCallback(...)` for the facade-owned runner. If the owner-managed effect later commits state, it
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

| Lane                                           | Retryable reasons                                                                 | Non-retryable reasons                                                                                 | Schedule source                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| queue delivery before pi acceptance             | transient state conflict, pi target temporarily unavailable, generated-context refresh retryable failure | invalid input, target deleted, user cancellation, pi accepted the message                              | `queueRetryInitialDelayMs`, `queueRetryMaxDelayMs`, `queueRetryMaxAttempts`                      |
| active turn after pi acceptance                 | none as same-message replay; recovery may reattach or terminalize                 | pi accepted prompt then failed, defect after committed turn                                            | `active_turn_recovery` row, not queue retry                                                      |
| source reconcile / generated context refresh    | transient filesystem/read errors, transient generated-package build dependency readiness | schema-invalid source, deleted source, stale save conflict                                             | `sourceRetryInitialDelayMs`, `sourceRetryMaxDelayMs`, `sourceRetryMaxAttempts`                   |
| generated-package refresh / workspace link repair | transient filesystem/package-link errors, missing generated output while another app-global build is pending | schema-invalid generated source, unapproved dependency, deleted workspace                              | recovery retry config plus per-kind `orderingKey`                                                |
| command process reconciliation                  | ambiguous process state, transient state write conflict                           | observed terminal process exit already committed, sandbox denied by current policy                     | recovery retry config                                                                            |
| title generation                                | transient provider/pi helper failure                                               | deleted surface, unsupported model, user-disabled title generation                                    | title worker schedule plus terminal title-job facts                                              |
| request-input / approval wait recovery          | missed timer wake, state conflict, runtime restart                                 | answered/denied/cancelled terminal row, owning surface deleted                                        | recovery retry config with `notBefore` from timeout/deadline                                     |
| worker restart                                  | worker fiber defect or typed transient failure after durable recovery fact exists | repeated startup scan failure beyond max attempts, configuration invalid                              | bounded supervisor schedule; readiness fails only for required startup rows                      |

### Runtime Observability

Runtime emits app logs and metrics only from runtime-owned services after redaction. Observability is
not a second state channel and does not carry raw prompts, secrets, full stdout/stderr, unredacted
schema payloads, or renderer snapshots.

| Runtime lane                     | Span/metric boundary                                      | App-log facts                                                                 | Required labels                                               |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| queue claim/delivery             | claim attempt, delivery attempt, terminal settlement       | retry/failed/cancelled delivery, stale lease, repeated worker failure          | workspace id hash, surface kind, queue row kind, reason       |
| pi turn execution                | turn start, pi stream consumption, terminal settlement     | pi adapter failure, defect, recovery row creation, stale generated context     | actor kind, surface kind, model provider id, closed reason    |
| accepted native-tool execution   | accepted tool call, handler result, operation application  | handler failure, invalid runtime operation, no direct extension state write    | extension id, tool name, command id hash, reason              |
| command lifecycle                | spawn, stdout/stderr pump, stdin write, cancel, terminal   | sandbox denial, spawn failure, terminal failure, cancellation timeout          | command kind, sandbox mode, exit class, reason                |
| source/generation/recovery       | scan/build/link attempt, recovery claim, terminal recovery | source diagnostics, build failure, recovery blocked/failed/completed           | recovery kind, source kind, generated package name, reason    |
| shutdown                         | prepare, drain, forced close, finalizer completion         | interrupted visible work, recovery receipts, timeout forcing scope release     | scope kind, owner id hash, shutdown reason                    |

Metrics are low-cardinality counts/durations/gauges matching the table above. High-cardinality ids
are hashed or omitted. Raw command output stays in command-output/artifact state, not in metrics.

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
  generated_package_refresh: Extract<RefreshGeneratedPackagesRequest, { scope: "app-global" }>;
  workspace_generated_package_link_repair: Extract<
    RefreshGeneratedPackagesRequest,
    { scope: "workspace-link-repair" }
  >;
  generated_context_refresh: RefreshGeneratedContextRequest;
  queue_delivery: QueueDeliveryRecoveryPayload;
  active_turn_recovery: ActiveTurnRecoveryPayload;
  workflow_task_attempt_recovery: WorkflowTaskAttemptRecoveryPayload;
  artifact_materialization: {
    artifactId: ArtifactId;
    sourceCommandId?: CommandId | null;
    operation: "finalize" | "cleanup-staged" | "cleanup-ready";
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
`SvvyxRuntimeEffectTransportRequest` values, and applies the currently supported
`extension_usage.context_impact` and `extension_snapshot.context_impact` requests through
runtime-owned services and `@svvy/state` ports. The replay path returns patched command facts/output
to the owning command session and does not own subprocess launch, profile snapshot mutation,
artifact replay, or UI notification publication outside the normal command-session flow.

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
  invalidation contract was left outside the package-owned runtime/state boundary. A branch that has
  no product state model must not be decoded by `@svvy/core`.
- Every decoded `RuntimeEffectRequest` variant in `@svvy/core`, including `handler_thread.start`,
  has a runtime-owned applier before the target runtime-effect lane is complete. A decoded target
  variant reaching a default unsupported branch is an implementation defect, not a valid runtime
  status.
- Desktop pane creation is never a `RuntimeEffectRequest`.
- The algebra is closed; adding a new variant requires a core/runtime contract update and tests.

RuntimeEffectRequest application matrix:

| Variant                          | Runtime applier lane                                                                                                                                                                                    | State/product facts touched                                                                                                                                                                                                                                                                                                                                    | Required notification behavior                                                                                                                                                                                               | Required tests                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handler_thread.start`           | handler-thread lifecycle service under the owning orchestrator command context; enriches one full `threads[]` batch and commits it through `RuntimeThreadStatePort.startHandlerThreads(...)` atomically | state-owned commit: one or more handler-thread rows, one generated-context binding row per thread, one `initial_handler_start` queue row per thread with `sourceCommandId`; runtime/pi-adapter-owned preparation: handler pi surface/session allocation, profile/override resolution, generated context, forked-history queue payloads, command terminal facts | publish thread/session/navigation/read-model invalidations after the state transaction commits; wake each target handler surface queue after commit; return applied committed ids for final `ThreadStartResult` construction | schema decode, multi-thread batch atomicity, generated-context binding, forked-history payload placement, command linkage on queue rows, `sourceCommandId` replay idempotency, queue wakeup-after-commit, no per-thread split effects |
| `queue.insert`                   | queue insertion service under the active command/turn context                                                                                                                                           | one durable queue row for allowed runtime-control kinds only, source command id, idempotency key, queue ordering facts                                                                                                                                                                                                                                         | publish `queue.changed` and affected read-model invalidations after commit; wake only the addressed surface queue                                                                                                            | kind/payload match, idempotent replay, source command linkage, answer-row precedence, no ordinary `user_message` insertion from extension-produced effects                                                                            |
| `actor_extension_binding.update` | `RuntimeActorExtensionBindingStatePort.updateActorExtensionBinding(...)` plus target generated-context refresh scheduling                                                                               | current orchestrator or handler actor surface binding rows and generated-context freshness/stale facts; no workflow-task target and no profile-default mutation                                                                                                                                                                                                | publish Agents/Extensions/surface stale/read-model invalidations after commit; never rewrite an active turn context mid-turn; require source-invalidation refresh service before mutating binding state                      | loaded/available/unavailable validation, target validation, ready-extension validation, stale fingerprint marking, opted-in pre-dispatch refresh scheduling, no profile default writes                                                |
| `episode.record`                 | `RuntimeEpisodeStatePort.recordHandlerThreadEpisode(...)` for `scope: "handler-thread"` only                                                                                                            | handler-thread episode row, thread/group summary facts, optional command/thread report linkage; outcome-bearing requests conclude the handler thread through the same state boundary                                                                                                                                                                           | publish thread episodes/read-model invalidations after commit; schedule orchestrator reconciliation only when the episode outcome requires it                                                                                | episode kind validation, handler ownership, thread-group ownership, conclusion ordering, duplicate/idempotency behavior                                                                                                               |
| `request_input.create`           | request-input accepted-tool service                                                                                                                                                                     | request/question/option rows, default answer derivation facts, nonblocking default answer records, blocking wait records, command progress/wait/settlement facts through `RuntimeCommandStatePort`                                                                                                                                                             | publish request-input/read-model/command invalidations after commit; for later nonblocking user answers, `runtime.requestInput.answer` may enqueue `request_user_input_answer` and wake after commit                         | option/default validation, blocking timeout, nonblocking default result, user answer queue delivery, command settlement                                                                                                               |
| `generated_context.refresh`      | runtime-owned generated-context refresh service/worker                                                                                                                                                  | recovery row or immediate refresh work, generated-context build facts, surface binding/stale facts when the safe boundary refresh commits                                                                                                                                                                                                                      | publish generated-context, Agents/Extensions, and affected surface stale/read-model invalidations after commit; no generated preview payload in events                                                                       | safe-boundary scheduling, opt-out stale surface behavior, invalid source keeps previous ready context, failure diagnostics                                                                                                            |
| `generated_packages.refresh`     | runtime-owned generated-package refresh service/worker                                                                                                                                                  | generated-package build/recovery rows, manifest/build/link facts, workspace link facts                                                                                                                                                                                                                                                                         | publish generated-package, Workflows/Extensions, link-status, diagnostics, and affected workspace read-model invalidations after commit; wake acquired workspace link-repair workers only after app-global build commit      | dependency order `@svvyx/extensions` before dependent `@svvyx/workflows`, app-global once per build, unopened workspace repair recovery, failure keeps prior ready package active                                                     |

`RuntimeQueueInsertPostCommitLane` is a runtime-owned queue wakeup boundary used only after
`queue.insert` has committed the queue row through `RuntimeQueueStatePort` and
`RuntimeEventBus.publishStateInvalidations` has accepted the committed invalidations. Runtime owns
this ordering. The wake boundary receives only the `RuntimeEffectRequest` queue target, the
committed `queuedMessageId`, and the committed queue item kind. It may wake the addressed queue
lane, but it must not insert queue rows, publish runtime events, mutate state, materialize pi
prompts, change the applied-effect result, or inspect renderer state. Queue workers and pi turn
dispatch are runtime-owned services.

Every matrix row is a promoted runtime behavior. Implementation is incomplete if the variant
decodes but lacks an applier, writes only command facts, publishes events before state commit,
returns a preview-only result, or relies on a desktop/catalog adapter to complete the work.

## Accepted Native Tool Operations

Accepted native tool execution is runtime-owned. App and UI adapters submit the accepted tool call to
runtime and receive the model-facing tool result plus verification metadata. Runtime allocates or
reuses the product command envelope, decodes accepted arguments, invokes the extension handler,
applies `RuntimeEffectRequest` values, persists command lifecycle and tool-owned durable facts
through state ports, and publishes events after commit. Adapters do not invoke extension handlers,
apply runtime effect requests, decode extension command facts, write command lifecycle rows, or write
tool-owned durable state directly.

Package-private accepted native tool runner:

```ts
type AcceptedNativeToolRunner = {
  runAcceptedToolCall(
    input: AcceptedNativeToolCallInput,
  ): Effect.Effect<AcceptedNativeToolCallResult, RuntimeContractError>;
  appendStreamedArguments(
    input: StreamedToolArgumentsInput,
  ): Effect.Effect<void, RuntimeContractError>;
  terminalizeDanglingToolCall(
    input: DanglingToolCallInput,
  ): Effect.Effect<void, RuntimeContractError>;
};

type AcceptedNativeToolCallInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  target: RuntimeSurfaceTarget;
  turnId: TurnId;
  toolCallId: ToolCallId;
  nativeToolName: string;
  acceptedArguments: JsonValue;
  promptExecutionContext: PromptExecutionContext;
  actorBinding: RuntimeActorExtensionBindingRecord;
  commandContext: CommandInvocationContext;
  receivedAt: IsoDateTimeString;
};

type AcceptedNativeToolCallResult = {
  toolResult: NativeToolResult;
};

type StreamedToolArgumentsInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  target: RuntimeSurfaceTarget;
  turnId: TurnId;
  toolCallId: ToolCallId;
  nativeToolName: NativeToolName;
  argumentsJsonFragment: string;
  sequence: NonNegativeSafeInteger;
  receivedAt: IsoDateTimeString;
};

type DanglingToolCallInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  target: RuntimeSurfaceTarget;
  turnId: TurnId;
  toolCallId: ToolCallId;
  reason: "turn-cancelled" | "turn-failed" | "pi-ended-without-acceptance";
  at: IsoDateTimeString;
};
```

This runner is package-private. Public `Runtime.commands` remains desktop/headless command control
only. Pi-adapter accepted tool callbacks enter runtime through this runner; adapters do not call
extension handlers or state command ports directly.

Accepted native tool execution uses one runtime-owned operation boundary: accepted tool identity,
decoded arguments, `PromptExecutionContext`, actor binding, and runtime-created
`CommandInvocationContext` enter runtime; the model-facing tool result is the only successful
operation output. Applied effect diagnostics, allocated ids, progress events, and command settlement
metadata commit through runtime-owned state-port calls and are later projected by `@svvy/state`
read models instead of leaving as adapter return fields. Tool-specific runners such as
`request_user_input`, Shell, Apply Patch, Execute
TypeScript, and extension-facade child commands implement this boundary. The `request_user_input`
shape below is the concrete request-input specialization, not the only runtime-owned accepted tool
path.

Runtime processes accepted native tool calls serially within a turn by default. It may run multiple
accepted native tool calls concurrently only when the pi acceptance event identifies independent
tool calls and the native tool declaration includes a runtime-owned `concurrency` contract naming
the affected durable state domains and proving those domains cannot race. Runtime tracks every
concurrent accepted-tool fiber in the active turn's `FiberMap`; turn cancellation, shutdown, and
terminalization interrupt that map before final turn facts are committed. Tool handlers cannot opt
into concurrency through returned data alone.

Runtime does not acknowledge an accepted tool result back to pi until accepted arguments, command
lifecycle transition, handler fact payloads, returned `ExtensionRuntimeOperation` items, and
terminal/waiting command facts have either committed or recorded durable recovery/failure state.
Runtime applies `runtime_effect` operation items and executes `execution_plan` operation items in
the owning command lane. If the tool cannot produce a successful model-facing result, runtime
commits the failed, cancelled, or waiting command facts first, then returns the corresponding typed
tool error/result to pi-adapter. Extension handlers never return directly to pi.

`execute_typescript` follows the same accepted-tool lane. Its runtime operation receives accepted
tool identity, decoded TypeScript source, prompt execution context, actor binding, and state-port
services; it must not receive `StructuredSessionStateStore` or any state implementation object.
Runtime/state ports own source/log/diagnostic artifact persistence, parent and child command
lifecycle, output/diagnostic events, handler-thread runnable projection, approval facts, sandbox
facts, subprocess result facts, cancellation facts, and extension-facade child-command rollups.
Host process spawning and sandbox implementation stay host-adapter capabilities passed through a
narrow execution plan, not broad state ownership in the app shell.

Extension handlers may also return `execution_plan` operation items wrapping immutable execution
plans when the useful work requires runtime-owned approval, sandbox, subprocess, file-effect,
stdin/stdout/stderr, child-command, or cancellation behavior. Runtime executes those plans after
validating the current command envelope, target source version, approval ledger key, sandbox
snapshot, expected binary/artifact identity, and readiness facts from runtime context, extension
metadata, and state. Those values are not copied into handler-authored plan payloads.

| Plan kind                    | Extension responsibility                                                      | Runtime responsibility                                                                                                                                                                                      | State/fact responsibility                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `none` / handler result only | Return a model-facing result and typed durable fact payloads.                 | Persist command lifecycle and fact payloads through state ports; publish invalidations only after commit.                                                                                                   | `@svvy/state` owns rows/read models for the command and package-specific facts.                                             |
| `child_process.command`      | Return immutable `argv`, `cwd`, command family, stdin mode, and env key plan. | Own approval, sandbox snapshot validation, display derivation, subprocess launch, stdin, stdout/stderr streaming, output retention, process cancellation, timeout, continuation, and child command linkage. | Runtime writes parent/child command facts, stream/artifact links, exit status, approval facts, and recovery where needed.   |
| `file_effect.apply_patch`    | Return validated patch text and `cwd` only.                                   | Own approval, sandbox/file policy validation, display derivation, atomic file effect application, pre/post snapshots, cancellation before execution, and applied-effect diagnostics.                        | Runtime/state record patch command facts, affected paths, digests, diagnostics, and generated-context/source invalidations. |

Every plan kind has focused runtime tests for decode failure, stale readiness rejection, approval
handoff, cancellation, state commit ordering, and adapter non-ownership. A handler that performs
these behaviors directly instead of returning a plan violates the package boundary.
Runtime materializes child-process plans with explicit launch options: `shell: false`,
`extendEnv: false`, `detached: false`, `stdin` derived only from the plan's stdin mode, and
`stdout`/`stderr` set to pipe-backed capture. Shell-like behavior is represented by an explicit
app-owned shell executable and argv, not by the platform child-process `shell` option. Runtime
constructs the final env from sandbox launch policy, extension env plan, bridge variables, and
redacted command context; it never inherits ambient process env by default. For command families
that may spawn descendants, runtime starts the subprocess in an app-owned killable process group or
equivalent platform wrapper when supported. Cancellation and shutdown send the graceful signal to
that group, then force-kill the group after `commandGracefulShutdownMs`. If the platform cannot
guarantee descendant cleanup, runtime records that limitation in command facts and schedules
`command_process_reconciliation`; it must not report the command session fully cleaned up solely
because the direct child process exited.

Extension dependency install/update is the separate runtime command API
`Runtime.commands.runExtensionDependencyAction(...)`, not a handler-returned execution-plan variant.
Runtime asks `@svvy/extensions` for the exact package/binary/trusted-identity requirement and
install/update command plan on that command-service path, then owns user approval, controlled package
manager/subprocess execution, lifecycle-script policy, installed artifact verification,
cancellation, readiness invalidation, command facts, and resume signals.

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
    sandbox: {
      snapshot: SandboxPolicySnapshot;
      sandboxLaunchFacts?: SandboxLaunchFacts;
    };
    cwd: AbsolutePath;
    baseEnv: Readonly<Record<string, string>>;
  };
};

type RunAcceptedRequestUserInputToolCallResult = {
  toolResult: NativeToolResult;
};
```

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
    sandbox: {
      snapshot: {
        snapshotId: "sandbox_snapshot_01",
        fingerprint: "sha256:sandbox-snapshot-01",
        resolvedAt: "2026-06-20T12:30:00.000Z",
        scope: { kind: "workspace", workspaceId: "workspace_01" as WorkspaceId },
        surfacePiSessionId: "pi_session_01" as SurfacePiSessionId,
        commandId: "command_01" as CommandId,
        launchKind: "extension_facade_child",
        cwd: "/Users/polarzero/code/projects/svvy" as AbsolutePath,
        sandboxMode: "managed",
        networkPolicy: "deny",
        filesystemPolicy: {
          defaultAccess: "read",
          entries: [],
        },
      },
    },
    cwd: "/Users/polarzero/code/projects/svvy" as AbsolutePath,
    baseEnv: {},
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
      acceptedBytes: ByteCount;
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

type RuntimeCommandOutputChunk = {
  commandId: CommandId;
  stream: "stdout" | "stderr";
  sequence: SequenceNumber;
  bytesBase64: string;
  textPreview?: string;
  encoding: "utf8" | "binary";
  observedAt: IsoDateTimeString;
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
For every nonterminal durable command, runtime asks `RuntimeCommandSessionService.writeStdin(...)`
to admit the complete text chunk into the live command session's FIFO stdin lane. A durable
nonterminal command with no live registry entry returns `not_running`; runtime does not
reconstruct, restart, or reattach a command solely to satisfy stdin. A closed or non-continuable
live stdin lane returns `stdin_closed`.

Only an `accepted` live admission records a stdin receipt through
`RuntimeCommandStatePort.recordStdinWrite(...)`. The receipt contains the command's `sessionId`,
the durable `commandId`, the exact submitted `text`, and `acceptedBytes`, which is the UTF-8 byte
length of that exact text. Runtime returns `status: "accepted"` and publishes `command.changed`
only after the state mutation commits. If receipt recording fails after live admission, runtime
surfaces the typed runtime/state failure, such as `state-conflict` or `stale-state`; it must not
synthesize an accepted result, duplicate a receipt, or treat `clientSubmission` as replay-safe.
This architecture has no pre-admission stdin idempotency ledger. `clientSubmission` remains
metadata only for stdin writes.

The command-session service owns the complete scoped command lifecycle:

- stdout and stderr pumps emit ordered `RuntimeCommandOutputChunk` facts through state ports before
  renderer/browser-tool projections can observe them.
- terminal process observation emits exactly one `RuntimeCommandTerminalFacts` value before command
  settlement invalidations are published.
- raw stdout/stderr bytes are product-state command output facts. Signed extension subprocess
  result payloads may contain structured JSON output, but never duplicate raw stdout/stderr streams.

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
`Stream.catchAll`, or an equivalent swallowing combinator. A command whose output stream failed can
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

type RuntimeRequestInputApiPromise = {
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

`answer(...)` validates that the request is open, the addressed question/option exists, the submitted
`surfacePiSessionId` owns the request, and the client submission is idempotent. It records exactly
one answer. For blocking requests it resolves the runtime-owned wait and settles the command. For
nonblocking requests it records the answer, enqueues a `request_user_input_answer` queue row when the
owning surface still needs model delivery, publishes committed `StateMutationResult.afterCommit`
descriptors through the runtime event bus, wakes any affected runtime queue lane, and returns
`AnswerRequestInputResult`. The returned `delivery` variant tells the caller whether a blocking
runtime wait was resolved, a nonblocking delivery row was queued, or the answer was only recorded
because a delivery was no longer needed. The answer payload sent back to the model contains question
text and answer text only; request ids, question ids, option ids, timeout state, and queue ids remain
product-state details.

`RuntimeRequestInputPostCommitLane` is a runtime-owned request-input wakeup boundary used only after
`requestInput.answer(...)` or `requestInput.setTimerPaused(...)` has committed state through
`RuntimeRequestStatePort` and `RuntimeEventBus.publishStateInvalidations` has accepted the committed
invalidations. Runtime owns this ordering. For answers the wake boundary receives only
`surfacePiSessionId`, `requestId`, and the nullable `queuedItemId` returned by committed state; for
timer pause/resume it receives only `requestId`. It may wake the addressed queue lane, resolve a
current blocking wait, or reschedule the current process-local timeout, but it must not record
answers, mutate timer state, publish runtime events, change public request-input results, or read
renderer state. Request-input wait resolution, timer scheduling, and queue wakeups are runtime-owned
services.

Public request-input facade failures are closed to:
`invalid-input`, `target-not-found`, `stale-state`, `state-conflict`, `backpressure`,
`runtime-shutdown`, and `runtime-disposed`. Timeout fibers, duplicate submissions, queue wakes, and
blocking wait completion must map into that set; raw state errors, fiber defects, timer defects, and
queue worker causes are logged through app logs and normalized `StateStoredError` facts, not exposed
through facade error payloads.

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
wait. The model-facing tool result is not returned until a user answer or timeout default resolves
the wait. The wait is represented durably by request/command/turn facts; the process-local Deferred
is only a live handoff and is recreated or completed by recovery.
The process-local timeout scheduler keeps at most one `FiberHandle`/`FiberMap` entry per
`{ requestId, timerVersion }`. Pause, resume, answer, cancellation, and recovery commits always
compare the committed timer version before interrupting or replacing a live timeout fiber. A stale
timeout fiber that wakes after a newer timer version exists must observe `stale-state`, release only
its own live resources, and leave durable request/command facts unchanged.

Blocking request-input resolution is a single state compare-and-set transition keyed by
`requestId`, owning command id, current wait status, and timer version/deadline. User answers, live
timeout fibers, the timeout scan worker, request cancellation, turn interruption, surface/workspace
close recovery, and startup recovery all call that same runtime-owned transition. The first
committed terminal transition wins and is the only path allowed to resolve the live `Deferred`,
settle the command, release the prompt lock, publish request-input/command/turn invalidations, and
return a tool result to pi. Losing contenders observe `stale-state`, release only their
process-local resources, and must not publish duplicate invalidations, resolve a `Deferred`, insert
answer queue rows, or settle the command. Recovery reconstructs missing live waits from persisted
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

Pi turn output is consumed as a `Stream<PiRuntimeEvent, PiAdapterError>`. The streamed tool lifecycle
projection service is scoped to the active turn/surface and stores only live coordination state in
`Ref` / `SynchronizedRef`, such as `toolCallId -> commandId` and the last emitted argument snapshot
metadata. Streaming argument snapshots may be sampled or throttled because the final accepted
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
- Runtime code uses Effect `DateTime`, `Clock`, `Schedule`, `Deferred`, `Ref`,
  `SynchronizedRef`, `Semaphore`, `FiberHandle`, `FiberMap`, `FiberSet`, and `ScopedRef` for time,
  waiting, readiness, locks, concurrency limits, replaceable lanes, active fibers, and replaceable
  scoped handles.
- Runtime consumes pi turns as `Stream<PiRuntimeEvent, PiAdapterError>` values from
  `@svvy/pi-adapter`. Each active surface has at most one prompt-bearing pi turn fiber at a time,
  guarded by the prompt lock. Callback-style pi APIs are adapted into scoped streams with
  acquire/release finalizers, not by storing unscoped listeners.
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
- Depends on `@svvy/sandbox`.
- Depends on `@svvy/pi-adapter`.
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

The package exports test fixtures:

```ts
export const layerTest: Layer.Layer<Runtime | RuntimeTestHarness, never, never>;
```

`RuntimeTestHarness` exposes semantic receipts and drains for submitted messages, queue claims,
runtime effect applications, event publications, source invalidation scans, schedule ticks, and
scope finalizers. Tests use harness receipts, `TestClock`, and state-port assertions; they do not
sleep, create manual `ManagedRuntime` instances, or inspect private fibers.

Runtime owns a package-private `RuntimeReceiptBus`. The production layer is no-op/redacted except
for app-log facts explicitly emitted by runtime services. `Runtime.layerTest` exposes receipt
streams and drain helpers for tests. Required semantic receipts are: queue row claimed, turn
dispatched, turn terminalized, command terminalized, request-input wait created, request-input wait
resolved, event published, subscription attached, subscription closed, rebaseline rejected, slow
subscriber dropped/rebaselined, recovery sweep completed, generated-context refresh completed, and
generated-package refresh completed. Tests must use those receipts or state-port assertions as
completion signals; they must not poll read models, filesystem contents, git refs, sleeps, or
private fiber state to infer runtime completion.

- Runtime tests with fake pi and fake extensions.
- `@effect/vitest` service/layer tests.
- Runtime event stream contract tests.
- Runtime receipt bus tests for every required receipt and no-op/redacted production behavior.
- Runtime event replay capacity, subscriber-buffer backpressure, and slow-consumer close tests.
- Runtime message submission tests proving public API does not accept full messages or system
  prompts.
- Workspace/default workspace recovery tests.
- Scoped workspace/surface resource disposal tests.
- Lifecycle primitive tests for `FiberHandle` replacement/join/failure supervision,
  `FiberMap`/`FiberSet` drain versus failure supervision, `ScopedRef` failed replacement and
  previous-resource finalization, `RcMap` invalidation with active borrowers, and any adopted
  `Resource` refresh success/failure/finalization behavior.
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
- Runtime facade tests proving facades use the caller-owned, already-started `ManagedRuntime`, map
  typed failures/defects to stable bridge errors, propagate cancellation, close stream scopes, fail
  after runtime disposal, and contain no queue claiming, prompt dispatch, state mutation,
  tool-execution, or recovery policy. App-bootstrap integration tests prove
  `managedRuntime.context()` is awaited before facades are exposed when startup effects matter.
- Runtime event tests proving bounded replay succeeds inside the retained window, stale
  `afterSequence` requests fail before a stream is exposed, slow subscribers observe the intended
  backpressure policy, and event publication happens only after authoritative state commits.
- Source invalidation tests proving watchers start only when the owning stream is run, scope
  shutdown interrupts watchers/debounce/scan fibers, dirty domains coalesce while a scan is active,
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
