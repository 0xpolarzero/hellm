# Smithers Extension Spec

## Status

- Date: 2026-06-08
- Status: authoritative product spec
- Scope:
  - define the builtin Smithers extension record
  - define the agent-facing Smithers CLI boundary
  - define generated Smithers instruction output and cleanup rules
  - define the svvy-specific Smithers boundary instruction

This spec defines Smithers prompt guidance only.

## Extension Record

```json
{
  "id": "smithers",
  "category": "builtin",
  "interface": "instructions",
  "title": "Smithers",
  "description": "Official Smithers CLI and authoring guidance for workspace .smithers workflows.",
  "typescriptApiEnabled": false,
  "cliRequirements": [
    {
      "id": "smithers-orchestrator",
      "package": "smithers-orchestrator",
      "binary": "bunx",
      "required": true,
      "version": "0.22.0",
      "versionCommand": "bunx smithers-orchestrator --version"
    }
  ],
  "instructionFiles": [
    {
      "file": "010-smithers-core.generated.md",
      "bypassed": false
    },
    {
      "file": "020-smithers-handler.md",
      "bypassed": false
    },
    {
      "file": "030-smithers-svvy-boundary.md",
      "bypassed": false
    },
    {
      "file": "040-smithers-memory.generated.md",
      "bypassed": true
    }
  ],
  "generatedInstructions": [
    {
      "output": "instructions/full/010-smithers-core.generated.md",
      "script": "scripts/generate-instructions.ts",
      "versionCliRequirementId": "smithers-orchestrator"
    },
    {
      "output": "instructions/full/040-smithers-memory.generated.md",
      "script": "scripts/generate-instructions.ts",
      "versionCliRequirementId": "smithers-orchestrator"
    }
  ]
}
```

Default usage:

| Actor kind          | State         |
| ------------------- | ------------- |
| Orchestrator        | `available`   |
| Handler thread      | `loaded`      |
| Workflow task agent | `unavailable` |

The Smithers extension is prompt-only. It adds no native tools, no generated `execute_typescript` facade, and
no Incur command surface.

## Agent-Facing Boundary

Agents use Smithers directly.

Allowed agent-facing Smithers actions are ordinary shell commands against the official Smithers CLI,
for example:

```bash
bunx smithers-orchestrator init
bunx smithers-orchestrator workflow run <workflow-id> --prompt "<prompt>"
bunx smithers-orchestrator ps
bunx smithers-orchestrator inspect <run-id>
bunx smithers-orchestrator logs <run-id> --tail 20
```

The exact command names and flags come from generated Smithers instructions for the current
`smithers-orchestrator` CLI requirement version resolved by Extension Managing. Current upstream
Smithers documentation presents agent-facing commands as `bunx smithers-orchestrator ...`; generated
`svvy` Smithers instructions preserve that official surface. They must not rewrite upstream
examples to a global `smithers` binary, tell agents to install or depend on a global Smithers CLI,
or rely on repo-root `workflows/node_modules/.bin/smithers`.

The package, import, JSX runtime, and CLI package names remain `smithers-orchestrator`. Workflow
TypeScript imports from `"smithers-orchestrator"`, and Shell commands use
`bunx smithers-orchestrator ...`.

`svvy` exposes no product-native Smithers execution command. Smithers execution is Shell work
through official `bunx smithers-orchestrator ...` commands.

Agents invoke Smithers through `exec_command`. Approval, sandboxing, network policy, and command
projection are the normal Shell extension behavior.

Agents do not call Smithers through `workflow.*`, `svvyx smithers`, a Smithers-native tool, a
loopback runtime-control tool, or a broad bridge helper. Smithers workflow code may use generated
`@svvyx/workflows` task-agent helpers, but the generated `runTaskAgent` call is internal bridge
plumbing: it is authenticated by `@svvy/runtime`, runs inside the app-owned Effect `ManagedRuntime`,
and exposes only task-agent handoff rather than workflow graph, shell, settings, orchestrator, or
handler controls.
Smithers `.smithers/agents/**` files are workspace-local Smithers configuration. They are not the
svvy reusable task-agent parameter store and must not be used to configure svvy task-agent model,
systemPrompt, extension usage, bridge credentials, or runtime behavior. Reusable svvy task-agent
parameters live in the app-global Workflows source library and are consumed through generated
`@svvyx/workflows` `Agents.*` exports.

