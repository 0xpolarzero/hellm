# `svvyx` Incur Runtime Spec

## Status

- Date: 2026-06-03
- Status: authoritative internal runtime spec
- Scope:
  - define how `svvy` builds and invokes Incur-backed `svvyx` extensions
  - define the boundary between extension current builds, the stable `svvyx` dispatcher, shell
    invocation, generated TypeScript clients, env injection, and command recording
  - record the local Incur facts this design depends on

This spec intentionally does not teach agents how to author an Incur CLI. Extension authoring,
source editing, lifecycle commands, reset/delete/revert, and future Incur-authoring instructions
belong to `docs/specs/extension/extension_managing.extension.spec.md` and the loaded Extension
Managing instructions. This file is the internal plumbing contract for making already-authored
Incur-backed extensions buildable and callable.

Related specs:

- `docs/specs/extensions-and-tools.spec.md` defines the overall extension model, usage states,
  generated agent context, env redaction, and shell policy.
- `docs/specs/extension/extension_managing.extension.spec.md` defines the management CLI that creates,
  inspects, builds, and updates extension source state.
- `docs/specs/extension/artifacts.extension.spec.md` defines the product-record-creating `svvyx`
  Artifacts extension that relies on dispatcher runtime context.
- `docs/specs/extension/execute_typescript.extension.spec.md` defines generated loaded-extension
  clients inside `execute_typescript`.
- `docs/specs/extension/shell.extension.spec.md` defines `exec_command`, which is how agents run
  `svvyx ...` from the shell.
- `docs/specs/live-tool-projection.spec.md` defines how `svvyx ...` command-family progress renders
  over ordinary `exec_command` execution.

## Product Decision

`svvyx` is one stable app-owned CLI backed by Incur.

The dispatcher command shape is:

```text
svvyx <extension-id> <extension-command> ...
```

The dispatcher is not an actor-scoped generated aggregate CLI and must not be treated as a hard
capability boundary. The extension binding still matters, but it matters for generated agent context:

- loaded extensions contribute full instructions
- loaded `svvyx` extensions contribute command guidance
- builtin `svvyx` extensions with TypeScript API enabled contribute generated TypeScript clients
- user `svvyx` generated TypeScript clients are hidden until sandboxed generated-client execution
  exists
- available extensions contribute minimal loading guidance only
- unavailable extensions contribute nothing

The shell dispatcher may be invoked with any built extension id. Preventing an actor from guessing a
shell command is not the security boundary because ordinary shell execution can run arbitrary
commands under the configured execution policy. The useful product boundary is that agents only
receive prompt guidance, generated docs, and generated TypeScript declarations for the extension
binding they actually have.

Agent Shell usage of `svvyx ...` happens strictly through `exec_command`. There is no parent-process
command-family dispatch, parent-owned Shell shortcut, or second command model that lets an agent call
a `svvyx` command family outside ordinary Shell execution.

`svvyx` must still enforce normal runtime safety for the command it dispatches:

- the extension id must resolve to a known extension record with a current successful `svvyx` build
- the current build must be structurally valid
- required extension env values must be available before invocation
- only that extension's env values may be injected into the invocation
- command output, errors, artifacts, logs, and command facts must pass through normal redaction
- the top-level shell call remains subject to the normal `exec_command` policy and sandboxing path

## Local Incur Facts

