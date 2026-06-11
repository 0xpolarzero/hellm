# `execute_typescript` Spec

## Status

- Date: 2026-06-04
- Status: authoritative product spec
- Related specs:
  - `docs/specs/extensions-and-tools.spec.md`
  - `docs/specs/live-tool-projection.spec.md`
  - `docs/specs/extension/svvyx-incur-runtime.spec.md`
  - `docs/specs/extension/cx.extension.spec.md`

This spec defines `execute_typescript` as a native extension capability.

## Product Contract

`execute_typescript` is an actor-local TypeScript composition tool.

It is useful when TypeScript control flow helps the agent:

- batch related loaded-extension operations
- loop over structured extension results
- filter or aggregate command results already available to the snippet
- call generated loaded-extension clients repeatedly
- transform JSON before returning a concise result
- collect evidence into artifacts through loaded extension clients when those clients expose artifact
  operations

Ordinary one-shot repository work should use the Shell and Apply Patch native extensions:

- inspect files and search with `exec_command`
- continue long-running processes with `write_stdin`
- edit files with `apply_patch`

Repository inspection, shell execution, long-running command interaction, and file edits remain
owned by the Shell and Apply Patch native extensions.

## Authority

`execute_typescript` does not widen actor authority.

The generated TypeScript clients exposed to a submitted program are derived from the current actor's
loaded extension set:

- builtin app-owned `svvyx` extensions may contribute generated clients when TypeScript API is enabled
- user `svvyx` generated clients are not emitted until sandboxed generated-client execution exists
- available-but-not-loaded extensions contribute no generated client
- unavailable extensions contribute no generated client and no awareness

Provider readiness is not a generic reason to expose generated clients. If a future provider-backed
extension needs generated clients, that extension must still expose a concrete loaded runtime
interface whose source contracts can generate the client. The builtin Web extension is prompt-only
and therefore never contributes generated clients in Web v1.

The builtin cx extension is also prompt-only and therefore never contributes generated clients in cx
v1. `execute_typescript` must not expose `api.cx_*`, `extensions.cx.*`, or another cx SDK. Agents
use official `cx` CLI commands through `exec_command`.

If an actor cannot call a capability through its normal generated runtime interface, it must not gain
that capability through generated `execute_typescript` clients.

## TypeScript Runtime

The submitted program may run ordinary TypeScript after the top-level `execute_typescript` action
passes the same approval-boundary flow as other approval-gated native actions.

Builtin loaded-extension clients are the preferred surface because they provide:

- typed inputs and outputs
- extension-scoped documentation
- command facts and child action capture at app-owned boundaries
- extension env injection only for the invoked extension command
- redaction before output is persisted or shown to the model

The top-level `execute_typescript` tool call is the approval-boundary action. The runtime classifies
the submitted TypeScript source and requested execution environment before running it. In
`approvalMode: "auto-review"`, approval-required `execute_typescript` requests are routed to the
automatic reviewer; in `approvalMode: "user"`, they block on user approval; in
`approvalMode: "full-access"`, the approval boundary is disabled according to the normal execution
settings.

Generated extension-client calls inside an approved `execute_typescript` run are not a separate
approval surface. Builtin Artifacts and Workflows clients create child command records and enforce
readiness, env injection, redaction, product-state validation, and command failure semantics from
the underlying extension contract. User `svvyx` generated clients remain unavailable until their
execution can run inside the same sandboxed generated-client runtime.

Arbitrary TypeScript side effects that do not go through generated clients are opaque. `svvy` should
record the submitted source, lifecycle, console output, return value, thrown error, and any observed
workspace changes after the fact, but it must not claim exact reads, writes, network requests, child
process behavior, or Codex-style sandbox approval facts for arbitrary host-side TypeScript unless a
future implementation routes those effects through an owned runtime boundary. The runtime must not
claim that generated-client child approval checks can retroactively make arbitrary host-side
TypeScript safe; approval is decided before the snippet runs.

## Input

```ts
type ExecuteTypescriptInput = {
  typescriptCode: string;
};
```