## Workspace Shape

Smithers workspace authoring lives in:

```text
<workspace>/.smithers/
```

The Smithers extension must describe `.smithers/` as the workspace-local Smithers package and must
not direct agents to use any other workspace-local workflow source layout.

`bunx smithers-orchestrator init` is the normal initialization path. It scaffolds `.smithers/` with a local
`.smithers/package.json` whose Smithers dependency is `smithers-orchestrator`, so TypeScript imports
such as `import { createSmithers } from "smithers-orchestrator"` resolve from the workspace
Smithers package. Agents that manually create `.smithers/` source without
`bunx smithers-orchestrator init` must still ensure the `.smithers` package declares the Smithers
dependency instead of relying on a global CLI install for TypeScript module resolution.

Reusable svvy workflow assets are documented by the Workflows extension. Smithers itself still runs
as Smithers; the Smithers extension does not own reusable-source-library save, build, or
model-selection guidance. It may include only the boundary pointer that reusable svvy workflow
assets are Workflows-extension material and, inside workspace `.smithers` TypeScript/TSX authoring
source, are imported from generated `@svvyx/workflows` package exports.

## Relationship To Workflows Extension

Smithers and Workflows are separate extensions.

Smithers extension:

- teaches official Smithers CLI and JSX workflow concepts
- teaches the workspace `.smithers/` package shape
- tells agents to run Smithers directly through shell commands

The Workflows extension owns detailed reusable source-library import examples,
save/build/model-selection guidance, generated `@svvyx/workflows` authoring imports, and
workflow-task-safe extension reference values emitted through generated `@svvyx/extensions`.
`@svvyx/extensions` is not a public `@svvy/*` package, not a reusable workflow asset package, not a
workflow-authoring SDK, and not an `execute_typescript` runtime facade. Plain generated
extension-reference values are permitted only where workflow task-agent extension references are
authored. The Smithers extension may include only the boundary pointer that reusable svvy workflow
assets are Workflows-extension material and, inside workspace `.smithers` TypeScript/TSX authoring
source, are imported from generated `@svvyx/workflows`. It must not teach Workflows commands beyond
that boundary pointer or present generated `@svvyx/workflows` or `@svvyx/extensions` packages as
runtime facades.

## Generated Instruction Source And Transform

The generated Smithers instruction files are:

```text
instructions/full/010-smithers-core.generated.md
instructions/full/040-smithers-memory.generated.md
```

The generated core file is derived from Smithers' upstream full documentation for the current
`smithers-orchestrator` version selected by Extension Managing. The memory fragment remains
generated and inspectable but bypassed by default.

The generator must keep the core authoring and CLI concepts needed for direct Smithers use:

- `.smithers/` project setup
- JSX workflow authoring
- prompts, components, workflows, and agents
- official Smithers CLI commands
- upstream `bunx smithers-orchestrator ...` command examples preserved as the agent-facing command
  surface
- upstream dotted `workflow.*` command/tool names omitted or rewritten to official Smithers CLI
  command examples such as `bunx smithers-orchestrator workflow run ...`,
  `bunx smithers-orchestrator ps`, and `bunx smithers-orchestrator inspect ...`
- approvals and resume as Smithers concepts
- stable task ids, outputs, schemas, and render-loop behavior

The generator emits only content that fits the adopted `svvy` boundary. Generated Smithers guidance
excludes:

- Smithers GUI as a `svvy` UI requirement
- Smithers Gateway, MCP, HTTP server, OpenTelemetry, DevTools, or event-streaming instructions as
  current `svvy` product surfaces
- OpenAPI and low-level Effect authoring fragments
- claims that `svvy` exposes Smithers through native model-facing tools
- upstream or external agent-facing instructions to run `smithers ...`, `bunx smithers ...`, or an
  unverified bare package name instead of the official `bunx smithers-orchestrator ...` command
  surface
- upstream dotted `workflow.*` names as product APIs, native tools, MCP surfaces, or model-facing
  operations
- any generated suggestion to use product-native Smithers execution commands or workspace-local svvy
  workflow source layouts

The separate svvy-specific Smithers guidance files are:

```text
instructions/full/020-smithers-handler.md
instructions/full/030-smithers-svvy-boundary.md
```

Those hand-authored files must stay small and positive. They should say only:

- work in the workspace `.smithers/` package
- use official `bunx smithers-orchestrator ...` commands through Shell for workflow
  initialization, execution, resume, inspection, approval, and debugging
- use `svvyx workflows ...` only for reusable source-library operations owned by the Workflows
  extension
- import reusable svvy workflow assets from generated `@svvyx/workflows` package exports
- keep workspace-local Smithers `.smithers/agents/**` config separate from reusable svvy task-agent
  parameters in generated `@svvyx/workflows` `Agents.*` exports
- treat runtime task-agent handoff as the narrow generated `runTaskAgent` bridge only, with
  `@svvy/runtime` owning authentication, queueing, task-attempt lifecycle, and execution inside the
  app-owned Effect `ManagedRuntime`
- omit `workflow.*`, `svvyx smithers`, Smithers runtime-control APIs, loopback runtime-control
  tools, broad bridge helpers, package-level runtime creation, and per-request Effect layer graphs

It covers only the current Smithers boundary and omits Smithers runtime-control APIs or broad bridge
tools, product UI surfaces, and non-current workspace source paths.

## Memory Fragment

The Smithers memory fragment is generated but bypassed by default:

```json
{
  "instructionFiles": [
    {
      "file": "040-smithers-memory.generated.md",
      "bypassed": true
    }
  ]
}
```

Memory is not part of the default shipped Smithers prompt. A user or an agent with Extension
Managing access may enable it by changing the instruction file bypass state through normal
Extension Managing commands.

## Smithers Product Boundary

Smithers is prompt-only official CLI guidance for handler-thread workflow work. The Smithers product
boundary is workspace `.smithers/` authoring, official `bunx smithers-orchestrator ...` commands
through Shell, and no native or `svvyx` Smithers runtime surface.
Smithers task agents created with `Agents.defineTaskAgent(...)` use the narrow authenticated
`runTaskAgent` bridge whose core contract is owned by `@svvy/core` and whose server-side transport,
auth, idempotency, queueing, and pi-backed task-agent lifecycle are owned by `@svvy/runtime`.
`docs/specs/workflow-library.spec.md` mirrors the author-facing workflow semantics only. Smithers
workflow code running inside a handler-thread command-scoped environment can use generated
`@svvyx/workflows` task-agent helpers; those helpers issue the narrow authenticated `runTaskAgent`
handoff to runtime-owned bridge plumbing. Bridge contract types live in `@svvy/core`; generated
`@svvyx/workflows` is the generated authoring import package for workspace `.smithers`
TypeScript/TSX source. `@svvyx/extensions` provides generated workflow-task-safe extension reference
values where import policy allows. Persistent app-global Workflows source under
`~/.config/svvy/workflows/**` must not import `@svvyx/workflows`; it may import `@svvyx/extensions`
only where the generated-package import policy allows extension reference values. Both generated
packages are read-only authoring outputs, not public `@svvy/*` packages, reusable SDKs, runtime
facades, or `execute_typescript` facades. The generated `runTaskAgent` bridge call is narrow
internal plumbing and exposes no Smithers runtime-control APIs.
`@svvy/runtime` owns the authenticated endpoint, token verification, queueing, task-attempt
lifecycle, task-agent execution handoff, generated-package refresh scheduling, and workspace-link
repair coordination/recovery; `@svvy/pi-adapter` owns pi session creation and turn delivery;
`@svvy/sandbox` owns immutable sandbox policy snapshots and launch constraints; `@svvy/state` owns
persisted command, task-attempt, generated-package, and workspace-link facts; `@svvy/extensions`
owns generated package content/production and package-safe link plans. That bridge is not a
Smithers runtime-control surface and does not expose workflow graph, shell, settings, orchestrator,
or handler controls.
The Smithers product boundary excludes:

- Smithers as a builtin native-tool extension
- Smithers as an Incur-backed `svvyx smithers` extension
- a broad `svvy`-owned Smithers workflow/runtime bridge
- a product abstraction over Smithers execution
- generated Smithers observability, events, DevTools, Gateway, MCP, or OpenTelemetry instructions as
  default `svvy` product behavior
- workspace-local svvy workflow source as Smithers source
- repo-root `workflows/` as the shipped product runtime
- global `smithers` as the agent-facing product contract
- relying on a global CLI install for workflow TypeScript imports instead of `.smithers/package.json`
