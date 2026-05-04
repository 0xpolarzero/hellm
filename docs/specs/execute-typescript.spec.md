# `execute_typescript` and Direct Tool Surface

## Product Contract

svvy exposes PI-backed direct tools as the normal coding-agent interface. The direct tools are the canonical surface for reading files, searching, editing, writing, running shell commands, creating artifacts, and discovering workflow assets.

`execute_typescript` is a composition tool. It receives a bounded TypeScript snippet, injects a small `api` object, typechecks the snippet against a generated declaration, runs it, and records each nested `api` call as a child command. Agents use it when TypeScript control flow is useful: batching, looping, filtering, aggregation, workflow discovery, bash-backed inspection, or artifact evidence.

Ordinary one-shot repository actions use direct tools. Code mode does not own general repository I/O.

## Direct Tools

### Coding Tools

svvy ships PI's coding tools directly, wrapped by svvy command recording:

| Tool | Purpose |
| --- | --- |
| `read` | Read one file with optional offset and line limit. |
| `grep` | Search file contents. |
| `find` | Find files by pattern. |
| `ls` | List directory entries. |
| `edit` | Apply targeted edits to an existing file. |
| `write` | Create or replace a file. |
| `bash` | Run a bounded shell command in the active workspace or task root. |

The wrapper keeps PI's input schemas and behavior as the source of truth. svvy adds durable command records, turn-decision projection, transcript visibility, and artifact links where applicable.

### Artifact Tools

Artifacts are first-class product state, so svvy provides artifact tools directly:

| Tool | Purpose |
| --- | --- |
| `artifact.write_text` | Persist a text artifact. |
| `artifact.write_json` | Persist a JSON artifact. |
| `artifact.attach_file` | Attach an existing file as artifact evidence. |

Artifacts are for durable byproducts and evidence: logs, reports, large outputs, benchmark data, screenshots, workflow exports, or retained generated files that should be inspectable without becoming normal requested repository state.

### Workflow Discovery Tools

Handlers and task agents discover reusable workflow assets through direct workflow tools:

| Tool | Purpose |
| --- | --- |
| `workflow.list_assets` | List saved or artifact workflow definitions, prompts, and components. |
| `workflow.list_models` | List provider/model options available for workflow task-agent authoring. |

Smithers runtime control remains on Smithers-native tools such as `smithers.list_workflows`, `smithers.run_workflow`, `smithers.get_run`, and workflow wait/control tools. Workflow discovery tools only expose source-library metadata and model inventory.

## Agent-Facing Tool Sets

### Orchestrator

The orchestrator receives direct coding tools, direct artifact tools, `execute_typescript`, and orchestration tools such as `thread.start` and `wait`. It uses direct tools for local bounded work and starts handler threads for larger owned work.

### Handler

Handler threads receive direct coding tools, direct artifact tools, direct workflow discovery tools, `execute_typescript`, `request_context`, `thread.handoff`, wait tools, and Smithers supervision tools. They can inspect, edit, author, run, and reconcile workflows without relying on code mode as the primary I/O mechanism.

### Workflow Task Agent

Workflow task agents receive task-local direct coding tools, direct artifact tools, and `execute_typescript`. Their working directory is the Smithers task root or assigned worktree. They do not receive handler/orchestrator control tools.

## `execute_typescript` Input

```ts
type ExecuteTypescriptInput = {
  typescriptCode: string;
};
```

The snippet body is wrapped as an async function:

```ts
export default async function __svvy(api: SvvyApi, console: SvvyConsole) {
  // user snippet
}
```

The snippet can `return` any JSON-serializable value or a small diagnostic object. The full submitted snippet is stored as an artifact for the attempt.

## Runtime Rules

- The snippet is typechecked before execution against the generated `SvvyApi` declaration.
- Node built-ins are not part of the snippet contract.
- The injected `api` object is the only host capability.
- The injected `console` captures small log lines into the result.
- Each nested `api` call creates a child command under the parent `execute_typescript` command.
- Direct tools remain the preferred path for one-shot reads, edits, writes, and commands.
- Code mode does not expose `edit` or `write`; file modification belongs to direct tools.

## Injected API

The source contract is generated from `src/bun/execute-typescript-api-contract.ts` into `generated/execute-typescript-api.generated.ts` and embedded in the system prompt.

