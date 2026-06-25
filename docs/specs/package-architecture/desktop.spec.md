# `@svvy/desktop` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/desktop`

## Purpose

`@svvy/desktop` owns the Electrobun/Svelte renderer application surface.

It is the default UI consumer over bootstrap-provided renderer-safe runtime facade plus state
read/command facades.

`@svvy/desktop` adapts those renderer-safe facades into Electrobun/Svelte UI and renderer
callbacks. Product app/bootstrap owns Electrobun process entrypoints, platform layer composition,
app bridge wiring, the app `ManagedRuntime`, and facade construction. Renderer code does not
receive raw Effect services. Desktop owns renderer/window lifecycle after app bootstrap injects
those facades. It does not construct `ManagedRuntime`, package layers, state ports, runtime
services, pi adapter sessions, or extension implementation records.

## Owns

- Electrobun window and renderer lifecycle after app/bootstrap readiness.
- Window and workspace tab UI.
- Dockview pane layout.
- Chat transcript rendering.
- Composer UI.
- Command palette UI.
- Session/sidebar/archive/delete UI.
- Manual title rename UI and title-freeze affordances.
- Agents pane.
- Extensions pane.
- Workflows generated-surface pane.
- Artifacts pane and preview rendering.
- Request input side panel.
- Snippets pane and composer picker.
- App logs pane.
- Settings UI.
- Approval UI.
- Renderer-safe RPC adapter types and Svelte-side adapters over bootstrap-injected facades.
  Desktop-owned RPC adapter payloads must be composed from `@svvy/core` schemas, generated
  declarations, and public `@svvy/runtime` / `@svvy/state` facade contract types. Desktop does not
  own product-domain schemas, read-model schemas, runtime command contracts, state command
  contracts, or pi/session/tool boundary contracts.
- Renderer projection adapters that render state read models and transient runtime stream patches.
- Desktop does not own Electrobun bridge fibers, Effect stream subscriptions, runtime event
  publication, browser-tool adapters, or headless adapters. App/bootstrap owns those edge adapters
  and injects callback/facade handles.

## Does Not Own

- Runtime queue claiming.
- Turn execution.
- pi sessions.
- Extension definitions or tool execution.
- Sandbox policy.
- Durable state invariants.
- Smithers or Workflows instruction content.
- Generated package build/link semantics.
- Prompt dispatch, queue claiming, or generated-context refresh.
- pi message-array submission as a non-UI package contract.

## Public API Shape

This package is primarily an app package, not a reusable SDK.

Target source path:

- `packages/desktop/src/**` owns desktop UI, renderer-safe RPC contracts, and adapters over prebuilt
  runtime facade plus state read/command facades.
- Product app/bootstrap owns Electrobun process entrypoints, platform layers, package layer
  composition, `ManagedRuntime` construction, and facade injection into `@svvy/desktop`. Non-UI
  packages interact only with `@svvy/core`, `@svvy/state`, `@svvy/runtime`, and other non-desktop
  package contracts.

`@svvy/desktop` root exports exactly one product bootstrap adapter, `createDesktopApp(input)`.
It accepts only prebuilt renderer-safe facades and desktop host adapters from product app/bootstrap;
it never receives a raw `ManagedRuntime`, Effect services, package-private ports, layer factories,
or SQLite/pi/sandbox handles.

```ts
import { createDesktopApp } from "@svvy/desktop";

await createDesktopApp({
  runtime: runtimeActions,
  state,
  commands,
  notifications,
  host,
}).start();
```

Exact bootstrap adapter shape:

```ts
import type { createRuntimeFacade } from "@svvy/runtime";

type RuntimeFacade = ReturnType<typeof createRuntimeFacade>;
type DesktopRuntimeActionsFacade = Omit<RuntimeFacade, "events" | "close">;
type RuntimeCommandsFacade = RuntimeFacade["commands"];

type DesktopNotificationBridge = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

type CreateDesktopAppInput = {
  runtime: DesktopRuntimeActionsFacade;
  state: RendererStateFacade;
  commands: {
    runtime: RuntimeCommandsFacade;
    state: StateCommandsFacade;
  };
  notifications: DesktopNotificationBridge;
  host: DesktopHostAdapter;
};

type DesktopHostAdapter = {
  bridge: DesktopBridgeAdapter;
  windows: DesktopWindowAdapter;
  menus: DesktopMenuAdapter;
  browserTools?: DesktopBrowserToolsUiAdapter;
};

type DesktopBridgeAdapter = {
  exposeRendererApi(input: {
    runtime: DesktopRuntimeActionsFacade;
    state: RendererStateFacade;
    commands: CreateDesktopAppInput["commands"];
  }): Promise<DesktopBridgeRegistration>;
  sendToRenderer(input: DesktopRendererNotification): Promise<void>;
};

type DesktopBridgeRegistration = {
  dispose(): Promise<void>;
};

type DesktopRendererNotification =
  | { kind: "runtime-event"; event: RuntimeEvent }
  | { kind: "read-model-rebaseline-required"; reason: string }
  | {
      kind: "renderer-command";
      command: "command-palette.open" | "quick-open.open" | "settings.open";
    }
  | { kind: "app-shutdown"; reason: string };

type DesktopWindowAdapter = {
  createMainWindow(input: DesktopMainWindowInput): Promise<DesktopWindowHandle>;
  focusWindow(input: { windowId: DesktopWindowId }): Promise<void>;
  closeWindow(input: { windowId: DesktopWindowId }): Promise<void>;
};

type DesktopMainWindowInput = {
  initialRoute: "workspace" | "settings";
  title: string;
};

type DesktopWindowHandle = {
  windowId: DesktopWindowId;
  dispose(): Promise<void>;
};

type DesktopMenuAdapter = {
  installAppMenu(input: {
    commandPalette: () => Promise<void>;
    quickOpen: () => Promise<void>;
    openSettings: () => Promise<void>;
  }): Promise<DesktopMenuRegistration>;
};

type DesktopMenuRegistration = {
  dispose(): Promise<void>;
};

type DesktopBrowserToolsUiAdapter = {
  status(): Promise<{
    available: boolean;
    label: string;
    bridgeUrl?: string;
  }>;
  openInspector(input: { target?: RuntimeSurfaceTarget }): Promise<void>;
};

type DesktopWindowId = string & Brand<"DesktopWindowId">;

type DesktopApp = {
  start(): Promise<void>;
  dispose(): Promise<void>;
};
```

`createDesktopApp(...)` owns desktop/window/renderer lifecycle only. It routes every product action
to the injected facades and refetches read models after runtime notifications. It does not create,
dispose, or inspect the app `ManagedRuntime`; app/bootstrap remains the sole owner of runtime
construction, startup readiness, shutdown preparation, and final disposal.
Host adapters are UI host adapters only. They may create windows, install menus, expose renderer
RPC, forward runtime notifications into the renderer process, and show browser-tool UI affordances.
They must not create package layers, run Effect programs, publish runtime events, mutate state
directly, open pi sessions, execute tools, inspect SQLite, build generated packages, or implement
browser-tool runtime facades.
`DesktopBrowserToolsUiAdapter` may expose labels, launcher affordances, and connection status for
renderer UI only. Browser-tool runtime facades, event subscriptions, bridge servers, and
`AsyncIterable` edges remain app/bootstrap-owned and are never implemented in `@svvy/desktop`.

Product app bootstrap shape:

The following code lives only in product app/bootstrap, not in `packages/desktop/src/**`,
`src/mainview/**`, renderer/shared RPC modules, or individual Electrobun RPC handlers:

```ts
import * as ManagedRuntime from "effect/ManagedRuntime";
import { createRuntimeFacade } from "@svvy/runtime";
import { awaitRuntimeStartupReadiness, prepareRuntimeShutdown } from "@svvy/runtime/bootstrap";
import {
  createStateCommandsFacade,
  createStateFacade,
  type StateCommandInvalidationSink,
} from "@svvy/state";
import { createDesktopApp } from "@svvy/desktop";

const managedRuntime = ManagedRuntime.make(appLayer);
let runtimeServiceAcquired = false;

try {
  await managedRuntime.context();
  runtimeServiceAcquired = true;
  await awaitRuntimeStartupReadiness(managedRuntime);
} catch (cause) {
  if (runtimeServiceAcquired) {
    await prepareRuntimeShutdown(managedRuntime, { reason: "startup-failure" });
  }
  await managedRuntime.dispose();
  await showStartupFailure({ cause });
  throw cause;
}

const invalidationSink: StateCommandInvalidationSink =
  createBootstrapInvalidationSink(managedRuntime);
const runtime = createRuntimeFacade(managedRuntime);
const state = createStateFacade(managedRuntime);
const stateCommands = createStateCommandsFacade(managedRuntime, { invalidationSink });

const commands = {
  runtime: runtime.commands,
  state: stateCommands,
};

const desktopHost = createElectrobunDesktopHostAdapter({
  bridge,
  windows,
  menus,
  browserTools,
});

const notifications = createDesktopNotificationBridge({
  runtimeEvents: runtime.events.bind(runtime),
  state,
  rendererEmit: desktopHost.rendererEmit,
});

await createDesktopApp({
  runtime: omitRuntimeStreamSurface(runtime),
  state,
  commands,
  notifications,
  host: desktopHost,
}).start();
```

