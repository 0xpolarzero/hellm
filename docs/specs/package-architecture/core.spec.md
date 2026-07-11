# `@svvy/core` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/core`

## Purpose

`@svvy/core` is the shared stable `svvy` domain language.

It defines ids, schema-backed public domain shapes, discriminated event unions, read-model types,
command fact envelopes, sandbox policy data contracts, version markers, boundary issue formatting,
annotation allowlist predicates, and explicitly indexed schema/codec validators used across public
`@svvy/*` packages. It contains no runtime orchestration, persistence, pi integration, extension
implementation, filesystem IO, database IO, keychain IO, UI rendering, telemetry summarization,
display formatting, metadata normalization, or convenience helper bundles.

`@svvy/core` may use Effect v4 `Schema`, branded schemas, tagged error classes, `Effect.Effect`
return types, and data-only `Context.Service<PortIdentifier, PortService>(...)` function-style tags
when the service tag is itself the stable cross-package port contract. It must not define service
implementations, class-style service tags, layers, managed runtimes, fibers, queues, scoped
resources, database handles, subprocess handles, UI bridge implementations, or package-specific
convenience bundles.

`@svvy/core` owns shared port input/output schemas, structural request/result contracts, and the
live `Context.Service` tags for cross-package ports consumed by packages that must not import the
implementation package. This includes the named core-owned state and host/live ports for workspace
lifecycle, surface lifecycle, prompt defaults, queues, turns, commands, approvals, actor extension
bindings, episodes, threads, requests, session waits, extension context impact, extension dependency
readiness, generated-package facts, artifacts, app-log writes, recovery, composer drafts, source
versions/source saves, and read models, plus `StateCommandPostCommitNotificationPort`,
`RuntimeExtensionStatePort`, `ExtensionStatePort`, `SandboxPolicySource`, `ProviderAuthPort`,
`ProviderAuthStatusStatePort`, `PiSessionReferencePort`, `PiRuntimePathsPort`, `SecretStorePort`,
and `SecretStoreMutationPort`.
Runtime-internal services such as command-session registries, wait registries, event buses, recovery
coordinators, and source-invalidation coordinators are owned by `@svvy/runtime` and stay hidden
behind `Runtime.layer` unless the PRD, feature inventory, and owning package spec promote a narrow
cross-package port for a concrete product reason.
`@svvy/state`, app bootstrap, or the owning adapter package provide implementations and layers for
those tags. Core-owned tags contain only method contracts and schema-backed records; they do not
close over stores, host paths, pi objects, process handles, mutable global state, or resource
lifetime policy.

Every public cross-package data payload exported by `@svvy/core` has a hoisted Effect Schema
contract, an encoded TypeScript type when the wire/persistence shape differs from the decoded
shape, a decoded TypeScript type, and Effect/Exit boundary decoders where unknown input crosses a
package, facade, generated-package, bridge, tool, or persistence boundary. Plain TypeScript
interfaces are allowed for Effect service shapes, core-owned port service method shapes, and other
in-process structural service contracts that are not themselves serialized, persisted, bridged, or
accepted from unknown input. Plain interfaces are not allowed as the sole contract for public DTOs
that cross a package, facade, generated-package, bridge, tool, or persistence boundary. This rule
applies to every runtime-facing state port input/output record, provider-auth port input,
secret-store port input, pi-session-reference port input, extension-state port input, native-tool
declaration document, sandbox policy value, runtime facade payload, and state facade payload.

`@svvy/core` maintains a public symbol contract index. The generated root-export coverage artifact
lives at `docs/specs/package-architecture/core-public-symbol-index.generated.md`; it records export
metadata for the spec-defined public root contract: symbol name, source module, owner domain, public
status, contract kind, schema symbol when one exists, encoded type, decoded type, boundary helpers,
parse options, and required tests. Semantic requirements for exported schemas, branded ids, tagged
errors, service tags, port input/output types, runtime events, runtime-effect requests,
execution-plan items, read-model payloads, command facts, app-log payloads, and generated-package
contracts are normative in this spec and the owning contract sections. `bun run check:core-index`
verifies checked-in index freshness against the root export surface; package-boundary tests cover
representative module placement and boundary behavior.
For public modules that intentionally concentrate a named contract family, the generator's
`canonicalPublicFacadeModules` set records the canonical public contract module for that family even
when some schemas are declared in a broader source module. The checked-in generated artifact is the
authority for each symbol's canonical `Source module`; this prose is explanatory and must not be
treated as a second hand-maintained ledger. Canonical facade modules may claim only symbols whose
primary contract family is owned by that facade. Generic cross-runtime errors and boundary helpers
declared in `errors` stay attributed to `errors` even when a facade module re-exports them for caller
convenience. Concentrated runtime-facing modules keep `RuntimeEffectRequest`, source-invalidation,
runtime submission, and workflow task-agent bridge imports readable without creating duplicate
public symbols or alternate schemas. `extension-contracts` is the canonical public contract module
for extension execution plans, extension runtime operations, extension usage/category/interface
vocabulary, and extension handler result contracts. `runtime-submit` is also allowed to own
submit-local helper contracts in that same module.

`@svvy/core` may own facade payload schemas and TypeScript contract shapes when multiple packages or
bridges need the same encoded API vocabulary. It does not own facade factories, facade instances,
manual runners, bridge subscriptions, `ManagedRuntime` values, `AsyncIterable` adapters, or
Promise/callback execution. A type named `*Facade*` in core is therefore a schema-backed payload or
interface contract only; any executable facade factory belongs to the package that owns the
service, such as `@svvy/runtime.createRuntimeFacade(...)` or
`@svvy/state.createStateFacade(...)`.

The package name is `@svvy/core` because this package is the bottom shared product vocabulary, not a
pi-specific contract bundle.

## Core-Owned Port Tags

Core-owned port tags are stable dependency identities, not implementations. Each tag module exports
the schema-backed input/output records for that port, the explicit port identifier interface, the
structural `*Service` implementation shape, and the Effect v4
`Context.Service<PortIdentifier, PortService>("@svvy/core/...")` function-style tag. The port identifier is the
Effect environment requirement type; the `*Service` type is the object shape a provider implements.
This keeps same-shaped ports type-distinct without reintroducing class-service self types. It does
not export a layer, a `make*` function, a `ManagedRuntime`, scoped resource acquisition, host-path
logic, mutable refs, or hidden process state.

Core-owned cross-package ports always use this function-style data-only tag shape. Package-owned
implementation services, such as `@svvy/state` read facades or `@svvy/runtime` worker services, may
use class-style `Context.Service<Self, Shape>()(id)` only when the tag is owned by that package and
is not re-exported from `@svvy/core`. A package must not turn a core-owned port into a class service
to attach implementation helpers, defaults, static layers, mutable refs, host paths, or resource
acquisition.

Implementation packages provide these tags at composition time. For example, `@svvy/state` owns the
DB/product-state-backed implementation of `ExtensionStatePort`, `RuntimeQueueStatePort`,
`PiSessionReferencePort`, and the other core-owned state ports; app/bootstrap provides host/live
ports such as `SecretStorePort`, `ProviderAuthPort`, and `PiRuntimePathsPort` when the app host
owns the live resource. A core-owned port
method may return `Effect.Effect<..., ..., ...>` but its requirements are other stable public port
tags, never concrete stores, pi objects, filesystem roots, subprocess handles, or desktop bridge
objects.

`@svvy/core` is authoritative for the exact core-owned port tag, service shape, schemas, and method
inventory. The generated public symbol index is authoritative for export metadata and coverage, not
for method inventory by itself. Implementation-owner specs may describe storage, indexing,
transactions, layers, and failure mapping, but they must not add methods, fields, broader authority,
or alternate result shapes beyond the core tag. If a package implementation needs more authority, the core contract
must be updated first with the concrete product reason and boundary tests. `ExtensionStatePort` is
the canonical extension-facing example: it is a restricted
read/readiness/product-fact port consumed by
`@svvy/extensions`; profile default mutations, profile override writes, generated-package writes,
workspace-link writes, runtime recovery writes, and invalidation publication are not part of that
port and remain state-command or runtime-facing state-port operations.

`StateCommandPostCommitNotificationPort` is the narrow core-owned bridge from state-owned
UI-intent command facades to runtime-owned notification publication inside the single composed app
`ManagedRuntime`. It is consumed only by `@svvy/state` facade implementations and implemented only
by `@svvy/runtime`; app/bootstrap wires the layers and does not implement the port. The port
accepts only descriptors that `@svvy/state` has already committed. It does not expose a generic
runtime event publisher, source-invalidation callback, queue wake callback, renderer bridge handle,
or state mutation surface.

```ts
type StateCommandPostCommitNotificationInput = {
  operation: string;
  receipt: StateCommandReceipt;
  descriptors: readonly StateInvalidationDescriptor[];
  clientSubmission?: RuntimeClientSubmissionInput;
};

type StateCommandPostCommitNotificationResult = {
  receipt: StateCommandReceipt;
  acceptedDescriptorCount: NonNegativeSafeInteger;
  rebaselineRequired: boolean;
};

type StateCommandPostCommitNotificationError = {
  type: "state-command-post-commit-notification-error";
  operation: string;
  reason: "publication-failed" | "runtime-shutdown" | "runtime-disposed";
  receipt: StateCommandReceipt;
  message: string;
  affectedReadModels?: readonly StateInvalidationDescriptor[];
};

const StateCommandPostCommitNotificationErrorSchema = Schema.Struct({
  type: Schema.Literal("state-command-post-commit-notification-error"),
  operation: Schema.String,
  reason: Schema.Literals(["publication-failed", "runtime-shutdown", "runtime-disposed"]),
  receipt: StateCommandReceiptSchema,
  message: Schema.String,
  affectedReadModels: Schema.optionalKey(Schema.Array(StateInvalidationDescriptorSchema)),
});

interface StateCommandPostCommitNotificationPortService {
  notifyCommittedStateCommand(
    input: StateCommandPostCommitNotificationInput,
  ): Effect.Effect<
    StateCommandPostCommitNotificationResult,
    StateCommandPostCommitNotificationError
  >;
}
```

`StateCommandPostCommitNotificationError` is a schema-backed public bridge error that includes the
committed `StateCommandReceipt`, normalized operation, typed reason, redacted message, and affected
read models when known. It exports the same strict codec quartet as other public bridge errors:
`decodeUnknownStateCommandPostCommitNotificationErrorEffect`,
`decodeUnknownStateCommandPostCommitNotificationErrorExit`,
`encodeStateCommandPostCommitNotificationErrorEffect`, and
`encodeStateCommandPostCommitNotificationErrorExit`. A failed notification never rolls back the
already committed state command; facade callers receive the committed receipt plus the error and
must rebaseline through state read models before retrying UI projection.

## Owns

- Branded ids or nominal id helpers for public package boundaries. The exported public branded
  identity values are
  `WorkspaceId`, `WorkspaceSessionId`, `SurfacePiSessionId`, `ThreadId`, `ThreadGroupId`,
  `WorkflowRunId`, `WorkflowTaskAttemptId`, `QueueItemId`, `TurnId`, `CommandId`,
  `CommandEventId`, `ToolCallId`, `ToolItemId`, `ArtifactId`, `EpisodeId`,
  `RequestInputRequestId`, `RequestInputQuestionId`, `RequestInputOptionId`,
  `RequestInputAnswerId`, `RuntimeApprovalId`, `RecoveryWorkId`, `RuntimeOwnerId`,
  `WorktreeId`, `AgentProfileId`, `ExtensionId`, `GeneratedPackageBuildId`,
  `GeneratedContextFingerprint`, `GeneratedContextRevision`, `MessageId`, `SnippetId`,
  `ProviderId`, `ModelId`, `ExternalInstructionSourceId`, `TitleJobId`,
  `AppLogEntryId`, `WorkspaceTabId`, `WorkspacePaneId`, `AbsolutePath`,
  `RuntimeEventGenerationId`, `RuntimeAttachmentId`, `AttachmentDisplayName`,
  `WorkspaceRelativePath`, `MimeType`, `Base64String`, `RuntimeClientSubmissionId`,
  `RuntimeClientRequestId`, `RuntimeClientCorrelationId`, `RuntimeClientSubmissionSource`,
  `RuntimeEventSequence`, `SurfaceStreamSequence`, `SurfaceStreamGenerationId`,
  `ExtensionExecutionPlanId`, `FiniteDurationMs`, and `PositiveDurationMs`. Their schemas and
  supporting public identity-domain primitives such as safe-integer schemas, byte-count schemas,
  timestamp schemas, and JSON-safe value contracts are tracked by the generated public symbol index
  under their owning source modules. Actor, layout-slot, and pane ids are public contracts only when
  a package boundary carries them; state-owned desktop command facades use `WorkspaceTabId`,
  `WorkspacePaneId`, and string-literal layout slots `"A" | "B" | "C"`. Adding or removing one of
  these identity contracts requires updating the public symbol contract index, affected schemas,
  package-boundary tests, and every owning package spec that carries the id.
- Shared timestamp contracts: `UtcDateTime`, encoded `IsoDateTimeString`, and UTC ISO boundary
  formatting conventions. `@svvy/core` exports no current-time helpers. Owner packages acquire
  current time through Effect `DateTime.now` or `Clock` and encode boundary values with
  `DateTime.formatIso(...)`.
- Shared JSON-safe value contracts: `JsonPrimitive`, `JsonValue`, `JsonArray`, and `JsonObject` for
  persisted product JSON blobs, command facts, and bridge payloads that intentionally store
  structured JSON instead of a narrower domain schema. Generated-package manifest bodies are
  file-backed build evidence indexed by state facts, not generic persisted product JSON blobs.
  Narrower schemas are still preferred whenever the shape is known.
- Actor kinds: `orchestrator`, `handler`, and `workflow-task`.
- Model and reasoning selection contracts, including `ModelSelectionSchema`,
  `ReasoningEffortSchema`, and `ReasoningSelectionSchema`. These are selection values, not
  identities.
- Surface target contracts, including explicit distinction between top-level workspace session id,
  pi surface id, handler thread id, and UI panel id.
- User-submitted message contracts for runtime prompt submission.
- Runtime event discriminated unions.
- Runtime command lifecycle and terminal command fact envelopes.
- Native tool declaration, invocation, and result contracts. Core does not own
  concrete builtin tool names, descriptions, JSON parameters, actor availability, projection
  metadata, or handlers.
- Tool-call intent, streamed argument snapshot, accepted command, child command, progress, output,
  diagnostic, patch snapshot, approval, wait, and final-fact payload contracts.
- Extension record, usage, env declaration, dependency, readiness, generated context, generated
  `execute_typescript` facade metadata, and redaction metadata contracts.
  Core is the source contract for shared extension vocabulary such as `ExtensionCategory`,
  `ExtensionInterfaceKind`, `ExtensionUsageState`, and `ExtensionUsageStateSchema`; `@svvy/extensions`
  may re-export those types but does not redefine them.
- Generated-package read-model and bridge contracts for `@svvyx/workflows` and
  `@svvyx/extensions`. Core owns contracts only; `@svvy/extensions` owns generated files,
  `@svvy/runtime` coordinates refresh/link repair, and `@svvy/state` stores committed
  generated-package facts.
- Workflow task-agent bridge request/result contracts used by generated `@svvyx/workflows` code and
  consumed by `@svvy/runtime`.
- Artifact metadata contracts.
- App log and normalized error contracts.
- Workspace, session, surface, command inspector, request-input, runtime approval, generated
  package, and worktree read-model types.
- Read-model invalidation contracts and source-reconcile inputs/results:
  `StateInvalidationDescriptor` is a post-commit read-model invalidation descriptor returned by
  committed state writes, including writes from ports consumed by runtime or extensions. Runtime maps
  those descriptors to typed read-model change notifications, and consumers refetch state read models
  after receiving those notifications.
  `SourceInvalidationHint`, `SourceReconcileRequest`, and `SourceReconcileResult` are runtime
  source-coordinator contracts. No public runtime facade accepts caller-authored
  `StateInvalidationDescriptor` values.
- Settings and provider/auth status payload contracts.
- Cross-package Effect service tags and immutable data contracts for core-owned state ports,
  extension state, sandbox policy source, provider auth, pi session references, pi runtime paths,
  artifact metadata state-port contracts, artifact runtime-effect/execution-plan DTO contracts,
  app-log writes, and secret-store port contracts. Core owns no secret material storage or host
  secret-store implementation.
- Sandbox policy source and immutable sandbox policy snapshot contracts.

Workflow task-agent bridge contract:

The workflow task-agent bridge contract is schema-authoritative. `@svvy/core` owns the source-shape
schemas accepted from generated `@svvyx/workflows`, the branded runtime-validated schemas consumed
by `@svvy/runtime`, result/error schemas, and all strict boundary decoders. Hand-written TypeScript
examples in generated-package specs are generated-client projections only; they are not an alternate
contract source. Encoded/source bridge DTOs use plain string ids where generated packages cannot
import branded runtime ids. Runtime validates `RunTaskAgentSourceInputSchema` into the branded
`RunTaskAgentInputSchema` / `AuthenticatedRunTaskAgentInputSchema` before authorization, state
writes, idempotency, or pi-adapter delivery handoff.

`@svvy/core` exports `TaskAgentParametersSourceSchema`, `TaskAgentParametersSource`,
`ValidatedTaskAgentParametersSchema`, `ValidatedTaskAgentParameters`,
`SmithersObservedJsonSchema`, `SmithersObservedJson`, `SmithersTaskAttemptIdentitySchema`,
`SmithersTaskAttemptIdentity`, `SmithersTaskSourceContextSnapshotSchema`,
`SmithersTaskSourceContextSnapshot`, `SmithersTaskContextSnapshotSchema`,
`SmithersTaskContextSnapshot`, `RunTaskAgentOperationSchema`, `RunTaskAgentOperation`,
`RunTaskAgentMessageSchema`, `RunTaskAgentMessage`, `RunTaskAgentPromptSourceSchema`,
`RunTaskAgentPromptSource`, `RunTaskAgentSourceInputSchema`, `RunTaskAgentSourceInput`,
`RunTaskAgentInputSchema`, `RunTaskAgentInput`, `AuthenticatedRunTaskAgentInputSchema`,
`AuthenticatedRunTaskAgentInput`, `RunTaskAgentResultSchema`, `RunTaskAgentResult`,
`RunTaskAgentErrorCodeSchema`, `RunTaskAgentErrorCode`, `RunTaskAgentErrorSchema`,
`RunTaskAgentError`,
`decodeUnknownRunTaskAgentSourceInputEffect`, `decodeUnknownRunTaskAgentSourceInputExit`,
`encodeRunTaskAgentSourceInputEffect`, `encodeRunTaskAgentSourceInputExit`,
`decodeUnknownRunTaskAgentInputEffect`, `decodeUnknownRunTaskAgentInputExit`,
`encodeRunTaskAgentInputEffect`, `encodeRunTaskAgentInputExit`,
`decodeUnknownAuthenticatedRunTaskAgentInputEffect`,
`decodeUnknownAuthenticatedRunTaskAgentInputExit`, `encodeAuthenticatedRunTaskAgentInputEffect`,
`encodeAuthenticatedRunTaskAgentInputExit`, `decodeUnknownRunTaskAgentResultEffect`,
`decodeUnknownRunTaskAgentResultExit`, `encodeRunTaskAgentResultEffect`,
`encodeRunTaskAgentResultExit`, `decodeUnknownRunTaskAgentErrorEffect`,
`decodeUnknownRunTaskAgentErrorExit`, `encodeRunTaskAgentErrorEffect`, and
`encodeRunTaskAgentErrorExit`.

Core also exports five intentionally named sync decoders:
`unsafeDecodeAuthenticatedRunTaskAgentInputSyncForTestsAndBootstrap`,
`unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap`,
`unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap`,
`unsafeDecodeRunTaskAgentResultSyncForTestsAndBootstrap`, and
`unsafeDecodeRunTaskAgentErrorSyncForTestsAndBootstrap`. These are not general public boundary
helpers. They exist only for bootstrap code paths and unit tests that must decode already-isolated
bridge JSON before an Effect runtime is available. Runtime, extension handlers, generated packages,
desktop, browser tools, and ordinary package services use the Effect or Exit decoders instead.

Generated `@svvyx/workflows` code imports `RunTaskAgentSourceInput`, `RunTaskAgentResult`,
`RunTaskAgentPromptSource`, and `RunTaskAgentError` type-only from
the public `@svvy/core` root export. That generated-client error DTO uses plain string identity
fields only; it never imports branded ids. Runtime validates
`RunTaskAgentSourceInput` into `RunTaskAgentInput` before it authorizes the bridge token, writes
state, derives idempotency, or starts pi-adapter delivery handoff. Runtime-internal error values may carry
branded ids, but branded error variants do not cross into generated package type imports.

`promptSource` is a closed `Schema.Union([...])`; the `messages` variant uses a non-empty array
schema for `{ role, text }` message records:

```ts
Schema.Array(
  Schema.Struct({
    role: Schema.Literals(["user", "assistant"]),
    text: Schema.String,
  }),
).check(Schema.isNonEmpty());
```

`smithersContext.run`, `node`, `usage`, and `output` use `Schema.Json`. All bridge decoders use
the exported `strictBoundaryParseOptions`.

`RunTaskAgentSourceInput` has no top-level `rootDir`, no `threadId`, no system messages, no
shell/app RPC controls, and no generated-context or tool declaration fields. It is the
unauthenticated task-agent request DTO generated `@svvyx/workflows` code may reference type-only.
`RunTaskAgentInput` is the runtime-normalized internal bridge request with branded
`workspaceSessionId`, branded `sourceCommandId`, and normalized `smithersContext.rootDir`; generated
packages do not import it. `AuthenticatedRunTaskAgentInput` is the separate core-owned
authenticated bridge wrapper payload used by runtime loopback/local bridge facades; generated
packages do not import it, and authentication fields never become part of `RunTaskAgentSourceInput`.

