# `@svvy/extensions` Package Architecture Spec

## Status

- Status: active architecture spec; implementation progress is tracked in `docs/progress.md`
- Package: `@svvy/extensions`

## Purpose

`@svvy/extensions` owns extension source, builtin capability definitions, generated-context inputs,
and runtime-facing extension service behavior.

If agents experience something as a model-callable tool, prompt-only guidance, `svvyx` command
family, generated `execute_typescript` facade declaration, loadable capability, or loaded instruction block, it
belongs here.

`@svvy/extensions` is an Effect-native package. Registry reads, actor binding resolution,
generated-context construction, native tool declaration, native tool metadata, native tool handler
lookup and handler invocation, `svvyx` dispatch, dependency checks, instruction generation,
redaction, and facade declaration construction are Effect services. Runtime remains the only owner
of accepted native-tool execution, command envelopes, approval/sandbox/process/file effects, and
operation application.

## Owns

- Builtin capability definitions and user extension source records resolved from extension-owned
  source roots. Durable product facts about extension availability, usage, readiness, dependency
  evidence, env status, and secret references are DB/product-state-backed `@svvy/state` rows.
- Separate external-instruction input records for discovered files such as `AGENTS.md` and
  `CLAUDE.md`; these records are extension-owned generated-context inputs with file identity,
  fingerprint, and content provenance, not normal extension records. Actor enablement, ordering,
  diagnostics, and participation facts for those inputs are DB/product-state-backed in
  `@svvy/state`.
- Extension categories and interface kinds: native tool, `svvyx`, and instructions.
- Agent profile extension default resolution, validation, and actor binding construction; persisted
  profile/default rows are stored by `@svvy/state`.
- Base actor prompt extensions.
- All default prompt and instruction source assets.
- Generated actor context construction and extension-owned source contributor rendering contracts.
  Cross-package generated-context DTO schemas and decoders are owned by `@svvy/core`;
  `@svvy/extensions` imports those contracts and owns how source contributors are resolved,
  rendered, validated, ordered, and assembled into the core-owned result shape. Cross-package source
  edit request/result contracts are owned by `@svvy/core`. `@svvy/state` persists built context
  facts, fingerprints, source-version facts, and surface bindings.
- Tool declaration values and actor-specific callable API slicing, using pi-free native-tool
  declaration shapes from `@svvy/core`.
- Canonical extension-owned tool metadata used by runtime projection and command tracking.
- `list_extensions` and `load_extension`.
- Extension env declarations, dependency readiness interpretation, CLI requirements, redaction, and
  invocation-local secret injection boundaries.
- Extension build validation and current-build metadata contracts.
- Extension-owned `svvyx` command contracts, command metadata, generated declaration evidence,
  invocation validation, redaction, and immutable runtime-operation or execution-plan construction.
  The current public `Extensions` service does not expose an `svvyx` method group.
- Generated `execute_typescript` facade declarations for injected loaded callable `svvyx` extension
  facades.
- Generated package content production for `@svvyx/workflows` and `@svvyx/extensions`: source
  validation, generated file writes, atomic generated-root replacement, diagnostics, and exact
  workspace-link repair plan production. Runtime owns refresh scheduling and workspace-link repair
  application.
- Redaction hooks for extension output before runtime/state persist logs, command facts, artifacts,
  or transcript text.
- Builtin extension source folders:
  - `base-common`
  - `base-orchestrator`
  - `base-handler`
  - `base-workflow-task`
  - `shell`
  - `apply-patch`
  - `execute-typescript`
  - `extension-loading`
  - `extension-managing`
  - `request-user-input`
  - `thread-orchestration`
  - `thread-handling`
  - `artifacts`
  - `workflows`
  - `smithers`
  - `web`
  - `cx`
  - `git`
  - `github`
  - `external-instructions`
  - `facade-declarations`
  - `svvyx`

## Does Not Own

- Runtime turn orchestration.
- pi session creation.
- Durable state implementation.
- Persisted agent profile/settings records.
- Persisted extension env values, env status records, and encrypted secret storage.
- Queue insertion, claiming, ordering, retries, and delivery.
- Request-input answer recording, blocking wait registries, timeout scheduling/defaulting,
  nonblocking queued-answer delivery, command settlement, session-wait projection, and runtime
  notifications.
- Read-model projection for desktop panes.
- Artifact physical file storage.
- Sandbox policy semantics.
- Desktop UI rendering.
- Public packages for builtin subdomains.

Prompt and instruction source assets are owned by `@svvy/extensions`. Reusable workflow prompt
assets are app-global MDX source files under `~/.config/svvy/workflows/prompts/*.mdx` managed by
`@svvy/extensions`, and are emitted only as read-only generated prompt string/source exports in
`@svvyx/workflows`. Those generated prompt exports preserve validated prompt source text as raw
prompt string exports produced from MDX/source contributors by `@svvy/extensions`. The `Prompts`
namespace is not an editable source location; default actor prompts and extension instructions
remain extension-owned MDX/source contributors outside generated packages.

## Public API Shape

Effect-native service surface:

```ts
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import {
  ExtensionError,
  type ActorBinding,
  type BuiltinExtensionMaterializeResult,
  type ByteCount,
  type BuildExecuteTypescriptFacadeDeclarationsInput,
  type BuildGeneratedContextInput,
  type ExecuteTypescriptFacadeDeclarations,
  type ExtensionDependencyReadiness,
  type ExtensionEnvRequirements,
  type ExtensionEnvRequirementsInput,
  type ExtensionExecutionEnvPlan,
  type ExtensionRegistryInspection,
  type ExtensionRegistryListInput,
  type ExtensionRegistryListResult,
  type ExtensionStatePort,
  type ExternalInstructionScanInput,
  type ExternalInstructionScanResult,
  type ExternalInstructionUsageValidationResult,
  type GeneratedContext,
  type GeneratedPackageBuildInput,
  type GeneratedPackageBuildPlanResult,
  type GeneratedPackageWorkspaceLinkRepairInput,
  type GeneratedPackageWorkspaceLinkRepairPlan,
  type NativeToolDeclaration,
  type NativeToolHandlerLookupInput,
  CreateWorkflowAgentSourceInput,
  CreateWorkflowComponentSourceInput,
  CreateWorkflowPromptSourceInput,
  CreateWorkflowSourceInput,
  DeleteWorkflowComponentSourceInput,
  DeleteWorkflowAgentSourceInput,
  DeleteWorkflowPromptSourceInput,
  DeleteWorkflowSourceInput,
  DuplicateWorkflowAgentSourceInput,
  OpenExtensionSourceEditInput,
  type PlanExtensionExecutionEnvInput,
  type PositiveDurationMs,
  type RefreshExtensionDependencyReadinessInput,
  type ResetBuiltinExtensionSourceInput,
  type ResolveActorBindingInput,
  type SandboxLaunchFacts,
  SaveExtensionSourceEditInput,
  type ScaffoldMissingBuiltinSourcesInput,
  SourceEditSaveResult,
  SourceEditSession,
  type SvvyxRunInput,
  type SvvyxRunResult,
  type ValidateExternalInstructionActorUsageInput,
  WorkflowAgentSourceDeleteResult,
  WorkflowAgentSourceLifecycleResult,
  WorkflowComponentSourceDeleteResult,
  WorkflowComponentSourceLifecycleResult,
  WorkflowPromptSourceDeleteResult,
  WorkflowPromptSourceLifecycleResult,
  WorkflowWorkflowSourceDeleteResult,
  WorkflowWorkflowSourceLifecycleResult,
} from "@svvy/core";
import type {
  ExtensionRegistryInspectInput,
  ToolDeclarationInput,
  ToolMetadataInput,
} from "./extensions-service";
import type { ExtensionSourceRootsPort } from "./extension-source-roots-port";
import type { GeneratedPackageRootPort } from "./generated-package-root-port";
import type { NativeToolCommandMetadata } from "./native-tool-metadata";
import type { ExtensionHandler } from "./native-tool-handler-contracts";
import type { PackagedExtensionTemplatesPort } from "./packaged-extension-templates-port";
import type { WorkspaceSourceLinkPort } from "./workspace-source-link-port";

export class Extensions extends Context.Service<
  Extensions,
  {
    registry: {
      list(
        input: ExtensionRegistryListInput,
      ): Effect.Effect<ExtensionRegistryListResult, ExtensionError>;
      inspect(
        input: ExtensionRegistryInspectInput,
      ): Effect.Effect<ExtensionRegistryInspection, ExtensionError>;
    };
    actorBindings: {
      resolve(
        input: ResolveActorExtensionBindingInput,
      ): Effect.Effect<ActorExtensionBinding, ExtensionError>;
      visibleRecords(
        input: BuildVisibleExtensionRecordsInput,
      ): Effect.Effect<VisibleExtensionRecordsResult, ExtensionError>;
    };
    nativeTools: {
      declarations(
        input: ToolDeclarationInput,
      ): Effect.Effect<ReadonlyArray<NativeToolDeclaration>, ExtensionError>;
      metadata(
        input: ToolMetadataInput,
      ): Effect.Effect<ReadonlyArray<NativeToolCommandMetadata>, ExtensionError>;
      handler(input: NativeToolHandlerLookupInput): Effect.Effect<ExtensionHandler, ExtensionError>;
    };
    generatedPackages: {
      refresh(
        input: GeneratedPackageBuildInput,
      ): Effect.Effect<GeneratedPackageBuildPlanResult, ExtensionError>;
      planWorkspaceLink(
        input: GeneratedPackageWorkspaceLinkRepairInput,
      ): Effect.Effect<GeneratedPackageWorkspaceLinkRepairPlan, ExtensionError>;
    };
    sources: {
      openEditSession(
        input: OpenExtensionSourceEditInput,
      ): Effect.Effect<SourceEditSession, ExtensionError>;
      saveEditSession(
        input: SaveExtensionSourceEditInput,
      ): Effect.Effect<SourceEditSaveResult, ExtensionError>;
    };
  }
>()("@svvy/extensions/Extensions") {}

export const layer: Layer.Layer<
  Extensions,
  never,
  | ExtensionStatePort
  | ExtensionSourceRootsPort
  | PackagedExtensionTemplatesPort
  | WorkspaceSourceLinkPort
  | GeneratedPackageRootPort
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
> = Layer.effect(Extensions, makeExtensions());
```

The public `Extensions` service exposes registry reads, actor binding and visible-record helpers,
native tool declaration/metadata/handler lookup, generated-package refresh/link planning, and source
edit open/save sessions. Generated context building, `svvyx` dispatch, execute-typescript facade
declaration generation, env/dependency readiness, builtin scaffold/reset, external-instruction
scanning, and workflow source create/duplicate/delete lifecycle are package responsibilities exposed
only through the package-root contracts named by this spec and the package-boundary ledger; they are
not additional public `Extensions` service methods unless this spec names the exact method shape.

Layer construction is infallible: app/bootstrap must provide the required ports and platform
services, and typed `ExtensionError` failures are returned by service methods that read sources,
validate generated evidence, execute handlers, plan immutable dependency readiness/probe work, or
write generated outputs. "Plan dependency work" means producing declaration/readiness evidence or a
closed plan under a spec-named dependency helper port; it does not mean install/update admission,
package-manager execution, Shell access, ambient executable lookup, or durable command ownership.
`ExtensionError` is the core-owned closed tagged error
`{ _tag: "ExtensionError", extensionId?, operation, reason, message, issues?, cause? }`, where
`reason` is one of `"invalid-input"`, `"not-found"`, `"not-loaded"`,
`"dependency-not-ready"`, `"unsupported-operation"`, `"read-only-source"`,
`"execution-failed"`, or `"redaction-failed"`. Package specs may name product situations that map
to those reasons, but they do not create ad hoc extension error variants.

`ExtensionSourceRootsPort`, `WorkspaceSourceLinkPort`, `GeneratedPackageRootPort`, and
`PackagedExtensionTemplatesPort` are extension-owned package-local data-only host/config service
tags implemented by app/bootstrap. Every package-local host/config port exported by
`@svvy/extensions` declares an exact `*Port` identifier interface, exact `*PortService` shape,
`Context.Service<PortIdentifier, PortService>(id)` tag, and a `Layer.succeed` helper constructor for
app/bootstrap and tests. These service values are in-process Effect layer requirements; their service
objects do not require schemas merely because they are package-root layer requirements. Schemas are
required only for values returned by those services when the value is serialized, persisted, bridged,
logged as structured product facts, exposed through generated packages, or accepted from unknown
input. They resolve app config roots, workspace link targets, generated-package roots, and read-only
packaged builtin extension templates without importing desktop, runtime, state repositories, or
source-checkout-relative paths. They are app-bootstrap-only composition contracts for building
`Extensions.layer`. They are exported only as layer requirement types/helpers needed by the root
layer, not as public consumer services, runtime facades, renderer contracts, generated-package
exports, agent-facing APIs, or `@svvy/core` cross-package product ports. Alternate app consumers use
`Extensions` or runtime facades, not these host/config ports directly. No additional host/config
callback bag is public.

Package-root exports are intentionally wider than the `Extensions` service class because runtime,
app/bootstrap, and package-owned tests consume named pure extension catalogue helpers,
generated-package render helpers, native-tool metadata, native-tool handler factories, and
schema-backed native-tool input/result contracts as package-owned implementation contracts. The public root export ledger is
the boundary-tested symbol list in `packages/package-boundaries.test.ts`; every exported symbol must
fit one of these exact use cases:

- `Extensions`, `ExtensionsService`, `ExtensionsLayerRequirements`, `layer`, and `makeExtensions`
  for package composition and tests.
- package-local host/config port identifiers, service shapes, snapshots, and `Layer.succeed`
  helpers needed to provide `Extensions.layer`.
- builtin extension records, usage-state helpers, actor binding helpers, visible-record helpers,
  and CLI/dependency metadata used by app/bootstrap and runtime to build read models and generated
  context.
- native-tool metadata, schema JSON builders, handler contracts, and builtin handler factories for
  runtime-owned accepted-tool execution. Runtime may resolve handlers directly through
  `Extensions.nativeTools.handler(...)`; app/bootstrap and Bun bridge code may import the
  same package-owned helpers only where boundary tests allow it.
- selected generated-package render/discovery helpers and constants exported from the package root:
  `@svvyx/extensions` package name, extension export discovery/content/render helpers, extension
  reference helpers, and `renderGeneratedWorkflowsPackageFiles`; broader generated-package
  refresh/write/content helpers remain package-internal behind `Extensions.generatedPackages.refresh(...)`
  unless explicitly added to `src/index.ts` and the package-boundary ledger. Runtime still records
  committed generated-package facts through state ports and applies workspace links separately.
- schema codecs and result types for package-owned native-tool inputs/results such as
  `request_user_input` and `thread_start`.

These root exports are not renderer APIs, public runtime facades, generated-package SDKs,
agent-facing imports, durable state stores, dependency install/update admission, shell execution
surfaces, secret stores, or app-bootstrap callback policy. Adding a new root export requires the
same change to name its owner/use case in this section, add it to the package-boundary public-symbol
ledger, and add a focused test that proves the exported helper remains pure or remains behind the
`Extensions` service boundary as appropriate.

The root `layer` export acquires `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`,
`ExtensionStatePort`, `ExtensionSourceRootsPort`, `PackagedExtensionTemplatesPort`,
`GeneratedPackageRootPort`, and `WorkspaceSourceLinkPort` as layer requirements. Public
`Extensions` service methods close over those dependencies and do not expose implementation ports,
filesystem services, path services, crypto services, or operation scopes as per-call Effect
requirements. Package-private helpers may keep narrower requirement channels for local composition
and tests. Runtime consumes only the closed public `Extensions` service shape; app/bootstrap
supplies the package-local host/config ports when composing `Extensions.layer`.
`Extensions.layer` has no implicit process/dependency host requirements. Dependency probes and
source/build helpers either use only the listed layer requirements, or this spec first adds exact
package-local Effect service tags, method shapes, layer helpers, adoption-manifest rows, and tests.
Broad process/dependency host services are not valid layer requirements.

`ExtensionSourceRootsPort` is the app-owned source-root port for the whole `@svvy/extensions`
package, not only normal extension records. It resolves builtin extension source roots, user
extension source roots, and Workflows source-library roots under app-owned config locations,
including agents, prompts, components, and workflows. These source roots are owned by
`@svvy/extensions` service authority for validation, source edits, generated-context assembly, and
generated-package build/link planning; they are not public `@svvy/*` packages. Reusable Workflows
prompt/component/workflow files remain app-global/user editable source-library files. Prompts,
instructions, workflow-agent source files, workflow prompt MDX files, and extension source files are
all file-backed inputs consumed and validated by `@svvy/extensions` services.

`GeneratedPackageRootPort` resolves the named app-owned generated roots: generated
`@svvyx/extensions`, generated `@svvyx/workflows`, and the app-owned `@svvy/core` type-contract
package root. It never resolves workspace `.smithers/node_modules` paths. Workspace-specific link
locations are resolved through `WorkspaceSourceLinkPort` during explicit link-plan production, and
runtime applies those plans.

`ExtensionStatePort` is the restricted DB/product-state-backed read/input port consumed by
`@svvy/extensions`. It may read extension inventory, actor bindings, dependency/env readiness,
source fingerprints, extension reference eligibility, and recorded generated-package
facts needed to build or validate source. It does not write product state. `@svvy/extensions`
returns immutable validation evidence, source evidence, dependency evidence, generated-package
build evidence, diagnostics, and workspace-link plans to the caller. Persisted source
fingerprints, dependency readiness, source diagnostics, generated-context binding facts,
generated-package facts, workspace-link state, profile defaults, profile-level extension usage
overrides, actor usage/order mutations, runtime read-model facts, command rows, recovery rows, and
invalidation publication are owned by `@svvy/state` command facades or by `@svvy/runtime` through
runtime-facing `@svvy/state` ports after extension operations return.

`generatedPackages.refresh(...)` accepts `GeneratedPackageBuildInput.packages` containing either or
both canonical generated package names: `@svvyx/extensions` and `@svvyx/workflows`. Refreshing
`@svvyx/workflows` first refreshes `@svvyx/extensions` reference output inside the same app-global
build batch, then validates Workflows source against that reference set. A
package service that supports only `@svvyx/extensions` is incomplete.

Every explicit generated-package refresh, including `svvyx workflows build` and
`Runtime.sourceInvalidation.refreshGeneratedPackages(...)`, first performs or depends on a
same-batch deterministic source reread for the relevant file-backed domains. It must not trust
recorded source fingerprint rows as the only freshness check for the source files it is
about to build. Existing DB fingerprint rows are comparison inputs and previous-ready evidence, not
proof that the current filesystem contents have already been observed.

`@svvy/extensions` receives source-root, generated-root, workspace-link path, and platform services
through its package layer and declared ports. `@svvy/runtime` uses core-owned state ports supplied by
app/bootstrap composition when invoking generated-package operations. No broad runtime-service
adapter owns generated-package semantics: `@svvy/extensions` produces generated files and immutable
link plans, and `@svvy/runtime` applies those plans through primitive file-host operations and
records generated-package and workspace-link facts through core-owned state ports.

Actor usage/order mutations are state-owned commands. `@svvy/extensions` may validate discovered
external-instruction source references, actor/profile target eligibility, diagnostics, and
generated-context contribution semantics through supplied ports, but it does not call
`StateCommands`, `createStateCommandsFacade(...)`, or any state command facade, and it does not
apply DB-backed actor usage/order mutations. The persisted rows and after-commit invalidation
descriptors are owned by `@svvy/state`; runtime/desktop command surfaces call the state command
facade when a product command must change actor usage.

Bounded extension-owned helper work such as CLI requirement probes, generated instruction/source
builds, schema/declaration generation, and generated package validation/build steps returns
extension/build facts through extension-owned helper ports. Those helpers use only spec-named helper
ports and host layers admitted by `effect-v4.spec.md`; they do not own durable command sessions,
user-visible stdout/stderr streams, runtime command stdin/control, approval waits, sandbox policy,
cancellation, command inspectors, or terminal command facts. A handler that needs durable execution
returns an immutable command plan or `RuntimeEffectRequest` for `@svvy/runtime`.

