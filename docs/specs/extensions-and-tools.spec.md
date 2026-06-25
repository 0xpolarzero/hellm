# Agents, Extensions, And Tools Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec

## Scope

This spec defines the extension model, default extension usage, and agent-facing capability
boundaries.

## Core Model

`@svvy/state` owns persisted agent profile/default rows, generated-context binding facts,
fingerprints, readiness facts, and read models. `@svvy/extensions` owns extension binding
resolution, generated actor-context construction, native tool declarations/metadata/handlers,
`svvyx` dispatch, env/dependency interpretation, generated `execute_typescript` facade
declarations, generated-package file production, and immutable generated-package link plans.
Model-callable extension handlers return one model-facing tool result, optional projection hints,
and ordered `ExtensionRuntimeOperation` items wrapping closed `RuntimeEffectRequest` values or
immutable `ExtensionExecutionPlan` values. They do not record durable command facts, write product
state, publish runtime events, or emit read-model notifications directly. Durable command facts and
invalidations are created only when `@svvy/runtime` processes those operations through
`@svvy/state` ports and relevant package services. `@svvy/desktop` renders the Agents pane editor
and composer controls, owns renderer-local view state, and submits typed intents through bootstrap
facades; `@svvy/state` owns persisted rows, and `@svvy/runtime` owns surface binding/update effects.

Agent profiles contain:

- actor kind
- provider/model/reasoning defaults
- per-extension usage state
- profile/default settings used to resolve generated-context previews
- non-authoritative preview display state for the current profile or surface

Extensions own:

- builtin or user ownership and lifecycle
- an editable minimal MDX instruction source used as the available-loading hint, except fixed
  always-loaded Extension Loading may omit it
- zero or more ordered loaded instruction contributors
- scripted instruction contributors made from an editable TypeScript generator and a read-only
  generated Markdown output from the last generation
- optional CLI requirements
- optional native tool declarations, metadata, schemas, and handlers; shared declaration shapes live
  in `@svvy/core`
- optional `svvyx` command source plus generated command schema
- optional generated `execute_typescript` facade declarations when enabled for `svvyx`
- env and dependency readiness
- reset/delete behavior appropriate to category
- generated actor context composition from resolved actor/profile or surface bindings, loaded
  extension contributors, enabled external instruction records, and actor-specific declaration
  availability

Generated actor context is composed from the resolved actor/profile or surface binding, loaded
extension contributors, enabled external instruction records, and actor-specific declaration
availability. Existing surfaces keep their bound context until `@svvy/runtime` refreshes it at a
safe pre-dispatch boundary. `@svvy/state` persists generated-context bindings, fingerprints, and
read-model facts.

Normal builtin and user extension sources are local editable files under
`~/.config/svvy/extensions/sources/...`. Builtin extension defaults are packaged read-only app
assets used only to scaffold missing builtin source directories and reset builtin source back to its
default state. User extensions own their local source directories directly. External instruction
records are the read-only exception: their content remains in external files such as `AGENTS.md` and
is never copied into an editable svvy source lifecycle.

For `svvyx` extensions, `source/index.ts` is the editable command source. A build produces generated
command schema output such as `commands.json`, which is the command contract that enters generated
prompt/tool context. Optional generated `execute_typescript` facade declarations are a separate
build artifact that exposes typed injected facades through `execute_typescript`; they are not the
command schema.

Direct builtin prompt text, including base actor prompts and native-tool guidance, is modeled as
editable loaded MDX source contributors. Scripted contributors are used only when an extension has a
real generator/source pair.

External instruction records are not normal extensions. They are discovered read-only instruction
files such as `AGENTS.md` or `CLAUDE.md`, owned outside `svvy`, with no minimal instruction, no
loaded-contributor lifecycle, no generated outputs, no loaded / available / unavailable state, and
no reset/delete controls.

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

The builtin extension inventory above is exhaustive for the base design.