The submitted TypeScript source is stored as an artifact for the attempt before execution.

## Generated Declarations

The actor receives one generated declaration block for `execute_typescript`. The structure must stay
actor-scoped:

```ts
declare const extensions: LoadedExtensionsClient;
declare const console: SvvyConsole;
```

There is no global `svvy` client and no broad injected `api` object.

`LoadedExtensionsClient` contains only currently callable TypeScript clients. In v1 this means the
native app-owned clients such as `artifacts` and `workflows`; user generated extension clients are
not emitted until their code can execute inside the `execute_typescript` sandbox. If a current actor
has loaded callable TypeScript clients `artifacts` and `workflows`, the generated declaration
contains only `extensions.artifacts` and `extensions.workflows`, plus only those clients' command map
types. It must not contain user extension placeholders, unavailable extensions, docs for
available-but-not-loaded extensions, or fail-closed runnable user client examples.

Each generated extension client is an Incur-compatible per-extension command client:

```ts
extensions["<extensionId>"].run(commandId, input)
```

Dot access such as `extensions.artifacts.run(...)` is valid shorthand only for extension ids that
are also TypeScript identifiers. Hyphenated extension ids, when present, must use bracket access:
`extensions["some-extension"].run(...)`.

Command ids are the extension's Incur command paths. Inputs use Incur `args`, `options`, and output
controls. Non-streaming results use the Incur `Run.Result` envelope with `ok`, `data`, `output`, and
`meta`.

The declaration generator must include command map types for each loaded callable TypeScript client.
The exact emitted names are implementation details, but they must be scoped to the available
generated declaration block and must be usable with `Run` helper types from `incur/client`.

`incur/client` is an app-provided import available to snippets for public Incur client types and
errors:

```ts
import { Client, Resources, Run } from "incur/client";
```

Agents should import `Client` from `incur/client` when they need to handle `Client.ClientError`.
The declaration must not invent a separate structural `IncurClientError` alias for agent use.

`SvvyConsole` captures bounded diagnostic logs into the command result:

```ts
interface SvvyConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
```

The generated declaration is the precise API contract. The Execute TypeScript loaded instruction
files teach base `execute_typescript` usage plus the generic `extensions["<id>"].run(...)` API and
`incur/client` usage; each loaded extension's own instruction teaches its specific command ids and
examples. The Execute TypeScript instruction files must not inline every generated declaration or
every extension command schema.

## Public API Boundary

`execute_typescript` exposes generated loaded-extension clients only. It has no broad hand-written
helper API for ordinary repository primitives.

The public snippet environment excludes hand-written namespaces for:

- read helpers
- search helpers
- file-listing helpers
- shell/bash helpers
- edit/write helpers
- artifact helpers as a hand-written namespace
- workflow discovery helpers as a hand-written namespace
- web helpers as a hand-written namespace

When an equivalent operation is useful from TypeScript, it comes from a loaded-extension client
backed by the same source contract as the actual extension command. The generated client interface
is the only extension-command abstraction available inside snippets.

## Runtime Rules

- The top-level `execute_typescript` tool call goes through the same approval-boundary path as other
  approval-gated native actions before the snippet runtime starts.
- The approved snippet runtime then runs under the managed filesystem and network sandbox policy
  for the current session unless full-access policy omits sandboxing.
- TypeScript may assemble execution policy, launch approved and sandboxed runtime work, validate
  product contracts, call generated clients, and project results. It must not be described as the
  filesystem or network sandbox enforcement layer.
- TypeScript is checked before execution when the runtime can do so reliably.
- Typecheck failure stops execution before generated client calls run.
- Runtime failure records the thrown error and preserves any child command facts already emitted.
- Generated client calls create child command records under the parent `execute_typescript` command.
- Builtin generated clients resolve the same generated command contracts as shell dispatch and call
  through the generated TypeScript client runtime with the same explicit extension env source.
- User `svvyx` generated clients are hidden from declarations and unavailable at runtime until
  sandboxed generated-client execution exists.
