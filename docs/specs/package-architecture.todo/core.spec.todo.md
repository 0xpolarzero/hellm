# `@svvy/core` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/core`

## Purpose

`@svvy/core` is the shared stable `svvy` domain language.

It defines ids, public TypeScript contracts, discriminated event unions, read-model types, command
fact envelopes, sandbox policy port contracts, version markers, and tiny pure helpers that are used
across public `@svvy/*` packages. It contains no runtime orchestration, persistence, pi integration,
extension implementation, filesystem IO, database IO, keychain IO, or UI rendering.

The package was previously sketched as `@svvy/contracts`. The accepted future name is
`@svvy/core` because this package is the bottom shared product vocabulary, not a pi-specific
contract bundle.

## Owns

- Branded ids or nominal id helpers for actor, workspace, worktree, layout, session, surface,
  thread, thread group, turn, message, queue, command, episode, artifact, request-input, runtime
  approval, snippet, provider, model, extension, generated package, app log, and title-job
  identities.
- Actor kinds: `orchestrator`, `handler`, and `workflow-task`.
- Surface target contracts, including explicit distinction between top-level workspace session id,
  pi surface id, handler thread id, and UI panel id.
- User-submitted message contracts for runtime prompt submission.
- Runtime event discriminated unions.
- Runtime command lifecycle and terminal command fact envelopes.
- Tool-call intent, streamed argument snapshot, accepted command, child command, progress, output,
  diagnostic, patch snapshot, approval, wait, and final-fact payload contracts.
- Extension record, usage, env declaration, dependency, readiness, generated context, generated
  client metadata, and redaction metadata contracts.
- Generated package read-model contracts for `@svvyx/workflows` and `@svvyx/extensions`.
- Artifact metadata contracts.
- App log and normalized error contracts.
- Workspace, session, surface, command inspector, request-input, runtime approval, generated
  package, and worktree read-model types.
- Settings and provider/auth status payload contracts.
- Sandbox policy source and immutable sandbox policy snapshot contracts.
- Persistence schema version markers and migration payload envelopes when they cross package
  boundaries.
- Tiny pure helpers such as id type guards, exhaustive discriminant checks, and schema helpers when
  they are stable enough to be shared.

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

## Public API Shape

The package exposes grouped modules. The exact folder names may be refined during implementation,
but every export must be stable, documented, and free of package-internal implementation objects.

```ts
import {
  Actors,
  Artifacts,
  Commands,
  Extensions,
  GeneratedPackages,
  Logs,
  Providers,
  Requests,
  RuntimeEvents,
  Sandbox,
  Sessions,
  Settings,
  Snippets,
  Threads,
  Titles,
  Workflows,
  Workspaces,
  Worktrees,
} from "@svvy/core";
```

`@svvy/core` is not a convenience barrel for all implementation types. A type belongs here only when
at least two public packages or one public package plus a non-desktop consumer need the same stable
contract.

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
The future package contract uses `surface: "handler"` for delegated handler-thread surfaces. Legacy
renderer/RPC names such as `surface: "thread"` may be accepted by migration adapters, but they must
be normalized before crossing the public `@svvy/runtime` or `@svvy/core` boundary.

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

## Runtime Prompt Submission Contract

The programmatic runtime submission contract is intentionally smaller than the current renderer RPC
shape. Runtime consumers submit only the new user message and delivery intent. They do not submit
full pi message arrays, active system prompts, generated prompt previews, or renderer `Agent` state.

```ts
type RuntimeSubmittedAttachment =
  | {
      kind: "image";
      name?: string;
      path?: AbsolutePath;
      dataBase64?: string;
      mimeType: string;
    }
  | {
      kind: "file";
      name?: string;
      path: AbsolutePath;
      mimeType?: string;
    };

type RuntimeSubmittedMessage = {
  text: string;
  attachments?: RuntimeSubmittedAttachment[];
  snippetProvenance?: SentSnippetProvenance[];
};

type RuntimeMessageDelivery = "enqueue-and-run" | "queue-only";

type SubmitMessageInput = {
  target: PromptTarget;
  message: RuntimeSubmittedMessage;
  delivery?: RuntimeMessageDelivery;
  clientSubmission?: {
    submissionId?: string;
    correlationId?: string;
    clientRequestId?: string;
    source?: string;
    submittedAt?: string;
    sequence?: number;
  };
};

type SubmitMessageResult = {
  queuedMessageId: QueueItemId;
  turnId: TurnId | null;
  target: PromptTarget;
  status: "queued" | "running";
};
```

