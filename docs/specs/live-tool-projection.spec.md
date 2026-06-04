# Live Tool Projection Spec

## Status

- Date: 2026-06-03
- Status: adopted product spec
- Scope:
  - define how `svvy` renders model tool use progressively while a turn is still running
  - define the shared event model for streamed tool arguments, runtime progress, command output,
    file-change previews, approvals, waits, and final command facts
  - classify every currently documented non-Smithers native or product tool surface by the live
    projection behavior it should use

This spec is the source of truth for live tool projection. It intentionally excludes the current
`smithers_*` agent API because that surface is due for a separate revamp. Future workflow and
Smithers-facing tools must use the same projection model defined here, but their concrete tool list
and names are out of scope for this document.

## Source References

This design follows the documented Codex app-server model instead of inventing a separate UI log
system:

- Codex app-server models agent work as `Thread -> Turn -> Item`.
- Turn streams include `item/started`, item-specific deltas, `item/completed`, and turn terminal
  notifications.
- Command execution is a turn item with command metadata, status, command-action display hints,
  aggregated output, exit code, and duration.
- Command output streams as item-scoped deltas while the command runs, then the final item remains
  authoritative.
- File edits are `fileChange` items with structured file update changes, status, and patch-update
  snapshots. Deprecated raw file-change output deltas are not the model to copy.
- Turn-level diff updates expose the aggregate workspace diff snapshot for the turn.
- Approval requests are server/runtime initiated and scoped to the affected command or file-change
  item.

Local reference files:

- `docs/references/codex/codex-rs/app-server/README.md`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/CommandExecutionOutputDeltaNotification.ts`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/FileChangePatchUpdatedNotification.ts`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/TurnDiffUpdatedNotification.ts`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/FileUpdateChange.ts`
- `docs/references/codex/codex-rs/app-server-protocol/schema/typescript/v2/PatchApplyStatus.ts`

Related `svvy` specs:

- `docs/specs/extensions-and-tools.spec.md`
- `docs/specs/structured-session-state.spec.md`
- `docs/specs/extension/shell.extension.spec.md`
- `docs/specs/extension/apply_patch.extension.spec.md`
- `docs/specs/extension/artifacts.extension.spec.md`
- `docs/specs/extension/execute_typescript.extension.spec.md`
- `docs/specs/extension/thread_managing.extension.spec.md`
- `docs/specs/extension/extension_loading.extension.spec.md`
- `docs/specs/extension/svvyx-incur-runtime.spec.md`
- `docs/specs/extension/extension_managing.extension.spec.md`
- `docs/specs/workflow-library.spec.md`

## Product Intent

The UI should show what the agent is doing as soon as the runtime knows it:

- when the model starts a tool call, show the correct tool card immediately
- while large arguments are being generated, update the card incrementally from structured argument
  snapshots
- while the handler runs, stream runtime progress and output into the same item
- when the handler finishes, replace provisional state with the durable final item and command facts

For file edits, this means the UI can show a patch filling in a few files or hunks at a time while
the model is still composing the `apply_patch` argument. It does not mean the agent is incentivized
to call `apply_patch` many times with tiny edits. The intended behavior is one coherent tool call
with progressive argument projection and structured patch snapshots, followed by one runtime apply
attempt.

## Core Model

`svvy` adopts the Codex-shaped lifecycle:

```text
surface turn -> tool item -> item deltas -> command record -> runtime events -> item completed
```

The exact storage names may differ from Codex, but the concepts must not:

- a **turn** is the user-request execution boundary on one interactive surface
- a **tool item** is one model-visible tool call or product-visible tool activity inside the turn
- a **command record** is the durable `svvy` structured-state record for a tool call once the tool
  is accepted by the runtime
- a **projection event** is an ordered update used to render the live card
- a **final item** is the authoritative completed, failed, declined, or cancelled state

Tool items are rendered in the transcript or tool activity area. Command records are the durable
structured state used for recovery, summaries, nesting, artifacts, and workspace read models.

The live projection is not a second execution engine. It is a view over the same model-facing tool
calls and runtime handler events that already produce command records.

## Lifecycle Events

Every model tool call should have a stable tool item id as soon as the runtime can identify the tool
call. The id must be stable across argument deltas, runtime events, approval cards, and the final
item.

Required lifecycle phases:

