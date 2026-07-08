# `@svvy/pi-adapter` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/pi-adapter`

## Purpose

`@svvy/pi-adapter` is the scoped pi integration package for `svvy` surfaces: it owns pi session
access, true `systemPrompt` delivery, turn streaming adaptation, model metadata normalization,
helper jobs, and pi event normalization without owning product orchestration policy.

It translates runtime-owned requests typed by `@svvy/core` into pi session operations and translates
pi output into pi-normalized `PiRuntimeEvent` values defined by `@svvy/core`. `@svvy/runtime` turns
those adapter events into public `RuntimeEvent` notifications. The architectural role is adaptation
between `svvy` and pi; the package also owns the minimal scoped pi session access required for that
adaptation.

`@svvy/pi-adapter` is an Effect-native package. Session creation, turn execution, event streaming,
tool callback bridging, provider/model reads, and helper jobs are Effect services. Any Promise
adaptation is package-private to pi callback or transport edges; no public Promise or `AsyncIterable`
facade is defined unless this spec first adds an explicit diagnostics-only surface.

## Pi Version And Reference Source

The shipped adapter targets the installed `@mariozechner/pi-ai` and
`@mariozechner/pi-coding-agent` package versions declared by `packages/pi-adapter/package.json` and
enforced by package-boundary tests. The target version is `0.73.1` for both packages.

The checked-in `docs/references/pi-mono` checkout is a conceptual implementation reference only
unless its recorded pi version matches the versions declared by `packages/pi-adapter/package.json`.
Exact call shapes, option names, exported types, and event variants are validated against the
installed `0.73.1` package declarations under `node_modules` or an updated local pi reference
pinned to the same version. Specs that cite `docs/references/pi-mono` must identify whether the
claim is a stable conceptual behavior or an exact API fact.

## Owns

- Scoped pi session creation, opening, lookup, and session handles. Persisted references are
  accessed only through the `PiSessionReferencePort`.
- Loading actor instructions through pi's real `systemPrompt` channel.
- Sending real user messages to pi surfaces.
- Passing runtime-provided, pi-free tool declarations into pi as custom tools.
- Streaming assistant text, thinking, tool-call argument output, user-message commits, and
  assistant-message completion from pi.
- Mapping pi tool-call events into `@svvy/core` event shapes consumable by `@svvy/runtime`.
- pi transcript/history mechanics exposed as svvy refs.
- Provider/model/reasoning metadata normalization when pi is the source of that metadata.
- pi-specific error normalization.
- Runtime-requested helper model jobs such as title generation when those jobs run through pi.
- Explicit disabling of ambient pi resources that runtime did not pass as enabled.

## Does Not Own

- Product strategy.
- Generated actor context composition.
- Extension usage policy.
- Queue claiming, queue ordering, retries, or delivery.
- Handler-thread lifecycle or orchestrator reconciliation.
- Helper/title job scheduling, retry, durable records, naming policy, or event publication.
- Tool execution semantics beyond adapting runtime-provided Effect-native tool execution into pi's
  callback API inside the turn scope.
- Command lifecycle persistence.
- Sandbox policy.
- Approval decisions.
- UI rendering.
- Smithers, Workflows, or builtin extension semantics.
- Prompt or instruction source files.

## Public API Shape

Effect-native service surface:

```ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  PiAdapterError,
  type ClosePiSessionInput,
  type CreatePiSessionInput,
  type GenerateTitleInput,
  type GenerateTitleResult,
  type InterruptPiTurnInput,
  type ListModelsInput,
  type ModelId,
  type ModelInfo,
  type OpenPiSessionInput,
  type PiRuntimeEvent,
  type PiRuntimePathsPort,
  type PiSessionRef,
  type PiSessionReferencePort,
  type ProviderAuthPort,
  type ProviderAuthStatusStatePort,
  type ProviderId,
  type RunPiTurnInput,
  type WorkspaceId,
} from "@svvy/core";

export class PiAdapter extends Context.Service<
  PiAdapter,
  {
    sessions: {
      create(
        input: CreatePiSessionInput,
      ): Effect.Effect<
        PiSessionRef,
        PiAdapterError,
        Scope.Scope | ProviderAuthPort | PiRuntimePathsPort | PiSessionReferencePort
      >;
      open(
        input: OpenPiSessionInput,
      ): Effect.Effect<
        PiSessionRef,
        PiAdapterError,
        Scope.Scope | ProviderAuthPort | PiRuntimePathsPort | PiSessionReferencePort
      >;
      close(input: ClosePiSessionInput): Effect.Effect<void, PiAdapterError>;
    };
    turns: {
      run(
        input: RunPiTurnInput,
      ): Effect.Effect<
        PiAdapterTurnStream,
        PiAdapterError,
        Scope.Scope | ProviderAuthPort | PiSessionReferencePort
      >;
      interrupt(
        input: InterruptPiTurnInput,
      ): Effect.Effect<void, PiAdapterError, PiSessionReferencePort>;
    };
    models: {
      list(
        input: ListModelsInput,
      ): Effect.Effect<ReadonlyArray<ModelInfo>, PiAdapterError, ProviderAuthStatusStatePort>;
    };
    helperJobs: {
      generateTitle(
        input: GenerateTitleInput,
      ): Effect.Effect<GenerateTitleResult, PiAdapterError, ProviderAuthPort | PiRuntimePathsPort>;
    };
  }
>()("@svvy/pi-adapter/PiAdapter") {}

interface PiAdapterTurnStream {
  readonly stream: Stream.Stream<PiRuntimeEvent, PiAdapterError>;
  close(): Effect.Effect<void, PiAdapterError>;
  readonly closed: Effect.Effect<void, PiAdapterError>;
}
```

Core-owned history DTOs exist only as reserved pi-adapter contracts. The root `PiAdapter` service
does not expose a `history` group. A history group may be added only with concrete
`restoreToEntry(...)` and `forkFromEntry(...)` contracts covering scoped live-handle behavior,
persisted-reference writes, active-turn exclusion, and package tests. Runtime-owned edit-and-resend
and handler forked-history flows must use an explicitly specified adapter history surface and must
not mutate pi history through a package-private escape hatch.

`sessions.create(...)` and `sessions.open(...)` are single-live-handle acquisitions for a durable
`surfacePiSessionId`. If a scoped live handle for the same surface already exists, the adapter
returns the existing `PiSessionRef` only when the requested workspace, actor, model/provider
authority, and persisted reference fingerprint match the live entry and no active turn is running.
Conflicting duplicate acquisition fails with a typed `PiAdapterError`; it never replaces a live
handle implicitly. Replacing a live handle is a runtime-owned close/open sequence with explicit
scope finalization.

`turns.run(...)` requires the caller-provided turn `Scope.Scope` in addition to the already acquired
surface scope. The returned `PiAdapterTurnStream` owns one active-turn child scope under the surface
scope; `close()` is idempotent, interrupts/cleans any active pi subscription and callback bridge,
then completes `closed` exactly once. If the stream fails before a terminal event, `closed` fails
with the same typed `PiAdapterError`. If the consumer drops iteration without calling `close()`, the
stream finalizer runs the same close path. `close()` shuts down the adapter queue and does not
promise to drain buffered or future pi events after close begins; events not delivered before queue
shutdown are outside the stream contract.

The primary layer constructs the `PiAdapter` service. Provider auth, persisted pi session
references, provider auth status, packaged pi runtime paths, and caller scopes are method-level
requirements named on each service method instead of eagerly acquired by the layer:

```ts
export const layer: Layer.Layer<PiAdapter, PiAdapterError> = Layer.effect(
  PiAdapter,
  makePiAdapter(),
);
```

Package-private pi protocol/helper transports do not import `effect/unstable/process`.
If a pi-adapter operation needs an Effect-managed helper process, the same patch must adopt
`ChildProcessSpawner.ChildProcessSpawner` in `effect-v4.spec.md`, add the exact manifest and
package-boundary rows, provide the host spawner layer, and add fake-spawner tests for helper
protocol paths.

