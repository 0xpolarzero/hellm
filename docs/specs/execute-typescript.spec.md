# `execute_typescript` / Code Mode Spec

## Status

- Date: 2026-04-16
- Status: adopted architecture direction for the generic execution tool
- Scope of this document:
  - define the role of `execute_typescript` in the product
  - specify the tool contract and capability model
  - define its relationship to native control tools
  - define what is intentionally not part of the first implementation

## Purpose

`svvy` needs one consistent generic work surface for ordinary typed capability use.

The adopted answer is `execute_typescript`.

It is the product's generic execution tool for deterministic typed capability composition.

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
- the product's deterministic program-runner for generic capability composition

## Adopted Decisions

The adopted `svvy` direction is:

- one top-level tool named `execute_typescript`
- TypeScript code as the input payload
- a typed `api.*` SDK injected by the runtime
- day-one namespaces for `api.repo.*`, `api.git.*`, `api.exec.run`, `api.artifact.*`, and `api.web.*`
- first-implementation focus on the stable tool contract, typed SDK, compile/typecheck gating, and file-backed artifacts
- every attempted snippet is persisted as a file-backed artifact before execution starts, including failures
- artifact files are indexed by SQLite metadata and path records
- compile/typecheck happens before execution, and structured diagnostics are returned when static checks fail
- availability both to the orchestrator and to delegated Smithers work when generic composition is the right execution unit
- workflow, verification, and waiting remain explicit native control tools above the SDK surface
- hooks may call `execute_typescript` when generic capability composition is the right unit of work

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
type StructuredDiagnostic = {
  severity: "error" | "warning";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  code?: string;
};