```ts
type ToolItemStatus =
  | "streaming_arguments"
  | "requested"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "declined"
  | "cancelled";

type ToolProjectionEvent =
  | {
      kind: "tool_item.started";
      surfacePiSessionId: string;
      turnId: string;
      itemId: string;
      toolName: string;
      startedAt: string;
    }
  | {
      kind: "tool_item.arguments_updated";
      surfacePiSessionId: string;
      turnId: string;
      itemId: string;
      seq: number;
      argumentsText?: string;
      argumentsJson?: unknown;
      projection?: ToolArgumentProjection;
      at: string;
    }
  | {
      kind: "tool_item.arguments_completed";
      surfacePiSessionId: string;
      turnId: string;
      itemId: string;
      seq: number;
      argumentsText?: string;
      argumentsJson?: unknown;
      projection?: ToolArgumentProjection;
      at: string;
    }
  | {
      kind: "tool_item.command_linked";
      surfacePiSessionId: string;
      turnId: string;
      itemId: string;
      commandId: string;
      at: string;
    }
  | {
      kind: "tool_item.completed";
      surfacePiSessionId: string;
      turnId: string;
      itemId: string;
      commandId: string | null;
      status: Exclude<ToolItemStatus, "streaming_arguments" | "requested" | "running" | "waiting">;
      finalProjection: ToolFinalProjection;
      at: string;
    };
```

Argument events are ordered snapshots, not necessarily character deltas. A renderer must accept
either full snapshots or compact deltas from the transport, but the product semantics are snapshot
based: the newest accepted sequence replaces the prior argument projection for that item.

Runtime command events are separate from pre-execution argument events:

```ts
type CommandProjectionEvent =
  | {
      kind: "command.requested";
      commandId: string;
      itemId: string | null;
      toolName: string;
      title: string;
      at: string;
    }
  | {
      kind: "command.started";
      commandId: string;
      at: string;
    }
  | {
      kind: "command.output_delta";
      commandId: string;
      seq: number;
      stream: "stdout" | "stderr" | "combined";
      text: string;
      capReached?: boolean;
      at: string;
    }
  | {
      kind: "command.progress";
      commandId: string;
      seq: number;
      label: string;
      value?: number;
      max?: number;
      data?: Record<string, unknown>;
      at: string;
    }
  | {
      kind: "command.waiting";
      commandId: string;
      reason: string;
      approvalRequestId?: string;
      at: string;
    }
  | {
      kind: "command.approval_requested";
      commandId: string;
      approvalRequestId: string;
      reason: string;
      actions?: Array<Record<string, unknown>>;
      at: string;
    }
  | {
      kind: "command.approval_resolved";
      commandId: string;
      approvalRequestId: string;
      decision: "accepted" | "accepted_for_session" | "declined" | "cancelled" | string;
      at: string;
    }
  | {
      kind: "command.child_linked";
      commandId: string;
      childCommandId: string;
      at: string;
    }
  | {
      kind: "command.workspace_diff_updated";
      commandId: string;
      changes: Array<{
        path: string;
        kind: "add" | "delete" | "update" | "move";
        diff: string;
      }>;
      at: string;
    }
  | {
      kind: "command.finished";
      commandId: string;
      status: "succeeded" | "failed" | "cancelled" | "declined";
      facts: Record<string, unknown> | null;
      error?: string | null;
      at: string;
    };
```

Large output must be capped for transcript rendering and model return values. When the full data is
important, the handler should create a file-backed artifact and link it from command facts.

Structured session state stores the command projection events with these same `command.*`
discriminants. It also stores the linked `toolItemId` when the command came from a turn item, so a
renderer can recover the same `(surfacePiSessionId, turnId, itemId)` card identity after reload.
Wire transports may encode or batch events differently, but they must preserve this canonical
identity and event vocabulary at the structured-state boundary.

## Authority Rules

Live projection is useful but provisional.

The authority order is:

1. Runtime policy and approval decisions decide whether a command or patch may execute.
2. Runtime handler result decides the final status and command facts.
3. Durable command records and artifacts are the recovery source.
4. Live argument projection and output deltas are display state.

Consequences:

- the model must not be asked or incentivized to split one coherent patch into many small patch
  calls for visual effect
- `apply_patch` remains one atomic apply attempt per tool call
- a partially streamed patch preview must not be treated as applied file state
- a partially streamed command argument must not be treated as an executed command
- a parser failure in an intermediate argument snapshot only affects preview quality
- final tool arguments and runtime handler output replace provisional preview state when they arrive
- assistant-authored hidden Markdown directives must not be emitted, parsed, stored, displayed, or
  acted on for product state, including as non-authoritative hints

## Persistence And Recovery