- Generated clients are not shell `svvyx` wrappers. Do not document or generate them as shell calls.
  They are typed TypeScript clients whose parent `execute_typescript` process has already entered the
  approval and sandbox execution lane.
- Local Incur actions and generated-client internals must not be exposed on
  `extensions.<extensionId>`.
- Static imports from `incur/client` must typecheck and execute. Extension implementation files,
  current build paths, and generated extension internals must not be importable by agent-authored
  snippets as part of the public contract.
- Console logs are bounded and recorded as command output or artifacts according to size.
- Secret redaction runs before logs, outputs, artifacts, command facts, or transcript text are
  persisted.
- Extension secrets are never injected into the broad TypeScript execution environment.
- Extension env values are injected only into the exact generated client command invocation that
  belongs to that extension, and extension code receives them through Incur `c.env`, not through
  broad TypeScript process env.
- Already emitted generated-client calls finish against the loaded tool/client set that produced
  their declarations.
- If `load_extension` succeeds earlier in the same turn, the next model call in that same turn sees
  refreshed `execute_typescript` declarations including the newly loaded extension.

## Recording

Every `execute_typescript` invocation creates one parent command record.

The parent record includes:

- owning turn
- actor kind
- generated context fingerprint used for the submitted program
- submitted TypeScript source artifact id
- lifecycle status
- bounded console output
- return value summary when serializable
- diagnostics artifact when typecheck fails
- error details when execution fails
- child command rollups for generated client calls

Generated client calls create child command records with authoritative facts because `svvy` owns that
boundary. Arbitrary TypeScript host effects do not create authoritative child records.

## Visibility

The parent `execute_typescript` command is summary-visible by default.

Child generated-client calls follow the visibility policy of the underlying capability:

- read/search/list/discovery actions are trace-visible by default
- command execution, artifact creation, extension lifecycle, approvals, failures, and file changes
  are summary-visible by default

The UI should roll child command facts into a readable parent summary while preserving detailed
inspectability.

## Examples

Example using a loaded extension client:

```ts
const created = await extensions.artifacts.run("create", {
  options: {
    path: "/tmp/coverage.html",
    title: "Coverage report",
    mimeType: "text/html",
  },
});

return created.data;
```

Example with arbitrary TypeScript:

```ts
const values = [1, 2, 3, 4];
return {
  sum: values.reduce((total, value) => total + value, 0),
};
```

The last example has no child command facts because it does not call a generated client.

## Execute TypeScript Loaded Instruction Files

The builtin Execute TypeScript extension has two full instruction source files. These files are
ordered by filename under `instructions/full/`:

```text
010-execute-typescript.md
020-incur-typescript-clients.md
```

The generated loaded instruction for Execute TypeScript is the concatenation of those files. This
split keeps generic TypeScript execution guidance separate from generic Incur-backed generated
client usage.

The loaded Execute TypeScript instruction files are generic. They must not contain every generated
extension declaration or every loaded extension's command docs. The exact command map and
extension-specific examples are generated beside these instructions from the actor's loaded
TypeScript-enabled `svvyx` extensions.

### `010-execute-typescript.md`

This file owns generic `execute_typescript` guidance. Its canonical content is:

````md
# Execute TypeScript

Use `execute_typescript` when TypeScript control flow helps compose work that would be awkward as
one shell command or one extension call.

Good uses:

- batch related loaded-extension operations
- loop over structured extension results
- filter or aggregate JSON already available to the snippet
- call generated loaded-extension clients repeatedly
- transform data before returning a concise result

Prefer Shell and Apply Patch for ordinary repository work:

- inspect files and search with `exec_command`
- continue long-running processes with `write_stdin`
- edit files with `apply_patch`

Repository primitives are handled by their native tools.

The submitted TypeScript source is the tool input:

```ts
execute_typescript({
  typescriptCode: `
    const values = [1, 2, 3, 4];
    return { sum: values.reduce((total, value) => total + value, 0) };
  `
})
```

The snippet may use ordinary TypeScript and the generated declarations supplied with the tool. The
only stable injected globals are the generated `extensions` object, when loaded TypeScript-enabled
extensions exist, and `console` for bounded diagnostic logging.

