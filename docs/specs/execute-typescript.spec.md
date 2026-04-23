# `execute_typescript` / Code Mode Spec

## Status

- Date: 2026-04-16
- Status: adopted architecture direction for the generic execution tool
- Scope of this document:
  - define the role of `execute_typescript` in the product
  - specify the stable tool contract and runtime flow
  - define the day-one `api.*` surface
  - define which child-command facts are stored and how they surface in the UI

## Purpose

`svvy` needs one consistent generic work surface for bounded repository work.

The adopted answer is `execute_typescript`.

It is the product's deterministic TypeScript runner for composing observable host capabilities through a typed `api.*` surface.

## Product Fit

The PRD defines one shared execution model:

```text
tool call -> command -> handler -> events -> structured state -> UI
```

Inside that model:

- `execute_typescript` is the default generic work surface
- `thread.start`, `thread.handoff`, and `wait` remain `svvy`-native top-level control tools
- workflow supervision stays on Smithers-native bridge tools rather than `api.exec.run` or a svvy-defined `workflow.*` wrapper

`execute_typescript` is therefore:

- a top-level tool
- the default way to perform ordinary generic work
- the parent semantic unit for bounded scripted capability composition

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

The top-level `{ success, result, logs, error }` contract stays stable.

The submitted snippet artifact is durable product state, not a required tool return field.

## Prompt Contract

The model must see the real `execute_typescript` SDK contract before it writes a snippet.

Adopted rules:

- the source of truth for the SDK shape is one documented TypeScript contract module in the repo
- build and dev flows generate one declaration-text module from that source-of-truth contract so prompt injection and static checking use the same shape
- the generated declaration text keeps relevant JSDoc so usage rules survive into the embedded contract
- the runtime uses that generated declaration text for `execute_typescript` static checking
- the active surface system prompt embeds only the generated declaration blocks relevant to that surface's callable tools
- orchestrator and handler-thread prompts may share the `execute_typescript` declaration when both surfaces can call it, but other tool declarations must still be sliced by actor

Actor-specific capability slicing still applies:

- the orchestrator prompt should not receive handler-only Smithers declarations just because both actors may use `execute_typescript`
- a handler-thread prompt should not receive orchestrator-only declarations such as `thread.start` just because both actors are backed by pi sessions
- a workflow-task-agent prompt may receive the `execute_typescript` declaration as its primary task-local tool schema without receiving any handler-thread or orchestrator control declarations or ambient pi extension tools that widen the callable surface

This is required because short prose summaries are not sufficient for a typed host SDK with namespace methods, subtle argument shapes, and important constraints such as:

- use the injected `api` object instead of Node.js built-ins
- use `api.exec.run({ command, args, cwd, timeoutMs, env })`
- pass the executable in `command` and argv tokens separately in `args`

## Execution Boundary

Use `execute_typescript` for bounded generic work such as:

- reading files
- reading several files and reducing them into structured output
- repo search and tree inspection
- git inspection and small git mutations
- artifact creation
- bounded process execution through `api.exec.run`
- web lookups
- pure in-memory TypeScript control flow, parsing, filtering, grouping, and formatting between `api.*` calls

Do not use `execute_typescript` to replace top-level control-flow tools:

- `thread.start`
- `thread.handoff`
- `wait`
- Smithers-native workflow tools such as generated `smithers.run_workflow.<workflow_id>` launch tools, `smithers.resolve_approval`, or `smithers.runs.cancel`

Those actions change product-owned execution state and stay outside the generic TypeScript runner.

## Observable Capability Boundary

Inside `execute_typescript`, `api.*` is the product's observable capability surface.

That means:

- workspace reads and writes should go through `api.repo.*`
- git work should go through `api.git.*`
- process execution should go through `api.exec.run`
- artifact creation should go through `api.artifact.*`
- web access should go through `api.web.*`

Pure TypeScript inside the snippet remains available for local computation.

The runtime and prompt contract must make clear that ordinary JavaScript language features are available inside the snippet, but Node.js modules and globals are not part of the injected environment. The intended path is `api.*`, not ad hoc `fs`, `path`, `process`, or `node:*` imports.

The product does not try to decompose arbitrary in-memory code into separate durable facts.

The product does record `api.*` calls because they are the semantic boundary where repo, git, web, artifact, and subprocess activity becomes observable and worth surfacing.