Extension registry reads, actor binding resolution, dependency readiness checks, CLI requirement
probes, generated `@svvyx/extensions` reference-set discovery through Effect service calls, and
generated context builds are direct uncached Effect operations unless this spec adds a named
`Cache`, `ScopedCache`, `Resource`, `RcMap`, or `RcRef` owner with capacity or idle TTL,
lookup/acquire dependencies, invalidation owner, scope lifetime, release semantics, and tests.
Direct means the service evaluates its declared state/file/helper ports for that call. It does not
authorize `process.env`, Shell, Bun spawn, package-manager execution, ambient path lookup, runtime
command services, or hidden caches. Any subprocess/probe/helper authority requires an exact
extension-owned port tag, service shape, layer helper, timeout/redaction policy, Effect adoption rows,
boundary allowlist, and fake-helper tests in the same spec change.

`BuildGeneratedContextInput` and `GeneratedContext` are core-owned cross-package contracts imported
by `@svvy/extensions`. `@svvy/extensions` owns source contributor resolution, compilation,
validation, ordering, and assembly into these core-owned result shapes; it does not own a parallel
DTO shape.

`BuildGeneratedContextInput` is exact:

```ts
type BuildGeneratedContextInput = {
  actorKind: ActorKind;
  target:
    | { kind: "orchestrator"; workspaceSessionId: WorkspaceSessionId }
    | { kind: "handler"; workspaceSessionId: WorkspaceSessionId; threadId: ThreadId }
    | {
        kind: "workflow-task";
        workspaceSessionId: WorkspaceSessionId;
        workflowTaskAttemptId: WorkflowTaskAttemptId;
      };
  actorBinding: ActorBinding;
  workflowTaskInlineInstructions?: {
    sourceRecordId: string;
    sourceVersion: SourceFingerprint;
    text: string;
  };
  reason:
    | "surface-dispatch"
    | "surface-refresh"
    | "source-reconcile"
    | "generated-package-refresh"
    | "diagnostics";
};

type GeneratedContext = {
  fingerprint: GeneratedContextFingerprint;
  promptBlocks: readonly GeneratedContextPromptBlock[];
  nativeToolDeclarations: readonly NativeToolDeclaration[];
  svvyxGuidanceBlocks: readonly GeneratedContextPromptBlock[];
  executeTypescriptFacadeDeclarations: {
    text: string;
    emittedExtensionIds: readonly ExtensionId[];
  };
  tokenEstimate: number;
  sourceFingerprints: Readonly<Record<string, SourceFingerprint>>;
  diagnostics: readonly ExtensionDiagnostic[];
};

type GeneratedContextPromptBlock = {
  extensionId: ExtensionId;
  contributorId: string;
  sourceRecordId: string;
  sourceVersion: SourceFingerprint;
  sourcePath: AbsolutePath;
  sourceFingerprint: SourceFingerprint;
  text: string;
  tokenEstimate: number;
};
```

`GeneratedContext` contains ordered loaded extension blocks, compiled validated prompt text per
contributor, native tool declarations, loaded `svvyx` guidance, generated `execute_typescript`
facade declarations, token estimates, source fingerprints, contributor provenance, diagnostics, and
one aggregate fingerprint. MDX source is compiled and validated before this result is built;
generated context never contains MDX AST, JSX components, renderer components, secrets, generated
package imports, renderer previews, or duplicated state read-model fields.
Generated context also never contains Effect service names, `Context.Service` declarations, `Layer`
composition snippets, `ManagedRuntime` references, package-private port names, raw env plans, secret
references, dependency approval ledgers, generated-package manifest dependency evidence, workspace
link paths, or instructions that present generated `@svvyx/*` packages as runtime facades.
Generated-context source identity authority is the contributor/source record id plus source version
or fingerprint. `sourcePath` is provenance/display evidence and diagnostics context only; callers
must not use it as authority to read arbitrary files, decide ownership, or mutate source state.
`sourceFingerprints` is keyed by contributor/source record id, not by extension id, because one
extension may contribute multiple MDX or scripted instruction sources.

`nativeTools.declarations(...)` returns only currently loaded callable native tools for the supplied
actor binding. Available-but-not-loaded tools are exposed only through `list_extensions` and
generated context, not as pi-callable declarations. `nativeTools.handler(...)` rejects unknown,
unavailable, and available-but-unloaded tools for that actor binding before runtime creates
executable work beyond the rejected command fact.

`NativeToolHandlerLookupInput` is not just a tool name. It contains the actor kind, resolved actor
binding, target surface identity, extension usage source, and requested `toolName`. Runtime passes
the same resolved binding it used to generate pi tool declarations for the active turn. The handler
lookup succeeds only when that binding has the owning extension loaded for the actor, the tool is
declared by that extension for the actor, and `@svvy/extensions` owns the concrete handler
implementation. Tools whose declarations are owned by `@svvy/extensions` but whose execution is
owned by the accepted-tool runtime lane, including `exec_command`, `write_stdin`, `apply_patch`,
`execute_typescript`, `thread_current`, `thread_group`, `thread_list`, `thread_episodes`,
`thread_followup`, `thread_request_report`, and `thread_report`, are not resolved through
`nativeTools.handler(...)`. Their model-facing declarations still come from generated context, but
runtime executes them through its accepted native-tool command lane and package-private runtime
services. A rejected handler lookup returns `ExtensionError` before any extension handler receives
arguments or invocation env; runtime must not silently invent unimplemented handlers.

`SvvyxRunInput` and `SvvyxRunResult` are exact:

```ts
type SvvyxRunInput = {
  extensionId: ExtensionId;
  commandPath: readonly [string, ...string[]];
  input: JsonObject;
  origin: "shell-cli" | "execute-typescript-facade" | "internal-refresh";
  actorBinding: ActorBinding;
  invocation: {
    workspaceId: WorkspaceId;
    workspaceSessionId?: WorkspaceSessionId;
    surfacePiSessionId?: SurfacePiSessionId;
    threadId?: ThreadId;
    workflowTaskAttemptId?: WorkflowTaskAttemptId;
    sourceCommandId: CommandId;
  };
  env: ExtensionExecutionEnvPlan;
};

type SvvyxRunResult = {
  result: NativeToolResult;
  operations: readonly ExtensionRuntimeOperation[];
};
```

`SvvyxRunResult` contains exactly one model-facing command result plus ordered
`ExtensionRuntimeOperation` items. Runtime-owned work is always wrapped as
`{ kind: "runtime_effect", request }` or `{ kind: "execution_plan", plan }`. Raw command plans, raw
`RuntimeEffectRequest` arrays, raw `ExtensionExecutionPlan` arrays, callbacks, service handles,
process handles, command facts outside `NativeToolResult.details.commandFacts`, and renderer
payloads are not valid `SvvyxRunResult` fields.
`origin: "internal-refresh"` is reserved for runtime-owned source-invalidation or startup/recovery
lanes invoking a specific builtin extension command through the composed `Extensions` service after
runtime has accepted that work. User extension source, generated packages, Shell text, renderer
bridges, and `execute_typescript` snippets cannot select `internal-refresh`.
`SvvyxRunInput.env` is always an encoded, non-secret `ExtensionExecutionEnvPlan`; it may contain
literal non-secret values, required env keys, secret reference keys, redaction fingerprints, and
launch policy metadata. It is never an `ExtensionInvocationEnvSnapshot`, never contains raw
`secretValues`, and never grants in-process builtin dispatch access to managed secret material.

For shell-dispatched trusted builtin namespaces such as `artifacts`, `extensions`, and `workflows`,
the app-owned `svvyx` subprocess adapter may serialize a narrow subset of closed results as a signed
subprocess result payload. That payload is not an `@svvy/extensions` runtime service, not a state
port, and not a public runtime subpath. It is a process-bound transport that lets the parent
`@svvy/runtime` command session apply closed requests through the correct state/runtime ports after
validating the signature. Structured stdout/stderr and progress/app-log/command fact payloads emitted
by the child are runtime-decoded evidence only; authoritative command facts, progress rows, app logs,
and state mutations are created by the parent runtime command session after schema/signature
validation. It must not open SQLite, create state
facades, create a `ManagedRuntime`, call top-level `Effect.run*` from extension service code,
construct product state ports, publish product events, or choose session/thread/source command
ownership. The packaged `svvyx` process entrypoint may use the app-owned CLI process-edge runner
described in `effect-v4.spec.md`, but the subprocess adapter module is only a signed serialization
boundary; it does not own a product runtime graph.

Transport intents are deliberately narrow. The only current supported signed transport intent is:

- `runtime_effect.request`: parent decodes one
  `SvvyxRuntimeEffectTransportRequest` from `@svvy/core` and applies it through the owning
  command-session pipeline. The transport request shape is not the general `RuntimeEffectRequest`
  algebra: the only admitted variants are `extension_usage.context_impact` with target
  `"extension_usage" | "extension_usage_revert"` and `extension_snapshot.context_impact` with target
  `"snapshot_load"`, exactly as named by `SvvyxRuntimeEffectTransportRequestSchema`. Adding another
  signed transport intent or context-impact variant requires the exact core schema, extension command
  use case, runtime application path, redaction policy, and tests in the same change.

Artifact work does not have a signed svvyx transport intent. Artifact command metadata, schemas,
validation, and model-facing command descriptions live in `@svvy/extensions`. Artifact byte
materialization, deletion, digest calculation, staging cleanup, recovery, and metadata commits are
runtime-owned work applied by `@svvy/runtime` through package-private services and
`RuntimeArtifactStatePort`. `@svvy/extensions` may only return closed runtime-effect requests or
immutable execution plans that ask runtime to perform artifact work; it does not author artifact
bytes, stored paths, digests, lifecycle rows, or runtime/read-model notifications. Adding any
artifact transport intent requires a core-owned schema, a runtime-owned replay path, and
package-boundary tests in the same change.

The child-side result for these intents never contains affected-surface arrays, state facade calls,
or direct snapshot context-impact updates. Affected surfaces, stale generated-context facts, and
command facts are derived only by `@svvy/runtime` from committed state while applying the closed
runtime effect request.

Extension-owned source/build/readiness helpers such as version probes, source generators, and
generated package validation steps use bounded host helper ports named by this spec and must not
import `effect/unstable/process`. Durable Shell execution, `write_stdin`, dependency
installs/updates, `execute_typescript` runtime launches, and any user-visible command session are
runtime-owned.
Extension handlers return `ExtensionHandlerResult` values containing one model-facing result plus
ordered `ExtensionRuntimeOperation` items for those paths.

Layer dependencies are exact:

- `ExtensionStatePort` is the DB/product-state-backed port for extension inventory, actor bindings,
  dependency/env readiness, generated-context facts, source fingerprints, and read-only
  generated-package facts needed for validation, listing, and model-facing generated context.
  Generated extension reference discovery happens inside the `@svvy/extensions` Effect service path.
  It reads source fingerprints through
  `ExtensionStatePort.records.readSourceFingerprint(...)` and dependency approval facts through
  `ExtensionStatePort.dependencies.isApproved(...)`.
  Generated-package fact writes go through runtime-owned refresh/link lanes and
  `RuntimeGeneratedPackageStatePort`.
- `@svvy/extensions` does not receive artifact state or artifact file-store ports. Artifact command
  metadata, schemas, validation, and model-facing command descriptions live here; runtime owns
  artifact byte materialization, deletion, recovery, and the subsequent metadata commit through
  `RuntimeArtifactStatePort`.
- `ExtensionSourceRootsPort` resolves app-config/user source roots such as
  `~/.config/svvy/extensions/sources/...`.
- `PackagedExtensionTemplatesPort` resolves read-only packaged builtin prompt/instruction/source
  templates through the package-local data-only host/config tag pattern.
- `WorkspaceSourceLinkPort` resolves only canonical workspace package-link path candidates for
  immutable link-plan production, such as `<workspace>/.smithers/node_modules/@svvyx/<package>`. It
  does not create, remove, rewrite, validate against active workspace state, or persist link facts.
  Runtime applies link plans and records workspace-link facts through state ports.
- `GeneratedPackageRootPort` resolves app-owned generated roots, including the two `@svvyx/*`
  workspace-link targets and the app-owned `@svvy/core` type-contract package root.
  `WorkspaceSourceLinkPort` resolves workspace link path candidates.
- `FileSystem.FileSystem` and `Path.Path` perform file-backed source, template, generated-package, and
  link effects. Implementations must not use untracked `fs` calls outside these services.

Package API surface includes:

```text
import { Extensions } from "@svvy/extensions";

const extensions = yield* Extensions;
const actorBinding = {
  actorKind: "orchestrator",
  loadedExtensionIds: ["shell", "request-user-input"],
  availableExtensionIds: ["web"],
  unavailableExtensionIds: [],
  instructionOrder: ["shell", "request-user-input"],
  source: "surface-binding",
} satisfies ActorBinding;
const declarations =
  yield*
  extensions.nativeTools.declarations({
    actorKind: "orchestrator",
    actorBinding,
  });
const metadata =
  yield*
  extensions.nativeTools.metadata({
    actorKind: "orchestrator",
    actorBinding,
  });
```

The `Extensions` service shape above is the canonical public Effect service shape. API groups listed
below are public only when represented in that service shape or in a deliberately exported package
subpath. Internal builtin/source folders are not public API groups.

Every input, result, and public helper type named in the `Extensions` service shape is a package
contract, not prose-only intent. Every exported service group has an owning module that defines:

- an exact Effect Schema for every input and encoded result that crosses a package, runtime,
  generated-package, command-fact, read-model, app-log, or bridge boundary
- a TypeScript type derived from that schema
- hoisted boundary helpers using the Effect codec naming convention:
  `decodeUnknown<TypeName>Effect` for unknown inbound payloads, `decode<TypeName>Effect` only for
  already-encoded typed inputs, `decodeUnknown<TypeName>Exit` for non-Effect bridge/test mapping,
  and `encode<TypeName>Effect` / `encode<TypeName>Exit` for outbound payloads when the value
  crosses a boundary
- examples for one successful request and one rejected request
- package-boundary tests proving the group does not import runtime, desktop, pi-native objects,
  raw state repositories, generated package outputs, or source-checkout-relative paths

If a group is package-private, it must be moved out of this public `Extensions` service shape and
kept behind an internal module that is not exported from `@svvy/extensions`.

## Operation Contract Ledger

Every current public `Extensions` service method has one ledger row. Additional extension-owned
operation contracts can appear in this ledger only as target package contracts; they are not callable
as `Extensions` service methods unless the canonical service shape above names the exact group and
method. A method, operation contract, or subpath not present here is not part of the package
contract. Package-private implementation modules are not public helper categories. The exact schema
symbol names are owned by `@svvy/core` when the shape crosses packages; extension-local schemas are
allowed only for package-private file/source implementation functions that are encoded before
leaving `@svvy/extensions`.
Source edit request/result contracts used by `Runtime.sourceEdits` are owned by `@svvy/core` in
`runtime-source-edit-contracts`. `@svvy/extensions` imports those contracts from `@svvy/core` and
owns only the file-backed implementation semantics behind `Extensions.sources.*`.