- Persistence schema version markers and migration payload envelopes when they cross package
  boundaries.
- Shared helper symbols only when `core.spec.md` names their exact responsibility and
  package-boundary tests list the exported symbol. Allowed categories are branded-id
  constructors/codecs, schema boundary issue formatting, annotation allowlists, exhaustive
  discriminant checks used by core-owned closed unions, and stable validators for core-owned
  contracts.
- Effect v4 schema definitions, hoisted decoders/encoders, and typed tagged errors for public
  package boundaries.

## Does Not Own

- pi imports, pi event types, pi session objects, or pi resource loader configuration.
- SQLite table shapes or storage implementation details.
- Runtime queue execution, turn dispatch, handler-thread lifecycle, recovery, or event publishing.
- Extension registry implementation, source invalidation, prompt composition, tool invocation, or
  generated package building.
- Prompt or instruction source files.
- Sandbox profile generation or native helper invocation.
- Desktop, Svelte, Electrobun, Dockview, or renderer state.
- Smithers workflow state, graph state, run state, retry/resume state, or approval state.

`@svvy/core` may define ids and schema contracts for Smithers-backed product facts when those
contracts cross package boundaries. It does not store, execute, inspect, or own those facts.

## Public API Shape

Current package API surface:

The package entrypoint is a flat barrel of approved public contract modules. It does not expose
grouped namespace objects. Every exported symbol must be stable, documented, schema-backed where it
crosses a runtime boundary, and free of package-internal implementation objects.

`@svvy/core` is not a convenience barrel for all implementation types. A type belongs here only when
at least two public packages or one public package plus a non-desktop consumer need the same stable
contract.

Package API surface:

```ts
export * from "./app-log-contracts";
export * from "./artifact-contracts";
export * from "./boundary-parse-options";
export * from "./composer-contracts";
export * from "./context-budget-contracts";
export * from "./errors";
export * from "./extension-contracts";
export * from "./extension-state-ports";
export * from "./generated-package-contracts";
export * from "./ids";
export * from "./runtime-contracts";
export * from "./native-tool-contracts";
export * from "./pi-adapter-contracts";
export * from "./pi-adapter-ports";
export * from "./prompt-execution-context";
export * from "./provider-auth-ports";
export * from "./runtime-effect-requests";
export * from "./runtime-invalidation-contracts";
export * from "./runtime-source-edit-contracts";
export * from "./runtime-source-invalidation";
export * from "./runtime-state-ports";
export * from "./runtime-submit";
export * from "./sandbox-policy-contracts";
export * from "./secret-store-ports";
export * from "./session-navigation-contracts";
export * from "./workflow-task-agent-bridge-contracts";
```

The package entrypoint exports the approved public contract modules for app logs, errors, ids,
native-tool contracts, prompt execution context, runtime contracts, runtime submission, runtime
effect requests, runtime source edit contracts, runtime source invalidation, composer contracts,
context-budget contracts, session-navigation contracts, artifact contracts, extension contracts,
generated-package contracts,
state-backed port contracts, sandbox policy contracts, provider-auth contracts, pi-adapter
contracts, secret-store contracts, and workflow task-agent bridge contracts.
`AppLogWritePort` belongs to `app-log-contracts`; there is no separate public `app-log-ports`
module. Shared strict boundary parse options belong to `boundary-parse-options`, and extension
state port contracts belong to `extension-state-ports`.
`runtime-state-ports` owns the source-state DTOs and port tag used by runtime and state. Editable
source facts are keyed by `(SourceInvalidationScope, sourceKind, sourceId)` for compare-and-swap
source edits. Runtime source scan facts are keyed by `(SourceInvalidationScope, SourceDomain)` for
deterministic source reconciliation and include committed fingerprint, diagnostics, last observed
deletion path, observation kind, and observation timestamp. Core owns the schemas and port method contracts;
`ReconcileDiscoveredHostSnippetsInputSchema` carries one workspace scan's exact-schema Claude/pi
observations, unreadable file identities, unreadable root identities, source-root fingerprints, and
diagnostics. Discovered identity is `(source, user-or-workspace scope, canonical absolute path)`;
managed `svvy` is not a valid discovered source.
`@svvy/state` owns SQLite persistence and descriptor derivation, while `@svvy/runtime` owns file
watching, scans, generated-package refresh, generated-context refresh, recovery scheduling, and
runtime event publication.

The app-log contract is a public core contract. It includes:

- `AppLogLevel`
- `AppLogSource`
- `AppLogEntry`
- `AppLogSummary`
- `AppLogQuery`
- `AppLogReadModel`
- `AppLogUpdateMessage`
- `AppLogWritePort`
- `AppendAppLogInput`
- `AppendAppLogInputSchema`
- `SvvyObservationPackage`
- `SvvyObservationPackageSchema`
- `SvvyObservationOperation`
- `SvvyObservationOperationSchema`
- `SvvyObservationReasonClass`
- `SvvyObservationReasonClassSchema`
- `SvvyObservationAnnotationSchema`
- `SvvyObservationAnnotation`

`@svvy/core` does not own app-log storage, unread state mutation, retention, redaction execution,
bridge forwarding, or renderer delivery.
`SvvyObservationAnnotation` is the only core-owned encoded annotation shape that app/bootstrap
observability exporters may accept from package logs/spans. It carries package, operation, allowed
product ids, and reason class metadata only. Package values are the exact package/source literals
`"app" | "core" | "state" | "runtime" | "extensions" | "sandbox" | "pi-adapter" | "desktop"`.
Operation values are non-empty lowercase dotted, dashed, or underscored operation names matching
`/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/`. Reason classes are non-empty lowercase underscore tokens
matching `/^[a-z][a-z0-9_]{0,63}$/`. Raw env, prompts, command output, artifact text, provider
tokens, extension env values, raw host errors, generated package names, free-form feature names, and
filesystem paths are not representable.

The native tool contract is a public core contract. It includes:

- `NativeToolSchemaExtension`
- `NativeToolSchema`
- `NativeToolExtensionSchema`
- `NativeToolSchemasDocument`
- `NativeToolContentSchema`
- `NativeToolDeclaration`
- `NativeToolDeclarationSchema`
- `NativeToolConcurrencyContract`
- `NativeToolResultSchema`
- `NativeToolResult`
- `RuntimeStateDomain`
- `NativeToolExecutionInput`
- `NativeToolExecutor`
- `decodeUnknownNativeToolResultEffect`, `decodeUnknownNativeToolResultExit`, and
  `encodeNativeToolResultEffect`, `encodeNativeToolResultExit`
- `ApprovalMode`
- `RuntimeApprovalDecisionFacts`
- pi-free structural `PiToolExecutor`, `PiToolExecutionInput`, and `PiToolExecutionUpdate`
  contracts when needed for the runtime-to-pi-adapter custom-tool bridge

These exports contain no handler ownership, concrete callback implementation, or execution policy.
`NativeToolExecutionInput`, `NativeToolExecutor`, and `PiToolExecutorInput` are in-process executor
callback shapes that may contain `AbortSignal`, Effect-returning emit functions, and update
callbacks. Their schema-backed DTO fields are carried by `NativeToolDeclarationSchema`,
`NativeToolResultSchema`, and `PiToolExecutionInputSchema`; the executor callback shapes themselves
are not persisted, bridged, generated-package inputs, renderer payloads, or unknown-input decoders.
Concrete builtin native-tool declaration records, descriptions, JSON parameters, actor slicing,
projection metadata, and handlers are owned by `@svvy/extensions`. `@svvy/runtime` owns accepted
model tool-call routing, command lifecycle, operation application, and the concrete executor passed
to `@svvy/pi-adapter`. `@svvy/pi-adapter` owns conversion from runtime-provided
`NativeToolDeclaration` values and the runtime-provided executor into pi custom-tool objects.

Native tool declarations may include an optional `concurrency` contract. Omitted concurrency means
`{ mode: "serial" }`.

```ts
type RuntimeStateDomain =
  | "surface"
  | "queue"
  | "command"
  | "request-input"
  | "approval"
  | "artifact"
  | "extension-state"
  | "generated-context"
  | "generated-package"
  | "source"
  | "recovery";

type NativeToolConcurrencyContract =
  | { mode: "serial" }
  | {
      mode: "parallel-safe";
      stateDomains: readonly RuntimeStateDomain[];
      orderingKey: "surface" | "command" | "workspace" | "none";
      maxConcurrency: PositiveSafeInteger;
    };

type NativeToolDeclaration = {
  // existing declaration fields...
  concurrency?: NativeToolConcurrencyContract;
};
```

`stateDomains` names every durable state domain the handler or returned runtime operations may
touch. Runtime serializes accepted tools whose domains or non-`none` ordering keys conflict.
`orderingKey: "none"` is allowed only when the handler's state domains are empty or provably
independent for every accepted call. Boundary tests prove serial default, conflicting-domain
serialization, independent-domain concurrency, and active-turn cancellation interrupting all
accepted-tool fibers before terminal turn facts commit.

`NativeToolDeclaration.parameters` is a product-normalized JSON Schema object for the model-facing
tool input. The owning extension defines the source input contract as an Effect Schema whenever the
input is svvy-owned. `@svvy/extensions` derives model-facing JSON Schema with
`Schema.toJsonSchemaDocument(sourceSchema, { additionalProperties: false, includeAnnotationKey:
isPublicSchemaAnnotationKey })`, then normalizes the returned document into one parameters object.
The current core DTO schema accepts this field as JSON for boundary transport; it does not by
itself validate the full normalized JSON Schema object grammar. `@svvy/extensions` owns generator
validation and tests proving that every published native-tool declaration satisfies the normalized
root-object constraints below. Promoting a core-owned normalized JSON Schema validator requires a
same-change `@svvy/core` schema, codec tests, generated-declaration fixtures, and package-boundary
coverage.
Before publishing `NativeToolDeclaration.parameters`, the generator resolves a top-level `$ref` by
calling `JsonSchema.resolveTopLevel$ref(document)` on the full generated JSON Schema document.
Published parameters must be a root JSON Schema object with no dangling top-level `$ref`.
`NativeToolDeclaration.parameters` is the resolved document's `schema` with the resolved document's
`definitions` attached as `$defs` when non-empty. It
must never expose the raw `{ dialect, schema, definitions }` document shape. If the target
model/tool bridge cannot accept `$defs`, the generator rejects schemas requiring definitions until a
package spec names a tested inliner for that exact target. Runtime still decodes accepted arguments
with the original Effect Schema and
strict boundary parse options; generated JSON Schema is a model-facing projection, not the product
validation source of truth. Hand-written JSON Schema is allowed only for imported upstream/native
schemas that cannot be expressed as an Effect Schema without losing required semantics, and the
owning extension must normalize and boundary-test it before publication.

Generated JSON Schema target policy:

| Target                                     | `$defs` support                             | Inliner owner | Behavior when definitions are required                                                                   |
| ------------------------------------------ | ------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `NativeToolDeclaration.parameters`         | Allowed when the pi/model bridge accepts it | none          | Attach `$defs` to the resolved parameters object; reject for any concrete bridge that cannot carry them. |
| `svvyx` command schema documents           | Target-specific                             | none          | Reject when the selected command-schema target cannot carry definitions.                                 |
| generated package evidence manifests       | Not a JSON Schema emission target           | none          | Do not emit generated JSON Schema here; persist schema-decoded product data instead.                     |
| workflow task-agent bridge payload schemas | Not emitted as JSON Schema                  | none          | Decode with `@svvy/core` Effect Schemas at runtime and generated-package boundaries.                     |

No emitter silently drops `$defs`, leaves dangling `$ref`, or inlines definitions unless the owning
package spec promotes a named inliner with fixtures proving recursive/reference behavior, emitted
size limits, and target support.

`@svvy/core` exports `isPublicSchemaAnnotationKey(key: string): boolean` and a test fixture listing
every allowed non-standard annotation key. Standard JSON Schema keys are emitted by Effect; all
other annotation keys are rejected unless listed here. Until a product spec adds a concrete
extension metadata key with owner, emitted artifact, schema, and redaction behavior,
`isPublicSchemaAnnotationKey` returns `false` for non-standard keys.

The prompt execution context contract is a public core contract. It includes:

- `PromptExecutionSurfaceKind`
- `PromptExecutionEpisodeKind`
- `PromptExecutionExternalInstructionSource`
- `PromptExecutionContext`

`@svvy/core` owns only the schema-backed data shapes, derived types, and boundary codecs for this
context. `@svvy/runtime` owns production derivation, content stripping, and the live
invocation/runtime handles used while executing tools as package-private implementation details.
These constructors and live handles are not exported from `@svvy/core`, the `@svvy/runtime` package
root, or `@svvy/runtime/bootstrap`. The only allowed public runtime surface for the narrow
constructor/live-handle API is `@svvy/runtime/prompt-execution-context`, which exists for
runtime-owned app-edge tool wrappers and package tests, not as a UI, bridge, generated-package, or
agent-facing submission contract. Extension handlers receive decoded `PromptExecutionContext` data
through runtime invocation wiring. Desktop, browser tools, headless callers, generated packages,
Smithers task-agent bridge callers, and renderer bridge messages do not submit prompt execution
contexts.

The pi-adapter contract modules are public core contracts. They include:

- `ModelSelectionSchema`, `ModelSelection`, and the hoisted decode/encode functions
  `decodeUnknownModelSelectionEffect`, `decodeUnknownModelSelectionExit`, and
  `encodeModelSelectionEffect`
- `ReasoningEffortSchema`, `ReasoningEffort`, `ReasoningSelectionSchema`, `ReasoningSelection`,
  and the hoisted decode/encode functions `decodeUnknownReasoningSelectionEffect`,
  `decodeUnknownReasoningSelectionExit`, and `encodeReasoningSelectionEffect`
- `PiSessionRefSchema`, `PiSessionRef`, `PiSessionReferenceSchema`, `PiSessionReference`,
  `PiSessionReferencePublicSchema`, `PiSessionReferencePublic`,
  `PiSessionReferenceValidationSchema`, and `PiSessionReferenceValidation`
- `PiAmbientPiResourceKindSchema`, `PiAmbientPiResourceKind`,
  `PiAmbientPiResourceEnablementSchema`, and `PiAmbientPiResourceEnablement`
- `CreatePiSessionInputSchema`, `OpenPiSessionInputSchema`, `ClosePiSessionInputSchema`, and their
  public types
- `RunPiTurnInput`, `InterruptPiTurnInputSchema`, `InterruptPiTurnInput`,
  `PiSystemPromptBindingSchema`, `PiSystemPromptBinding`, `PiToolExecutionInputSchema`,
  `PiToolExecutionInput`, `PiToolExecutor`, `PiToolExecutionUpdate`, `InputModalitySchema`, and
  `InputModality`
- `PiHistoryEntryRefSchema`, `RestorePiHistoryEntryInputSchema`,
  `ForkPiHistoryEntryInputSchema`, and their public types
- `ModelInfoSchema`, `ModelInfo`, `ListModelsInputSchema`, `GenerateTitleInputSchema`,
  `GenerateTitleResultSchema`, `PiRuntimePathsSnapshotSchema`, and their public types
- `PiRuntimeEventSchema`, `PiRuntimeEvent`, and the hoisted decode functions
  `decodeUnknownPiRuntimeEventExit` and `decodeUnknownPiRuntimeEventEffect`
- `PiSessionReferencePort`, `PiRuntimePathsPort`, their service shapes, input types, and typed port
  errors
- `ProviderAuthPort` and its service/input/error contracts live in the provider-auth port module,
  even though `@svvy/pi-adapter` consumes that port for live pi credential snapshots

`PiSystemPromptBindingSchema` is schema-backed because `RunPiTurnInput` carries it into
`@svvy/pi-adapter`. It is not a standalone bridge/RPC DTO surface and does not export a separate
codec quartet unless a package boundary accepts or emits a `PiSystemPromptBinding` by itself.

These symbols are pi-free. They import no `@mariozechner/*` package, contain no pi-native session,
tool, model, provider, history, or resource-loader objects, and do not duplicate persisted state.
`@svvy/pi-adapter` consumes these contracts; it does not redefine them. State-backed provider auth
and pi session reference facts stay in `@svvy/state` through implementations of the core-owned
ports. Pi-adapter-owned session bytes and live handles remain outside state and are cleaned up by
`@svvy/pi-adapter` under runtime recovery observation.

Effect imports in `@svvy/core` use direct v4 module paths:

```ts
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Exit from "effect/Exit";
import type * as Stream from "effect/Stream";
```

`@svvy/core` may mention `Stream.Stream<...>` only in type positions for stable port or package API
contracts. It does not construct streams, own `PubSub`, manage replay, allocate queues, or implement
runtime event delivery. Live stream resources are owned by the implementation package, normally
`@svvy/runtime`.

Static schema definitions and manifest-adopted compiled schema functions are hoisted at module
scope, including `Schema.decodeUnknownEffect`, `Schema.decodeUnknownExit`,
`Schema.decodeUnknownSync`, `Schema.encodeEffect`, `Schema.encodeExit`, and
`Schema.encodeUnknownSync`. Other schema compiler helpers such as `Schema.is`,
`Schema.decodeEffect`, `Schema.decodeExit`, `Schema.encodeUnknownEffect`, and
`Schema.encodeUnknownExit` are not adopted production helpers unless exact manifest rows and focused
tests exist.
Effect v4 `Schema.asserts(schema, input)` is a direct assertion call, not a reusable guard compiler.
Core boundary code therefore uses hoisted manifest-adopted decoders, encoders, or package-owned
wrapper helpers whose compiler calls happen at module scope. Direct inline assertion calls are
allowed only in named dynamic schema factory files where the schema cannot be known at module scope.
Static schemas are not compiled inside hot functions, tool handlers, event loops, read-model
selectors, bridge handlers, or assertion sites.

`@svvy/core` exports the one strict parse-options object used by public boundary decoders,
StandardSchemaV1 validators, generated native-tool schemas when they validate product inputs, and
state/runtime/app-log/read-model boundary helpers:

```ts
import type * as SchemaAST from "effect/SchemaAST";

export const strictBoundaryParseOptions = {
  errors: "all",
  onExcessProperty: "error",
} satisfies SchemaAST.ParseOptions;
```

Every public unknown-input boundary decoder exported from `@svvy/core` or package contract modules
is named `decodeUnknown<TypeName>Effect` and/or `decodeUnknown<TypeName>Exit`.
`decode<TypeName>Effect` / `decode<TypeName>Exit` are allowed only when the function accepts an
already typed encoded value and calls `Schema.decodeEffect` / `Schema.decodeExit`, not
`Schema.decodeUnknown*`. Sync decoders are not product-boundary helpers. Any exported sync decoder
is named `unsafeDecode<TypeName>SyncForTestsAndBootstrap` and may be used only in tests, trusted
bootstrap, or local assertions before entering an Effect boundary. Outbound decoded values use
`encode<TypeName>Effect` / `encode<TypeName>Exit`. `encodeUnknown<TypeName>*` is allowed only at
non-Effect bridge edges where the outbound value is genuinely unknown and immediately mapped to a
stable bridge error on failure.
The only public sync outbound encode exceptions are
`encodeRequestUserInputAnswerQueuePayload(...)` and
`encodeRequestUserInputAnswerDeliveryPayload(...)`. They exist for durable request-input
queue/delivery JSON payload construction where the caller already holds decoded core types and the
result is immediately stored or enqueued as JSON. Adding another sync encode helper requires an
exact core spec row, public symbol-index row, owner test, and a reason it cannot use
`encode<TypeName>Effect` / `encode<TypeName>Exit`.

Every public tagged boundary error exported by `@svvy/core` also exports the same codec quartet by
exact type name:

```ts
export const decodeUnknown<Name>Effect = Schema.decodeUnknownEffect(
  <Name>Schema,
  strictBoundaryParseOptions,
);
export const decodeUnknown<Name>Exit = Schema.decodeUnknownExit(
  <Name>Schema,
  strictBoundaryParseOptions,
);
export const encode<Name>Effect = Schema.encodeEffect(<Name>Schema, strictBoundaryParseOptions);
export const encode<Name>Exit = Schema.encodeExit(<Name>Schema, strictBoundaryParseOptions);
```

The required error codec set includes `RuntimeContractError`, `RuntimeFacadeErrorContract`,
`RuntimeEventRebaselineRequired`, `RuntimeEventStreamError`, `StateContractError`,
`StateFacadeErrorContract`, `SandboxPolicyError`, `PiAdapterError`, `ExtensionError`,
`RuntimeToolExecutionError`, `ProviderAuthPortError`, `SecretStorePortError`, `PiSessionReferencePortError`,
`StateCommandPostCommitNotificationError`, and any additional public
`Schema.TaggedErrorClass` or encoded
facade-error contract value added to this spec.
Sync error decoders may exist only as
`unsafeDecode<Name>SyncForTestsAndBootstrap` and are limited to tests, trusted bootstrap, and local
assertions. Boundary code must not hand-normalize `ParseResult` issues; it uses
`formatBoundaryIssues(...)`, which in turn uses the exported `normalizeBoundaryIssuePath(...)`.
The canonical public boundary issue symbols are `BoundaryIssueSchema`, `BoundaryIssue`,
`normalizeBoundaryIssuePath(...)`, and `formatBoundaryIssues(...)`. Do not export
`BoundarySchemaIssueSchema`, `BoundarySchemaIssue`, `formatBoundarySchemaIssues(...)`, or
`StoredError` aliases from public core modules. Package-boundary tests reject those names.

## Schema And Error Contract

`@svvy/core` is the source of public contract schemas.

Required schema families:

- branded ids for every public identity
- `SubmitMessageInput`, `SubmitMessageResult`, `PromptTarget`, and `RuntimeSurfaceTarget`
- `RuntimeEvent` and every event payload
- read-model input and output payloads
- command lifecycle payloads and command fact envelopes
- extension manifests, metadata, generated-context entries, redaction metadata, env declarations,
  dependency readiness, and facade metadata