`@svvy/desktop` must not call `runtime.events(...)` directly. App/bootstrap owns the Effect
subscription, stream lifetime, slow-consumer close handling, sequence tracking, and renderer
notification fanout because it owns the app `ManagedRuntime` and renderer transport. Desktop
receives renderer-safe notifications and may request read-model refetch or rebaseline through the
injected state facade; renderer-local sequence coalescing is projection/cache logic only and must
not publish runtime events or decide runtime lifecycle.
Runtime event ownership stays in app/bootstrap. The desktop package may request a renderer
notification binding for a workspace tab/window, but app/bootstrap resolves the authoritative
`workspaceId` from state-backed workspace/tab read models before it calls
`runtime.events({ workspaceId, afterSequence })`. App-global notifications use an explicit app
subscription scope with no workspace fallback. The bridge must not route runtime events by focused
pane, selected Dockview tab, last opened workspace, renderer cache, or caller-supplied panel state.
Workspace-keyed renderer notifications carry the subscription `workspaceId`; renderer stores drop or
rebaseline notifications whose `workspaceId` does not match the mounted workspace scope.

Bootstrap readiness is `await managedRuntime.context()` followed by the runtime-owned startup
readiness effect. `context()` proves the app layer graph was acquired; the runtime readiness effect
proves required app-scoped workers, startup recovery, source reconciliation, and generated-package
startup reconciliation have reached the product-ready state or failed startup. If either step
fails, app startup is terminal for that runtime instance: if layer acquisition succeeded but runtime
readiness failed, bootstrap best-effort calls
`prepareRuntimeShutdown(..., { reason: "startup-failure" })` before disposal. If
`managedRuntime.context()` failed before the runtime service was acquired, bootstrap disposes
directly. Bootstrap then shows the startup failure surface, rejects renderer bridge calls with the
normalized startup error, and requires an explicit user/app retry to construct a new `ManagedRuntime`. Default-workspace
creation, tab retargeting, renderer bridge registration, browser-tool bridge registration, and
window startup run only after this bootstrap readiness gate succeeds.

`createBootstrapInvalidationSink(...)` is app/bootstrap code over the app-owned
`ManagedRuntime`, not a `@svvy/desktop` export and not a `@svvy/state` helper. It is constructed
only after `managedRuntime.context()` and `awaitRuntimeStartupReadiness(managedRuntime)` succeed,
because it is a runtime-backed bridge adapter for committed state invalidations. If startup fails,
no sink, runtime facade, state facade, state command facade, desktop app, or renderer bridge is
exposed; retry constructs a new `ManagedRuntime` and a new sink after the new runtime reaches
readiness. `stateCommands` is the bootstrap-created `StateCommandsFacade` produced by
`@svvy/state.createStateCommandsFacade(managedRuntime, { invalidationSink })`. Its exact method
groups are specified in the state package spec and boundary exports. `@svvy/desktop` must not
invent, widen, own, or publish invalidations from that facade; app/bootstrap owns the sink and
runtime owns public event publication.

Only product app bootstrap may hold the raw `ManagedRuntime` and construct the runtime facade plus
state read/command facades.
Renderer code and shared RPC contract modules receive prebuilt facade methods, callback emitters, or
adapter functions. `@svvy/desktop` consumes those bootstrap-provided facades for Electrobun RPC
handlers and renderer subscriptions; it must not create facades or ad hoc Effect runtimes inside
individual RPC methods.

The product process has exactly one healthy app-owned `ManagedRuntime` exposed to bridge callers
after startup readiness succeeds and before shutdown begins. It has zero exposed app runtimes during
startup, startup failure, retry construction, runtime restart, and shutdown. It never has two
healthy exposed app runtimes at the same time. Runtime restart is a bootstrap lifecycle operation:
mark bridge delivery closed, reject new calls with typed shutdown/restart errors, close facade
subscriptions and callback scopes, call
`prepareRuntimeShutdown(managedRuntime, { reason: "runtime-restart", ... })`, dispose the old
`ManagedRuntime`, construct a new runtime, await `context()` and runtime startup readiness, recreate
facades and the invalidation sink, then re-open bridge delivery. No workspace runtime scope, renderer module, window, browser-tool adapter,
headless adapter, or RPC handler constructs its own `ManagedRuntime`, calls
`ManagedRuntime.make(...)`, or builds a per-request `Layer` graph.

Renderer and shared RPC modules may import `@svvy/core` schemas, state read-model types, facade
TypeScript types, and core-owned pi-free ids/contracts carried by renderer-safe payloads. They must
not import `@svvy/pi-adapter`, pi-native types, `Context.Service` classes, Effect `Stream`, `Layer`,
state/runtime ports, extension implementation records, sandbox services, or package-private
implementation modules. Only app bootstrap may hold `ManagedRuntime` and create facades.

