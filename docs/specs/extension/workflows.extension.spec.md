# Workflows Extension Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec
- Scope:
  - define the builtin Workflows `svvyx` extension record
  - define the `svvyx workflows ...` command family
  - define agent-facing instructions for reusable Workflows source and generated imports
  - define build prerequisites, validation, and read-only generated output behavior

Detailed source layout, generated package, save semantics, model validation, and Workflows pane
behavior are defined in `docs/specs/workflow-library.spec.md`. This file is the extension record
and command-surface contract.

## Extension Record

```json
{
  "id": "workflows",
  "category": "builtin",
  "interface": "svvyx",
  "title": "Workflows",
  "description": "Reusable Smithers workflow authoring assets, task-agent parameters, generated @svvy/workflows imports, and provider/model discovery.",
  "typescriptApiEnabled": true,
  "env": [],
  "dependencies": [],
  "cliRequirements": []
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `available` |
| Handler thread | `loaded` |
| Workflow task agent | `unavailable` |

The Workflows extension is available to orchestrators so they can understand that reusable workflow
material exists, but normal workflow authoring belongs to handler threads. Workflow task agents do
not receive Workflows by default because they should execute the local task they were given. That
`unavailable` default is a configurable off state, not a hard actor boundary.

## Command Family

The concrete agent-facing CLI is:

```bash
svvyx workflows list [--kind agent|prompt|component|workflow] --json
svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json
svvyx workflows build --json
svvyx workflows models list --json
```

There are no other Workflows commands in the adopted base design.

Rejected command names:

- `svvyx workflows install`
- `svvyx workflows retrieve`
- `svvyx workflows promote`
- `svvyx workflows agents ...`
- `svvyx workflows components ...`
- `svvyx workflows prompts ...`
- `svvyx workflows run ...`

Running, resuming, approving, inspecting, or debugging Smithers workflows is Smithers CLI behavior
through the Shell extension, not Workflows extension behavior.

## `list`

`list` returns generated exports from the latest successful `@svvy/workflows` build.

It supports one optional filter:

```bash
--kind agent|prompt|component|workflow
```

It returns only mechanically available export identity and paths:

```ts
type WorkflowsListResult = {
  items: Array<{
    kind: "agent" | "prompt" | "component" | "workflow";
    namespace: "Agents" | "Prompts" | "Components" | "Workflows";
    exportName: string;
    qualifiedName: string;
    sourcePath: string;
    generatedPath: string;
  }>;
};
```

It must not return inferred title, summary, description, recommendation, or usefulness fields.

The command is for orientation. Agent instructions should tell agents to read source files before
modifying or relying on a reusable export's detailed behavior.

## `save`

`save` copies or extracts a reusable source item from a workspace path into the app-global Workflows
source library under `~/.config/svvy/workflows/`.

Required:

- `--from <path>`
- `--kind agent|prompt|component|workflow`
- `--as <exportName>`
- `--json`

Optional:

- `--export <name>`
- `--overwrite`

If saving would overwrite an existing source item and `--overwrite` is absent, the command fails
with `target_exists` and performs no partial write.

After a successful write, `save` runs the full Workflows build. The saved export becomes available
only when that build succeeds.

Agent saving rules:

- `prompt`: source is direct MDX
- `component`: source is TypeScript or TSX
- `workflow`: source is TSX
- `agent`: source is statically extracted task-agent parameters from a `defineTaskAgent(...)` call

Agent saves must not execute arbitrary TypeScript to discover parameters. Dynamic or ambiguous
agent definitions fail with diagnostics.

## `build`

`build` is the repair and refresh command for the Workflows source library.

It must:

1. build and validate Extensions
2. generate or refresh `@svvy/extensions`
3. validate Workflows source
4. validate workflow-agent provider/model/reasoning and extension usage overrides
5. generate `@svvy/workflows`
6. link generated packages into opened workspace `.smithers/node_modules`

The command returns structured diagnostics and fails closed. It must not silently generate a partial
package that drops invalid source items.

Generated output is read-only to agents. The generated package is changed only by editing source and
running build or by successful `save`.

## `models list`

`models list` returns app-known provider/model/reasoning choices for workflow-agent parameter
authoring.

It is backed by the same pi model registry, provider auth state, and reasoning support logic used by
the Agents pane.

It reports:

- provider id
- model id
- whether the provider is currently configured/authenticated
- auth source category such as API key, OAuth, env, or missing
- supported reasoning values
- relevant capability flags such as reasoning, vision, and tool calling when available

It does not perform a live completion request by default.

## Generated TypeScript Client

When loaded into an actor with `execute_typescript`, the Workflows extension may expose the standard
Incur-compatible generated client:

```ts
extensions.workflows.run(commandId, input)
```

The generated client must contain only the concrete command ids above and their exact input/output
types. It must not expose a separate workflow runner, Smithers API, product workflow wrapper, or
broad global `svvy` helper.

## Agent Instructions

Loaded Workflows instructions must teach:

- reusable workflow material lives under `~/.config/svvy/workflows/`
- generated imports come from `@svvy/workflows`
- the only public root imports are `Agents`, `Components`, `Prompts`, and `Workflows`
- `Agents.defineTaskAgent` and `Agents.TaskAgentParameters` live under `Agents`
- agents use `svvyx workflows list` to orient
- agents use `svvyx workflows save` to save reusable material
- agents use `svvyx workflows build` after source edits
- agents use `svvyx workflows models list` to choose valid provider/model/reasoning values
- generated output and `.smithers/node_modules/@svvy/workflows` are read-only plumbing
- Smithers execution uses official Smithers CLI commands through Shell, not Workflows commands

Loaded Workflows instructions cover only app-global source-library commands, generated imports,
read-only generated output, and the official Smithers CLI execution boundary.

## Workflows Pane Relationship

The Workflows pane reads generated Workflows output and internal metadata. It is not an extension
command.

The extension command output and Workflows pane should agree because both derive from the same
latest successful generated package. The pane may use internal metadata attached during build to
link generated exports to source files and Agents-pane rows. That metadata is not an agent-facing
API.