Pre-execution argument projection is transient live state until the runtime accepts the tool call and
creates or links a command record.

After a command record exists:

- command lifecycle events must be durable enough to recover the card after renderer reload
- terminal facts must be written to the `CommandRecord`
- output deltas may be compacted into bounded command facts, file-backed artifacts, or both
- child command linkage must be durable
- approval, request-user-input, and wait state must be recoverable from structured state

If the app restarts while the model is still streaming a tool argument and the tool was never
accepted by the runtime, the partial preview may be lost. The transcript should then show no durable
command for that abandoned item.

If the app restarts while a command is running:

- `exec_command` sessions should reconnect when the process manager can still identify the process
- if the process cannot be reattached, the command must move to `failed` or `cancelled` with a clear
  recovery error
- completed command records must render from durable final facts even if raw deltas were compacted

## Redaction And Security

Live projection must pass through the same redaction boundaries as final tool output.

Rules:

- secret extension env values must never appear in arguments, output, logs, artifacts, transcripts,
  generated docs, or generated TypeScript declarations
- runtime-emitted output is redacted before persistence and before renderer delivery
- partial argument snapshots are redacted before display when they contain values that match known
  secret material or configured redaction patterns
- approval cards use runtime-classified actions, not model-authored descriptions
- command-family visualization is display-only and must not be used as permission truth
- shell output remains opaque except for runtime lifecycle, approval state, parsed display hints,
  command-family structured markers, and observed workspace changes after the fact

## Renderer Requirements

Each renderer must join live projection by `(surfacePiSessionId, turnId, itemId)`.

Rendering rules:

- render a tool card as soon as `tool_item.started` arrives
- show the tool name and stable title even before arguments are complete
- update large argument previews from the newest accepted argument sequence
- do not resize the whole transcript dramatically as each small delta arrives; virtualize or collapse
  long content
- keep one live surface controller per `surfacePiSessionId`, even when the same surface is open in
  multiple Dockview panels
- panel-local scroll and expansion state may differ, but the underlying live item state is shared
- final tool cards must render from final item and command facts, not from remembered DOM state

Every tool card uses the same base structure:

- title
- status
- elapsed time when applicable
- approval or wait state when applicable
- compact summary
- expandable detail
- linked artifacts
- child command rollup when applicable

Tool-specific renderers only own the body projection.

## File Change Projection

`apply_patch` maps to a Codex-like `fileChange` item and therefore uses both argument projection
and runtime projection.

Argument snapshots should be parsed into structured file changes whenever possible:

```ts
type FileChangeProjection = {
  kind: "file_change";
  status: "draft" | "parse_error" | "ready" | "applying" | "succeeded" | "failed" | "declined";
  changes: Array<{
    path: string;
    kind: "add" | "delete" | "update" | "move";
    diff: string;
  }>;
  parseError?: string;
  touchedPaths: string[];
};
```

Intermediate snapshots may parse only the complete prefix of the patch. The renderer should show the
parsed changes it can trust and a compact parse-status line for the incomplete tail. It must not
invent changed lines that the parser did not confirm.

Runtime apply events then update the same item:

- `command.requested` links the `apply_patch` command record
- approval state attaches to the file-change item when policy requires review
- `command.started` marks the apply attempt
- `command.finished` records success, failure, decline, or cancellation
- `tool_item.completed` carries the final file-change projection
- a turn-level diff update may refresh the aggregate workspace diff after a successful apply

The final file-change projection should use the actually applied patch and runtime result, not the
last provisional argument parse.

## Command Execution Projection

`exec_command` maps to a Codex-like `commandExecution` item.

Argument projection should show:

- command string
- working directory
- PTY or non-PTY mode
- yield and output limits when non-default or relevant
- requested sandbox escalation and approval question when present
- best-effort command actions when the parser can classify every command segment

Runtime projection should show:

- approval request and decision when needed
- running state and Kill control
- streamed stdout/stderr output
- returned `session_id` for continuing sessions
- exit code or cancellation state
- bounded final output snapshot
- linked artifacts when output was redirected or captured

`write_stdin` maps to the existing running command session. It should render as a child or
continuation item under the original command when possible, not as an unrelated top-level shell
card. Its projection should show whether it wrote input, closed stdin, sent Ctrl-C, or polled for
more output, then append any new output deltas to the owning command session.

## Execute TypeScript Projection

`execute_typescript` needs both argument and runtime projection.

Argument projection:

- stream the submitted TypeScript source into a code preview
- show the actor-local capability profile once known
- show generated-client availability as metadata, not as an invented global SDK

