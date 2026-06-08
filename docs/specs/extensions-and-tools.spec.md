# Agents, Extensions, And Tools Spec

## Status

- Date: 2026-06-08
- Status: adopted direction

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

- builtin, user, or external-instruction category
- instruction files
- minimal available-loading hints
- interface kind: `native_tool`, `svvyx`, or `instructions`
- generated TypeScript client declarations when enabled
- env and dependency readiness
- reset/delete behavior appropriate to category

Generated actor context is composed from the current agent profile plus loaded extensions.

## Builtin Extensions

| Extension | Interface | Orchestrator | Handler thread | Workflow task agent |
| --- | --- | --- | --- | --- |
| `base-common` | instructions | default_loaded | default_loaded | default_loaded |
| `base-orchestrator` | instructions | default_loaded | unavailable | unavailable |
| `base-handler` | instructions | unavailable | default_loaded | unavailable |
| `base-workflow-task` | instructions | unavailable | unavailable | default_loaded |
| `shell` | native_tool | default_loaded | default_loaded | default_loaded |
| `apply-patch` | native_tool | default_loaded | default_loaded | default_loaded |
| `execute-typescript` | native_tool | default_loaded | default_loaded | default_loaded |
| `extension-loading` | native_tool | default_loaded | default_loaded | default_loaded |
| `extension-managing` | native_tool | available | available | unavailable |
| `request-user-input` | native_tool | default_loaded | default_loaded | unavailable |
| `thread-orchestration` | native_tool | default_loaded | unavailable | unavailable |
| `thread-handling` | native_tool | unavailable | default_loaded | unavailable |
| `cx` | instructions | default_loaded | default_loaded | default_loaded |
| `git` | instructions | default_loaded | default_loaded | default_loaded |
| `github` | instructions | default_loaded | default_loaded | available |
| `web` | instructions | default_loaded when `networkAccess` is true | default_loaded when `networkAccess` is true | default_loaded when `networkAccess` is true |
| `smithers` | instructions | available | default_loaded | unavailable |
| `workflows` | svvyx | available | default_loaded | unavailable |
| `artifacts` | svvyx | default_loaded | default_loaded | default_loaded |
| external instructions | instructions | configurable | configurable | configurable |

There is no separate builtin CI workflow extension in the current base design.

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
