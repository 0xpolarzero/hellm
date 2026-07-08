# Workflows Extension Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec
- Scope:
  - define the builtin Workflows `svvyx` extension record
  - define the `svvyx workflows ...` command family
  - define actor-scoped agent-facing instructions for reusable Workflows source and generated
    imports
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
  "description": "Reusable Smithers workflow authoring assets, task-agent parameters, generated @svvyx/workflows imports, workflow-task extension references from @svvyx/extensions, and provider/model discovery.",
  "typescriptApiEnabled": true,
  "env": [],
  "dependencies": [],
  "cliRequirements": []
}
```

`typescriptApiEnabled` means an actor-local injected `execute_typescript` declaration may expose
`extensions.workflows.run(...)` for the `svvyx workflows ...` source-library command family when the
actor both loads Workflows and has `execute_typescript` available. It does not expose generated
`@svvyx/workflows` or `@svvyx/extensions` imports, Smithers runtime-control APIs, bridge internals,
or any broad `svvy` runtime facade.

Default usage:

| Actor kind          | State         |
| ------------------- | ------------- |
| Orchestrator        | `available`   |
| Handler thread      | `loaded`      |
| Workflow task agent | `unavailable` |

The Workflows extension is available to orchestrators so they can understand that reusable workflow
material exists, but normal workflow authoring belongs to handler threads. Workflow task agents do
not receive Workflows by default because they should execute the local task they were given. That
`unavailable` default is a configurable off state, not a hard actor boundary. If a profile override
loads Workflows into a workflow task agent, it exposes only source-library command guidance that is
valid for that actor. The `runTaskAgent` bridge is not a callable capability inside workflow
task-agent prompts; it is command-scoped child-process plumbing used by
`Agents.defineTaskAgent(...)` from Smithers workflow source. Workflows must not expose Smithers
runtime-control APIs, handler-thread controls, hand-written generated `@svvyx/workflows` or
`@svvyx/extensions` import guidance/examples, bridge details, or broad `execute_typescript` runtime
facades to workflow task-agent prompts.

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

Running, resuming, approving, inspecting, or debugging Smithers workflows is official
`bunx smithers-orchestrator ...` command behavior through the Shell extension, never bare `smithers`
or `bunx smithers`, and not Workflows extension behavior.

All command results are schema-backed and contain only machine-usable facts:

```ts
type WorkflowsCommandErrorCode =
  | "invalid_arguments"
  | "source_not_found"
  | "source_not_supported"
  | "target_exists"
  | "source_ambiguous"
  | "source_invalid"
  | "model_invalid"
  | "extension_reference_invalid"
  | "build_failed"
  | "generated_package_unavailable"
  | "state_conflict";

type WorkflowsCommandDiagnostic = {
  code: WorkflowsCommandErrorCode;
  message: string;
  sourcePath?: string;
  exportName?: string;
};

type WorkflowsSaveResult = {
  saved: {
    kind: "agent" | "prompt" | "component" | "workflow";
    exportName: string;
    sourcePath: string;
  };
  diagnostics: readonly WorkflowsCommandDiagnostic[];
};

type WorkflowsBuildResult = {
  diagnostics: readonly WorkflowsCommandDiagnostic[];
};