Renderer Agents, Extensions, Settings, Approval, Snippets, Workflows, and layout surfaces consume
state-backed read models and submit typed product commands through runtime/app command facades. The
renderer-facing state facade is read-only: read-model fetch, invalidation refetch, and rebaseline
APIs only. It must not expose generic create/update/delete, table, transaction, migration, SQL,
repository, or state-port mutation methods.

Desktop chrome and layout commands are renderer UI intents normalized by `@svvy/desktop` and
forwarded to bootstrap-provided command facades. The Effect command services that mutate app or
workspace state live in `@svvy/state` as explicit state-owned command ports, or in `@svvy/runtime`
when lifecycle work is required. `@svvy/desktop` exposes only renderer/window/bridge adapters over
those prebuilt facades through `createDesktopApp(input)`; it must not create a `ManagedRuntime`
facade that owns state mutation semantics.

State-backed command facades expose only the named `StateCommandsFacade` groups specified by
`@svvy/state`: workspace chrome, workspace layout, app preferences, DB-backed agent profiles,
managed snippets, provider auth, extension environment overrides, and app-log read-state commands
(`appLogs.markRead`, `appLogs.markVisibleRangeRead`, and `appLogs.clearWorkspaceUnread`). They
return command-specific committed output plus `StateCommandReceipt` only; renderer callers refetch
affected read models after runtime notifications through the read facade. They are not the
renderer-facing state read facade, and they do not expose SQL, transactions, repositories,
file-backed source edits, generated-package refresh, or generic state mutation.
State command facades commit through `@svvy/state`; package-private state ports return after-commit
descriptors only to the runtime-owned invalidation sink. App/bootstrap bridge adapters do not
publish public runtime/app events directly or manually forward state descriptors. The bootstrap-created
`StateCommandsFacade` runs its state writes through the app `ManagedRuntime` and resolves only after
the runtime-owned invalidation sink has accepted the committed descriptors. `@svvy/runtime` is the
sole publisher on the public event stream. `@svvy/desktop` only consumes that stream, updates renderer
caches, and refetches affected read models; renderer code never publishes runtime events directly,
fabricates `StateInvalidationDescriptor` values, or treats command responses as refreshed read
models.

Facade shapes:

- Promise methods for one-shot commands and read-model fetches
- Electrobun callback/event emitters for renderer push notifications
- `AsyncIterable` subscriptions at browser-tool, headless, or non-UI framework edges only

Renderer-facing state facade shape:

```ts
type RendererStateFacade = {
  readModels: {
    fetch(request: StateReadModelRequest): Promise<StateReadModelResult>;
    refetchInvalidation(
      input: StateReadModelInvalidationRefetchRequest,
    ): Promise<readonly StateReadModelResult[]>;
    rebaseline(request: StateReadModelRebaselineRequest): Promise<StateReadModelBaseline>;
  };
};
```

Effect `Stream`, Effect services, layers, fibers, queues, pi sessions, and state transaction ports
stay in the non-UI package graph.

Renderer read-model usage examples:

```ts
const baseline = await state.readModels.fetch({
  kind: "surfaceTranscript",
  target,
});

const scheduleReadModelRefetch = createSequenceAwareRefetcher({
  state,
  applyReadModelPatch,
  discardIfStale: true,
});

const unsubscribe = runtimeEvents.subscribe((event) => {
  if (event.type === "workspace_read_model.changed") {
    scheduleReadModelRefetch(event.sequence, event);
  }

  if (event.type === "surface.stream") {
    applySurfaceStreamPatch(
      event.target,
      event.streamGenerationId,
      event.streamSequence,
      event.patch,
    );
  }
});
```

`AsyncIterable` event consumption is reserved for browser-tool, headless, or non-UI framework edges:

```ts
for await (const event of runtimeEvents) {
  if (event.type === "workspace_read_model.changed") {
    const patch = await state.readModels.refetchInvalidation({
      eventGenerationId: event.eventGenerationId,
      sequence: event.sequence,
      descriptor: event.invalidation,
    });
    applyReadModelPatch(patch);
  }

  if (event.type === "surface.stream") {
    applySurfaceStreamPatch(
      event.target,
      event.streamGenerationId,
      event.streamSequence,
      event.patch,
    );
  }
}

const rebaseline = await state.readModels.rebaseline({
  workspaceId,
  reason: "event-sequence-gap",
  target,
  afterSequence: lastAppliedSequence,
});
```

Runtime/workspace push notifications may carry only event sequence, stable ids, invalidation
descriptors, status hints, lifecycle status, and live `surface.stream` patches. Full session,
surface, transcript, command, settings, Agents, Extensions, Snippets, Workflows, approval, and
request-input data is returned only by explicit state read-model facade fetch/rebaseline calls.
Tool bridge, browser tools, headless automation, and trusted subprocess-result consumers follow the
same facade and read-model rule; they are not desktop-owned runtime behavior.