Runtime projection:

- create and link the submitted-source artifact before execution
- show compile or typecheck diagnostics before runtime execution
- show execution status, bounded console output, and returned value or error
- show generated-client child command records under the parent command
- keep arbitrary TypeScript side effects opaque unless they go through `svvy`-owned generated
  clients or observable workspace state

The parent `execute_typescript` command remains the main semantic unit. Child command cards are
nested detail by default.

## Thread Control Projection

Thread-control tools should show as the exact tool card once the tool name is known. They should not
wait until final completion to appear as a generic spinner.

Projection behavior:

| Tool | Projection |
| --- | --- |
| `thread_start` | Argument projection for objective, extension overrides, and target title hints; runtime progress for handler-thread row creation, generated context binding, initial queue item, and first handler turn start. |
| `thread_resume` | Argument projection for target thread and resumed objective; runtime progress for objective reactivation and queued/direct handler message delivery. |
| `thread_request_report` | Argument projection for target thread and request body; runtime progress for report-request record creation and handler queue delivery. |
| `thread_report` | Argument projection for title, summary, body, and optional outcome; runtime progress for episode recording, objective conclusion when applicable, and orchestrator queue notification. |
| `thread_current` | Final-only read result. It may render a lightweight loading row if the transcript shows read tools, but it does not need argument streaming. |
| `thread_list` | Final-only read result. |
| `thread_episodes` | Final-only read result. |

The thread tools' command records remain authoritative for created thread ids, report request ids,
episode ids, queue item ids, and failure reasons.

## Extension Loading Projection

Extension Loading tools behave as follows:

| Tool | Projection |
| --- | --- |
| `list_extensions` | Final-only read result with a lightweight loading state. |
| `load_extension` | Runtime progress projection for readiness verification, same-turn generated tool declaration refresh, loaded `svvyx` command guidance refresh, generated TypeScript declaration refresh, generated agent context binding, and the resulting `Agent context updated` product event. |

`load_extension` does not build extensions or install dependencies. If an extension is unavailable
because build or dependency work is required, the card should show the readiness failure and point to
the relevant Extension Managing command path.

## Request User Input Projection

`request_user_input` is the shipped native user-clarification surface. Its concrete API is defined
in `docs/specs/extension/request_user_input.extension.spec.md`.

Projection behavior:

- argument projection for question titles, question text, options, recommended defaults, and
  freeform default answers
- disabled side-panel draft rendering while tool arguments stream
- durable request and question records only after final arguments validate
- immediate final command facts for nonblocking mode's default answers
- `waiting` command status plus surface wait projection for blocking mode while the tool waits on
  user input or timeout
- final command facts for the resolved answer set
- later nonblocking user answers projected through durable `request_user_input_answer` queue items

## Workflow Authoring Projection

`workflow_list_models` is final-only. It should show a lightweight loading state and then render the
provider/model readiness result.

Saved workflow authoring uses ordinary direct tools:

- reading and searching workflow files goes through `exec_command`
- reusable workflow files are written through `apply_patch`
- validation diagnostics after edits surface through the command records and projection events for
  the originating file-change or command

Current `smithers_*` run and supervision tools are excluded from this spec. Their replacement or
revamped API must use this projection model when defined.

## Artifacts Projection

The Artifacts `svvyx` extension exposes the concrete command family defined in
`docs/specs/extension/artifacts.extension.spec.md`:

- `svvyx artifacts create --path <file> [--title <title>] [--mime-type <mime>] --json`
- `svvyx artifacts inspect --id <artifact_id> --json`
- `svvyx artifacts list [--thread-id <thread_id>] [--limit <n>] --json`
- `svvyx artifacts open --id <artifact_id> --json`
- `svvyx artifacts delete --id <artifact_id> --json`

Artifacts projection is a command-family renderer layered over `exec_command`, not a separate model
tool. The renderer should use argument projection and final command facts this way:

- `create` shows the selected source path, optional title and MIME type, copy progress when
  available, and final artifact id, copied path, MIME type, byte size, digest, created time, and
  runtime-derived linkage
- `inspect` shows the target artifact id while running and settles from the final `ArtifactRef`
- `list` shows the requested scope and limit while running and settles from the final artifact list
- `open` shows the target artifact id and final open result
- `delete` shows the target artifact id and final deleted result

The old draft names `artifact_write_text`, `artifact_write_json`, and `artifact_attach_file` are not
stable callable tools.

## CLI And `svvyx` Projection Through `exec_command`

