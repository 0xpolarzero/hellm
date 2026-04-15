# `execute_typescript` / Code Mode Spec

## Status

- Date: 2026-04-15
- Status: adopted architecture direction for the generic execution tool
- Scope of this document:
  - define the role of `execute_typescript` in the product
  - specify the tool contract and capability model
  - define its relationship to native control tools
  - define what is intentionally not part of the first implementation

## Purpose

`svvy` needs one consistent generic work surface for ordinary tool use.

The adopted answer is `execute_typescript`.

The point is not to create a second agent shell or a fifth product mode.

The point is to let the orchestrator and delegated workers express bounded generic work as a short typed TypeScript program when that is clearer and more reliable than many low-level tool round trips.

## Product Fit

The PRD defines one shared execution model:

```text
tool call -> command -> handler -> events -> structured state -> UI
```

Inside that model:

- `execute_typescript` is the default generic work surface
- `workflow.start`, `workflow.resume`, `verification.run`, and `wait` remain native control tools

`execute_typescript` is therefore:

- a top-level tool
- the default way to perform ordinary generic work
- not a separate product path
- not a hidden unrestricted shell

## Adopted Decisions

The adopted `svvy` direction is:

- one top-level tool named `execute_typescript`
- TypeScript code as the input payload
- a typed `tools.*` object injected by the runtime
- no `external_*` naming in the target architecture
- no product-visible sandbox model in the first implementation
- no arbitrary raw shell access from inside `execute_typescript`
- availability both to the orchestrator and to delegated Smithers work when generic composition is the right execution unit
- explicit separation between generic capabilities and native control tools

Nothing below should be read as leaving those points open.

## Tool Contract

### Tool Name

The tool is named `execute_typescript`.

### Input

The adopted input shape is:

```ts
type ExecuteTypescriptInput = {
  typescriptCode: string;
};
```

### Output

The adopted output shape is:

```ts
type ExecuteTypescriptResult = {
  success: boolean;
  result?: unknown;
  logs?: string[];
  error?: {
    message: string;
    name?: string;
    line?: number;
  };
};
```

The exact error payload may gain detail later. The top-level success, result, logs, and error contract should stay stable.

## Capability Model

### Adopted Surface

Inside `execute_typescript`, capabilities should be injected as a typed `tools` object.

The shape should look like:

```ts
await tools.repo.readFile({ path: "docs/prd.md" });
await tools.repo.searchText({ pattern: "workflow.start" });
await tools.git.status({});
await tools.web.search({ query: "smithers orchestration patterns" });
await tools.artifact.writeText({ name: "summary.md", text: "..." });
```

The exact namespaces may evolve, but the model should stay namespaced and typed.

### Why `tools.*` Instead Of `external_*`

`external_*` creates avoidable conceptual noise:

- it exposes implementation flavor as product architecture
- it makes the capability list feel like glue code instead of a real API
- it is harder to read and harder to organize as the surface grows

The target product design should use domain namespaces such as:

- `tools.repo.*`
- `tools.git.*`
- `tools.web.*`
- `tools.artifact.*`

### Generic Capability Categories

The first capability categories should cover ordinary generic work:

- repository and filesystem reads and writes
- text search and tree inspection
- git inspection
- web lookups
- artifact creation

These are examples of likely functions, not a frozen exhaustive list.

## Native Control Tool Boundary

The adopted top-level tool surface is:

- `execute_typescript`
- `workflow.start`
- `workflow.resume`
- `verification.run`
- `wait`

The boundary is:

- ordinary generic work goes through `execute_typescript`
- product-level control-flow changes stay in native control tools

This means `workflow.start`, `workflow.resume`, `verification.run`, and `wait` should not be treated as ordinary namespaced helpers inside `tools.*` by default.

Keeping them explicit preserves a clean mental model:

- `execute_typescript` composes generic capability calls
- native control tools change top-level runtime state

## Execution Flow

The runtime flow for one `execute_typescript` call should be:

1. create a parent command for `execute_typescript`
2. prepare the injected `tools` surface and TypeScript helper context
3. execute the provided TypeScript program
4. record each nested capability call as a child command
5. return `{ success, result, logs, error }`
6. write lifecycle events and update structured state

