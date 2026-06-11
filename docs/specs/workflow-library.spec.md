# Workflows Source, Build, And Generated Surface Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec
- Scope of this document:
  - define how agents author Smithers workflows inside a workspace
  - define the app-global reusable Workflows source library
  - define the generated `@svvy/workflows` package and workspace package-linking contract
  - define the `svvyx workflows ...` extension commands
  - define how workflow agents are represented as structured parameters
  - define the read-only Workflows pane as generated-output visibility

This spec defines reusable source, generated imports, and saved Workflows visibility only.

## Product Boundary

Smithers is the workflow runtime.

`svvy` does not wrap Smithers workflow execution behind a parallel workflow-control abstraction in
the agent-facing API. Agents that need to create, run,
resume, inspect, or repair Smithers workflows use the official Smithers CLI directly through the
normal Shell extension.

The Workflows extension is not a workflow runner. It is the app-owned bridge for reusable workflow
authoring assets and task-agent configuration.

The resolved split is:

- workspace-local Smithers authoring lives in the workspace `.smithers/` package
- app-global reusable source lives under `~/.config/svvy/workflows/`
- generated reusable imports live under `~/.config/svvy/workflows/generated/`
- the generated package is linked into each opened workspace's `.smithers/node_modules`
- agents run Smithers through the official Smithers CLI and import reusable svvy assets from
  `@svvy/workflows`

The repo-root `workflows/` directory is still a source-checkout authoring workspace used to build
and maintain `svvy` itself. It is not the shipped product workflow runtime, not the app-global
Workflows source library, and not evidence of packaged-app runtime paths.

## Workspace Smithers Authoring

When an agent works on a repository workflow, ordinary Smithers files live under:

```text
<workspace>/.smithers/
  workflows/
  prompts/
  components/
  agents/
  package.json
  tsconfig.json
  bunfig.toml
  preload.ts
```

This follows Smithers' own workflow-pack model. Workspace workflow authoring lives in `.smithers/`;
reusable source lives in the app-global Workflows source library.

Agents may freely inspect and edit workspace `.smithers/` source according to the active filesystem
policy. They use normal coding tools such as shell inspection and `apply_patch`; they do not call a
`svvy` workflow wrapper to edit workflow files.

Workspace `.smithers/` source is workspace-owned. It may be committed or discarded according to the
repository's normal policy.

## App-Global Workflows Source Library

Reusable workflow assets live under one app-global root:

```text
~/.config/svvy/workflows/
  agents/
  prompts/
  components/
  workflows/
  generated/
```

The editable source directories are:

| Directory | Source kind | Canonical source shape |
| --- | --- | --- |
| `agents/` | reusable task-agent parameter records | structured JSON files ending in `.agent.json` |
| `prompts/` | reusable prompt assets | direct MDX files |
| `components/` | reusable Smithers components and helpers | direct TypeScript or TSX files |
| `workflows/` | reusable Smithers workflow modules | direct TSX files |

The generated directory is build output:

```text
~/.config/svvy/workflows/generated/
  package/
```

`generated/` is outside the safe writable boundary for ordinary agent file editing. Agents must not
edit generated Workflows output, generated package files, or workspace links that point to that
output. To change reusable material, agents edit source files in `agents/`, `prompts/`,
`components/`, or `workflows/` and run `svvyx workflows build`, or they use
`svvyx workflows save` to promote workspace-authored Smithers material into the app-global source
library.

The automatic approval reviewer must treat writes to generated Workflows output as invalid ordinary
edits. If a command attempts to mutate `~/.config/svvy/workflows/generated/` or
`.smithers/node_modules/@svvy/workflows`, the expected remediation is to edit the source item and
rebuild, not to approve a direct generated-file change.

## Generated Package

`svvyx workflows build` generates a real Bun/TypeScript package at:

```text
~/.config/svvy/workflows/generated/package/
```

The package name is:

```text
@svvy/workflows
```

The package root exports exactly four public namespaces:

```ts
export * as Agents from "./agents";
export * as Components from "./components";
export * as Prompts from "./prompts";
export * as Workflows from "./workflows";
```

Agent-facing usage should look like:

```ts
import { Agents, Components, Prompts, Workflows } from "@svvy/workflows";

const reviewer = Agents.defineTaskAgent(Agents.reviewerAgent);
```

Everything agent-related lives under `Agents.*`, including:

- `Agents.defineTaskAgent`
- `Agents.TaskAgentParameters` as a type export
- generated reusable agent parameter exports such as `Agents.defaultAgent` and
  `Agents.reviewerAgent`