Use `console.log`, `console.info`, `console.warn`, or `console.error` for concise diagnostics. Do
not use logs as the main result when returning structured data is clearer.

Arbitrary TypeScript side effects that do not go through generated clients are opaque to product
state. Use loaded extension clients for app-owned operations that need command facts, redaction,
env injection, artifacts, or other product-state capture.
````

### `020-incur-typescript-clients.md`

This file owns generic usage of generated Incur-compatible clients for loaded builtin `svvyx`
extensions. Its canonical content is:

````md
# Incur TypeScript Clients

Use this guidance when TypeScript code inside `execute_typescript` needs to call a loaded builtin
`svvyx` extension programmatically. Use shell commands when the operation is a one-shot CLI call or
ordinary repository inspection.

The public Incur client types and errors live in `incur/client`:

```ts
import { Client, Resources, Run } from "incur/client";
```

`incur/client` is available inside `execute_typescript` snippets. Import `Client` when you need to
handle `Client.ClientError`.

## Loaded Extension Clients

`execute_typescript` exposes an actor-scoped `extensions` object. It contains only loaded
TypeScript-enabled builtin clients available to the current actor.

If the current actor has loaded callable TypeScript clients `artifacts` and `workflows`, then only
those clients exist:

```ts
extensions.artifacts;
extensions.workflows;
```

Available-but-not-loaded extensions and unavailable extensions do not appear in `extensions` and do
not contribute command types, examples, or docs. User generated extension clients are unavailable in
v1 and likewise do not appear in `extensions`.

There is no global `svvy` client and no injected `api` object.

Do not construct transports, generic Incur clients, or extension implementation imports inside
snippets. The app owns the generated clients and injects extension env internally.

## Command Maps And Command IDs

Each generated extension client is typed from that extension's Incur command map. Command IDs are
full Incur command paths such as `"create"`, `"inspect"`, `"list"`, or `"models list"`.

The actual command maps are generated only for the builtin clients available to this actor.

## Running Commands

`extensions["<extensionId>"].run(command, input)` mirrors the extension's `svvyx <extension-id> ...`
command surface. `args` are positional arguments, `options` are named flags, and output controls
mirror global Incur CLI flags.

```ts
const report = await extensions.workflows.run("list", {
  options: { kind: "workflow" },

  // Equivalent to --filter-output. This changes result.data, so data is typed unknown.
  selection: ["summary", "items[0:3]", "nextCursor"],

  // These affect rendered result.output.text, not the extension command's original full output.
  outputFormat: "md",
  outputTokenCount: true,
  outputTokenLimit: 128,
});
```

The returned value for non-streaming commands is `Run.Result<data, Commands>`:

```ts
console.log(report);
/// Run.Result<unknown, WorkflowsCommands>
// {
//   ok: true,
//   data: {
//     summary: 'Available workflow exports',
//     items: [
//       { exportName: 'releaseChecklist', qualifiedName: 'Workflows.releaseChecklist' },
//       { exportName: 'triageIssue', qualifiedName: 'Workflows.triageIssue' },
//       { exportName: 'summarizeDiff', qualifiedName: 'Workflows.summarizeDiff' },
//     ],
//     nextCursor: 'workflow_4',
//   },
//   output: {
//     text: '## Available workflow exports\n\n- Workflows.releaseChecklist\n- Workflows.triageIssue',
//     format: 'md',
//     tokenCount: 37,
//     tokenLimit: 128,
//     tokenOffset: 0,
//     next: [Function],
//   },
//   meta: {
//     command: 'list',
//     duration: '18ms',
//   },
// }
```

Because `selection` changes the shape of `data`, selected results are typed as `unknown`.

Input is strict. Required `args` and `options` make the input object required; unknown commands and
extra keys are rejected by TypeScript when the command map is known.

```ts
await extensions.artifacts.run("create", {
  options: { name: "notes.md" },
});

// Type error: unknown command.
await extensions.artifacts.run("missing");

// Type error: missing required options.
await extensions.artifacts.run("create");
```