`ProviderAuthPort.getProviderAuthSnapshot(...)` and
`ProviderAuthPort.refreshProviderCredentialSnapshot(...)` return provider-auth snapshots with
`health: "usable" | "missing" | "expired" | "refresh_failed"`, credential material only when usable,
and redacted status otherwise. The adapter must not read global env, app auth stores, OS keychain, or
pi ambient credentials directly. Every credential-consuming operation starts by calling
`getProviderAuthSnapshot(...)`. A usable snapshot is installed only into the operation-scoped or
turn-scoped pi auth surface needed for that call. A missing snapshot fails immediately. An expired
snapshot triggers one `refreshProviderCredentialSnapshot(...)` call for that provider and operation;
the refreshed usable snapshot is used for the operation, refreshed `expired` maps to
`"provider-auth-expired"`, and refreshed `refresh_failed` maps to
`"provider-auth-refresh-failed"`. An initial `refresh_failed` snapshot fails without a second
refresh attempt unless the caller explicitly requested refresh through a provider-auth product
operation outside pi-adapter. No stale credential snapshot is retained across prompt-bearing turns
without a fresh per-turn auth check.
Expired or refresh-failed snapshots fail session/turn/model operations with typed `PiAdapterError`
and are not installed into pi auth storage.
Provider-auth failures map to `PiAdapterError` reasons exactly: `health: "missing"` maps to
`"provider-auth-missing"`, `health: "expired"` maps to `"provider-auth-expired"`, and
`health: "refresh_failed"` maps to `"provider-auth-refresh-failed"`. These reasons are used for
session creation/opening, prompt turns, model metadata operations that require live credential
material, and helper jobs. The adapter never collapses credential-health failures into
`"session-open-failed"` or `"turn-failed"`.

Model metadata, provider auth snapshots, pi runtime paths, and helper-job probes are direct uncached
Effect operations unless this spec adds a named `Cache`, `ScopedCache`, `Resource`, `RcMap`, or
`RcRef` owner with capacity or idle TTL, lookup/acquire dependencies, invalidation owner, scope
lifetime, release semantics, and tests.

Promise/`AsyncIterable` facade:

No product Promise facade is defined for `@svvy/pi-adapter`. Normal desktop, browser-tool,
headless, and runtime consumers do not call pi directly; they call `@svvy/runtime`, which owns
prompt submission, queueing, tool routing, and durable state updates before delegating pi work to
`@svvy/pi-adapter`. Pi session creation, turn execution, helper jobs, runtime prompt dispatch, and
reserved history DTO validation remain Effect-owned adapter/package-test surfaces. The restricted
`@svvy/pi-adapter/session` subpath below is an app-bootstrap bridge over pi-native construction, not
a product Promise facade and not available to desktop, renderer, browser-tool, headless, runtime
facade, generated-package, diagnostics, or agent-facing callers. If a diagnostics-only facade is
added, this spec must first name its exact method signatures, inputs, outputs, package-probe use
cases, and boundary tests. Pi-adapter probing stays on the Effect service or package test fixtures
unless this spec adds that diagnostics-only facade contract.

Public export map:

- `@svvy/pi-adapter` exports only `PiAdapter` and `layer`.
- `@svvy/pi-adapter/session` exports the boundary-tested app-bootstrap session-catalog bridge only:
  `createPiManagedAgentSession(...)` and `CreatePiManagedAgentSessionResult`. The `PiAdapter`
  service owns managed pi session construction for turn execution; app/bootstrap may use this
  restricted subpath only to compose the approved catalog/bootstrap seam and does not own prompt
  dispatch, tool execution, or pi session lifecycle policy. `CreatePiManagedAgentSessionResult`
  contains pi-native `AgentSession`, `AuthStorage`, `ModelRegistry`, and active-model values; those
  values are confined to this restricted app-bootstrap subpath and its boundary-tested consumer.
  Public root declarations, runtime facades, renderer contracts, generated-package contracts,
  diagnostics outputs, state records, and agent-facing values remain pi-free. The subpath is not a
  product facade, renderer API, generated-package API, diagnostics surface, queue dispatcher, or
  alternate pi control surface.
- `@svvy/pi-adapter/messages` exports only pure runtime-message-to-pi-message conversion helpers:
  `buildPiUserMessageFromRuntimeSubmittedMessage(...)` and `runtimeSubmittedMessagePromptText(...)`.
  This subpath is pure data adaptation for adapter package tests and the app-bootstrap
  session-catalog prompt-delivery bridge named by this spec. It must not expose pi session handles,
  pi clients, streams, provider auth, prompt execution, helper jobs, or product-state access.

No other public subpath is defined. Any additional pi-native subpath requires an exact export-map
entry, exported-symbol ledger, owner/use case, package-boundary expectation, and focused tests in
the same change.

Core-owned session and turn input contracts are defined in `@svvy/core`:
`CreatePiSessionInput`, `OpenPiSessionInput`, `ClosePiSessionInput`, `RunPiTurnInput`,
`PiSystemPromptBinding`, `PiAmbientPiResourceEnablement`, `RestorePiHistoryEntryInput`,
`ForkPiHistoryEntryInput`, `InterruptPiTurnInput`, `ListModelsInput`, `ModelInfo`, `GenerateTitleInput`,
`GenerateTitleResult`, and `PiRuntimePathsSnapshot`. This spec constrains how the adapter
implements those contracts; it does not redefine them.

Target `InterruptPiTurnInput` is:

```ts
type InterruptPiTurnInput = {
  surfacePiSessionId: SurfacePiSessionId;
  turnId: TurnId;
};
```

`enabledAmbientPiResources` never carries credentials, filesystem paths, executable paths, raw pi
loader objects, or provider runtime objects. Provider credentials come only through `ProviderAuthPort`;
packaged pi runtime paths come only through `PiRuntimePathsPort`.

Runtime creates or opens exactly one pi session per durable `surfacePiSessionId`. The adapter writes
the persisted pi session reference through `PiSessionReferencePort.savePiSessionReference(...)` after
successful creation, reads it through `PiSessionReferencePort.getPiSessionReference(...)` before
reopen, and validates it through `PiSessionReferencePort.validatePiSessionReference(...)`. Runtime
surface lifecycle methods call `PiAdapter.sessions.open(...)` and map `PiAdapterError`; they do not
duplicate persisted-reference validation or inspect pi-native reference internals. The adapter must
rebind the true pi `systemPrompt` channel from
`systemPromptBinding.text` before every prompt-bearing `turns.run(...)`, even when reopening an
existing session. It does not accept prior transcript prose, generated-context read-model payloads, or UI
message arrays as substitutes for the true system-prompt channel.

Rebinding must be observable on consecutive prompt-bearing turns for the same durable
`surfacePiSessionId` and persisted pi session reference. Implementations may update pi's active
system-prompt channel or reacquire the pi runtime handle inside the turn scope, but must not create a
new product surface, fork history, flatten history into prose, or rely on session construction-time
prompt capture. Tests must run two turns on the same `PiSessionRef` with different bindings and
assert the second turn sees only the second binding.
If system-prompt rebinding fails after a live session is acquired but before user-message submit, the
adapter fails the turn with typed `PiAdapterError`, sends no prompt text, activates no tools, and
closes any turn-local callback/subscription scope. Any partially mutated pi session state is either
rolled back through the installed pi API or the live handle is closed and removed from the
live-session registry; runtime may reopen from the persisted reference on the next turn.

`PiSessionReference` is an opaque adapter-shaped record persisted by `@svvy/state` through
`PiSessionReferencePort` and keyed by `surfacePiSessionId`. Public consumers may see only
`{ surfacePiSessionId, referenceFingerprint }`. Adapter-private payload fields may include backend
kind, pi session id, storage locator, and adapter version. `open(...)` must validate that the
persisted reference belongs to the requested `workspaceId`, `surfacePiSessionId`, actor kind, and
adapter backend version before returning a scoped `PiSessionRef`.

Package API surface includes the `PiAdapter` Effect service, scoped session lifecycle, turn stream,
model metadata reads, helper jobs, provider-auth port use, pi-session-reference port use, and
packaged runtime path port. History DTOs are core-owned reserved contracts only; they are not a
public pi-adapter service group and cannot be called through the restricted session subpath.