This is an observability rule, not a permission claim.

## Mandatory Runtime Flow

The runtime flow for one `execute_typescript` call is:

1. create one parent command for `execute_typescript`
2. persist the exact submitted TypeScript snippet as a file-backed artifact before execution starts
3. write SQLite artifact metadata and path indexes for that snippet
4. prepare the injected typed `api.*` surface and helper context
5. compile or typecheck the submitted code
6. if static diagnostics fail, return them without executing the program
7. otherwise execute the program
8. record every nested `api.*` call as a child command
9. capture logs, structured errors, and durable outputs
10. synthesize parent summary facts and update structured state
11. return `{ success, result, logs, error }`

The important guarantees are:

- the parent `execute_typescript` call is one command
- every attempted run persists its exact submitted source
- invalid code never executes
- nested `api.*` calls are durable trace facts
- the parent command remains the main semantic unit
- the tool writes command summaries, trace facts, and artifacts, but does not emit episodes itself
- delegated verification should be expressed through saved workflow definitions or short-lived artifact workflows

## Why Child Commands Exist

The snippet artifact answers:

- what code was submitted

Child commands answer:

- what happened when that code ran

The stored snippet is necessary but not sufficient for inspection or recovery.

The UI and selectors need durable facts such as:

- which files were read
- which files were written or deleted
- which git command ran
- whether a commit or push happened
- which subprocess failed
- which artifacts were created

Those facts should not require transcript replay or speculative re-execution of the saved snippet.

## Day-One `api.*` Surface

The day-one SDK should be typed, namespace-based, and close to the underlying concepts.

Rules:

- all repo paths are workspace-relative unless stated otherwise
- singular helpers stay for one-path operations, and plural helpers batch several known paths
- camelCase is used when JavaScript identifiers cannot match the underlying command spelling exactly
- the runtime injects one object named `api`
- the runtime exposes the same surface to the orchestrator, handler threads, and workflow tasks that are allowed to use `execute_typescript`
- that shared `execute_typescript` surface does not imply that every actor receives every non-`execute_typescript` tool declaration in the same prompt block

### Representative Usage

```ts
const docs = await api.repo.readFiles({
  paths: ["docs/prd.md", "docs/features.ts"],
});

const matches = await api.repo.grep({
  pattern: "execute_typescript",
  glob: "docs/**/*.md",
});

const status = await api.git.status({});

await api.artifact.writeText({
  name: "summary.md",
  text: JSON.stringify({ docs, matches, status }, null, 2),
});

await api.exec.run({
  command: "bun",
  args: ["test", "src/bun/execute-typescript-tool.test.ts"],
});
```

### Type Shape