| Method / public subpath                     | Owner group                                      | Input schema                                          | Encoded result schema                              | Effect requirements                                                                                                                                                                       | State/file backing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | May write files                                                                                                                                                                                                                                            | May write state | May schedule runtime work                                                                                                                                                           | Boundary tests                                                                                  |
| ------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `registry.list`                             | `Extensions.registry`                            | `ExtensionRegistryListInputSchema`                    | `ExtensionRegistryListResultSchema`                | `ExtensionStatePort`, source-root ports as needed                                                                                                                                         | DB-backed extension/profile/readiness facts plus file-backed external-instruction/source evidence                                                                                                                                                                                                                                                                                                                                                                                                                                          | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | list filters, source-kind redaction, no runtime/state implementation imports                    |
| `registry.inspect`                          | `Extensions.registry`                            | `ExtensionRegistryInspectInputSchema`                 | `ExtensionRegistryInspectionSchema`                | `ExtensionStatePort`, source-root ports as needed                                                                                                                                         | DB-backed records and file-backed source metadata only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | inspect builtin/user/external instruction, missing id, no source content unless schema names it |
| `actorBindings.resolve`                     | `Extensions.actorBindings`                       | `ResolveActorBindingInputSchema`                      | `ActorBindingSchema`                               | `ExtensionStatePort`                                                                                                                                                                      | DB-backed profile/binding rows; generated-context cache refs when already recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                         | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | orchestrator/handler/workflow binding, usage override ordering, no prompt duplication           |
| `generatedContext.build`                    | `Extensions.generatedContext`                    | `BuildGeneratedContextInputSchema`                    | `GeneratedContextSchema`                           | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, extension source/template ports                                                                                                    | extension-owned MDX/source instruction contributors, workflow-agent `.agent.json` inline instruction text managed and validated by `@svvy/extensions`, and DB-backed binding/source facts; workflow-agent inline instruction text is not reusable prompt source, generated `Prompts` output, or an extension instruction contributor; reusable Workflows Prompt MDX backs generated `@svvyx/workflows.Prompts` output and does not enter actor generated context unless an explicit loaded extension instruction contributor references it | optional cache files only when the result schema records cache evidence                                                                                                                                                                                    | no              | no                                                                                                                                                                                  | generated prompt order, cache evidence, external-instruction metadata/content boundary          |
| `nativeTools.declarations`                  | `Extensions.nativeTools`                         | `ToolDeclarationInputSchema`                          | `NativeToolDeclarationListSchema`                  | `ExtensionStatePort`, source/template ports as needed                                                                                                                                     | DB-backed enablement/readiness and file-backed declaration source                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | declaration schema validation, actor filtering, no runtime effects in declaration lookup        |
| `nativeTools.metadata`                      | `Extensions.nativeTools`                         | `ToolMetadataInputSchema`                             | `NativeToolCommandMetadataResultSchema`            | `ExtensionStatePort`, source/template ports as needed                                                                                                                                     | DB-backed enablement/readiness and file-backed command metadata source                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | metadata schema validation, actor filtering, no runtime effects in metadata lookup              |
| `nativeTools.handler`                       | `Extensions.nativeTools`                         | `NativeToolHandlerLookupInputSchema`                  | Effect-local `ExtensionHandler`; no encoded result | sandbox/runtime-operation-free extension handler dependencies declared by the tool                                                                                                        | decoded invocation plus file/source evidence named by the handler                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | no; file effects are returned as runtime-owned `ExtensionExecutionPlan` or `RuntimeEffectRequest` operations                                                                                                                                               | no              | returns runtime operation items through `ExtensionHandlerResult` only                                                                                                               | accepted tool validation, model-facing result, ordered runtime operations, no state writes      |
| `svvyx.run`                                 | `Extensions.svvyx`                               | `SvvyxRunInputSchema`                                 | `SvvyxRunResultSchema`                             | source/template ports, generated package evidence, declared command dependencies                                                                                                          | file-backed extension command definitions and generated declaration files                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | no direct durable writes from `svvyx.run`; source writes and generated-package writes occur only in specific `Extensions.sources.*` or `Extensions.generatedPackages.*` service methods invoked by runtime-owned lanes after a validated operation/request | no              | returns `ExtensionRuntimeOperation` items only; runtime owns applying requests, executing plans, refreshing generated packages, recording state facts, and publishing notifications | command dispatch, generated declaration match, no hidden runtime RPC                            |
| `executeTypescriptFacadeDeclarations.build` | `Extensions.executeTypescriptFacadeDeclarations` | `BuildExecuteTypescriptFacadeDeclarationsInputSchema` | `ExecuteTypescriptFacadeDeclarationsSchema`        | source/template ports and generated package read evidence                                                                                                                                 | file-backed extension command definitions and generated declaration text                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | no durable `@svvyx/*` package writes; may render extension-owned declaration text or build evidence only when the owning extension build contract names that artifact                                                                                      | no              | no                                                                                                                                                                                  | command declaration exactness, no `workflow.*` or `svvyx smithers` runtime tool surface         |
| `sources.openEditSession`                   | `Extensions.sources`                             | `OpenExtensionSourceEditInputSchema`                  | `SourceEditSessionSchema`                          | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, source-root ports                                                                                                                  | file-backed editable source bytes plus file fingerprint evidence; authoritative `sourceVersion` values are supplied only by runtime from `RuntimeSourceStatePort` on the runtime facade result                                                                                                                                                                                                                                                                                                                                             | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | readonly rejection, source evidence receipt, no generated-output edit                           |
| `sources.saveEditSession`                   | `Extensions.sources`                             | `SaveExtensionSourceEditInputSchema`                  | `SourceEditSaveResultSchema`                       | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, source-root ports                                                                                                                  | file-backed source bytes; runtime admits CAS against DB-backed source-version facts before calling this method, and state facts are written later by runtime through `RuntimeSourceStatePort`                                                                                                                                                                                                                                                                                                                                              | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | admitted CAS file write, atomic write, file-write/state-fail recovery handoff                   |
| `sources.createWorkflowAgent`               | `Extensions.sources`                             | `CreateWorkflowAgentSourceInputSchema`                | `WorkflowAgentSourceLifecycleResultSchema`         | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, workflow-agent source root                                                                                                         | file-backed `~/.config/svvy/workflows/agents/*.agent.json`; state stores fingerprint/index facts later                                                                                                                                                                                                                                                                                                                                                                                                                                     | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | builtin-name rejection, duplicate source rejection, source fact evidence                        |
| `sources.duplicateWorkflowAgent`            | `Extensions.sources`                             | `DuplicateWorkflowAgentSourceInputSchema`             | `WorkflowAgentSourceLifecycleResultSchema`         | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, workflow-agent source root                                                                                                         | file-backed workflow-agent source; state stores fingerprint/index facts later                                                                                                                                                                                                                                                                                                                                                                                                                                                              | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | duplicate actor source, exact extension override preservation                                   |
| `sources.deleteWorkflowAgent`               | `Extensions.sources`                             | `DeleteWorkflowAgentSourceInputSchema`                | `WorkflowAgentSourceDeleteResultSchema`            | `FileSystem.FileSystem`, `Path.Path`, workflow-agent source root                                                                                                                          | file-backed workflow-agent source; state stores deletion/source-version facts later                                                                                                                                                                                                                                                                                                                                                                                                                                                        | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | reject default agent delete, stale source delete, recovery after file/state mismatch            |
| `sources.createWorkflowPrompt`              | `Extensions.sources`                             | `CreateWorkflowPromptSourceInputSchema`               | `WorkflowPromptSourceLifecycleResultSchema`        | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, workflow-prompt source root                                                                                                        | file-backed `~/.config/svvy/workflows/prompts/<exportName>.mdx`; state stores fingerprint/index facts later                                                                                                                                                                                                                                                                                                                                                                                                                                | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | duplicate prompt rejection, MDX/source validation, source fact evidence                         |
| `sources.deleteWorkflowPrompt`              | `Extensions.sources`                             | `DeleteWorkflowPromptSourceInputSchema`               | `WorkflowPromptSourceDeleteResultSchema`           | `FileSystem.FileSystem`, `Path.Path`, workflow-prompt source root                                                                                                                         | file-backed workflow-prompt source; state stores deletion/source-version facts later                                                                                                                                                                                                                                                                                                                                                                                                                                                       | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | stale delete, readonly/builtin rejection, recovery after file/state mismatch                    |
| `sources.createWorkflowComponent`           | `Extensions.sources`                             | `CreateWorkflowComponentSourceInputSchema`            | `WorkflowComponentSourceLifecycleResultSchema`     | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, workflow-component source root                                                                                                     | file-backed `~/.config/svvy/workflows/components/<exportName>.ts` or `<exportName>.tsx`; state stores fingerprint/index facts later                                                                                                                                                                                                                                                                                                                                                                                                        | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | duplicate component rejection, export validation, source fact evidence                          |
| `sources.deleteWorkflowComponent`           | `Extensions.sources`                             | `DeleteWorkflowComponentSourceInputSchema`            | `WorkflowComponentSourceDeleteResultSchema`        | `FileSystem.FileSystem`, `Path.Path`, workflow-component source root                                                                                                                      | file-backed workflow-component source; state stores deletion/source-version facts later                                                                                                                                                                                                                                                                                                                                                                                                                                                    | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | stale delete, generated-package refresh scheduling evidence, recovery after file/state mismatch |
| `sources.createWorkflow`                    | `Extensions.sources`                             | `CreateWorkflowSourceInputSchema`                     | `WorkflowWorkflowSourceLifecycleResultSchema`      | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, workflow source root                                                                                                               | file-backed `~/.config/svvy/workflows/workflows/<exportName>.tsx`; state stores fingerprint/index facts later                                                                                                                                                                                                                                                                                                                                                                                                                              | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | duplicate workflow rejection, workflow export validation, source fact evidence                  |
| `sources.deleteWorkflow`                    | `Extensions.sources`                             | `DeleteWorkflowSourceInputSchema`                     | `WorkflowWorkflowSourceDeleteResultSchema`         | `FileSystem.FileSystem`, `Path.Path`, workflow source root                                                                                                                                | file-backed workflow source; state stores deletion/source-version facts later                                                                                                                                                                                                                                                                                                                                                                                                                                                              | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | stale delete, generated-package refresh scheduling evidence, recovery after file/state mismatch |
| `generatedPackages.refresh`                 | `Extensions.generatedPackages`                   | `GeneratedPackageBuildInputSchema`                    | `GeneratedPackageBuildPlanResultSchema`            | `Extensions.layer` closes over `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, source/template/generated-root ports                                                                | file-backed generated package roots and manifests; DB generated-package facts are written by runtime/state ports after success                                                                                                                                                                                                                                                                                                                                                                                                             | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | atomic replacement, failed build preserves prior ready package, manifest/state reconciliation   |
| `generatedPackages.planWorkspaceLink`       | `Extensions.generatedPackages`                   | `GeneratedPackageWorkspaceLinkRepairInputSchema`      | `GeneratedPackageWorkspaceLinkRepairPlanSchema`    | `Extensions.layer` closes over `FileSystem.FileSystem`, `Path.Path`, `WorkspaceSourceLinkPort`, `GeneratedPackageRootPort`                                                                | file-backed generated output root plus workspace link path candidates                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | missing package diagnostic, no source-checkout link target, no state write                      |
| `env.requirements`                          | `Extensions.env`                                 | `ExtensionEnvRequirementsInputSchema`                 | `ExtensionEnvRequirementsSchema`                   | `ExtensionStatePort` plus core-owned redacted secret-status/read ports only when named by `core.spec.md`; no raw secret-value port                                                        | DB-backed env declarations/readiness and state-owned secret status; no raw secret values                                                                                                                                                                                                                                                                                                                                                                                                                                                   | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | secret redaction, missing env readiness, no raw secret output                                   |
| `env.planExecutionEnv`                      | `Extensions.env`                                 | `PlanExtensionExecutionEnvInputSchema`                | `ExtensionExecutionEnvPlanSchema`                  | `ExtensionStatePort` plus core-owned redacted secret-status/read ports only when named by `core.spec.md`; raw values resolve only at runtime trusted invocation through `SecretStorePort` | DB-backed env declarations/readiness, secret reference keys, redaction fingerprints, and launch-policy metadata; no raw secret values                                                                                                                                                                                                                                                                                                                                                                                                      | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | secret redaction, command env planning, no raw secret output                                    |
| `dependencies.refreshReadiness`             | `Extensions.dependencies`                        | `RefreshExtensionDependencyReadinessInputSchema`      | `ExtensionDependencyReadinessSchema`               | only the root `Extensions.layer` requirements unless this spec first names an exact dependency-probe port tag, service shape, layer helper, and fake tests                                | file-backed extension manifests plus DB-backed approval/readiness facts                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | readiness refresh, approval fact mismatch, no dependency mutation                               |
| `builtin.scaffoldMissing`                   | `Extensions.builtin`                             | `ScaffoldMissingBuiltinSourcesInputSchema`            | `BuiltinExtensionMaterializeResultSchema`          | `FileSystem.FileSystem`, `Path.Path`, `PackagedExtensionTemplatesPort`                                                                                                                    | packaged builtin templates and app-owned user extension root                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | packaged template missing, missing-only behavior, no source-checkout template path              |
| `builtin.resetSource`                       | `Extensions.builtin`                             | `ResetBuiltinExtensionSourceInputSchema`              | `BuiltinExtensionMaterializeResultSchema`          | `FileSystem.FileSystem`, `Path.Path`, `PackagedExtensionTemplatesPort`                                                                                                                    | packaged builtin templates and app-owned user extension root                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | yes                                                                                                                                                                                                                                                        | no              | no                                                                                                                                                                                  | packaged template missing, explicit reset/CAS behavior, no source-checkout template path        |
| `externalInstructions.scan`                 | `Extensions.externalInstructions`                | `ExternalInstructionScanInputSchema`                  | `ExternalInstructionScanResultSchema`              | `FileSystem.FileSystem`, `Path.Path`, `Crypto.Crypto`, source-root ports                                                                                                                  | host/workspace read-only Markdown instruction files; state stores metadata/fingerprint/read diagnostics later                                                                                                                                                                                                                                                                                                                                                                                                                              | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | metadata/content split, read failure diagnostic, no prompt-context content duplication          |
| `externalInstructions.validateActorUsage`   | `Extensions.externalInstructions`                | `ValidateExternalInstructionActorUsageInputSchema`    | `ExternalInstructionUsageValidationResultSchema`   | `ExtensionStatePort`, source-root ports as needed                                                                                                                                         | DB-backed actor usage facts plus host/workspace read-only instruction metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                             | no                                                                                                                                                                                                                                                         | no              | no                                                                                                                                                                                  | actor usage validation, unavailable instruction, no prompt-context content duplication          |

Handler and extension-owned `svvyx` operation dependency authority is closed by the operation row
plus these rules:

- Handler-local dependencies must be declared in the extension manifest/tool declaration and
  resolved through `Extensions.layer` requirements named by this spec. They do not grant sandbox,
  runtime command, Shell, package-manager, process, ambient env, or raw secret authority.
- `svvyx` declared command dependencies mean declaration/readiness evidence and immutable
  execution-plan construction only. The operation does not receive process spawners,
  package-manager runners, Shell access, install/update admission, runtime command services,
  ambient executable lookup, or raw env/secret values.
- Extension-owned declaration text or build evidence can be rendered only when the extension
  manifest/build schema names the exact artifact id, source-record id, generated output path, and
  redaction policy. No handler may discover hidden declaration/build files by globbing paths.

Runtime consumes `Extensions.generatedPackages.refresh(...)` only from its generated-package refresh
lane; workspace-link repair uses `Extensions.generatedPackages.planWorkspaceLink(...)` and
runtime-owned state, recovery, file-host, and notification boundaries.

`svvyx workflows build` returns a model-facing command result plus one ordered
`ExtensionRuntimeOperation` wrapping `generated_packages.refresh` for both canonical packages.
`@svvy/runtime` maps that request to
`Runtime.sourceInvalidation.refreshGeneratedPackages({ scope: "app-global" })`, calls
`Extensions.generatedPackages.refresh(...)`, records generated-package facts through state ports
after atomic output replacement, and only then schedules `workspace-link-repair` work for acquired
workspaces. The Workflows extension command itself does not build generated roots, record state
facts, apply workspace links, or publish invalidations.

The model-facing command result distinguishes app-global generated-package build state from
workspace import readiness. It may report:

- `generatedPackages: "ready" | "failed"` for the app-global build result after runtime records the
  committed generated-package facts.
- `workspaceImports: "ready" | "pending" | "failed" | "not-applicable"` for the current workspace
  only when the runtime call has a workspace target. `ready` requires committed workspace-link facts
  for both canonical packages and resolved workspace Smithers dependency readiness. `pending` means
  runtime scheduled link repair/recovery but has not committed a ready or failed workspace-link
  status. `failed` means runtime committed a blocked/missing link or workspace dependency
  diagnostic. App-global build success alone never implies workspace import readiness.

## Public Service DTOs

The DTOs below are the public contracts for the registry, actor binding, and native tool
groups in `Extensions`. These are package contracts, not renderer DTOs. Runtime and desktop do not
add fields to these values; if they need more information they call a state read model.

```ts
type ExtensionRegistryListInput = {
  actorKind?: ActorKind;
  profileId?: AgentProfileId;
  target?: ExtensionActorTarget;
  categories?: readonly ("builtin" | "user" | "external_instruction")[];
  interfaceKinds?: readonly ("instructions" | "native_tool" | "svvyx" | "mixed")[];
  availability?: "available-only" | "all";
};

type ExtensionRegistryListResult = {
  records: readonly ExtensionRegistryInspection[];
};

type ExtensionRegistryInspectInput = {
  id: ExtensionId;
  actorKind?: ActorKind;
  profileId?: AgentProfileId;
  target?: ExtensionActorTarget;
};

type ExtensionRegistryInspection = {
  id: ExtensionId;
  title: string;
  description: string;
  category: "builtin" | "user" | "external_instruction";
  interfaceKind: "instructions" | "native_tool" | "svvyx" | "mixed";
  source:
    | { kind: "builtin-extension"; editable: boolean; sourceRoot: AbsolutePath }
    | { kind: "user-extension"; sourceRoot: AbsolutePath }
    | { kind: "external-instruction"; path: AbsolutePath; readOnly: true };
  defaultUsage: Partial<Record<ActorKind, "loaded" | "available" | "unavailable">>;
  readiness: {
    status: "ready" | "missing-dependency" | "build-failed" | "disabled" | "unknown";
    diagnostics: readonly string[];
    updatedAt: IsoDateTimeString | null;
  };
  tags: readonly string[];
};

type ExtensionActorTarget =
  | { kind: "orchestrator"; workspaceSessionId: WorkspaceSessionId }
  | { kind: "handler"; workspaceSessionId: WorkspaceSessionId; threadId: ThreadId }
  | {
      kind: "workflow-task";
      workspaceSessionId: WorkspaceSessionId;
      workflowTaskAttemptId: WorkflowTaskAttemptId;
    };

type ExtensionInvocationTarget =
  | {
      kind: "orchestrator";
      workspaceSessionId: WorkspaceSessionId;
      surfacePiSessionId: SurfacePiSessionId;
    }
  | {
      kind: "handler";
      workspaceSessionId: WorkspaceSessionId;
      threadId: ThreadId;
      surfacePiSessionId: SurfacePiSessionId;
    }
  | {
      kind: "workflow-task";
      workspaceSessionId: WorkspaceSessionId;
      workflowTaskAttemptId: WorkflowTaskAttemptId;
      surfacePiSessionId: SurfacePiSessionId;
    };

type ResolveActorBindingInput = {
  actorKind: ActorKind;
  profileId?: AgentProfileId;
  target: ExtensionActorTarget;
  overrides?: Readonly<Record<ExtensionId, "loaded" | "available" | "unavailable">>;
};

type ActorBinding = {
  actorKind: ActorKind;
  loadedExtensionIds: readonly ExtensionId[];
  availableExtensionIds: readonly ExtensionId[];
  unavailableExtensionIds: readonly ExtensionId[];
  instructionOrder: readonly ExtensionId[];
  source: "profile-default" | "surface-binding" | "workflow-agent-source";
};

type ToolDeclarationInput = {
  actorKind: ActorKind;
  actorBinding: ActorBinding;
};

type ToolMetadataInput = {
  actorKind: ActorKind;
  actorBinding: ActorBinding;
  toolName?: NativeToolName;
};

type NativeToolHandlerLookupInput = {
  toolName: NativeToolName;
  actorKind: ActorKind;
  actorBinding: ActorBinding;
  target: ExtensionInvocationTarget;
  extensionUsageSource: "surface-binding" | "profile-default" | "workflow-agent-source";
};
```

All `ExtensionInvocationTarget` values use the `kind` discriminant. `surface` is not a valid field
on extension invocation targets. Runtime converts core `RuntimeSurfaceTarget.surface` values into
extension `ExtensionInvocationTarget.kind` before calling `Extensions.nativeTools.handler(...)`.

Validation rules:

- `registry.inspect(...)` rejects unknown extension ids with `ExtensionError.reason: "not-found"`.
- `actorBindings.resolve(...)` rejects actor/extension usage combinations not allowed by the
  extension record instead of silently dropping the requested override.
- `nativeTools.declarations(...)` returns only tools whose owning extension is in
  `actorBinding.loadedExtensionIds` and whose actor availability is loaded for `actorKind`.
- `nativeTools.metadata(...)` uses the same loaded/actor eligibility filter as declarations; if
  `toolName` is supplied and the tool is not loaded for that actor, it returns an empty array rather
  than package-private metadata.
- `nativeTools.handler(...)` requires the exact actor binding used to emit pi declarations for the
  active turn. Tool-name-only lookup is invalid even if the tool exists globally.

The package entrypoint owns the `Extensions` service, extension registry, actor binding resolver,
generated-context builder, native-tool declaration records, command metadata, handlers, `svvyx`
dispatcher, generated `execute_typescript` facade declaration builder, env/dependency planners,
source edit services, builtin source lifecycle, external-instruction scan services, and
generated-package refresh service.

Artifact metadata schemas, validation, and model-facing command descriptions live in
`@svvy/extensions`. Closed runtime requests or plans may describe artifact work, but
`@svvy/runtime` owns artifact byte materialization, deletion, recovery, and metadata commit through
`RuntimeArtifactStatePort`; extensions must not receive a raw file-store port, artifact state port,
or any direct mutation surface for artifact bytes or artifact metadata.

Non-Effect facade:

`@svvy/extensions` exposes no non-Effect facade. Registry inspection, native-tool metadata
inspection, generated-context building, declaration generation, source edits, dependency planning,
generated-package refresh, `svvyx` dispatch, and handler execution are all Effect-native package
service calls. Browser-tool or headless diagnostics that need extension information must go through
a runtime/app-owned facade that already has a composed `ManagedRuntime`, or through an explicit
diagnostics subpath specified here with exact methods and package-boundary tests.
Agent-authored `execute_typescript` snippets may receive Promise-returning injected extension
adapters from the runtime-owned `execute_typescript` invocation context; those adapters are not
package-root facades, are not generated-package imports, and are not exported from
`@svvy/extensions`.

## Public Service Group Examples

The examples below are normative contract examples for the `Extensions` Effect service.
They show package inputs and package outputs only. They do not show runtime queue rows, state
transactions, renderer pane state, pi-native objects, process handles, or generated package imports.
Every rejected example fails with `ExtensionError` before the service returns a successful value,
except compare-and-swap source saves, whose conflict is the typed `{ status: "stale" }`
`SourceEditSaveResult` because the caller needs the current source version and file text to resolve
the edit conflict.

### `registry`

Use case: read extension inventory for an actor/profile picker, generated-context diagnostics, or
agent-facing `list_extensions` output. Backing: DB/product-state-backed extension records plus
file-backed source/build readiness facts read through `ExtensionStatePort`; packaged builtin
templates only scaffold/reset missing source.

Success:

```text
yield* extensions.registry.inspect({ id: "workflows" });
// => {
//   id: "workflows",
//   title: "Workflows",
//   interfaceKind: "svvyx",
//   category: "builtin",
//   defaultUsage: { handler: "loaded", orchestrator: "unavailable", "workflow-task": "unavailable" },
//   source: {
//     kind: "builtin-extension",
//     editable: true,
//     sourceRoot: "/Users/example/.config/svvy/extensions/sources/builtin/workflows",
//   },
//   readiness: { status: "ready", diagnostics: [], updatedAt: null },
// }
```

Rejected:

```text
yield* extensions.registry.inspect({ id: "unknown-extension" });
// fails ExtensionError {
//   operation: "extensions.registry.inspect",
//   reason: "not-found",
//   extensionId: "unknown-extension",
//   message: "Extension record does not exist: unknown-extension",
// }
```

### `actorBindings`

Use case: resolve which extension ids are loaded, available, and unavailable for one concrete actor
before generated context, native-tool declarations, or `execute_typescript` declarations are built.
Backing: DB/product-state-backed profile/default usage facts plus builtin extension defaults.

Success:

```text
yield*
  extensions.actorBindings.resolve({
    actorKind: "handler",
    profileId: "profile_thread_handler",
    target: { kind: "handler", workspaceSessionId: "workspace_session_01", threadId: "thread_01" },
    overrides: { workflows: "loaded", github: "available" },
  });
