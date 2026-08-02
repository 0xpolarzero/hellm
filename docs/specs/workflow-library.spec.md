# Workflows Source, Build, And Generated Surface Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec
- Scope of this document:
  - define how agents author Smithers workflows inside a workspace
  - define the app-global reusable Workflows source library
  - define the generated `@svvyx/workflows` package, workspace-link plan contract, and runtime
    repair contract
  - define the `svvyx workflows ...` extension commands
  - define how workflow agents are represented as structured parameters
  - define the read-only Workflows pane as generated-output visibility

This spec defines reusable source, generated imports, and saved Workflows visibility only.

## Product Boundary

Smithers is the workflow runtime.

`svvy` does not wrap Smithers workflow execution behind a parallel workflow-control abstraction in
the agent-facing API. Agents that need to initialize, author, run, resume, inspect, approve, debug,
or repair Smithers workflows use official `bunx smthrs ...` commands directly
through the normal Shell extension.

The Workflows extension is not a workflow runner. It is the app-owned `svvyx workflows ...`
source-library command family plus, when the actor has Workflows loaded and `execute_typescript`
available, the injected actor-local `execute_typescript` declaration `extensions.workflows.run(...)`
for that same source-library command family. That injected declaration is not exported from
`@svvyx/workflows` or `@svvyx/extensions`. Reusable workflow authoring assets and task-agent
configuration are generated `@svvyx/workflows` imports, not facade calls.

The resolved split is:

- workspace-local Smithers authoring lives in the workspace `.smithers/` package
- app-global reusable source lives under `~/.config/svvy/workflows/`
- generated reusable import packages live in app-owned generated roots resolved through
  `GeneratedPackageRootPort`
- generated packages are linked into each opened workspace's `.smithers/node_modules` by
  runtime-owned link repair
- agents run Smithers through the official Smithers CLI and import reusable svvy assets from
  `@svvyx/workflows`