The local Incur reference is `/Users/polarzero/code/wevm/incur`.
The packaged app consumes Incur from `github:wevm/incur#db1f8c0a62b6de45ab361ffead522b4323d5bc77` (`wevm/incur` PR #14). That commit is required because it includes committed `dist` package artifacts, so `svvy` can install the GitHub dependency directly without running an Incur install-time build.

The runtime design relies on these observed Incur facts:

- an Incur CLI object is created with `Cli.create(...)`
- a module can `export default cli` so Incur type generation and client code can import the CLI
- `cli.serve(argv, options)` can be called with explicit `argv`, `stdout`, `exit`, and `env`
  overrides
- `serve({ env })` supplies an explicit env source to Incur's env parser and does not need to mutate
  `process.env`
- command-level env schemas are parsed into the command handler context as `c.env`
- CLI-level env schemas are parsed into middleware context as `c.env`
- generated TypeScript clients can use an explicit env-source model for typed client calls
- direct reads from `process.env` ignore Incur's explicit env source

Because of that last point, `svvy` extension invocation supports injected extension env only through
Incur env declarations and `c.env`. Direct `process.env.<NAME>` reads are unsupported for app-managed
extension env values in v1.

## Extension Build Contract

An Incur-backed `svvyx` extension build validates and materializes one extension's runtime contract.

From the runtime perspective, a valid source entry exports a default Incur CLI object. The extension
source entry must not call `cli.serve()` at top level. `svvy` owns the serve wrapper and invocation
environment.

Build validation must fail when the source entry cannot be imported as a default Incur CLI. Build
validation must also reject normal self-serving entrypoints, such as obvious top-level `.serve()`
calls, because self-serving modules can execute commands during build import instead of through
`svvy`'s dispatcher/env wrapper. This is an authoring-contract validation, not a hostile-code
sandbox.
Editable extension code is still trusted in v1.

A successful build writes temporary output under:

```text
~/.config/svvy/extensions/builds/extensions/<extension-id>/staging/<build-run-id>/
```

After validation succeeds, `svvy` atomically promotes the staging output over:

```text
~/.config/svvy/extensions/builds/extensions/<extension-id>/current/
```

The current build must contain enough runtime metadata for `svvyx` to dispatch without consulting
editable source files as activation state. At minimum, the current build records:

- extension id
- interface, which is `svvyx`
- path to the built importable CLI module or generated wrapper module
- command manifest derived from the Incur CLI
- command descriptions, aliases, args schemas, option schemas, output schemas, examples, and
  streaming markers when available from Incur
- env declaration metadata that is safe to show to agents
- generated TypeScript declaration path when TypeScript API is enabled
- dependency/build validation metadata needed to reject stale or corrupt builds

Current build files must not contain raw env values, secret previews, secret hashes, keychain ids,
storage paths, generated aggregate cache keys, build ids, build timestamps, or user-facing restore
state.

Failed, blocked, or cancelled builds must not replace `current/`. The previously current extension
build remains the dispatch target until a new build is promoted successfully.

## `svvyx` Dispatcher

`svvyx` is an app-owned executable made available in the command environment used by `exec_command`.
It is not regenerated per actor and not regenerated per extension set.

Invocation flow:

```text
exec_command("svvyx linear issues.list --json")
  -> normal shell policy and sandbox handling
  -> stable svvyx dispatcher process
  -> resolve extension id "linear"
  -> read linear current build metadata
  -> validate current build and runtime readiness
  -> import the built default Incur CLI
  -> construct an env source for extension id "linear"
  -> call cli.serve(["issues.list", "--json"], { env, stdout, exit })
  -> redact and record command facts
```

`svvyx` parses only the leading extension id before handing the remaining arguments to the extension
CLI. Extension command names and flags are owned by the Incur CLI. For example:

```text
svvyx linear issues.list --json
```

dispatches to extension `linear` with extension argv:

```json
["issues.list", "--json"]
```

The dispatcher must not rewrite extension command names, translate extension flags, infer command
schemas from prose, or provide command-specific fallback behavior.

Top-level `svvyx --help` should explain dispatcher usage and should not be the product's available
extension catalog. Actor-visible extension discovery remains `list_extensions`, loaded extension
guidance in generated agent context, and Extension Managing inspection when loaded. `svvyx
<extension-id> --help`, `svvyx <extension-id> --llms`, `svvyx <extension-id> --llms-full`, and
`svvyx <extension-id> <command> --schema` dispatch to the current build for that extension and may
show that extension's own Incur help, docs, or schema.

## Runtime Env Injection

For each `svvyx <extension-id> ...` invocation, `svvy` builds a per-invocation env source for that
extension only:

1. start from the minimal safe base env required for the dispatcher and Incur runtime
2. add non-secret defaults declared by that extension
3. overlay app-level non-secret values for that extension
4. overlay app-managed secret values for that extension
5. call `cli.serve(extensionArgv, { env })`
6. discard the env source after invocation

The env source is passed through Incur's explicit `serve({ env })` option. It must not be installed
into global pi process env, the default actor shell env, `execute_typescript` snippet env, or another
extension's invocation env.

Extension commands must declare env through Incur schemas and read injected values through `c.env`.
Direct `process.env` reads are unsupported for app-managed extension env values because Incur's
explicit env source does not mutate `process.env`. `svvy` must not add a child-process fallback only
to support direct `process.env` reads in extension code.

If a required env value is missing, the dispatcher returns a structured extension-runtime error and
does not call the extension CLI. Missing-secret errors must direct the user to configure values in
the Extensions pane or app settings; they must never ask the user to paste secrets into chat.

## Generated TypeScript Clients

Generated TypeScript clients are a typed composition surface inside `execute_typescript`. They are
not a second shell dispatcher and not a separate approval surface. The top-level
`execute_typescript` tool call goes through the normal approval-boundary path before the snippet
runtime starts, and the approved runtime then runs under the managed filesystem and network sandbox
policy unless full-access policy omits sandboxing.

For a loaded builtin `svvyx` extension with TypeScript API enabled, generated clients use the same
generated command contracts as shell dispatch. The implementation calls through the generated
TypeScript client runtime with the same explicit extension env source:

```text
extensions.artifacts.run("inspect", { args: { artifactId: "art_123" } })
  -> generated client for loaded builtin extension "artifacts"
  -> provide extensionEnv("artifacts") as the explicit Incur env source
  -> run the Incur command "inspect" inside the approved/sandboxed execute_typescript runtime
  -> record a child command under the parent execute_typescript command
```

Generated clients must not be rewritten as shell `svvyx` calls in docs, generated declarations, or
agent prompts. The Shell path and TypeScript path share command contracts, readiness checks,
redaction, env injection, command facts, and child-command projection, but they do not share a
parent-process Shell dispatcher.

Builtin generated client calls must apply the same readiness checks, env injection rules,
redaction, command fact recording, and failure semantics as `svvyx` shell dispatch. Agent-facing
TypeScript sees only emitted builtin Incur-compatible command clients under
`extensions.<extension-id>`, not user extension clients or a broad generic all-extension client.

Agent-authored snippets must not construct generic Incur transports, import extension current-build
files, or use local Incur actions. The exposed `extensions.<extension-id>` object must remove local
Incur client actions such as local Skills or MCP setup actions. The only cross-extension abstraction
is the `extensions` wrapper.

Generated client declarations must preserve Incur command semantics:

- command ids are the extension's Incur command paths
- inputs use Incur `args`, `options`, and output controls
- non-streaming results use the Incur `Run.Result` envelope
- streaming commands use Incur stream response semantics
- command failures throw `Client.ClientError` from `incur/client`
- snippets may import public types and errors from `incur/client`

Available-but-not-loaded extensions and unavailable extensions do not contribute generated
TypeScript clients, even though the stable `svvyx` dispatcher may technically dispatch any known
built extension by id from a shell command.

## Command Facts And UI Projection

The model-visible operation remains `exec_command` for shell use and `execute_typescript` for typed
composition.

Every shell `svvyx ...` invocation runs inside a concrete `svvy` runtime context. Before the stable
`svvyx` executable dispatches to the extension CLI, it must receive the current session, surface,
thread, parent command, and actor binding facts from trusted product state rather than from shell
arguments or prompt text. Generated `execute_typescript` clients use the same trusted context source
when they create child command records, but they are not a second shell dispatcher. Extensions that
create product records, such as Artifacts, must derive ownership and linkage from this dispatcher
context rather than accepting agent-supplied owner ids.

When `exec_command` runs a command whose argv begins with `svvyx`, `svvy` should parse the command
well enough to attach best-effort structured facts:

- dispatcher: `svvyx`
- extension id
- extension argv
- current build validity status
- command path when resolved by Incur
- exit code
- stdout/stderr or structured output summary
- readiness or env errors when invocation is blocked before the extension CLI runs

These facts are UI and audit metadata. They do not create a separate model-facing tool kind named
`svvyx_command`, do not avoid shell approval policy for Shell usage, and do not make shell parsing a
source of semantic truth for arbitrary commands.

Generated TypeScript client calls create child command records under the parent `execute_typescript`
command. Those child records use the same extension id, command path, readiness, redaction, and
output summary vocabulary as shell-dispatched `svvyx` calls.

## Error Semantics

Dispatcher errors use normal command output and command facts. Required error classes:

- unknown extension id
- extension is known but has no current successful `svvyx` build
- current build is unreadable or structurally invalid
- extension interface is not `svvyx`
- dependency/install state makes the current build unusable
- required env value is missing
- current build CLI cannot be imported
- default export is not an Incur CLI
- extension command validation failed
- extension command returned an Incur error
- extension command threw an unexpected runtime error

Errors caused by missing build, stale build, dependency approval, dependency install, env readiness,
or current-build validation are extension runtime/readiness errors. They are not agent context
refresh failures.

## Generated Agent Context

Generated agent context remains actor-specific.

Loaded `svvyx` extensions contribute command guidance based on their current successful build.
Builtin `svvyx` extensions may also contribute emitted generated TypeScript declarations. User
`svvyx` generated TypeScript declarations remain hidden until sandboxed generated-client execution
exists. Available extensions contribute only minimal load guidance. Unavailable extensions
contribute nothing.

The stable shell dispatcher does not change that rule. The fact that `svvyx <extension-id> ...` may
technically dispatch a built extension from a shell does not justify including that extension's full
instructions, command docs, schemas, or generated clients in an actor context where it is only
available or unavailable.

When a successful extension build changes actor-facing command contracts, instructions, env
declaration metadata, or emitted generated TypeScript declarations, the normal extension context
fingerprint and generated agent context refresh pipeline applies.

## Runtime Boundary

The runtime contract is one stable app-owned `svvyx <extension-id> ...` dispatcher, actor-specific
generated context, invocation-local explicit env injection, and generated TypeScript clients exposed
only under `extensions.<id>` or `extensions["<id>"]`. The runtime boundary excludes:

- generating a different `svvyx` executable per actor
- treating `svvyx --help` as an actor-scoped available-extension catalog
- using actor-scoped shell impossibility as the extension security boundary
- exposing Incur MCP to agents as the `svvy` runtime integration
- exposing Incur skills to agents as the `svvy` runtime integration
- requiring extension source entries to call `cli.serve()` themselves
- supporting app-managed extension env through direct `process.env` reads
- generating a broad generic Incur client object for `execute_typescript`

## Implementation Notes

Build-time self-serve rejection can combine static and dynamic checks:

- parse source to reject obvious top-level `.serve()` calls in the extension entry
- import the source entry in an isolated build process and verify that the default export is an Incur
  CLI
- make the generated runtime wrapper the only place that calls `cli.serve(...)`

These checks are product-contract validation. They are not a sandbox for hostile extension code.
Editable Incur-backed extension code is trusted in v1, and a future egress proxy or process sandbox
may harden secret-bearing extension invocation without changing this dispatch contract.