Runtime passes `@svvy/core` `NativeToolDeclaration` values into `turns.run(...)`.
`NativeToolDeclaration` is schema/metadata only. It contains no `execute`, `prepareArguments`, pi
callback, or handler function. Runtime supplies the only execution surface through a pi-free
Effect-native `PiToolExecutor(input)` function that returns
`Effect.Effect<NativeToolResult, RuntimeToolExecutionError>`. The executor input is
`PiToolExecutionInput & { emit(update: PiToolExecutionUpdate): Effect.Effect<void, RuntimeToolExecutionError> }`;
`emit(...)` is the only callback surface for accepted-command, argument-snapshot, and progress
updates while pi is waiting for the tool result. Conversion to pi `ToolDefinition[]` happens inside
adapter turn setup and is not exported as a public package API.
`PiToolExecutor` is semantic tool execution supplied by runtime as part of `RunPiTurnInput`; it is
not an Effect runner, runtime facade, `ManagedRuntime`, Promise bridge, or app/bootstrap callback
runner. The executor may require services from the active turn context, and the adapter-owned bridge
must run it against that captured context.
`@svvy/pi-adapter` adapts that Effect-returning executor to pi's native callback API inside the
turn scope, then maps pi callback inputs/results to and from `@svvy/core` tool result shapes. The
Promise adaptation required by pi's native callback API is package-private to the scoped turn bridge
and is driven only from pi's synchronous event subscription callback and
`RunPiTurnInput.toolExecutor`, which runtime backs with its package-private accepted native tool
runner. The adapter must not depend on desktop/headless facades, create or receive a per-request
`ManagedRuntime`, or expose a public callback-shaped package API for this bridge. `PiAdapter.layer`
does not require an app-bootstrap-provided callback runner because that would require the app
`ManagedRuntime` before the pi-adapter layer is acquired.
Restricted/public bootstrap inputs must not receive app/bootstrap-owned runners, `ManagedRuntime`,
desktop/headless facades, or arbitrary effect-execution callbacks. The only permitted
callback-runner parameter is the package-owned, turn-scoped `runToolEffect` passed from
`turns.run(...)` into the package-local session/custom-tool construction path, backed by the context
captured inside that turn.

The only permitted package-private runner exception is the pi callback bridge created inside
`turns.run(...)`. It captures the current turn Effect context and creates a turn-scoped callback
runner only for queueing normalized pi subscription events and for the Effect returned by
`RunPiTurnInput.toolExecutor`. The runner primitive is exactly Effect v4
`Effect.runPromiseWith(services)` or `Effect.runPromiseExitWith(services)`, where `services` is the
`Context` captured inside the active `turns.run(...)` scope. Promoting either helper requires a
same-change update to the Effect adoption manifest and an exact package-boundary allowlist for the
package-private bridge file `packages/pi-adapter/src/pi-adapter.ts`. Bare
`Effect.runCallback`, bare `Effect.runPromise`,
`ManagedRuntime.make`, `Layer.build*`, and bootstrap-provided runner services are not allowed inside
`@svvy/pi-adapter` service code. This is the only allowed runner use in pi-adapter service code. It
is treated as the pi callback bridge edge, is released by the turn stream close path, never creates
or receives a `ManagedRuntime`, never imports desktop/headless facades, and never runs arbitrary
package effects outside event queueing and the tool executor. Callback aborts, typed failures,
defects, and interruption are mapped through `Exit`. Package-boundary tests cover the exact file
allowlist and the absence of public callback or pi-native tool-definition exports. Public
`@svvy/pi-adapter` boundaries must not return pi-native tool definitions or callbacks.
The captured `services` value is obtained inside the active `turns.run(...)` effect after the turn
scope exists, and it must include that turn scope. Callback invocations after `close()` starts or
after the turn scope finalizes fail or interrupt before running runtime tool effects. Tests prove a
late pi callback cannot invoke `RunPiTurnInput.toolExecutor` after turn close.

Adapter package-private tests may invoke a managed pi custom-tool callback directly only with a fake
`PiToolExecutor` that returns predetermined `NativeToolResult` or `RuntimeToolExecutionError`
values. That fixture validates adapter callback mapping, cleanup, and pi-native encapsulation; it is
not a product execution path, does not call `@svvy/runtime`'s accepted-tool runner, does not
synthesize `PromptExecutionContext`, and is not exposed through non-UI harnesses. Non-UI product
harnesses drive tools only by submitting messages through `@svvy/runtime`, so runtime creates
durable turn and command state before accepted tool execution.

The root `@svvy/pi-adapter` package entrypoint exports only the `PiAdapter` Effect service and
`layer`. It exports no Promise facade, `AsyncIterable` facade, callback bridge, or edge
facade factory. Pi-free input/output contracts and typed boundary errors are imported from
`@svvy/core`; the adapter does not redefine, duplicate, or re-export those contract names as an
alternate contract surface. The root entrypoint must not export pi-native classes, pi-native tool
shapes, pi-native model/provider types, transport handles, callback bridges, session-manager
objects, raw protocol frames, or runtime implementation helpers.

`@svvy/pi-adapter/messages` is a narrow exported adapter-owned conversion subpath for package tests
and adapter implementation wiring only. It converts core-owned submitted-message records into
adapter-private pi prompt inputs. Its public value surface is conversion functions only. Return
types are intentionally opaque or package-local adapter result types; the subpath must not export
structural pi-shaped DTO names, pi message aliases, pi message classes/interfaces, session-manager
handles, runtime facades, state ports, transport handles, app/bootstrap callbacks, or stable
serialized pi payload contracts. Runtime, desktop, generated packages, renderer/shared contracts,
and app/bootstrap production code must not depend on this subpath unless a package-boundary test
names that exact use and the spec is updated to explain the product reason. The approved production
consumer is `src/bun/session-catalog.ts`, and the only approved reason is app-bootstrap composition
that adapts committed runtime submitted-message records into pi prompt inputs for the managed-session
catalog bridge. This exception does not make the subpath a runtime facade, renderer contract,
generated-package contract, or general message DTO surface.

Native-tool conversion, pi handles, transport helpers, and pi-native objects are package-private
implementation details behind the `PiAdapter` service. Managed-session bootstrap is confined to the
restricted public `@svvy/pi-adapter/session` subpath for the app-bootstrap session-catalog bridge.
That subpath may import pi-native packages and may return only the pi-native managed-session handle
and closely coupled pi session resources needed by that app-bootstrap catalog adapter:
`AgentSession`, in-memory `AuthStorage`, `ModelRegistry`, and the active resolved pi model. It is not
a general product facade and is not available to runtime, desktop, renderer/shared contracts,
generated packages, extensions, sandbox, or state.
No `@svvy/pi-adapter/internal/*` subpath is a stable architecture import for app bootstrap,
runtime, extensions, state, sandbox, desktop, generated declarations, generated packages, or
renderer/shared contracts. Package-private adapter implementation tests may import internals only
to exercise adapter-owned implementation details that are not public package APIs. Runtime,
desktop, generated-package, extension, sandbox, state, and renderer/shared production code compose
pi through the public `PiAdapter` service/layer and core-owned port contracts. App bootstrap may use
the restricted `@svvy/pi-adapter/session` subpath only for the approved pi-session persistence
wiring named by this spec and enforced by package-boundary tests. The
`@svvy/pi-adapter/messages` conversion subpath remains a restricted exported conversion surface; any
production consumer beyond adapter-owned implementation wiring requires a package-boundary test that
names the exact use.
Package-local native-tool modules, including any `native-tools` conversion helpers, are
implementation-only files and must not appear in the package export map. Tests may import them only
by package-local relative paths.

API groups:

- `sessions`
- `turns`
- `models`
- `helperJobs`

`helperJobs.generateTitle(...)` uses an operation-scoped pi model call with exactly the current
`GenerateTitleInput` fields: `workspaceId`, `workspaceSessionId`, `surfacePiSessionId`, optional
`threadId`, `prompt`, `model`, and `reasoning`. `input.prompt` is the complete runtime-prepared
title-helper prompt, including any title-specific instructions and source text; the adapter binds
that text as the helper operation's pi system/user prompt according to the installed pi API, and
must not read the user surface's active prompt, active tools, transcript rows, UI state, or pending
queue state. The adapter applies the package's bounded title-helper timeout around the helper
operation, aborts and releases the helper pi handle on timeout/interruption, maps timeout to a typed
`PiAdapterError`, extracts a title string from the helper model response, rejects empty or generic
titles with typed `PiAdapterError`, and validates the constructed `{ title, model }` value against
`GenerateTitleResultSchema` before returning. The adapter must not invent a fallback title.
It must not call `prompt(...)` on the user surface session, append to user transcript, inherit
active tools, or reuse active-turn messages.

## Adapter Rules

- Must use pi's real `systemPrompt` channel.
- Must not construct, embed, invoke, or expose pi TUI, readline, REPL, custom shell,
  terminal-loop, stdin/stdout interactive CLI, or alternate terminal surfaces. Interactive product
  work enters only through runtime-owned svvy/pi surface turns and runtime-provided tools.