// => {
//   actorKind: "handler",
//   loadedExtensionIds: ["base-common", "base-handler", "extension-loading", "shell", "workflows"],
//   availableExtensionIds: ["github"],
//   unavailableExtensionIds: ["thread-orchestration"],
//   instructionOrder: ["base-common", "base-handler", "shell", "workflows"],
// }
```

Rejected:

```text
yield*
  extensions.actorBindings.resolve({
    actorKind: "workflow-task",
    profileId: "profile_workflow_task",
    target: {
      kind: "workflow-task",
      workspaceSessionId: "workspace_session_01",
      workflowTaskAttemptId: "attempt_01",
    },
    overrides: { "thread-orchestration": "loaded" },
  });
// fails ExtensionError {
//   operation: "extensions.actorBindings.resolve",
//   reason: "invalid-input",
//   extensionId: "thread-orchestration",
//   message: "Extension thread-orchestration is not loadable for workflow-task actors.",
// }
```

### `generatedContext`

Use case: build the exact actor prompt/tool/declaration context that runtime binds to a surface
before the next prompt-bearing pi dispatch. Backing: file-backed extension instruction source,
DB/product-state-backed extension usage/readiness facts, and generated output facts; runtime stores
the resulting context fingerprint and surface binding through `@svvy/state`.
`generatedContext.build` reads the current local editable source under the scaffolded/reset
extension source roots. Packaged builtin templates are never live generated-context source; they are
read only by `builtin.scaffoldMissing` and `builtin.resetSource` to materialize editable source.

Success:

```text
yield*
  extensions.generatedContext.build({
    actorKind: "orchestrator",
    target: { kind: "orchestrator", workspaceSessionId: "workspace_session_01" },
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["base-common", "base-orchestrator", "shell", "apply-patch"],
      availableExtensionIds: ["github"],
      unavailableExtensionIds: [],
      instructionOrder: ["base-common", "base-orchestrator", "shell", "apply-patch"],
      source: "surface-binding",
    },
    reason: "surface-dispatch",
  });
// => {
//   fingerprint: "generated_context_fingerprint_01",
//   promptBlocks: [
//     {
//       extensionId: "base-common",
//       contributorId: "instructions/full/000-common.mdx",
//       sourcePath: "/config/svvy/extensions/sources/builtin/base-common/instructions/full/000-common.mdx",
//       text: "You are svvy's shared coding agent runtime. Follow repository instructions and keep product state authoritative.",
//       sourceFingerprint: "sha256:base-common-01",
//       tokenEstimate: 19,
//     },
//     {
//       extensionId: "shell",
//       contributorId: "instructions/full/010-shell.mdx",
//       sourcePath: "/config/svvy/extensions/sources/builtin/shell/instructions/full/010-shell.mdx",
//       text: "Use exec_command for shell work and keep long-running commands attached to their command session.",
//       sourceFingerprint: "sha256:shell-01",
//       tokenEstimate: 17,
//     },
//   ],
//   nativeToolDeclarations: [
//     {
//       name: "exec_command",
//       label: "exec_command",
//       description: "Execute a shell command in the current workspace. Returns stdout and stderr. Use this for command-family work such as svvyx, git, gh, cx, smithers, tests, and builds.",
//       parameters: {
//         type: "object",
//         additionalProperties: false,
//         required: ["cmd"],
//         properties: {
//           cmd: { type: "string", minLength: 1, description: "Shell command to execute." },
//           workdir: {
//             type: "string",
//             minLength: 1,
//             description: "Working directory for the command. Defaults to the workspace root.",
//           },
//           timeout: { type: "number", description: "Timeout in seconds." },
//         },
//       },
//     },
//   ],
//   svvyxGuidanceBlocks: [],
//   executeTypescriptFacadeDeclarations: { text: "declare const extensions: {};", emittedExtensionIds: [] },
//   tokenEstimate: 36,
//   sourceFingerprints: {
//     "base-common": "sha256:base-common-01",
//     shell: "sha256:shell-01",
//   },
//   diagnostics: [],
// }
```

Rejected:

```text
yield*
  extensions.generatedContext.build({
    actorKind: "orchestrator",
    target: { kind: "orchestrator", workspaceSessionId: "workspace_session_01" },
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["web"],
      availableExtensionIds: [],
      unavailableExtensionIds: [],
      instructionOrder: ["web"],
      source: "surface-binding",
    },
    reason: "surface-dispatch",
  });
// fails ExtensionError {
//   operation: "extensions.generatedContext.build",
//   reason: "dependency-not-ready",
//   extensionId: "web",
//   message: "Loaded extension web is not ready for generated context.",
// }
```

### `nativeTools`

Use case: give pi only the loaded native tools and runtime only the handler/metadata for an accepted
native tool call. Backing: builtin/native extension records plus actor binding; durable command
state and command sessions are runtime-owned.

Success:

```text
yield*
  extensions.nativeTools.declarations({
    actorKind: "orchestrator",
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["shell", "request-user-input"],
      availableExtensionIds: [],
      unavailableExtensionIds: ["web"],
      instructionOrder: ["shell", "request-user-input"],
      source: "surface-binding",
    },
  });
// => [
//   {
//     name: "exec_command",
//     label: "exec_command",
//     description: "Execute a shell command in the current workspace. Returns stdout and stderr. Use this for command-family work such as svvyx, git, gh, cx, smithers, tests, and builds.",
//     parameters: {
//       type: "object",
//       additionalProperties: false,
//       required: ["cmd"],
//       properties: {
//         cmd: { type: "string", minLength: 1, description: "Shell command to execute." },
//         workdir: {
//           type: "string",
//           minLength: 1,
//           description: "Working directory for the command. Defaults to the workspace root.",
//         },
//         timeout: { type: "number", description: "Timeout in seconds." },
//       },
//     },
//   },
//   {
//     name: "request_user_input",
//     label: "Request User Input",
//     description: "Ask one to three bounded user clarification questions. The active extension setting controls whether the call returns defaults immediately or blocks until user answer/timeout.",
//     parameters: {
//       type: "object",
//       additionalProperties: false,
//       required: ["questions"],
//       properties: {
//         questions: {
//           type: "array",
//           minItems: 1,
//           maxItems: 3,
//           items: {
//             type: "object",
//             additionalProperties: false,
//             required: ["title", "question"],
//             properties: {
//               title: { type: "string", minLength: 1 },
//               question: { type: "string", minLength: 1 },
//               options: { type: "array", minItems: 2, maxItems: 3 },
//               defaultAnswer: { type: "string", minLength: 1 },
//             },
//           },
//         },
//       },
//     },
//   },
// ]

yield*
  extensions.nativeTools.handler({
    actorKind: "orchestrator",
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["shell", "request-user-input"],
      availableExtensionIds: [],
      unavailableExtensionIds: [],
      instructionOrder: ["shell", "request-user-input"],
      source: "surface-binding",
    },
    target: {
      kind: "orchestrator",
      workspaceSessionId: "wsess_01",
      surfacePiSessionId: "pi_orch_01",
    },
    extensionUsageSource: "surface-binding",
    toolName: "request_user_input",
  });
// => {
//   invoke: (invocation) => Effect<{
//     result: {
//       status: "accepted",
//       details: {
//         operationCount: 1,
//       },
//     },
//     operations: [
//       {
//         kind: "runtime_effect",
//         request: {
//           type: "request_input.create",
//           questions: [
//             {
//               title: "Scope",
//               question: "Which verification scope should I run?",
//               options: [
//                 { label: "Unit", description: "Run focused unit coverage.", recommended: true },
//                 { label: "Full", description: "Run the full local preflight.", recommended: false },
//               ],
//             },
//           ],
//         },
//       },
//     ],
//   }, ExtensionError>
// }
```

Rejected:

```text
yield*
  extensions.nativeTools.handler({
    actorKind: "orchestrator",
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["web"],
      unavailableExtensionIds: [],
      instructionOrder: ["shell"],
      source: "surface-binding",
    },
    target: {
      kind: "orchestrator",
      workspaceSessionId: "wsess_01",
      surfacePiSessionId: "pi_orch_01",
    },
    extensionUsageSource: "surface-binding",
    toolName: "web_search",
  });
// fails ExtensionError {
//   operation: "extensions.nativeTools.handler",
//   reason: "not-found",
//   message: "Native tool handler does not exist: web_search",
// }
```

### `svvyx`

Use case: dispatch one trusted app-owned `svvyx <extension-id> ...` command from a runtime-owned
Shell/`execute_typescript` command session. Backing: file-backed command source/build artifacts,
DB/product-state-backed readiness/env/dependency facts, and invocation-local env snapshots. Runtime
owns approval, sandbox, durable command state, stdout/stderr streaming, child commands, and state
effect application.

Success:

```text
yield*
  extensions.svvyx.run({
    extensionId: "workflows",
    commandPath: ["list"],
    input: { options: { kind: "agent" } },
    origin: "shell-cli",
    actorBinding: {
      actorKind: "handler",
      loadedExtensionIds: ["workflows"],
      availableExtensionIds: [],
      unavailableExtensionIds: [],
      instructionOrder: ["workflows"],
      source: "surface-binding",
    },
    invocation: {
      workspaceId: "workspace_01",
      workspaceSessionId: "workspace_session_01",
      sourceCommandId: "cmd_01",
    },
    env: {
      extensionId: "workflows",
      status: "ready",
      requirements: [],
      envFacts: [],
    },
  });
// => {
//   result: {
//     content: [{ type: "text", text: "{\"items\":[]}" }],
//     details: {
//       status: "succeeded",
//       summary: "Listed 0 workflow source-library agent exports.",
//       commandFacts: {
//         type: "svvyx_workflows.finished",
//         extensionId: "workflows",
//         commandPath: ["list"],
//         itemCount: 0,
//       },
//     },
//   },
//   operations: [],
// }
```

Rejected:

```text
yield*
  extensions.svvyx.run({
    extensionId: "web",
    commandPath: ["search"],
    input: { query: "effect v4" },
    origin: "shell-cli",
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["web"],
      availableExtensionIds: [],
      unavailableExtensionIds: [],
      instructionOrder: ["web"],
      source: "surface-binding",
    },
    invocation: {
      workspaceId: "workspace_01",
      workspaceSessionId: "workspace_session_01",
      sourceCommandId: "cmd_02",
    },
    env: {
      extensionId: "web",
      status: "ready",
      requirements: [],
      envFacts: [],
    },
  });
// fails ExtensionError {
//   operation: "extensions.svvyx.run",
//   reason: "not-found",
//   extensionId: "web",
//   message: "Extension web has no svvyx command surface.",
// }
```

### `executeTypescriptFacadeDeclarations`

Use case: build the actor-local TypeScript declaration text injected into `execute_typescript` for
loaded TypeScript-facade-enabled `svvyx` extensions. Backing: generated facade declaration artifacts
owned by `@svvy/extensions`; runtime owns the actual `execute_typescript` subprocess and child
command execution.

Generated `execute_typescript` facade declarations are mechanically emitted from source Effect
Schema command contracts, extension records, and the resolved actor binding. They contain only
actor-local loaded TypeScript-facade-enabled builtin `svvyx` facades. They are not hand-written
prompt prose, not copied from generated `@svvyx/workflows` or `@svvyx/extensions` packages, not
package imports, and not reusable SDK declarations.

Success:

```text
yield*
  extensions.executeTypescriptFacadeDeclarations.build({
    actorKind: "handler",
    actorBinding: {
      actorKind: "handler",
      loadedExtensionIds: ["execute-typescript", "artifacts", "workflows"],
      availableExtensionIds: [],
      unavailableExtensionIds: [],
      instructionOrder: ["execute-typescript", "artifacts", "workflows"],
      source: "surface-binding",
    },
  });
// => {
//   text: [
//     "declare const extensions: {",
//     "  artifacts: {",
//     "    run(command: \"create\", input: ArtifactsCreateInput): Promise<ArtifactsCreateResult>;",
//     "    run(command: \"inspect\", input: ArtifactsInspectInput): Promise<ArtifactsInspectResult>;",
//     "    run(command: \"list\", input?: ArtifactsListInput): Promise<ArtifactsListResult>;",
//     "    run(command: \"open\", input: ArtifactsOpenInput): Promise<ArtifactsOpenResult>;",
//     "    run(command: \"delete\", input: ArtifactsDeleteInput): Promise<ArtifactsDeleteResult>;",
//     "  };",
//     "  workflows: {",
//     "    run(command: \"list\", input?: { options?: { kind?: \"agent\" | \"prompt\" | \"component\" | \"workflow\" } }): Promise<WorkflowsListResult>;",
//     "    run(command: \"save\", input: { options: { from: string; kind: \"agent\" | \"prompt\" | \"component\" | \"workflow\"; as: string; export?: string; overwrite?: boolean } }): Promise<WorkflowsSaveResult>;",
//     "    run(command: \"build\", input?: { options?: {} }): Promise<WorkflowsBuildResult>;",
//     "    run(command: \"models list\", input?: { options?: {} }): Promise<WorkflowsModelsListResult>;",
//     "  };",
//     "};",
//   ].join("\\n"),
//   emittedExtensionIds: ["artifacts", "workflows"],
//   diagnostics: [],
// }
```

Rejected:

```text
yield*
  extensions.executeTypescriptFacadeDeclarations.build({
    actorKind: "orchestrator",
    actorBinding: {
      actorKind: "orchestrator",
      loadedExtensionIds: ["execute-typescript", "user-linear"],
      availableExtensionIds: [],
      unavailableExtensionIds: [],
      instructionOrder: ["execute-typescript", "user-linear"],
      source: "surface-binding",
    },
  });
// fails ExtensionError {
//   operation: "extensions.executeTypescriptFacadeDeclarations.build",
//   reason: "unsupported",
//   extensionId: "user-linear",
//   message: "User svvyx TypeScript facades require sandboxed facade execution before emission.",
// }
```

### `generatedPackages`

Use case: produce app-global generated package output, then separately produce immutable link plans
for runtime-owned workspace repair. Backing: file-backed Workflows/Extensions source and
app-owned generated package roots. State facts and workspace link application go through
core-owned state ports implemented by `@svvy/state` and coordinated by `@svvy/runtime`.

Success:

```text
yield*
  extensions.generatedPackages.refresh({
    packages: ["@svvyx/extensions", "@svvyx/workflows"],
  });
// => {
//   packages: [
//     {
//       packageName: "@svvyx/extensions",
//       action: "written",
//       buildId: "gen_build_extensions_01",
//       sourceFingerprint: "sha256:source-extensions-01",
//       outputFingerprint: "sha256:output-extensions-01",
//       manifestPath: "/app/generated/extensions/.svvy-generated-package.json",
//       generatedFiles: [
//         { relativePath: "package.json", path: "/app/generated/extensions/package.json" },
//         { relativePath: "index.ts", path: "/app/generated/extensions/index.ts" },
//         { relativePath: ".svvy-generated-package.json", path: "/app/generated/extensions/.svvy-generated-package.json" },
//       ],
//       dependencies: [],
//       diagnostics: []
//     },
//     {
//       packageName: "@svvyx/workflows",
//       action: "written",
//       buildId: "gen_build_workflows_01",
//       sourceFingerprint: "sha256:source-workflows-01",
//       outputFingerprint: "sha256:output-workflows-01",
//       manifestPath: "/app/generated/workflows/.svvy-generated-package.json",
//       generatedFiles: [
//         { relativePath: "package.json", path: "/app/generated/workflows/package.json" },
//         { relativePath: "index.ts", path: "/app/generated/workflows/index.ts" },
//         { relativePath: ".svvy-generated-package.json", path: "/app/generated/workflows/.svvy-generated-package.json" },
//       ],
//       dependencies: [
//         {
//           specifier: "@svvy/core",
//           importKind: "type-only",
//           dependencyClass: "app-owned-type-contract",
//           resolutionAuthority: "app-owned-type-contract",
//           manifestDependency: "dev-type-dependency",
//         },
//         {
//           specifier: "smithers-orchestrator",
//           importKind: "type-only",
//           dependencyClass: "workspace-authoring-external",
//           resolutionAuthority: "workspace-smithers-package",
//           manifestDependency: "ambient-declaration",
//           version: "0.22.0",
//         },
//         {
//           specifier: "@svvyx/extensions",
//           importKind: "type-only",
//           dependencyClass: "generated-package",
//           resolutionAuthority: "generated-package-link",
//           manifestDependency: "none-generated-package-link",
//           buildId: "gen_build_extensions_01",
//         },
//       ],
//       diagnostics: []
//     },
//   ],
//   workflowsExports: [
//     {
//       kind: "agent",
//       namespace: "Agents",
//       exportName: "reviewerAgent",
//       qualifiedName: "Agents.reviewerAgent",
//       sourcePath: "/app/workflows/agents/reviewerAgent.agent.json",
//       generatedPath: "/app/generated/workflows/agents/reviewerAgent.ts",
//       generatedCode: "import type { TaskAgentParametersSource } from \"./index\"; ...",
//       agentParameters: {
//         id: "reviewerAgent",
//         label: "Reviewer",
//         provider: "openai",
//         model: "gpt-5.4",
//         reasoning: { effort: "medium" },
//         instructions: "Review the implementation.",
//       },
//       workflowAgentId: "reviewerAgent",
//     },
//   ],
// }

yield*
  extensions.generatedPackages.planWorkspaceLink({
    workspaceId: "workspace_01",
    packageName: "@svvyx/workflows",
  });
// => {
//   workspaceId: "workspace_01",
//   packageName: "@svvyx/workflows",
//   linkPath: "/repo/.smithers/node_modules/@svvyx/workflows",
//   targetPath: "/app/generated/workflows",
//   requiredParentPath: "/repo/.smithers/node_modules/@svvyx",
//   overwritePolicy: "symlink-only",
// }
```

Rejected:

```text
yield*
  extensions.generatedPackages.refresh({
    packages: ["@svvyx/unknown"],
  });
// fails ExtensionError {
//   operation: "extensions.generatedPackages.refresh",
//   reason: "invalid-input",
//   message: "Generated package must be one of @svvyx/extensions or @svvyx/workflows.",
// }
```

### `env`

Use case: inspect extension env requirements and resolve status-only execution plans for UI,
runtime, and agents. Backing: DB/product-state-backed env declarations/status rows and encrypted
app/keychain secret storage. Public extension env APIs never return secret values. Secret values are
resolved only by a package-private trusted invocation helper inside one runtime-owned command scope.
Secret values never enter generated context, logs, artifacts, state rows, read models, or
agent-visible outputs.

Success:

```text
yield* extensions.env.requirements({ extensionId: "linear" });
// => {
//   extensionId: "linear",
//   requirements: [{ name: "LINEAR_TOKEN", secret: true, required: true, status: "configured" }],
// }

yield*
  extensions.env.planExecutionEnv({
    extensionId: "linear",
    commandName: "issues.list",
    commandId: "cmd_01",
  });
// => {
//   extensionId: "linear",
//   status: "ready",
//   requirements: [{ name: "LINEAR_TOKEN", secret: true, required: true, status: "configured" }],
//   envFacts: [{ key: "LINEAR_TOKEN", redactionLabel: "[redacted:LINEAR_TOKEN]" }],
// }
```

Rejected:

```text
yield*
  extensions.env.planExecutionEnv({
    extensionId: "linear",
    commandName: "issues.list",
    commandId: "cmd_01",
  });
// fails ExtensionError {
//   operation: "extensions.env.planExecutionEnv",
//   reason: "missing-secret",
//   extensionId: "linear",
//   message: "Required secret LINEAR_TOKEN is not configured.",
// }
```

Runtime-private trusted helper, constructed by `@svvy/runtime` after command admission:

```ts
type ResolveTrustedExtensionInvocationEnvInput = {
  extensionId: ExtensionId;
  commandName: NativeToolName | SvvyxCommandName;
  commandId: CommandId;
  plan: ExtensionExecutionEnvPlan;
};