- sandbox policy snapshots and launch policy inputs
- app logs, normalized errors, settings, provider/auth status, and persisted envelope versions

Public persisted/RPC values use manifest-adopted `Schema.Struct`, branded schemas, or schema
constants as their source of truth. `Schema.Class` and `Schema.TaggedClass` are not adopted
production schema contracts unless exact manifest rows and focused tests exist. TypeScript types are
derived from schemas; they are not maintained as hand-written parallel contracts. Use
`Schema.TaggedErrorClass` for typed
errors that cross package, RPC, persistence, or generated-declaration boundaries. Internal
non-serialized errors may use package-local classes or plain tagged objects; `Data.TaggedError`
requires manifest promotion before production use.

Branded ids are schema-defined and types are derived from the schema:

```ts
export const WorkspaceId = Schema.String.pipe(Schema.brand("WorkspaceId"));
export type WorkspaceId = typeof WorkspaceId.Type;

export const SurfacePiSessionId = Schema.String.pipe(Schema.brand("SurfacePiSessionId"));
export type SurfacePiSessionId = typeof SurfacePiSessionId.Type;

export const CommandId = Schema.String.pipe(Schema.brand("CommandId"));
export type CommandId = typeof CommandId.Type;

export const AbsolutePath = Schema.String.pipe(Schema.brand("AbsolutePath"));
export type AbsolutePath = typeof AbsolutePath.Type;
```

Persisted/RPC timestamps use one core-owned UTC contract:

```ts
export const UtcDateTime = Schema.DateTimeUtcFromString;
export type UtcDateTime = typeof UtcDateTime.Type;

export type IsoDateTimeString = typeof UtcDateTime.Encoded;
```

Boundary decoders intentionally use `Schema.DateTimeUtcFromString`, including its v4 behavior that
treats strings without an explicit zone as UTC. All persisted/RPC/generated encoders canonicalize
timestamps through `DateTime.formatIso(...)` before crossing the boundary. Any external or
user-authored boundary that must reject no-zone timestamps declares a stricter wrapper schema before
`DateTimeUtcFromString`. Owning runtime, state, and package services acquire current time through
Effect `DateTime` or `Clock` and encode with `DateTime.formatIso(...)` before crossing a boundary.
`@svvy/core` does not export time-producing helpers.

Public duration fields use shared finite millisecond schemas, not raw `Schema.Number`:

```ts
export const FiniteDurationMsSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
).pipe(Schema.brand("FiniteDurationMs"));
export type FiniteDurationMs = typeof FiniteDurationMsSchema.Type;

export const PositiveDurationMsSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
).pipe(Schema.brand("PositiveDurationMs"));
export type PositiveDurationMs = typeof PositiveDurationMsSchema.Type;

export const NonNegativeSafeIntegerSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export type NonNegativeSafeInteger = typeof NonNegativeSafeIntegerSchema.Type;

export const PositiveSafeIntegerSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isInt(),
  Schema.isGreaterThan(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export type PositiveSafeInteger = typeof PositiveSafeIntegerSchema.Type;

export const RuntimeEventSequence = NonNegativeSafeIntegerSchema.pipe(
  Schema.brand("RuntimeEventSequence"),
);
export type RuntimeEventSequence = typeof RuntimeEventSequence.Type;

export const RuntimeEventGenerationId = Schema.String.pipe(
  Schema.brand("RuntimeEventGenerationId"),
);
export type RuntimeEventGenerationId = typeof RuntimeEventGenerationId.Type;

export const SurfaceStreamSequence = NonNegativeSafeIntegerSchema.pipe(
  Schema.brand("SurfaceStreamSequence"),
);
export type SurfaceStreamSequence = typeof SurfaceStreamSequence.Type;

export const SurfaceStreamGenerationId = Schema.String.pipe(
  Schema.brand("SurfaceStreamGenerationId"),
);
export type SurfaceStreamGenerationId = typeof SurfaceStreamGenerationId.Type;
```

Internal Effect services convert millisecond inputs at package boundaries with manifest-adopted
`Duration.millis(ms)` and keep outward contracts in finite millisecond fields. `Duration.toMillis`
and `Schema.Duration*` helpers remain unavailable for production contracts until promoted in
`packages/effect-adoption-manifest.ts`.

`IsoDateTimeString` is a readability alias for the encoded string side of
`Schema.DateTimeUtcFromString`, not a nominal compile-time proof. Boundary schemas must still
reference `UtcDateTime` / `Schema.DateTimeUtcFromString`; assigning a value to an
`IsoDateTimeString`-typed field does not validate ISO format or UTC semantics.

Repository schemas decode timestamp columns with `Schema.DateTimeUtcFromString`; persistence, RPC,
runtime events, app logs, command facts, recovery rows, generated-package manifests, and bridge
payloads encode UTC ISO strings only. Effect programs get the current timestamp from Effect
`DateTime`/`Clock`, not from `Date.now()`, so tests can use `TestClock`.

Composite public contracts reference those schemas directly. Effect-internal service code and
package-local helpers use decoded types such as `typeof Contract.Type` or
`Schema.Schema.Type<typeof Contract>`. Persistence, RPC, generated-package files, desktop bridge
payloads, command facts, runtime events, app logs, and other serialized/public payload boundaries
use the schema's encoded type, such as `typeof Contract.Encoded` or
`Schema.Codec.Encoded<typeof Contract>`, when the decoded type can be a class instance, redacted
wrapper, transformed value, or otherwise different from the wire/storage shape.

In persisted, RPC, generated-package, bridge, command-fact, and queue payload schemas, TypeScript
`?` means absent-only and is implemented with `Schema.optionalKey(S)`. Use `Schema.optional(S)` only
when explicit `undefined` is a valid decoded/encoded value. Nullable storage columns use required
`Schema.NullOr(S)`; fields that may be absent and, when present, may be null use
`Schema.optionalKey(Schema.NullOr(S))`. Sparse maps use
`Schema.optionalKey(Schema.Record(KeySchema, ValueSchema))`; map values must not be `undefined`.

Error fields must be structured enough for callers to act on. Avoid broad `reason: string` fields
when a closed reason union or a narrower tagged error communicates the actual product state.
Typed boundary errors that represent schema decode or encode failures include `issues`, a compact,
stable, machine-readable StandardSchemaV1 issue array derived from
`SchemaIssue.makeFormatterStandardSchemaV1()(schemaError.issue).issues` after schema-level
redaction has run. Each issue preserves at least the normalized path and message needed for callers
to render actionable validation detail. Public contracts may additionally expose a developer-facing
`issue` string only when it is derived from the same redacted issue set and is not the sole
machine-readable evidence. Issue fields must not contain raw secret values. The optional `cause`
field is encoded with
`Schema.Defect({ excludeCause: true })` by default and is for unknown foreign exceptions or values
that are useful at a trusted debug boundary without recursively exposing nested causes.

Required package-boundary error classes:

Typed boundary errors that represent schema decode or encode failures include `issues`, a compact,
stable, machine-readable StandardSchemaV1 issue array derived from a v4 `Schema.SchemaError.issue`
with `SchemaIssue.makeFormatterStandardSchemaV1()(schemaError.issue).issues` after schema-level
redaction has run. Package boundaries use the v4 `decodeUnknown*Effect`/`Exit` boundary decoders,
not `decodeEither` or `decodeUnknownEither`.

```ts
export const BoundaryIssueSchema = Schema.Struct({
  path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
  message: Schema.String,
});
export type BoundaryIssue = typeof BoundaryIssueSchema.Type;

export const normalizeBoundaryIssuePath = (
  path: readonly unknown[],
): readonly (string | number)[] =>
  path.flatMap((segment) => {
    const key =
      typeof segment === "object" && segment !== null && "key" in segment
        ? (segment as { key: unknown }).key
        : segment;
    if (typeof key === "number" || typeof key === "string") return [key];
    if (typeof key === "symbol") return [key.description ?? key.toString()];
    if (key == null) return [];
    return [String(key)];
  });

export const formatBoundaryIssues = (schemaError: Schema.SchemaError): readonly BoundaryIssue[] =>
  SchemaIssue.makeFormatterStandardSchemaV1()(schemaError.issue).issues.map((issue) => ({
    path: normalizeBoundaryIssuePath(issue.path ?? []),
    message: issue.message,
  }));

// If Effect returns non-JSON property keys in issue paths, boundary formatting normalizes those
// segments to strings before crossing a public boundary. `{ key }` path segments are unwrapped,
// numeric indexes remain numbers, missing paths become `[]`, symbols become stable strings, and raw
// Standard Schema issues are never returned directly from public package boundaries.

export const StoredErrorReasonSchema = Schema.Literals([
  "invalid-input",
  "decode-failed",
  "encode-failed",
  "not-found",
  "conflict",
  "persistence-failed",
  "execution-failed",
  "cancelled",
  "interrupted",
  "timed-out",
  "denied",
  "unavailable",
  "unknown",
]);
export type StoredErrorReason = typeof StoredErrorReasonSchema.Type;

export const StateStoredErrorSchema = Schema.Struct({
  errorTag: Schema.String,
  operation: Schema.String,
  reason: StoredErrorReasonSchema,
  packageReason: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.String),
  message: Schema.String,
  interrupted: Schema.optionalKey(Schema.Boolean),
  timedOut: Schema.optionalKey(Schema.Boolean),
  exitCode: Schema.optionalKey(Schema.Number),
  signal: Schema.optionalKey(Schema.String),
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
});
export type StateStoredError = typeof StateStoredErrorSchema.Type;

// `StoredErrorSchema` is not exported as an alias. The stable public name is
// `StateStoredErrorSchema` so durable state, command facts, app logs, and recovery rows use one
// unambiguous symbol.

export class RuntimeContractError extends Schema.TaggedErrorClass<RuntimeContractError>()(
  "RuntimeContractError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "schema-error",
      "target-not-found",
      "target-not-ready",
      "surface-not-messageable",
      "stale-state",
      "state-conflict",
      "unsupported-operation",
      "startup-pending",
      "startup-failed",
      "runtime-shutdown",
      "runtime-disposed",
      "runtime-closed",
      "backpressure",
      "approval-required",
      "dependency-not-ready",
      "read-only-source",
      "event-replay-unavailable",
      "stream-failed",
      "bridge-invalid-request",
      "bridge-payload-too-large",
      "bridge-forbidden",
      "source-command-not-found",
      "source-command-not-handler-owned",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class RuntimeEventRebaselineRequired extends Schema.TaggedErrorClass<RuntimeEventRebaselineRequired>()(
  "RuntimeEventRebaselineRequired",
  {
    reason: Schema.Literals(["stale-cursor", "generation-changed", "filter-not-lossless"]),
    requestedAfterSequence: RuntimeEventSequence,
    retainedFromSequence: RuntimeEventSequence,
    currentHighWaterSequence: RuntimeEventSequence,
    eventGenerationId: RuntimeEventGenerationId,
    affectedReadModels: Schema.Array(StateInvalidationDescriptorSchema),
    workspaceId: Schema.optionalKey(WorkspaceId),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  },
) {}

export class RuntimeEventStreamError extends Schema.TaggedErrorClass<RuntimeEventStreamError>()(
  "RuntimeEventStreamError",
  {
    operation: Schema.String,
    reason: Schema.Literals(["subscriber-closed", "stream-failed"]),
    message: Schema.String,
    lastContiguousSequence: Schema.optionalKey(RuntimeEventSequence),
    latestSequence: Schema.optionalKey(RuntimeEventSequence),
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export const RuntimeEventErrorSchema = Schema.Union([
  RuntimeEventRebaselineRequired,
  RuntimeEventStreamError,
]);

export const RuntimeFacadeErrorContractSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("typed-failure"),
    error: Schema.Union([RuntimeContractError, RuntimeEventErrorSchema]),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("defect"),
    message: Schema.String,
    defectClass: Schema.optionalKey(Schema.String),
    diagnosticAppLogEntryId: Schema.optionalKey(AppLogEntryId),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("interrupted"),
    interruptReason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("aborted"),
  }),
  Schema.Struct({
    type: Schema.Literal("runtime-facade-error"),
    reason: Schema.Literal("disposed"),
  }),
]);

export type RuntimeFacadeErrorContract = typeof RuntimeFacadeErrorContractSchema.Type;

export class StateContractError extends Schema.TaggedErrorClass<StateContractError>()(
  "StateContractError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "not-found",
      "conflict",
      "stale-state",
      "claim-conflict",
      "transaction-failed",
      "decode-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export const StateCommandReceiptSchema = Schema.Struct({
  clientRequestId: Schema.NullOr(RuntimeClientRequestId),
  outcome: Schema.Literals(["applied", "duplicate"]),
  committedAt: IsoDateTimeString,
  stateRevision: StateRevision,
});

export type StateCommandReceipt = typeof StateCommandReceiptSchema.Type;

export const StateFacadeErrorContractSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("typed-failure"),
    error: StateContractError,
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("post-commit-notification-failed"),
    receipt: StateCommandReceiptSchema,
    notificationError: StateCommandPostCommitNotificationErrorSchema,
    message: Schema.String,
    diagnosticAppLogEntryId: Schema.optionalKey(AppLogEntryId),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("defect"),
    message: Schema.String,
    defectClass: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("interrupted"),
    interruptReason: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("aborted"),
  }),
  Schema.Struct({
    type: Schema.Literal("state-facade-error"),
    reason: Schema.Literal("disposed"),
  }),
]);

export type StateFacadeErrorContract = typeof StateFacadeErrorContractSchema.Type;

export class SandboxPolicyError extends Schema.TaggedErrorClass<SandboxPolicyError>()(
  "SandboxPolicyError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-policy",
      "snapshot-mismatch",
      "helper-unavailable",
      "profile-generation-failed",
      "unsupported-platform",
      "denied",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class PiAdapterError extends Schema.TaggedErrorClass<PiAdapterError>()("PiAdapterError", {
  operation: Schema.String,
  reason: Schema.Literals([
    "provider-auth-failed",
    "provider-auth-missing",
    "provider-auth-expired",
    "provider-auth-refresh-failed",
    "runtime-paths-failed",
    "session-not-found",
    "session-open-failed",
    "session-create-failed",
    "session-close-failed",
    "session-reference-failed",
    "turn-failed",
    "event-decode-failed",
    "model-read-failed",
    "history-operation-failed",
    "helper-job-failed",
    "tool-execution-failed",
  ]),
  message: Schema.String,
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
}) {}

export class ExtensionError extends Schema.TaggedErrorClass<ExtensionError>()("ExtensionError", {
  extensionId: Schema.optionalKey(Schema.String),
  operation: Schema.String,
  reason: Schema.Literals([
    "invalid-input",
    "not-found",
    "not-loaded",
    "dependency-not-ready",
    "unsupported-operation",
    "read-only-source",
    "execution-failed",
    "redaction-failed",
  ]),
  message: Schema.String,
  issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
  cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
}) {}
```

Implementation packages may define narrower internal error classes, but package-boundary failures
must be representable as public typed errors or stable normalized app/RPC error payloads.

`StateStoredError` is the only durable stored-error shape for queue, recovery, command, app-log, and
read-model payloads that need normalized failure details. Internal Effect `Cause` values, pi-native
errors, SQLite errors, subprocess failures, provider errors, and renderer exceptions are mapped to
this shape or a narrower public tagged error before persistence or RPC. Durable product state does
not store raw Effect cause trees, thrown foreign objects, host API errors, or library-specific error
instances.
`StateStoredError.operation`, `errorTag`, and `packageReason` are bounded, low-cardinality values
chosen by the owning package contract. `message` and `detail` are redacted display fields; they must
not contain raw host errors, filesystem paths unless explicitly allowed by the owning contract,
prompts, command output, provider payloads, secret material, serialized foreign error objects, or
unbounded stack traces.

When mapping an `Exit` or `Cause` into `StateStoredError`, boundary code inspects the complete v4
`cause.reasons` array with manifest-adopted reason-level guards such as `Cause.isFailReason`,
`Cause.isDieReason`, and `Cause.isInterruptReason`, plus aggregate helpers such as
`Cause.hasInterruptsOnly`, before choosing a public result. Classification order is: no reasons maps
to a stable unknown-defect/debug error; interrupts-only maps to the boundary's cancelled/interrupted
shape; one or more fail reasons makes typed failure the primary result while recording interrupt or
defect diagnostics when present; defects with no fail reasons map to the boundary's defect shape;
mixed defects and interrupts with no fail reasons make defect primary and note interruption when the
contract supports it. Boundary code then stores stable fields such as `errorTag`, `reason`,
`message`, `interrupted`, `timedOut`, `exitCode`, `signal`, `issues`, and redacted `cause`. Durable
product state never stores `Schema.Cause(...)`, `Schema.Exit(...)`, recursive cause variants, or
raw Effect cause objects. `Cause.squash(...)` may be used only after classification to produce
redacted developer-facing detail.

## Surface Identity Contract

Runtime and read-model APIs must carry explicit surface identity. Callers must not overload a
workspace session id to mean both the top-level session and the addressed pi surface.

`PromptTarget` addresses user-messageable orchestrator and handler surfaces:

```ts
type PromptTarget =
  | {
      workspaceSessionId: WorkspaceSessionId;
      surface: "orchestrator";
      surfacePiSessionId: SurfacePiSessionId;
      threadId?: never;
    }
  | {
      workspaceSessionId: WorkspaceSessionId;
      surface: "handler";
      surfacePiSessionId: SurfacePiSessionId;
      threadId: ThreadId;
    };
```

`panelId` and Dockview layout identity are UI-only and must not enter runtime or state identities.
Delegated handler-thread surfaces use `surface: "handler"` at every public `@svvy/runtime` and
`@svvy/core` boundary. Renderer-local labels must be normalized before they reach those public
package contracts.

`RuntimeSurfaceTarget` addresses every pi-backed surface that can stream runtime output, including
workflow task-agent attempts created through the Smithers task-agent bridge:

```ts
type RuntimeSurfaceTarget =
  | PromptTarget
  | {
      workspaceSessionId: WorkspaceSessionId;
      surface: "workflow-task";
      surfacePiSessionId: SurfacePiSessionId;
      workflowTaskAttemptId: WorkflowTaskAttemptId;
      workflowRunId?: WorkflowRunId;
      threadId: ThreadId;
    };
```

`runtime.messages.submit(...)` accepts only `PromptTarget`. Runtime stream, turn/task-attempt, and
read-model invalidation events may use `RuntimeSurfaceTarget`.

`PromptTarget` and `RuntimeSurfaceTarget` intentionally do not carry `workspaceId`. The
message-submission boundary avoids duplicated caller-provided identity: runtime resolves
`workspaceId` from `workspaceSessionId` in the same state transaction that validates the addressed
surface. Durable queue rows, command rows, runtime events, and read-model invalidations carry the
resolved `workspaceId` after that validation.

## Session Navigation Read-Model Contract

`@svvy/core/session-navigation-contracts` owns two related schema families. The generic
`WorkspaceSessionNavigationSummarySchema` / `WorkspaceSessionNavigationReadModelSchema` family
defines pin, archive, update time, section grouping, collapse state, and durable section size for
any workspace navigation selector. The renderer-facing `SessionNavigationSummarySchema` /
`SessionNavigationReadModelSchema` family closes the exact durable session-row DTO consumed through
the state read facade.

The detailed summary contains the generic navigation fields plus:

- workspace session identity, projected title/preview, created/updated time, message count, and
  orchestrator-local `idle | running | waiting | error` status
- unread time/reason/read time, optional provider/model/reasoning display facts, and nullable wait
  detail
- durable counts, ordered thread ids, and thread ids grouped as `runningHandler`,
  `runningWorkflow`, `waiting`, or `troubleshooting`
- sidebar handler rows with exact handler status, nullable subtitle, nullable latest command rollup,
  and nested workflow rows with exact Smithers-observed workflow status and nullable subtitle
- optional command rollups, optional product events, and optional title-generation state

Nested DTO schemas are public because renderer/shared bridge consumers must not import state
selector implementation types. Command rollups preserve exact optional-versus-null semantics for
ownership, arguments, facts, errors, semantic sections, and terminal timestamps. Command arguments,
facts, progress facts, product-event details, and other open structured values are validated as
JSON at this boundary; state must not cast selector `unknown` values through the core schema.
Title-generation status is exactly `not-started`, `pending`, `running`, `completed`, `failed`, or
`cancelled`; trigger/finish/error fields are explicit nullable values.

The detailed contract intentionally omits pi session-file paths and parent-session lineage. Those
facts are not authoritatively derivable from structured product state and must not be invented by a
state read model. `decodeUnknownSessionNavigationReadModelEffect` / `Exit` and the matching encode
helpers use `strictBoundaryParseOptions`, so unknown lifecycle enums, excess lineage fields, and
non-JSON command data fail the boundary. The generated core public-symbol index records every
nested schema/type symbol; `packages/core/src/session-navigation-contracts.test.ts` is the strict
golden/negative contract test.

## Runtime Prompt Submission Contract

The programmatic runtime submission contract is the stable public submission boundary. Runtime
consumers submit only the new user message and delivery intent. They do not submit full pi message
arrays, active system prompts, prompt text outside the committed generated-context/prompt-dispatch
contract, or renderer `Agent` state.

