# `@svvy/extensions` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/extensions`

## Purpose

`@svvy/extensions` owns the extension system and builtin capability catalog.

If agents experience something as a model-callable tool, prompt-only guidance, `svvyx` command
family, generated `execute_typescript` client, loadable capability, or loaded instruction block, it
belongs here.

## Owns

- Builtin, user, and external-instruction extension records.
- Extension categories and interface kinds: native tool, `svvyx`, and instructions.
- Agent profile extension defaults, validation, and actor binding resolution.
- Base actor prompt extensions.
- All default prompt and instruction source assets.
- External instruction records for discovered files such as `AGENTS.md` and `CLAUDE.md`.
- Generated actor context entries owned by extensions.
- Tool declarations and actor-specific callable API slicing.
- Canonical tool metadata used by runtime projection and command tracking.
- `list_extensions` and `load_extension`.
- Extension env declarations, dependency readiness interpretation, CLI requirements, redaction, and
  invocation-local secret injection boundaries.
- Extension build validation and current-build metadata contracts.
- Stable app-owned `svvyx` dispatcher.
- Generated TypeScript clients for loaded callable `svvyx` extensions inside `execute_typescript`.
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
  - `request-input`
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

## Does Not Own

- Runtime turn orchestration.
- pi session creation.
- Durable state implementation.
- Persisted agent profile/settings records.
- Persisted extension env values, env status records, and encrypted secret storage.
- Queue insertion, claiming, ordering, retries, and delivery.
- Read-model projection for desktop panes.
- Artifact physical file storage.
- Sandbox policy semantics.
- Desktop UI rendering.
- Published packages for builtin subdomains.
- A public prompt package.

## Public API Shape

Expected surface:

```ts
import { createExtensions } from "@svvy/extensions";

const extensions = createExtensions({
  state: state.extensionStatePort(),
  artifactStore: state.artifactFileStorePort(),
  sandbox,
});

const actorBinding = await extensions.resolveActorBinding({ actorKind, profileId, surfaceId });
const tools = await extensions.buildToolDeclarations({ actorBinding });
const metadata = await extensions.nativeTools.metadata({ actorBinding });
```

API groups:

- `registry`
- `actorBindings`
- `generatedContext`
- `nativeTools`
- `svvyx`
- `executeTypescriptClients`
- `env`
- `dependencies`
- `builtin`
- `externalInstructions`

## Prompt And Instruction Sources

There is no public `@svvy/prompts` package. All default agent-facing prompt material lives in
`@svvy/extensions` because prompt text is part of extension capability binding.

Default instruction contributors should be Markdown or MDX files unless generation is required.

Preferred source shape:

```text
@svvy/extensions/src/builtin/
  base-common/
    instructions.mdx
  base-orchestrator/
    instructions.mdx
  base-handler/
    instructions.mdx
  base-workflow-task/
    instructions.mdx
  shell/
    instructions.mdx
    native-tool.schema.ts
  apply-patch/
    instructions.mdx
    native-tool.schema.ts
  smithers/
    instructions.generated.mdx
    generator.ts
  workflows/
    instructions.mdx
    svvyx-command-source.ts
```

Rules:

- Direct builtin prompt text, including base actor prompts and native-tool guidance, is exposed as
  editable loaded source contributors.
- Editable/default prompt source is `.md` or `.mdx`.
- Scripted contributors are reserved for extensions with a real generator/source pair such as
  Smithers, Web, or cx.
- Generated Markdown or MDX output is not an independent top-level source type. Users customize the
  Markdown/MDX source, generator source, manifest, extension source, CLI requirement, or package
  state, then regenerate/build.
- Runtime prompt bindings store the composed generated context in product state. Runtime does not
  own prompt source files.
- `default-system-prompt.ts` is a migration input from the current implementation, not the target
  source format.

## Tool Metadata

`@svvy/extensions` is the canonical source of tool metadata. Runtime and state must not duplicate
hard-coded lists of specialized tool names or projection behavior.

Each native tool declaration exposes metadata such as:

```ts
type NativeToolMetadata = {
  toolName: string;
  actorAvailability: {
    orchestrator?: "loaded" | "available" | "unavailable";
    handler?: "loaded" | "available" | "unavailable";
    workflowTask?: "loaded" | "available" | "unavailable";
  };
  turnDecision: TurnDecision;
  projection:
    | { kind: "generic-command"; visibility: "trace" | "summary" | "surface" }
    | { kind: "specialized-control"; visibility: "surface" };
  streamedArgumentSnapshots: "record" | "skip";
  createsCommandDuringExecution: boolean;
  redactionPolicyId?: string;
};
```

Runtime uses this metadata to decide whether to create generic streamed command records, when to
release a streamed tool call to execution, which turn decision to set, and how to expose command
visibility. Extension handlers remain responsible for tool-specific validation and command facts.

## Builtin Extension Boundaries

Extension handlers validate inputs, apply extension-local semantics, and return typed command facts
or runtime effects. They do not directly schedule model turns, claim queues, create desktop panes, or
own persisted read models. Runtime applies scheduling and queue effects; state persists facts and
projects read models.

### Shell

Owns `exec_command` and `write_stdin` extension behavior and command-family projection.

Shell projection preserves:

- command string
- working directory
- sandbox and approval mode facts
- stdout/stderr output events
- exit code or signal facts
- retained artifact links when large output is retained

Prompt-only CLIs such as Smithers are ordinary Shell command-family work.

Final-result output backfill follows these rules:

- `stdout` from the final result is recorded as `command.output` with `source: "final-result"` only
  when no live stdout event already exists for that command.
- `stderr` from the final result is recorded as `command.output` with `source: "final-result"` only
  when no live stderr event already exists for that command.