- Must not flatten prior messages into role-labelled transcript prose to repair or advance a
  surface.
- Must send the submitted prompt body as the real new pi user message for that surface.
- Must not load ambient pi tools, extensions, skills, prompt templates, themes, commands, hooks,
  provider adapters, credentials, execution-policy settings, or equivalent host resources unless
  runtime passes explicitly enabled `enabledAmbientPiResources`. Empty or omitted
  `enabledAmbientPiResources` means no ambient pi resources are available for the turn.
- Must pass only the runtime-provided tool declarations for the addressed actor surface.
- Must not own or mutate native tool schemas. Tool declaration shapes live in `@svvy/core`;
  concrete declarations, actor slicing, metadata, and handler lookup live in `@svvy/extensions`;
  `@svvy/runtime` routes accepted model tool calls and effects; the adapter only converts
  runtime-provided declarations into pi custom-tool objects.
- Must hide pi-specific event details behind `@svvy/core` event shapes before those events leave the
  adapter package.
- Must keep pi transcript/history as pi-owned state; runtime, thread, episode, queue, command,
  request-input, approval, workflow task-attempt, and artifact facts stay in `@svvy/state`.
- Must receive pi message timestamps from durable queue or turn facts written through core-owned
  state ports when converting runtime-submitted messages. The adapter does not call `Date.now()`, `new Date()`, or
  `DateTime.nowUnsafe()`, and does not call `clock.currentTimeMillisUnsafe()` or
  `clock.currentTimeNanosUnsafe()` to stamp prompt delivery; runtime/state time policy owns those
  facts.
- Must not claim queues, decide retries, refresh prompts, create command records, reconcile handler
  threads, or publish runtime events.

## Effect Session And Turn Lifetimes

- Pi session creation is scoped through `Effect.Effect<PiSessionRef, PiAdapterError, Scope.Scope>`
  and uses `Effect.acquireRelease` internally. Runtime receives a stable `PiSessionRef`, not the raw
  pi session object.
- `PiSessionRef` is a pi-free `@svvy/core` reference value backed by persisted
  `PiSessionReference` data in `@svvy/state`. It is not an `AgentSession`,
  `AgentSessionRuntime`, `SessionManager`, transport handle, or wrapper around any pi-native object.
- Runtime owns a surface pi-session child scope keyed by `surfacePiSessionId`, acquired from the
  runtime package-private surface scope registry. That registry uses only primitives promoted in
  `packages/effect-adoption-manifest.ts`; `FiberMap`, `FiberSet`, and `ScopedRef` remain
  conditional implementation candidates until explicitly promoted. It is not a public adapter API
  and not a second `ManagedRuntime`.
  Adapter `sessions.create/open` require `Scope.Scope` in their Effect environment and acquire live
  pi handles into that caller-provided surface scope; adapter APIs never create hidden surface
  scopes and never expose pi-native handles.
- `sessions.create(...)` and `sessions.open(...)` acquire adapter-owned live handles into that
  surface scope, keyed by `surfacePiSessionId`. Scope finalization interrupts active turn streams,
  releases pi subscriptions/tool executor bridges, and closes adapter-owned live handles but does
  not delete the persisted pi reference.
- The adapter owns package-private live-session registry state keyed by the pi-free
  `PiSessionRef.surfacePiSessionId`. When the persisted `PiSessionReference` includes an
  adapter-private upstream pi session identity, that identity is validation data, not the registry
  key and not a field on the public `PiSessionRef`. Registry entries contain only scoped
  pi-native handles, event subscriptions, callback bridges, abort handles, and turn-local protocol
  state. The registry is populated only by `sessions.create(...)` / `sessions.open(...)` inside the
  caller-provided scope and is removed by that scope's finalizer or by `sessions.close(...)`.
  `turns.run(...)` and `turns.interrupt(...)` may borrow a live entry only after validating the
  pi-free `PiSessionRef` against `PiSessionReferencePort`; they must fail with a typed
  `PiAdapterError` when the durable reference exists but no live scoped handle is currently
  acquired.
  `helperJobs.*` use their own operation-scoped pi handle and must not borrow the user surface
  registry entry. Runtime owns whether to reopen the session or fail the turn; the adapter does
  not create hidden live handles as a side effect of `turns.run(...)`.
- The registry admits at most one active turn per live pi session. Concurrent `turns.run(...)` calls
  for the same `surfacePiSessionId` fail with a typed active-turn error before prompt submission.
  `sessions.close(...)`, `turns.interrupt(...)`, and parent-scope finalization race through one
  serialized terminal path: scope finalization wins resource ownership, interrupt wins turn
  terminalization when it addresses the active turn, and close rejects new turns before releasing the
  handle. Late nonterminal pi events after that terminal path are diagnostics only.
- Opening an existing pi session validates the persisted session reference, acquires the adapter
  live handle in the caller-provided scope, and returns the pi-free scoped reference.
- `sessions.close(...)` explicitly terminates the scoped live handle for
  `ClosePiSessionInput.session`. Persisted reference deletion or retention is a runtime-owned
  decision applied separately through `PiSessionReferencePort.deletePiSessionReference(...)`; the
  adapter must not derive close policy. It is not a substitute for ordinary scope finalization.
  Close first validates the pi-free session reference through `PiSessionReferencePort`; missing,
  stale, workspace-mismatched, surface-mismatched, actor-mismatched, or adapter-version-mismatched
  references map to typed `PiAdapterError` values before the adapter touches live registry state.
  Private pi session bytes and live handles never cross the port boundary.
- Runtime-provided custom tool execution is an Effect-native runtime service method over
  extension-owned handlers. The adapter wraps that method into pi's callback API inside the scoped
  turn and maps typed failures into pi-compatible tool errors.
- `turns.run(...)` borrows the scoped live handle for the stream lifetime, installs turn
  subscriptions with acquire/release finalizers, and returns a `PiAdapterTurnStream` containing the
  `Stream.Stream<PiRuntimeEvent, PiAdapterError>`, an explicit `close()` effect, and a `closed`
  receipt effect.
- Pi callback/event APIs are adapted with an adopted v4 scoped stream constructor or queue-to-stream
  path named by the Effect adoption manifest. `Stream.callback` is not permitted for this bridge
  until the same change promotes it in the manifest, boundary tests, and this spec. The bridge owns a
  bounded queue and unsubscribe/abort finalizers; accepted events backpressure through `Queue.offer`
  instead of using an overflow/drop policy. It must not expose unbounded callback buffers, orphan
  subscriptions, or background promises outside the stream scope.
- The stream preserves pi event order for assistant text, thinking, user-message commits,
  tool-call starts, tool-call argument deltas, tool-call completion, tool execution lifecycle, and
  assistant-message completion.
- The adapter maps checked-in pi source events into `PiRuntimeEvent` in one package-local mapping
  table. The baseline pi `AgentEvent` values are `agent_start`, `agent_end`, `turn_start`,
  `turn_end`, `message_start`, `message_update`, `message_end`, `tool_execution_start`,
  `tool_execution_update`, and `tool_execution_end`. For `message_update`, the nested pi
  `AssistantMessageEvent` values are `start`, `text_start`, `text_delta`, `text_end`,
  `thinking_start`, `thinking_delta`, `thinking_end`, `toolcall_start`, `toolcall_delta`,
  `toolcall_end`, `done`, and `error`. `agent_start` maps to a non-durable turn-start adapter event
  or is explicitly ignored by the mapping table; it is not an unknown event. Tool-execution events
  map from pi `AgentEvent` when using `AgentSession`; if custom-tool callbacks bypass pi's native
  tool event path, the adapter synthesizes equivalent
  `PiRuntimeEvent` values around the runtime-owned executor. The mapping table names the emitted
  `PiRuntimeEvent` variant, durable ids/refs used by runtime, terminal status mapping, and whether
  the event is persisted by runtime as a transcript delta, command/tool lifecycle fact, or turn
  settlement fact. Unknown pi event types are adapter typed errors unless the package spec is
  updated with a stable mapping. Runtime never receives the pi-native event object.

Baseline event mapping:

| pi source event                  | nested event                  | emitted `PiRuntimeEvent`                                             | Runtime persistence meaning                                                                 |
| -------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `agent_start`                    | none                          | none or non-durable adapter trace only                               | never persisted as product state                                                            |
| `turn_start`                     | none                          | none or non-durable adapter trace only                               | runtime already owns turn start facts                                                       |
| `message_start` for user message | none                          | none                                                                 | pi has acknowledged the queued text but has not reached the durable message lifecycle point |
| `message_end` for user message   | none                          | `pi.user_message.committed`                                          | runtime may link the queued user message to the pi message ref                              |
| `message_update`                 | `start`                       | none                                                                 | runtime waits for concrete content deltas                                                   |
| `message_update`                 | `text_delta`                  | `pi.assistant.text.delta`                                            | streamed assistant transcript patch                                                         |
| `message_update`                 | `thinking_delta`              | `pi.assistant.thinking.delta`                                        | streamed reasoning/thinking patch                                                           |
| `message_update`                 | `toolcall_start`              | `pi.tool_call.started`                                               | streamed command/tool span starts when pi exposes tool name                                 |
| `message_update`                 | `toolcall_delta`              | `pi.tool_call.arguments.delta`                                       | streamed accepted-tool argument snapshot data                                               |
| `message_update`                 | `toolcall_end`                | `pi.tool_call.accepted`                                              | runtime may invoke the accepted native-tool lane                                            |
| `message_update`                 | `done`                        | no standalone event unless needed to close an assistant message ref  | message completion is derived from `message_end` or `turn_end`                              |
| `message_update`                 | `error`                       | `pi.turn.finished` with `status: "failed"` or typed `PiAdapterError` | runtime terminalizes the turn failure                                                       |
| `message_end`                    | assistant/tool-result message | no standalone event unless needed to close an assistant message ref  | runtime closes assistant transcript state from message/turn completion                      |
| `tool_execution_start`           | none                          | `pi.tool_execution.started`                                          | command/tool lifecycle start marker                                                         |
| `tool_execution_update`          | none                          | `pi.tool_execution.updated` with `result: NativeToolResult`          | runtime may append pi-native command result snapshots                                       |
| `tool_execution_end`             | none                          | `pi.tool_execution.finished`                                         | runtime terminalizes the tool lifecycle as completed, failed, or cancelled                  |
| `turn_end` / `agent_end`         | none                          | `pi.turn.finished`                                                   | runtime terminalizes the turn as completed, failed, or cancelled                            |

Runtime-executor calls to `PiToolExecutorInput.emit(update)` emit `pi.tool_execution.updated` with
`update: PiToolExecutionUpdate` into the same turn stream. Pi-native `tool_execution_update` events
keep the `result: NativeToolResult` payload. Runtime accepts both payload forms and maps them to the
same command-event lane.

When pi does not emit native `tool_execution_*` events for custom callback tools, the adapter emits
the same `pi.tool_execution.started`, `pi.tool_execution.updated`, and
`pi.tool_execution.finished` sequence around the runtime-owned `PiToolExecutor`. Unknown source
events and unknown nested message events fail closed with `PiAdapterError` and are covered by
mapping tests before a new variant is allowed.
The adapter must detect whether pi emitted native `tool_execution_*` events for the accepted tool
call. It must not emit synthetic `pi.tool_execution.*` events for a tool-call ref that already has a
native pi lifecycle sequence, and it must not emit duplicate terminal lifecycle events for one
accepted tool call.

Runtime application of `PiRuntimeEvent` values is owned by `@svvy/runtime`, not by the adapter. The
target application table is:

| `PiRuntimeEvent`               | Runtime state-port writes                                                                                                                                                   | Runtime events/patches                                                                                                                                           | Late or invalid event behavior                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pi.user_message.committed`    | link the queue row/submitted message to the pi message ref when the current turn still owns the queued item                                                                 | `surface.stream` `user_message_committed` patch plus `{ model: "surface" }` invalidation when the durable link changes                                           | if the turn is terminal or the queue item no longer matches, record a typed adapter/runtime diagnostic and do not mutate transcript state            |
| `pi.assistant.text.delta`      | append bounded transcript delta state when the transcript projection persists streamed text; otherwise keep only scoped live patch state until assistant message settlement | ordered `surface.stream` assistant text patch                                                                                                                    | if stream sequence cannot be assigned losslessly, emit `stream_reset` and require surface rebaseline                                                 |
| `pi.assistant.thinking.delta`  | same as assistant text, but marked as reasoning/thinking projection                                                                                                         | ordered `surface.stream` thinking patch                                                                                                                          | same as assistant text                                                                                                                               |
| `pi.tool_call.started`         | allocate or update the pre-command tool span keyed by `ToolItemId`/pi tool-call ref; no command row is required yet                                                         | `surface.stream` tool-call start patch and, when durable projection changes, `{ model: "surface" }` invalidation                                                 | unknown tool-call ref for the active assistant message creates a typed turn failure unless the adapter marks it diagnostic-only                      |
| `pi.tool_call.arguments.delta` | append or replace the pre-command argument snapshot keyed by tool-call ref and later link it to the command row when the tool call is accepted                              | `surface.stream` tool argument patch; after command allocation, `command.changed` with `argument_snapshot` and `commandInspector` invalidation                   | deltas after accepted command terminalization are ignored with a diagnostic fact, not applied to a new command                                       |
| `pi.tool_call.accepted`        | create the accepted command row, link pre-command argument snapshots to the command id, record accepted arguments, and enter the runtime native-tool lane                   | `command.changed` `accepted`, `{ model: "commandInspector" }`, and `{ model: "surface" }` invalidations                                                          | unknown/unloaded tool or invalid arguments terminalize the command as failed and return a model-facing tool error through the pi callback path       |
| `pi.tool_execution.started`    | mark the command running when the runtime-owned executor starts                                                                                                             | `command.changed` `started` and `commandInspector` invalidation                                                                                                  | ignored if the command is already terminal, with diagnostic fact only                                                                                |
| `pi.tool_execution.updated`    | append command progress/output/diagnostic snapshots through command state ports                                                                                             | bounded `command.changed` notifications with `output`, `progress`, or `diagnostic` change kind; consumers refetch `commandInspector`                             | overflow/slow consumers rebaseline from command inspector; no second stdout/stderr event stream is exposed                                           |
| `pi.tool_execution.finished`   | terminalize the command and persist final command facts                                                                                                                     | `command.changed` `finished`, `{ model: "commandInspector" }`, and relevant artifact/request/approval/surface invalidations from returned state mutation results | duplicate terminal event is idempotent only when facts match; conflicting duplicate is a typed runtime diagnostic                                    |
| `pi.turn.finished`             | terminalize turn and queue row, release prompt lock, persist failure/cancel/completion facts, and schedule next queue drain                                                 | `turn.changed`, `queue.changed`, `{ model: "surface" }`, and session navigation invalidations                                                                    | late non-terminal pi/tool events after turn terminalization are ignored with typed diagnostics unless recovery proves terminalization was incomplete |

Pre-command tool argument snapshots are state/runtime-owned surface stream records keyed by
`ToolItemId` and the pi tool-call ref until the accepted command row exists. When
`pi.tool_call.accepted` allocates the command, runtime links those snapshots to the command id in the
same ordered command lane before the first command-running fact. The adapter never writes or
reparents those snapshots.

- `turns.interrupt({ surfacePiSessionId, turnId })` first validates that `turnId` is the active turn
  for `surfacePiSessionId`. Missing live session, no active turn, mismatched turn id, and
  already-terminal turn each map to distinct typed `PiAdapterError` reasons so runtime can decide
  whether cancellation was delivered, already unnecessary, or invalid. For a matching active turn it
  calls the checked-in pi session interruption API
  (`AgentSession.abort()` when using `AgentSession`) and waits for pi to become idle before the turn
  stream finalizes. "Idle" means the addressed pi session has no active turn, no in-flight
  custom-tool callback, and no open subscription for that `turnId`; it does not mean the surface
  scope or live session handle is closed. The adapter uses a bounded adapter-owned idle wait timeout
  so abort cannot hang finalization forever. If pi acknowledges abort and reaches idle before the
  timeout, the stream emits/maps cancellation normally. If the idle wait times out, the adapter
  emits/maps cancellation for runtime terminalization and records a typed adapter timeout diagnostic;
  late pi/tool/output events for that `turnId` are ignored after terminalization. Runtime may also
  interrupt the `turns.run(...)` fiber; the adapter finalizer must invoke the same pi abort/idle
  path. Interrupting a turn does not close the owning session handle unless the session or surface
  scope is also closing.
- System prompt binding and tool declaration slicing are inputs to session/turn setup, not ambient
  reads.
- Before every prompt-bearing turn, the adapter must prove the effective pi session base prompt and
  the agent context prompt both match the runtime-provided bound generated context. Directly setting
  only one pi `agent.state.systemPrompt` field is insufficient if pi can rebuild a session prompt
  from `AgentSession` base prompt, resource-loader, active-tool, append-prompt, skill, or
  instruction-file paths before sending. The live adapter either reacquires an operation-scoped
  pi session from the bound prompt/tool declarations for the turn, or uses a package-private handle
  that updates the pi session's effective base prompt and agent prompt state together before sending
  the real user message with prompt-template expansion disabled. Boundary tests include a fixture
  where pi would otherwise rebuild/append ambient prompt material and prove the emitted
  `PiRuntimeEvent` stream comes from the svvy-bound prompt only.
- Session acquisition disables ambient pi resources before pi loads or evaluates them unless runtime
  explicitly provides a documented `svvy` resource binding. It is insufficient to load ambient
  resources and remove them after discovery. If `DefaultResourceLoader` is used, the adapter supplies
  an app-owned empty settings/source environment or pi pre-load override that makes `cliEnabled*` and
  enabled-resource paths empty before load. The baseline loader shape is `noExtensions: true`,
  `noSkills: true`,
  `noPromptTemplates: true`, `noThemes: true`, `additionalExtensionPaths: []`,
  `additionalSkillPaths: []`, `additionalPromptTemplatePaths: []`, `additionalThemePaths: []`,
  `extensionFactories: []`, `agentsFilesOverride: () => ({ agentsFiles: [] })`,
  `systemPromptOverride: () => systemPromptBinding.text`, `appendSystemPromptOverride: () => []`,
  `extensionsOverride: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() })`,
  `skillsOverride: () => ({ skills: [], diagnostics: [] })`,
  `promptsOverride: () => ({ prompts: [], diagnostics: [] })`, and
  `themesOverride: () => ({ themes: [], diagnostics: [] })`. With the shipped
  `@mariozechner/pi-coding-agent@0.73.1` SDK, built-in tools are disabled by calling
  `createAgentSession({ noTools: "builtin", customTools, ... })`; the installed type declaration
  defines that mode as disabling default built-ins while keeping extension/custom tools enabled. The
  adapter then immediately activates exactly the runtime-provided custom tools with
  `session.setActiveToolsByName(customTools.map((tool) => tool.name))` and overwrites the final prompt
  state. Do not use `tools: []` for this runtime, because pi treats an explicit `tools` array as an
  allowlist and `tools: []` leaves custom tools inactive. If the adapter ever uses pi's lower-level
  `AgentSessionConfig` directly, the equivalent invariant is `baseToolsOverride: {}` plus an
  active-tool list containing exactly the runtime-provided custom tool names. Runtime-provided custom
  tools are passed through pi's custom-tool channel and are the only callable tools.
  `systemPromptOverride: () => systemPromptBinding.text` is only a loader input. When using
  `AgentSession`, the adapter must also bypass pi's `buildSystemPrompt(...)` wrapping or overwrite
  `session.agent.state.systemPrompt = systemPromptBinding.text` after tool activation/rebuild and
  immediately before the prompt-bearing call. Tests must assert the provider-visible prompt contains
  no pi date/cwd footer, tool prose, skills, context files, `.pi/SYSTEM.md`, or
  `.pi/APPEND_SYSTEM.md` unless runtime explicitly provided that content.
  Ambient-disable behavior is verified against the installed `0.73.1` pi declarations and runtime
  behavior before implementation. The checked-in `docs/references/pi-mono` checkout may support the
  conceptual audit, but exact API claims must come from a pi reference that matches the installed
  version. The adapter test fixture must prove extensions, skills, prompt templates, themes,
  commands, hooks, provider adapters, ambient built-in tools, `.pi/SYSTEM.md`, and
  `.pi/APPEND_SYSTEM.md` cannot be imported, evaluated, enter the effective prompt, or enter the
  callable tool list unless runtime passes an explicit `svvy` binding.
- Session setup uses app-owned `SettingsManager.inMemory(...)` or an equivalent explicit settings
  source with pi auto-retry, auto-compaction, steering/follow-up queues, shell command prefix, and
  pi execution-policy settings disabled unless a named runtime-owned contract enables one. Observed
  `queue_update`, `auto_retry_*`, `compaction_*`, and `extension_error` events are adapter
  diagnostics/errors only; they are not product lifecycle inputs and do not trigger runtime retry,
  queue, recovery, or prompt-policy behavior.
- Usable provider credentials are held only in operation-scoped or turn-scoped in-memory pi auth
  storage and are scrubbed when that scope closes. Tests prove usable credential material is not
  persisted to pi config/session files, not retained after scope finalization, and not reused for a
  later prompt-bearing turn without the per-turn provider-auth check above.
- Package-private session-construction helpers own pi-native construction details:
  `SettingsManager`, `SessionManager`, `ModelRegistry`, `ResourceLoader`, and any installed-version
  adapter bindings. Public `PiAdapter` methods call package-private construction code; runtime and
  app/bootstrap do not receive pi-native constructors or mutate pi settings directly except through
  the restricted `@svvy/pi-adapter/session` bootstrap subpath already named by this spec. The
  construction component is created by `PiAdapter.layer`/`makePiAdapter()` as package-private
  implementation state and is scoped to that layer instance. Any cache or resource with a different
  lifetime must be named by the owning spec before implementation.
- Helper jobs such as title generation are Effect operations through pi; they do not bypass pi with
  Effect AI modules.
- Helper jobs that produce product facts but must not mutate the user transcript, such as title
  generation, use a separate operation-scoped pi session or helper-job handle. Helper jobs receive
  their own explicit runtime-prepared `prompt`, model/reasoning selection, bounded helper timeout,
  and typed output schema.
- Tests must prove scope finalization closes created/opened pi sessions and releases tool-callback
  adapters.

| Resource                                 | Owner package/service                                               | Backing kind  | Lifetime kind                                                                                                               | Acquired by                                                                                        | Released by                                                                                 | Reused across calls                                                                                | Interruption behavior                                                                                                                         | Required receipts/tests                                                           |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Live pi session handle                   | `@svvy/pi-adapter` session service, scoped by runtime surface scope | host resource | `surfaceScope` backed by manifest-adopted scoped primitives; `FiberMap`/`FiberSet`/`ScopedRef` require promotion before use | `sessions.create(...)` or `sessions.open(...)` with caller-provided surface owner `Scope.Scope`    | surface pi-session child scope close or explicit `sessions.close(...)`                      | yes, for turns on the same live surface after prompt/tool rebinding succeeds for the specific turn | scope interruption aborts active turn streams, releases subscriptions, and closes live handle without deleting persisted `PiSessionReference` | scoped session acquisition/release test, persisted reference survives scope close |
| Pi turn stream subscription              | `@svvy/pi-adapter` turn service                                     | host resource | `activeTurn`                                                                                                                | `turns.run(...)` installs subscriptions on the scoped live handle                                  | stream finalizer on terminal turn, interrupt, or parent surface scope close                 | no, one stream per active turn                                                                     | interruption invokes pi abort/idle path and emits enough normalized terminal data for runtime cancellation                                    | ordered event mapping test, interrupt/late-event ignore test                      |
| Runtime custom-tool callback bridge      | `@svvy/pi-adapter` tool bridge wrapper                              | process-local | `activeTurn`                                                                                                                | turn setup wraps runtime-owned custom tool executor into pi callback objects                       | turn stream finalizer or surface scope close                                                | no                                                                                                 | interruption releases callback adapters and maps in-flight tool callback failure to normalized pi adapter error/tool event                    | callback release test, no pi-native tool leakage test                             |
| Operation-scoped helper pi session       | `@svvy/pi-adapter` helper job service                               | host resource | `operationScoped`                                                                                                           | title/helper operation with explicit runtime-prepared prompt, model/reasoning, timeout, and schema | helper operation finalizer                                                                  | no                                                                                                 | interruption aborts helper job and closes helper session; user transcript is not mutated                                                      | title helper isolation test, timeout/interruption cleanup test                    |
| Protocol/helper child process, when used | `@svvy/pi-adapter` package-private transport                        | host resource | `surfaceScope` or `operationScoped` matching the owning pi handle                                                           | adapter transport acquisition inside the owning pi session/helper scope                            | owning scope close interrupts process, reader/writer/heartbeat fibers, and pending requests | yes only within the owning handle scope                                                            | process exit or reader failure fails pending deferreds with typed errors and releases fibers                                                  | stdio/protocol fixture test, pending request cleanup test                         |

Manual child scopes for pi sessions, turns, helper jobs, protocol transports, and callback bridges
use `Scope.fork(parent, "sequential")` by default. A row may use parallel finalization only when
the package spec names independent resources and tests prove no release-order dependency, no lost
terminal event, and no leaked pi-native callback or transport handle.

If the adapter reaches pi through a child process, stdio bridge, JSON-RPC transport, or
line-delimited protocol, that transport is hidden behind the `PiAdapter` service and follows the
cross-cutting stdio protocol pattern:

- acquire the child process or protocol handle inside the pi session scope
- start reader, writer, heartbeat, and stderr-drain fibers with the exact scoped-fork primitive
  adopted in `packages/effect-adoption-manifest.ts`; until `Effect.forkScoped` is promoted, use the
  adopted scoped ownership pattern named in `effect-v4.spec.md`
- keep pending protocol requests in a scoped `Ref` map from request id to one-shot `Deferred`;
  `SynchronizedRef` requires exact manifest promotion before production use
- use hoisted/generated `@svvy/core` schemas plus Effect streams/channels for protocol frames; do
  not use `effect/unstable/rpc` or Effect RPC groups unless the cross-cutting Effect spec and this
  package spec are explicitly updated for that exact transport
- remove pending entries on success, typed failure, timeout, interruption, or session close
- fail all pending requests when the process exits, the reader loop terminates, stderr indicates a
  fatal protocol error, or message decoding fails
- decode inbound protocol messages and encode outbound messages with generated or hoisted schemas
- reject unknown protocol methods or payloads that lack a schema instead of passing `unknown`
  through to runtime
- drain child stderr even when pi protocol data uses only stdout/stdin, with a regression test for a
  large stderr-producing child that still responds successfully

The public adapter surface remains pi-free whether pi is linked in-process or through stdio:
runtime receives `PiSessionRef`, `PiRuntimeEvent`, `ModelInfo`, helper-job results, and typed
adapter errors, never raw transport handles, protocol frames, pi-native session objects, or child
process handles.

Turn input is the single core-owned `RunPiTurnInput` shape. It always includes the runtime `turnId`,
durable `surfacePiSessionId`, submitted runtime message, runtime-provided
`userMessageSubmittedAt`, concrete generated-context binding, selected model/reasoning, schema-only
native tool declarations, and runtime-owned tool executor. The adapter must not stamp prompt
delivery time itself; runtime owns the user-message timestamp because it also owns queue delivery,
turn creation, and durable transcript projection.

`turns.run(...)` submits this as one real pi prompt with pi prompt-template expansion disabled by
passing `expandPromptTemplates: false` on the installed pi prompt call.
Installed-declaration tests pin this option against the installed pi version. If the installed pi
prompt API lacks `expandPromptTemplates: false` or changes the option name, adapter startup/test
validation fails closed before product prompt dispatch; the adapter must not silently rely on pi's
default prompt-template behavior.
The adapter must call the runtime-owned tool executor exactly once for each accepted pi tool call.
The executor returns a pi-compatible `NativeToolResult` after `@svvy/runtime` has allocated or reused
command records, invoked `@svvy/extensions`, processed returned `ExtensionRuntimeOperation` items,
applied any wrapped `RuntimeEffectRequest` values, and recorded command facts. `@svvy/pi-adapter`
never inspects extension implementation records, applies `RuntimeEffectRequest` values, or records
command facts.
Runtime-owned tool execution failures use
`RuntimeToolExecutionError`; adapter failures use `PiAdapterError`. The adapter maps either
successful runtime tool output or typed runtime tool failure into the pi callback protocol without
reclassifying the failure as a pi session error.

Concrete turn call:

```ts
const turnStreamEffect = pi.turns.run({
  turnId: "turn_7" as TurnId,
  surfacePiSessionId: "pi_handler_7" as SurfacePiSessionId,
  session: { surfacePiSessionId: "pi_handler_7" as SurfacePiSessionId },
  userMessage: { text: "Run the focused test and report the result." },
  userMessageSubmittedAt: "2026-06-23T12:30:00.000Z",
  systemPromptBinding: {
    fingerprint: "gctx_abc123",
    revision: "rev_42",
    text: "You are the handler thread. Own the delegated objective and report through thread_report.",
  },
  model: {
    providerId: "openai" as ProviderId,
    modelId: "<model-id-from-pi-metadata>" as ModelId,
  },
  reasoning: { effort: "medium" },
  enabledAmbientPiResources: [],
  tools: [execCommandTool, threadReportTool],
  toolExecutor: runtimeToolExecutor,
});
const turnStream = runInCallerEffectContext(turnStreamEffect);
const events = turnStream.stream;
```

## Event Mapping

Pi-native event details are normalized before leaving `@svvy/pi-adapter`.

Rules:

- pi event decoding errors fail the stream with `PiAdapterError`.
- assistant text/thinking deltas and tool-call events preserve pi `contentIndex`; no package may
  rename it to `index` or infer it later from array order.
- tool-call argument deltas keep monotonic pi order and enough identity for runtime command tracking.
- pi provider/model metadata is normalized into `@svvy/core` provider/model contracts.
- pi transcript/history remains pi-owned; events carry references and deltas needed by runtime, not
  raw pi session internals.

Required event mappings include:

- pi user message commit -> `pi.user_message.committed`
- assistant text delta -> `pi.assistant.text.delta`
- assistant thinking delta -> `pi.assistant.thinking.delta`
- tool-call start -> `pi.tool_call.started`
- tool-call argument delta -> `pi.tool_call.arguments.delta`
- tool-call accepted/completed by pi -> `pi.tool_call.accepted`
- tool execution start -> `pi.tool_execution.started`
- tool execution update -> `pi.tool_execution.updated`
- tool execution finish -> `pi.tool_execution.finished`
- turn finish -> `pi.turn.finished`

Example normalized tool-argument event:

```json
{
  "type": "pi.tool_call.arguments.delta",
  "turnId": "turn_7",
  "surfacePiSessionId": "pi_handler_7",
  "piMessageRef": "pi_msg_9",
  "toolCallId": "tool_21",
  "toolName": "exec_command",
  "delta": "{\"cmd\":\"bun run check\"",
  "contentIndex": 0
}
```

The normalized event identity is `toolCallId` plus pi `contentIndex`; there is no separate
`toolItemId` field in `PiRuntimeEvent`.

## History And Model Normalization

Reserved core history DTOs describe pi transcript reference operations only as schema-backed data:

```ts
type RestorePiHistoryEntryInput = {
  session: PiSessionRef;
  entryId: PiHistoryEntryRef;
};