The root package must not export reusable agents, components, prompts, or workflows as flat root
symbols. The four namespace exports are the public shape.

The builder generates group indexes from source files so exported source values are not missed
through manual curation. If a source file has exportable runtime values, the corresponding generated
group index must re-export them.

## Package Linking Into Workspaces

Bare imports such as `@svvy/workflows` are reliable only when the package is available through a
`node_modules` tree visible from the importing workflow file.

When `svvy` opens or prepares a workspace with `.smithers/`, it must idempotently ensure:

```text
<workspace>/.smithers/node_modules/@svvy/workflows
  -> ~/.config/svvy/workflows/generated/package
```

This link is package-resolution plumbing. It is not an editable workspace copy and not a user-facing
normal command.

The app may implement the link with direct symlink creation or an equivalent package-manager
operation. It must not rely on ambient global package resolution, `NODE_PATH`, parent repository
`node_modules`, or a source-checkout-relative package path as the product contract.

The app also links generated `@svvy/extensions` into `.smithers/node_modules` when workflow source
imports extension objects from that package.

If the link is stale or missing, app startup, workspace open, and `svvyx workflows build` repair it
when possible. Agents do not run a manual link command during ordinary workflow authoring.

## Workflows Extension

The Workflows extension is an Incur-backed builtin `svvyx` extension.

It is the only app-owned Workflows command surface. It does not run Smithers
workflows.

The command family is:

```bash
svvyx workflows list [--kind agent|prompt|component|workflow] --json
svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json
svvyx workflows build --json
svvyx workflows models list --json
```

There is no `install`, `retrieve`, `promote`, `agents list`, `components list`, or `prompts list`
command. Listing uses one command with an optional `--kind` filter. Saving uses one command with an
explicit `--kind`.

`svvyx workflows ...` runs through ordinary `exec_command` command execution and approval policy.
It may also be available through generated `execute_typescript` clients when the Workflows extension
is loaded and TypeScript clients are enabled for that actor, following the standard Incur-backed
extension contract.

## `svvyx workflows list`

`list` reads the latest successful generated package metadata and returns available generated
exports.

It is an orientation command, not full documentation and not a replacement for reading source files.

It must not invent or infer titles, summaries, descriptions, or usefulness labels. If a value is not
uniformly and mechanically available for every kind, it must not appear in the list output.

Output items include:

```ts
type WorkflowListItem = {
  kind: "agent" | "prompt" | "component" | "workflow";
  namespace: "Agents" | "Prompts" | "Components" | "Workflows";
  exportName: string;
  qualifiedName: string;
  sourcePath: string;
  generatedPath: string;
};
```

`qualifiedName` is derived from namespace and export name, for example
`"Agents.reviewerAgent"` or `"Components.ReviewPanel"`.

The list command may include generated validation status and diagnostic counts only when those
fields come from the latest build result and apply consistently. It must not include stale
diagnostics from an earlier failed build as if they describe the current generated package.

## `svvyx workflows save`

`save` promotes or copies workspace-authored material into the app-global Workflows source library.

Required arguments:

- `--from <path>`: the source file to save
- `--kind agent|prompt|component|workflow`: the target source kind
- `--as <exportName>`: the generated export name to create
- `--json`: structured output

Optional arguments:

- `--export <name>`: select one export from a TypeScript or TSX source file
- `--overwrite`: replace an existing source item with the same target id or export name

Default overwrite behavior is strict. If the target source item already exists and `--overwrite` is
not present, `save` fails with a structured `target_exists` error and performs no partial write.

After a successful save, `save` immediately runs the same build pipeline as
`svvyx workflows build`. The saved item is not considered available for import until that build
succeeds.

### Saving Prompts

Saving a prompt copies an MDX source file into:

```text
~/.config/svvy/workflows/prompts/
```

The generated package exports the prompt under `Prompts.<exportName>`.

### Saving Components

Saving a component copies or extracts TypeScript/TSX source into:

```text
~/.config/svvy/workflows/components/
```

If `--export` is provided, `save` retains only the selected export when it can do so without
changing behavior unsafely. If extraction is ambiguous, `save` fails with a structured diagnostic
instead of guessing.

The generated package exports component values under `Components.*`.

### Saving Workflows

Saving a workflow copies or extracts TSX workflow source into:

```text
~/.config/svvy/workflows/workflows/
```

The generated package exports workflow values under `Workflows.*`.

Saving a workflow does not create a `svvy` workflow runner or a runnable entry registry. The saved
workflow is reusable source for Smithers authoring.