- If final `stdout` or `stderr` exists, no summarized fallback output is recorded.
- If neither final stream exists and any live command output exists, no summarized fallback output is
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

Commands whose resolved executable is the checked `smithers` binary are still ordinary
`exec_command` work, but their classification is `{ appLogSource: "smithers", commandFamily:
"smithers-cli" }` rather than generic direct-tool output. This classification is a per-command fact
derived from the accepted command, not static native-tool metadata.

### Apply Patch

Owns `apply_patch` extension behavior and structured file-change projection.

`apply_patch` records accepted-argument patch snapshots and final patch facts such as changed files,
created files, deleted files, and errors.

### Execute TypeScript

Owns `execute_typescript` extension behavior, source artifacts, diagnostics, import policy, and
actor-scoped generated extension clients.

Generated extension-client calls inside `execute_typescript` become child commands under the parent
`execute_typescript` command.

### Request User Input

Owns `request_user_input` as a native control extension: question schema, option schema, default
selection semantics, blocking and nonblocking behavior, timeout semantics, validation, and command
facts.

Runtime owns queue insertion, queue ordering, claiming, retries, and later answer delivery through
the owning surface. State owns persisted request, answer, timeout, and queue-delivery facts. Desktop
only renders the panel and captures user input.

### Thread Orchestration And Thread Handling

Own handler-thread tools and domain invariants: `thread_start`, `thread_followup`,
`thread_request_report`, `thread_current`, `thread_group`, `thread_report`, and `thread_episodes`.
The extension domain validates tool inputs and returns typed command facts or runtime effects.
Runtime creates surfaces, schedules queue work, and delivers orchestrator reconciliation. State
persists thread facts, episodes, reports, and read models.

`thread_report` is the only path that creates durable semantic episodes.

### Artifacts

Owns artifact extension commands, validation, generated command facts, and `svvyx artifacts ...`
semantics as an internal source folder.

State owns artifact metadata and physical artifact file-store persistence through an explicit
artifact file-store port. Sandbox owns immutable/generated boundary enforcement. Desktop owns
preview rendering. Do not create a public `@svvy/artifacts` package in this refactor.

### Workflows

Owns the Workflows extension: reusable asset/source-library guidance, `svvyx workflows ...`
commands, generated `@svvyx/workflows` package generation, generated `@svvyx/extensions` package
generation, generated package build semantics, and command facts.

Runtime owns build/link refresh scheduling and recovery orchestration. State owns persisted
generated-package facts, workspace link state, and Workflows pane read models. Desktop renders those
read models.

The Workflows extension does not run, resume, approve, inspect, or debug active Smithers workflows.

### Smithers

Hosts the existing generated Smithers instruction extension surface.

The package architecture refactor must not rewrite, expand, or reinterpret the Smithers instruction
content. Smithers instruction content remains governed by the existing Smithers extension spec and
generation pipeline.

The Smithers extension must not be responsible for Workflows-extension import guidance.

If the current Smithers extension spec or generator includes reusable Workflows import guidance, that
Workflows-owned guidance must be narrowly removed from Smithers and relocated to Workflows extension
guidance during this refactor. The package architecture refactor must not add new Smithers
instruction prose to explain Workflows or redesign generated Smithers instructions.

### Prompt-Only CLI Guidance

Web, cx, Git, and GitHub remain prompt-only CLI guidance unless their own specs later define a
different interface.

## Generated Package Rules

- Generated workflow assets use `@svvyx/workflows`.
- Generated extension references use `@svvyx/extensions`.
- Old generated package names are removed in this target design rather than preserved as aliases.
- Workflows extension guidance teaches generated `@svvyx/*` imports.
- Smithers extension guidance does not teach generated `@svvyx/*` imports or Workflows source
  library usage.

## Dependency Rules

- Depends on `@svvy/core`.
- Depends on `@svvy/state`.
- Depends on `@svvy/sandbox`.
- Must not depend on `@svvy/runtime` or `@svvy/desktop`.
- May depend on Incur for `svvyx` extension build and dispatch.
- May depend on Smithers documentation-generation inputs only inside the Smithers builtin extension
  source folder.

## Migration Sources

Initial extraction candidates:

- `src/shared/extensions.ts`
- `src/bun/default-system-prompt.ts`
- `src/bun/execute-typescript-api-declaration.ts`
- `src/bun/svvy-direct-tools.ts`
- `src/bun/execute-typescript-tool.ts`
- `src/bun/thread-start-tool.ts`
- `src/bun/thread-report-tool.ts`
- `src/bun/runtime-state-tools.ts`
- `src/bun/svvyx-artifacts-command.ts`
- `src/bun/svvyx-workflows-command.ts`
- `src/bun/svvyx-extensions-command.ts`
- `src/bun/svvyx-runtime-command.ts`
- `src/bun/smithers-runtime/`
- `src/bun/cx-runtime/`
- `src/bun/web-runtime/`
- duplicated tool classification in command trackers

## Tests

- Builtin extension inventory tests.
- Actor binding matrix tests.
- Generated context snapshot tests.
- Prompt/MDX source contributor tests.
- Native tool metadata tests proving runtime projection behavior comes from extension metadata.
- `list_extensions` and `load_extension` tests.
- `svvyx` dispatch tests.
- Direct tool extension tests.
- Request input tests.
- Thread tool tests.
- Artifact command tests.
- Workflows command and generated package tests.
- Smithers generated instruction validation tests.
- Negative tests proving `@svvyx/extensions` is not the source of `execute_typescript` runtime
  clients.
- Negative tests proving prompt-only extensions do not expose generated clients.
- Negative tests proving no public `@svvy/prompts` package is emitted.