`svvyx` is not a separate model-facing action type.

All `svvyx ...` usage goes through `exec_command`, and live projection is layered as a command-family
renderer over the actual command execution item.

Rules:

- `svvyx <extension-id> <command> ...` remains ordinary shell input
- loaded `svvyx` command manifests may declare structured command-family display data and streaming
  markers
- command-family markers improve progress rendering only after they are emitted by the trusted
  command/runtime boundary
- the renderer must still show raw command output detail
- command-family parsing must not bypass shell policy, approval policy, output caps, or command
  record storage

Extension Managing commands classify as:

| Command family | Projection |
| --- | --- |
| `svvyx extensions inspect` | Final structured result over `exec_command`. |
| `svvyx extensions create` | Final structured result plus observed workspace or extension-source changes. |
| `svvyx extensions instructions add/rename/remove/reorder` | Final structured result plus observed extension-source changes. |
| `svvyx extensions build` | Runtime progress for validation, dependency readiness, install approval when required, build, activation, and final build facts. |
| `svvyx extensions set-usage` | Final structured result. |
| `svvyx extensions reset` | Runtime progress when it triggers build or dependency work; otherwise final structured result. |
| `svvyx extensions delete` | Final structured result. |
| `svvyx extensions revert` | Final structured result plus observed extension-source changes. |
| `svvyx extensions snapshots list/save/load/rename/delete` | Final structured result. |

Prompt-only CLI extensions follow the same rule:

- `git ...` and `gh ...` are ordinary shell commands with optional display parsers
- `cx ...` is ordinary shell command output unless a future trusted command-family parser is adopted
- `tinyfish ...` is ordinary shell output; search and fetch JSON may be redirected to files when
  useful, and SSE/browser-backed behavior is represented by command output and artifacts

## Tool Classification Matrix

Classification meanings:

- `argument`: progressive argument projection is useful
- `runtime`: runtime output or progress streaming is useful
- `both`: both argument and runtime projection are useful
- `final`: a loading state and final result are enough
- `underspecified`: docs name the surface but do not define the concrete API
- `excluded`: intentionally not covered by this spec

| Surface | Classification | Required projection |
| --- | --- | --- |
| `exec_command` | runtime | Command execution item, approval state, output deltas, running session, Kill, final output snapshot. |
| `write_stdin` | runtime | Continuation of the owning command session with input action and appended output. |
| `apply_patch` | both | File-change item with structured patch snapshots, approval/apply runtime state, final apply result, and turn diff refresh. |
| `execute_typescript` | both | Source preview, source artifact, diagnostics, runtime result, nested child commands. |
| `list_extensions` | final | Loading state plus final actor-local extension inventory. |
| `load_extension` | runtime | Readiness check, generated context refresh, tool/type/command guidance refresh, final loaded binding. |
| `thread_start` | both | Objective preview, extension override preview, thread creation, context binding, initial handler turn. |
| `thread_resume` | both | Resume target and objective preview, objective reactivation, handler message delivery. |
| `thread_request_report` | both | Request preview, request record creation, queue delivery. |
| `thread_report` | both | Report preview, episode creation, optional objective conclusion, orchestrator queue notification. |
| `thread_current` | final | Final read result. |
| `thread_list` | final | Final read result. |
| `thread_episodes` | final | Final read result. |
| `request_user_input` | both | Question/default preview, durable request records, nonblocking default result or blocking wait state, final answer facts, and later answer queue projection when applicable. |
| `workflow_list_models` | final | Loading state plus model/provider readiness result. |
| `svvyx artifacts ...` | via `exec_command` | Command-family projection over shell output; `create`, `inspect`, `list`, `open`, and `delete` settle from final structured JSON and command facts. |
| `svvyx ...` | via `exec_command` | Command-family projection over shell output; no separate tool. |
| `git ...`, `gh ...`, `cx ...`, `tinyfish ...` | via `exec_command` | Optional command-family projection over shell output; no wrapper tools. |
| current `smithers_*` API | excluded | Must be revamped separately; future replacement uses this model. |

## Non-Goals

- Do not introduce model-visible `read`, `write`, `edit`, `grep`, `find`, or `ls` tools.
- Do not introduce a separate `svvyx_command` tool.
- Do not emit, parse, store, display, or act on assistant-authored hidden Markdown directives for
  product state.
- Do not persist raw unbounded terminal output in structured state.
- Do not make renderer-local state the recovery source.
- Do not infer security decisions from command-family display parsers.
- Do not spec the current `smithers_*` API here.