```ts
const RuntimeAttachmentId = Schema.String.pipe(Schema.brand("RuntimeAttachmentId"));
const AttachmentDisplayName = Schema.String.pipe(Schema.brand("AttachmentDisplayName"));
const WorkspaceRelativePath = Schema.String.pipe(Schema.brand("WorkspaceRelativePath"));
const MimeType = Schema.String.pipe(Schema.brand("MimeType"));
const Base64String = Schema.String.pipe(Schema.brand("Base64String"));
const RuntimeClientSubmissionId = Schema.String.pipe(Schema.brand("RuntimeClientSubmissionId"));
const RuntimeClientRequestId = Schema.String.pipe(Schema.brand("RuntimeClientRequestId"));
const RuntimeClientCorrelationId = Schema.String.pipe(Schema.brand("RuntimeClientCorrelationId"));
const RuntimeClientSubmissionSource = Schema.String.pipe(
  Schema.brand("RuntimeClientSubmissionSource"),
);

type RuntimeAttachmentId = typeof RuntimeAttachmentId.Type;
type AttachmentDisplayName = typeof AttachmentDisplayName.Type;
type WorkspaceRelativePath = typeof WorkspaceRelativePath.Type;
type MimeType = typeof MimeType.Type;
type Base64String = typeof Base64String.Type;
type ByteCount = PositiveSafeInteger;
type RuntimeClientSubmissionId = typeof RuntimeClientSubmissionId.Type;
type RuntimeClientRequestId = typeof RuntimeClientRequestId.Type;
type RuntimeClientCorrelationId = typeof RuntimeClientCorrelationId.Type;
type RuntimeClientSubmissionSource = typeof RuntimeClientSubmissionSource.Type;

type RuntimeSubmittedAttachment =
  | {
      kind: "image";
      id?: RuntimeAttachmentId;
      name?: AttachmentDisplayName;
      path?: AbsolutePath;
      workspaceRelativePath?: WorkspaceRelativePath;
      dataBase64?: Base64String;
      mimeType: MimeType;
      sizeBytes?: ByteCount;
    }
  | {
      kind: "file";
      id?: RuntimeAttachmentId;
      name?: AttachmentDisplayName;
      path: AbsolutePath;
      workspaceRelativePath?: WorkspaceRelativePath;
      mimeType?: MimeType;
      sizeBytes?: ByteCount;
    }
  | {
      kind: "folder";
      id?: RuntimeAttachmentId;
      name?: AttachmentDisplayName;
      path: AbsolutePath;
      workspaceRelativePath?: WorkspaceRelativePath;
      mimeType?: MimeType;
      sizeBytes?: ByteCount;
    };

type RuntimeSubmittedMessage = {
  text: string;
  attachments?: RuntimeSubmittedAttachment[];
  snippetProvenance?: SentSnippetProvenance[];
};

type RuntimeMessageDelivery = "enqueue-and-run" | "queue-only";

type RuntimeClientSubmissionInput = {
  submissionId?: RuntimeClientSubmissionId;
  correlationId?: RuntimeClientCorrelationId;
  clientRequestId?: RuntimeClientRequestId;
  source?: RuntimeClientSubmissionSource;
  submittedAt?: IsoDateTimeString;
  sequence?: NonNegativeSafeInteger;
};

type RuntimeClientSubmission = {
  submissionId?: RuntimeClientSubmissionId;
  correlationId?: RuntimeClientCorrelationId;
  clientRequestId?: RuntimeClientRequestId;
  source?: RuntimeClientSubmissionSource;
  submittedAt?: UtcDateTime;
  sequence?: NonNegativeSafeInteger;
};

type SubmitMessageInput = {
  target: PromptTarget;
  message: RuntimeSubmittedMessage;
  delivery?: RuntimeMessageDelivery;
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

Public/facade and state command inputs use `RuntimeClientSubmissionInput`, so
`clientSubmission.submittedAt` is an encoded `IsoDateTimeString` at every Promise/RPC/JSON
boundary. Runtime decodes it to internal `RuntimeClientSubmission.submittedAt: UtcDateTime` only
inside Effect service boundaries before state writes, validation receipts, or turn handling. Public
facades reject decoded `DateTime.Utc` objects at the wire boundary; internal services do not pass
encoded timestamp strings around after schema decode.

`SubmitMessageResult` reports durable queue acceptance only. It never reports live dispatch state,
turn identity, generated-context read-model data, queue depth, renderer snapshots, model settings, or
transcript state. Every claimed prompt-bearing dispatch creates a concrete `TurnId`, including
workflow task-agent attempt dispatch created from `workflow_task_agent_start`, but that identity is
published through runtime events and state read models rather than the submit return value.

`clientSubmission` is telemetry and idempotency metadata only. It may correlate UI, headless, or
test requests with runtime results, but it is never the source of target identity, surface routing,
prompt content, delivery policy, extension availability, approval policy, sandbox policy, or
provider selection. UI panel ids, Dockview ids, and renderer-local sequence numbers remain outside
runtime identity. A repeated matching `clientRequestId` returns the original `queuedMessageId` with
`receipt.outcome: "duplicate"` and does not enqueue another row. Reusing the same
`clientRequestId` with a different decoded target, message, or delivery fails with
`RuntimeContractError.reason: "state-conflict"`.

Steering is not a `SubmitMessageInput.delivery` mode. It is a queue operation that marks an already
persisted queued row as `steering`, stamps steering order facts such as `steeredAt` and
`steerSequence`, and makes that row sort before ordinary queued rows for the same
`surfacePiSessionId` and `orderingKey`:

```ts
type SteerQueuedMessageInput = {
  target: PromptTarget;
  queuedMessageId: QueueItemId;
};
```

Example:

```ts
const result = await runtime.messages.submit({
  target: {
    workspaceSessionId: "wsess_01" as WorkspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: "pi_orch_01" as SurfacePiSessionId,
  },
  message: {
    text: "Refactor the transcript projection and report risks.",
  },
  delivery: "enqueue-and-run",
  clientSubmission: {
    clientRequestId: "visual-test-42",
    source: "headless",
  },
});
```

Result:

```json
{
  "queuedMessageId": "queue_7f2",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "orchestrator",
    "surfacePiSessionId": "pi_orch_01"
  },
  "status": "queued",
  "receipt": {
    "clientRequestId": "visual-test-42",
    "outcome": "accepted",
    "acceptedAt": "2026-04-18T08:56:00.000Z",
    "stateRevision": 42
  }
}
```

## Runtime Event Contract

Runtime events are small, typed notifications. They do not carry full read models when the read
model can be fetched directly from `@svvy/state`.

```ts
type RuntimeEvent =
  | {
      type: "surface.stream";
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      streamGenerationId: SurfaceStreamGenerationId;
      streamSequence: SurfaceStreamSequence;
      patch: SurfaceStreamPatchInput;
    }
  | {
      type: "surface.changed";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      reason:
        | "surface.updated"
        | "prompt.started"
        | "prompt.settled"
        | "background.started"
        | "surface.closed";
    }
  | {
      type: "command.changed";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      workspaceId: WorkspaceId;
      workspaceSessionId: WorkspaceSessionId;
      target?: RuntimeSurfaceTarget;
      turnId?: TurnId;
      commandId: CommandId;
      change:
        | { kind: "created" }
        | { kind: "argument_snapshot" }
        | { kind: "accepted" }
        | { kind: "started" }
        | { kind: "output" }
        | { kind: "progress" }
        | { kind: "diagnostic" }
        | { kind: "patch_snapshot" }
        | { kind: "artifact_linked" }
        | { kind: "child_command" }
        | { kind: "approval" }
        | { kind: "wait" }
        | { kind: "finished" };
    }
  | {
      type: "queue.changed";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      queuedMessageId: QueueItemId;
      status: "queued" | "steering" | "dispatching" | "delivered" | "failed" | "cancelled";
    }
  | {
      type: "turn.changed";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      workspaceId: WorkspaceId;
      target: RuntimeSurfaceTarget;
      turnId: TurnId;
      status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    }
  | {
      type: "workflow_task_attempt.changed";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      workspaceId: WorkspaceId;
      target: Extract<RuntimeSurfaceTarget, { surface: "workflow-task" }>;
      workflowTaskAttemptId: WorkflowTaskAttemptId;
      status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    }
  | {
      type: "workspace_read_model.changed";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      workspaceId: WorkspaceId;
      invalidation: WorkspaceReadModelInvalidation;
    }
  | {
      type: "app_read_model.changed";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      invalidation: AppReadModelInvalidation;
    }
  | {
      type: "runtime.recovery";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      scope: "workspace";
      workspaceId: WorkspaceId;
      workId: RecoveryWorkId;
      status: "pending" | "claimed" | "blocked" | "completed" | "failed" | "cancelled";
    }
  | {
      type: "runtime.recovery";
      sequence: RuntimeEventSequence;
      eventGenerationId: RuntimeEventGenerationId;
      scope: "app";
      workId: RecoveryWorkId;
      status: "pending" | "claimed" | "blocked" | "completed" | "failed" | "cancelled";
    };

type SurfaceStreamPatchInput =
  | {
      type: "user_message_committed";
      messageId: MessageId;
      queueItemId?: QueueItemId;
      text: string;
      submittedAt: IsoDateTimeString;
    }
  | {
      type: "assistant_message_started";
      messageId: MessageId;
      turnId: TurnId;
      createdAt: IsoDateTimeString;
    }
  | {
      type: "assistant_text_delta";
      messageId: MessageId;
      contentIndex: NonNegativeSafeInteger;
      delta: string;
    }
  | {
      type: "assistant_thinking_delta";
      messageId: MessageId;
      contentIndex: NonNegativeSafeInteger;
      delta: string;
    }
  | {
      type: "tool_arguments_snapshot";
      messageId: MessageId;
      toolCallId: ToolCallId;
      commandId?: CommandId;
      snapshotRef: ToolItemId;
    }
  | {
      type: "active_command";
      messageId: MessageId;
      toolCallId: ToolCallId;
      commandId: CommandId;
      status: "accepted" | "running" | "waiting" | "finished";
    }
  | {
      type: "assistant_message_finished";
      messageId: MessageId;
      status: "completed" | "failed" | "cancelled";
      finishedAt: IsoDateTimeString;
    }
  | {
      type: "prompt_status";
      turnId: TurnId;
      status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    }
  | {
      type: "stream_reset";
      reason: "rebaseline_required" | "runtime_recovered" | "surface_reopened";
      latestStreamSequence: SurfaceStreamSequence;
    };

type WorkspaceReadModelInvalidation =
  | { model: "sessionNavigation" }
  | { model: "surface"; ids: readonly SurfacePiSessionId[] }
  | { model: "commandInspector"; ids: readonly CommandId[] }
  | { model: "handlerThreadInspector"; ids: readonly ThreadId[] }
  | { model: "workflowTaskAttemptInspector"; ids: readonly WorkflowTaskAttemptId[] }
  | { model: "requestInput"; ids: readonly RequestInputRequestId[] }
  | { model: "runtimeApprovals"; ids: readonly RuntimeApprovalId[] }
  | { model: "appLogs" }
  | { model: "snippets"; ids?: readonly SnippetId[] };

`surface` is the workspace-scoped invalidation for the complete addressed surface bundle. A
consumer that receives `{ model: "surface", ids: [...] }` refetches every open read-model slice for
that `surfacePiSessionId`: `surface`, `surfaceTranscript`, composer state, queued-message state,
prompt-history state, prompt status, and surface-local chrome. The schema deliberately does not add
separate `surfaceTranscript`, `composer`, `queue`, or `promptHistory` invalidation models because
those slices are keyed by the same surface, are commonly refreshed together after prompt/queue/turn
changes, and would otherwise create overlapping invalidation paths. State read facades may expose
separate fetch kinds for efficient reads, but the post-commit invalidation vocabulary stays
surface-keyed.

`command.changed` is the live command transport notification. It carries the command id and change
kind only; stdout/stderr chunks, progress details, diagnostics, patch snapshots, child-command
facts, approvals, waits, artifacts, and terminal facts are read from the `commandInspector` read
model. Runtime batches high-frequency command output writes into state and publishes bounded
`command.changed` notifications after commit. Slow subscribers rebaseline by refetching
`commandInspector`; runtime does not expose a second command-output delta stream as product API.

type AppReadModelInvalidation =
  | { model: "workflowsGenerated"; ids?: readonly GeneratedPackageBuildId[] }
  | { model: "agents"; ids?: readonly AgentProfileId[] }
  | { model: "extensions"; ids?: readonly ExtensionId[] }
  | { model: "settings" }
  | { model: "providerAuth"; ids?: readonly ProviderId[] }
  | { model: "appPreferences" }
  | { model: "appLogs" };

type StateInvalidationDescriptor =
  | {
      scope: "workspace";
      workspaceId: WorkspaceId;
      invalidation: WorkspaceReadModelInvalidation;
    }
  | {
      scope: "app";
      invalidation: AppReadModelInvalidation;
    };

type SourceDomain = "extensions" | "workflows" | "external_instructions" | "host_snippets";

type SourceInvalidationScope =
  | { kind: "app-global" }
  | { kind: "workspace"; workspaceId: WorkspaceId };

type SourceInvalidationHint = {
  scope: SourceInvalidationScope;
  domain: SourceDomain;
  path: AbsolutePath;
  observedAt?: IsoDateTimeString;
};

type SourceReconcileRequest = {
  scope: SourceInvalidationScope;
  domains?: readonly SourceDomain[];
  reason:
    | "startup"
    | "periodic"
    | "watcher-debounce"
    | "ignored-path-parent-domain-scan"
    | "manual"
    | "recovery";
};

type CommittedSourceInvalidationEvent = {
  domains: readonly SourceDomain[];
  reason: string;
  sourceFingerprints: Readonly<Record<SourceDomain, string>>;
  afterCommit: readonly StateInvalidationDescriptor[];
};

type ApplyCommittedSourceInvalidationEventInput = {
  scope: SourceInvalidationScope;
  event: CommittedSourceInvalidationEvent;
};

type SourceReconcileResult = {
  changedReadModelCount: NonNegativeSafeInteger;
  generatedPackageRefreshes: readonly GeneratedPackagesRefreshResult[];
  recoveryWorkIds: readonly RecoveryWorkId[];
};
```

`CommittedSourceInvalidationEvent` is a committed scan result, not a watcher hint, renderer
preview, or arbitrary invalidation payload. It contains only the domains whose deterministic
fingerprints changed, the scan reason string recorded by the coordinator, the committed source
fingerprint evidence, and the `StateInvalidationDescriptor` values returned by the state-backed
scan write. `ApplyCommittedSourceInvalidationEventInput` validates the same scope/domain pairs as
`SourceInvalidationHint` and `SourceReconcileRequest`: app-global events may target only
`extensions` and `workflows`, while workspace events may target only `external_instructions` and
`host_snippets`.

`SourceReconcileResult.changedReadModelCount` is a receipt count for committed read-model
invalidations produced during reconciliation. It is not a descriptor transport. Runtime publishes
the actual committed `StateInvalidationDescriptor` values through ordered runtime events, and
callers refetch state read models from those events or explicitly rebaseline.

Runtime event sequencing rules:

- Every event has an implementation-assigned monotonically increasing app-runtime `sequence`.
  Runtime exposes one app-wide public event stream per app `ManagedRuntime`; `workspaceId` filters
  select workspace-scoped events from that stream and app-scoped events remain visible to app-level
  subscribers. `surface.stream.sequence` is only this app-runtime notification cursor. The cursor is
  process-runtime-local, not durable across app runtime restarts. A restarted app runtime has a new
  stream generation even if numeric sequences start again, and consumers must discard prior-generation cursors,
  refetch read models, and subscribe from the current generation.
- `surface.stream.streamSequence` is the ordered live transcript patch cursor for the target surface.
  It is monotonically increasing per `surfacePiSessionId` for the current live stream generation.
  Consumers use it for gap detection while applying transient live patches; they still refetch
  durable transcript state from `@svvy/state` after a reset, recovery, or missed patch.
- `SurfaceStreamPatchInput` is a closed union owned by `@svvy/core`. The patch carries only enough
  data to update the active live transcript projection. Durable transcript, command, and inspector
  state is refetched from `@svvy/state`.
- Surface, queue, turn, and workflow-task-attempt runtime events carry the resolved `workspaceId` as
  top-level notification metadata. Callers still do not submit `workspaceId` inside
  `RuntimeSurfaceTarget`; runtime resolves it from durable state after validating the surface.
- `tool_arguments_snapshot.snapshotRef` is a durable command/tool item ref in `@svvy/state`.
  Consumers fetch the current argument snapshot through the command inspector/read-model API.
  `commandId` is optional only before runtime has accepted the tool call and allocated the command
  row; after command creation, runtime emits later argument snapshots with `commandId`.
- `active_command.status: "finished"` means the terminal command fact has committed. Consumers fetch
  the exact terminal status, summary, facts, and errors from `@svvy/state` command read models.
- `CreateRuntimeCommandInput.summary` is the stable in-progress display label committed when the
  command row is allocated. `FinishRuntimeCommandInput.summary` and `CommandResultEnvelope.summary`
  are optional terminal summaries; when supplied at settlement they replace the display summary as
  the immutable terminal command summary. They are not preview fields and must be redacted before
  persistence.
- `queue.changed` is a notification for queue-row invalidation. Queue kind, priority, ordering,
  retry, failure, and restore metadata are fetched from state read models; they are not duplicated
  on the runtime event.
- Read-model invalidation ids are typed per model through `WorkspaceReadModelInvalidation` and
  `AppReadModelInvalidation`. Reusable invalidation lists use `StateInvalidationDescriptor` so
  workspace-scoped entries carry `workspaceId` exactly once and app-scoped entries do not invent a
  workspace. Models without a narrower identity omit ids and require a model-level refetch.
- Event stream failures use a core tagged error union. `RuntimeEventRebaselineRequired` carries
  `reason`, `requestedAfterSequence`, `retainedFromSequence`, `currentHighWaterSequence`,
  `eventGenerationId`, `affectedReadModels`, and optional `workspaceId`. Consumers handle it by
  refetching affected read models and resubscribing from a valid cursor. When
  `affectedReadModels` is empty, runtime could not prove the exact missed read-model ids; consumers
  treat it as a full rebaseline for the subscription scope, not as no affected models.
- Runtime facade rejections use the core `RuntimeFacadeErrorContractSchema` union. Typed runtime failures
  are encoded as `reason: "typed-failure"` with `RuntimeContractError`; defects use redacted
  message/class fields plus optional `diagnosticAppLogEntryId`; raw `Cause`, stack traces, thrown
  objects, and foreign host errors never cross the Promise or `AsyncIterable` facade boundary.
- Runtime events never include renderer panel ids, Dockview state, Svelte component state, pi-native
  session objects, raw SQLite rows, or complete read models.

Event examples:

```json
{
  "type": "surface.stream",
  "sequence": 1,
  "eventGenerationId": "runtime_event_gen_01",
  "streamGenerationId": "surface_stream_gen_01",
  "streamSequence": 1,
  "workspaceId": "wksp_01",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "orchestrator",
    "surfacePiSessionId": "pi_orch_01"
  },
  "patch": {
    "type": "assistant_text_delta",
    "messageId": "msg_01",
    "contentIndex": 0,
    "delta": "I will inspect the transcript projection."
  }
}
```

```json
{
  "type": "command.changed",
  "sequence": 2,
  "eventGenerationId": "runtime_event_gen_01",
  "workspaceId": "wksp_01",
  "workspaceSessionId": "wsess_01",
  "commandId": "cmd_12",
  "change": {
    "kind": "finished"
  }
}
```

Consumers refetch the relevant read model after receiving a change event:

```ts
const surface = await state.readModels.fetch({
  kind: "surface",
  target,
});
const command = await state.readModels.fetch({
  kind: "commandInspector",
  commandId: "cmd_12" as CommandId,
});
```

`@svvy/core` owns the event payload and input schemas only. Effect stream delivery,
Promise/`AsyncIterable` facades, cancellation mapping, backpressure, replay, and subscriber lifetime
are owned by `@svvy/runtime`.

## Command Result And Fact Envelope

`@svvy/core` defines the command result/fact envelope used by extension handlers and runtime command
tracking.

```ts
type CommandResultEnvelope = {
  status?: CommandTerminalStatus;
  summary?: string;
  commandFacts?: CommandFactsPayload;
};