```ts
interface SvvyConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

interface ToolResult<TDetails = unknown> {
  content: Array<TextContent | ImageContent>;
  details: TDetails;
}

interface SvvyApi {
  read(input: { path: string; offset?: number; limit?: number }): Promise<ToolResult>;
  grep(input: {
    pattern: string;
    path?: string;
    glob?: string;
    ignoreCase?: boolean;
    literal?: boolean;
    context?: number;
    limit?: number;
  }): Promise<ToolResult>;
  find(input: { pattern: string; path?: string; limit?: number }): Promise<ToolResult>;
  ls(input: { path?: string; limit?: number }): Promise<ToolResult>;
  bash(input: { command: string; timeout?: number }): Promise<ToolResult>;
  artifact: {
    write_text(input: { name: string; text: string }): Promise<ToolResult<ArtifactWriteResult>>;
    write_json(input: {
      name: string;
      value: unknown;
      pretty?: boolean;
    }): Promise<ToolResult<ArtifactWriteResult>>;
    attach_file(input: { path: string; name?: string }): Promise<ToolResult<ArtifactWriteResult>>;
  };
  workflow: {
    list_assets(input?: WorkflowListAssetsInput): Promise<ToolResult<WorkflowListAssetsDetails>>;
    list_models(): Promise<ToolResult<WorkflowListModelsDetails>>;
  };
}
```

The code-mode API duplicates these direct tools only:

| Code-mode function | Direct tool duplicated |
| --- | --- |
| `api.read` | `read` |
| `api.grep` | `grep` |
| `api.find` | `find` |
| `api.ls` | `ls` |
| `api.bash` | `bash` |
| `api.artifact.write_text` | `artifact.write_text` |
| `api.artifact.write_json` | `artifact.write_json` |
| `api.artifact.attach_file` | `artifact.attach_file` |
| `api.workflow.list_assets` | `workflow.list_assets` |
| `api.workflow.list_models` | `workflow.list_models` |

`edit` and `write` are not duplicated inside code mode. Agents call those tools directly so file modifications stay explicit in the transcript and command stream.

## Examples

### Batch Reads and Aggregate a Result

```ts
const matches = await api.grep({ pattern: "StructuredTurnDecision", glob: "src/**/*.ts" });
const files = matches.content
  .filter((entry) => entry.type === "text")
  .flatMap((entry) => entry.text.match(/[^\s:]+\.ts/g) ?? []);
const uniqueFiles = [...new Set(files)].slice(0, 5);
const reads = await Promise.all(uniqueFiles.map((path) => api.read({ path, limit: 80 })));

return {
  files: uniqueFiles,
  previews: reads.map((result) =>
    result.content.filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n"),
  ),
};
```

### Workflow Discovery

```ts
const prompts = await api.workflow.list_assets({ kind: "prompt", scope: "saved" });
const components = await api.workflow.list_assets({ kind: "component", scope: "saved" });
const models = await api.workflow.list_models();

return {
  promptCount: prompts.details.assets.length,
  componentCount: components.details.assets.length,
  modelCount: models.details.models.length,
};
```

### Bash-Backed Inspection

```ts
const result = await api.bash({ command: "bun test src/bun/execute-typescript-tool.test.ts" });
const output = result.content
  .filter((entry) => entry.type === "text")
  .map((entry) => entry.text)
  .join("\n");

await api.artifact.write_text({
  name: "execute-typescript-test-output.txt",
  text: output,
});

return { outputBytes: output.length };
```

## Recording

Every direct tool call and every nested code-mode call is recorded as a structured command.

Direct tool command records include:

- tool name
- owning turn or workflow task attempt
- status
- visibility
- title and summary
- tool input and selected result facts when available

`execute_typescript` command records include:

- parent command for the snippet attempt
- submitted snippet artifact
- diagnostics artifact when typecheck fails
- logs artifact when console output exists
- child command records for nested `api` calls
- parent rollup facts for reads, searches, bash calls, artifacts, and workflow discovery

## Visibility

Read/search/discovery calls are trace-visible by default. File modifications, artifact creation, bash commands, failures, waits, handoffs, Smithers control, and `execute_typescript` parents are summary-visible by default.

## Failure Semantics

Typecheck failures stop execution before any nested call runs. Runtime failures finish the parent command as failed, preserve successful child command records that already occurred, and attach the thrown error to the result.

Nested failures finish their child command as failed. The snippet may catch and handle the error; otherwise the parent fails.

## Prompt Exposure

The agent receives:

- ordinary tool declarations for direct tools
- ordinary tool declarations for control and Smithers tools on surfaces that own them
- one `execute_typescript` tool declaration
- a generated TypeScript declaration block for the injected code-mode API
- prompt guidance that direct tools are the default path and code mode is for typed composition

The generated declaration is the prompt contract. Handwritten prose may explain when to use code mode, but it does not redefine the interface.