```ts
type RepoTextFile = {
  path: string;
  text: string;
};

type RepoStat = {
  path: string;
  exists: boolean;
  kind: "file" | "directory" | "missing";
  sizeBytes?: number;
};

type RepoWriteResult = {
  path: string;
  bytes: number;
};

type RepoGrepMatch = {
  path: string;
  line: number;
  text: string;
};

type GitFileChange = {
  path: string;
  change: "added" | "modified" | "deleted" | "renamed" | "untracked";
  previousPath?: string;
};

type GitCommitSummary = {
  sha: string;
  subject: string;
  author?: string;
  authoredAt?: string;
};

type GitCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ArtifactWriteResult = {
  artifactId: string;
  path: string;
};

type SvvyApi = {
  repo: {
    readFile(input: { path: string }): Promise<RepoTextFile>;
    readFiles(input: { paths: string[] }): Promise<{ files: RepoTextFile[] }>;
    readJson<T>(input: { path: string }): Promise<{ path: string; value: T }>;
    writeFile(input: {
      path: string;
      text: string;
      createDirectories?: boolean;
    }): Promise<RepoWriteResult>;
    writeJson<T>(input: {
      path: string;
      value: T;
      pretty?: boolean;
      createDirectories?: boolean;
    }): Promise<RepoWriteResult>;
    unlink(input: { path: string }): Promise<{ path: string; deleted: boolean }>;
    stat(input: { path: string }): Promise<RepoStat>;
    glob(input: {
      pattern: string;
      cwd?: string;
      includeDirectories?: boolean;
      maxResults?: number;
    }): Promise<{ paths: string[] }>;
    grep(input: {
      pattern: string;
      glob?: string;
      maxResults?: number;
      caseSensitive?: boolean;
      regex?: boolean;
    }): Promise<{ matches: RepoGrepMatch[] }>;
  };

  git: {
    status(input?: { paths?: string[] }): Promise<{
      branch?: string;
      files: GitFileChange[];
      ahead?: number;
      behind?: number;
    }>;
    diff(input?: {
      paths?: string[];
      cached?: boolean;
      baseRef?: string;
      headRef?: string;
    }): Promise<{ text: string }>;
    log(input?: { ref?: string; limit?: number }): Promise<{ commits: GitCommitSummary[] }>;
    show(input: { ref: string; path?: string }): Promise<{ text: string }>;
    branch(input?: { all?: boolean; verbose?: boolean }): Promise<{
      current?: string;
      branches: Array<{
        name: string;
        current: boolean;
        upstream?: string;
      }>;
    }>;
    mergeBase(input: { baseRef: string; headRef: string }): Promise<{ sha?: string }>;
    fetch(input?: {
      remote?: string;
      refspecs?: string[];
      prune?: boolean;
    }): Promise<GitCommandResult>;
    pull(input?: { remote?: string; branch?: string; rebase?: boolean }): Promise<GitCommandResult>;
    push(input?: {
      remote?: string;
      branch?: string;
      setUpstream?: boolean;
      forceWithLease?: boolean;
      tags?: boolean;
    }): Promise<GitCommandResult>;
    add(input: { paths?: string[]; all?: boolean; update?: boolean }): Promise<GitCommandResult>;
    commit(input: {
      message: string;
      all?: boolean;
      allowEmpty?: boolean;
      amend?: boolean;
    }): Promise<GitCommandResult & { sha?: string }>;
    switch(input: {
      branch: string;
      create?: boolean;
      startPoint?: string;
    }): Promise<GitCommandResult>;
    checkout(input: {
      ref?: string;
      paths?: string[];
      createBranch?: string;
    }): Promise<GitCommandResult>;
    restore(input: {
      paths: string[];
      source?: string;
      staged?: boolean;
      worktree?: boolean;
    }): Promise<GitCommandResult>;
    rebase(input: {
      upstream?: string;
      branch?: string;
      continue?: boolean;
      abort?: boolean;
    }): Promise<GitCommandResult>;
    cherryPick(input: {
      commits?: string[];
      continue?: boolean;
      abort?: boolean;
      noCommit?: boolean;
    }): Promise<GitCommandResult>;
    stash(input?: {
      subcommand?: "push" | "pop" | "apply" | "drop" | "list" | "show";
      stash?: string;
      message?: string;
      includeUntracked?: boolean;
    }): Promise<GitCommandResult>;
    tag(input?: {
      name?: string;
      target?: string;
      annotate?: boolean;
      message?: string;
      delete?: boolean;
      list?: boolean;
      pattern?: string;
    }): Promise<GitCommandResult>;
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
    writeText(input: { name: string; text: string }): Promise<ArtifactWriteResult>;
    writeJson<T>(input: { name: string; value: T; pretty?: boolean }): Promise<ArtifactWriteResult>;
    attachFile(input: { path: string; name?: string }): Promise<ArtifactWriteResult>;
  };

  web: {
    search(input: { query: string; maxResults?: number }): Promise<{
      results: Array<{ title: string; url: string; snippet: string }>;
    }>;
    fetchText(input: { url: string }): Promise<{ url: string; text: string }>;
  };
};
```

When `api.repo.writeFile(...)` or `api.repo.writeJson(...)` writes under `.svvy/workflows/...`, the host should automatically validate the current saved workflow library state.

That validation feedback belongs in the returned `execute_typescript` result through captured console logs, not in a separate workflow-save tool surface.

## Command Model

Each top-level `execute_typescript` invocation creates one parent command with:

- `toolName = "execute_typescript"`
- `executor = "orchestrator"` or the supervising handler-thread equivalent
- `visibility = "summary"` or `surface` when the parent run itself is a primary user-facing action

Each nested `api.*` call creates one child command with:

- `parentCommandId` pointing at the parent `execute_typescript` command
- `executor = "execute_typescript"`
- `toolName` matching the namespace and method, such as `repo.readFile` or `git.commit`
- normalized facts describing what happened

Day-one child commands should use only:

- `trace`
- `summary`

Day-one child commands should not use `surface`.