type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type NativeToolResult = {
  content?: readonly ToolResultContent[];
  details?: CommandResultEnvelope;
};
```

The public contract name is `NativeToolResult`. Public package specs, generated schemas, extension
handler signatures, pi-adapter callbacks, runtime accepted-tool results, and tests use that name
only.

`ToolResultContent` matches pi's model-facing tool-result content channel: text and base64 image
blocks only. Structured data for the model is serialized as text when needed. Structured data for
UI, logging, and state-derived command settlement belongs in `NativeToolResult.details` and typed
state/read-model records, not in a custom content variant.

`CommandFactsPayload` is a discriminated union of extension-owned, schema-backed fact payloads.
Unknown extra top-level fields in `NativeToolResult` are invalid at the svvy boundary and fail
decode. They are not forwarded to pi, stored as command facts, or treated as best-effort details.
Tool-specific extra data may cross only through declared `ToolResultContent` blocks, the declared
`details` field, or a schema-backed command-fact/read-model payload.

The initial required fact variants are:

- `exec_command.finished`
- `write_stdin.finished`
- `apply_patch.finished`
- `execute_typescript.finished`
- `request_user_input.finished`
- `list_extensions.finished`
- `load_extension.finished`
- `thread_start.finished`
- `thread_followup.finished`
- `thread_list.finished`
- `thread_current.finished`
- `thread_group.finished`
- `thread_report.finished`
- `thread_request_report.finished`
- `thread_episodes.finished`
- `svvyx_workflows.finished`
- `svvyx_artifacts.finished`
- `svvyx_extensions.finished`
- `smithers_cli.finished`

Each variant has a hoisted schema, a stable `type` discriminant, command-family-specific fields,
redacted output summaries, and typed related ids. A new command family must add a fact schema before
its facts can be persisted or projected in the command inspector.
`smithers_cli.finished` is emitted only from classified Shell `exec_command` runs of the checked
official Smithers CLI binary. It records observed CLI command facts for projection and debugging; it
does not create a native Smithers tool, `svvyx smithers` command family, generated Smithers facade,
workflow-control API, or runtime wrapper around Smithers state.

`CommandFactsPayload` is a closed discriminated union of the fact schemas above. It must not decode
as `unknown`, generic `Record<string, unknown>`, or command-family-specific ad hoc JSON. Every
variant has at least one positive JSON example and one negative JSON example in core tests.

Extraction rules:

- A pi/tool execution callback with `isError: true` maps to final command status `failed`.
- Otherwise, if `details.status` is present, that status is the final command status.
- Otherwise, the final command status is `succeeded`.
- Final command facts are `details.commandFacts` only when that property decodes through the
  registered schema for the command family.
- If `details.commandFacts` is absent, final command facts are empty unless the owning extension
  handler produced a typed fact payload through another explicit command contract.
- Some commands are completed by applying a `RuntimeEffectRequest` whose final facts include
  runtime-owned transaction results. For those commands the handler result envelope may omit
  `commandFacts`; after the effect commits, runtime completes the current command with the
  family-specific fact payload defined by that effect's completion contract. Runtime-completed facts
  are not preview fields and are persisted only after the state transaction commits. Internal ids
  that can be read from request, queue, thread, artifact, or generated-package read models must stay
  out of final command facts unless the command family's stable projection explicitly requires them.
  Initial contracts are:
  - `handler_thread.start` completes `thread_start.finished` with `threadGroupId`,
    created `threadIds`, created `surfacePiSessionIds`, and queued initial handler rows.
  - `request_input.create` completes `request_user_input.finished` with the delivered
    `RequestUserInputResult`, question count, and `answeredBy` source. Created request ids, question
    ids, answer ids, mode, target, wait rows, timeout metadata, and queue ids are request-input,
    queue, command-event, or inspector/read-model state.
  - `generated_packages.refresh` completes the owning command family with generated package build,
    link, diagnostic, and scheduled recovery facts.
- `Error.message` is never parsed as JSON for status or fact extraction. Only explicit
  `details.status`, `details.commandFacts`, typed extension handler results, or typed
  `RuntimeEffectRequest` completion payloads may drive terminal status or facts, and every fact
  payload must decode through the registered command-family schema after redaction. `Error.message`
  maps only to the redacted stored error message/detail fields.
- Terminal command status, summary, facts, error, and finished timestamp are immutable after
  `succeeded`, `failed`, or `cancelled`.

This envelope gives `@svvy/extensions` a typed target to
return and `@svvy/runtime` a deterministic extraction contract.

`CommandResultEnvelope` does not carry canonical stdout or stderr. Agent-visible tool output belongs
in `NativeToolResult.content`; durable output belongs in `CommandOutputEventPayload` rows and
command-inspector read models. Handlers that need to summarize output may put a short redacted
sentence in `summary` or a schema-backed fact field.
`CommandResultEnvelopeSchema` contains only `status`, `summary`, and `commandFacts`; `stdout` and
`stderr` are invalid. `NativeToolResultSchema.details` is optional and, when present, decodes
through `CommandResultEnvelopeSchema`. Unknown top-level result fields and unknown `details` fields
fail the svvy boundary decode.

Rejected:

```json
{
  "details": {
    "stdout": "full stdout belongs in command output events"
  }
}
```

## Command Event Payloads

`@svvy/core` owns the promoted command-event kind and payload vocabulary used by runtime command
tracking and state persistence. `@svvy/state` appends and decodes these payloads through
`RecordRuntimeCommandEventInputSchema`; `@svvy/runtime` publishes `command.changed` notifications
after commits; the UI refetches command read models instead of treating command events as complete
renderer snapshots.

The state row `kind` is the event discriminator. Payload records do not duplicate a `type` field.
The promoted persisted event kinds are exactly:

- `command.arg_snapshot`
- `command.diagnostics`
- `command.output`
- `command.patch_snapshot`
- `command.progress`

```ts
type CommandEvent =
  | { kind: "command.arg_snapshot"; payload: CommandArgumentSnapshotEventPayload }
  | { kind: "command.diagnostics"; payload: CommandDiagnosticEventPayload }
  | { kind: "command.output"; payload: CommandOutputEventPayload }
  | { kind: "command.patch_snapshot"; payload: CommandPatchSnapshotEventPayload }
  | { kind: "command.progress"; payload: CommandProgressEventPayload };

type CommandEventPayload =
  | CommandArgumentSnapshotEventPayload
  | CommandDiagnosticEventPayload
  | CommandOutputEventPayload
  | CommandPatchSnapshotEventPayload
  | CommandProgressEventPayload;

type CommandArgumentSnapshotEventPayload = {
  source?: string;
  arguments: JsonValue;
  facts?: CommandFactsPayload;
};

type CommandOutputEventPayload = {
  stream: "stdout" | "stderr";
  source?: string;
  chunkRef?: ToolItemId;
  text?: string;
  truncated?: boolean;
};

type CommandProgressEventPayload = {
  source: string;
  phase?: string;
  family?: string;
  command?: string;
  message?: string;
  progress?: number;
  facts?: CommandFactsPayload;
};

type CommandDiagnosticEventPayload = {
  source?: string;
  stage?: string;
  diagnostics: CommandDiagnostic[];
};

type CommandDiagnostic = {
  severity?: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
};

type CommandPatchSnapshotEventPayload = {
  source?: string;
  files: CommandPatchSnapshotFile[];
};

type CommandPatchSnapshotFile = {
  path: string;
  changeType: "created" | "deleted" | "modified";
  additions: number;
  deletions: number;
};
```

Output text is optional because large chunks may be stored as durable item refs and fetched through
the inspector. Patch snapshots, argument snapshots, and output chunks may use refs or structured
payload fields for current read-model needs instead of embedding complete renderer snapshots in
runtime events. Command events never include pi-native callback objects, renderer panel ids, full
transcript rows, or unredacted secret-bearing output.

## RuntimeEffectRequest Algebra

`@svvy/core` defines the closed declarative `RuntimeEffectRequest` algebra used by extension
handlers. `@svvy/extensions` may produce these requests. `@svvy/runtime` is the only package that may
apply them.

```ts
type RuntimeEffectRequest =
  | { type: "handler_thread.start"; input: StartHandlerThreadRequest }
  | { type: "queue.insert"; input: InsertQueueItemRequest }
  | { type: "actor_extension_binding.update"; input: UpdateActorExtensionBindingRequest }
  | { type: "episode.record"; input: RecordEpisodeRequest }
  | { type: "request_input.create"; input: CreateRequestInputRequest }
  | { type: "generated_context.refresh"; input: RefreshGeneratedContextRequest }
  | { type: "generated_packages.refresh"; input: RefreshGeneratedPackagesRequest };
```

`@svvy/core` exports the runtime-effect request schema and hoisted codecs by these exact names:

```ts
export const RuntimeEffectRequestSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("handler_thread.start"),
    input: StartHandlerThreadRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("queue.insert"),
    input: InsertQueueItemRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("actor_extension_binding.update"),
    input: UpdateActorExtensionBindingRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("episode.record"),
    input: RecordEpisodeRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("request_input.create"),
    input: CreateRequestInputRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("generated_context.refresh"),
    input: RefreshGeneratedContextRequestSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("generated_packages.refresh"),
    input: InternalRefreshGeneratedPackagesRequestSchema,
  }),
]);

export type RuntimeEffectRequest = typeof RuntimeEffectRequestSchema.Type;
export const unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap = Schema.decodeUnknownSync(
  RuntimeEffectRequestSchema,
  {
    onExcessProperty: "error",
    errors: "all",
  },
);
export const decodeUnknownRuntimeEffectRequestExit = Schema.decodeUnknownExit(
  RuntimeEffectRequestSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownRuntimeEffectRequestEffect = Schema.decodeUnknownEffect(
  RuntimeEffectRequestSchema,
  strictBoundaryParseOptions,
);
export const encodeRuntimeEffectRequestExit = Schema.encodeExit(
  RuntimeEffectRequestSchema,
  strictBoundaryParseOptions,
);
export const encodeRuntimeEffectRequestEffect = Schema.encodeEffect(
  RuntimeEffectRequestSchema,
  strictBoundaryParseOptions,
);
```

These helpers are the only supported package-boundary codecs for extension-produced runtime-effect
requests. Runtime and extension packages must use the Effect or `Exit` decoder/encoder according to
their boundary and must not inline-compile their own equivalent `RuntimeEffectRequest` codecs in hot
paths. The sync decoder is intentionally named
`unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap` and is limited to tests, trusted
bootstrap, and local assertions; production package boundaries use
`decodeUnknownRuntimeEffectRequestEffect` or `decodeUnknownRuntimeEffectRequestExit` and map
failures into the owning tagged error.
The per-variant runtime-effect input schemas named by this section are public construction and
validation contracts because extension handlers produce them directly:
`StartHandlerThreadRequestSchema`, `InsertQueueItemRequestSchema`,
`UpdateActorExtensionBindingRequestSchema`, `RecordEpisodeRequestSchema`,
`CreateRequestInputRequestSchema`, `RefreshGeneratedContextRequestSchema`, and
`RefreshGeneratedPackagesRequestSchema`. Each one exports a derived TypeScript type and the same
decode/encode quartet required for public boundary schemas. The wrapper object schemas for each
union arm are package-private implementation details unless a spec section gives them a public name.
Runtime and extension packages must import the named input schemas/types instead of duplicating
variant-specific inline objects.

Signed `svvyx` runtime-effect transport intents are a separate trusted subprocess result contract,
not normal extension-returned `RuntimeEffectRequest` values and not a public runtime subpath.
`@svvy/core` owns that transport contract by these exact names:

```ts
type SvvyxRuntimeEffectTransportRequest =
  | {
      type: "extension_usage.context_impact";
      target: "extension_usage" | "extension_usage_revert";
      input: {
        agentProfile: string;
        profileId: AgentProfileId;
      };
    }
  | {
      type: "extension_snapshot.context_impact";
      target: "snapshot_load";
      input: {
        affectedExtensionIds: ExtensionId[];
        affectedUsageProfiles: Array<`orchestrator:${string}` | "handler:threadHandler">;
        removedUserExtensionIds: ExtensionId[];
      };
    };

type SvvyxRuntimeEffectTransportIntent = {
  id: string;
  kind: "runtime_effect.request";
  request: SvvyxRuntimeEffectTransportRequest;
};

export const RuntimeExtensionUsageContextImpactTransportInputSchema = Schema.Struct({
  agentProfile: Schema.String.check(Schema.isNonEmpty()),
  profileId: AgentProfileId,
});
export type RuntimeExtensionUsageContextImpactTransportInput =
  typeof RuntimeExtensionUsageContextImpactTransportInputSchema.Type;

export const RuntimeExtensionUsageProfileKeyTransportSchema = Schema.Union([
  Schema.TemplateLiteral(["orchestrator:", Schema.String.check(Schema.isNonEmpty())]),
  Schema.Literal("handler:threadHandler"),
]);
export type RuntimeExtensionUsageProfileKeyTransport =
  typeof RuntimeExtensionUsageProfileKeyTransportSchema.Type;

export const RuntimeExtensionSnapshotContextImpactTransportInputSchema = Schema.Struct({
  affectedExtensionIds: Schema.Array(ExtensionId),
  affectedUsageProfiles: Schema.Array(RuntimeExtensionUsageProfileKeyTransportSchema),
  removedUserExtensionIds: Schema.Array(ExtensionId),
});
export type RuntimeExtensionSnapshotContextImpactTransportInput =
  typeof RuntimeExtensionSnapshotContextImpactTransportInputSchema.Type;

export const SvvyxRuntimeEffectTransportRequestSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("extension_usage.context_impact"),
    target: Schema.Literals(["extension_usage", "extension_usage_revert"]),
    input: RuntimeExtensionUsageContextImpactTransportInputSchema,
  }),
  Schema.Struct({
    type: Schema.Literal("extension_snapshot.context_impact"),
    target: Schema.Literal("snapshot_load"),
    input: RuntimeExtensionSnapshotContextImpactTransportInputSchema,
  }),
]);
export type SvvyxRuntimeEffectTransportRequest =
  typeof SvvyxRuntimeEffectTransportRequestSchema.Type;

export const SvvyxRuntimeEffectTransportIntentSchema = Schema.Struct({
  id: Schema.String.check(Schema.isNonEmpty()),
  kind: Schema.Literal("runtime_effect.request"),
  request: SvvyxRuntimeEffectTransportRequestSchema,
});
export type SvvyxRuntimeEffectTransportIntent = typeof SvvyxRuntimeEffectTransportIntentSchema.Type;

export const decodeUnknownSvvyxRuntimeEffectTransportIntentExit = Schema.decodeUnknownExit(
  SvvyxRuntimeEffectTransportIntentSchema,
  strictBoundaryParseOptions,
);
export const decodeUnknownSvvyxRuntimeEffectTransportIntentEffect = Schema.decodeUnknownEffect(
  SvvyxRuntimeEffectTransportIntentSchema,
  strictBoundaryParseOptions,
);
export const encodeSvvyxRuntimeEffectTransportIntentExit = Schema.encodeExit(
  SvvyxRuntimeEffectTransportIntentSchema,
  strictBoundaryParseOptions,
);
export const encodeSvvyxRuntimeEffectTransportIntentEffect = Schema.encodeEffect(
  SvvyxRuntimeEffectTransportIntentSchema,
  strictBoundaryParseOptions,
);
```

Trusted `svvyx` subprocesses return one signed JSON envelope. The signed result payload is
structured data only; it never carries raw stdout/stderr streams. Runtime-owned command sessions
record stdout/stderr as command output facts from the child-process pipes.

```ts
export const HmacSha256Digest = Schema.String.check(
  Schema.isPattern(/^hmac-sha256:base64url:[A-Za-z0-9_-]{43}$/),
);
export type HmacSha256Digest = typeof HmacSha256Digest.Type;

type SignedSvvyxSubprocessResult = {
  envelopeVersion: 1;
  invocationId: ExtensionInvocationId;
  commandId: CommandId;
  extensionId: ExtensionId;
  createdAt: IsoDateTimeString;
  payload: {
    status: "succeeded" | "failed";
    output?: JsonValue;
    commandFacts?: CommandFactsPayload;
    intents?: readonly SvvyxRuntimeEffectTransportIntent[];
    progressEvents?: readonly {
      family: "artifacts" | "extensions" | "workflows" | "runtime";
      phase: "started" | "succeeded" | "failed";
      facts?: JsonObject;
    }[];
    diagnostics?: readonly string[];
  };
  signature: {
    algorithm: "hmac-sha256";
    keyId: string;
    digest: HmacSha256Digest;
  };
};