If an extension client has default output selection, result data is conservative `unknown`. Clear it
for a call with `selection: undefined` to recover the full output type:

```ts
const selected = await extensions.workflows.run("list", {
  options: { kind: "workflow" },
});
// selected.data is unknown when the generated client applies default selection.

const full = await extensions.workflows.run("list", {
  options: { kind: "workflow" },
  selection: undefined,
});

console.log(full);
/// Run.Result<WorkflowList, WorkflowsCommands>
// {
//   ok: true,
//   data: {
//     summary: 'Available workflow exports',
//     items: [
//       { exportName: 'releaseChecklist', qualifiedName: 'Workflows.releaseChecklist' },
//       { exportName: 'triageIssue', qualifiedName: 'Workflows.triageIssue' },
//       { exportName: 'summarizeDiff', qualifiedName: 'Workflows.summarizeDiff' },
//     ],
//     nextCursor: 'workflow_4',
//   },
//   output: {
//     text: 'summary: Available workflow exports\nitems[3]{exportName,qualifiedName}: ...',
//     format: 'toon',
//   },
//   meta: { command: 'list', duration: '18ms' },
// }
```

## CTAs

CTA execution is not a current `execute_typescript` generated-client capability. Do not document,
generate, or rely on runnable `meta.cta` helpers for this surface until the generated-client runtime
implements and tests them.

## Errors

Failed command runs and malformed client responses throw `Client.ClientError`:

```ts
import { Client } from "incur/client";

try {
  await extensions.artifacts.run("inspect", {
    args: { artifactId: "missing_artifact" },
  });
} catch (error) {
  if (error instanceof Client.ClientError) {
    console.log(error);
    /// Client.ClientError
    // Incur.ClientError: Artifact not found.
    // {
    //   message: 'Artifact not found.',
    //   code: 'NOT_FOUND',
    //   status: 404,
    //   retryable: false,
    //   fieldErrors: undefined,
    //   meta: {
    //     command: 'inspect',
    //     duration: '4ms',
    //   },
    //   error: {
    //     code: 'NOT_FOUND',
    //     message: 'Artifact not found.',
    //     retryable: false,
    //   },
    //   data: {
    //     ok: false,
    //     error: {
    //       code: 'NOT_FOUND',
    //       message: 'Artifact not found.',
    //       retryable: false,
    //     },
    //     meta: { command: 'inspect', duration: '4ms' },
    //   },
    // }
  }
}
```

Do not use a structural `IncurClientError` alias. Import `Client` from `incur/client`.

## Streaming

Streaming generated-client commands are not a current `execute_typescript` capability. The current
runtime must fail closed for streaming user extension commands until streamed child-command
projection, backpressure, cancellation, final-result recording, and tests are implemented.

## Discovery Resources

Incur discovery resources such as llms docs, schemas, help text, and OpenAPI descriptions are
internal inputs to extension build, validation, inspection, and generated-contract creation.

In v1, agent-authored `execute_typescript` snippets do not receive discovery helper methods such as
`llms()`, `llmsFull()`, `schema()`, `help()`, or `openapi()` on generated extension clients. The
agent-facing client surface remains `extensions["<extensionId>"].run(commandId, input)` plus
generated command map types for emitted builtin TypeScript clients.

Use discovery resources for docs, UI generation, tests, and schema inspection. Use
`extensions.<extensionId>.run()` for command execution.

Do not use local Skills actions or MCP setup actions. Generated clients do not expose
`skills.add()`, `skills.get()`, `skills.index()`, `mcp.add()`, or `mcp.tools()`.
````

## Prompt Exposure

The agent receives:

- the `execute_typescript` tool declaration
- generated TypeScript declarations for the current actor
- base Execute TypeScript usage guidance saying `execute_typescript` is for TypeScript composition,
  not one-shot repository inspection or file edits
- separate generic Incur TypeScript client guidance for `extensions["<id>"].run(...)` and
  `incur/client`
- loaded-extension client documentation only for emitted builtin clients that expose TypeScript API

The agent must not receive generated declarations for unavailable or available-but-not-loaded
extensions.