type ExecuteTypescriptResult = {
  success: boolean;
  result?: unknown;
  logs?: string[];
  error?: {
    message: string;
    name?: string;
    stage?: "compile" | "typecheck" | "runtime";
    diagnostics?: StructuredDiagnostic[];
    line?: number;
  };
};
```

The top-level `success`, `result`, `logs`, and `error` contract stays stable. Static failures should surface structured diagnostics before any runtime execution begins.

## Capability Model

### Adopted Surface

Inside `execute_typescript`, capabilities should be injected as a typed `api` object.

The shape should look like:

```ts
await api.repo.readFile({ path: "docs/prd.md" });
await api.repo.searchText({ pattern: "workflow.start" });
await api.git.status({});
await api.web.search({ query: "smithers orchestration patterns" });
await api.artifact.writeText({ name: "summary.md", text: "..." });
await api.exec.run({ command: "bun", args: ["test"], cwd: "." });
```

The exact namespaces may evolve, but the model should stay namespaced and typed.

### Day-One API Shape

The day-one host SDK should be explicit enough that the agent can rely on it without guessing.

The initial shape should be function-first, namespace-based, and generic where that materially improves correctness:

```ts
type SvvyApi = {
  repo: {
    readFile(input: { path: string }): Promise<{ path: string; text: string }>;
    readJson<T>(input: { path: string }): Promise<{ path: string; value: T }>;
    writeFile(input: {
      path: string;
      text: string;
      createDirectories?: boolean;
    }): Promise<{ path: string; bytes: number }>;
    writeJson<T>(input: {
      path: string;
      value: T;
      pretty?: boolean;
      createDirectories?: boolean;
    }): Promise<{ path: string; bytes: number }>;
    deleteFile(input: { path: string }): Promise<{ path: string; deleted: boolean }>;
    listFiles(input?: { glob?: string }): Promise<{ paths: string[] }>;
    searchText(input: {
      pattern: string;
      glob?: string;
      maxResults?: number;
    }): Promise<{
      matches: Array<{ path: string; line: number; text: string }>;
    }>;
    stat(input: { path: string }): Promise<{
      exists: boolean;
      isFile: boolean;
      isDirectory: boolean;
    }>;
  };

  git: {
    status(input?: {}): Promise<{
      branch?: string;
      files: Array<{
        path: string;
        change: "added" | "modified" | "deleted" | "renamed";
        previousPath?: string;
      }>;
    }>;
    diff(input?: { paths?: string[]; cached?: boolean }): Promise<{ text: string }>;
    changedFiles(input?: { paths?: string[] }): Promise<{
      files: Array<{
        path: string;
        change: "added" | "modified" | "deleted" | "renamed";
        previousPath?: string;
      }>;
    }>;
    currentBranch(input?: {}): Promise<{ branch?: string }>;
    recentCommits(input?: { limit?: number }): Promise<{
      commits: Array<{ sha: string; subject: string; author?: string; authoredAt?: string }>;
    }>;
    showCommit(input: { sha: string }): Promise<{
      sha: string;
      subject: string;
      body?: string;
      diff?: string;
    }>;
    readFileAtRef(input: { path: string; ref: string }): Promise<{
      path: string;
      ref: string;
      text: string;
    }>;
    mergeBase(input: { baseRef: string; headRef: string }): Promise<{ sha?: string }>;
  };

  exec: {
    run(input: {
      command: string;
      args?: string[];
      cwd?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    }): Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>;
  };

  artifact: {
    writeText(input: { name: string; text: string }): Promise<{
      artifactId: string;
      path: string;
    }>;
    writeJson<T>(input: { name: string; value: T; pretty?: boolean }): Promise<{
      artifactId: string;
      path: string;
    }>;
    attachFile(input: { path: string; name?: string }): Promise<{
      artifactId: string;
      path: string;
    }>;
  };

  web: {
    search(input: { query: string; maxResults?: number }): Promise<{
      results: Array<{ title: string; url: string; snippet: string }>;
    }>;
    fetchText(input: { url: string }): Promise<{ url: string; text: string }>;
  };
};
```

This should be treated as the concrete day-one inventory unless a later design pass changes it intentionally.

### API Rules

The host SDK should follow these rules:

- one injected object named `api`
- function-first namespaces, not class-based clients
- generics where they improve type certainty, especially JSON reads and writes
- process execution exposed through `api.exec.run`
- product-level control flow kept in top-level tools such as `workflow.start`, `workflow.resume`, `verification.run`, and `wait`
- SDK capabilities provided through the typed runtime surface rather than ambient language or runtime globals

If the API grows later, it should still preserve the same model:

- one top-level `execute_typescript` tool
- one injected `api.*` SDK
- native control tools kept separate from ordinary capability calls

### Generic Capability Categories

The first capability categories should cover ordinary generic work:

- repository and filesystem reads and writes
- text search and tree inspection
- git inspection
- web lookups
- artifact creation
- explicit bounded process execution through `api.exec.run`

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

`workflow.start`, `workflow.resume`, `verification.run`, and `wait` do not belong inside `api.*`.

Keeping them explicit preserves a clean mental model:

- `execute_typescript` composes generic capability calls
- native control tools change top-level runtime state

## Execution Flow

The runtime flow for one `execute_typescript` call should be:

1. create a parent command for `execute_typescript`
2. persist the exact submitted TypeScript snippet as a file-backed artifact before execution starts
3. write SQLite artifact metadata and path indexes for that snippet
4. prepare the injected `api.*` surface and TypeScript helper context
5. compile and typecheck the submitted code
6. if static diagnostics fail, return them without running the program
7. otherwise execute the provided TypeScript program
8. record each nested API call as a child command
9. return `{ success, result, logs, error }`
10. write lifecycle events and update structured state

The important behavior is:

- the parent `execute_typescript` call is one command
- each nested capability call is also a command
- nested calls usually use `visibility = "trace"` unless promoted deliberately
- failed attempts still keep the exact submitted snippet as a durable artifact

## Command And Artifact Requirements

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
- `exec.run`

These child commands should normally use:

- `executor = "execute_typescript"`
- `visibility = "trace"` for low-level reads
- `visibility = "summary"` when the nested call creates a durable user-meaningful output such as an artifact

### Logs And Errors

Console output, structured diagnostics, and runtime failures should be captured into:

- command summaries
- events
- artifacts when the output is worth retaining
- episodes when the work is meaningful and concluded

### Source Snippet Capture

Every attempted `execute_typescript` invocation should persist the exact submitted TypeScript snippet as a file-backed artifact in the dedicated workspace artifact directory.

This includes:

- successful executions
- typecheck or validation failures before execution
- runtime failures after execution starts

The reason is product clarity:

- the UI must be able to show the exact code that was attempted
- retries and debugging should refer to durable stored source rather than reconstructed transcript text
- delegated and ordinary execution should follow the same inspection model

That snippet artifact should be created before execution begins so failed runs still retain their submitted code.

## Prompting And Type Exposure

The prompt and type-exposure layer should do three things:

1. explain when to use `execute_typescript`
2. document the available `api.*` namespaces
3. provide generated TypeScript signatures or stubs for the injected capabilities

The goal is not to dump every capability detail into the prompt blindly.

The goal is to expose enough typed structure that the model can write short correct programs reliably.

## SDK Shape

The injected host surface should stay function-first and namespace-based.

Prefer:

- `api.repo.readFile(...)`
- `api.git.status(...)`
- `api.exec.run(...)`

Do not introduce class-based clients such as `new GitClient().status()` unless the runtime later proves a real stateful seam is necessary.

## Artifact Storage Policy

All artifacts created through this surface should be file-backed in a dedicated workspace artifact directory.

The default layout should be:

- `.svvy/artifacts/<sessionId>/<artifactId>-<slug>`

The directory should be gitignored.

SQLite should store metadata and path indexes, not become the primary payload store for artifact bodies.

## Reasoning Boundary

`execute_typescript` runs deterministic code against the injected `api.*` SDK.

It is not a hidden nested model call.

That means:

- the active agent may use one `execute_typescript` call to inspect or gather data
- reason over that returned result in the normal agent loop
- then issue another `execute_typescript` call to write a summary artifact or make a change

Do not expect one `execute_typescript` program to semantically summarize arbitrary unseen text without the agent first observing the relevant inputs and making a separate model decision.

## What `execute_typescript` Should Be Used For

Use `execute_typescript` when the work is:

- composed of several generic capability calls
- easier to express as a short program than as a long tool-call transcript
- primarily about repository inspection, transformation, or data flow
- bounded enough that a script is the right unit of execution

Examples:

- read a set of docs files, extract targeted sections, and return a structured intermediate result
- search the repo for API usage, group findings, and return a compact result
- read a config file, transform it, and write a generated helper file
- write a summary artifact from data the agent already gathered in a previous step
- perform a web lookup plus repo inspection and combine the results

## What `execute_typescript` Should Not Be Used For

Do not use `execute_typescript` as a substitute for:

- starting or resuming a delegated workflow
- launching top-level verification work
- marking the session as waiting
- hiding control-flow changes inside `api.*`

Those are native control-tool or runtime concerns.

## Delegated Workflow Usage

The same `execute_typescript` primitive should be available inside delegated Smithers work when generic typed capability composition is useful there too.

That means:

- workflow steps may call `execute_typescript`
- hooks may call `execute_typescript`
- the capability model should stay the same
- the command model should still record parent and child commands
- workflow usage must not fork into a second inconsistent code-execution API

## First Implementation Focus

The first implementation should concentrate on:

- the stable `execute_typescript` input and output contract
- the typed day-one `api.*` inventory
- bounded process execution through `api.exec.run`
- compile/typecheck-before-run diagnostics
- file-backed artifact persistence and SQLite indexing
- reuse of the same primitive inside delegated Smithers work
- a later hardening path for execution isolation without changing the high-level tool contract

## Rollout Guidance

The rollout should be:

1. implement the stable `execute_typescript` input and output contract
2. implement a typed injected `api.*` surface for the first generic capability categories
3. record parent and child commands for every invocation
4. persist the submitted TypeScript snippet as a file-backed artifact before execution and index it in SQLite
5. compile and typecheck before runtime execution, returning structured diagnostics on failure
6. capture logs, errors, and meaningful outputs into artifacts and episodes
7. reuse the same primitive inside delegated Smithers work
8. treat sandboxing as later hardening work rather than as an architecture blocker

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Structured Session State Spec](./structured-session-state.spec.md)