### Saving Agents

Saving an agent saves task-agent parameters, not arbitrary executable agent code.

The source being saved must expose a statically extractable call to:

```ts
Agents.defineTaskAgent({ ... })
```

or to an imported `defineTaskAgent` value from `@svvy/workflows` where the callee can be resolved
unambiguously.

Example workspace source:

```ts
import { Agents } from "@svvy/workflows";
import { Extensions } from "@svvy/extensions";

const reviewerTaskAgent = Agents.defineTaskAgent({
  id: "reviewerAgent",
  label: "Reviewer",
  provider: "openai",
  model: "gpt-5.4",
  reasoningEffort: "medium",
  instructions: "Review the implementation for correctness.",
  extensions: [Extensions.git, Extensions.github],
});
```

Command:

```bash
svvyx workflows save \
  --from .smithers/workflows/review.tsx \
  --kind agent \
  --export reviewerTaskAgent \
  --as reviewerAgent \
  --json
```

The command writes a structured source record under:

```text
~/.config/svvy/workflows/agents/reviewerAgent.agent.json
```

The saved record contains the task-agent parameters, including extension ids, provider, model,
reasoning effort, label, and instructions. It does not contain arbitrary TypeScript.

If the selected export cannot be statically parsed into task-agent parameters, `save` fails with a
structured diagnostic. It must not execute the source file to discover parameters.

Accepted static forms include:

- plain object literal parameters
- literal string, boolean, number, array, and object values
- spreads from known saved agents imported from `@svvy/workflows`
- extension references imported from `@svvy/extensions`

Rejected forms include:

- dynamic provider/model/reasoning expressions
- function calls that compute required fields
- unresolved spreads
- imported arbitrary config objects
- conditional or environment-dependent values
- task-agent source that cannot be tied to one selected export

After saving, the agent may replace the local workspace source with:

```ts
import { Agents } from "@svvy/workflows";

const reviewerTaskAgent = Agents.defineTaskAgent(Agents.reviewerAgent);
```

## Agent Parameter Records

Reusable workflow agents are data.

Canonical source files are structured JSON:

```json
{
  "id": "reviewerAgent",
  "label": "Reviewer",
  "provider": "openai",
  "model": "gpt-5.4",
  "reasoningEffort": "medium",
  "instructions": "Review the implementation for correctness.",
  "extensions": ["git", "github"]
}
```

Required fields:

- `id`
- `label`
- `provider`
- `model`
- `reasoningEffort`
- `instructions`
- `extensions`

`extensions` is the complete extension composition for that task agent. There is no separate
`toolSurface` field. Tools, prompt guidance, and generated clients come from extension usage.

The default agent is an ordinary parameter record named `defaultAgent`. Other agents may use it as a
base at authoring time:

```ts
const strictReviewer = Agents.defineTaskAgent({
  ...Agents.defaultAgent,
  id: "strictReviewer",
  label: "Strict Reviewer",
  reasoningEffort: "high",
  instructions: "Review strictly and call out missing tests.",
});
```

Agents-pane workflow-agent rows and saved `.agent.json` files are the same source of truth. An agent
saved by `svvyx workflows save --kind agent` must appear in the Agents pane. A user change in the
Agents pane writes the same `.agent.json` source file and then builds immediately. The Agents pane
can create and duplicate workflow-agent records, delete user-created records through inline
confirmation, open the exact `.agent.json` source file, and use the same expanded extension
selection and instruction-order editor as orchestrator and handler profiles. The seeded Explorer,
Implementer, and Reviewer workflow-agent records are editable and duplicable defaults, but they are
not deletable.

The Agents pane is the intended human customization surface for workflow agents. The Workflows pane
may link a generated `Agents.*` export to the corresponding Agents-pane row for convenience, while
still exposing the source file link for transparency.

## Build Pipeline

`svvyx workflows build --json` is deterministic and fail-closed.

Build order:

1. build and validate Extensions
2. generate or refresh `@svvy/extensions`
3. read and validate Workflows source files
4. validate workflow agent provider/model/reasoning/extension fields
5. generate `@svvy/workflows`
6. link `@svvy/workflows` and `@svvy/extensions` into opened workspace `.smithers/node_modules`

The Workflows build must fail if Extensions are invalid or not buildable. Workflow source that
imports extension values depends on fully typed generated `@svvy/extensions` output.

The builder must not silently drop invalid source files. A generated package is current only when
all required validation passes.

## Provider, Model, And Reasoning Validation

Build validates every agent parameter record against app-owned provider/model state.