Read-model refetches are serialized or coalesced by runtime event sequence per affected read-model
target. A slower refetch result for an older event sequence is discarded if a newer sequence has
already been applied or scheduled for the same target. Command-facade invalidation handling uses the
same sequence-aware path. Runtime events and command responses are never treated as refreshed read
models.

## Programmatic API Mapping

Desktop, browser tools, and headless automation use the same bootstrap-provided facade contract.
There is no separate transcript/debug API that exposes pi-native sessions, model messages, system
prompts, generated context, command internals, or renderer snapshots.

| Product use case                                                                    | Caller-facing operation                      | Owning package/facade                                                                | Returned data                                      | Follow-up state                                                                                                                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit composer text                                                                | `runtime.messages.submit(input)`             | `@svvy/runtime` `RuntimeMessagesApi`                                                 | accepted queue/delivery status only                | refetch affected read models after `workspace_read_model.changed` / `app_read_model.changed`; apply contiguous `surface.stream` patches only until a gap |
| Abort active turn                                                                   | `runtime.messages.abort(input)`              | `@svvy/runtime` `RuntimeMessagesApi`                                                 | void or typed abort status only                    | refetch transcript, queue, request-input, command, and surface read models from invalidation events                                                      |
| Steer queued prompt                                                                 | `runtime.queues.steer(input)`                | `@svvy/runtime` `RuntimeQueuesApi`                                                   | void or queued item status only                    | refetch queue/composer read models after invalidation events                                                                                             |
| Answer request input                                                                | `runtime.requestInput.answer(input)`         | `@svvy/runtime` `RuntimeRequestInputApi`                                             | `{ requestId, questionId, status, delivery }` only | refetch request-input, command, queue, and transcript read models after invalidation events                                                              |
| Pause request timer                                                                 | `runtime.requestInput.setTimerPaused(input)` | `@svvy/runtime` `RuntimeRequestInputApi`                                             | `{ requestId }`                                    | refetch request-input read model after invalidation events                                                                                               |
| Write command stdin                                                                 | `runtime.commands.writeStdin(input)`         | `@svvy/runtime` public command facade delegating to package-private command sessions | `{ commandId, status, acceptedBytes }` only when `status === "accepted"`; otherwise `{ commandId, status }` | refetch command inspector/read model after `command.changed` or read-model invalidation events                                                           |
| Cancel command                                                                      | `runtime.commands.cancel(input)`             | `@svvy/runtime` public command facade delegating to package-private command sessions | `{ commandId, status }` only                       | refetch command inspector/read model after `command.changed` or read-model invalidation events                                                           |
| Edit app/workspace chrome/settings/profile/snippets/provider/env/app-log read state | named `stateCommands.*` method               | `@svvy/state` `StateCommandsFacade`                                                  | committed result plus state-issued receipt         | refetch affected read models after runtime-published invalidation events                                                                                 |
| Read any pane baseline                                                              | `state.readModels.fetch(request)`            | `@svvy/state` read facade                                                            | full requested read model                          | none until an event invalidates the baseline                                                                                                             |
| Recover after event gap                                                             | `state.readModels.rebaseline(request)`       | `@svvy/state` read facade                                                            | fresh baseline and cursor                          | replace stale local projection                                                                                                                           |

Browser-tool and headless callers do not receive a separate summary, transcript, debug, snapshot,
pi-session, or renderer-state API. Their public operations are exactly the bootstrap-provided
the facade shape returned by `createRuntimeFacade(...)`, `StateFacade`, and `StateCommandsFacade`
groups specified by the runtime and state package specs, plus `close()` on facade-owned resources.
Diagnostic helpers may only compose those
facades and may return ids, statuses, counts, read-model cursor positions, and event sequence
positions; they must not expose full transcripts, system prompts, generated context, pi message
arrays, pi event objects, command session handles, state-port payloads, or renderer snapshots.

## UI Rules

- UI renders authoritative read models plus transient stream patches from runtime events, and
  refetches state-backed read models after invalidation events.
- UI may request actions; lower packages decide lifecycle outcomes.
- Panes are projections over state/runtime, not package boundaries.
- Desktop adapters may apply transient `surface.stream` patches and map state read models into view
  models. They must not create package-owned durable snapshots, duplicate durable preview fields,
  infer lifecycle state, or persist projection state outside `@svvy/state`.
- Workflows pane remains read-only generated package visibility.
- App logs are observability, not canonical state.
- Composer submission calls `runtime.messages.submit(...)` with the new user message and target. It
  must not send full pi message arrays, generated system prompts, generated context previews, or
  renderer `Agent` internals as the package boundary.
