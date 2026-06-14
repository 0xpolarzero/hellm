# Agents, Extensions, And Tools Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines the current extension model, default extension usage, and agent-facing capability
boundaries.

## Core Model

Agents own:

- actor kind
- provider/model/reasoning defaults
- per-extension usage state
- generated context and runtime-surface previews

Extensions own:

- builtin or user ownership and lifecycle
- an editable minimal instruction source used as the available-loading hint, except fixed
  always-loaded Extension Loading may omit it
- zero or more ordered loaded instruction contributors
- scripted instruction contributors made from an editable TypeScript generator and a read-only
  generated Markdown output from the last generation
- optional CLI requirements
- optional native tool schemas
- optional `svvyx` command source plus generated command schema
- optional generated TypeScript API declarations when enabled for `svvyx`
- env and dependency readiness
- reset/delete behavior appropriate to category

Generated actor context is composed from the current agent profile plus loaded extensions.

Normal builtin and user extension sources are local editable files under
`~/.config/svvy/extensions/sources/...`. Builtin extension defaults are packaged read-only app
assets used only to scaffold missing builtin source directories and reset builtin source back to its
default state. User extensions own their local source directories directly. External instruction
records are the read-only exception: their content remains in external files such as `AGENTS.md` and
is never copied into an editable svvy source lifecycle.

For `svvyx` extensions, `source/index.ts` is the editable command source. A build produces generated
command schema output such as `commands.json`, which is the command contract that enters generated
prompt/tool context. Optional generated TypeScript API declarations are a separate build artifact
that exposes typed clients through `execute_typescript`; they are not the command schema.

Direct builtin prompt text, including base actor prompts and native-tool guidance, is modeled as
editable loaded Markdown source contributors. Scripted contributors are used only when an extension
has a real generator/source pair.

External instruction records are not normal extensions. They are discovered read-only instruction
files such as `AGENTS.md` or `CLAUDE.md`, owned outside `svvy`, with no minimal instruction, no
loaded-contributor lifecycle, no generated outputs, and no reset/delete controls.

## Builtin Extensions

| Extension | Interface | Orchestrator | Handler thread | Workflow task agent |
| --- | --- | --- | --- | --- |
| `base-common` | instructions | loaded | loaded | loaded |
| `base-orchestrator` | instructions | loaded | unavailable | unavailable |
| `base-handler` | instructions | unavailable | loaded | unavailable |
| `base-workflow-task` | instructions | unavailable | unavailable | loaded |
| `shell` | native_tool | loaded | loaded | loaded |
| `apply-patch` | native_tool | loaded | loaded | loaded |
| `execute-typescript` | native_tool | loaded | loaded | loaded |
| `extension-loading` | native_tool | loaded | loaded | loaded |
| `extension-managing` | svvyx | available | available | unavailable |
| `request-user-input` | native_tool | loaded | loaded | unavailable |
| `thread-orchestration` | native_tool | loaded | unavailable | unavailable |
| `thread-handling` | native_tool | unavailable | loaded | unavailable |
| `cx` | instructions | loaded | loaded | loaded |
| `git` | instructions | loaded | loaded | loaded |
| `github` | instructions | loaded | loaded | available |
| `web` | instructions | loaded when `networkAccess` is true | loaded when `networkAccess` is true | loaded when `networkAccess` is true |
| `smithers` | instructions | available | loaded | unavailable |
| `workflows` | svvyx | available | loaded | unavailable |
| `artifacts` | svvyx | loaded | loaded | loaded |
| external instructions | instructions | configurable | configurable | configurable |

The builtin extension inventory above is exhaustive for the base design.

Usage states are `loaded`, `available`, and `unavailable`. `unavailable` means the extension is
configured off for that actor's resolved default or profile binding; it is not by itself a hard
actor boundary. Configurable extensions may be moved between loaded, available, and unavailable for
a target actor/profile through the normal usage controls unless the extension is fixed always-loaded
by product contract. Extension Loading is the fixed always-loaded control; other `unavailable`
defaults remain configurable off states.

## Smithers Boundary

Smithers is prompt-only CLI guidance.

Agents use official Smithers CLI commands through Shell against workspace `.smithers/` source. The
Smithers extension adds no native tools, no `svvyx` commands, and no generated TypeScript client.

The generated actor context must not include Smithers wrapper tools.

## Workflows Boundary

Workflows is a builtin Incur-backed `svvyx` extension.

It exposes only:

```bash
svvyx workflows list [--kind agent|prompt|component|workflow] --json
svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json
svvyx workflows build --json
svvyx workflows models list --json
```

It manages reusable source and generated imports. It does not run Smithers workflows.

Generated `Agents.*` exports in `@svvy/workflows` are persisted `TaskAgentParameters` records from
`~/.config/svvy/workflows/agents`. `Agents.defineTaskAgent(parametersOrAgentsExport)` returns a
Smithers-compatible `AgentLike` for `<Task agent={...}>`. That `AgentLike` calls the app process
through the narrow authenticated `runTaskAgent` bridge with task-agent parameters, Smithers
taskContext/run/node/iteration/attempt identity, prompt/messages, rootDir, and workspace/session
binding, and receives `{ text, usage? }` plus optional `output` only when supplied by the app
runtime. The bridge accepts concurrent calls, binds each to a workflow-task-attempt surface, exposes
no arbitrary app RPC/shell/settings/orchestrator controls, and does not duplicate Smithers
workflow/run state.

When loaded into `execute_typescript`, it may expose the standard generated client:

```ts
extensions.workflows.run(commandId, input)
```

## Generated TypeScript Clients

Generated clients exist only for loaded TypeScript-enabled `svvyx` extensions.

The injected shape is:

```ts
extensions["<extensionId>"].run(commandId, input)
```

Dot access is allowed only for identifier-safe extension ids.

There is no global `svvy` client and no broad injected `api` object.

## Extension Loading

`list_extensions` reports the current actor's loaded and available extensions.

`load_extension` loads an available ready extension into the current actor session and refreshes the
actor's generated context at the next safe boundary.

Unavailable extension details, secret values, generated context fingerprints, aggregate cache keys,
and global profile usage state are not exposed through `list_extensions`.

## Build Requirements

Extension build validates:

- instruction source references
- generated instruction fragments
- CLI requirements
- env declarations
- generated TypeScript client declarations
- Incur command schemas for `svvyx` extensions

Workflows build depends on successful Extensions build because workflow-agent parameter records may
refer to generated extension exports.

## Related Specs

- `docs/prd.md`
- `docs/specs/extension/smithers.extension.spec.md`
- `docs/specs/extension/workflows.extension.spec.md`
- `docs/specs/workflow-library.spec.md`
- `docs/specs/extension/svvyx-incur-runtime.spec.md`
- `docs/specs/extension/thread_managing.extension.spec.md`
- `docs/specs/extension/artifacts.extension.spec.md`
- `docs/specs/extension/request_user_input.extension.spec.md`
- `docs/specs/extension/execute_typescript.extension.spec.md`
- `docs/specs/structured-session-state.spec.md`