Validation inputs:

- pi's normalized provider list
- pi's normalized model registry
- svvy provider auth state
- pi model reasoning metadata, including `model.reasoning`, `model.thinkingLevelMap`, and xhigh
  support logic

Validation rules:

- `provider` must exist in pi's provider list
- the provider must be configured through an available auth source such as API key, OAuth, or env
- `model` must exist for the provider
- `reasoningEffort` must be supported by the selected model
- if the model does not support reasoning, the only valid reasoning value is `"off"`
- if the model supports reasoning, valid values are derived from the same logic as the Agents pane
- unsupported reasoning values fail build; they are not clamped

Build does not need to make a live provider API request by default. Quota, outage, and remote model
availability failures may still happen at runtime. Build catches static provider/model/auth/reasoning
configuration mistakes.

Diagnostics must be field-specific and actionable. A missing model diagnostic should include the
provider and available model ids when safe to report. A reasoning diagnostic should include the
allowed reasoning values for that model.

## Extension Validation

For every agent parameter record, build validates each listed extension id:

- the extension exists
- the extension has a successful current build when it needs one
- the extension can be used by workflow task agents
- the generated `@svvy/extensions` package exports the referenced extension value

Build fails on unknown, unavailable, invalid, or not-ready extensions.

Generated agent files import extension values from `@svvy/extensions`, not from string literals:

```ts
import { Extensions } from "@svvy/extensions";

export const reviewerAgent = {
  id: "reviewerAgent",
  label: "Reviewer",
  provider: "openai",
  model: "gpt-5.4",
  reasoningEffort: "medium",
  instructions: "Review the implementation for correctness.",
  extensions: [Extensions.git, Extensions.github],
} satisfies TaskAgentParameters;
```

## Internal Metadata

Generated runtime exports may carry internal metadata that lets the app identify:

- kind
- namespace
- export name
- source path
- generated path
- Agents-pane row id for workflow agents

This metadata is internal implementation detail. It must not appear in agent-facing examples,
generated prompt instructions, generated TypeScript snippets, normal import usage, or public
package docs. It must not require agents to call a metadata API or import an internal symbol.

Implementation may attach metadata with a non-enumerable symbol known only to the app, or another
equivalent private mechanism. The public runtime value must remain natural to use.

There is no public `__exports` array and no public metadata manifest in the agent-facing contract.

## Workflows Pane

The Workflows pane is visibility into the generated package.

It is not:

- a Smithers execution dashboard
- a source editor
- a saved-entry runner

The pane refreshes when Workflows build completes.

For each generated export, it shows:

- namespace: `Agents`, `Components`, `Prompts`, or `Workflows`
- export name
- qualified name
- read-only generated code
- link to the generated file
- link to the source file

For `Agents.*` exports, the pane also shows the generated parameter object and provides a primary
human UI link to customize that agent in the Agents pane. Agents do not use that UI link; agents use
`svvyx workflows ...` commands and normal imports.

The Workflows pane should not show title or summary metadata for generated exports unless that data
is uniformly and mechanically available for every relevant source kind. The default is to show only
export identity, generated code, and source links.

## Smithers CLI Guidance

The Smithers extension teaches official Smithers CLI usage.

The Workflows extension does not teach agents to run or supervise workflows. Agent-facing workflow
execution guidance belongs to Smithers instructions and should use official Smithers commands.

Generated Workflows guidance may mention:

- reusable values are imported from `@svvy/workflows`
- the four namespaces are `Agents`, `Components`, `Prompts`, and `Workflows`
- app-global reusable source is saved with `svvyx workflows save`
- generated package output is read-only and changed by rebuilding from source

Generated Workflows guidance must not mention product workflow wrapper tools or workspace-local svvy
workflow source layouts.

## Public API Boundary

The Workflows public API is limited to the source-library command family defined above. It excludes:

- workspace-local svvy source/runtime layouts as the reusable workflow base
- model-facing workflow wrapper tools
- separate model-list or asset-list native workflow tools
- `svvyx workflows install`
- `svvyx workflows retrieve`
- `svvyx workflows promote`
- separate `svvyx workflows agents/components/prompts list` commands
- generated Workflows output as editable source
- arbitrary TypeScript as the persisted source of truth for Agents-pane workflow agents
- bidirectional parsing of unconstrained TypeScript back into Agents-pane state
- `toolSurface` as a workflow-agent field separate from `extensions`
- title or summary inference in `svvyx workflows list`
- public metadata APIs or `__exports` arrays in the `@svvy/workflows` agent-facing surface