type WorkflowsModelsListResult = {
  providers: readonly {
    providerId: string;
    configured: boolean;
    authHealth: "usable" | "missing" | "expired" | "refresh_failed";
    redactedAccountLabel?: string;
    expiresAt?: string;
    models: readonly {
      modelId: string;
      displayName: string;
      supportedReasoning: readonly string[];
      capabilities: readonly ("reasoning" | "vision" | "tool_calling")[];
    }[];
  }[];
};
```

`save` and `build` both return an `ExtensionHandlerResult` with one model-facing command result plus
ordered operations, but their runtime effects differ:

- `save` validates the source, target, and overwrite intent, then returns a closed runtime operation
  for a Workflows source-library write followed by generated-package refresh.
- `build` returns one ordered `operations` item wrapping a closed `generated_packages.refresh`
  `RuntimeEffectRequest`.

Runtime applies Workflows source writes in its accepted-operation lane through `@svvy/extensions`,
then applies generated-package refresh in its generated-package refresh lane by invoking the
`@svvy/extensions` generated-package service, which writes generated package files and returns build
evidence only. Runtime records generated-package build/failure facts through core-owned state ports
implemented by `@svvy/state`. After those generated-package facts commit, runtime schedules
workspace-link repair for affected acquired workspace runtimes; each repair asks `@svvy/extensions`
for an immutable workspace/package link plan, applies that plan, and records committed
workspace-link facts through state ports. Model-facing command results must not include runtime
effect payloads, title, summary, recommendation, preview content, generated file snippets, runtime
scheduler ids, recovery ids, or applied workspace link status. Those are read from state read models
and generated-package facts after runtime applies the effect.

## `list`

`list` returns generated exports from the latest successful `@svvyx/workflows` build.

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

`save` requests that runtime copy or extract a reusable source item from a workspace path into the
app-global Workflows source library under `~/.config/svvy/workflows/`.

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

The `save` handler validates source, target, kind, export, and overwrite intent, then returns an
`ExtensionHandlerResult` with one model-facing accepted-intent result and ordered operations for the
runtime-owned source-library write and generated-package refresh. Runtime performs the write through
`@svvy/extensions`, then refreshes generated packages. The final source-library write result and
generated-package facts are runtime-applied facts; the saved export becomes available only after the
runtime-applied write and generated-package refresh succeed.

Agent saving rules:

- `prompt`: source is a direct MDX file saved under `~/.config/svvy/workflows/prompts/`
- `component`: source is TypeScript or TSX
- `workflow`: source is TSX
- `agent`: source is statically extracted task-agent parameters from an `Agents.defineTaskAgent(...)`
  call

Agent saves must not execute arbitrary TypeScript to discover parameters. Dynamic or ambiguous
agent definitions fail with diagnostics.

## `build`

`build` is the repair and refresh command for the Workflows source library.

The Workflows extension handler returns one ordered `ExtensionRuntimeOperation` wrapping
`generated_packages.refresh`. `@svvy/runtime` applies that request at the ordered refresh boundary,
where it calls the
`@svvy/extensions` generated-package service to:

1. validate Extension source and ensure current `@svvyx/extensions` output
2. use the same-batch generated `@svvyx/extensions` build evidence and declarations
3. validate Workflows source
4. validate workflow-agent provider/model/reasoning and extension usage overrides
5. generate `@svvyx/workflows`
6. return generated-package build evidence

After `@svvy/extensions` writes generated package files and returns build evidence,
`@svvy/runtime` records generated-package facts through `RuntimeGeneratedPackageStatePort`,
implemented by `@svvy/state`. It then schedules workspace-link repair for acquired workspace
runtimes that need `.smithers/node_modules/@svvyx/*` links. For each workspace/package pair, runtime
asks `@svvy/extensions` for a package-safe immutable link plan, applies that plan, coordinates
recovery, and records committed workspace-link facts through the relevant core-owned runtime-facing
state ports only after the repair worker applies or classifies the link plan.

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
- current credential visibility and model-auth usability for the provider
- redacted provider auth health: usable, missing, expired, or refresh failed
- supported reasoning values
- relevant capability flags such as reasoning, vision, and tool calling when available

It does not perform a live completion request by default.

## Generated Execute TypeScript Facade

When loaded into an actor with `execute_typescript`, the Workflows extension may expose the standard
Incur-compatible generated facade:

```ts
extensions.workflows.run(extensionCommandId, input);
```

The generated facade must contain only the concrete extension command ids above and their exact
input/output types. Those ids are extension command paths, not durable product `CommandId` records.
It must not expose a separate workflow runner, Smithers API, Smithers execution command surface, or
broad global `svvy` helper.

That facade is an injected runtime object provided to `execute_typescript`. It is not an
`@svvyx/workflows` or `@svvyx/extensions` import, and generated `@svvyx/workflows` and
`@svvyx/extensions` packages are forbidden in `execute_typescript` snippets.

## Agent Instructions

Loaded Workflows instructions are actor-scoped. Orchestrators and handler threads receive Workflows
instructions that teach:

- reusable workflow material lives under `~/.config/svvy/workflows/`
- reusable workflow asset imports come from `@svvyx/workflows`
- workflow task-agent extension reference values come from generated `@svvyx/extensions`
- the only public root imports are `Agents`, `Components`, `Prompts`, and `Workflows`
- generated `Agents.*` exports such as `Agents.reviewerAgent`, `Agents.implementerAgent`, and
  `Agents.explorerAgent` are persisted `TaskAgentParametersSource` records from
  `~/.config/svvy/workflows/agents`
- `Agents.defineTaskAgent(parametersOrAgentsExport)` and `Agents.TaskAgentParametersSource` live under
  `Agents`
- `Agents.defineTaskAgent(...)` returns the Smithers-compatible `AgentLike` intended for
  `<Task agent={...}>`
- generated agent usage:

```tsx
import { Task } from "smithers-orchestrator";
import { Agents } from "@svvyx/workflows";

const reviewer = Agents.defineTaskAgent(Agents.reviewerAgent);

export default (
  <Task id="review" agent={reviewer}>
    Review the diff.
  </Task>
);
```

- direct parameter usage:

```tsx
import { Task } from "smithers-orchestrator";
import { Agents } from "@svvyx/workflows";

const reviewer = Agents.defineTaskAgent({
  id: "reviewerAgent",
  label: "Reviewer",
  provider: "openai",
  model: "<model-id-from-pi-metadata>",
  reasoning: { effort: "medium" },
  instructions: "Review the diff.",
});

export default (
  <Task id="review" agent={reviewer}>
    Review the diff.
  </Task>
);
```

- agents use `svvyx workflows list` to orient
- agents use `svvyx workflows save` to save reusable material
- agents use `svvyx workflows build` after source edits
- agents use `svvyx workflows models list` to choose valid provider/model/reasoning values
- generated output and workspace `.smithers/node_modules/@svvyx/workflows` /
  `.smithers/node_modules/@svvyx/extensions` links are read-only package-resolution plumbing
- Smithers execution uses official Smithers CLI commands through Shell, not Workflows commands
- Smithers task-agent execution is handled only by generated `@svvyx/workflows` task-agent helpers.
  Agents should use `Agents.defineTaskAgent(...)` in Smithers workflow source and must not call,
  construct, inspect, or document the underlying runtime bridge or any workflow/runtime-control API.
- workflow task-agent overrides import `{ Extensions }` from `@svvyx/extensions` and use
  `Extensions.<id>.id` for identifier-safe ids or `Extensions["<id>"].id` for ids with punctuation;
  bare extension references and generated camel aliases are invalid
- Smithers task-agent execution is handled by `Agents.defineTaskAgent(...)`; agents do not interact
  with bridge internals

These orchestrator and handler-thread instructions cover only app-global source-library commands,
generated imports, read-only generated output, and task-agent import usage. They may include the
negative boundary that Workflows does not run Smithers workflows; official Smithers CLI usage
belongs to the Smithers extension.

If a profile override loads Workflows into a workflow task agent, that actor receives only
actor-valid source-library command guidance generated from source contracts: `svvyx workflows list`,
`svvyx workflows save`, `svvyx workflows build`, `svvyx workflows models list`, the app-global
source root, read-only generated output boundaries, and the fact that Workflows does not run
Smithers workflows. Workflow task-agent Workflows instructions may include generated TypeScript
declarations or generated schema blocks for those commands, but must not include hand-written
generated `@svvyx/workflows` or `@svvyx/extensions` import examples, `Agents.defineTaskAgent(...)`,
`TaskAgentParametersSource`, bridge payload details, Smithers task-attempt identity fields,
`runTaskAgent` transport details, handler-thread controls, Smithers runtime-control guidance, or
broad `execute_typescript` runtime facade guidance.

## Workflows Pane Relationship

The Workflows pane reads the `@svvy/state` read model derived from latest successful generated
Workflows package facts. It is not an extension command and does not scan generated output files or
read internal build metadata directly.

The extension command output and Workflows pane agree because both derive from generated-package
build evidence produced by `@svvy/extensions` and durable generated-package facts committed by
`@svvy/runtime` through `RuntimeGeneratedPackageStatePort`. Runtime announces the committed changes
as typed after-commit notifications. Consumers refetch state read models.
Source/export links are state read-model fields, not an agent-facing generated package API.