type ForkPiHistoryEntryInput = {
  session: PiSessionRef;
  entryId: PiHistoryEntryRef;
  targetSurfacePiSessionId: SurfacePiSessionId;
};
```

Runtime owns product decisions such as edit-and-resend, durable surface creation, and fork target
ownership. Core-owned `RestorePiHistoryEntryInput` and `ForkPiHistoryEntryInput` are reserved data
contracts only: they have no public `PiAdapter` service method, no package-root execution surface,
and no restricted-session subpath implementation. Runtime expresses forked handler history through product-filtered prompt
context and edit-and-resend through runtime-owned surface state; no package may call a partial
history implementation or mutate pi history through the restricted session subpath.

Promoting those DTOs into callable pi history methods requires the same change to add exact
`PiAdapter` service methods, core method contracts, package-boundary export expectations, runtime
callers, and focused tests. The promoted methods must serialize operations against the live
live-session registry entry, reject active-turn mutation with typed `PiAdapterError`, mutate only
pi-owned history/reference state, and persist opaque reference changes only through
`PiSessionReferencePort`. Runtime still owns queue rows, turn records, transcript projections, and
product-visible surface changes.

Model normalization maps pi model/provider metadata into the core-owned `ModelInfo` contract.

Pi-native provider/model types never leave the adapter.

Concrete model metadata call:

```ts
const readModels = Effect.gen(function* () {
  const input = {
    workspaceId: "workspace_main" as WorkspaceId,
    providerId: "openai" as ProviderId,
  };
  return yield* pi.models.list(input);
});
```

Example result:

```ts
[
  {
    providerId: "openai" as ProviderId,
    modelId: "<model-id-from-pi-metadata>" as ModelId,
    displayName: "Provider model display name",
    supportsReasoning: true,
    supportedReasoning: ["off", "minimal", "low", "medium", "high"],
    inputModalities: ["text", "image"],
    contextWindow: 400000,
    maxOutputTokens: 128000,
    authStatus: {
      providerId: "openai" as ProviderId,
      workspaceId: "workspace_main" as WorkspaceId,
      health: "usable",
      redactedAccountLabel: "OpenAI key",
    },
  },
];
```

`models.list(...)` reads provider/model capabilities from pi metadata through a package-private
`PiModelRegistryProvider` and joins redacted provider status from
`ProviderAuthStatusStatePort.listProviderStatuses({ workspaceId })`. Capability listing uses
`ProviderAuthStatusStatePort` only for redacted health/status rows and must not read live credential
material through `ProviderAuthPort` merely to display model availability. It returns only core
`ModelInfo` rows. It does not return pi model objects, base URLs, provider headers, raw credential
material, price/cost metadata, registry override internals, or display-only summaries that can be
derived by the caller. When `providerId` is omitted, it returns all known pi providers. When
`ProviderAuthStatusStatePort` returns no row for a listed provider, the adapter returns
`authStatus.health: "missing"` for that provider.
When both app-global and workspace-scoped provider status rows exist for the same provider, the
workspace-scoped row wins for that `workspaceId`; the adapter does not merge health, labels, issue
codes, or timestamps across scopes.

Model operations that perform a live provider request, such as provider-backed metadata probes not
served by the local pi registry, use `ProviderAuthPort` for a usable credential snapshot and fail
with the exact provider-auth `PiAdapterError` reason on missing, expired, or refresh-failed health.
The adapter does not use `ProviderAuthStatusStatePort` as authorization for live provider calls.

## Pi-Native Type Encapsulation

These pi-native types stay internal to `@svvy/pi-adapter`: `AgentSession`,
`AgentSessionRuntime`, `SessionManager`, `AuthStorage`, `SettingsManager`, `ModelRegistry`,
`ResourceLoader`, `DefaultResourceLoader`, pi `ToolDefinition`, `AgentTool`,
`AgentToolResult`, `AgentToolUpdateCallback`, `ExtensionContext`, pi message and history entry
objects, pi assistant/session/agent event objects, `ToolCall`, `Model<Api>`, `KnownProvider`,
`Provider`, `Api`, pi usage objects, pi reasoning/thinking enums, TypeBox `TSchema`, and pi
resource diagnostics. Public adapter boundaries use `@svvy/core` ids, schemas, tagged errors,
`NativeToolDeclaration`, `NativeToolResult`, `PiSessionRef`, `PiRuntimeEvent`, `ModelInfo`, and svvy
reasoning/model contracts.

The public `@svvy/pi-adapter` entrypoint exports only the `PiAdapter` service and the named layer.
Pi-free input/output contracts and typed boundary errors are imported from `@svvy/core`;
the adapter does not redefine or re-export duplicate contract names. Root `makePiAdapter` is not a
public service constructor. Pi-native imports are allowed only inside `@svvy/pi-adapter`
implementation files and the restricted public `@svvy/pi-adapter/session` bootstrap subpath. Public
root declarations and the `@svvy/pi-adapter/messages` subpath remain pi-free. App bootstrap,
runtime, desktop, generated declarations, generated packages, and shared app contracts compose the
adapter only through the public `PiAdapter` service/layer and core-owned port contracts, except for
the restricted app-bootstrap/session-catalog use of `@svvy/pi-adapter/session`. Boundary tests fail
if public declarations mention pi-native session, event, model, tool, resource-loader, transport,
protocol, or child-process handle types outside that restricted subpath.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on Effect v4.
- Receives live provider credential snapshots, redacted provider status state, persisted
  session-reference access, and packaged runtime path resolution through `ProviderAuthPort`,
  `ProviderAuthStatusStatePort`, `PiSessionReferencePort`, and `PiRuntimePathsPort` services.
  `@svvy/core` defines the `Context.Service` tags, data contracts, and structural port shapes for
  those dependencies. `@svvy/state` owns status/session implementations; app/bootstrap owns host
  credential, secret-store, and packaged runtime path implementations/layers.
- `PiRuntimePathsPort` resolves bundled or user-configured pi runtime assets for the packaged app.
  It never assumes repo-root `docs/references/pi-mono`, workspace checkout paths, local development
  symlinks, or source-relative package paths at shipped runtime. Development/test layers may point
  at local references only when named as test fixtures.
- Model metadata reads use pi's static provider/model registry and join redacted provider auth
  health from `ProviderAuthStatusStatePort`; they do not read live credential material. Trusted pi
  invocations, provider refreshes, and operations that must configure an authenticated provider use
  `ProviderAuthPort` snapshots and fail typed if the snapshot is missing, expired, or refresh
  failed. Cached product read models are owned by `@svvy/state`, not by `@svvy/pi-adapter`.
- Depends on pi packages.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/desktop`, Smithers, Svelte,
  Electrobun, or UI packages.