- Submit responses and follow-up read-model fetches use renderer-safe state/core models, not pi
  transcript objects. The canonical surface transcript contract is `SurfaceTranscriptReadModel`
  from `@svvy/state` / `@svvy/core`, with message, assistant-stream, usage, and model-choice slices
  derived from committed product state and ordered runtime stream patches. Desktop code may adapt
  that read model into Svelte view state, but it must not define parallel durable read-model
  contracts such as `ConversationMessageReadModel` or `AssistantStreamReadModel` unless the
  state/core package spec adds them first.
- Renderer/shared RPC contracts must not import pi-native message, session, model, event, tool, or
  resource-loader types. Shared RPC contracts use hoisted `@svvy/core` schemas or generated
  declarations.
- Renderer code must not construct, mirror, or mutate pi `Agent` objects. It keeps plain view models
  derived from state read models plus ordered runtime stream patches.
- Renderer code must not import extension implementation records to resolve actor bindings,
  defaults, or readiness. Agents/Extensions UI consumes state-backed read models and submits typed
  edit intent through runtime or app command facades. Renderer-facing state facades remain
  read-model-only.
- `SendPromptRequest`-style desktop contracts normalize to target plus one new user message plus
  delivery/client telemetry metadata before calling runtime. They do not expose `messages`,
  `systemPrompt`, pi history objects, or renderer `Agent` state.

Renderer-safe prompt-submission input:

```ts
type DesktopSubmitPromptRequest = {
  panelId: string;
  target: PromptTarget;
  text: string;
  attachments?: RuntimeSubmittedAttachment[];
  clientRequestId: string;
};

async function submitPromptFromDesktop(req: DesktopSubmitPromptRequest) {
  return runtime.messages.submit({
    target: req.target,
    message: {
      text: req.text,
      attachments: req.attachments,
    },
    delivery: "enqueue-and-run",
    clientSubmission: {
      clientRequestId: req.clientRequestId,
      source: "desktop",
    },
  });
}
```

`DesktopSubmitPromptRequest` must not contain `messages`, `systemPrompt`, `toolDeclarations`,
`generatedContext`, `panelSnapshot`, pi session objects, pi message refs, or state read-model
snapshots. `panelId` is a desktop placement/detail field; runtime receives only the normalized
target, one new message, delivery mode, and client telemetry.
Before calling runtime, the desktop bridge resolves the current panel binding from the state read
facade using an authoritative read-model revision and verifies that `panelId` is bound to `target`.
Renderer cache may be used only as an optimistic precheck; it is not authority for routing or target
validation. A mismatch fails with a typed desktop bridge validation error; desktop must not submit a
prompt to a target merely because the renderer supplied that target.

Desktop-owned pre-runtime validation failures and renderer/RPC adaptation failures use a closed
`DesktopBridgeErrorContractSchema` composed from `@svvy/core` ids plus boundary issue schemas.
Renderer/RPC errors never expose raw `Cause`, stack traces, host errors, renderer objects, state
facade errors, runtime facade errors, package-private service errors, or foreign exception objects:

```ts
export const DesktopBridgeErrorContractSchema = Schema.Struct({
  operation: Schema.String,
  reason: Schema.Literals([
    "invalid-input",
    "invalid-panel-binding",
    "state-facade-failed",
    "runtime-facade-failed",
    "renderer-disconnected",
    "desktop-shutdown",
  ]),
  message: Schema.String,
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
});
```

Renderer-safe command stdin input:

```ts
type DesktopWriteCommandStdinRequest = {
  commandId: CommandId;
  text: string;
  clientSubmission?: RuntimeClientSubmissionInput;
};

async function writeCommandStdinFromDesktop(req: DesktopWriteCommandStdinRequest) {
  return runtime.commands.writeStdin({
    commandId: req.commandId,
    text: req.text,
    clientSubmission: req.clientSubmission,
  });
}
```

Desktop bridge code may use `workspaceId` only to validate renderer panel binding or choose
renderer transport. It must not select a workspace runtime scope, runtime facade, process handle, or
command session by `workspaceId`. Runtime command control is always sent to the single
bootstrap-provided runtime facade with durable ids such as `commandId`; runtime validates command
ownership, durable command status, and live stdin admission through `runtime.commands.writeStdin(...)`.
`panelId`, selected session id, focused surface, command-inspector snapshots, process handles, Shell
`session_id`, and renderer command state must not cross this boundary.

- Settings panes may edit preferences through `StateCommandsFacade`. Approval panes may answer
  approval requests only through `runtime.approvals.answer(...)`.
  Renderer code does not evaluate auto-review policy, sandbox allow/deny policy, queue delivery,
  extension readiness, generated-context freshness, or command terminalization.
- Live transcript rendering applies `surface.stream` patches for immediate display and refetches
  read models after `workspace_read_model.changed`, `app_read_model.changed`, or `command.changed`
  events.