The parent command is the surfaced or summarized unit.

## Observable Facts And Default UI Surfacing

Every child command is durable and visible in nested trace inspection.

The tables below describe what is additionally surfaced by default beyond trace.

The runtime should store normalized facts, not full raw payloads, on child commands.

Large raw payloads such as file contents, diffs, fetched text, or full stdout and stderr are not promoted into child-command facts by default. This rule applies to child-command outputs, not to the submitted snippet itself, which is always stored as a file-backed artifact.

If a large payload matters beyond immediate execution, the runtime or the agent should retain it as an artifact.

### `api.repo.*`

| Method           | Durable child-command facts                   | Extra default surfacing beyond trace |
| ---------------- | --------------------------------------------- | ------------------------------------ |
| `repo.readFile`  | `path`, `bytesRead`                           | Parent rollup only.                  |
| `repo.readFiles` | `paths`, `fileCount`, `totalBytesRead`        | Parent rollup only.                  |
| `repo.readJson`  | `path`                                        | Parent rollup only.                  |
| `repo.writeFile` | `path`, `bytesWritten`                        | Parent summary-visible write.        |
| `repo.writeJson` | `path`, `bytesWritten`                        | Parent summary-visible write.        |
| `repo.unlink`    | `path`, `deleted`                             | Parent summary-visible write.        |
| `repo.stat`      | `path`, `exists`, `kind`, `sizeBytes?`        | Trace only unless it fails.          |
| `repo.glob`      | `pattern`, `resultCount`, `cwd?`              | Parent rollup only.                  |
| `repo.grep`      | `pattern`, `glob?`, `matchCount`, `pathCount` | Parent rollup only.                  |

### `api.git.*`

| Method           | Durable child-command facts                                   | Extra default surfacing beyond trace                                                                 |
| ---------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `git.status`     | `branch`, `changedFileCount`, `ahead`, `behind`               | Parent rollup only.                                                                                  |
| `git.diff`       | `paths?`, `cached`, `baseRef?`, `headRef?`, `diffBytes`       | Parent rollup only.                                                                                  |
| `git.log`        | `ref?`, `limit`, `commitCount`                                | Parent rollup only.                                                                                  |
| `git.show`       | `ref`, `path?`, `bytesRead`                                   | Parent rollup only.                                                                                  |
| `git.branch`     | `current`, `branchCount`                                      | Parent rollup only.                                                                                  |
| `git.mergeBase`  | `baseRef`, `headRef`, `sha?`                                  | Parent rollup only.                                                                                  |
| `git.fetch`      | `remote?`, `refspecCount`, `prune`                            | Parent summary-visible sync action and failure.                                                      |
| `git.pull`       | `remote?`, `branch?`, `rebase`                                | Parent summary-visible sync action and failure.                                                      |
| `git.push`       | `remote?`, `branch?`, `setUpstream`, `forceWithLease`, `tags` | Parent summary-visible sync action and failure.                                                      |
| `git.add`        | `paths?`, `all`, `update`                                     | Parent summary-visible write.                                                                        |
| `git.commit`     | `messageSummary`, `sha?`, `all`, `allowEmpty`, `amend`        | Parent summary-visible write.                                                                        |
| `git.switch`     | `branch`, `create`, `startPoint?`                             | Parent summary-visible branch change.                                                                |
| `git.checkout`   | `ref?`, `paths?`, `createBranch?`                             | Parent summary-visible branch or file restore action.                                                |
| `git.restore`    | `paths`, `source?`, `staged`, `worktree`                      | Parent summary-visible write.                                                                        |
| `git.rebase`     | `upstream?`, `branch?`, `mode`                                | Parent summary-visible action and failure.                                                           |
| `git.cherryPick` | `commitCount`, `noCommit`, `mode`                             | Parent summary-visible action and failure.                                                           |
| `git.stash`      | `subcommand`, `stash?`, `message?`                            | `list` and `show` contribute to parent rollup only; mutating subcommands are parent summary-visible. |
| `git.tag`        | `name?`, `target?`, `annotate`, `delete`, `list`, `pattern?`  | `list` contributes to parent rollup only; create or delete actions are parent summary-visible.       |

### `api.exec.run`