type ExtensionInvocationEnvSnapshot = {
  extensionId: ExtensionId;
  commandId: CommandId;
  plan: ExtensionExecutionEnvPlan;
  secretValues: Readonly<Record<string, Redacted.Redacted<string>>>;
  redactions: readonly { name: string; replacement: string }[];
};
```

`ExtensionInvocationEnvSnapshot` is not exported from the package root, not re-exported by
`@svvy/core`, not persisted, not sent over renderer/browser-tool bridges, and not available to
generated packages. Runtime asks `Extensions.env.planExecutionEnv(...)` for non-secret readiness and
env facts before command state is committed. `@svvy/extensions` never resolves raw extension secret
values. `Extensions.env.planExecutionEnv(...)` returns only `ExtensionExecutionEnvPlan` with
non-secret readiness, key names, labels, and fingerprints. Runtime resolves secret refs through the
core-owned `SecretStorePort` inside the runtime-owned command or handler invocation scope after
command admission and immediately before the trusted subprocess/provider/handler boundary. Runtime
constructs the process-local `ExtensionInvocationEnvSnapshot` and passes it only to the handler
invocation that needs it. `ExtensionInvocationEnvSnapshot` is runtime-private invocation data, not
an `@svvy/extensions` package-root export and not an `Extensions.layer` dependency.

### `dependencies`

Use case: inspect CLI/package readiness and produce immutable dependency command planning data only
through a dependency-action contract explicitly named by this spec. Shipped public runtime facades do
not expose user-clicked install/update admission. Backing: DB/product-state-backed `@svvy/state`
approval facts plus file-backed extension package install roots. Runtime owns approval, sandbox, subprocess
execution, output, and state fact commits.

Success: target success shape:

```text
yield*
  extensions.dependencies.planInstallOrUpdate({
    scope: { kind: "app-global" },
    extensionId: "web",
    requirementId: "tinyfish-cli",
    action: "install",
    targetVersion: "0.1.6",
    initiatedBy: "user",
  });
// => {
//   extensionId: "web",
//   requirementId: "tinyfish-cli",
//   dependencyIdentity: "npm:@tiny-fish/cli",
//   trustedDependencyIdentity: "npm:@tiny-fish/cli@0.1.6",
//   packageManager: "bun",
//   packageName: "@tiny-fish/cli",
//   targetVersion: "0.1.6",
//   expectedArtifactDigests: {},
//   lifecycleScriptsPolicy: "disabled",
//   approvalIdentityKey: "extension-dependency:npm:@tiny-fish/cli@0.1.6",
//   action: "install",
//   command: ["bun", "install", "--cwd", "/app/extensions/package", "@tiny-fish/cli@0.1.6"],
//   cwd: "/app/extensions/package",
//   env: { BUN_CONFIG_LIFECYCLE_SCRIPTS: "false" },
//   extendEnv: false,
//   timeoutMs: 120000,
//   outputLimits: {
//     stdoutMaxBytes: 1048576,
//     stderrMaxBytes: 1048576,
//   },
//   requiresTrustedDependencyApproval: true,
//   expectedBinaryName: "tinyfish",
//   expectedVersion: "0.1.6",
//   redaction: {
//     envKeys: [],
//     replacementByLabel: {},
//   },
// }
```

Rejected:

```text
yield*
  extensions.dependencies.planInstallOrUpdate({
    scope: { kind: "app-global" },
    extensionId: "git",
    requirementId: "git-cli",
    action: "install",
    initiatedBy: "user",
  });
// fails ExtensionError {
//   operation: "extensions.dependencies.planInstallOrUpdate",
//   reason: "unsupported",
//   extensionId: "git",
//   message: "Unversioned system CLI requirements do not have app-owned install plans.",
// }
```

### `sources`

Use case: open and save one editable extension or Workflows source file with compare-and-swap
conflict control. Backing: file-backed editable source plus DB/product-state-backed source-version
facts. Source text is not duplicated as product state.

Success:

```text
yield*
  extensions.sources.openEditSession({
    sourceKind: "builtin-extension",
    sourceId: "base-orchestrator:instructions/full/010-base-orchestrator.mdx",
  });
// => {
//   sourceKind: "builtin-extension",
//   sourceId: "base-orchestrator:instructions/full/010-base-orchestrator.mdx",
//   path: "/config/svvy/extensions/sources/builtin/base-orchestrator/instructions/full/010-base-orchestrator.mdx",
//   sourceVersion: "version_01",
//   fingerprint: "fingerprint_01",
//   text: "# Orchestrator\n\nOwn strategy, delegate bounded work, and make final decisions.",
//   diagnostics: [],
// }

yield*
  extensions.sources.saveEditSession({
    sourceKind: "builtin-extension",
    sourceId: "base-orchestrator:instructions/full/010-base-orchestrator.mdx",
    expectedSourceVersion: "version_01",
    text: "# Orchestrator\n\nOwn strategy, delegate bounded work, make final decisions, and keep package boundaries explicit.",
    saveMode: "compare-and-swap",
    sourceCommandId: "cmd_01",
  });
// => { status: "saved", fingerprint: "fingerprint_02", diagnostics: [], reconcileRequired: true }
```

Rejected:

```text
yield*
  extensions.sources.saveEditSession({
    sourceKind: "builtin-extension",
    sourceId: "base-orchestrator:instructions/full/010-base-orchestrator.mdx",
    expectedSourceVersion: "stale_version",
    text: "# Orchestrator\n\nLocal draft based on an older source version.",
    saveMode: "compare-and-swap",
  });
// => {
//   status: "stale",
//   current: {
//     fingerprint: "fingerprint_02",
//     text: "# Orchestrator\n\nCurrent saved file text.",
//     diagnostics: [],
//   },
// }
```

### `builtin`

Use case: scaffold missing editable builtin source files from packaged read-only templates or reset
one builtin source contributor to the packaged default. Backing: packaged app template files and
file-backed app-config source. Runtime schedules generated-context/package refresh after source
facts commit.

Success:

```text
yield*
  extensions.builtin.resetSource({
    extensionId: "base-common",
    sourcePath: "instructions/full/010-base-common.mdx",
    sourceCommandId: "cmd_01",
  });
// => {
//   materialized: [
//     {
//       extensionId: "base-common",
//       sourcePath: "instructions/full/010-base-common.mdx",
//       action: "reset",
//       fingerprint: "fingerprint_default",
//       diagnostics: [],
//     },
//   ],
//   skipped: [],
// }
```

Rejected:

```text
yield*
  extensions.builtin.resetSource({
    extensionId: "linear",
    sourcePath: "instructions/full/010-linear.mdx",
  });
// fails ExtensionError {
//   operation: "extensions.builtin.resetSource",
//   reason: "invalid-input",
//   extensionId: "linear",
//   message: "Only builtin extension source can be reset from packaged templates.",
// }
```

### `externalInstructions`

Use case: discover read-only external instruction files and validate actor usage controls without
turning them into normal extension source. Backing: file-backed discovered files plus
DB/product-state-backed enablement/read-status facts.

Success:

```text
yield*
  extensions.externalInstructions.scan({
    workspaceId: "workspace_01",
    cwd: "/repo",
    globalRoots: ["/Users/example/.config/svvy/external-instructions"],
  });
// => {
//   sources: [
//     {
//       id: "external_instruction_repo_agents",
//       kind: "external_instruction",
//       path: "/repo/AGENTS.md",
//       readOnly: true,
//       contentHash: "sha256:agents-01",
//       sourceGroup: "workspace_chain",
//       order: 0,
//       eligibleActors: ["orchestrator", "handler"],
//       readStatus: { status: "readable" },
//     },
//   ],
//   diagnostics: [],
// }

yield*
  extensions.externalInstructions.validateActorUsage({
    workspaceId: "workspace_01",
    path: "/repo/AGENTS.md",
    actorKind: "handler",
    enabled: true,
  });
// => { path: "/repo/AGENTS.md", actorKind: "handler", eligible: true }
```

`externalInstructions.validateActorUsage(...)` performs source eligibility and actor/profile
validation only. Persisted external-instruction usage, ordering, read status, diagnostics, and
participation facts are changed only through
`StateCommandsFacade.agentProfiles.setExternalInstructionActorUsage(...)`.

Rejected:

```text
yield*
  extensions.externalInstructions.validateActorUsage({
    workspaceId: "workspace_01",
    path: "~/.config/svvy/extensions/sources/user/linear/instructions.mdx",
    actorKind: "handler",
    enabled: true,
  });
// fails ExtensionError {
//   operation: "extensions.externalInstructions.validateActorUsage",
//   reason: "invalid-input",
//   message: "Normal extension source files are not external instruction records.",
// }
```

## Prompt And Instruction Sources

All default agent-facing prompt material lives in `@svvy/extensions` because prompt text is part of
extension capability binding.

Default builtin instruction contributors are MDX source files declared by the extension
record unless generation is required.

Packaged builtin template shape:

Runtime editable builtin and user sources are scaffolded or reset from these packaged templates into
`~/.config/svvy/extensions/sources/...`; the app-config files are the live source.

```text
@svvy/extensions/src/builtin/
  base-common/
    instructions/full/010-base-common.mdx
  base-orchestrator/
    instructions/full/010-base-orchestrator.mdx
  base-handler/
    instructions/full/010-base-handler.mdx
  base-workflow-task/
    instructions/full/010-base-workflow-task.mdx
  shell/
    instructions/full/010-shell.mdx
    instructions/full/020-incur-cli-usage.mdx
    native-tool.schema.ts
  apply-patch/
    instructions/full/010-apply-patch.mdx
    native-tool.schema.ts
  execute-typescript/
    instructions/full/010-execute-typescript.mdx
    native-tool.schema.ts
    facade-declaration.ts
  extension-loading/
    instructions/full/010-extension-loading.mdx
    native-tool.schema.ts
  extension-managing/
    instructions/full/010-extension-managing.mdx
    svvyx/
      commands.ts
  request-user-input/
    instructions/full/010-request-user-input.mdx
    native-tool.schema.ts
  thread-orchestration/
    instructions/full/010-thread-orchestration.mdx
    native-tool.schema.ts
  thread-handling/
    instructions/full/010-thread-handling.mdx
    native-tool.schema.ts
  artifacts/
    instructions/full/010-artifacts.mdx
    svvyx/
      commands.ts
    facade-declaration.ts
  smithers/
    scripts/generate-instructions.ts
    instructions/full/010-smithers-core.generated.md        # read-only packaged last-successful generated output
    instructions/full/040-smithers-memory.generated.md      # read-only packaged last-successful generated output
  workflows/
    instructions/full/010-workflows.mdx
    svvyx/
      commands.ts
    facade-declaration.ts
  web/
    scripts/generate-instructions.ts
    instructions/full/010-web.generated.md                  # read-only packaged last-successful generated output
  cx/
    scripts/generate-instructions.ts
    instructions/full/010-cx.generated.md                   # read-only packaged last-successful generated output
  git/
    instructions/full/010-git.mdx
  github/
    instructions/full/010-github.mdx
  external-instructions/
    manifest.ts