- Every runtime event carries a monotonically increasing app-runtime `sequence` used as the
  subscription cursor. Desktop ignores duplicate or older events and refetches/rebaselines affected
  read models when an event sequence gap is observed. `surface.stream` events additionally carry
  `streamSequence`, the target-local live transcript patch cursor for that surface. Desktop applies
  `surface.stream` patches in `streamSequence` order for each `surfacePiSessionId`; it must not use
  app-runtime `sequence` as the per-surface patch cursor.
- Dockview panel focus, pane layout, and panel bindings remain desktop concerns. They must not be
  required for headless runtime use.

## Stream And Bridge Lifetimes

- Runtime `Stream` subscriptions are bridged to Electrobun IPC/event callbacks by app bridge adapter
  fibers.
- Each renderer/window subscription consumes the runtime-owned bounded per-subscriber event buffer
  sized by `RuntimeLayerConfig.eventSubscriberBufferCapacity` (default `256`). Desktop may add a
  tiny Electrobun callback handoff queue only inside the bridge adapter, but it must not create a
  second product-level cursor, replay buffer, or capacity setting. Runtime publication and state
  command completion must never await Electrobun callback delivery after commit. When the runtime
  per-subscriber buffer overflows, the bridge closes only that subscriber with
  `{ reason: "slow-consumer", eventGenerationId, lastContiguousSequence, rebaselineRequired: true }`,
  drops renderer-local `surface.stream` patches for that subscription, and requires
  `state.readModels.rebaseline(...)` before resubscribe. Any receipt or app-log fact is emitted by
  the runtime/app-bootstrap diagnostic path through runtime/state ports, not by renderer code or
  desktop-owned product state mutation.
- Window close, workspace close, app shutdown, and renderer unsubscribe interrupt the corresponding
  subscription fiber.
- Runtime event sequence gaps trigger a state read-model refetch/rebaseline through the state facade.
- Rebaseline returns authoritative read-model baselines from `@svvy/state`; it does not ask runtime
  events to replay durable state. Surface stream gaps discard renderer-local stream patches for that
  surface and fetch a fresh `SurfaceTranscriptReadModel`.
- The bridge validates inbound RPC payloads with hoisted `@svvy/core` schemas before calling Effect
  services.
- Typed package errors are normalized into stable renderer error payloads and app-log facts.
- Svelte stores and projection helpers remain plain renderer code and must not implement queue
  claiming, turn execution, prompt refresh, command terminalization, or recovery.

## Resource Lifetime Matrix

| Resource                                | Owner package/service                                                    | Backing kind                                           | Lifetime kind              | Acquired by                                                                       | Released by                                                                                            | Reused across calls                         | Interruption behavior                                                                                              | Required receipts/tests                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| App `ManagedRuntime`                    | product app bootstrap consumed by desktop                                | Effect `ManagedRuntime`                                | `appBootstrapScoped`       | app bootstrap calls `ManagedRuntime.make(...)` after config/state path resolution | app shutdown or startup-failure disposal                                                               | yes, for all app bridge calls while healthy | startup failure is terminal for that instance; shutdown rejects new calls with typed shutdown                      | startup failure surface, runtime disposal, shutdown rejection tests                            |
| Runtime event bridge subscription fiber | product app/bootstrap runtime-event adapter                              | Effect subscription fiber plus bounded callback buffer | `bridgeSubscriptionScoped` | app bridge calls runtime facade `events(...)`                                     | unsubscribe, window close, workspace release, runtime restart, app shutdown, or slow-consumer overflow | no                                          | interruption closes callback with captured `Exit`, sequence cursor, and close reason; overflow requires rebaseline | subscription attached/closed, slow-consumer dropped/rebaselined, no post-commit blocking tests |
| Renderer runtime-event callback handle  | `@svvy/desktop` bridge adapter                                           | renderer callback registration                         | `bridgeSubscriptionScoped` | renderer `runtimeEvents.subscribe(...)`                                           | unsubscribe, window close, workspace release, runtime restart, app shutdown, or slow-consumer overflow | no                                          | renderer callback receives close/error payload and rebaselines through state refetch; it owns no Effect fiber      | renderer unsubscribe and rebaseline UI tests                                                   |
| Renderer read-model cache subscription  | renderer store/projection module                                         | renderer-local cache                                   | `bridgeSubscriptionScoped` | component mount or pane activation                                                | component destroy, pane close, window close, rebaseline reset                                          | yes, within that UI scope                   | interruption drops transient patches and keeps no runtime resource                                                 | sequence-gap rebaseline and stale-refetch discard tests                                        |
| Electrobun window bridge callbacks      | app bridge adapter                                                       | Electrobun callback registration                       | `bridgeSubscriptionScoped` | window bridge registration after runtime readiness                                | window close, bridge teardown, runtime restart, app shutdown                                           | yes, while window lives                     | callback receives terminal close/error payload; no Effect service leaks to renderer                                | bridge close and post-dispose rejection tests                                                  |
| Browser/headless `AsyncIterable` edge   | product app/bootstrap browser-tool/headless adapter, not `@svvy/desktop` | adapter fiber over runtime subscription                | `bridgeSubscriptionScoped` | browser-tool/headless subscribe call                                              | iterator return/throw, caller abort, runtime restart, app shutdown                                     | no                                          | interruption closes iterator with captured `Exit`; caller must rebaseline on cursor gaps                           | iterator close, abort propagation, rebaseline tests                                            |