The important behavior is:

- the parent `execute_typescript` call is one command
- each nested capability call is also a command
- nested calls usually use `visibility = "trace"` unless promoted deliberately

## Command And Event Requirements

`execute_typescript` must integrate with the structured command model defined in the structured-session-state spec.

### Parent Command

Each top-level `execute_typescript` invocation creates one parent command with:

- `toolName = "execute_typescript"`
- `executor = "orchestrator"` or the delegated worker's equivalent top-level executor
- `visibility = "summary"` or `surface` when the call itself is user-meaningful

### Child Commands

Each nested capability call creates a child command such as:

- `repo.readFile`
- `repo.searchText`
- `git.status`
- `web.search`
- `artifact.writeText`

These child commands should normally use:

- `executor = "execute_typescript"`
- `visibility = "trace"` for low-level reads
- `visibility = "summary"` when the nested call creates a durable user-meaningful output such as an artifact

### Logs And Errors

Console output and runtime failures should be captured into:

- command summaries
- events
- artifacts when the output is worth retaining
- episodes when the work is meaningful and concluded

## Prompting And Type Exposure

The prompt and type-exposure layer should do three things:

1. explain when to use `execute_typescript`
2. document the available `tools.*` namespaces
3. provide generated TypeScript signatures or stubs for the injected capabilities

The goal is not to dump every capability detail into the prompt blindly.

The goal is to expose enough typed structure that the model can write short correct programs reliably.

## Runtime Boundary

The first implementation should not over-index on sandbox machinery.

The adopted design is:

- the product contract is the `execute_typescript` tool plus typed `tools.*`
- the product does not expose sandbox controls in v1
- the first implementation may run unsandboxed in-process
- later sandboxing must preserve the same high-level tool contract

This keeps the architecture simple now while leaving room to harden execution later.

## Security And Safety Boundary

The first implementation is intentionally simple:

- no product-visible sandbox
- no approval objects
- no alternate unrestricted shell hidden inside code mode

Safety in this slice comes from:

- the curated `tools.*` capability surface
- explicit separation between generic capabilities and native control tools
- durable command recording
- normal product-level clarification and wait behavior when ambiguity matters

Sandboxing is a later concern and should not distort the first product model.

## What `execute_typescript` Should Be Used For

Use `execute_typescript` when the work is:

- composed of several generic capability calls
- easier to express as a short program than as a long tool-call transcript
- primarily about repository inspection, transformation, or data flow
- bounded enough that a script is the right unit of execution

Examples:

- read a set of docs files, extract key sections, and emit a structured summary artifact
- search the repo for API usage, group findings, and return a compact result
- read a config file, transform it, and write a generated helper file
- perform a web lookup plus repo inspection and combine the results

## What `execute_typescript` Should Not Be Used For

Do not use `execute_typescript` as a substitute for:

- starting or resuming a delegated workflow
- launching top-level verification work
- marking the session as waiting
- giving the model hidden unrestricted shell access

Those are native control-tool or runtime concerns.

## Delegated Workflow Usage

The same `execute_typescript` primitive should be available inside delegated Smithers work when generic typed capability composition is useful there too.

That means:

- workflow steps may call `execute_typescript`
- the capability model should stay the same
- the command model should still record parent and child commands
- workflow usage must not fork into a second inconsistent code-execution API

## Out Of Scope For The First Implementation

The first implementation intentionally does not include:

- `external_*` capability naming
- a product-visible sandbox model
- raw unrestricted shell access from inside `execute_typescript`
- using `execute_typescript` as a wrapper around workflow, verification, or wait control tools by default

## Rollout Guidance

The rollout should be:

1. implement the stable `execute_typescript` input and output contract
2. implement a typed injected `tools.*` surface for the first generic capability categories
3. record parent and child commands for every invocation
4. capture logs, errors, and meaningful outputs into artifacts and episodes
5. reuse the same primitive inside delegated Smithers work
6. treat sandboxing as later hardening work rather than as an architecture blocker

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Structured Session State Spec](./structured-session-state.spec.md)