## Product Source Ownership

Product source areas owned by this package:

- `packages/pi-adapter/src/**`
- adapter services for pi session creation/open/close and schema validation of reserved core history DTOs in package tests
- provider/model metadata adapters
- prompt execution context adapters
- title/namer model execution seams
- pi `DefaultResourceLoader` configuration that disables ambient host resources

App-entry pi edge-adapter modules are app/bootstrap code, not public ownership surfaces for
`@svvy/pi-adapter` APIs. They may provide packaged pi runtime paths, provider/auth edge adapters,
and layer wiring only; they do not define session catalogs, prompt dispatch, pi session lifecycle
policy, or adapter contracts.

## Acceptance Criteria

- `@svvy/pi-adapter` is the only package that imports pi-native APIs or constructs pi-native session,
  turn, prompt, tool, and message values.
- The adapter exposes scoped session/turn effects to runtime and never leaks pi-native objects through
  `@svvy/core`, `@svvy/runtime`, `@svvy/extensions`, or desktop APIs.
- Runtime passes a bound generated system prompt, actor-scoped pi-free tool inventory, the real new
  user message, selected model/reasoning, and the addressed `PiSessionRef` into the adapter. The
  adapter does not compose prompts, read instruction sources, or silently depend on pi ambient
  defaults.
- Ambient pi tools/instructions are disabled unless runtime explicitly enables a documented pi-owned
  capability.
- The adapter does not own queue persistence, tool lifecycle policy, extension registration, sandbox
  launch policy, or product state.

## Tests

`@svvy/pi-adapter` does not export package-root test fixtures, `layerTestFakePi`, or
`PiAdapterTestHarness`. Test-only composition stays inside `packages/pi-adapter/src/*.effect.test.ts`
files or package-local test-support modules that are not reachable through the `@svvy/pi-adapter`
package export map.

Pi-adapter service/layer tests use local fake pi services and local harness state for session
open/create/close, system-prompt delivery, pi-native resource disabling, turn stream events,
reserved history DTO validation, model metadata reads, helper jobs, and scope finalizers. Those
harnesses are test-local implementation details; they do not create manual `ManagedRuntime`
instances and do not expose pi-native objects through public package contracts.

- Fake `@svvy/pi-adapter` tests.
- `@effect/vitest` service/layer tests.
- Scoped session acquisition/release tests.
- Turn stream interruption tests.
- `turns.interrupt(...)` tests proving adapter calls pi abort/idle, terminalizes cancellation, and
  ignores late tool/output events.
- System prompt channel tests.
- Provider/model metadata normalization tests.
- Ambient pi resources disabled-by-default tests.
- Ambient-disable tests proving extension, skill, prompt-template, theme, command, hook, and provider
  adapter module top-level code is not imported/evaluated when runtime did not explicitly bind it.
- Pi settings isolation tests proving auto-retry, auto-compaction, steering/follow-up queue, shell
  prefix, and pi execution-policy settings are disabled by app-owned settings.
- Tool declaration slicing tests.
- Effect tool-callback bridge tests.
- Pi event ordering and decode-failure tests.
- Pi event mapping tests for `agent_start`, `tool_execution_start`, `tool_execution_update`, and
  `tool_execution_end`, including synthesized tool-execution events for custom callback paths.
- Helper job isolation tests proving title/helper jobs do not append to the target surface
  transcript, alter active tools, observe active-turn messages, or survive helper scope
  cancellation.
- Tests proving `@svvy/pi-adapter` can run without desktop UI.
- Boundary tests proving exported public declarations do not mention pi-native session, event, model,
  tool, resource-loader, transport, protocol, or child-process handle types.