export const SignedSvvyxSubprocessResultSchema = Schema.Struct({
  envelopeVersion: Schema.Literal(1),
  invocationId: ExtensionInvocationId,
  commandId: CommandId,
  extensionId: ExtensionId,
  createdAt: IsoDateTimeString,
  payload: Schema.Struct({
    status: Schema.Literals(["succeeded", "failed"]),
    output: Schema.optionalKey(JsonValueSchema),
    commandFacts: Schema.optionalKey(CommandFactsPayloadSchema),
    intents: Schema.optionalKey(Schema.Array(SvvyxRuntimeEffectTransportIntentSchema)),
    progressEvents: Schema.optionalKey(
      Schema.Array(
        Schema.Struct({
          family: Schema.Literals(["artifacts", "extensions", "workflows", "runtime"]),
          phase: Schema.Literals(["started", "succeeded", "failed"]),
          facts: Schema.optionalKey(JsonObjectSchema),
        }),
      ),
    ),
    diagnostics: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  signature: Schema.Struct({
    algorithm: Schema.Literal("hmac-sha256"),
    keyId: Schema.String.check(Schema.isNonEmpty()),
    digest: HmacSha256Digest,
  }),
});
export type SignedSvvyxSubprocessResult = typeof SignedSvvyxSubprocessResultSchema.Type;
```

The signature material is the UTF-8 bytes of the RFC 8785 JSON Canonicalization Scheme
representation of exactly `{ envelopeVersion, invocationId, commandId, extensionId, createdAt,
payload }` after that object encodes through
`SignedSvvyxSubprocessResultSignatureMaterialSchema`. Object keys are recursively sorted by the
canonicalization algorithm, no whitespace is emitted, and `signature` is excluded. The digest is the
unpadded base64url encoding of the 32-byte HMAC-SHA256 output prefixed as
`hmac-sha256:base64url:`. Parent validation rejects envelopes whose digest does not match that
material, whose `signature.algorithm` is not `"hmac-sha256"`, or whose `signature.keyId` does not
match the parent-issued invocation key id.

The transport schema covers exactly context-impact replay for trusted `svvyx extensions` commands
whose child process cannot open product state. It does not encode the full profile or snapshot state
mutation. Adding another transport request requires the same package-boundary evidence: a core
schema/codec, parent runtime-owned replay, signed-result validation tests, and no duplicate
best-effort Bun decoder.

## ExtensionExecutionPlan Algebra

`@svvy/core` defines the closed persistable `ExtensionExecutionPlan` algebra used by extension
handlers when the useful work must be executed by `@svvy/runtime` after the handler returns. These
plans are data contracts only: they describe runtime-owned execution work and do not contain open
process handles, callbacks, `AbortController`s, renderer ids, mutable env maps, raw secrets, or
runtime-created command/approval/sandbox facts.

```ts
type ExtensionExecutionPlan =
  | {
      type: "child_process.command";
      planId: ExtensionExecutionPlanId;
      commandFamily: "shell" | "execute_typescript" | "svvyx";
      command: {
        argv: readonly string[];
      };
      cwd: AbsolutePath;
      env: {
        extensionId: ExtensionId;
        nonSecretValues: Readonly<Record<string, string>>;
        secretKeyNames: readonly string[];
        redactedLabels: Readonly<Record<string, string>>;
        secretRevisionFingerprint: string;
      };
      stdin: "none" | "continuable";
    }
  | {
      type: "file_effect.apply_patch";
      planId: ExtensionExecutionPlanId;
      patch: string;
      cwd: AbsolutePath;
    };
```

Non-secret extension execution env plans are core-owned because `@svvy/extensions`,
`@svvy/runtime`, and `@svvy/state` exchange this plan inside execution-plan payloads:

```ts
type ExtensionExecutionEnvPlan = {
  extensionId: ExtensionId;
  nonSecretValues: Readonly<Record<string, string>>;
  secretKeyNames: readonly string[];
  redactedLabels: Readonly<Record<string, string>>;
  secretRevisionFingerprint: string;
};
```

`ExtensionExecutionEnvPlan` is non-secret and may be persisted as readiness evidence or command
facts. It never contains raw secret values, readiness preview fields, duplicated requirement rows, or
raw environment facts that can be read from the extension/source and state-owned readiness records.
Secret-bearing invocation snapshots are process-local implementation details of `@svvy/extensions`
and must not be exported from `@svvy/core`, persisted in `@svvy/state`, included in generated
context, or sent through renderer/browser-tool bridges.

`@svvy/core` exports the execution-plan schema, variant schemas, supporting schemas, and hoisted
strict decoders by these exact names:

- `ExtensionExecutionPlanId`
- `ExtensionExecutionPlanSchema`, `ExtensionExecutionPlan`
- `ChildProcessCommandExecutionPlanSchema`, `ChildProcessCommandExecutionPlan`
- `FileEffectApplyPatchExecutionPlanSchema`, `FileEffectApplyPatchExecutionPlan`
- `ExtensionExecutionCommandDescriptionSchema`, `ExtensionExecutionCommandDescription`
- `ExtensionExecutionEnvPlanSchema`, `ExtensionExecutionEnvPlan`
- `unsafeDecodeExtensionExecutionPlanSyncForTestsAndBootstrap`,
  `decodeUnknownExtensionExecutionPlanExit`, `decodeUnknownExtensionExecutionPlanEffect`,
  `encodeExtensionExecutionPlanExit`, and `encodeExtensionExecutionPlanEffect`, all built from
  `ExtensionExecutionPlanSchema` with the core boundary parse options
  `{ onExcessProperty: "error", errors: "all" }`

The execution-plan union is closed to the two variants above. Runtime decodes every
handler-returned `execution_plan` with `ExtensionExecutionPlanSchema` before side effects. Unknown
plan kinds, unsupported variants, excess fields, or dependency install/update plans returned through
handler operations are rejected as typed runtime/command contract failures and recorded in command
facts where the owning command envelope already exists. Extension dependency install/update is not
represented as a handler-returned execution-plan operation item and has no public
runtime API. No public dependency-action API exists. Adding one requires the complete runtime-owned
lifecycle contract, schemas, implementation, state/package contracts, public error mapping, and
tests.

The prompt-cancellation contract also exports its variant schemas by exact name:
`AbortQueuedPromptInputSchema`, `AbortActiveTurnPromptInputSchema`, and
`AbortAllForSurfacePromptInputSchema`. `AbortPromptInputSchema` is only the union of those variants;
it does not accept an untagged payload with optional `queuedMessageId` or `turnId`.

```ts
type StartHandlerThreadRequest = {
  workspaceSessionId: WorkspaceSessionId;
  threadGroupId?: ThreadGroupId;
  sourceCommandId: CommandId;
  threads: readonly StartHandlerThreadItem[];
};

type ExtensionAvailabilityOverrides = {
  readonly [extensionId in ExtensionId]?: "loaded" | "available" | "unavailable";
};

type StartHandlerThreadItem = {
  objective: string;
  worktreeId?: WorktreeId;
  history?: "isolated" | "forked";
  overrides?: ExtensionAvailabilityOverrides;
  initialQueue?: {
    idempotencyKey?: string;
    priority?: "interactive" | "runtime" | "background";
    notBefore?: IsoDateTimeString;
  };
};
```

`handler_thread.start` is the atomic extension-to-runtime request used by `thread_start`.
`threads` contains one item for ordinary delegation. Multiple items are allowed only for separate
user-visible handler conversations that should share one durable thread group and may need
independent follow-up. Runtime rejects an empty `threads` array.

Runtime enriches this intent before it reaches state. It allocates or receives handler pi surface
ids through `@svvy/pi-adapter`, resolves the handler actor profile from the app-owned singleton
`threadHandler` profile plus each item's `overrides`, builds the exact generated handler context,
derives missing queue idempotency keys from `sourceCommandId`, thread index, and objective
fingerprint, and composes any forked-history initial queue payload. Extension handlers cannot submit
`actorProfileId`, generated-context text, pi session references, queue payload JSON, or arbitrary
profile rows.

The state-backed commit uses `RuntimeThreadStatePort.startHandlerThreads(...)`. That port receives
only runtime-prepared facts and commits one transaction containing handler-thread rows,
generated-context binding rows, and one `initial_handler_start` queue row per thread. It stores
`sourceCommandId` on each initial queue row and treats successful replay of the same
`sourceCommandId` as idempotent. Runtime publishes notifications and wakes target queues only after
that commit. `surface.create` is not an extension-returned runtime effect. Handler-thread surfaces
are created only through `handler_thread.start`; workflow-task surfaces are created only by the
runtime-owned workflow task-agent bridge. Extension handlers must not split new-surface work into
separate surface and queue requests because that would leave handler records, generated-context
binding rows, and initial queue rows non-atomic.

Rejected handler thread item:

```json
{
  "objective": "Investigate the issue",
  "actorProfileId": "profile_handler_custom"
}
```

```ts
type InsertQueueItemRequest =
  | HandlerControlQueueInsertRequest
  | OrchestratorControlQueueInsertRequest
  | RequestInputAnswerQueueInsertRequest
  | {
      target: WorkflowTaskRuntimeSurfaceTarget;
      kind: "workflow_task_agent_start";
      payload: Extract<QueueItemPayload, { kind: "workflow_task_agent_start" }>;
      priority?: "interactive" | "runtime" | "background";
      idempotencyKey: string;
      sourceCommandId: CommandId;
      notBefore?: IsoDateTimeString;
    };

type HandlerControlQueueItemKind = "initial_handler_start" | "thread_followup" | "report_request";

type HandlerControlQueueInsertRequest = {
  [K in HandlerControlQueueItemKind]: {
    target: PromptTarget & { surface: "handler" };
    kind: K;
    payload: Extract<QueueItemPayload, { kind: K }>;
    priority?: "interactive" | "runtime" | "background";
    idempotencyKey: string;
    sourceCommandId?: CommandId;
    notBefore?: IsoDateTimeString;
  };
}[HandlerControlQueueItemKind];

type OrchestratorControlQueueInsertRequest = {
  target: PromptTarget & { surface: "orchestrator" };
  kind: "thread_report_notification";
  payload: Extract<QueueItemPayload, { kind: "thread_report_notification" }>;
  priority?: "interactive" | "runtime" | "background";
  idempotencyKey: string;
  sourceCommandId: CommandId;
  notBefore?: IsoDateTimeString;
};

type RequestInputAnswerQueueInsertRequest = {
  target: RuntimeSurfaceTarget;
  kind: "request_user_input_answer";
  payload: Extract<QueueItemPayload, { kind: "request_user_input_answer" }>;
  priority?: "interactive" | "runtime" | "background";
  idempotencyKey: string;
  sourceCommandId?: CommandId;
  notBefore?: IsoDateTimeString;
};

type WorkflowTaskRuntimeSurfaceTarget = Extract<RuntimeSurfaceTarget, { surface: "workflow-task" }>;
```

`InsertQueueItemRequest.kind` and `InsertQueueItemRequest.payload.kind` must match exactly. Ordinary
`user_message` queue rows are created only by `runtime.messages.submit(...)`, edit/resend runtime
APIs, or runtime-internal recovery paths. Extension-produced `ExtensionRuntimeOperation` items
wrapping `RuntimeEffectRequest` values must not enqueue ordinary user messages.
`workflow_task_agent_start` rows require a
`WorkflowTaskRuntimeSurfaceTarget` and row-level `sourceCommandId`. Handler control work targets a
handler surface, report notifications target an orchestrator surface, and nonblocking
request-input answer queue rows target the runtime surface that owns the request-input wait,
including workflow-task surfaces when the request was created by a workflow task-agent attempt.

`queue.steer` is not a `RuntimeEffectRequest` variant. Steering is exposed only through
`Runtime.queues.steer(...)` for user, desktop, browser-tool, headless, and test actions over an
existing queued row. Extension handlers and runtime effect appliers that need urgent delivery create
typed queue rows with explicit `priority`, `notBefore`, and idempotency facts through
`queue.insert`; runtime/state derive the durable `orderingKey` from the target surface and row kind
at enqueue time. Extension handlers and runtime effect request producers do not submit
`orderingKey` and do not mutate an already-created row's steer state through `RuntimeEffectRequest`.

`workflow_task_agent_start` payloads do not carry a caller-supplied `threadId`. Runtime resolves the
workflow-task surface `threadId` from the validated row-level `sourceCommandId`: the source command
must belong to a handler-thread surface in the same `workspaceSessionId`. If that lineage cannot be
proven, runtime rejects the bridge request before surface creation or queue insertion.

Rejected extension-produced queue insert:

```json
{
  "type": "queue.insert",
  "input": {
    "kind": "user_message",
    "payload": {
      "kind": "user_message",
      "message": { "text": "Ordinary user prompt" }
    }
  }
}
```

```ts
type CommandTerminalStatus = "succeeded" | "failed" | "cancelled";
type EpisodeOutcome = "completed" | "failed" | "blocked" | "cancelled";
type ThreadReportOutcome = EpisodeOutcome;
```

`ThreadReportOutcome` is the semantic outcome supplied by `thread_report` for the delegated
objective and stored on the conclusion episode. The command-level success or failure of the
`thread_report` tool invocation remains `CommandTerminalStatus` on `thread_report.finished` command
facts.

`RuntimeEffectRequest` values produced by extension handlers do not carry caller-provided `workspaceId`
when the target or `workspaceSessionId` already identifies the workspace. `@svvy/runtime` derives
`workspaceId` from validated state in the same transaction that applies the request. Extension code
may receive a runtime-derived `workspaceId` in command invocation context for diagnostics and
command facts, but it must not become a second identity source for surface creation, queue
insertion, or episode recording.

`RuntimeEffectRequest` values may carry `workspaceId` only for app/workspace-wide work that is not
derivable from a concrete runtime surface target, such as generated-context scans for a workspace
that has no active surface. Target-scoped requests use `scope: "target"` with `target`; workspace
scan requests use `scope: "workspace"` with `workspaceId`. Requests that provide both target and
workspace identities are rejected at the schema boundary.

```ts
type ValidatedTaskAgentParameters = {
  id: string;
  label: string;
  provider: string;
  model: string;
  reasoning: ReasoningSelection;
  instructions: string;
  overrides?: ExtensionUsageOverrideMap;
};

type ExtensionUsageOverrideMap = {
  readonly [extensionId: string]: ExtensionUsageState;
};
```

`ValidatedTaskAgentParameters` is runtime-owned validated data. Generated `@svvyx/workflows`
exports use `TaskAgentParametersSource` with generated-package string ids, then the `runTaskAgent`
bridge validates those source records into `ValidatedTaskAgentParameters` before queue insertion or
generated-context binding. The validated bridge payload intentionally preserves the generated-package
field names `provider`, `model`, and `overrides`; runtime validates those strings against
pi-normalized provider/model metadata, the current extension registry, generated `@svvyx/extensions`
usage state, and actor eligibility rules before they influence task-attempt creation, prompt
binding, or pi-adapter handoff.

```ts
type SmithersObservedJson =
  | null
  | boolean
  | number
  | string
  | readonly SmithersObservedJson[]
  | { readonly [key: string]: SmithersObservedJson };

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

type QueueItemPayload =
  | {
      kind: "user_message";
      message: RuntimeSubmittedMessage;
      clientSubmission?: RuntimeClientSubmission;
    }
  | {
      kind: "initial_handler_start";
      threadId: ThreadId;
      threadGroupId: ThreadGroupId;
      objective: string;
      inheritedHistory?: HandlerInheritedHistoryBlock;
      worktreeId?: WorktreeId;
      overrides?: ExtensionAvailabilityOverrides;
    }
  | {
      kind: "thread_followup";
      threadIds?: readonly ThreadId[];
      threadGroupId?: ThreadGroupId;
      message: string;
      sender: "user" | "orchestrator" | "runtime";
      activate?: boolean;
    }
  | {
      kind: "report_request";
      threadId?: ThreadId;
      threadGroupId?: ThreadGroupId;
      reason?: string;
      expectedEpisodeKind: "report";
    }
  | {
      kind: "thread_report_notification";
      sourceThreadId: ThreadId;
      episodeId: EpisodeId;
      notificationKind: "update" | "conclusion";
    }
  | {
      kind: "request_user_input_answer";
      requestId: RequestInputRequestId;
      questionId: RequestInputQuestionId;
      answerId: RequestInputAnswerId;
      delivery: RuntimeMessageDelivery;
    }
  | {
      kind: "workflow_task_agent_start";
      workflowTaskAttemptId: WorkflowTaskAttemptId;
      taskIdentity: {
        runId: string;
        nodeId: string;
        iteration: number;
        attempt: number;
      };
      smithersContext?: {
        run?: SmithersObservedJson;
        node?: SmithersObservedJson;
        rootDir?: AbsolutePath;
      };
      agent: ValidatedTaskAgentParameters;
      promptSource:
        | { kind: "prompt"; prompt: NonEmptyString }
        | {
            kind: "messages";
            messages: NonEmptyReadonlyArray<{ role: "user" | "assistant"; text: string }>;
          };
    };

type HandlerInheritedHistoryBlock = {
  mode: "forked";
  sourceSurfacePiSessionId: SurfacePiSessionId;
  sourceTurnId?: TurnId;
  summary: string;
  includedMessageIds: readonly MessageId[];
};

type UpdateActorExtensionBindingRequest = {
  target: PromptTarget;
  extensionId: ExtensionId;
  usage: "loaded" | "available" | "unavailable";
  reason: "load_extension" | "user-profile-edit" | "composer-control" | "source-refresh";
  sourceCommandId?: CommandId;
};

type RecordEpisodeRequest = {
  scope: "handler-thread";
  workspaceSessionId: WorkspaceSessionId;
  threadId: ThreadId;
  threadGroupId: ThreadGroupId;
  sourceCommandId?: CommandId;
  kind: "change" | "clarification" | "report" | "handoff" | "conclusion";
  summary: string;
  body?: string;
  outcome?: EpisodeOutcome;
  relatedCommandIds?: readonly CommandId[];
  relatedArtifactIds?: readonly ArtifactId[];
  relatedWorkflowRunIds?: readonly WorkflowRunId[];
  notifyOrchestrator?: boolean;
};

type CreateRequestInputRequest = {
  target: PromptTarget;
  sourceCommandId: CommandId;
  mode: "nonblocking" | "blocking";
  timeout?: null | {
    enabled: boolean;
    durationMs: PositiveDurationMs;
  };
  questions: readonly RequestInputQuestionRequest[];
};

`CreateRequestInputRequest.timeout.durationMs` is decoded by `PositiveDurationMsSchema`. Disabled
timeout uses `timeout: null` or `{ enabled: false }`; it never uses `0`, `NaN`, `Infinity`, a
fractional value, or an omitted duration on an enabled timeout.

type RequestInputQuestionRequest =
  | RequestInputChoiceQuestionRequest
  | RequestInputFreeformQuestionRequest;

type RequestInputChoiceQuestionRequest = {
  title: string;
  question: string;
  options: readonly RequestInputChoiceOptionRequest[];
};

type RequestInputChoiceOptionRequest = {
  label: string;
  description: string;
  recommended?: true;
};

type RequestInputFreeformQuestionRequest = {
  title: string;
  question: string;
  defaultAnswer: string;
};

type RequestUserInputAnswerQueuePayload = {
  kind: "request_user_input_answer";
  requestId: RequestInputRequestId;
  questionId: RequestInputQuestionId;
  answerId: RequestInputAnswerId;
  delivery: RuntimeMessageDelivery;
};

// RequestUserInputAnswerQueuePayload is only for nonblocking answer delivery. Blocking answers
// record the answer and resolve the waiting command directly without creating a queue row.
type RequestUserInputAnswerDeliveryPayload = {
  type: "request_user_input.answer";
  title: string;
  question: string;
  originalAnswer: RequestUserInputResolvedAnswer;
  userAnswer: RequestUserInputResolvedAnswer;
};

type RequestInputSubmittedAnswer =
  | { kind: "option"; optionId: RequestInputOptionId }
  | { kind: "custom"; text: string };

type RequestUserInputResolvedAnswer =
  | { kind: "option"; label: string; text: string }
  | { kind: "custom"; text: string };

// RequestInputSubmittedAnswer is the user/UI submitted answer shape for runtime.answerRequestInput:
// option answers point at a generated option id. RequestUserInputResolvedAnswer is the model-facing
// result, default answer, durable answer value, and delivery payload shape: option answers are
// resolved to label/text and never expose option ids.

type RefreshGeneratedContextRequest =
  | {
      scope: "target";
      target: RuntimeSurfaceTarget;
      actorKind?: ActorKind;
      reason:
        | "extension-source-changed"
        | "external-instruction-changed"
        | "profile-settings-changed"
        | "load-extension"
        | "startup-recovery";
      sourceCommandId?: CommandId;
      refreshBoundSurfaceBeforeNextTurn?: boolean;
    }
  | {
      scope: "workspace";
      workspaceId: WorkspaceId;
      actorKind?: ActorKind;
      reason:
        | "extension-source-changed"
        | "external-instruction-changed"
        | "profile-settings-changed"
        | "startup-recovery";
      sourceCommandId?: CommandId;
    };

type GeneratedPackageName = "@svvyx/workflows" | "@svvyx/extensions";

type GeneratedPackageBuildInput = {
  packages: ReadonlyArray<GeneratedPackageName>;
};

type RefreshGeneratedPackagesRequest = {
  scope: "app-global";
  packages: ReadonlyArray<GeneratedPackageName>;
  reason: "source-changed" | "explicit-build" | "snapshot-restore" | "startup-recovery";
  sourceCommandId?: CommandId;
  recoveryWorkId?: RecoveryWorkId;
};

type InternalRefreshGeneratedPackagesRequest =
  | RefreshGeneratedPackagesRequest
  | {
      scope: "workspace-link-repair";
      workspaceId: WorkspaceId;
      packages: ReadonlyArray<GeneratedPackageName>;
      reason: "link-repair" | "explicit-build" | "startup-recovery";
      sourceCommandId?: CommandId;
      recoveryWorkId?: RecoveryWorkId;
    };

type GeneratedPackagesRefreshResult =
  | {
      scope: "app-global";
      packages: readonly GeneratedPackageBuildStatus[];
      workspaceLinks: readonly [];
      recoveryWorkIds: readonly RecoveryWorkId[];
    }
  | {
      scope: "workspace-link-repair";
      packages: readonly [];
      workspaceLinks: readonly GeneratedPackageWorkspaceLinkStatus[];
      recoveryWorkIds: readonly RecoveryWorkId[];
    };

type GeneratedPackageBuildPlanResult = {
  packages: readonly GeneratedPackageBuildStatus[];
  workflowsExports: readonly GeneratedWorkflowsExportBuildEvidence[];
};

// Link repair is deliberately separate from app-global build. Build input has no workspace id, so
// build results cannot contain workspace-specific link paths or applied link statuses.

type GeneratedPackageWorkspaceLinkRepairInput = {
  workspaceId: WorkspaceId;
  packageName: GeneratedPackageName;
};

type GeneratedPackageWorkspaceLinkRepairPlan = {
  workspaceId: WorkspaceId;
  packageName: GeneratedPackageName;
  linkPath: AbsolutePath;
  targetPath: AbsolutePath;
  requiredParentPath: AbsolutePath;
  overwritePolicy: "symlink-only";
};

type GeneratedPackageFileEvidence = {
  relativePath: string;
  path: AbsolutePath;
};

type GeneratedWorkflowsExportBuildEvidence = {
  exportName: string;
  qualifiedName: string;
  sourcePath: AbsolutePath;
  generatedPath: AbsolutePath;
  generatedCode: string;
} &
  (
    | {
        kind: "agent";
        namespace: "Agents";
        agentParameters: TaskAgentParametersSource;
        workflowAgentId: string;
      }
    | {
        kind: "component";
        namespace: "Components";
        agentParameters: null;
        workflowAgentId: null;
      }
    | {
        kind: "prompt";
        namespace: "Prompts";
        agentParameters: null;
        workflowAgentId: null;
      }
    | {
        kind: "workflow";
        namespace: "Workflows";
        agentParameters: null;
        workflowAgentId: null;
      }
  );

type GeneratedPackageDependencyEvidence =
  | {
      specifier: "@svvy/core";
      importKind: "type-only";
      dependencyClass: "app-owned-type-contract";
      resolutionAuthority: "app-owned-type-contract";
      manifestDependency: "dev-type-dependency";
    }
  | {
      specifier: GeneratedPackageName;
      importKind: "type-only" | "runtime";
      dependencyClass: "generated-package";
      resolutionAuthority: "generated-package-link";
      manifestDependency: "none-generated-package-link";
      buildId: GeneratedPackageBuildId;
    }
  | {
      specifier: string;
      importKind: "type-only" | "runtime";
      dependencyClass: "workspace-authoring-external";
      resolutionAuthority: "workspace-smithers-package" | "external-ambient-declaration";
      manifestDependency:
        | "dependency"
        | "dev-type-dependency"
        | "peer-workspace-expectation"
        | "ambient-declaration";
      version: string;
    }
  | {
      specifier: string;
      importKind: "type-only" | "runtime";
      dependencyClass: "forbidden";
      resolutionAuthority: "forbidden";
      manifestDependency: "none-forbidden";
    };

type GeneratedPackageBuildStatus = {
  packageName: GeneratedPackageName;
  action: "unchanged" | "written" | "failed";
  buildId?: GeneratedPackageBuildId;
  sourceFingerprint?: string;
  outputFingerprint?: string;
  manifestPath?: AbsolutePath;
  generatedFiles?: readonly GeneratedPackageFileEvidence[];
  dependencies?: readonly GeneratedPackageDependencyEvidence[];
  diagnostics?: readonly string[];
};

type GeneratedPackageRefreshStatus = GeneratedPackageBuildStatus & {
  refreshScope: "app-global-build";
};

type GeneratedPackageWorkspaceLinkStatus = {
  workspaceId: WorkspaceId;
  packageName: GeneratedPackageName;
  status:
    | "linked"
    | "unchanged"
    | "blocked-non-symlink"
    | "missing-smithers-root"
    | "repair-needed"
    | "failed";
  linkPath?: AbsolutePath;
  targetPath?: AbsolutePath;
  diagnostics?: readonly string[];
};
```

`GeneratedPackagesRefreshResult.packages` contains extension-owned
`GeneratedPackageBuildStatus` values because it is the public runtime facade result for requested
build work. `manifestPath` and `generatedFiles` are file-backed evidence from the just-completed
extension build, not durable generated-package read-model projections. Runtime derives
`GeneratedPackageRefreshStatus` receipts by adding runtime-owned `refreshScope` before writing
generated-package state facts. Public refresh callers do not receive `refreshScope`; they can
retrieve persisted generated-package facts through state read models when they need product-state
status.

`GeneratedPackageBuildPlanResult.workflowsExports` is the renderer-safe export evidence emitted by
the same validated `@svvyx/workflows` source items and rendered files that produced the successful
package output. `kind` and `namespace` are a closed matching pair, `qualifiedName` equals
`${namespace}.${exportName}`, and agent rows carry the exact validated
`TaskAgentParametersSource` plus `workflowAgentId` equal to that parameter record's `id`.
Non-agent rows carry `null` for both agent-only fields. This evidence is an extension build result;
it does not add metadata to generated runtime export values or authorize `@svvy/extensions` to
persist state.

`RuntimeGeneratedPackageStatePort` is the core-owned state port used by runtime generated-package
refresh and workspace-link repair. It is a state contract, not a generated-package build contract.
The generated-package build host still receives only `GeneratedPackageBuildInput`.
`RecordGeneratedPackageBuildInput` is a closed package-discriminated union: a successful
`@svvyx/workflows` write requires its `GeneratedPackageBuildId` and the complete
`workflowsExports` snapshot from the same build plan, while a successful `@svvyx/extensions` write
does not accept `workflowsExports`. Failure writes never carry export evidence.

```ts
type RuntimeGeneratedPackageFactRecord = {
  packageName: GeneratedPackageName;
  status: "ready" | "failed" | "refresh-needed";
  buildId: GeneratedPackageBuildId | null;
  manifestPath: string | null;
  sourceFingerprint: string | null;
  outputFingerprint: string | null;
  generatedFileListDigest: string | null;
  dependencies: readonly GeneratedPackageDependencyEvidence[];
  diagnostics: readonly string[];
  sourceCommandId: CommandId | null;
  refreshNeededReason: string | null;
  lastRecoveryWorkId: RecoveryWorkId | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
};

type RuntimeGeneratedPackageWorkspaceLinkRecord = {
  workspaceId: WorkspaceId;
  packageName: GeneratedPackageName;
  status: GeneratedPackageWorkspaceLinkStatus["status"];
  linkPath: string | null;
  targetPath: string | null;
  diagnostics: readonly string[];
  sourceCommandId: CommandId | null;
  lastRecoveryWorkId: RecoveryWorkId | null;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
};
```

`RuntimeGeneratedPackageFactRecord.createdAt`, `.updatedAt`, and workspace-link record timestamps
are UTC ISO string fields. Their schemas decode with `UtcDateTime` /
`Schema.DateTimeUtcFromString` and encode with `DateTime.formatIso(...)`.

```ts
type StateMutationResult<T> = {
  value: T;
  afterCommit: readonly StateInvalidationDescriptor[];
};

const StateMutationResultSchema = <T>(value: Schema.Decoder<T>) =>
  Schema.Struct({
    value,
    afterCommit: Schema.Array(StateInvalidationDescriptorSchema),
  });
```

A mutating state-backed Effect port method is any method that can create, update, delete, claim,
release, normalize, append, record, mark, resolve, default, cancel, clear, ensure by writing, or
persist state. Every such method returns
`Effect.Effect<StateMutationResult<T>, StateContractError>`. Use `T = void` only when no committed
domain value exists. Read-only runtime-facing port methods are limited to `get`, `find`, `list`,
`read`, `inspect`, and `has` methods that perform no writes and return
`Effect.Effect<T, StateContractError>` directly. State-owned read-model facades may additionally use
domain read verbs such as `fetch`, `rebaseline`, and `snapshot` when the state package spec names the
method and the method still performs no write.

```ts
type RecordGeneratedPackageBuildInput = {
  sourceCommandId?: CommandId | null;
  recoveryWorkId?: RecoveryWorkId | null;
} & (
  | {
      status: GeneratedPackageRefreshStatus & {
        packageName: "@svvyx/workflows";
        action: "written" | "unchanged";
        buildId: GeneratedPackageBuildId;
      };
      workflowsExports: readonly GeneratedWorkflowsExportBuildEvidence[];
    }
  | {
      status: GeneratedPackageRefreshStatus & {
        packageName: "@svvyx/extensions";
        action: "written" | "unchanged";
      };
    }
);

type RuntimeGeneratedPackageStatePortService = {
  recordGeneratedPackageBuild(
    input: RecordGeneratedPackageBuildInput,
  ): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  recordGeneratedPackageFailure(input: {
    status: GeneratedPackageRefreshStatus & { action: "failed" };
    sourceCommandId?: CommandId | null;
    recoveryWorkId?: RecoveryWorkId | null;
  }): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  recordWorkspaceLinkStatus(input: {
    status: GeneratedPackageWorkspaceLinkStatus;
    sourceCommandId?: CommandId | null;
    recoveryWorkId?: RecoveryWorkId | null;
  }): Effect.Effect<
    StateMutationResult<RuntimeGeneratedPackageWorkspaceLinkRecord>,
    StateContractError
  >;
  readLinksNeedingRepair(input?: {
    workspaceId?: WorkspaceId;
    packages?: readonly GeneratedPackageName[];
  }): Effect.Effect<readonly RuntimeGeneratedPackageWorkspaceLinkRecord[], StateContractError>;
  readGeneratedPackageFacts(input?: {
    packages?: readonly GeneratedPackageName[];
  }): Effect.Effect<readonly RuntimeGeneratedPackageFactRecord[], StateContractError>;
  reconcileGeneratedPackageManifest(input: {
    fact: Omit<
      RuntimeGeneratedPackageFactRecord,
      | "status"
      | "diagnostics"
      | "sourceCommandId"
      | "refreshNeededReason"
      | "lastRecoveryWorkId"
      | "createdAt"
      | "updatedAt"
    >;
    diagnostics?: readonly string[];
    sourceCommandId?: CommandId | null;
    recoveryWorkId?: RecoveryWorkId | null;
  }): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  markGeneratedPackageRefreshNeeded(input: {
    packageName: GeneratedPackageName;
    reason: string;
    sourceCommandId?: CommandId | null;
    recoveryWorkId?: RecoveryWorkId | null;
  }): Effect.Effect<StateMutationResult<RuntimeGeneratedPackageFactRecord>, StateContractError>;
  markWorkspaceLinksRepairNeeded(
    input: MarkWorkspaceGeneratedPackageLinksRepairNeededInput,
  ): Effect.Effect<
    StateMutationResult<MarkWorkspaceGeneratedPackageLinksRepairNeededResult>,
    StateContractError
  >;
};
```

Public `RefreshGeneratedPackagesRequest` is app-global only and has no `workspaceLinkTargets` or
`force` field. Runtime derives link-repair work from opened/acquired workspace runtime scopes and
persisted generated-package link facts after the app-global generated-package facts commit. Targeted
workspace link work is represented only by internal `InternalRefreshGeneratedPackagesRequest` values
with `scope: "workspace-link-repair"` and one `workspaceId`; durable recovery for that work uses the
runtime recovery kind `workspace_generated_package_link_repair`.

`GeneratedPackageBuildInput` is the runtime-to-extensions generated package build contract. It has
only `packages` and returns extension-owned `GeneratedPackageBuildStatus` values. It has no `scope`,
`workspaceId`, `reason`, `sourceCommandId`, `recoveryWorkId`, workspace-link targets, force flag,
source preview, or caller-selected filesystem path. Runtime maps `RefreshGeneratedPackagesRequest`
to `GeneratedPackageBuildInput` only after it has handled scheduling, recovery lineage, dedupe, and
workspace fanout, then wraps accepted build evidence into runtime-owned
`GeneratedPackageRefreshStatus` receipts and state-port inputs.

`GeneratedPackageRefreshStatus.buildId` is present only when an app-global refresh creates or reuses
a generated-package build row for that package. A no-op unchanged app-global refresh or failed
app-global refresh that cannot create a build row reports per-package status and diagnostics without
inventing a synthetic build id. Workspace-link repair reports only
`GeneratedPackageWorkspaceLinkStatus` entries and never invents package build ids or package build
statuses. `GeneratedPackagesRefreshResult.recoveryWorkIds` contains only runtime-owned durable
recovery work ids created or touched by the refresh wrapper. Extension-owned build-plan results do
not allocate or report runtime scheduling identity, runtime command identity, or runtime recovery
work ids.

`actor_extension_binding.update` is the runtime effect used to change the current orchestrator or
handler actor surface binding for `load_extension`, composer controls, source refresh, or
profile-edit reconciliation. The target is a `PromptTarget`, not a workflow-task runtime target.
Runtime validates the active command target, validates extension readiness for `usage: "loaded"`,
applies the binding through `RuntimeActorExtensionBindingStatePort.updateActorExtensionBinding(...)`,
then schedules a target generated-context refresh before the next prompt-bearing turn. Extension
handlers do not mutate profile defaults, persisted binding rows, generated context rows, or prompt
bindings directly.

Example:

```json
{
  "type": "generated_packages.refresh",
  "input": {
    "scope": "workspace-link-repair",
    "workspaceId": "wksp_01",
    "packages": ["@svvyx/workflows", "@svvyx/extensions"],
    "reason": "explicit-build",
    "sourceCommandId": "cmd_17"
  }
}
```

For `scope: "app-global"`, runtime builds or validates only the app-global generated packages. After
the generated-package facts commit, runtime reads generated-package facts and acquired workspace
runtimes to enqueue any required `workspace-link-repair` requests. Runtime must not infer workspace
link repair from raw filesystem paths or generated package names.

`episode.record` is produced only by named episode-producing tools and runtime flows for handler
threads. It is normally emitted through `thread_report` / thread-handling semantics for the owning
handler thread and is applied through
`RuntimeEpisodeStatePort.recordHandlerThreadEpisode(...)`. That port validates
`workspaceSessionId`, `threadId`, and `threadGroupId` against product state before writing the
episode row. When `outcome` is present, the handler thread objective is concluded by the same state
boundary that records the episode. `orchestrator-local` and other non-thread episode scopes are not
part of `RecordEpisodeRequest`; adding them requires a separate product state model, read model, and
runtime applier before the core schema may decode those branches. Other extension handlers cannot
persist arbitrary episodes unless their product spec names the producer, scope, allowed `kind`
values, and related identity checks.

Request-input runtime effect rules:

- `CreateRequestInputRequest.questions` contains one to three questions.
- Choice questions are identified structurally by `options`. Each choice question contains two or
  three options, exactly one option with `recommended: true`, no `recommended: false` values, and
  no `defaultAnswer`.
- Freeform questions are identified structurally by `defaultAnswer`. Each freeform question contains
  no `options`.
- Runtime-only mode and timeout state live on `CreateRequestInputRequest`, not on the model-facing
  `request_user_input` tool input. The model-facing tool input remains `{ questions }`.
- Request-level titles are not stored. Each question has an agent-authored `title`; command cards,
  side-panel rows, and summaries derive compact labels from those per-question titles.
- The model-facing tool input does not accept generated ids, queue ids, mode, timeout, or timer
  fields.
- `@svvy/runtime` requests creation through core-owned request-input state ports, and the
  `@svvy/state` implementation allocates `questionId`, `optionId`, `requestId`, and `answerId`.
  Extension handlers and UI callers do not submit those ids when creating a request.
- The tool result returned to the agent does not include generated ids, timer state, mode, or UI
  availability fields.

Generated-package refresh rules:

- `scope: "app-global"` rebuilds generated package files from app-global source and records
  app-global package facts.
- `scope: "workspace-link-repair"` requires `workspaceId` and repairs that workspace's
  `.smithers/node_modules/@svvyx/*` links from current app-global generated-package facts.
  App-global build work is requested separately with `scope: "app-global"`.
- `sourceCommandId` links explicit agent/user-triggered work to command facts.
- `recoveryWorkId` links startup or retry work to durable recovery facts.

Rules:

- `RuntimeEffectRequest` is not a runtime service API and not an extension service API. It is a core
  contract shared by both packages.
- Approval policy and waits are runtime-owned; durable approval rows are state-owned facts written
  through core-owned state ports implemented by `@svvy/state`. Extension handlers may return
  immutable `ExtensionExecutionPlan` values; runtime derives approval requests, command previews,
  filesystem previews, and approval records from those plans and current policy.
  Extension-produced `RuntimeEffectRequest` values never include `approval.request`.

Rejected runtime effect request:

```json
{
  "type": "approval.request",
  "input": {
    "reason": "extension-authored approval request"
  }
}
```

- Every variant has an exact `@svvy/core` schema, a derived TypeScript type, and a runtime
  application test. Unspecified `unknown`, generic `Record<string, unknown>`, renderer payloads, or
  pi-native payloads are not valid runtime effect inputs.
- Runtime validates request target identity against the active prompt execution context before
  applying any effect. An extension handler cannot create work for an unrelated workspace, surface,
  thread, workflow task attempt, command, request, approval, or generated package.
- State mutations caused by one runtime effect happen in one `@svvy/state` transaction and return
  after-commit invalidation descriptors. Runtime publishes notifications only after the commit.
  Every mutating state-backed Effect port returns
  `StateMutationResult<T> = { value: T; afterCommit: readonly StateInvalidationDescriptor[] }`.
  Read-only methods return `T`. State port implementations derive descriptors from the committed
  write result; runtime-owned boundary code may collect multiple returned `afterCommit` arrays while
  applying one runtime operation. Descriptors are publishable only after the relevant state write
  succeeds. Idempotent duplicate replays return the original value with `afterCommit: []`.
- The algebra is closed. Adding a variant requires a core/runtime contract update, extension tests,
  runtime application tests, and generated declaration updates when agent-facing contracts expose
  the variant.
- Extension handlers return an `ExtensionHandlerResult` for the current command plus an optional
  ordered operation list. Runtime effects are represented only as
  `{ kind: "runtime_effect", request: RuntimeEffectRequest }` operation items. Runtime records the
  current command from the handler result envelope and validates ordering, target identity,
  transactions, queue delivery, and generated-package scheduling.
- `RuntimeEffectRequest` never records the currently executing command. Command status, summary,
  facts, errors, and child-command links come from the extension handler result and runtime command
  lifecycle.
- When a runtime effect allocates ids or durable work needed for the current command's final facts,
  the effect's completion contract, not handler-authored preview data, defines those facts. Runtime
  appends them to the current command only after the authoritative state commit succeeds.
- Extensions never return arbitrary runtime events. Runtime derives notifications from applied
  effects, pi stream patches, and successful state commits.
- Generated package refresh requests schedule or repair generated package work. The concrete build,
  validation, and source-library rules stay in `@svvy/extensions`; durable facts and recovery stay
  in `@svvy/state`; ordering and retry policy stay in `@svvy/runtime`.
- Desktop pane creation is never a `RuntimeEffectRequest`.

## Recovery Work Contract

`@svvy/core` owns the closed recovery work kind union used by `@svvy/runtime` and `@svvy/state`.
Runtime owns claim/delivery policy. State owns durable rows and leases. No package may introduce a
second recovery-kind string union.

```ts
type RecoveryWorkKind =
  | "queue_delivery"
  | "active_turn_recovery"
  | "workflow_task_attempt_recovery"
  | "source_reconcile"
  | "generated_context_refresh"
  | "generated_package_refresh"
  | "workspace_generated_package_link_repair"
  | "artifact_materialization"
  | "title_generation"
  | "request_input_wait"
  | "approval_wait"
  | "command_process_reconciliation";
```

Queue-delivered work such as `initial_handler_start`, `thread_report_notification`,
`report_request`, `request_user_input_answer`, and `workflow_task_agent_start` remains typed
queue state, not recovery-kind state. Runtime schedules `queue_delivery` for the affected surface.
App-log recovery observation is ordinary app-log/read-model reconciliation, not product event
history and not a separate recovery-kind string.

## Core-Owned Runtime-Facing Ports

`@svvy/core` defines the data contracts, service TypeScript shapes, and live `Context.Service` tags
for cross-package ports that let runtime, extensions, sandbox, and `@svvy/pi-adapter` stay
independent of `@svvy/state` and desktop code while still receiving provider credentials, secret
invocation values, pi session references, and packaged runtime paths.

```ts
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

type PiSessionRef = {
  surfacePiSessionId: SurfacePiSessionId;
};

type PiSessionReference = {
  surfacePiSessionId: SurfacePiSessionId;
  referenceFingerprint: string;
  adapterKind: string;
  adapterVersion: string;
  storageLocator: string;
  piSessionId?: string;
  metadata?: Record<string, JsonValue>;
};

type PiSessionReferencePublic = {
  surfacePiSessionId: SurfacePiSessionId;
  referenceFingerprint: string;
};

// `PiSessionReference` is a persisted adapter locator owned by `@svvy/state` and consumed by
// `@svvy/pi-adapter` / runtime invocation paths that need to reopen a live pi session. Product read
// models expose only `PiSessionReferencePublic`. Adapter-private locator fields are not logged,
// copied into transcripts, generated package files, command facts, runtime events, app logs, or
// desktop RPC payloads.

type PiSystemPromptBinding = {
  fingerprint: GeneratedContextFingerprint;
  revision: GeneratedContextRevision;
  text: string;
};

type PiAmbientPiResourceEnablement = {
  kind:
    | "pi_builtin_tool"
    | "pi_extension"
    | "pi_skill"
    | "pi_prompt_template"
    | "pi_theme"
    | "pi_command"
    | "pi_hook"
    | "pi_provider_adapter";
  resourceId: string;
  enabledByBindingFingerprint: GeneratedContextFingerprint;
};

type CreatePiSessionInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  actorKind: ActorKind;
  agentProfileId?: AgentProfileId;
  generatedContextFingerprint: GeneratedContextFingerprint;
  model: ModelSelection;
  reasoning: ReasoningSelection;
};

type OpenPiSessionInput = {
  workspaceId: WorkspaceId;
  surfacePiSessionId: SurfacePiSessionId;
  expectedReference?: PiSessionReference;
  actorKind: ActorKind;
};

type ClosePiSessionInput = {
  session: PiSessionRef;
};

type RunPiTurnInput = {
  session: PiSessionRef;
  turnId: TurnId;
  surfacePiSessionId: SurfacePiSessionId;
  userMessage: RuntimeSubmittedMessage;
  userMessageSubmittedAt: IsoDateTimeString;
  systemPromptBinding: PiSystemPromptBinding;
  model: ModelSelection;
  reasoning: ReasoningSelection;
  tools: readonly NativeToolDeclaration[];
  toolExecutor: PiToolExecutor;
  enabledAmbientPiResources?: readonly PiAmbientPiResourceEnablement[];
};

type RestorePiHistoryEntryInput = {
  session: PiSessionRef;
  entryId: PiHistoryEntryRef;
};

type ForkPiHistoryEntryInput = {
  session: PiSessionRef;
  entryId: PiHistoryEntryRef;
  targetSurfacePiSessionId: SurfacePiSessionId;
};

type ListModelsInput = {
  workspaceId: WorkspaceId;
  providerId?: ProviderId;
};

type ModelInfo = {
  providerId: ProviderId;
  modelId: ModelId;
  displayName: string;
  supportsReasoning: boolean;
  supportedReasoning: readonly ReasoningEffort[];
  inputModalities: readonly InputModality[];
  contextWindow?: PositiveSafeInteger;
  maxOutputTokens?: PositiveSafeInteger;
  authStatus: ProviderAuthStatus;
};

type GenerateTitleInput = {
  workspaceId: WorkspaceId;
  workspaceSessionId: WorkspaceSessionId;
  surfacePiSessionId: SurfacePiSessionId;
  threadId?: ThreadId;
  prompt: string;
  model: ModelSelection;
  reasoning: ReasoningSelection;
};

type GenerateTitleResult = {
  title: string;
  model: ModelSelection;
};

type PiRuntimePathsSnapshot = {
  workspaceId: WorkspaceId;
  cwd: AbsolutePath;
  agentDir: AbsolutePath;
  sessionDir: AbsolutePath;
  modelRegistryPath: AbsolutePath;
  source: "packaged-app" | "test-fixture";
};

// These are core-owned, pi-free contracts. `@svvy/pi-adapter` imports them and implements their
// behavior; it does not redefine them as adapter-local public types.

type PiToolExecutionInput = {
  turnId: TurnId;
  surfacePiSessionId: SurfacePiSessionId;
  piToolCallId: ToolCallId;
  toolName: string;
  argumentsJson: string;
  argumentsSnapshotSequence?: NonNegativeSafeInteger;
};

type PiToolExecutionUpdate =
  | {
      type: "accepted";
      commandId: CommandId;
      acceptedAt: IsoDateTimeString;
    }
  | {
      type: "arguments_snapshot";
      commandId: CommandId;
      sequence: number;
      argumentsJson: string;
      occurredAt: IsoDateTimeString;
    }
  | {
      type: "progress";
      commandId: CommandId;
      message: string;
      occurredAt: IsoDateTimeString;
    };

class RuntimeToolExecutionError extends Schema.TaggedErrorClass<RuntimeToolExecutionError>()(
  "RuntimeToolExecutionError",
  {
    turnId: TurnId,
    surfacePiSessionId: SurfacePiSessionId,
    piToolCallId: ToolCallId,
    toolName: Schema.String,
    commandId: Schema.optionalKey(CommandId),
    reason: Schema.Literals([
      "tool-not-found",
      "invalid-arguments",
      "extension-failed",
      "runtime-effect-failed",
      "cancelled",
      "state-conflict",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

type PiToolExecutor = (
  input: PiToolExecutionInput & {
    emit(update: PiToolExecutionUpdate): Effect.Effect<void, RuntimeToolExecutionError>;
  },
) => Effect.Effect<NativeToolResult, RuntimeToolExecutionError>;

type PiToolExecutionUpdatedEvent =
  | {
      type: "pi.tool_execution.updated";
      session: PiSessionRef;
      turnId: TurnId;
      surfacePiSessionId: SurfacePiSessionId;
      toolCallId: ToolCallId;
      toolName: string;
      result: NativeToolResult;
    }
  | {
      type: "pi.tool_execution.updated";
      session: PiSessionRef;
      turnId: TurnId;
      surfacePiSessionId: SurfacePiSessionId;
      toolCallId: ToolCallId;
      toolName: string;
      update: PiToolExecutionUpdate;
    };

// `argumentsJson` is raw only at the pi-adapter boundary because pi streams tool-call arguments as
// JSON text. Runtime parses and validates accepted arguments against the extension-owned Effect
// Schema before command state is committed. Command argument snapshots and accepted command facts
// use decoded `JsonValue` payloads, not unvalidated raw strings, except where a fact explicitly
// records the original pi-adapter byte/text evidence.

type ProviderAuthStatus = {
  providerId: ProviderId;
  workspaceId?: WorkspaceId;
  health: "usable" | "missing" | "expired" | "refresh_failed";
  redactedAccountLabel?: string;
  refreshedAt?: IsoDateTimeString;
  expiresAt?: IsoDateTimeString;
  issue?: string;
};

const ProviderAuthStatusSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  health: Schema.Literals(["usable", "missing", "expired", "refresh_failed"]),
  redactedAccountLabel: Schema.optionalKey(Schema.String),
  refreshedAt: Schema.optionalKey(IsoDateTimeString),
  expiresAt: Schema.optionalKey(IsoDateTimeString),
  issue: Schema.optionalKey(Schema.String),
});

type ProviderCredentialSnapshot =
  | {
      providerId: ProviderId;
      workspaceId?: WorkspaceId;
      health: "usable";
      accessToken: Redacted.Redacted<string>;
      refreshToken?: Redacted.Redacted<string>;
      redactedAccountLabel?: string;
      expiresAt?: IsoDateTimeString;
      credentialFingerprint: string;
    }
  | {
      providerId: ProviderId;
      workspaceId?: WorkspaceId;
      health: "missing" | "expired" | "refresh_failed";
      redactedAccountLabel?: string;
      expiresAt?: IsoDateTimeString;
      issue?: string;
    };

type RecordProviderAuthStatusInput = {
  status: ProviderAuthStatus;
  observedAt: IsoDateTimeString;
  source: "provider_refresh" | "startup_scan" | "user_action" | "runtime_retry";
};

// `ProviderCredentialSnapshot` is a process-local invocation snapshot returned only by
// `ProviderAuthPort` methods that configure pi/provider auth for one trusted invocation.
// `accessToken` and `refreshToken` are never encoded, persisted, logged, exposed through read
// models, app/RPC payloads, command facts, runtime events, app logs, transcripts, generated package
// files, artifacts, or desktop bridge payloads; public/provider status surfaces use
// `ProviderAuthStatus` fields such as health, redacted labels, expiry, and issue.

type SecretStatusSnapshot = {
  ref: ExtensionEnvSecretRef;
  configured: boolean;
  redactedLabel?: string;
  revisionFingerprint?: string;
  updatedAt?: IsoDateTimeString;
};

export const SecretInvocationValueSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  value: Schema.Redacted(Schema.String, {
    label: "extension-env-secret",
    disallowJsonEncode: true,
  }),
  revisionFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
type SecretInvocationValue = typeof SecretInvocationValueSchema.Type;
```

Equivalent decoded value shape:

```ts
type SecretInvocationValue = {
  ref: ExtensionEnvSecretRef;
  value: Redacted.Redacted<string>;
  revisionFingerprint: string;
};
```

```ts
export class ProviderAuthPortError extends Schema.TaggedErrorClass<ProviderAuthPortError>()(
  "ProviderAuthPortError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "credentials-missing",
      "credentials-unusable",
      "refresh-failed",
      "state-conflict",
      "persistence-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class PiSessionReferencePortError extends Schema.TaggedErrorClass<PiSessionReferencePortError>()(
  "PiSessionReferencePortError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "reference-not-found",
      "stale-reference",
      "state-conflict",
      "persistence-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

export class SecretStorePortError extends Schema.TaggedErrorClass<SecretStorePortError>()(
  "SecretStorePortError",
  {
    operation: Schema.String,
    reason: Schema.Literals([
      "invalid-input",
      "secret-not-found",
      "secret-unavailable",
      "state-conflict",
      "persistence-failed",
    ]),
    message: Schema.String,
    issues: Schema.optionalKey(Schema.Array(BoundaryIssueSchema)),
    cause: Schema.optionalKey(Schema.Defect({ excludeCause: true })),
  },
) {}

// ProviderAuthPortError and SecretStorePortError are public core boundary errors and must export
// the same schema value plus decode/encode quartet required by `SVVY-EFFECT-016`. They are not
// package-private helper classes.

export interface ProviderAuthPortService {
  getProviderAuthSnapshot(
    input: GetProviderAuthSnapshotInput,
  ): Effect.Effect<ProviderCredentialSnapshot, ProviderAuthPortError>;
  refreshProviderCredentialSnapshot(
    input: RequestProviderRefreshInput,
  ): Effect.Effect<ProviderCredentialSnapshot, ProviderAuthPortError>;
}

export interface ProviderAuthStatusStatePortService {
  listProviderStatuses(
    input: ListProviderStatusesInput,
  ): Effect.Effect<readonly ProviderAuthStatus[], StateContractError>;
  recordProviderStatus(
    input: RecordProviderAuthStatusInput,
  ): Effect.Effect<StateMutationResult<ProviderAuthStatus>, StateContractError>;
}

export interface ProviderAuthPort {
  readonly _tag: "ProviderAuthPort";
}

export const ProviderAuthPort = Context.Service<ProviderAuthPort, ProviderAuthPortService>(
  "@svvy/core/ProviderAuthPort",
);

export interface ProviderAuthStatusStatePort {
  readonly _tag: "ProviderAuthStatusStatePort";
}

export const ProviderAuthStatusStatePort = Context.Service<
  ProviderAuthStatusStatePort,
  ProviderAuthStatusStatePortService
>("@svvy/core/ProviderAuthStatusStatePort");

// `ProviderAuthPort` is host/live-backed. It may obtain or refresh a process-local credential
// snapshot for one trusted invocation, but it never returns `StateMutationResult` and never
// persists product state. Runtime/app code that needs provider status surfaces records a redacted
// `ProviderAuthStatus` through `ProviderAuthStatusStatePort.recordProviderStatus(...)`; state read
// models and settings panes read statuses through `ProviderAuthStatusStatePort.listProviderStatuses(...)`
// or the provider-auth read model. The live snapshot may contain `Redacted` token values; the
// state-backed status never does.

export interface SecretStorePortService {
  getStatus(input: GetSecretStatusInput): Effect.Effect<SecretStatusSnapshot, SecretStorePortError>;
  listStatus(
    input: ListSecretStatusInput,
  ): Effect.Effect<readonly SecretStatusSnapshot[], SecretStorePortError>;
  resolveInvocationValue(
    input: ResolveSecretInvocationValueInput,
  ): Effect.Effect<SecretInvocationValue, SecretStorePortError>;
}

export interface SecretStoreMutationPortService {
  writeSecretValue(
    input: WriteSecretValueInput,
  ): Effect.Effect<WriteSecretValueResult, SecretStorePortError>;
  removeSecretValue(
    input: RemoveSecretValueInput,
  ): Effect.Effect<RemoveSecretValueResult, SecretStorePortError>;
}

export interface SecretStorePort {
  readonly _tag: "SecretStorePort";
}

export const SecretStorePort = Context.Service<SecretStorePort, SecretStorePortService>(
  "@svvy/core/SecretStorePort",
);

export interface SecretStoreMutationPort {
  readonly _tag: "SecretStoreMutationPort";
}

export const SecretStoreMutationPort = Context.Service<
  SecretStoreMutationPort,
  SecretStoreMutationPortService
>("@svvy/core/SecretStoreMutationPort");

export const GetProviderAuthSnapshotInputSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
});
export type GetProviderAuthSnapshotInput = typeof GetProviderAuthSnapshotInputSchema.Type;

export const RequestProviderRefreshInputSchema = Schema.Struct({
  providerId: ProviderId,
  workspaceId: Schema.optionalKey(WorkspaceId),
  reason: Schema.Literals(["expired", "missing", "user_requested", "runtime_retry"]),
});
export type RequestProviderRefreshInput = typeof RequestProviderRefreshInputSchema.Type;

export const ListProviderStatusesInputSchema = Schema.Struct({
  workspaceId: Schema.optionalKey(WorkspaceId),
});
export type ListProviderStatusesInput = typeof ListProviderStatusesInputSchema.Type;

export const RecordProviderAuthStatusInputSchema = Schema.Struct({
  status: ProviderAuthStatusSchema,
  observedAt: IsoDateTimeString,
  source: Schema.Literals(["provider_refresh", "startup_scan", "user_action", "runtime_retry"]),
});
export type RecordProviderAuthStatusInput = typeof RecordProviderAuthStatusInputSchema.Type;

export const ExtensionEnvName = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isPattern(/^[A-Z_][A-Z0-9_]*$/),
).pipe(Schema.brand("ExtensionEnvName"));
export type ExtensionEnvName = typeof ExtensionEnvName.Type;

export const ExtensionEnvSecretRefSchema = Schema.Struct({
  kind: Schema.Literal("extension-env"),
  extensionId: ExtensionId,
  envName: ExtensionEnvName,
});
export type ExtensionEnvSecretRef = typeof ExtensionEnvSecretRefSchema.Type;

export const GetSecretStatusInputSchema = ExtensionEnvSecretRefSchema;
export type GetSecretStatusInput = typeof GetSecretStatusInputSchema.Type;

export const ListSecretStatusInputSchema = Schema.Struct({
  kind: Schema.optionalKey(Schema.Literal("extension-env")),
  extensionId: Schema.optionalKey(ExtensionId),
});
export type ListSecretStatusInput = typeof ListSecretStatusInputSchema.Type;

export const ResolveSecretInvocationValueInputSchema = ExtensionEnvSecretRefSchema;
export type ResolveSecretInvocationValueInput = typeof ResolveSecretInvocationValueInputSchema.Type;

export const WriteSecretValueInputSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  value: Schema.Redacted(Schema.String.check(Schema.isNonEmpty()), {
    label: "extension-env-secret",
    disallowJsonEncode: true,
  }),
  expectedRevisionFingerprint: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export type WriteSecretValueInput = typeof WriteSecretValueInputSchema.Type;

export const WriteSecretValueResultSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  revisionFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
export type WriteSecretValueResult = typeof WriteSecretValueResultSchema.Type;

export const RemoveSecretValueInputSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  expectedRevisionFingerprint: Schema.optionalKey(Schema.String.check(Schema.isNonEmpty())),
});
export type RemoveSecretValueInput = typeof RemoveSecretValueInputSchema.Type;

export const RemoveSecretValueResultSchema = Schema.Struct({
  ref: ExtensionEnvSecretRefSchema,
  removed: Schema.Boolean,
  revisionFingerprint: Schema.String.check(Schema.isNonEmpty()),
});
export type RemoveSecretValueResult = typeof RemoveSecretValueResultSchema.Type;

// Provider/auth and secret-store public port method inputs are always named schemas, never inline
// object shapes. The service signatures above intentionally reuse those names so generated
// declarations, tests, docs, and callers share one source contract. Each named input schema exports
// the standard decodeUnknown...Effect, decodeUnknown...Exit, encode...Effect, and encode...Exit
// helpers described in the boundary codec rules.

// SecretStorePort returns Redacted.Redacted<string> only from invocation-resolution methods that
// are called by trusted runtime/package invocation paths. Read-model and inventory methods return
// only status, labels, presence, timestamps, and revision fingerprints. Secret writes/removals use
// the separate SecretStoreMutationPort and are state-owned UI command facade operations. Runtime,
// extensions, pi-adapter, sandbox, and generated package code do not receive the mutation port.
// App/bootstrap provides SecretStoreMutationPort only into state-owned secret-write command/facade
// layers, not into the general app runtime context available to runtime, extensions, pi-adapter, or
// sandbox services.

export const GetPiSessionReferenceInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
});
export type GetPiSessionReferenceInput = typeof GetPiSessionReferenceInputSchema.Type;

export const SavePiSessionReferenceInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
  reference: PiSessionReferenceSchema,
});
export type SavePiSessionReferenceInput = typeof SavePiSessionReferenceInputSchema.Type;

export const DeletePiSessionReferenceInputSchema = Schema.Struct({
  surfacePiSessionId: SurfacePiSessionId,
});
export type DeletePiSessionReferenceInput = typeof DeletePiSessionReferenceInputSchema.Type;

export const ValidatePiSessionReferenceInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
  surfacePiSessionId: SurfacePiSessionId,
  actorKind: ActorKindSchema,
  reference: PiSessionReferenceSchema,
});
export type ValidatePiSessionReferenceInput = typeof ValidatePiSessionReferenceInputSchema.Type;

export const ResolvePiRuntimePathsInputSchema = Schema.Struct({
  workspaceId: WorkspaceId,
});
export type ResolvePiRuntimePathsInput = typeof ResolvePiRuntimePathsInputSchema.Type;

export interface PiSessionReferencePortService {
  getPiSessionReference(
    input: GetPiSessionReferenceInput,
  ): Effect.Effect<PiSessionReference | undefined, PiSessionReferencePortError>;
  savePiSessionReference(
    input: SavePiSessionReferenceInput,
  ): Effect.Effect<StateMutationResult<PiSessionReference>, PiSessionReferencePortError>;
  deletePiSessionReference(
    input: DeletePiSessionReferenceInput,
  ): Effect.Effect<
    StateMutationResult<{ surfacePiSessionId: SurfacePiSessionId }>,
    PiSessionReferencePortError
  >;
  validatePiSessionReference(
    input: ValidatePiSessionReferenceInput,
  ): Effect.Effect<PiSessionReferenceValidation, PiSessionReferencePortError>;
}

export interface PiSessionReferencePort {
  readonly _tag: "PiSessionReferencePort";
}

export const PiSessionReferencePort = Context.Service<
  PiSessionReferencePort,
  PiSessionReferencePortService
>("@svvy/core/PiSessionReferencePort");

export const PiSessionReferenceValidationSchema = Schema.Union([
  Schema.Struct({
    valid: Schema.Literal(true),
    reference: PiSessionReferenceSchema,
    referenceFingerprint: Schema.String,
  }),
  Schema.Struct({
    valid: Schema.Literal(false),
    reason: Schema.Literals([
      "not-found",
      "workspace-mismatch",
      "surface-mismatch",
      "actor-mismatch",
      "adapter-version-mismatch",
    ]),
    referenceFingerprint: Schema.optionalKey(Schema.String),
  }),
]);
export type PiSessionReferenceValidation = typeof PiSessionReferenceValidationSchema.Type;

export interface PiRuntimePathsPortService {
  resolve(input: ResolvePiRuntimePathsInput): Effect.Effect<PiRuntimePathsSnapshot, PiAdapterError>;
}

export interface PiRuntimePathsPort {
  readonly _tag: "PiRuntimePathsPort";
}

export const PiRuntimePathsPort = Context.Service<PiRuntimePathsPort, PiRuntimePathsPortService>(
  "@svvy/core/PiRuntimePathsPort",
);
```

`@svvy/state` implementations map state/storage failures before crossing the provider-auth or
pi-session-reference port boundary. App/bootstrap maps host path resolution failures to
`PiAdapterError` before satisfying `PiRuntimePathsPort`; pi session, model metadata, and turn
operations already cross the adapter boundary with `PiAdapterError`.

Rules:

- `@svvy/core` owns the live `ProviderAuthPort`, `SecretStorePort`,
  `SecretStoreMutationPort`, `PiSessionReferencePort`, and `PiRuntimePathsPort` service tags and
  data contracts.
- `@svvy/state` provides the provider auth status and persisted pi session reference
  implementations, and consumes `SecretStoreMutationPort` only inside state-owned secret-write
  command services.
- Product app/bootstrap provides the host/live `ProviderAuthPort`, host/live `SecretStorePort`, and
  packaged runtime path resolution implementations to the composed app runtime. It provides
  host/live `SecretStoreMutationPort` only into state-owned secret-write command/facade layers; the
  mutation port is not present in the general runtime, extensions, pi-adapter, sandbox, desktop, or
  generated-package service environment. The live credential implementation may delegate to the
  host secret store but still satisfies the core-owned `ProviderAuthPort` contract.
  `@svvy/desktop` consumes renderer-safe facades and must not be the package-level provider for
  `@svvy/pi-adapter` dependencies.
- `@svvy/pi-adapter` consumes these ports as Effect service dependencies and does not import
  `@svvy/state`, `@svvy/runtime`, or desktop modules.
- Provider credentials and session references are snapshots for one pi operation. They are not
  exposed to prompts, transcripts, generated packages, or extension source.

## Sandbox Policy Port

`@svvy/core` defines the state-to-sandbox data contracts, structural TypeScript shape, and live
`Context.Service` tag so `@svvy/sandbox` can stay independent of `@svvy/state`:

```ts
export interface SandboxPolicySourceService {
  snapshot(
    input: SandboxPolicySnapshotInput,
  ): Effect.Effect<SandboxPolicySnapshot, SandboxPolicyError>;
}

export interface SandboxPolicySource {
  readonly _tag: "SandboxPolicySource";
}

export const SandboxPolicySource = Context.Service<SandboxPolicySource, SandboxPolicySourceService>(
  "@svvy/core/SandboxPolicySource",
);

type SandboxLaunchKind =
  | "direct_shell"
  | "direct_apply_patch"
  | "execute_typescript_runtime"
  | "extension_facade_child"
  | "app_owned_generated_package_build"
  | "workspace_generated_package_link_repair"
  | "extension_dependency_action";

type SandboxLaunchScope =
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "app-global-extension-dependency"; originWorkspaceId?: WorkspaceId }
  | {
      kind: "app-global-generated-package";
      packageName: GeneratedPackageName;
      originWorkspaceId?: WorkspaceId;
    }
  | {
      kind: "workspace-generated-package-link";
      workspaceId: WorkspaceId;
      packageName: GeneratedPackageName;
    };

type SandboxPolicySnapshotInput = {
  scope: SandboxLaunchScope;
  surfacePiSessionId?: SurfacePiSessionId;
  commandId: CommandId;
  launchKind: SandboxLaunchKind;
  cwd: AbsolutePath;
};

type FileSystemSandboxPolicy = {
  defaultAccess: "read" | "none";
  entries: readonly FileSystemSandboxPolicyEntry[];
};

type FileSystemSandboxPolicyEntry = {
  path: AbsolutePath;
  access: "read" | "write" | "none";
  recursive: boolean;
  source:
    | "workspace"
    | "worktree"
    | "artifact"
    | "generated-output"
    | "protected-metadata"
    | "extension-source"
    | "temporary"
    | "app-runtime";
};

type SandboxPolicySnapshot = {
  snapshotId: string;
  fingerprint: string;
  resolvedAt: IsoDateTimeString;
  scope: SandboxLaunchScope;
  surfacePiSessionId?: SurfacePiSessionId;
  commandId: CommandId;
  launchKind: SandboxLaunchKind;
  cwd: AbsolutePath;
  sandboxMode: "managed" | "omitted_full_access";
  networkPolicy: "allow" | "deny";
  filesystemPolicy: FileSystemSandboxPolicy;
  profileDigest?: string;
};

type BuildLaunchPolicyInput = {
  scope: SandboxLaunchScope;
  surfacePiSessionId?: SurfacePiSessionId;
  commandId: CommandId;
  launchKind: SandboxLaunchKind;
  command: readonly string[];
  cwd: AbsolutePath;
  envFacts: readonly EnvironmentFact[];
  snapshot?: SandboxPolicySnapshot;
};

type EnvironmentFact = {
  key: string;
  valueFingerprint?: string;
  redactionLabel?: string;
};

type SandboxLaunchFacts =
  | {
      mode: "managed";
      spawn: {
        executable: AbsolutePath;
        args: readonly string[];
        cwd: AbsolutePath;
        envFacts: readonly EnvironmentFact[];
      };
      helperPath: AbsolutePath;
      helperArgs: readonly string[];
      profilePath?: AbsolutePath;
      policySnapshot: SandboxPolicySnapshot;
    }
  | {
      mode: "omitted_full_access";
      spawn: {
        executable: AbsolutePath;
        args: readonly string[];
        cwd: AbsolutePath;
        envFacts: readonly EnvironmentFact[];
      };
      policySnapshot: SandboxPolicySnapshot;
    };
```

The snapshot must be resolved before launch policy generation and must be immutable for that launch.
It includes launch kind, state-resolved workspace/worktree policy entries, generated-output
entries, immutable artifact entries, protected metadata entries, network policy, and whether
managed sandboxing is enabled or omitted for full-access execution. It does not expose raw approval
prompts or mutable state-store handles.

`@svvy/core` owns the live `SandboxPolicySource` service tag, immutable snapshot contract,
`SandboxLaunchScope`, `SandboxLaunchKind`, `BuildLaunchPolicyInput`, and `SandboxLaunchFacts`
pi-free data contracts. `SandboxLaunchFacts` is a package-to-package in-process launch receipt for
runtime/sandbox coordination only. Its `spawn`, `helperPath`, `helperArgs`, and `profilePath` fields
are not facade payloads, runtime events, state read models, command fact schemas, app-log payloads,
generated-package contracts, or extension handler results; persisted/public surfaces use only the
redacted sandbox command-fact projection named by the sandbox and runtime specs.
`@svvy/state` provides the snapshot-source implementation. `@svvy/sandbox` consumes that service as
an Effect dependency and turns the core-owned `BuildLaunchPolicyInput` into core-owned
`SandboxLaunchFacts`. Normal live launch callers omit `BuildLaunchPolicyInput.snapshot`; sandbox
then resolves the current immutable snapshot from `SandboxPolicySource`. The optional supplied
snapshot is runtime-only replay or verification input for an already committed immutable snapshot.
App/bootstrap, extensions, generated packages, direct-tool helpers, and handler-authored plans must
not synthesize or provide live policy snapshots.

`@svvy/core` never exports Promise facades. Sandbox/debug edges consume the `@svvy/sandbox` Effect
service or state read facades through an app/runtime-owned bridge. No sandbox diagnostics facade
subpath is part of the public package surface unless the owning package spec, core schema, and
package-boundary exports are updated in the same change. Package-to-package code consumes the
core-owned `SandboxPolicySource` service tag through Effect.

## Dependency Rules

- Depends on Effect v4 as a public contract dependency for schemas, typed errors, stream aliases, and
  cross-package Effect return types.
- Must not depend on any other `@svvy/*` package.
- Must not depend on pi, Electrobun, Svelte, Incur, Smithers, filesystem APIs, database APIs,
  native helper APIs, or UI libraries.
- Must depend only on Effect v4 import paths and APIs.

## Versioning Rules

- Breaking public core changes require a package major version bump once published.
- Persisted schema changes require explicit schema version handling.
- Read-model contract changes update schemas, invalidation mappings, fixtures, and consumers in the
  same change. A read-model has exactly one schema and one projection; a dual-schema projection is
  allowed only when the PRD, feature inventory, and owning specs define both schemas as durable
  product behavior.
- Generated package names outside the `@svvyx/*` namespace are outside the core contract.

## Product Source Ownership

Target package paths:

- `packages/core/src/**`
- schema/type contracts owned by `@svvy/core` that generated declaration assets may derive from

## Acceptance Criteria

- `@svvy/core` exports only shared schema-backed contracts, typed errors, stable ids, event/read
  model contracts, target contracts, cross-package port service tags, and explicitly named shared
  helper symbols in the allowed categories above.
- `@svvy/core` does not export pi-native, state, runtime, desktop, sandbox, Smithers, filesystem, or
  database implementation objects.
- Runtime command lifecycle contracts, target contracts, schema/type contracts used by generated
  declarations, and state read-model contracts are grouped into explicit modules instead of being
  treated as incidental app implementation types.
- Every persisted, RPC, generated-package, and cross-package payload shape owned by core has an
  Effect Schema plus a TypeScript type derived from that schema.
- Core remains usable by non-Effect consumers through exported data contracts, while package
  internals use Effect return types where effects, dependencies, or typed failures matter.

## Tests

- Compile-time public import tests.
- Schema validation tests.
- Effect Schema decoder/encoder tests with hoisted decoders.
- Typed tagged error fixture tests.
- Event/read-model fixture tests.
- Public API dependency tests proving `@svvy/core` imports no pi, desktop, state, runtime,
  extension, sandbox, filesystem, database, Smithers, or Incur implementation modules.
- Persistence payload version tests for schema-backed cross-package payload envelopes.
- Tests proving `@svvy/core` exposes no `Layer`, `ManagedRuntime`, scoped resource, fiber, queue,
  database, subprocess, host-global service ownership, or service implementation. Core may expose
  approved `Context.Service` tags only for cross-package port contracts.