Usage states are `loaded`, `available`, and `unavailable` (displayed as Off in UI). `unavailable`
means the extension is configured off for that actor's resolved default or profile binding; it is not
by itself a hard actor boundary. Configurable extensions may be moved between loaded, available, and
unavailable for a target actor/profile through the normal usage controls unless the extension is
fixed always-loaded by product contract. Extension Loading is the fixed always-loaded control; other
`unavailable` defaults remain configurable off states.

## External Instruction Records

| Category | Interface | Scope | Controls | Tools | Generated output |
| --- | --- | --- | --- | --- | --- |
| `external_instruction` | instructions | discovered file | enabled/disabled plus selected actor kinds | none | none |

External instruction records are configurable per discovered file path. They contribute read-only
file content to generated actor context only when enabled for that actor kind. They have no extension
lifecycle, no builtin/user source root, no minimal instruction, no `loaded` / `available` /
`unavailable` row state, no native tools, no `svvyx` command namespace, no generated package output,
and no reset/delete behavior that can modify the external file.

## Smithers Boundary

Smithers is prompt-only CLI guidance.

Agents use official Smithers CLI commands through Shell against workspace `.smithers/` source. The
Smithers extension adds no native tools, no `svvyx` commands, and no generated `execute_typescript`
facade.

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

Generated `Agents.*` exports in `@svvyx/workflows` are persisted `TaskAgentParametersSource` records
from `~/.config/svvy/workflows/agents`. `Agents.defineTaskAgent(parametersOrAgentsExport)` returns a
Smithers-compatible `AgentLike` for `<Task agent={...}>`. That `AgentLike` calls the runtime-owned
command-scoped loopback endpoint created by app bootstrap for the narrow authenticated
`runTaskAgent` bridge. App bootstrap wires the local route into the single app-owned
`ManagedRuntime`; `@svvy/runtime` owns token verification, queueing, task-attempt lifecycle,
generated-context binding, command facts, and pi turn orchestration. The bridge carries task-agent
parameters, required Smithers task-attempt identity `{ runId, nodeId, iteration, attempt }`,
optional observed Smithers context `{ run, node, rootDir }`, exactly one prompt source as either a
prompt string or a non-empty user/assistant message list, `workspaceSessionId`, and
`sourceCommandId`, and receives `{ text, usage? }` plus optional `output` only when supplied by the
app runtime. The bridge accepts concurrent calls, binds each to a workflow-task-attempt surface,
exposes no arbitrary app
RPC/shell/settings/orchestrator controls, and does not duplicate Smithers workflow/run state.

When loaded into `execute_typescript`, it may expose the standard generated facade:

```ts
extensions.workflows.run(extensionCommandId, input)
```

That facade is an injected runtime object provided to `execute_typescript`. It is not an
`@svvyx/workflows` or `@svvyx/extensions` import, and generated `@svvyx/*` packages are forbidden in
`execute_typescript` snippets.

## Generated Execute TypeScript Facades

Generated facade declarations exist only for loaded TypeScript-enabled `svvyx` extensions.

The injected shape is:

```ts
extensions["<extensionId>"].run(extensionCommandId, input)
```

Dot access is allowed only for identifier-safe extension ids.
`extensionCommandId` values are extension command paths, not durable product `CommandId` records.

There is no global `svvy` client and no broad injected `api` object.

## Extension Loading

`list_extensions` reports the current actor's loaded and available extensions.

`load_extension` records a loaded-extension binding change for the current actor surface and
schedules generated-context refresh for the next safe prompt-bearing pre-dispatch boundary. The
active pi turn's tool declarations, loaded instructions, and generated TypeScript declarations do
not mutate mid-turn. The tool does not build extensions, approve dependencies, configure env values,
or mutate profile defaults.

Unavailable extension details, secret values, generated context fingerprints, aggregate cache keys,
and global profile usage state are not exposed through `list_extensions`.

## Build Requirements

Extension build validates:

- instruction source references
- generated instruction fragments
- CLI requirements
- env declarations
- generated `execute_typescript` facade declarations
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