All renderer/Electrobun desktop bridge resources close with the captured interruption `Exit` from
their owner scope. Browser-tool and headless resources follow the same facade lifetime rules as
sibling app/bootstrap edges, not as desktop-owned runtime behavior. Finalizers may not blindly
report `Exit.void`; tests assert cancellation, runtime restart, slow consumer, and app shutdown close
reasons separately.

## Dependency Rules

- Depends on `@svvy/core` schemas and renderer-safe ids/contracts.
- May import public facade TypeScript types from `@svvy/state` and `@svvy/runtime`; runtime/state
  service tags, layers, ports, repositories, and implementation modules are forbidden.
- Renderer/shared RPC modules must not import `effect/ManagedRuntime`, `effect/Layer`,
  `effect/Context`, Effect `Stream`, runtime/state `Context.Service` classes, package root layers,
  or Effect runners. Any Effect use in `@svvy/desktop` is limited to renderer-safe
  cancellation/error mapping utilities that do not acquire package services.
- May depend on Svelte, Electrobun, Dockview, Lucide, and UI-only libraries.
- Must not be imported by non-UI packages.

## Product Source Ownership

Product source areas owned by this package:

- `packages/desktop/src/**`
- `src/mainview/`
- desktop app-shell UI and renderer bridge modules after app bootstrap injects facades
- renderer-local projection helpers that are UI-only; reusable read-model selectors live in
  `@svvy/state`

## Acceptance Criteria

- Desktop code receives renderer-safe facades from the app `ManagedRuntime` and never imports
  package-private state, runtime, extension, sandbox, or pi implementation modules.
- UI submissions are target-plus-message commands into runtime APIs, not pi message arrays, system
  prompts, generated tool definitions, or transcript fragments.
- Desktop renders committed state read models and runtime stream patches; it does not own queue
  policy, recovery, transcript construction, tool lifecycle, or extension dependency resolution.
- Desktop owns layout interaction and renderer-local transient view state; persisted workspace
  layout, panel bindings, and restore metadata are submitted through the app command facade into
  state-backed layout/workspace-tab ports and treated as non-authoritative renderer caches after
  read.
- Non-UI packages never import desktop, Svelte, Electrobun, or renderer-only modules.

## Tests

- Renderer unit tests.
- RPC contract tests against fake runtime.
- ManagedRuntime bridge tests proving RPC handlers use caller-owned facades, do not create ad hoc
  Effect runtimes, map typed failures/defects to stable renderer errors, propagate cancellation,
  close stream/subscription scopes, fail cleanly after runtime disposal, and do not embed queue,
  prompt dispatch, state mutation, tool-execution, or recovery policy.
- Boundary tests proving renderer/shared RPC modules receive prebuilt facades and do not import
  service tags, Effect streams/layers, state/runtime ports, pi adapter internals, extension
  implementation catalogs, sandbox services, or package layer factories.
- Runtime stream subscription disposal tests for window close, workspace close, and renderer
  unsubscribe.
- Workspace RPC contract tests proving `writeCommandStdin` routes through the bootstrap-provided
  runtime facade by workspace scope and durable `commandId`, rejects after shutdown, maps typed
  runtime errors, and does not call Shell `write_stdin`, package-private command process handles, or renderer
  state.
- Sequence-gap rebaseline tests through state facade read models.
- Sequence-aware read-model refetch tests proving stale async refetch results are discarded and
  command-triggered runtime notifications use the same read-model refetch path.
- App shutdown coordinator tests proving Electrobun/window shutdown reaches bootstrap, new runtime
  calls reject with typed shutdown after shutdown/restart, callbacks close, subscriptions terminally
  close, visible work records shutdown receipts/app-log facts, and `ManagedRuntime.dispose()` is
  owned only by bootstrap.
- Boundary tests proving renderer/shared contracts do not import pi-native message/session/model
  types and non-UI packages do not import `@svvy/desktop`.
- Browser/e2e tests through the supported OrbStack lane.
- Visual verification for high-risk panes.