The repo-root `workflows/` directory is source-checkout-only authoring material used to build and
maintain `svvy` itself. It is never the shipped product workflow runtime, never the app-global
Workflows source library, and never evidence of packaged-app runtime paths.

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
reusable source lives in the app-global Workflows source library. Agents may edit workspace
Smithers source files such as `.smithers/workflows/**`, `.smithers/prompts/**`,
`.smithers/components/**`, `.smithers/agents/**`, `.smithers/package.json`,
`.smithers/tsconfig.json`, `.smithers/bunfig.toml`, and `.smithers/preload.ts` when allowed by the
active filesystem policy. Agents must not edit `.smithers/node_modules/**`, generated `@svvyx/*`
links, Smithers execution state/databases, run artifacts, or other generated package-resolution
plumbing.

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
```

Generated package output does not live under the Workflows source tree. Shipped generated package
roots are app-owned generated output locations resolved by `GeneratedPackageRootPort` as
`workflowsPackageRoot` for `@svvyx/workflows` and `extensionsPackageRoot` for `@svvyx/extensions`;
product code must resolve those roots only through `GeneratedPackageRootPort`, never from
`~/.config/svvy/workflows` or any source-library path.

The editable source directories are:

| Directory     | Source kind                              | Canonical source shape                        |
| ------------- | ---------------------------------------- | --------------------------------------------- |
| `agents/`     | reusable task-agent parameter records    | structured JSON files ending in `.agent.json` |
| `prompts/`    | reusable prompt assets                   | direct MDX files                              |
| `components/` | reusable Smithers components and helpers | direct TypeScript or TSX files                |
| `workflows/`  | reusable Smithers workflow modules       | direct TSX files                              |

Generated package output is app-owned build output resolved through `GeneratedPackageRootPort`, not
a child of the editable Workflows source tree. Agents must not edit generated Workflows output,
generated package files, or workspace links that point to that output. To change reusable material,
agents edit source files in `agents/`, `prompts/`, `components/`, or `workflows/` and run
`svvyx workflows build`, or they use `svvyx workflows save` to promote workspace-authored Smithers
material into the app-global source library.

The source-library files are app-global/user editable source truth. `@svvy/extensions` owns the
service authority for validating those files, building generated `@svvyx/workflows` output, and
reporting generated-context/source diagnostics; it does not make generated package output the source
truth and it does not make repo-root `workflows/` a shipped product runtime boundary.

The automatic approval reviewer must treat writes to generated Workflows output as invalid ordinary
edits. If a command attempts to mutate a generated package root or
`.smithers/node_modules/@svvyx/*`, the expected remediation is to edit the source item and rebuild,
not to approve a direct generated-file change.

## Generated Package

`svvyx workflows build` returns a `generated_packages.refresh` runtime-effect request.
`@svvy/runtime` applies that request in its generated-package refresh lane, where it calls
`@svvy/extensions` to validate source, atomically write generated package output at roots resolved
through `GeneratedPackageRootPort`, and return build evidence.

The package name is:

```text
@svvyx/workflows
```

The package root exports exactly four public namespaces:

```ts
export * as Agents from "./agents";
export * as Components from "./components";
export * as Prompts from "./prompts";
export * as Workflows from "./workflows";
```

Agent-facing usage should look like:

```tsx
import { Task } from "smthrs";
import { Agents, Components, Prompts, Workflows } from "@svvyx/workflows";

const reviewer = Agents.defineTaskAgent(Agents.reviewerAgent);

export default (
  <Task id="review" agent={reviewer}>
    Review the diff.
  </Task>
);
```

Everything agent-related lives under `Agents.*`, including:

- `Agents.defineTaskAgent`
- `Agents.TaskAgentParametersSource` as a type export
- generated reusable agent parameter exports such as `Agents.defaultAgent`,
  `Agents.reviewerAgent`, `Agents.implementerAgent`, and `Agents.explorerAgent`

The generated reusable agent exports are `TaskAgentParametersSource` records persisted from
structured source files under:

```text
~/.config/svvy/workflows/agents/*.agent.json
```

`Agents.defineTaskAgent(parametersOrAgentsExport)` accepts either a direct parameters object or one
of those generated `Agents.*` parameter exports. It returns the Smithers-compatible `AgentLike`
value intended for `<Task agent={...}>`.

Direct parameters are valid when the workflow source owns the task-agent configuration:

```tsx
import { Task } from "smthrs";
import { Agents } from "@svvyx/workflows";

const explorer = Agents.defineTaskAgent({
  id: "explore",
  label: "Explorer",
  provider: "openai",
  model: "<model-id-from-pi-metadata>",
  reasoning: { effort: "medium" },
  instructions: "Explore the requested area and return concise findings.",
});

export default (
  <Task id="explore" agent={explorer}>
    Map the relevant code paths.
  </Task>
);
```

The root package must not export reusable agents, components, prompts, or workflows as flat root
symbols. The four namespace exports are the public shape.

The builder generates group indexes from source files so exported source values are not missed
through manual curation. If a source file has exportable runtime values, the corresponding generated
group index must re-export them.

## Package Linking Into Workspaces

Bare imports such as `@svvyx/workflows` are reliable only when the package is available through a
`node_modules` tree visible from the importing workflow file.

When `svvy` opens or prepares a workspace with `.smithers/`, it must idempotently ensure:

```text
<workspace>/.smithers/node_modules/@svvyx/workflows
  -> <GeneratedPackageRootPort-resolved @svvyx/workflows root>
<workspace>/.smithers/node_modules/@svvyx/extensions
  -> <GeneratedPackageRootPort-resolved @svvyx/extensions root>
```

This link is package-resolution plumbing. It is not an editable workspace copy and not a user-facing
normal command.

`@svvy/extensions` obtains generated output roots only through `GeneratedPackageRootPort` and
workspace link candidates only through `WorkspaceSourceLinkPort` while constructing immutable
workspace-link plans. Generated-package refresh calls return generated output evidence only;
workspace-link plans are requested through the separate `planWorkspaceLink(...)` service after
runtime has committed app-global generated-package facts. `@svvy/runtime` applies those plans
through its command/recovery-scoped generated-package repair lane and records generated-package/link
facts through core-owned runtime-facing state ports implemented by `@svvy/state`. Product code must
not rely on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or a
source-checkout-relative package path as the product contract.

When a workspace `.smithers/` package is prepared and current generated facts exist,
runtime-owned link repair targets both canonical packages: `@svvyx/workflows` and
`@svvyx/extensions`. These links are package-resolution plumbing; runtime does not decide link
creation by scanning workflow imports. Missing `.smithers/` roots or blocked non-symlink paths are
recorded as workspace-link statuses. `@svvyx/extensions` is read-only generated
extension-reference data for `.smithers` authoring. It is not the internal `@svvy/extensions`
service package, not an `execute_typescript` runtime facade, and not a runtime command surface.

On workspace runtime-scope acquisition/preparation, and after app-global generated-package facts
commit, `@svvy/runtime` schedules/applies workspace-link repair for acquired workspace runtime
scopes. Unopened
workspaces retain pending link facts/recovery rows. Agents do not run a manual link command during
ordinary workflow authoring.

App-global generated-package build success and workspace import readiness are separate facts.
`@svvyx/workflows` and `@svvyx/extensions` may be built and current in the app-owned generated root
while a particular workspace still has pending, blocked, or failed `.smithers/node_modules/@svvyx/*`
links or missing Smithers authoring dependencies. A workflow-authoring command result or read model
may claim current-workspace imports are ready only after runtime commits ready workspace-link facts
for both canonical packages and the workspace Smithers dependency check needed by those imports.

## Workflows Extension

The Workflows extension is a builtin `svvyx` extension owned by `@svvy/extensions`.

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

`svvyx workflows ...` is invoked from agents through Shell and projects as `exec_command` command
work: approval, sandbox facts, stdout/stderr, cancellation, and command facts use the normal command
surface. The generated-package writes requested by `save` and `build` are not raw shell filesystem
effects. The `@svvy/extensions` Workflows handler returns an `ExtensionHandlerResult` with
model-facing command result plus one ordered `operations` item
`{ kind: "runtime_effect", request: { type: "generated_packages.refresh", ... } }`, and
`@svvy/runtime` applies it through the generated-package refresh lane. That lane records
generated-package facts through core-owned runtime-facing state ports implemented by `@svvy/state`.
Workspace-link repair is a separate runtime-owned lane: runtime asks `@svvy/extensions` for
immutable workspace-link plans, applies those plans, and records workspace-link facts through the
same core-owned state-port boundary. Generated-package builds and workspace-link repair acquire
scoped `SandboxLaunchFacts` through runtime-owned command/session lanes using package-private
`RuntimeLaunchPolicyService`, which delegates to `@svvy/sandbox` over immutable
`SandboxPolicySource` snapshots for their respective generated roots and workspace links. Direct
command-string mutation of generated package roots or `.smithers/node_modules/@svvyx/*` remains
invalid.

The same semantic operation may also be available through the injected actor-local
`execute_typescript` declaration under the `extensions` object when the Workflows extension is loaded
and TypeScript facades are enabled for that actor, following the standard Incur-backed extension
contract. These declarations are emitted into the `execute_typescript` invocation context only; they
are not `@svvyx/*` package exports and do not create a second generated-output write path.

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

After a successful save, the handler returns an `ExtensionHandlerResult` containing one
model-facing command result plus one ordered operations item wrapping a closed
`generated_packages.refresh` `RuntimeEffectRequest`. The command result reports only the accepted
source-library write. Runtime applies the refresh at the ordered generated-package boundary using
the same build pipeline as `svvyx workflows build`. The saved item is not considered available for
import until that runtime-applied refresh succeeds.

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

The generated package root exports namespace objects only. Agent source must call
`Agents.defineTaskAgent(...)`; importing a root `defineTaskAgent` value is invalid.

Example workspace source:

```ts
import { Agents } from "@svvyx/workflows";
import { Extensions } from "@svvyx/extensions";

const reviewerTaskAgent = Agents.defineTaskAgent({
  id: "reviewerAgent",
  label: "Reviewer",
  provider: "openai",
  model: "<model-id-from-pi-metadata>",
  reasoning: { effort: "medium" },
  instructions: "Review the implementation for correctness.",
  overrides: {
    [Extensions.git.id]: "loaded",
    [Extensions.github.id]: "loaded",
  },
});
```

Extension references use the canonical generated `@svvyx/extensions` id map. Identifier-safe ids may
use dot access such as `Extensions.git.id`; ids with punctuation use bracket access such as
`Extensions["apply-patch"].id`. Bare `Extensions.git`, bare `Extensions["git"]`, and generated
camel aliases are invalid.

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

The saved record contains the task-agent parameters, including sparse extension usage overrides,
provider, model, reasoning effort, label, and instructions. It does not contain arbitrary
TypeScript.

If the selected export cannot be statically parsed into task-agent parameters, `save` fails with a
structured diagnostic. It must not execute the source file to discover parameters.

Accepted static forms include:

- plain object literal parameters
- literal string, boolean, number, array, and object values
- spreads from known saved agents imported from `@svvyx/workflows`
- extension override keys computed from canonical `@svvyx/extensions` references by
  `Extensions.<id>.id` or `Extensions["<id>"].id`

Rejected forms include:

- dynamic provider/model/reasoning expressions
- function calls that compute required fields
- unresolved spreads
- imported arbitrary config objects
- conditional or environment-dependent values
- task-agent source that cannot be tied to one selected export

After saving, workspace Smithers source that wants to consume the saved reusable agent can import it as:

```ts
import { Agents } from "@svvyx/workflows";

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
  "model": "<model-id-from-pi-metadata>",
  "reasoning": { "effort": "medium" },
  "instructions": "Review the implementation for correctness.",
  "overrides": {
    "git": "loaded",
    "github": "loaded"
  }
}
```

Required fields:

- `id`
- `label`
- `provider`
- `model`
- `reasoning`
- `instructions`

`overrides` is an optional sparse map from extension id to usage state (`loaded`, `available`, or
`unavailable`) for values that differ from the resolved workflow task-agent defaults. There is no
separate `toolSurface` field. Native tool declarations, loaded prompt guidance, `svvyx` command
guidance, and generated `execute_typescript` facade declarations come from resolved extension usage.

The default agent is an ordinary parameter record named `defaultAgent`. Other agents may use it as a
base at authoring time:

```ts
const strictReviewer = Agents.defineTaskAgent({
  ...Agents.defaultAgent,
  id: "strictReviewer",
  label: "Strict Reviewer",
  reasoning: { effort: "high" },
  instructions: "Review strictly and call out missing tests.",
});
```

Agents-pane workflow-agent rows and saved `.agent.json` files are the same file-backed source of
truth. An agent saved by `svvyx workflows save --kind agent` must appear in the Agents pane. A user
change in the Agents pane submits a typed workflow-agent source edit request through the
app-bootstrap runtime facade. `@svvy/runtime` uses the extension-owned source contract, asks
`@svvy/extensions` to validate and write the `.agent.json` source, commits source-version,
fingerprint, and diagnostic facts through core-owned runtime-facing state ports implemented by
`@svvy/state`, and schedules generated-package refresh. Generated-package facts commit only after
that refresh succeeds. The pane refetches state-backed read models after invalidation. The
Agents pane can create and duplicate workflow-agent records, delete user-created records through
inline confirmation, open the exact `.agent.json` source file, and use the same expanded extension
selection and instruction-order editor as orchestrator and handler profiles. The seeded Explorer,
Implementer, and Reviewer workflow-agent records are editable and duplicable defaults, but they are
not deletable.

The Agents pane is the intended human customization surface for workflow agents. The Workflows pane
may link a generated `Agents.*` export to the corresponding Agents-pane row for convenience, while
still exposing the source file link for transparency.

## Workflow Task-Agent Bridge

The `AgentLike` returned by `Agents.defineTaskAgent(...)` performs only the generated client
transport call to the narrow authenticated `runTaskAgent` bridge. It does not create an Effect
runtime, call pi directly, own queueing, or control Smithers workflow/run lifecycle. Bridge contract
types live in `@svvy/core`. Workspace
`.smithers/workflows/**` and `.smithers/components/**` may import generated `@svvyx/workflows` and,
where task-agent extension references are authored, generated `@svvyx/extensions`. Persistent
app-global Workflows source under `~/.config/svvy/workflows/**` must not import
`@svvyx/workflows`; it may import `@svvyx/extensions` only where the generated-package import
policy allows extension reference values. `@svvyx/workflows` exports reusable authoring assets and
task-agent helpers; `@svvyx/extensions` exports workflow-task-safe extension reference ids. They are
not public `@svvy/*` packages, reusable SDKs, or `execute_typescript` runtime facades. The generated
`runTaskAgent` bridge operation is narrow internal plumbing and
exposes no Smithers runtime-control APIs. `@svvy/runtime` owns the authenticated endpoint, token
verification, queueing, task-attempt lifecycle, approval waits, and task-agent execution handoff;
`@svvy/pi-adapter` owns pi session creation and turn delivery; `@svvy/sandbox` owns immutable
sandbox policy snapshots and launch constraints; `@svvy/state` owns persisted command facts,
task-attempt facts, generated-context bindings, generated-package facts, link facts, and durable
workflow task-attempt surface state; `@svvy/extensions` owns generated package content/build
artifacts and package-safe link plans; `@svvy/runtime` schedules refresh work, applies workspace-link
repair from those plans, coordinates recovery, and records committed link facts through
`@svvy/state`. The bridge exists because official Smithers CLI workflow code runs in a child
process, while `@svvy/runtime` owns app-local task-agent execution inside the app-owned
`ManagedRuntime` and calls `@svvy/pi-adapter` for pi session creation and turn delivery.

The command-scoped bridge environment is injected only into handler-thread `exec_command` child
environments with an active structured source command id. The injection is not global app
environment, not based on parsing the shell text for `smithers`, and not a `svvy` wrapper around the
official Smithers CLI. The injected environment contains:

- `SVVY_WORKFLOW_AGENT_BRIDGE_URL`, the local bridge URL used for the `runTaskAgent` endpoint
- `SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN`, an unguessable app-owned bridge auth token scoped to
  `(workspaceSessionId, sourceCommandId)` and redacted from command output
- `SVVY_WORKFLOW_AGENT_WORKSPACE_SESSION_ID`, the owning top-level workspace session
- `SVVY_WORKFLOW_AGENT_SOURCE_COMMAND_ID`, the owning handler-thread `exec_command` record
- `SVVY_WORKFLOW_AGENT_BRIDGE_TIMEOUT_MS`, an optional positive integer request timeout in
  milliseconds
- `SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES`, an optional positive integer response byte cap
  decoded from `RuntimeLayerConfig.workflowTaskAgentBridgeMaxResponseBytes`

`docs/specs/package-architecture/runtime.spec.md` is authoritative for the exact bridge environment
variable names, auth token lineage, and transport contract. This section is product/runtime-facing
implementation specification for generated package code and runtime adapters only. It must not be
copied into generated agent instructions, Smithers prompt guidance, Workflows extension guidance, or
workflow task-agent prompts.

The bridge supports exactly one internal semantic operation for generated client code.
`@svvy/runtime` owns the local command-scoped loopback endpoint, token-lineage authorization,
idempotency, task-attempt lifecycle, queue insertion, pi-adapter delivery handoff, and result
mapping inside the single app-owned `ManagedRuntime` composed by app/bootstrap. App/bootstrap binds
the local host route to that runtime-owned bridge surface and exposes the command-scoped environment
variables to eligible Smithers subprocesses; it does not implement bridge semantics, create
per-request Effect runtimes, or compose per-request layer graphs. Generated
`@svvyx/workflows` client code uses this internal runtime route:

```http
POST {SVVY_WORKFLOW_AGENT_BRIDGE_URL}
Authorization: Bearer {SVVY_WORKFLOW_AGENT_BRIDGE_TOKEN}
Content-Type: application/json
```

The endpoint accepts only UTF-8 JSON request bodies decoded by the `RunTaskAgentSourceInput` schema
from `@svvy/core`. Generated package code sends plain string ids and paths. Runtime validates that
source DTO into the branded `RunTaskAgentInput` before token-lineage authorization, durable
idempotency, state writes, command facts, or pi-adapter delivery handoff. Transport adapters may
reject missing or malformed auth headers and oversized bodies before body decode; lineage
authorization that depends on `workspaceSessionId` and `sourceCommandId` happens only after the DTO
decodes. The token is generated by `@svvy/runtime` for one source command, is valid only while that
source command is running or waiting on Smithers child work, and is revoked when the source command
reaches a terminal state. Tokens are secrets: they are
redacted before command logging, terminal transcript persistence, app logs, Smithers-observed fact
storage, and renderer delivery.

The durable bridge idempotency key is generated by `@svvy/runtime` from `workspaceSessionId`,
`sourceCommandId`, Smithers run/node/iteration/attempt identity, and `agent.id`, as defined in the
runtime package architecture spec. `bridgeRequestId` is an optional generated-package call-site
correlation id for diagnostics only; it is not the durable idempotency key and does not decide queue
deduplication. Retrying the same runtime-derived idempotency key returns the same task-attempt
result when available or waits on the same durable queue/turn state. Runtime cancellation,
source-command terminalization, or token revocation interrupts any still-running task-attempt
surface and returns a typed cancelled bridge response if the HTTP request is still open.

The generated-client/runtime transport DTOs for that single operation are:

```ts
type SmithersObservedJson =
  | null
  | boolean
  | number
  | string
  | SmithersObservedJson[]
  | {
      readonly [key: string]: SmithersObservedJson;
    };

type SmithersTaskContextSnapshot = {
  run?: SmithersObservedJson;
  node?: SmithersObservedJson;
  rootDir?: string;
};

type SmithersTaskAttemptIdentity = {
  runId: string;
  nodeId: string;
  iteration: number;
  attempt: number;
};

type RunTaskAgentSourceInput = {
  operation: "runTaskAgent";
  bridgeRequestId?: string;
  agent: TaskAgentParametersSource;
  taskIdentity: SmithersTaskAttemptIdentity;
  smithersContext?: SmithersTaskContextSnapshot;
  promptSource:
    | { kind: "prompt"; prompt: NonEmptyString }
    | {
        kind: "messages";
        messages: NonEmptyReadonlyArray<{ role: "user" | "assistant"; text: string }>;
      };
  workspaceSessionId: string;
  sourceCommandId: string;
};

type RunTaskAgentResult = {
  text: string;
  usage?: SmithersObservedJson;
  output?: SmithersObservedJson;
};

type RunTaskAgentError = {
  error:
    | "unauthorized"
    | "forbidden"
    | "invalid_request"
    | "payload_too_large"
    | "bridge_request_conflict"
    | "source_command_not_found"
    | "source_command_not_handler_owned"
    | "source_command_terminal"
    | "task_attempt_cancelled"
    | "task_attempt_failed";
  message: string;
  retryable: boolean;
  requestId?: string;
  workspaceSessionId?: string;
  sourceCommandId?: string;
  taskAttemptId?: string;
};
```

`RunTaskAgentError` is the generated-client bridge DTO and keeps identity fields as plain strings
because it crosses JSON and is type-imported by generated `@svvyx/workflows` code. Runtime may carry
branded ids internally after validation; branded runtime-internal error variants are mapped back to
this plain DTO before bridge response encoding.

`payload_too_large` is used for byte-limit enforcement on both sides of the narrow bridge. The
runtime-owned bridge rejects request bodies larger than `workflowTaskAgentBridgeMaxRequestBytes`
before JSON decode; generated task-agent clients reject response bodies larger than
`SVVY_WORKFLOW_AGENT_BRIDGE_MAX_RESPONSE_BYTES`, or the per-call Smithers `maxOutputBytes` override
when provided, before JSON decode or result handling.

Runtime rejects bridge requests with missing `taskIdentity`, both prompt variants, neither prompt
variant, empty `messages`, or a `messages` item with a role outside `user` or `assistant` as
`invalid_request`. `bridgeRequestId` is diagnostic-only and must not affect durable idempotency.

Accepted source requests that validate to `RunTaskAgentInput` create or reuse the addressed
workflow task-attempt surface, bind generated workflow task-agent context, and insert a durable
`workflow_task_agent_start` queue row. The bridge does not directly call pi and does not bypass
runtime queue claiming, turn creation, command tracking, or recovery. The queue payload stores
`workflowTaskAttemptId`, normalized task-agent parameters, required Smithers task-attempt identity,
optional Smithers observed context, and exactly one `promptSource` value. Row-level queue metadata stores
`sourceCommandId`; the payload does not duplicate `sourceCommandId` or carry caller-supplied
`threadId`.

`taskIdentity` carries Smithers-owned run/node/iteration/attempt identity for the specific task
attempt. `smithersContext` carries optional observed Smithers run/node/root details. `promptSource`
carries the Smithers task prompt material as either one non-empty prompt string or a non-empty
user/assistant-message list.
`workspaceSessionId` binds the attempt to the app-owned top-level workspace session, and
`sourceCommandId` binds it to the handler-thread `exec_command` record whose command-scoped bridge
token authorized the callback. The server must reject calls whose token does not match
`(workspaceSessionId, sourceCommandId)`, whose source command does not exist, or whose source command
is not owned by a handler thread.

The result is Smithers-compatible `{ text, usage?, output? }`. `output` is present only when the app
runtime supplies structured task output for that attempt; callers must not assume it is always
present.
Errors are returned as `RunTaskAgentError` JSON with an HTTP status that matches the auth or
runtime failure class. The Smithers child process receives only this narrow bridge error; it never
receives raw Effect causes, SQLite errors, pi objects, bridge-token material, or app-internal stack
traces.

Concurrency is allowed. Multiple simultaneous Smithers task agents may call `runTaskAgent`; `svvy`
binds each accepted call to one workflow-task-attempt surface and runs it through the normal
pi-backed task-agent execution model. Attempts keep their own generated context fingerprint, command
facts, approvals, wait state, context-budget usage, and durable surface projection.

The bridge boundary is deliberately small. It exposes no arbitrary app RPC, no shell escape, no
settings mutation, no orchestrator or handler-thread controls, and no product workflow-control API.
It does not duplicate or control Smithers workflow/run lifecycle; Smithers remains owner of graph,
run, node, iteration, retry/resume semantics, and lifecycle decisions. `svvy` persists the app-owned
task-agent attempt surface plus Smithers-observed workflow/run/task/node/iteration/attempt bridge
facts, command links, artifact/log links, retry/resume observations, and workflow status summaries
required to render, audit, authorize, and recover or reconnect app-owned workflow-task-attempt
surfaces.

## Build Pipeline

`svvyx workflows build --json` is deterministic and fail-closed.

Runtime-applied generated-package refresh order:

1. call the `@svvy/extensions` generated-package service to validate Extension source and ensure
   current `@svvyx/extensions` output
2. use the same-batch generated `@svvyx/extensions` build evidence and declarations
3. read and validate Workflows source files
4. validate workflow agent provider/model/reasoning and extension usage override fields
5. ask `@svvy/extensions` to produce the staged `@svvyx/workflows` generated package files and
   generated manifest evidence; this build result contains no workspace-link plans
6. have `@svvy/runtime` apply the ordered generated-package refresh and record generated-package
   facts through `RuntimeGeneratedPackageStatePort`
7. have `@svvy/runtime` coordinate workspace-link repair for acquired workspace runtime scopes after
   the app-global generated package facts commit by asking `@svvy/extensions` for immutable
   `planWorkspaceLink(...)` results and applying those plans through runtime-owned link repair

The Workflows build must fail if the `@svvy/extensions` generated-package service reports invalid or
unbuildable Extension source. Workflow source that imports workflow-task-safe extension reference
values for usage override keys depends on fully typed generated `@svvyx/extensions` output.

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
- the provider auth health from svvy's redacted product state must be `usable`
- `model` must exist for the provider
- `reasoning.effort` must be supported by the selected model
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

For every agent parameter record, build validates each extension id present in `overrides`:

- the extension exists
- the extension has a successful current build when it needs one
- the extension can be configured for workflow task agents
- the generated `@svvyx/extensions` package exports the canonical extension reference whose `.id`
  matches the override id

Build fails on unknown, invalid, or not-ready extension override targets. A default `unavailable`
state means configured off; it is not an actor-boundary failure by itself.

Generated agent files import `Extensions` from `@svvyx/extensions` and compute override keys from
`Extensions.<id>.id` or `Extensions["<id>"].id`, not from string literals or generated aliases:

```ts
import { Extensions } from "@svvyx/extensions";

export const reviewerAgent = {
  id: "reviewerAgent",
  label: "Reviewer",
  provider: "openai",
  model: "<model-id-from-pi-metadata>",
  reasoning: { effort: "medium" },
  instructions: "Review the implementation for correctness.",
  overrides: {
    [Extensions.git.id]: "loaded",
    [Extensions.github.id]: "loaded",
  },
} satisfies TaskAgentParametersSource;
```

## Generated Export Evidence

Generated `@svvyx/workflows` export values do not carry app metadata. Runtime export values remain
natural Smithers authoring values: task-agent parameter records, prompt components, reusable TSX
components, and workflow components.

`@svvy/extensions` emits export identity, source path, generated path, and workflow-agent row
identity as generated-package build evidence. `@svvy/runtime` records successful generated-package
facts through `RuntimeGeneratedPackageStatePort` after the package-owned atomic replacement
succeeds, and the Workflows pane reads those generated-package/read-model facts for
source/generated links.

The exact schema-backed build row is `GeneratedWorkflowsExportBuildEvidence`: it carries kind,
matching namespace, export name, derived qualified name, absolute source and generated paths, and
the rendered generated code. Agent rows carry the validated `TaskAgentParametersSource` plus
`workflowAgentId` equal to that record's `id`; every non-agent row carries `null` for both
agent-only fields.

Generated runtime export values must not contain a private metadata symbol, public metadata fields,
a public metadata manifest, a public `__exports` array, or any app-only method. Agents import and use
the generated values exactly as ordinary Smithers authoring values.

## Workflows Pane

The Workflows pane is visibility into the generated package.

It is not:

- a Smithers execution dashboard
- a source editor
- a saved-entry runner

The pane refreshes after generated-package fact rows commit, state returns the generated-package
after-commit descriptor, runtime emits the corresponding typed runtime event, and app/bootstrap fans
out the renderer-safe Workflows read-model invalidation notification.

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

- reusable values are imported from `@svvyx/workflows`
- the four namespaces are `Agents`, `Components`, `Prompts`, and `Workflows`
- app-global reusable source is saved with `svvyx workflows save`
- generated package output is read-only and changed by rebuilding from source

Generated Workflows guidance must not mention product workflow wrapper tools, workspace-local svvy
workflow source layouts, runtime bridge details, `runTaskAgent` transport details, loopback
endpoints, bridge environment variables, or workflow/runtime-control APIs.

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
- `toolSurface` as a workflow-agent field separate from extension usage overrides
- title or summary inference in `svvyx workflows list`
- public metadata APIs, private metadata symbols, public metadata fields, metadata manifests, or
  `__exports` arrays in the `@svvyx/workflows` agent-facing surface