Steering is not a `SubmitMessageInput.delivery` mode. It is a queue operation that promotes an
already persisted queued row into the highest-priority next delivery slot:

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
    correlationId: "visual-test-42",
    source: "headless",
  },
});
```

Result:

```json
{
  "queuedMessageId": "queue_7f2",
  "turnId": "turn_91a",
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "orchestrator",
    "surfacePiSessionId": "pi_orch_01"
  },
  "status": "running"
}
```

## Runtime Event Contract

Runtime events are small, typed notifications. They do not carry full read models when the read
model can be fetched directly from `@svvy/state`.

```ts
type RuntimeEvent =
  | {
      type: "surface.stream";
      target: RuntimeSurfaceTarget;
      sequence: number;
      patch: SurfaceStreamPatchInput;
    }
  | {
      type: "surface.changed";
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
      workspaceSessionId: WorkspaceSessionId;
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
        | { kind: "child_command" }
        | { kind: "approval" }
        | { kind: "wait" }
        | { kind: "finished" };
    }
  | {
      type: "queue.changed";
      target: PromptTarget;
      queuedMessageId: QueueItemId;
      status: "queued" | "steering" | "dispatching" | "delivered" | "failed" | "cancelled";
    }
  | {
      type: "turn.changed";
      target: PromptTarget;
      turnId: TurnId;
      status: "running" | "waiting" | "completed" | "failed";
    }
  | {
      type: "workflow_task_attempt.changed";
      target: Extract<RuntimeSurfaceTarget, { surface: "workflow-task" }>;
      workflowTaskAttemptId: WorkflowTaskAttemptId;
      status: "running" | "waiting" | "completed" | "failed" | "cancelled";
    }
  | {
      type: "workspace_read_model.changed";
      workspaceId: WorkspaceId;
      model:
        | "sessionNavigation"
        | "surface"
        | "commandInspector"
        | "handlerThreadInspector"
        | "workflowTaskAttemptInspector"
        | "requestInput"
        | "runtimeApprovals"
        | "appLogs"
        | "snippets";
      ids?: string[];
    }
  | {
      type: "app_read_model.changed";
      model:
        | "workflowsGenerated"
        | "agents"
        | "extensions"
        | "settings"
        | "providerAuth"
        | "appPreferences";
      ids?: string[];
    }
  | {
      type: "runtime.recovery";
      workspaceId: WorkspaceId;
      workId: RecoveryWorkId;
      status: "pending" | "claimed" | "blocked" | "completed" | "failed" | "cancelled";
    };
```

Event examples:

```json
{
  "type": "surface.stream",
  "sequence": 1,
  "target": {
    "workspaceSessionId": "wsess_01",
    "surface": "orchestrator",
    "surfacePiSessionId": "pi_orch_01"
  },
  "patch": {
    "type": "text_delta",
    "contentIndex": 0,
    "delta": "I will inspect the transcript projection."
  }
}
```

```json
{
  "type": "command.changed",
  "workspaceSessionId": "wsess_01",
  "commandId": "cmd_12",
  "change": {
    "kind": "finished"
  }
}
```

Consumers refetch the relevant read model after receiving a change event:

```ts
const surface = await state.readModels.surface({ target });
const command = await state.readModels.commandInspector({ commandId: "cmd_12" as CommandId });
```

## Command Result And Fact Envelope

`@svvy/core` defines the command result/fact envelope used by extension handlers and runtime command
tracking.

```ts
type CommandResultEnvelope = {
  ok?: boolean;
  stdout?: string;
  stderr?: string;
  summary?: string;
  commandFacts?: Record<string, unknown>;
  [key: string]: unknown;
};

type ToolExecutionResult = {
  content?: unknown[];
  details?: CommandResultEnvelope;
};
```

Extraction rules:

- A pi/tool execution callback with `isError: true` maps to final command status `failed`.
- Otherwise, if `details.ok === false`, final command status is `failed`.
- Otherwise, the final command status is `succeeded`.
- Final command facts are `details.commandFacts` when that property is an object.
- If `details.commandFacts` is absent and `details` is an object, final command facts are the full
  `details` object.
- If the tool result is an `Error` whose message parses as a JSON object, that parsed object is
  treated as the result payload for status/fact extraction.
- Terminal command status, summary, facts, error, and finished timestamp are immutable after
  `succeeded`, `failed`, or `cancelled`.

This envelope preserves current handler semantics while giving `@svvy/extensions` a typed target to
return and `@svvy/runtime` a deterministic extraction contract.

## Sandbox Policy Port

`@svvy/core` defines the state-to-sandbox port shape so `@svvy/sandbox` can stay independent of
`@svvy/state`:

```ts
type SandboxPolicySource = {
  snapshot(input: SandboxPolicySnapshotInput): Promise<SandboxPolicySnapshot>;
};

type SandboxPolicySnapshotInput = {
  workspaceId: WorkspaceId;
  surfaceId?: SurfacePiSessionId;
  commandId?: CommandId;
  cwd?: AbsolutePath;
};
```

The snapshot must be resolved before launch policy generation and must be immutable for that launch.
It includes workspace roots, active worktree roots, generated-output roots, immutable artifact
roots, protected metadata roots, network policy, and whether managed sandboxing is enabled or
omitted for full-access execution. It does not expose raw approval prompts or mutable state-store
handles.

## Dependency Rules

- Must not depend on any other `@svvy/*` package.
- Must not depend on pi, Electrobun, Svelte, Incur, Smithers, filesystem APIs, database APIs,
  native helper APIs, or UI libraries.
- May depend on a schema library only if that dependency is accepted as part of the public core API.

## Versioning Rules

- Breaking public core changes require a package major version bump once published.
- Persisted schema changes require explicit schema version handling.
- Additive read-model fields are preferred over replacement fields.
- This future design does not require compatibility aliases for removed generated package names.

## Migration Sources

Initial extraction candidates:

- `src/shared/workspace-contract.ts`
- `src/shared/extensions.ts`
- `src/shared/agent-settings.ts`
- `src/shared/generated-agent-context.ts`
- type sections of `src/bun/structured-session-state.ts`
- generated API declaration contracts under `generated/`

## Tests

- Compile-time public import tests.
- Schema validation tests.
- Event/read-model fixture tests.
- Public API dependency tests proving `@svvy/core` imports no pi, desktop, state, runtime,
  extension, sandbox, filesystem, database, Smithers, or Incur implementation modules.
- Persistence payload version tests for cross-package migration envelopes.