| Method     | Durable child-command facts                                                      | Extra default surfacing beyond trace                                                                     |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `exec.run` | `command`, `args`, `cwd`, `timeoutMs?`, `exitCode`, `stdoutBytes`, `stderrBytes` | Parent rollup on success. Parent summary-visible on non-zero exit, timeout, or retained output artifact. |

### `api.artifact.*`

| Method                | Durable child-command facts                  | Extra default surfacing beyond trace                     |
| --------------------- | -------------------------------------------- | -------------------------------------------------------- |
| `artifact.writeText`  | `artifactId`, `name`, `path`, `bytesWritten` | Parent summary-visible plus first-class artifact record. |
| `artifact.writeJson`  | `artifactId`, `name`, `path`, `bytesWritten` | Parent summary-visible plus first-class artifact record. |
| `artifact.attachFile` | `artifactId`, `name`, `path`                 | Parent summary-visible plus first-class artifact record. |

### `api.web.*`

| Method          | Durable child-command facts | Extra default surfacing beyond trace                        |
| --------------- | --------------------------- | ----------------------------------------------------------- |
| `web.search`    | `query`, `resultCount`      | Parent rollup only.                                         |
| `web.fetchText` | `url`, `bytesRead`          | Parent rollup only. Failures become parent summary-visible. |

### Parent Rollups

The parent `execute_typescript` command should synthesize compact rollups from child facts such as:

- `Read 3 files`
- `Searched 18 files and found 4 matches`
- `Wrote 2 files`
- `Created 1 artifact`
- `Ran 1 subprocess`
- `Git: branch main, 5 changed files`
- `Git: committed abc123 and pushed origin/main`

The parent is the summary and inspection entry point.

Child commands stay nested by default and do not become separate top-level session or sidebar objects.

## Artifact And Diagnostics Rules

### Submitted Snippet Artifact

Every attempted `execute_typescript` invocation must persist the exact submitted TypeScript snippet as a file-backed artifact in the dedicated workspace artifact directory.

This includes:

- successful executions
- compile or typecheck failures
- runtime failures

The default layout is:

- `.svvy/artifacts/<sessionId>/<artifactId>-<slug>`

SQLite stores metadata and path indexes for lookup.

The session transcript UI must also expose that exact submitted body for each `execute_typescript` attempt so users can inspect retries and diagnostics without leaving the session view.

### Diagnostics

Compile and typecheck failures must:

- be returned as structured diagnostics in `error.diagnostics`
- be stored as durable command facts
- block runtime execution

### Output Artifacts

The runtime may retain additional artifacts for:

- large stdout or stderr payloads
- generated summaries
- exported reports
- durable logs
- retained fetched or derived outputs

The rule is:

- normalized facts stay on the child command
- durable large payloads go to artifacts

## Agent-Facing Guidance

The prompt and type-exposure layer should make these rules explicit:

1. use `execute_typescript` for bounded generic work
2. use `api.*` for all observable external work
3. use pure TypeScript for local data shaping between `api.*` calls
4. use native control tools for workflow, verification, and waiting
5. write an artifact when a large payload or durable output matters beyond immediate execution

The runtime should expose generated TypeScript declarations or equivalent JSDoc for the injected `api` object so the model can discover the real surface instead of guessing.

## Delegated Usage

The same `execute_typescript` primitive should be available inside delegated Smithers work when generic typed capability composition is the right unit of work.

That means:

- workflow steps may call `execute_typescript`
- the `api.*` surface stays the same
- the parent and child command model stays the same
- snippet artifacts, child command facts, and parent rollups stay the same
- when a workflow task agent calls `execute_typescript`, the execution root is the current Smithers task root or worktree, not the workspace runtime DB root

The default adopted workflow-task-agent profile should expose `execute_typescript` as its task-local tool surface and should not expose `thread.start`, `thread.handoff`, `wait`, or `smithers.*`.

## First Implementation Focus

The first implementation should concentrate on:

- the stable input and output contract
- compile or typecheck before execution
- snippet artifact persistence and SQLite indexing
- the day-one typed `api.*` surface
- parent and child command recording
- normalized child-command facts and parent rollups
- artifact retention for logs and durable outputs when needed
- reuse of the same primitive inside delegated Smithers work

Later hardening such as stricter sandboxing may change how the runtime is isolated, but it should not change the top-level tool contract or the parent-first observability model.

## Sources

### Local Sources

- [PRD](../prd.md)
- [Structured Session State Spec](./structured-session-state.spec.md)
