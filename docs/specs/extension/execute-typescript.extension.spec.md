# `execute_typescript` Spec

## Status

- Date: 2026-06-04
- Status: resolved direction for `execute_typescript` under the Extensions architecture
- Related specs:
  - `docs/specs/extensions-and-tools.spec.md`
  - `docs/specs/live-tool-projection.spec.md`
  - `docs/specs/extension/svvyx-incur-runtime.spec.md`
  - `docs/specs/extension/cx.extension.spec.md`

This spec replaces the older direct-tool helper model. `execute_typescript` is now a native
extension capability.

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

`execute_typescript` does not replace `exec_command`, `write_stdin`, or `apply_patch`.

## Authority

`execute_typescript` does not widen actor authority.

The generated TypeScript clients exposed to a submitted program are derived from the current actor's
loaded extension set:

- loaded `svvyx` extensions may contribute generated clients when TypeScript API is enabled
- available-but-not-loaded extensions contribute no generated client
- unavailable extensions contribute no generated client and no awareness

Provider readiness is not a generic reason to expose generated clients. If a future provider-backed
extension needs generated clients, that extension must still expose a concrete loaded runtime
interface whose source contracts can generate the client. The shipped Web extension is prompt-only
and therefore never contributes generated clients in Web v1.

The shipped cx extension is also prompt-only and therefore never contributes generated clients in cx
v1. `execute_typescript` must not expose `api.cx_*`, `extensions.cx.*`, or another cx SDK. Agents
use official `cx` CLI commands through `exec_command`.

If an actor cannot call a capability through its normal generated runtime interface, it must not gain
that capability through generated `execute_typescript` clients.

## TypeScript Runtime

The submitted program may run ordinary TypeScript after the top-level `execute_typescript` action
passes the same approval-boundary flow as other approval-gated native actions.

Loaded-extension clients are the preferred surface because they provide:

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
approval surface. They still create child command records and must enforce readiness, env injection,
redaction, product-state validation, and command failure semantics from the underlying extension
contract.

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

`LoadedExtensionsClient` contains only loaded `svvyx` extensions that opted into TypeScript API
generation. If the current actor has loaded TypeScript-enabled extensions `a`, `b`, and `d`, the
generated declaration contains `extensions.a`, `extensions.b`, and `extensions.d`, plus only those
extensions' command map types. It must not contain `extensions.c`, command types for unavailable
extensions, or docs for available-but-not-loaded extensions.

Each generated extension client is an Incur-compatible per-extension command client:

```ts
extensions.<extensionId>.run(commandId, input)
```

Command ids are the extension's Incur command paths. Inputs use Incur `args`, `options`, and output
controls. Non-streaming results use the Incur `Run.Result` envelope with `ok`, `data`, `output`, and
`meta`.

The declaration generator must include command map types for each loaded TypeScript-enabled
extension. The exact emitted names are implementation details, but they must be scoped to the
available generated declaration block and must be usable with `Run` helper types from
`incur/client`.

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
teaches the generic `extensions.<id>.run(...)` API and `incur/client` usage; each loaded extension's
own instruction teaches its specific command ids and examples. The Execute TypeScript instruction
must not inline every generated declaration or every extension command schema.

## Removed Surfaces

The final spec must not preserve a broad hand-written helper API for ordinary repo primitives.

These old duplicated helper families are removed:

- read helpers
- search helpers
- file-listing helpers
- shell/bash helpers
- edit/write helpers
- artifact helpers as a hand-written namespace
- workflow discovery helpers as a hand-written namespace
- web helpers as a hand-written namespace

When an equivalent operation is useful from TypeScript, it must come from a loaded-extension client
backed by the same source contract as the actual extension command. Do not keep a second manually
maintained helper API beside the generated client interface.

## Runtime Rules

- The top-level `execute_typescript` tool call goes through the same approval-boundary path as other
  approval-gated native actions before the snippet runs.
- TypeScript is checked before execution when the runtime can do so reliably.
- Typecheck failure stops execution before generated client calls run.
- Runtime failure records the thrown error and preserves any child command facts already emitted.
- Generated client calls create child command records under the parent `execute_typescript` command.
- Generated clients for Incur-backed `svvyx` extensions resolve the same current build as shell
  dispatch and call the default-exported Incur CLI through `MemoryClient.create(cli, { env })` or an
  equivalent in-process explicit-env client path.
- `MemoryClient` is internal plumbing. It must not appear in the agent-authored snippet examples for
  generated extension clients, and MemoryClient local actions must not be exposed on
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
  them.
- If `load_extension` succeeds earlier in the same turn, the next model call in that same turn sees
  refreshed `execute_typescript` declarations including the newly loaded extension.

## Recording

Every `execute_typescript` invocation creates one parent command record.

The parent record includes:

- owning turn or workflow task attempt
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

## Execute TypeScript Instruction

The loaded Execute TypeScript instruction must be generic and must not contain the whole generated
declaration block. It should be derived from
`/Users/polarzero/code/wevm/incur/skills/incur-typescript-client/SKILL.md` by preserving the
original wording, headings, and full commented output examples wherever the content still applies,
then making only the `svvy`-specific corrections below.

Keep and adapt these Incur TypeScript client sections:

- public `incur/client` imports, limited to types and errors that snippets may use
- command maps and command ids
- Running Commands
- strict inputs
- output controls and pagination
- CTAs
- Errors with `Client.ClientError`
- Streaming
- Discovery Resources only when the exact generated declaration for a loaded extension exposes that
  resource surface through `extensions.<extensionId>`; do not imply all generated clients include
  resource helpers

Remove these source sections and examples:

- Setup and type-generation instructions
- `HttpClient`
- `HttpTransport`
- `MemoryClient`
- `MemoryTransport`
- `Client.create()`
- remote or served CLI guidance
- generated Skills local actions
- MCP local actions
- any example that constructs a client

Required substitutions:

- replace `client.run(...)` examples with `extensions.<extensionId>.run(...)`
- keep the original full commented result examples, changing only client names, command-map type
  names, and extension ids needed to make the example fit the generated `extensions` namespace
- describe `extensions` as containing only loaded TypeScript-enabled `svvyx` extensions available to
  the current actor
- say `incur/client` is importable inside snippets
- say agents must import `Client` from `incur/client` when they need `Client.ClientError`
- say agents must not construct `MemoryClient` or import extension implementation files

## Prompt Exposure

The agent receives:

- the `execute_typescript` tool declaration
- generated TypeScript declarations for the current actor
- concise usage guidance saying `execute_typescript` is for TypeScript composition, not one-shot
  repository inspection or file edits
- generic Execute TypeScript instruction for `extensions.<id>.run(...)` and `incur/client`
- loaded-extension client documentation only for loaded extensions that expose TypeScript API

The agent must not receive generated declarations for unavailable or available-but-not-loaded
extensions.