```

Rules:

- Direct builtin prompt text, including base actor prompts and native-tool guidance, is exposed as
  editable loaded source contributors.
- Editable/default prompt source is `.mdx`.
- MDX instruction source compiles to validated Markdown/text strings before it enters pi
  `systemPrompt`.
  Arbitrary runtime React/Svelte components, executable UI components, or renderer-only MDX
  components are not allowed in prompt output.
- Extension manifests/records declare every loaded instruction contributor and its order. Prompt
  composition reads declared contributors; it does not glob arbitrary files as hidden prompt input.
- Scripted contributors are reserved for extensions with a real generator/source pair such as
  Smithers, Web, or cx.
- Scripted prompt contributors are extension-owned build helpers, not runtime services. They run only
  through declared extension helper ports and the root `Extensions.layer` requirements admitted by
  this spec. They must not import runtime/state/desktop/sandbox/pi-adapter services, create a
  `ManagedRuntime`, call top-level `Effect.run*` from extension service code, read `process.env`,
  spawn package-manager installs, or perform network/process work unless this spec first names the
  exact helper port, Effect API adoption, timeout/redaction policy, and tests. Their output is
  Markdown/plain prompt text evidence only.
- For scripted contributors, the extension record points at one editable TypeScript generator source
  and one or more read-only last-successful generated Markdown/plain prompt outputs under declared
  contributor paths such as `instructions/full/*.generated.md`. Prompt composition may read the
  generated output, but source editing, reset, snapshots, and agent customization target the
  generator/source inputs rather than the generated Markdown file.
- A `*.generated.md` contributor path is never editable source. The editable source is the
  associated `.mdx` source file or the declared `scripts/generate-instructions.ts` generator source.
- Read-only generated contributor Markdown is opened with the owning extension source kind
  (`builtin-extension` or `user-extension`) and a stable source-record id of the form
  `<extension-id>#generated-contributor:<contributor-id>`. The `contributor-id` comes from the
  extension record, not from a caller-supplied filesystem path. `saveEditSession` rejects these
  records with `read-only-source`.
- Generated Markdown output is not an independent top-level source type. Users customize the
  MDX source, generator source, manifest, extension source, CLI requirement, or package
  state, then regenerate/build. MDX is source-only and compiles to validated Markdown/text strings
  before any compiled generated-context output enters pi.
- Runtime prompt bindings store the composed generated context in product state. Runtime does not
  own prompt source files.
- Base prompt text lives in editable builtin extension source files. The source format is MDX, not
  Markdown or TypeScript prompt constants.
- Packaged builtin sources are default templates and packaged app-owned assets. Runtime-loaded
  editable source for user-customizable builtin and user extensions lives under the app config
  source root, for example `~/.config/svvy/extensions/sources/builtin/<id>/...` for builtin source
  overrides and `~/.config/svvy/extensions/sources/user/<id>/...` for user extension sources.
- `@svvy/runtime` source-invalidation coordinators schedule deterministic fingerprint scans and
  rebuild work for affected generated context or generated packages. `@svvy/extensions` performs
  source validation/build work only when invoked through those runtime-owned coordinator paths, and
  `@svvy/state` facts remain authoritative. Agent edits through approved tools mark the affected
  source as requiring build/refresh; watcher events are hints and are never authoritative.

## Tool Metadata

`@svvy/extensions` is the canonical source of concrete native tool declarations, tool metadata,
actor slicing, handler lookup, and projection metadata. Runtime and state must not duplicate
hard-coded lists of specialized tool names or projection behavior. `@svvy/core` defines only the
pi-free declaration/result DTOs and the structural `PiToolExecutor`/tool-update contracts that let
runtime provide execution to `@svvy/pi-adapter`; core does not define concrete executable handlers.

Current command metadata shape:

```ts
type NativeToolCommandVisibility = "trace" | "summary" | "surface";
type NativeToolStreamingArgumentPolicy = "record" | "skip";
type NativeToolExecutionCommandPolicy = "generic-command" | "self-recorded-command";
type NativeToolActorAvailability = "loaded" | "available" | "unavailable";

type NativeToolCommandMetadata = {
  readonly toolName: NativeToolName;
  readonly extensionIds: readonly ExtensionId[];
  readonly actorAvailability: Readonly<{
    readonly orchestrator?: NativeToolActorAvailability;
    readonly handler?: NativeToolActorAvailability;
    readonly "workflow-task"?: NativeToolActorAvailability;
  }>;
  readonly visibility: NativeToolCommandVisibility;
  readonly streamingArguments: NativeToolStreamingArgumentPolicy;
  readonly executionCommand: NativeToolExecutionCommandPolicy;
  readonly turnDecision:
    | "reply"
    | "exec_command"
    | "write_stdin"
    | "apply_patch"
    | "execute_typescript"
    | "list_extensions"
    | "load_extension"
    | "thread_start"
    | "thread_followup"
    | "thread_list"
    | "thread_request_report"
    | "thread_current"
    | "thread_group"
    | "thread_report"
    | "thread_episodes"
    | "request_user_input"
    | null;
};
```

Metadata meanings:

- `extensionIds` names the extension records that own the tool. Shared tools such as
  `thread_episodes` list both owners.
- `actorAvailability` is the default actor slicing known by `@svvy/extensions`. Shell,
  Apply Patch, Execute TypeScript, and Extension Loading are loaded for orchestrator, handler, and
  workflow-task actors; Request User Input is loaded for orchestrator and handler and unavailable
  for workflow-task actors; Thread Orchestration is loaded only for orchestrators; Thread Handling
  is loaded only for handlers.
- `visibility` is the command projection visibility used by runtime command lifecycle/projection
  services and state read-model projection:
  `trace`, `summary`, or `surface`.
- `streamingArguments: "record"` means the runtime command projection service records accepted
  argument snapshots; `"skip"` means arguments are not persisted as incremental snapshots.
- `executionCommand: "generic-command"` means the runtime command lifecycle service fills the
  generic command lifecycle for the runtime-allocated command envelope. `"self-recorded-command"`
  means the native tool handler returns schema-backed tool-specific facts in
  `NativeToolResult.details`; runtime still allocates, persists, and settles the command envelope
  and command facts.
- `turnDecision` is the top-level turn decision value to set when the tool is the decisive action;
  tools with no turn-decision projection use `null`.

Partial metadata example:

```ts
const nativeToolCommandMetadata: readonly NativeToolCommandMetadata[] = [
  {
    toolName: "exec_command",
    extensionIds: ["shell"],
    actorAvailability: { orchestrator: "loaded", handler: "loaded", "workflow-task": "loaded" },
    visibility: "summary",
    streamingArguments: "record",
    executionCommand: "generic-command",
    turnDecision: "exec_command",
  },
  {
    toolName: "thread_episodes",
    extensionIds: ["thread-handling", "thread-orchestration"],
    actorAvailability: {
      orchestrator: "loaded",
      handler: "loaded",
      "workflow-task": "unavailable",
    },
    visibility: "surface",
    streamingArguments: "skip",
    executionCommand: "self-recorded-command",
    turnDecision: "thread_episodes",
  },
];
```

Unknown native tool names are rejected before command creation with a typed `ExtensionError`.
Runtime may record a trace diagnostic for an attempted unknown tool call, but it must not execute or
project that call as a generic command. New callable tools must be registered through extension
records and exposed through actor-specific declarations before pi can call them.

Runtime uses this metadata to decide whether to create streamed command records, whether execution
tracking should create a generic command record, which turn decision to set, and how to expose
command visibility. Extension handlers remain responsible for tool-specific validation, typed
tool-specific operation metadata, redaction metadata, redaction hooks, runtime effect requests, and
execution plans. Runtime owns the command envelope, lifecycle, ordering, terminalization, and
passing facts to state. State remains responsible for persistence, terminal immutability, and
read-model projection.

## Builtin Extension Boundaries

Extension handlers validate inputs, apply extension-local semantics, and return exactly one
model-facing `NativeToolResult` plus one ordered `operations` list. `operations` is the only
cross-package operation contract: runtime effects are wrapped as
`{ kind: "runtime_effect", request }`, and execution plans are wrapped as
`{ kind: "execution_plan", plan }`. `runtimeEffects`, `executionPlans`, raw
`RuntimeEffectRequest` arrays, and raw `ExtensionExecutionPlan` arrays are not supported handler
result fields. Handlers do not directly schedule model turns, claim queues, create desktop panes,
run subprocesses, perform file effects, allocate product command envelopes, terminalize commands,
or own persisted read models. Runtime always allocates the top-level command id/envelope for every
native tool invocation before handler execution, executes plans that require
approval/sandbox/subprocess/file/stdin/child-command ownership, applies runtime effect requests, and
passes validated facts to state. Runtime decodes every handler-returned `execution_plan` with
`ExtensionExecutionPlanSchema` before side effects; unknown plan kinds, unsupported variants, excess
fields, and dependency install/update plans returned through handler operations fail as typed
runtime/command contract errors. State persists facts and projects read models.

The concrete executable handler is owned by `@svvy/extensions`. `@svvy/core` owns only the DTOs and
schemas that cross package boundaries: `NativeToolHandlerLookupInput`, `ExtensionInvocation`,
`ExtensionHandlerResult`, `ExtensionRuntimeOperation`, and related result/fact/error contracts.
`ExtensionHandler` is an Effect-local function object returned by `Extensions.nativeTools.handler`;
it is not persisted, encoded, emitted as JSON Schema, or exposed to generated packages.

The handler shape is:

```ts
type ExtensionHandler = {
  invoke(input: ExtensionInvocation): Effect.Effect<ExtensionHandlerResult, ExtensionError>;
};

// The handler is closed over dependencies supplied by the Extensions layer. Runtime-owned
// approval/sandbox/subprocess/file/stdin/child-command/queue/command-fact behavior is returned as
// an ExtensionExecutionPlan or RuntimeEffectRequest, not requested through extra invocation-time
// services. `nativeTools.handler(...)` accepts the public `NativeToolHandlerLookupInput` defined in
// the service DTO section; there is no second handler lookup shape.

type ExtensionInvocation = {
  toolCallId: ToolCallId;
  toolName: NativeToolName;
  arguments: AcceptedNativeToolArguments;
  context: PromptExecutionContext;
  actorBinding: ActorBinding;
  command: CommandInvocationContext;
};

type AcceptedNativeToolArguments = {
  schemaId: NativeToolArgumentSchemaId;
  encodedArguments: JsonValue;
  decodedArguments: unknown;
};

type CommandInvocationContext = {
  commandId: CommandId;
  workspaceId: WorkspaceId;
  target: RuntimeSurfaceTarget;
  turnId: TurnId;
  approvalMode: ApprovalMode;
  approvalFacts?: RuntimeApprovalDecisionFacts;
  sandbox: {
    snapshot: SandboxPolicySnapshot;
    sandboxLaunchFacts?: SandboxLaunchFacts;
  };
  cwd: AbsolutePath;
  baseEnv: Readonly<Record<string, string>>;
  extensionEnv?: ExtensionInvocationEnvSnapshot;
};

type ExtensionInvocationEnvSnapshot = {
  extensionId: ExtensionId;
  nonSecretValues: Readonly<Record<string, string>>;
  secretValues: Readonly<Record<string, Redacted.Redacted<string>>>;
  redactedKeys: readonly string[];
  secretRevisionFingerprint: string;
};

type CliRequirementProbePlan = {
  requirementId: ExtensionRequirementId;
  executable: AbsolutePath;
  argv: readonly string[];
  cwd: AbsolutePath;
  env: Readonly<Record<string, string>>;
  extendEnv: false;
  timeoutMs: PositiveDurationMs;
  maxStdoutBytes: PositiveSafeInteger;
  maxStderrBytes: PositiveSafeInteger;
  redactionRules: readonly EnvRedactionRule[];
};

type CliRequirementProbeResult =
  | { status: "ready"; version?: string; stdoutDigest?: string }
  | { status: "missing"; message: string }
  | { status: "unknown"; message: string }
  | { status: "version-mismatch"; expected: string; actual?: string; message: string };

type ExtensionRuntimeOperation =
  | { kind: "runtime_effect"; request: RuntimeEffectRequest }
  | { kind: "execution_plan"; plan: ExtensionExecutionPlan };

type ExtensionHandlerResult = {
  result: NativeToolResult;
  operations?: ReadonlyArray<ExtensionRuntimeOperation>;
};
```

Every handler example and every generated declaration uses `operations`. Handler result contracts
reject `runtimeEffects` as an unknown field.

Snippets using `Redacted.Redacted<T>` assume `import type * as Redacted from "effect/Redacted"`.
`ExtensionInvocationEnvSnapshot` is unencoded, Effect-local, runtime-private invocation data used
only inside the app `ManagedRuntime` by `@svvy/runtime` when constructing one trusted invocation
environment from an `ExtensionExecutionEnvPlan` plus `SecretStorePort` values. It is not returned by
`@svvy/extensions`, not exported from `@svvy/core`, not schema-encoded, not persisted, not exposed
through Promise/RPC facades, not emitted into generated declarations or generated packages, not
exposed through any package facade boundary, and not included in command facts.
`Redacted.Redacted<string>` protects accidental inspection inside the process; it is not a
boundary-safe secret transport. Secret-bearing local types stay process-local. Persisted state, RPC
contracts, generated package files, read models, diagnostics, app logs, and public/core encoded env
contracts expose only `ExtensionExecutionEnvPlan`-style non-secret values, secret key names,
redacted labels, readiness status, and fingerprints.

Runtime performs the strict schema decode once before invoking a native tool handler. The accepted
invocation retains `encodedArguments` for durable command facts and diagnostics, while handlers
consume `decodedArguments` as the schema-bound input associated with `schemaId`; handlers must not
re-decode generic JSON except when the native tool metadata explicitly imports an upstream schema
owned by that handler.

`ExtensionExecutionPlan` is a closed `@svvy/core` data contract for extension-authored work that
must be executed by runtime because it needs runtime-owned approval, sandbox, subprocess,
file-effect, runtime command stdin/control, child-command, or command-fact behavior. It is not a generic
callback surface.

```ts
type ExtensionExecutionPlan =
  | {
      type: "child_process.command";
      planId: ExtensionExecutionPlanId;
      commandFamily: "shell" | "execute_typescript" | "svvyx";
      command: ChildProcessCommandDescription;
      cwd: AbsolutePath;
      env: ExtensionExecutionEnvPlan;
      stdin: "none" | "continuable";
    }
  | {
      type: "file_effect.apply_patch";
      planId: ExtensionExecutionPlanId;
      patch: UnifiedPatchText;
      cwd: AbsolutePath;
    };
```

Rules:

- The extension that returns the plan is the producer. Runtime is the only executor.
- Runtime attaches command id, source tool call, approval facts, sandbox facts, display summaries,
  stdout/stderr event rows, terminal command facts, cancellation finalizers, and app-log links.
- Plans carry immutable command descriptions and env key plans only. They do not carry open process
  handles, `AbortController`s, callback functions, host service objects, renderer ids, mutable env
  maps, raw secrets, display-only summaries, approval policy, sandbox policy, output retention
  policy, stdout/stderr routing policy, or terminal command facts. `ExtensionExecutionEnvPlan` is
  safe to encode into command facts: it contains non-secret env values, secret key names, redacted
  labels, and the secret revision fingerprint only. Runtime derives invocation-local redaction rules
  when it resolves and unwraps `ExtensionInvocationEnvSnapshot.secretValues` immediately before
  trusted process launch or in-process extension invocation, then discards raw values after
  constructing the launch environment.
- `child_process.command` covers Shell, `execute_typescript`, Shell-routed `svvyx ...`, and
  extension-facade child commands when they launch a subprocess.
- `file_effect.apply_patch` covers Apply Patch file effects after runtime path policy checks.
- Extension dependency install/update is not represented as a handler-returned execution-plan
  operation item.
  The Extensions UI must not call a public dependency-action runtime facade until the complete
  runtime-owned lifecycle command service is specified, implemented, and tested. The promoted
  lifecycle asks `@svvy/extensions` for the dependency command plan and runtime owns approval,
  sandbox launch policy, subprocess lifetime, command facts, and readiness refresh.
- Adding a new plan variant requires a core/extensions/runtime spec update, runtime executor,
  command fact contract, and boundary tests.

Example Shell plan:

```json
{
  "type": "child_process.command",
  "planId": "plan_01",
  "commandFamily": "shell",
  "command": { "argv": ["bun", "test"] },
  "cwd": "/Users/me/code/project",
  "env": {
    "extensionId": "shell",
    "nonSecretValues": {},
    "secretKeyNames": [],
    "redactedLabels": {},
    "secretRevisionFingerprint": "none"
  },
  "stdin": "none"
}
```

Runtime decodes a tool call against the registered native-tool schema before invoking an extension
handler. The decoded `arguments.value` is JSON data accepted by that schema, paired with the exact
schema id used for validation. Extension handlers must not receive `unknown`, pi-native tool-call
objects, renderer payloads, or best-effort pre-parsed arguments. Runtime resolves and canonicalizes
`command.cwd` before invocation.

Runtime unwraps `ExtensionInvocationEnvSnapshot.secretValues` only while constructing the trusted
child-process or in-process extension invocation environment. Command facts, logs, transcripts,
artifacts, generated declarations, read models, tool results, and `ExtensionExecutionPlan` payloads
receive only non-secret values, secret key names, redacted labels, fingerprints, readiness status,
or presence status. Runtime derives redaction rules at the execution boundary and does not persist
them as handler-authored plan data.

`workspaceId` is runtime-derived metadata attached after target validation. Extension handlers may use
it for diagnostics, command facts, file policy context, and app-log links. They must not accept or
return it as a second routing key for surface creation, queue insertion, or episode recording.

`SandboxPolicySnapshot` in this context is a pi-free, schema-backed boundary data contract exported
from `@svvy/core`. `SandboxLaunchFacts` are runtime-owned scoped launch receipts. Extension handlers
do not receive, return, persist, or inspect `SandboxLaunchFacts`, and `@svvy/extensions` must not
import sandbox contracts, constructors, helpers, or services from `@svvy/sandbox`.

Before invoking an extension handler, `@svvy/runtime` creates or reuses the current command record,
performs approval-boundary work when required, resolves the immutable sandbox policy snapshot
through `@svvy/sandbox`, resolves invocation env, and passes the resulting
`CommandInvocationContext` into the handler. Process-backed extension operations such as Shell,
`execute_typescript`, `svvyx` commands that actually launch subprocesses, and extension facade child
commands describe desired work through closed runtime contracts. Runtime acquires scoped
`SandboxLaunchFacts` only inside the runtime command scope that launches and observes the
subprocess.
User-clicked dependency install/update is not an extension handler execution path. Extensions UI
install/update controls remain unavailable, `@svvy/extensions` does not return install/update
command plans to runtime, and no runtime dependency-action command service exists unless this spec
defines approval linkage, sandbox launch policy, subprocess lifetime, output streaming, command
facts, and readiness refresh in the same resolved contract.
File-effect handlers such as Apply Patch receive the immutable snapshot and a runtime-validated
file-effect plan, then return structured patch facts/errors. Runtime performs path checks through
`@svvy/sandbox` before file effects begin; handlers do not consume sandbox services or runtime
helper callbacks directly. Handlers do not allocate their own command ids, bypass approval, build
sandbox policy, consume the `Sandbox` service directly, or read global shell env for product
secrets.

`RuntimeEffectRequest` is the closed declarative algebra from `@svvy/core`. The target runtime
applier promotes every core-listed variant and decides ordering, transactions, queue delivery,
generated-context refresh, generated-package scheduling, command linkage, failure mapping, and event
publication for each variant. Extension handlers may emit only the variants named for their
tool/domain producer; they must not emit arbitrary cross-domain requests as a convenience API.
Implementation is incomplete if a core-listed variant exists only as a decoded value without a
runtime-owned applier, transaction ports, command-fact outcomes, failure mappings, and applier tests.

Example `load_extension` handler result:

```ts
const result: ExtensionHandlerResult = {
  result: {
    content: [{ type: "text", text: "Loaded extension `smithers` for this actor." }],
    details: {
      status: "succeeded",
      summary: "Loaded extension smithers for the current actor.",
      commandFacts: {
        type: "load_extension.finished",
        status: "succeeded",
        commandId: invocation.command.commandId,
        turnId: invocation.command.turnId,
        extensionId: "smithers",
        usage: "loaded",
      },
    },
  },
  operations: [
    {
      kind: "runtime_effect",
      request: {
        type: "actor_extension_binding.update",
        input: {
          target: invocation.command.target,
          extensionId: "smithers",
          usage: "loaded",
          reason: "load_extension",
          sourceCommandId: invocation.command.commandId,
        },
      },
    },
  ],
};
```

`actor_extension_binding.update` is the only runtime effect returned by `load_extension`. Runtime
applies the binding change transactionally and schedules/marks generated actor context refresh as
part of that applier. The handler does not emit a separate `generated_context.refresh` effect and
does not mutate profile defaults.

The command facts describe the completed tool invocation. The `RuntimeEffectRequest` values describe
the durable binding and pre-dispatch generated-context work that runtime will apply. The handler does
not mutate actor binding rows, refresh active pi tool declarations mid-turn, publish runtime events,
or inspect desktop panes directly.

Extension handlers may provide redaction hooks and redaction metadata. Runtime invokes those hooks
before command facts, logs, artifact metadata, or transcript-derived text are handed to state. State
performs the final redaction enforcement at persistence and read-model boundaries. Extension code
does not publish runtime events directly.

Example atomic `thread_start` handler result:

```ts
const threadStartResult: ExtensionHandlerResult = {
  result: {
    content: [{ type: "text", text: "Queued 1 handler thread start request." }],
  },
  operations: [
    {
      kind: "runtime_effect",
      request: {
        type: "handler_thread.start",
        input: {
          workspaceSessionId: invocation.context.workspaceSessionId,
          threads: [
            {
              objective:
                "Inspect the failing queue delivery test and report the smallest product fix.",
            },
          ],
          sourceCommandId: invocation.command.commandId,
        },
      },
    },
  ],
};
```

The handler result text acknowledges the accepted request only. It does not claim that a thread row
already exists, does not expose generated handler titles, and does not provide a committed command
summary. Runtime derives and persists terminal command summaries only after
`handler_thread.start` commits the state mutation and associated command facts.

`@svvy/runtime` turns this request into final `thread_start.finished` command facts after the state
transaction commits, including the allocated `threadGroupId`, `threadId`, and `surfacePiSessionId`
values. The extension handler does not synthesize those ids, create handler surfaces directly, insert
queue rows directly, or publish runtime events.

### Shell

Owns `exec_command` and `write_stdin` extension behavior, validated command plans,
command-family classification, redaction metadata, and command-plan metadata. Runtime owns command
lifecycle, output ordering, command fact persistence, and UI projection from streamed tool intent
plus authoritative state facts.

Shell-authored command plans preserve:

- command string
- working directory
- declared command-family classification
- redaction metadata
- explicit command metadata that runtime records through command facts

Runtime attaches approval facts, sandbox snapshot facts, output events, exit status,
retained-output artifacts, and terminal command facts through the command lifecycle. Extension
handlers do not author runtime policy decisions or persist `@svvy/state` facts directly.

Prompt-only CLIs such as Smithers are ordinary Shell command-family work.

Final-result output backfill follows these rules:

- `stdout` from the final result is recorded as `command.output` with `source: "final-result"` only
  when no live stdout event already exists for that command.
- `stderr` from the final result is recorded as `command.output` with `source: "final-result"` only
  when no live stderr event already exists for that command.
- If final `stdout` or `stderr` exists, no summary-derived output is recorded.
- If neither final stream exists and any live command output exists, no summary-derived output is
  recorded.
- If neither final stream nor live command output exists, runtime may record the summarized tool
  result as final-result stdout.

Shell also owns per-invocation command-family observability classification:

```ts
type ShellCommandClassification = {
  appLogSource: "direct-tool" | "smithers";
  commandFamily: "generic-shell" | "smithers-cli" | "svvyx" | "other";
};
```

Commands whose accepted command vector is the official Smithers CLI form
`bunx smithers-orchestrator ...` are still ordinary `exec_command` work, but their classification is
`{ appLogSource: "smithers", commandFamily: "smithers-cli" }` rather than generic direct-tool output.
This classification is a per-command fact derived from the accepted command, not static native-tool
metadata and not a Smithers wrapper surface.

`@svvy/runtime` owns the scoped command runner that executes accepted Shell plans:

- `exec_command` and `write_stdin` are executed through runtime-owned scoped command/session
  resources.
- New child processes are acquired in a runtime `Scope` and release/interrupt on cancellation.
- Long-running command sessions store retained handles in a runtime scoped command-session service
  keyed by command/session id, with explicit cleanup on terminal status or runtime shutdown.
- stdout and stderr are represented as streams; ordering facts needed by command projection are
  preserved before persistence by runtime.
- When global stdout/stderr ordering is needed, runtime uses one authoritative output consumer,
  normally the combined process output stream, or one runtime-owned sequencer that tags stdout and
  stderr. It must not consume separate stdout/stderr streams and the combined stream concurrently
  for the same command facts. Every spawned stream is consumed, drained, or explicitly closed.
- Sandbox launch policy and approval facts are runtime inputs to process launch. Shell does not
  decide approval, build sandbox policy, own process handles, or persist command rows directly.

Agent-authored `svvyx ...` text that goes through Shell is ordinary `exec_command` work and follows
the process rules above. Internal `Extensions.svvyx.run(...)` service calls inside
`@svvy/extensions` and generated `execute_typescript` extension facades are extension service calls.
They validate extension command contracts and return one model-facing result plus ordered closed
runtime operations: either runtime-effect requests or immutable command plans for runtime to
execute. Do not treat internal extension dispatch as a shell subprocess unless that specific
extension operation returns an execution plan that launches one.

App-owned `svvyx` commands that mutate generated package roots, such as `svvyx workflows save` and
`svvyx workflows build`, project through the Shell command UI but are not authorized as generic
`direct_shell` filesystem mutations. The app-owned `svvyx` CLI/dispatcher invokes the Workflows
extension command contract and returns a model-facing command result plus `ExtensionRuntimeOperation`
items wrapping closed runtime effect requests or command plans. Runtime records durable command
facts. Runtime grants generated-root write access only for explicit app-owned generated-package
build/link refresh work, not by inspecting arbitrary Shell command text. Generated package files,
generated extension build roots, and workspace `.smithers/node_modules/@svvyx/*` links remain
read-only to ordinary Shell commands and ordinary extension-facade child launches.

### Apply Patch

Owns `apply_patch` extension behavior and structured file-change projection.

`apply_patch` records accepted-argument patch snapshots and final patch facts such as changed files,
created files, deleted files, and errors.

### Execute TypeScript

Owns `execute_typescript` extension behavior, source artifact semantics, diagnostics, import
policy, actor-scoped extension facade declarations, and validated command/facade plans.

Generated extension-facade calls inside `execute_typescript` become child commands under the parent
`execute_typescript` command.

`@svvy/runtime` owns sandboxed process launch, scoped process lifetime, child-command fact
recording, and persistence through `@svvy/state`. The `execute_typescript` extension service uses
Effect for diagnostics, import-policy validation, facade-plan validation, and extension-facade
dispatch semantics.

Agent-authored `execute_typescript` snippets receive Promise-returning injected facades because the
snippet authoring surface is ordinary async TypeScript:

```ts
await extensions.artifacts.run("inspect", { options: { id: artifactId } });
```

Those injected Promise adapters run Effect handlers inside the `execute_typescript` runtime. They
are not package-root facades, are not generated-package imports from `@svvyx/extensions`, do not
export from `@svvy/extensions`, do not expose broad runtime APIs, and receive their trusted
actor/session/surface/thread/parent-command context from runtime-owned state rather than from
snippet arguments, shell environment variables, or prompt text.

`execute_typescript` snippets must not import `@svvyx/workflows` or `@svvyx/extensions` as runtime
facades. Generated `@svvyx/*` packages are workflow/source-authoring artifacts. The actor-local
`extensions` object is the callable runtime surface for loaded TypeScript facades.

### Request User Input

Owns `request_user_input` as a native control extension for model-facing schema, option schema,
variant-specific instructions/descriptions, validation, default-answer derivation, and the
model-facing `RequestUserInputResult`.

The handler returns an `ExtensionHandlerResult` whose ordered operations include one
`runtime_effect` item whose request type is `request_input.create`. Runtime owns applying that
effect: durable request creation through `RuntimeRequestStatePort`, command progress/wait/finish
through `RuntimeCommandStatePort`, nonblocking immediate completion, blocking wait state, timeout
completion, and later nonblocking answer queue insertion through `runtime.requestInput.answer`.
State owns persisted request, answer, timeout, command, wait, and queue-delivery facts. Desktop only
renders the panel and captures user input.

### Thread Orchestration And Thread Handling

Own handler-thread tools and domain invariants: `thread_start`, `thread_followup`,
`thread_request_report`, `thread_list`, `thread_current`, `thread_group`, `thread_report`, and
`thread_episodes`. The extension domain validates tool inputs and returns model-facing handler
results plus `ExtensionRuntimeOperation` items wrapping closed `RuntimeEffectRequest` values.
Runtime owns handler-surface creation, atomic
`handler_thread.start` application, queue scheduling, command lifecycle/terminal facts, and
orchestrator reconciliation. State persists thread facts, episodes, reports, queue rows, surface
bindings, and read models.

For delegated handler-thread episodes, `thread_report` is the only model-callable path that creates
durable semantic episodes. Other episode producers and non-thread episode scopes must be explicitly
granted by a product spec, backed by a state read/write model, added to the closed `episode.record`
`RuntimeEffectRequest` contract, and applied by `@svvy/runtime`.

### Artifacts

Owns artifact extension commands, validation, generated command facts, and `svvyx artifacts ...`
semantics as an internal source folder.

State owns artifact metadata, materialization status, stored-path facts, byte-size/digest facts,
immutable flags, lifecycle rows, and read-model indexes through explicit artifact ports. Runtime
owns artifact byte materialization, deletion, recovery, command effects, and sandbox launch policy
coordination. Desktop owns preview iframe sandbox permissions and rendering.
Artifact command behavior remains an internal `@svvy/extensions` domain coordinated with
`@svvy/runtime` and `@svvy/state`; no public `@svvy/artifacts` package exists.

### Workflows

Owns the Workflows extension: reusable asset/source-library guidance, `svvyx workflows ...`
commands, generated-package source validation, generated-package build semantics, and command-plan
metadata. The `@svvy/extensions` generated-package service owns source validation,
generated package file writes, atomic output replacement, and exact workspace-link repair plan
production only when runtime separately asks for a specific workspace/package link plan. `svvyx
workflows save` and `svvyx workflows build` return a model-facing command result plus an ordered
`ExtensionRuntimeOperation` wrapping a closed `generated_packages.refresh` `RuntimeEffectRequest`;
durable command facts are recorded only by `@svvy/runtime` through `@svvy/state`. Source-edit
triggered Workflows source changes are not `svvyx` command results: runtime/source-edit lanes commit
the source fact, then enqueue or apply the same closed `generated_packages.refresh`
`RuntimeEffectRequest` through runtime-owned source invalidation. Neither path schedules
workspace-link work directly; runtime schedules link repair only after generated-package facts
commit. `svvyx workflows list` and `svvyx workflows models list` are read-only: they report
state-backed generated-package/export facts or pi-normalized provider/model metadata and must not
return `generated_packages.refresh`.

Runtime owns build/link refresh scheduling, workspace-link fanout, retry/recovery policy, and
publication of state-backed invalidations. State owns persisted generated-package facts, diagnostics,
workspace link state, and Workflows pane read models. Desktop renders those read models.
The canonical lifecycle is split into two runtime-owned lanes. For app-global refresh, runtime
calls `Extensions.generatedPackages.refresh(...)` with `GeneratedPackageBuildInput`, extensions
performs only generated-package validation/write work, returns `GeneratedPackageBuildPlanResult`
with package build statuses/evidence only, and runtime records generated-package facts after output
replacement. Only after those facts commit does runtime schedule workspace-link repair for acquired
workspaces. For `workspace-link-repair`, runtime reads current generated-package facts and calls
`Extensions.generatedPackages.planWorkspaceLink(...)` with
`GeneratedPackageWorkspaceLinkRepairInput` for each targeted workspace/package; it does not call
`refresh(...)` or rebuild generated packages in the link-repair lane. Runtime-owned workspace
repair applies `.smithers/node_modules/@svvyx/*` link changes from that separate immutable link
plan, and state records only decoded generated-package and workspace-link facts. Extensions and
state code must not create, remove, or rewrite workspace `@svvyx/*` filesystem links directly.

Runtime calls `extensions.generatedPackages.refresh(...)` when applying
`generated_packages.refresh` requests from the `@svvy/core` `RuntimeEffectRequest` algebra. The
runtime maps the refresh request to a `GeneratedPackageBuildInput` before crossing into
`@svvy/extensions`; `scope`, `workspaceId`, `reason`, `sourceCommandId`, and `recoveryWorkId` remain
runtime-only scheduling and lineage fields. The extension service performs source validation,
generation, and package writing; link-plan production happens only through
`Extensions.generatedPackages.planWorkspaceLink(...)`. Runtime-owned workspace repair performs
workspace link filesystem effects. State records generated-package build/link facts and after-commit
invalidation descriptors. Runtime owns when that work runs, how failures retry or recover, and when
state-backed read-model invalidations are published.

`@svvy/extensions` returns generated-file evidence, generated manifest evidence, dependency
evidence, exact renderer-safe `workflowsExports` build evidence, and optional per-package string
diagnostics through `GeneratedPackageBuildPlanResult` from `generatedPackages.refresh(...)`; it
returns workspace-link plans only from `generatedPackages.planWorkspaceLink(...)`. Each Workflows
export evidence row is derived from one validated source item plus its rendered output file; agent
rows carry their validated task-agent parameter record and workflow-agent identity, while
non-agent rows carry `null` for both agent-only fields. Runtime decodes those outputs and writes
generated-package facts through `RuntimeGeneratedPackageStatePort` after successful output
replacement or reconciliation. Extensions never call generated-package state ports directly, never
emit read-model invalidations, and never duplicate state-owned generated-package facts in generated
`@svvyx/*` files.
Generated `@svvyx/*` package files contain only generated source declarations, package metadata, and
the generated manifest evidence required for reconciliation. They must not contain runtime ids,
workspace ids, workspace link paths/status, command ids, recovery ids, read-model invalidations,
state revisions, environment readiness mirrors, or DB/product-state previews.

Generated `@svvyx/extensions` exports are allowed only as workflow task-agent extension reference
values. They are not runtime facades, state read models, extension inventory mirrors, dependency
status views, generated-context payloads, or desktop/renderer bridge contracts.

The Workflows extension does not run, resume, approve, inspect, or debug active Smithers workflows.

Workflows build semantics:

- Source validation, generation, dependency checks, package writing, and explicit workspace-link
  plan production are `@svvy/extensions` Effect operations; refresh performs only the validation,
  generation, dependency-check, and package-write part. Applying workspace link repair is explicit
  runtime-scheduled Effect work.
- `@svvyx/extensions` generation reads the workflow-task-safe extension reference set and emits
  workflow task-agent reference values. That set contains builtin extension ids valid for workflow
  task-agent overrides plus file/build-eligible user `svvyx` extensions that opt into workflow
  task-agent reference export generation, have approved dependencies, and have successful current
  source/build evidence. This is distinct from DB-backed readiness mirrors and generated
  `execute_typescript` facade declarations. Deleted, instruction-only, dependency-blocked, and
  build-failed extensions are excluded. `@svvyx/workflows` generation reads app-global reusable
  workflow source and may depend on generated extension references when task-agent source needs
  them.
- `@svvy/extensions` owns the `@svvyx/extensions` reference-set eligibility predicate.
  App/bootstrap and declared Effect host/config ports and layers supply only host facts: app-owned
  extension root paths, directory names, JSON file reads, source fingerprints, dependency approval
  ledger checks, and installed package artifact reads.
  Runtime, Workflows build code, direct tools, and Smithers integration code must not reimplement
  readiness rules for reference exports.
- The generated extension reference expression helper is package-owned:
  `generatedExtensionReferenceExpression("git")` returns `Extensions.git.id`, and
  `generatedExtensionReferenceExpression("apply-patch")` returns
  `Extensions["apply-patch"].id`. Workflow task-agent parameter serialization uses that helper
  instead of inventing generated aliases.
- Build output uses scoped temporary directories and atomic replacement of generated output. Each
  generated package root contains a generated manifest with package name, build id, source
  fingerprint, output fingerprint, generated file list, `GeneratedPackageDependencyEvidence`
  entries, and created timestamp.
- Runtime records generated package facts and read-model invalidations through state ports after
  successful output replacement, using the same build id and fingerprints written in the generated
  manifest. `@svvy/extensions` returns generated file evidence and immutable link plans; it does
  not write generated-package state facts directly.
- If output replacement succeeds and the state update fails, the generated manifest is file-backed
  recovery evidence for reconciliation, not product/read-model authority. Runtime enqueues
  generated-package recovery, startup reconciliation scans generated package manifests, and repaired
  generated-package facts become authoritative only after the `@svvy/state` commit succeeds.
- If state facts point to a missing or mismatched generated manifest, the generated package read
  model reports the package as needing refresh and runtime schedules `generated_package_refresh`.
- Workspace link repair is explicit runtime-scheduled work and records typed command/recovery facts.
- Dependency readiness failures are typed `ExtensionError` failures and app-log/read-model facts,
  not partial generated packages.
- Generated package read-model updates are state facts; runtime events only notify consumers to
  refetch.

| Resource                                      | Owner package/service                                                                                                                       | Backing kind     | Lifetime kind              | Acquired by                                                                                                                                                                     | Released by                                                                                                | Reused across calls                                                   | Interruption behavior                                                                                                                                           | Required receipts/tests                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Extension source file read/edit session       | `@svvy/extensions` source service                                                                                                           | file-backed      | `operationScoped`          | source read/save/build effect using injected filesystem/path services                                                                                                           | operation completion; app-owned source file persists until explicit source command updates/deletes it      | no                                                                    | interruption cancels current read/save/build before commit; compare-and-swap prevents stale overwrite                                                           | source-version CAS test, invalid source keeps previous ready output test         |
| Scripted instruction generator process/effect | `@svvy/extensions` generated instruction service                                                                                            | host resource    | `operationScoped`          | extension build invokes source-root `scripts/generate-instructions.ts` with exact declared version inputs                                                                       | build operation finalizer; generated output persists only after successful replacement                     | no                                                                    | interruption cancels generator and removes temp output                                                                                                          | generated instruction exact-version test, interruption cleanup test              |
| Generated package temporary directory         | `@svvy/extensions` generated-package service                                                                                                | generated output | `operationScoped`          | generated-package build effect creates scoped temp root                                                                                                                         | operation finalizer on failure/interruption or atomic replacement on success                               | no                                                                    | interruption removes temp root and leaves previous ready package active                                                                                         | atomic replacement test, failed build preserves prior manifest test              |
| Generated package root and manifest           | `@svvy/extensions` generated-package service; generated-package DB facts are owned by `@svvy/state` and written through runtime/state ports | generated output | `durableGeneratedOutput`   | successful generated-package build atomically replaces app-owned generated root under the app runtime layer                                                                     | next successful build replacement, explicit generated-root cleanup, or app uninstall; not request disposal | yes, consumed by Workflows/source authoring and workspace link repair | build fiber interruption before atomic promotion keeps the previous generated root active; after replacement reconciliation uses manifest if state update fails | manifest/source-output fingerprint test, reconciliation-after-state-failure test |
| CLI requirement probe subprocess              | `@svvy/extensions` dependency/readiness service                                                                                             | host resource    | `operationScoped`          | requirement inspect/build effect with extension-owned `CliRequirementProbePlan`; no user approval fact mutation, no Shell/runtime command session, no managed extension secrets | probe command terminal fact or operation finalizer                                                         | no                                                                    | interruption cancels probe and records no readiness success                                                                                                     | exact-version probe test, missing/wrong-version typed diagnostic test            |
| Dependency install/update subprocess          | not acquired by extensions; agent-initiated installs are ordinary Shell work                                                                | host resource    | not acquired by extensions | Extensions UI install/update controls do not start subprocesses because dependency install/update admission is outside the shipped public runtime facade surface                | not applicable                                                                                             | no                                                                    | readiness remains unchanged until a later probe observes installed dependency state                                                                             | no runtime dependency-action facade/export test                                  |
| Extension reference eligibility cache         | not part of the architecture                                                                                                                | process-local    | not acquired               | no cache is created unless this spec is updated with capacity, invalidation ownership, and app-runtime layer lifetime                                                           | source fingerprint invalidation or app runtime disposal after a spec update                                | no                                                                    | source/reference eligibility is recomputed from authoritative source facts; no cache publishes runtime events directly                                          | no-cache-by-default boundary test                                                |

### Smithers

Hosts the prompt-only generated Smithers instruction extension surface.

Smithers instruction content is governed by the Smithers extension spec and generation pipeline.

The Smithers builtin extension is prompt-only. It emits no native tool schema, no `svvyx smithers`
namespace, no generated `execute_typescript` facade declaration, no generated package exports, and
no task-agent bridge API. Its generated contributors are derived from the selected official Smithers
documentation version plus the svvy boundary appendix. Detailed Workflows import and command
guidance is owned only by the Workflows extension.

The Smithers boundary appendix may include only the small positive boundary note that
`svvyx workflows ...` is for reusable source-library operations and that reusable svvy workflow
assets in workspace `.smithers` authoring source are imported from generated `@svvyx/workflows`.
Smithers still emits no `svvyx smithers`, no runtime facade, no generated package exports, and no
detailed Workflows source-library authoring guidance.

### Prompt-Only CLI Guidance

Web, cx, Git, and GitHub are prompt-only CLI guidance in this architecture.

## Generated Package Rules

- Generated workflow assets use `@svvyx/workflows`.
- Generated extension references use `@svvyx/extensions`.
- Generated package names outside the `@svvyx/*` namespace are not emitted.
- Workflows extension guidance teaches generated `@svvyx/workflows` imports only for generated
  workflow assets and workspace `.smithers` source that consumes the ready generated package.
  Persistent Workflows source-library component/workflow files are generation inputs and must not
  import `@svvyx/workflows`. Those persistent source files may import `@svvyx/extensions` only for
  extension reference values allowed by the generated-packages spec.
- Generated `@svvyx/*` imports are never `execute_typescript` runtime facades.
- Smithers extension guidance may include only the boundary pointer to Workflows-owned reusable
  assets and generated `@svvyx/workflows` imports in workspace `.smithers` source; detailed
  Workflows source-library command/import/model-selection guidance and `@svvyx/extensions`
  reference authoring stay in Workflows guidance.

## Resource Lifetimes

| Resource                                   | Owner package/service                              | Backing kind               | Lifetime kind                                                                   | Acquired by                                                                                                                                                                                                                                        | Released by                                                                              | Reused across calls        | Interruption behavior                                                                                     | Required receipts/tests                                              |
| ------------------------------------------ | -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Source edit file write/staging             | `@svvy/extensions` `Extensions.sources.*`          | file-backed                | `operationScoped`                                                               | source create/save/delete method scope through `FileSystem` / `Path`                                                                                                                                                                               | operation finalizer after atomic write/delete or failure                                 | no                         | removes temp/staging output and returns typed `ExtensionError`; state facts are recorded by runtime later | CAS save, interrupted write cleanup, no arbitrary path write         |
| Dependency probe/generator child process   | `@svvy/extensions` dependency/source/build helpers | host subprocess            | `operationScoped`                                                               | helper method scope through an extension-owned bounded host helper port; `ChildProcessSpawner.ChildProcessSpawner` may back that port only after the Effect spec, manifest, host-layer, boundary-allowlist, and fake-spawner test rules promote it | process exit, timeout, or method-scope interruption                                      | no durable session reuse   | stops child process, drains bounded output, and returns typed probe/build error evidence only             | fake helper-port timeout, output redaction, no runtime command facts |
| Generated context cache file, when emitted | `@svvy/extensions` `generatedContext.build`        | file-backed cache evidence | operation-scoped write; durable only as cache evidence after atomic replacement | generated-context build scope                                                                                                                                                                                                                      | temp finalizer on failure/interruption; later cache replacement/cleanup for durable file | yes only as cache evidence | failure keeps prior generated facts authoritative; cache is never source truth                            | cache evidence, failed cache write does not mutate state             |

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on Effect v4.
- Does not depend on `@svvy/state`.
- Does not depend on `@svvy/sandbox`.
- Must not depend on `@svvy/runtime` or `@svvy/desktop`.
- May depend on Incur for `svvyx` extension build and dispatch.
- May depend on Smithers documentation-generation inputs only inside the Smithers builtin extension
  source folder.

`@svvy/extensions` receives core-owned, schema-backed port services supplied at composition time,
such as `ExtensionStatePort`. It does not import `@svvy/state`, `@svvy/sandbox`, state table
modules, sandbox helpers, runtime services, desktop modules, runtime artifact state ports, or raw
artifact file-store ports.

## Environment And Dependencies

Extension env status is product state. State stores encrypted values, redacted status, and
dependency readiness facts. Extensions declare env requirements, CLI requirements, and redaction
metadata. Agent-facing inspection APIs receive only redacted readiness/status. Trusted invocation
code receives invocation-local env snapshots only from runtime-owned trusted invocation assembly
after a concrete command/facade invocation is admitted. `ExtensionStatePort` exposes env
declarations, redacted status, approval/readiness facts, and secret references only; it is not a raw
secret-value port. Raw secret material is resolved only by the runtime-owned trusted invocation
boundary through the core-owned `SecretStorePort` supplied by app/bootstrap.

Rules:

- Read models and app logs expose status only, never raw secret values.
- Invocation env is resolved per command/tool run and is not cached in prompts, generated packages,
  transcripts, command facts, app logs, artifacts, snapshots, or renderer stores.
- Extensions do not read `process.env` directly for product secrets.
- `baseEnv` is a sanitized, non-secret invocation environment assembled by runtime from allowlisted
  keys. Raw host env and managed secrets appear only through
  `ExtensionInvocationEnvSnapshot.secretValues` at the trusted execution boundary.
- CLI requirement probes use `CliRequirementProbePlan`: direct executable/argv only, no shell
  strings, explicit non-secret env map with `extendEnv: false`, timeout, max stdout/stderr bytes, and
  an output redaction plan. The env map is allowlisted by the plan and is not inherited from the host
  environment. Probe results are typed as `missing`, `unknown`, `version-mismatch`, or `ready`.
  Probe plans and fake-spawner tests prove probes do not receive managed extension secrets and do
  not call Shell, runtime command execution, or dependency install/update paths.
- Extension subprocess env is fully resolved only in the runtime-owned trusted invocation boundary.
  The extension service result carries an encoded `ExtensionExecutionEnvPlan`: non-secret literal
  values, required env names, secret reference keys, redaction fingerprints, and launch-policy
  metadata. Runtime resolves that plan into `baseEnv` plus optional `extensionEnv` only for trusted
  builtin `svvyx` command invocations or generated-facade child-command invocations whose declared
  extension command requires that extension's secrets. Trusted means the invocation is for an
  app-owned builtin extension id, was admitted through runtime's accepted command/facade lane, has a
  source command id owned by that lane, and validates against the extension command schema that names
  the required env references. User extension source, generic Shell commands, parent
  `execute_typescript` snippets, dependency probes, install/update commands, prompts, generated
  declarations, generated packages, transcripts, app logs, artifacts, snapshots, and renderer
  surfaces never receive managed extension secrets. Runtime passes an explicit env map to process
  launch after redaction and policy checks. `extendEnv` and ambient env inheritance are forbidden for
  extension-owned plans; app-edge host env allowlists are separate runtime/sandbox launch policy and
  must be represented as explicit `baseEnv` entries before the extension plan is resolved.
- Dependency readiness failures are typed `ExtensionError` values plus state/app-log facts, not
  silent prompt omissions or partially generated packages.
- Env requirement results expose only declaration metadata and readiness status: required name,
  secret/non-secret kind, configured/missing status, source `manifest-default`, `app-override`, or
  `secret-store`, and redacted display value when allowed. Invocation env resolution returns only
  invocation-local values for one trusted extension command/facade invocation. `ExtensionRedactionPlan`
  contains exact env key names, generated token fingerprints, and structured output redaction rules;
  redaction hooks are deterministic, idempotent, and run before runtime/state persistence.
- The only generated-code env-read exception is generated `@svvyx/workflows` Smithers task-agent
  client code reading the exact command-scoped `SVVY_WORKFLOW_AGENT_*` variables named by
  `generated-packages.spec.md`. That code is generated package bridge code, not
  `@svvy/extensions` service code, and it reads no product secrets beyond the command-scoped bridge
  token injected by runtime for that Smithers command.

User-clicked dependency install/update controls are unavailable. Agent-initiated dependency installs
remain ordinary Shell work. `@svvy/extensions` owns dependency declarations, readiness probes,
trusted-dependency approval identity inputs, and immutable command-plan validation constraints; it
does not start install/update subprocesses and does not provide a public runtime admission method.

Runtime-injected `execute_typescript` facades are generated-context declaration text for
app-owned builtin TypeScript-enabled extension facades. They are not generated-package imports,
durable `@svvyx/*` package outputs, or user-extension TypeScript facade declarations.

## Source Edit Sessions

`@svvy/core` owns the source-edit request/result DTOs because `Runtime.sourceEdits` exposes them
across package and facade boundaries. `@svvy/extensions` owns the file-backed implementation of
extension and Workflows source edit sessions because those files are extension/source-library inputs.
`@svvy/state` owns source version, fingerprint, diagnostic, and read-model facts for those files.
The public `Runtime.sourceEdits.open(...)` result is assembled by runtime from two authorities:
`@svvy/extensions` resolves and reads the file-backed source, while `RuntimeSourceStatePort` supplies
the current DB-backed source fact when one exists. `@svvy/extensions` never queries state to invent
or persist source-version facts, and callers never provide a path as authority.

Source edit-session API:

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

type SaveExtensionSourceEditInput = {
  sourceKind: OpenExtensionSourceEditInput["sourceKind"];
  sourceId: string;
  expectedSourceVersion: string;
  text: string;
  saveMode: "compare-and-swap" | "overwrite";
  sourceCommandId?: CommandId;
};

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

`OpenExtensionSourceEditInput` / `SaveExtensionSourceEditInput` identify one editable or
display-only source by flat `sourceKind` and `sourceId` fields. `builtin-extension`,
`user-extension`, `workflow-agent`, `workflow-prompt`, `workflow-component`, and
`workflow-workflow` are promoted source kinds. `Extensions.sources.openEditSession` and
`Extensions.sources.saveEditSession` implement saves only for editable source ids. Generated/read-only
outputs fail saves with typed `read-only-source` errors. Detailed extension source selection is
resolved from `sourceKind` and `sourceId`; callers do not provide paths as authority.

`SourceEditSaveResult.status: "saved"` returns the file-backed content fingerprint that
`@svvy/extensions` computed after the atomic write; the same value is carried in both
`sourceVersion` and `fingerprint` until runtime records authoritative state. That returned
`sourceVersion` is candidate file evidence, not a DB/product-state source-version row.
`@svvy/extensions` never creates, increments, or records authoritative source-version rows. Runtime
admits compare-and-swap against `RuntimeSourceStatePort` before the file write when a DB-backed
version exists, then records source-version, fingerprint, diagnostic, command-lineage,
generated-package scheduling, and read-model invalidation facts through `RuntimeSourceStatePort`
after the file write succeeds. Any state descriptors produced while recording those facts are
consumed only by the runtime-owned source-edit and source-invalidation lane; they are not returned
from `SourceEditSaveResult`.

```ts
type WorkflowAgentSourceExportName = string & Brand<"WorkflowAgentSourceExportName">;
type WorkflowPromptSourceExportName = string & Brand<"WorkflowPromptSourceExportName">;
type WorkflowComponentSourceExportName = string & Brand<"WorkflowComponentSourceExportName">;
type WorkflowSourceExportName = string & Brand<"WorkflowSourceExportName">;

type WorkflowAgentSourceDraft = {
  exportName: WorkflowAgentSourceExportName;
  displayName: string;
  description: string;
  model?: string;
  reasoningEffort?: string;
  instructionText?: string;
  extensionUsageOverrides?: readonly {
    extensionId: ExtensionId;
    usage: "loaded" | "available" | "unavailable";
  }[];
};

type WorkflowPromptSourceDraft = {
  exportName: WorkflowPromptSourceExportName;
  displayName: string;
  description?: string;
  mdx: string;
};

type WorkflowComponentSourceDraft = {
  exportName: WorkflowComponentSourceExportName;
  displayName: string;
  description?: string;
  sourceText: string;
  extension: "ts" | "tsx";
};

type WorkflowSourceDraft = {
  exportName: WorkflowSourceExportName;
  displayName: string;
  description?: string;
  sourceText: string;
};

type CreateWorkflowAgentSourceInput = {
  draft: WorkflowAgentSourceDraft;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type DuplicateWorkflowAgentSourceInput = {
  sourceId: WorkflowAgentSourceExportName;
  draftPatch: {
    exportName: WorkflowAgentSourceExportName;
    displayName?: string;
    description?: string;
    instructionText?: string;
  };
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type DeleteWorkflowAgentSourceInput = {
  sourceId: WorkflowAgentSourceExportName;
  expectedSourceVersion: string;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type CreateWorkflowPromptSourceInput = {
  draft: WorkflowPromptSourceDraft;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type DeleteWorkflowPromptSourceInput = {
  sourceId: WorkflowPromptSourceExportName;
  expectedSourceVersion: string;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type CreateWorkflowComponentSourceInput = {
  draft: WorkflowComponentSourceDraft;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type DeleteWorkflowComponentSourceInput = {
  sourceId: WorkflowComponentSourceExportName;
  expectedSourceVersion: string;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type CreateWorkflowSourceInput = {
  draft: WorkflowSourceDraft;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type DeleteWorkflowSourceInput = {
  sourceId: WorkflowSourceExportName;
  expectedSourceVersion: string;
  sourceOwner: "agents-pane" | "svvyx-workflows-command" | "headless";
  sourceCommandId?: CommandId;
};

type WorkflowSourceKind =
  | "workflow-agent"
  | "workflow-prompt"
  | "workflow-component"
  | "workflow-workflow";

type WorkflowSourceExportNameByKind<K extends WorkflowSourceKind> = K extends "workflow-agent"
  ? WorkflowAgentSourceExportName
  : K extends "workflow-prompt"
    ? WorkflowPromptSourceExportName
    : K extends "workflow-component"
      ? WorkflowComponentSourceExportName
      : WorkflowSourceExportName;

type WorkflowSourceLifecycleResult<K extends WorkflowSourceKind> = {
  status: "created" | "duplicated";
  session: SourceEditSession & {
    sourceKind: K;
    sourceId: WorkflowSourceExportNameByKind<K>;
  };
  fileWriteReceipt: {
    path: AbsolutePath;
    previousExists: false;
    bytes: number;
  };
  reconcileRequired: true;
};

type WorkflowSourceDeleteResult<K extends WorkflowSourceKind> = {
  status: "deleted";
  sourceKind: K;
  sourceId: WorkflowSourceExportNameByKind<K>;
  deletedPath: AbsolutePath;
  previousSourceVersion: string;
  fileWriteReceipt: {
    path: AbsolutePath;
    deleted: true;
  };
  reconcileRequired: true;
};

type WorkflowAgentSourceLifecycleResult = WorkflowSourceLifecycleResult<"workflow-agent">;
type WorkflowAgentSourceDeleteResult = WorkflowSourceDeleteResult<"workflow-agent">;
type WorkflowPromptSourceLifecycleResult = WorkflowSourceLifecycleResult<"workflow-prompt">;
type WorkflowPromptSourceDeleteResult = WorkflowSourceDeleteResult<"workflow-prompt">;
type WorkflowComponentSourceLifecycleResult = WorkflowSourceLifecycleResult<"workflow-component">;
type WorkflowComponentSourceDeleteResult = WorkflowSourceDeleteResult<"workflow-component">;
type WorkflowWorkflowSourceLifecycleResult = WorkflowSourceLifecycleResult<"workflow-workflow">;
type WorkflowWorkflowSourceDeleteResult = WorkflowSourceDeleteResult<"workflow-workflow">;
```

The same lifecycle pattern applies to `workflow-prompt`, `workflow-component`, and
`workflow-workflow` source kinds, but method results are not typed as workflow-agent results. Their
create/delete inputs differ only by draft shape and `sourceKind`; each method returns the result
alias whose `sourceKind` exactly matches the source kind it created, duplicated, or deleted. Adding
a new workflow source kind requires adding the exact source kind,
create/delete DTOs, file-backed root mapping, source diagnostics, and runtime state-commit tests in
the same change.

Callers identify editable source by `sourceKind` and `sourceId`, not by a path. The implemented
source edit session resolves builtin/user extension minimal instruction Markdown plus Workflows
source-library files for `workflow-agent`, `workflow-prompt`, `workflow-component`, and
`workflow-workflow`. Fragment-qualified extension sources, scripted source contributors, normal
builtin/user extension `source/index.ts`, and generated `commands.json` inspection/edit-session
records remain source-lifecycle responsibilities but are not implemented source edit sessions yet.
All
default prompt and instruction source authority belongs to `@svvy/extensions`. DB/product state
records only source facts such as path, version, fingerprint, diagnostics, and deletion state, never
duplicated source text. Runtime and generated-context loading use the current local scaffolded or
reset source state; packaged builtin templates are used only to scaffold missing sources or reset a
builtin source explicitly. Generated outputs may be opened for display when supported, but
`saveEditSession` rejects read-only sources with a typed `read-only-source` error only for source
kinds implemented by the resolver.
`@svvy/extensions` resolves the canonical source path from its source root registry, current
manifest/source-library metadata, and generated package ownership rules. The resolved path is
returned in `SourceEditSession` for display, diagnostics, and external-editor handoff, but it is not
accepted as authority from desktop, runtime, headless callers, generated packages, or agents. This
prevents source edit sessions from becoming arbitrary file-write APIs.

Rules:

- Source kind to file-backed root mapping is exact:
  - `builtin-extension`: `~/.config/svvy/extensions/sources/builtin/<extension-id>/**`
  - `user-extension`: `~/.config/svvy/extensions/sources/user/<extension-id>/**`
  - `workflow-agent`: `~/.config/svvy/workflows/agents/<exportName>.agent.json`
  - `workflow-prompt`: `~/.config/svvy/workflows/prompts/<exportName>.mdx`
  - `workflow-component`: `~/.config/svvy/workflows/components/<exportName>.ts` by default, or
    `<exportName>.tsx` when copied from TSX component source
  - `workflow-workflow`: `~/.config/svvy/workflows/workflows/<exportName>.tsx`
- Normal builtin and user extension `svvyx` command source, generated `commands.json` inspection,
  and fragment-qualified source ids are not implemented source edit sessions yet. Generated
  `commands.json` command input/result schemas remain projections from owning Effect Schema
  contracts using the same
  `Schema.toJsonSchemaDocument(..., { additionalProperties: false, includeAnnotationKey: isPublicSchemaAnnotationKey })`
  policy as native tools. Runtime and extension dispatch still validate command input/output with
  the source Effect Schema and `strictBoundaryParseOptions`; generated JSON Schema is declaration
  evidence only, not the validation source of truth.
  Effect v4 `Schema.toJsonSchemaDocument(...)` returns a document with root `schema` and
  `definitions`. Generated command/native declarations first call
  `JsonSchema.resolveTopLevel$ref(document)` on the whole document. They use the resolved document's
  `schema` for the declaration body and attach the resolved document's `definitions` as root `$defs`
  when non-empty, preserving nested `#/$defs/*` references.
  If a target bridge cannot carry root `$defs`, generation rejects the declaration with structured
  diagnostics. Schema inlining is not adopted until the owning package spec names one tested inliner,
  its semantic limits, package-boundary allowlist, and focused fixtures. Generation must not emit
  dangling `$ref` values or hand-maintained parallel schemas.
- App-owned builtin `svvyx` namespaces whose implementation lives in product code, including
  Extension Managing, Artifacts, and Workflows, expose read-only generated command contracts and
  never expose editable `source/index.ts` runtime source.
- Workflow-agent `.agent.json` content edits use `openEditSession` and `saveEditSession`.
  Workflow-agent source lifecycle uses only `createWorkflowAgent`, `duplicateWorkflowAgent`, and
  `deleteWorkflowAgent`. Create and duplicate atomically write one new `.agent.json` file under
  `~/.config/svvy/workflows/agents/`, validate provider/model/reasoning metadata plus extension
  usage references against the current extension registry, return the opened `SourceEditSession` for
  the new source, and never persist source-version or generated-package facts directly. Delete
  compares `expectedSourceVersion` against the latest caller-visible source version, refuses default
  builtin agent ids, removes only the source file, and returns file evidence for runtime to persist
  through state ports. All three lifecycle methods set `reconcileRequired: true`; runtime owns
  source-fact commits and generated-package refresh scheduling after those commits. Runtime must
  first commit source-version, fingerprint, deletion, diagnostic, and command-lineage facts through
  state, then schedule source invalidation and generated-package refresh from the committed
  after-commit descriptors. If a create, duplicate, or delete file operation succeeds but the state
  write fails, runtime enqueues source-invalidation recovery for that source path before any
  generated-package refresh can rely on the changed source.
- `compare-and-swap` saves are admitted by runtime only after `expectedSourceVersion` matches the
  current DB-backed source-version fact supplied by `RuntimeSourceStatePort`. After that admission,
  `@svvy/extensions` compares only file evidence such as the resolved source reference and current
  file fingerprint before the atomic write. A mismatch returns `status: "stale"` and does not
  replace the file.
- `overwrite` is explicit user intent from the conflict UI. It records the prior fingerprint in
  state diagnostics and replaces the source file atomically.
- Saves write to a temporary file in the target directory and replace the source path with `rename`.
  The current save result returns `status: "saved"`, the new content-derived
  `sourceVersion`/`fingerprint`, empty diagnostics, and `reconcileRequired: true`; it does not
  return a file-write receipt or source reference. Runtime/state remain responsible for
  authoritative source-version/fingerprint facts and invalidation scheduling.
- Source saves are invoked through a runtime facade API, not directly from renderer panes.
  Runtime delegates the compare-and-swap file write to `@svvy/extensions`. The current
  `@svvy/extensions` save result returns only the new content-derived fingerprint/source version,
  diagnostics, and `reconcileRequired`; it never creates, increments, returns, or records
  authoritative source-version rows, fingerprint facts, diagnostic rows, read-model facts,
  invalidation facts, file-write receipts, or source references.
- After a source save commits, `@svvy/runtime` records the source version, fingerprint, diagnostics,
  and after-commit invalidation descriptors through `@svvy/state` ports, then schedules source
  invalidation, generated-context refresh, generated-package refresh, and read-model notifications
  through the normal runtime/state transaction path. If the state write fails after the source save,
  runtime enqueues source-invalidation recovery for that path. Startup reconciliation also scans
  source files and repairs state fingerprint rows before generated context or generated package
  refresh uses them.
- The UI never writes source files directly and never treats an editor draft as committed source.

`@svvy/extensions` depends on state-backed facts only through public Effect port service tags and
schema-backed contracts supplied at composition time, such as `ExtensionStatePort`. It does not
import `@svvy/state`, `@svvy/sandbox`, state table modules, generated-output fixtures, sandbox helper
internals, runtime modules, desktop modules, renderer modules, runtime artifact state ports, or raw
artifact file-store ports. Extension handlers receive the runtime-owned `CommandInvocationContext`
and may receive already-resolved sandbox-relevant values or return `ExtensionRuntimeOperation` items
wrapping immutable command plans or `RuntimeEffectRequest` values for runtime to apply. They do not
resolve mutable policy
snapshots, own sandbox launch policy, claim queues, schedule turns, create panes, write artifact
state, or mutate runtime/desktop state.

## Product Source Ownership

Product source areas owned by this package:

- `packages/extensions/src/extension-records.ts`
- `packages/extensions/src/builtin/**/*.mdx`
- `packages/extensions/src/builtin/**/*.ts`
- generated `execute_typescript` facade declaration templates, rendering code, emitted declaration
  assets, and actor-specific declaration slicing derived from core/extension source contracts
- package-local extension handler, native-tool metadata, command-family metadata, source lifecycle,
  generated-package, and `svvyx` dispatcher modules under `packages/extensions/src/**`
- package-local builtin command contract modules for app-owned `svvyx` namespaces, including
  Artifacts, Workflows, and Extension Managing
- package-local `svvyx` dispatcher helpers used by extension commands and generated-package
  production; runtime-owned internal bridge helpers, when needed, are listed in the runtime package
  ownership spec and must not expose a public `svvyx runtime` namespace or parallel workflow/runtime
  abstraction
- Smithers builtin extension prompt-generation source contributors and generated instruction outputs only;
  Smithers execution remains Shell `exec_command` over the official CLI.
- `packages/extensions/src/builtin/cx/**` and `packages/extensions/src/builtin/web/**` own
  prompt-only instruction sources, generation scripts, CLI requirement metadata, and extension
  records. No app-entry provider/tool runtime module outside `@svvy/extensions` and
  `@svvy/runtime` package contracts is part of the package boundary.
- native tool and command-family metadata modules consumed by runtime command lifecycle/projection
  services

## Acceptance Criteria

- All model-callable tools, prompt contributors, generated `svvyx` declarations, and extension-owned
  dependency requirements are expressed as extension records.
- Extension handlers return model-facing results plus typed fact payloads and ordered
  `ExtensionRuntimeOperation` items wrapping declarative `RuntimeEffectRequest` values or immutable
  execution plans; they do not mutate queues, transcripts, surfaces, or desktop state directly.
- Default prompts and instructions live as extension-owned MDX source files and are loaded
  through the extension registry.
- Generated `@svvyx/*` packages are local authoring artifacts owned by extensions; they are never
  runtime dependency-injection facades.
- `execute_typescript` receives only invocation-scoped facades injected by the runtime/extension
  boundary and rejects generated package imports as runtime facades.
- Extension dependency readiness and env requirements produce typed extension errors and state/app-log
  facts without leaking raw secrets into prompts, generated packages, transcripts, or renderer stores.
- When dependency planning is implemented, extension tests provide fake dependency-planning ports.
  Existing extension tests provide fake `ExtensionStatePort`, fake runtime-provided sandbox
  path-check helpers, and fake child-process spawner layers where those seams exist. Native tool
  handlers are tested as Effect programs and assert returned command facts and ordered
  `ExtensionRuntimeOperation` items instead of observing runtime side effects or artifact state
  mutations.

## Tests

`@svvy/extensions` does not export package-root test fixtures, `layerTest`, or
`ExtensionsTestHarness`. Test-only composition stays inside `packages/extensions/src/*.effect.test.ts`
files or package-local test-support modules that are not reachable through the `@svvy/extensions`
package export map.

Extension service/layer tests use local fake ports and local harness state for registry reads, actor
binding resolution, generated context builds, native tool declaration/handler lookup, `svvyx`
dispatch, generated package refresh/write/link work, env/dependency readiness, source edit sessions,
builtin scaffold and reset, and external instruction scans. Those harnesses are test-local
implementation details; they do not create manual `ManagedRuntime` instances and do not observe or
assert runtime/state side effects that belong to other packages.

- Builtin extension inventory tests.
- `@effect/vitest` service/layer tests.
- Actor binding matrix tests.
- Generated context snapshot tests.
- Prompt/MDX source contributor tests.
- Native tool metadata tests proving runtime projection behavior comes from extension metadata.
- Extension handler contract tests proving handlers return schema-backed fact payloads, declarative
  `RuntimeEffectRequest` values, or immutable execution plans rather than mutating queues/surfaces
  directly.
- `list_extensions` and `load_extension` tests.
- `svvyx` dispatch tests.
- CLI probe, generator, and generated-package helper tests with fake bounded host helper ports;
  fake `ChildProcessSpawner` layers are required only if the Effect process API is promoted as the
  helper-port backing.
- Native tool handler tests proving handlers return schema-backed facts, declarative
  `RuntimeEffectRequest` values, or immutable execution plans and never spawn child processes or
  mutate state/runtime queues directly.
- Generated-package negative tests proving DB read-model facts, inventory metadata,
  workspace-link status, runtime ids, read-model invalidations, and other state-owned fields are not
  emitted into generated `@svvyx/workflows` or `@svvyx/extensions` packages.
- Fake state/sandbox/dependency planner layer tests proving extension handlers do not import runtime,
  state table internals, sandbox helper internals, desktop, or renderer modules.
- Shell scope/interruption/stdout/stderr ordering tests.
- `execute_typescript` injected Promise-facade tests backed by fake Effect handlers.
- Request input tests.
- Thread tool tests.
- Artifact command tests.
- Workflows command and generated package tests.
- Workflows atomic build-output replacement and link-repair tests.
- Smithers generated instruction validation tests.
- Negative tests proving `@svvyx/extensions` is not the source of `execute_typescript` runtime
  facades.
- Negative tests proving prompt-only extensions do not expose injected `execute_typescript` runtime
  facades.
- Negative tests proving packaged default prompt material is emitted only through
  `@svvy/extensions` builtin/source assets.
