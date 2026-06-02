# `execute_typescript` Spec

## Status

- Date: 2026-06-02
- Status: resolved direction for `execute_typescript` under the Extensions architecture
- Related spec: `docs/specs/extensions-and-tools.spec.md`

This spec replaces the older direct-tool helper model. `execute_typescript` is now a native
extension capability.

## Product Contract

`execute_typescript` is an actor-local TypeScript composition tool.

It is useful when TypeScript control flow helps the agent:

- batch related operations
- loop over structured data
- filter or aggregate command results
- call generated loaded-extension clients repeatedly
- transform JSON before returning a concise result
- collect evidence into artifacts through generated clients when those clients expose artifact
  operations

Ordinary one-shot repository work should use the Filesystem native extension:

- inspect files and search with `exec_command`
- continue long-running processes with `write_stdin`
- edit files with `apply_patch`

`execute_typescript` does not replace `exec_command`, `write_stdin`, or `apply_patch`.

## Authority

`execute_typescript` does not widen actor authority.

The generated TypeScript clients exposed to a submitted program are derived from the current actor's
loaded extension set and native tool set:

- loaded native tool extensions may contribute generated clients
- loaded `svvyx` extensions may contribute generated clients when TypeScript API is enabled
- available-but-not-loaded extensions contribute no generated client
- unavailable extensions contribute no generated client and no awareness

Provider readiness is not a generic reason to expose generated clients. If a future provider-backed
extension needs generated clients, that extension must still expose a concrete loaded runtime
interface whose source contracts can generate the client. The shipped Web extension is prompt-only
and therefore never contributes generated clients in Web v1.

If an actor cannot call a capability through its normal generated runtime interface, it must not gain
that capability through generated `execute_typescript` clients.

## TypeScript Runtime

The submitted program may run ordinary TypeScript.

Generated `svvy` and loaded-extension clients are the preferred surface because they provide:

- typed inputs and outputs
- extension-scoped documentation
- command facts and child action capture at `svvy`-owned boundaries
- extension env injection only for the invoked extension command
- redaction before output is persisted or shown to the model

Arbitrary TypeScript side effects that do not go through generated clients are opaque. `svvy` should
record the submitted source, lifecycle, console output, return value, thrown error, and any observed workspace
changes after the fact, but it must not claim exact reads, writes, network requests, or child process
behavior for arbitrary host-side TypeScript.

## Input

```ts
type ExecuteTypescriptInput = {
  typescriptCode: string;
};
```

The submitted TypeScript source is stored as an artifact for the attempt before execution.

## Generated Declarations

The actor receives one generated declaration block for `execute_typescript`. The exact names are
implementation contracts, but the structure must stay actor-scoped:

```ts
declare const svvy: SvvyClient;
declare const extensions: LoadedExtensionsClient;
declare const console: SvvyConsole;
```

`SvvyClient` contains only native `svvy` clients currently available to this actor.

`LoadedExtensionsClient` contains only loaded extensions that opted into TypeScript API generation.

`SvvyConsole` captures bounded diagnostic logs into the command result:

```ts
interface SvvyConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}
```

The generated declaration is the prompt contract. Handwritten prose can explain when to use
`execute_typescript`, but it must not redefine the interface.

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

When an equivalent operation is useful from TypeScript, it must come from a generated `svvy` or
loaded-extension client backed by the same source contract as the actual runtime capability. Do not
keep a second manually maintained helper API beside the generated client interface.

## Runtime Rules

- TypeScript is checked before execution when the runtime can do so reliably.
- Typecheck failure stops execution before generated client calls run.
- Runtime failure records the thrown error and preserves any child command facts already emitted.
- Generated client calls create child command records under the parent `execute_typescript` command.
- Console logs are bounded and recorded as command output or artifacts according to size.
- Secret redaction runs before logs, outputs, artifacts, command facts, or transcript text are
  persisted.
- Extension secrets are never injected into the broad TypeScript execution environment.
- Extension env values are injected only into the exact generated client command invocation that
  belongs to that extension.
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
const workflows = await extensions.smithers.listWorkflows({ productKind: "project-ci" });

return {
  count: workflows.items.length,
  ids: workflows.items.map((workflow) => workflow.workflowId),
};
```

Example with arbitrary TypeScript:

```ts
const values = [1, 2, 3, 4];
return {
  sum: values.reduce((total, value) => total + value, 0),
};
```

The last example has no child command facts because it does not call a generated client.

## Prompt Exposure

The agent receives:

- the `execute_typescript` tool declaration
- generated TypeScript declarations for the current actor
- concise usage guidance saying `execute_typescript` is for TypeScript composition, not one-shot repository
  inspection or file edits
- loaded-extension client documentation only for loaded extensions that expose TypeScript API

The agent must not receive generated declarations for unavailable or available-but-not-loaded
extensions.
