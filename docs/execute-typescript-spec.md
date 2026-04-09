# `execute_typescript` / Code Mode Spec

## Status

- Date: 2026-04-09
- Status: adopted architecture direction for the `execute_typescript` primitive
- Scope of this document:
  - specify an `execute_typescript` execution primitive for `hellm`
  - record only source-backed facts from existing implementations
  - make explicit `hellm` decisions derived from those facts
  - avoid undocumented assumptions

## Purpose

`hellm` needs a source-backed answer to one question:

Should we add a single code-execution tool that lets the model compose typed capabilities in TypeScript, instead of forcing it through many low-level tool round trips?

This document answers that question end to end:

- what existing systems actually implement
- what their exact APIs and sandbox models are
- what `pi` and Smithers already give us locally
- what `hellm` should borrow
- what `hellm` should explicitly not borrow

## Adopted Decisions

The adopted `hellm` direction is:

- one TanStack-style `execute_typescript` tool
- one TypeScript-first prompt and generated type-stub layer
- one flat in-sandbox capability surface using global async `external_*` functions
- QuickJS as the first runtime shipped by `hellm`
- no code-mode-specific outer sandbox in scope for the first implementation
- capability control by curated tool injection per invocation, not by a built-in namespace or approval system inside code mode
- availability on both the direct path and inside Smithers-backed delegated work

Nothing in the rest of this document should be read as leaving those points open.

## Reading Rules

This document uses three labels:

- `Fact`: directly supported by a cited source
- `Decision`: the adopted `hellm` design choice derived from the facts
- `Not Adopted`: explicitly out of scope for the adopted first implementation

## Product Fit

### Fact

The current PRD defines:

- one orchestrator above `pi`
- `pi` as the interactive substrate and shell
- Smithers as the internal executor for bounded, durable delegated workflows
- direct, Smithers-workflow, verification, and approval paths as the top-level execution paths

Source:

- `docs/prd.md`

### Decision

`execute_typescript` is not a new top-level path.

It is a lower-level execution primitive that can be used:

- on the direct path
- inside Smithers-backed worker tasks
- under the orchestrator's existing routing model

That preserves the PRD instead of replacing it.

## External Implementations: Exact Facts

## TanStack AI Code Mode

### Fact: top-level API

TanStack exposes:

```ts
createCodeMode(config) -> { tool, systemPrompt }
```

The tool is named `execute_typescript`.

The input schema is:

```ts
type ExecuteTypescriptInput = {
  typescriptCode: string;
};
```

The result shape is:

```ts
type CodeModeToolResult = {
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

Sources:

- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-code-mode.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-code-mode-tool.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/types.ts`

### Fact: capability injection model

TanStack converts host tools into sandbox bindings and injects them as global async functions named `external_*`.

Optional dynamic skill bindings are injected as `skill_*`.

Sources:

- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/bindings/tool-to-binding.ts`
- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode-with-skills.md`

### Fact: prompt and typing model

TanStack generates a system prompt that:

- documents when to use `execute_typescript`
- lists available `external_*` functions
- includes generated TypeScript stubs from tool schemas

Sources:

- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-system-prompt.ts`
- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode.md`

### Fact: execution flow

TanStack's execution flow is:

1. receive `typescriptCode`
2. strip TypeScript using `esbuild`
3. merge static `external_*` bindings and optional dynamic `skill_*` bindings
4. wrap bindings so calls emit events
5. create a fresh isolate context
6. execute code in the sandbox
7. return `{ success, result, logs, error }`
8. always dispose the isolate

Sources:

- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-code-mode-tool.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/strip-typescript.ts`

### Fact: event model

TanStack emits:

- `code_mode:execution_started`
- `code_mode:console`
- `code_mode:external_call`
- `code_mode:external_result`
- `code_mode:external_error`

Sources:

- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-code-mode-tool.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/bindings/tool-to-binding.ts`

### Fact: sandbox drivers

TanStack officially documents three drivers:

- Node driver via `isolated-vm`
- QuickJS driver via `quickjs-emscripten`
- Cloudflare Worker driver

The docs explicitly describe the Node driver as V8 isolate based, the QuickJS driver as WASM based, and the Cloudflare driver as a request or response loop against a Worker.

Sources:

- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode-isolates.md`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-node/src/isolate-driver.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-quickjs/src/isolate-driver.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-cloudflare/src/isolate-driver.ts`

### Fact: security posture

TanStack's docs say the sandbox has no host filesystem, network, or process access by default, and only the injected bindings are available.

Sources:

- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode.md`
- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode-isolates.md`

### Fact: no built-in repo API

TanStack ships a generic code-execution framework. It does not ship a built-in repo or filesystem SDK. Repo access only exists if the host exposes such tools.

Sources:

- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/types.ts`
- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode.md`

## Cloudflare Codemode

### Fact: top-level API

Cloudflare's generic core is:

```ts
interface Executor {
  execute(code, providersOrFns): Promise<{
    result: unknown;
    error?: string;
    logs?: string[];
  }>;
}
```

The AI SDK wrapper exposes `createCodeTool({ tools, executor })`.

The input schema is:

```ts
type CodeInput = { code: string };
```

The output shape is:

```ts
type CodeOutput = {
  code: string;
  result: unknown;
  logs?: string[];
};
```

The TanStack wrapper returns a tool named `codemode_execute`.

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/executor.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/shared.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/tool.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/tanstack-ai.ts`

### Fact: code syntax

Cloudflare's codemode prompt asks the model to write a JavaScript async arrow function, not TypeScript syntax.

The default description explicitly says:

- write an async arrow function in JavaScript
- do not use TypeScript syntax

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/shared.ts`
- `https://github.com/cloudflare/agents/blob/main/docs/codemode.md`

### Fact: capability injection model

Cloudflare injects one or more namespaced `ToolProvider`s into the sandbox.

Typical namespaces are:

- `codemode.*`
- `state.*`
- `git.*`
- any other provider name

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/executor.ts`
- `https://github.com/cloudflare/agents/blob/main/docs/codemode.md`

### Fact: sandbox

The built-in runtime is `DynamicWorkerExecutor`.

It executes code in an isolated Cloudflare Worker via `WorkerLoader`.

Its documented options include:

- `loader`
- `timeout`
- `globalOutbound`
- `modules`

`globalOutbound: null` blocks `fetch()` and `connect()` by default.

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/executor.ts`
- `https://github.com/cloudflare/agents/blob/main/docs/codemode.md`

### Fact: execution flow

Cloudflare's flow is:

1. generate type declarations for providers
2. the LLM writes a JavaScript async arrow function
3. code is normalized with `acorn`
4. a Worker sandbox is started
5. namespaced proxy calls route back to the host through Workers RPC
6. logs are captured and returned

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/normalize.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/executor.ts`
- `https://github.com/cloudflare/agents/blob/main/docs/codemode.md`

### Fact: approval filtering

Cloudflare filters out tools marked with `needsApproval` from the codemode capability surface.

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/resolve.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/tool.ts`

### Fact: no built-in repo API in codemode core

Cloudflare codemode itself does not define repo operations. Repo and filesystem access are added by separate providers, especially `@cloudflare/shell`.

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/executor.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/shell/README.md`

## Cloudflare Shell

### Fact

`@cloudflare/shell` is a separate package that provides a typed filesystem and git surface for codemode.

It exposes `stateTools(workspace)` and `gitTools(workspace)`.

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/shell/README.md`
- `https://github.com/cloudflare/agents/blob/main/packages/shell/src/workers.ts`

### Fact: `state.*` capability shape

Cloudflare's `state` API includes structured filesystem operations such as:

- `readFile`
- `writeFile`
- `appendFile`
- `readJson`
- `writeJson`
- `queryJson`
- `updateJson`
- `exists`
- `stat`
- `lstat`
- `mkdir`
- `readdir`
- `find`
- `walkTree`
- `summarizeTree`
- `searchText`
- `searchFiles`
- `replaceInFile`
- `replaceInFiles`
- `glob`
- `diff`
- `diffContent`
- `planEdits`
- `applyEditPlan`
- `applyEdits`

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/shell/src/prompt.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/shell/README.md`

### Fact: large API strategy

Cloudflare also ships:

- `codeMcpServer()` which wraps a whole MCP server in a single code tool
- `openApiMcpServer()` which exposes `search` and `execute` instead of dumping a whole OpenAPI surface directly into context

Sources:

- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/mcp.ts`
- `https://github.com/cloudflare/agents/blob/main/examples/codemode-mcp/src/server.ts`
- `https://github.com/cloudflare/agents/blob/main/examples/codemode-mcp-openapi/src/server.ts`

## Anthropic Code Execution and Programmatic Tool Calling

### Fact: tool-level API

Anthropic exposes hosted code execution as a Messages API tool.

The current code execution tool version shown in the docs is:

```json
{ "type": "code_execution_20250825", "name": "code_execution" }
```

Programmatic tool calling uses:

```json
"allowed_callers": ["code_execution_20260120"]
```

That version mismatch is real in the current docs and must be treated literally.

Sources:

- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool`
- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/programmatic-tool-calling`

### Fact: sandbox model

Anthropic documents code execution as running Python and bash in a sandboxed container.

The docs describe:

- container reuse by ID
- an `expires_at` field
- 30-day maximum lifetime
- cleanup after 4.5 minutes of idle time

Sources:

- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool`
- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/programmatic-tool-calling`

### Fact: programmatic tool calling flow

Anthropic's documented flow is:

1. send a request including code execution and tools with `allowed_callers`
2. Claude starts code execution
3. if the code calls an allowed tool, the API returns a `tool_use`
4. that `tool_use` includes a `caller` field showing it came from code execution
5. the response also includes `container.id` and `container.expires_at`
6. the client must send the tool result back before the container expires

Sources:

- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/programmatic-tool-calling`

### Fact: no published local `execute_typescript` SDK

Anthropic publishes a hosted container tool and protocol, not an open-source local `execute_typescript` framework equivalent to TanStack or Cloudflare codemode.

Sources:

- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool`
- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/programmatic-tool-calling`
- `https://www.anthropic.com/engineering/code-execution-with-mcp`

## Local Reference Findings

## `pi`

### Fact

`pi` extensions run with full system permissions unless the extension author adds restrictions.

The docs explicitly warn:

- extensions run with full system permissions
- extensions can intercept tools and replace behavior

Sources:

- `docs/references/pi-mono/packages/coding-agent/docs/extensions.md`

### Fact

The vendored `pi` sandbox example is extension-level only.

It wraps `bash` using `@anthropic-ai/sandbox-runtime`, and the example comment says this is an example of overriding the built-in tool, not a built-in generic code sandbox.

Sources:

- `docs/references/pi-mono/packages/coding-agent/examples/extensions/sandbox/index.ts`
- `docs/references/pi-mono/packages/coding-agent/examples/extensions/README.md`

### Decision

`pi` does not currently give `hellm` a built-in, first-class, source-backed `execute_typescript` sandbox to adopt directly.

It does give us:

- extension hooks
- tool interception
- a precedent for using `@anthropic-ai/sandbox-runtime`

Those are relevant as integration points, not as the core code-mode implementation.

## Smithers

### Fact

Smithers built-in tools are sandboxed to `rootDir`.

The documented constraints include:

- path resolution relative to `rootDir`
- rejection of symlink escapes
- output truncation
- timeouts
- network blocked by default in `bash`

Sources:

- `docs/references/smithers/docs/concepts/agents-and-tools.mdx`
- `docs/references/smithers/docs/integrations/tools.mdx`
- `docs/references/smithers/src/tools/bash.ts`

### Fact

Smithers exposes a `<Sandbox>` component API with runtime names:

- `bubblewrap`
- `docker`
- `codeplane`

It also supports knobs such as:

- `allowNetwork`
- `reviewDiffs`
- `autoAcceptDiffs`
- `image`
- `workspace`
- `memoryLimit`
- `cpuLimit`

Sources:

- `docs/references/smithers/src/components/Sandbox.ts`

### Fact

In the current vendored Smithers source, the sandbox transport layer is only partial:

- Bubblewrap and Docker transports create and ship bundle directories
- transport `execute()` returns success without real runtime execution
- `executeSandbox()` then runs `executeChildWorkflow()` in-process using the parent `rootDir`

That means the vendored `Sandbox` path is not currently evidence of a fully implemented external isolation boundary.

Sources:

- `docs/references/smithers/src/sandbox/transport.ts`
- `docs/references/smithers/src/sandbox/execute.ts`

### Decision

Smithers is highly relevant to `hellm` in two ways:

- its existing tool sandbox semantics are worth borrowing for host-side repo and shell operations
- its workflow engine is the correct durable execution layer around delegated code-mode work

But the current vendored Smithers `Sandbox` implementation should not be treated as `hellm`'s primary outer sandbox until it is materially more complete.

## Deferred Sandbox Notes

This section is retained only as research context.

It does not change the adopted design above.

`hellm` is not adopting an outer sandbox as part of the initial `execute_typescript` implementation.

## `@anthropic-ai/sandbox-runtime`

### Fact

Anthropic's sandbox runtime is a lightweight OS-level sandbox for arbitrary processes.

It uses:

- `sandbox-exec` on macOS
- `bubblewrap` on Linux
- proxy-based network filtering

It explicitly supports filesystem and network restrictions for arbitrary processes and MCP servers.

Sources:

- `https://github.com/anthropic-experimental/sandbox-runtime`

### Decision

This is relevant to `hellm` as an outer sandbox for host-side process execution, especially because:

- `pi` already has a source-backed example using it
- it is light enough for local development
- it is designed exactly for agent and MCP hardening

## `isolated-vm`

### Fact

`isolated-vm` exposes V8 isolates in Node, but its README says:

- it is in maintenance mode
- V8 is not resilient to out-of-memory conditions
- it is wise to isolate it in a separate Node process from critical infrastructure

Sources:

- `https://github.com/laverdet/isolated-vm`

### Decision

`isolated-vm` remains relevant as an optional high-performance Node-only runner, but it should not be the default `hellm` runtime.

## QuickJS

### Fact

TanStack documents QuickJS as:

- WASM based
- no native dependencies
- portable across Node, browsers, Bun, and edge environments
- slower than V8, but generally fine for tool orchestration workloads

TanStack's implementation also serializes execution globally because of asyncify limitations.

Sources:

- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode-isolates.md`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-quickjs/src/isolate-context.ts`

### Decision

QuickJS is the best default inner runtime for `hellm`'s first implementation.

## `workerd`

### Fact

Cloudflare's `workerd` README explicitly warns:

- `workerd` is not a hardened sandbox
- if used for possibly malicious code, it must itself run inside an appropriate secure sandbox such as a virtual machine

Sources:

- `https://github.com/cloudflare/workerd`

### Decision

`workerd` is not a suitable sole isolation boundary for local `hellm` code execution.

## `bubblewrap`

### Fact

Bubblewrap is:

- a lightweight sandbox construction tool
- namespace based
- intentionally not a complete ready-made security policy on its own
- only as secure as the framework that constructs its arguments and policy

Sources:

- `https://github.com/containers/bubblewrap`

### Decision

Bubblewrap is relevant as a low-level Linux primitive, but not as the direct product-facing abstraction. We should consume it through a higher-level wrapper such as `@anthropic-ai/sandbox-runtime`, or through a future mature Smithers transport.

## `nsjail`

### Fact

NsJail is a Linux process isolation tool that combines:

- namespaces
- resource limits
- seccomp-bpf filters
- cgroups

Sources:

- `https://github.com/google/nsjail`

### Decision

NsJail is a credible Linux-only outer sandbox option if we need stronger kernel-level policy control than `sandbox-runtime` exposes, but it is not the best cross-platform default for `hellm`.

## gVisor

### Fact

gVisor presents itself as a Linux-compatible sandbox for running containers efficiently and securely, and explicitly calls out running untrusted and LLM-generated code as a use case.

Sources:

- `https://gvisor.dev/`

### Decision

gVisor is relevant only if `hellm` evolves into a multi-tenant remote execution service. It is too heavy and too infrastructure-oriented for the initial local-first harness.

## Firecracker

### Fact

Firecracker is a microVM runtime built for secure, multi-tenant, minimal-overhead execution of container and function workloads.

Sources:

- `https://github.com/firecracker-microvm/firecracker`

### Decision

Firecracker is the strongest future option for high-assurance remote execution, but it is not the right first implementation for a local `hellm` code-mode primitive.

## `hellm` Decisions

## Decision: one tool, TypeScript-first

`hellm` should add exactly one code-composition tool:

```ts
type ExecuteTypescriptInput = {
  typescriptCode: string;
};

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

Tool name:

```ts
execute_typescript
```

Rationale:

- this matches the cleanest existing contract, TanStack
- it keeps the LLM prompt stable and simple
- it fits the user's mental model already
- it avoids Cloudflare's JS-only mismatch when our product intent is explicitly TypeScript-first

## Decision: flat `external_*` capability surface

`hellm` should follow TanStack here directly.

Inside the sandbox, capabilities are exposed as flat global async functions named `external_*`.

Examples:

- `external_readFile`
- `external_writeFile`
- `external_searchFiles`
- `external_gitStatus`
- `external_verifyRun`
- `external_artifactWriteJson`

There is no namespaced `repo.*`, `git.*`, `verify.*`, or `artifacts.*` API in the initial design.

Rationale:

- this matches the selected TanStack execution model directly
- it avoids introducing another abstraction layer before we have implementation experience
- it makes the model-facing API and the generated prompt simpler

## Decision: borrow Cloudflare Shell semantics, but flatten the host tool names

For repo and filesystem operations, `hellm` should borrow Cloudflare Shell semantics almost verbatim, but flatten them into explicit host tool names that become `external_*` functions in the sandbox.

Day 1 repo and filesystem capability set:

- `readFile(path)`
- `writeFile(path, content)`
- `appendFile(path, content)`
- `readJson(path)`
- `writeJson(path, value, options?)`
- `queryJson(path, query)`
- `updateJson(path, operations)`
- `exists(path)`
- `stat(path)`
- `lstat(path)`
- `mkdir(path, options?)`
- `readdir(path)`
- `find(path, options?)`
- `walkTree(path, options?)`
- `summarizeTree(path, options?)`
- `searchText(path, query, options?)`
- `searchFiles(pattern, query, options?)`
- `replaceInFile(path, search, replacement, options?)`
- `replaceInFiles(pattern, search, replacement, options?)`
- `glob(pattern)`
- `diff(pathA, pathB)`
- `diffContent(oldContent, newContent)`
- `planEdits(instructions)`
- `applyEditPlan(plan, options?)`
- `applyEdits(edits, options?)`

Those host tools are surfaced to the model as:

- `external_readFile`
- `external_writeFile`
- `external_appendFile`
- `external_readJson`
- `external_writeJson`
- `external_queryJson`
- `external_updateJson`
- `external_exists`
- `external_stat`
- `external_lstat`
- `external_mkdir`
- `external_readdir`
- `external_find`
- `external_walkTree`
- `external_summarizeTree`
- `external_searchText`
- `external_searchFiles`
- `external_replaceInFile`
- `external_replaceInFiles`
- `external_glob`
- `external_diff`
- `external_diffContent`
- `external_planEdits`
- `external_applyEditPlan`
- `external_applyEdits`

Not Adopted in Day 1:

- archive helpers
- compression helpers
- raw byte APIs
- symlink helpers
- file type detection and hashing

## Decision: git tools are flat host tools, not a namespace

Day 1 git capability set is local-read and local-metadata focused:

- `gitStatus()`
- `gitDiff(options?)`
- `gitLog(options?)`
- `gitBranch()`
- `gitHead()`

Those are exposed in the sandbox as:

- `external_gitStatus`
- `external_gitDiff`
- `external_gitLog`
- `external_gitBranch`
- `external_gitHead`

Not Adopted in Day 1:

- `gitClone`
- `gitFetch`
- `gitPull`
- `gitPush`
- remote auth flows

## Decision: verification stays typed and flat

Day 1 verification capability set:

- `verifyRun({ kind: "test" | "lint" | "build", target?: string })`
- `verifyLast()`

Those are exposed in the sandbox as:

- `external_verifyRun`
- `external_verifyLast`

The model does not get arbitrary shell access through code mode.

## Decision: artifact outputs stay explicit and flat

Day 1 artifact capability set:

- `artifactWriteJson(name, value)`
- `artifactWriteText(name, text)`
- `artifactAppendLog(name, line)`

Those are exposed in the sandbox as:

- `external_artifactWriteJson`
- `external_artifactWriteText`
- `external_artifactAppendLog`

Artifacts created through code mode must become first-class episode artifacts, not hidden temp files.

## Decision: large external APIs use discovery plus execution

For large MCP or OpenAPI surfaces, `hellm` should not dump every endpoint or tool into the main `execute_typescript` prompt.

Instead it should borrow Cloudflare's pattern:

- a discovery phase such as `search`
- a bounded execution phase against the selected subset

This can be implemented later as:

- connector-specific search tools
- generated typed stubs after discovery
- or a specialized `mcp.search` plus `mcp.execute` flow

## Decision: QuickJS is the initial and only in-scope runtime

The initial `hellm` implementation ships one runtime:

- QuickJS via WASM

Reasons:

- portable to Bun
- no native dependency
- source-backed by TanStack
- appropriate for I/O-heavy capability orchestration

Future runtimes such as Node plus `isolated-vm` are possible later, but they are not part of the adopted initial design.

## Decision: no outer sandbox work in scope

`hellm` is not adopting any code-mode-specific outer process or OS sandbox in the initial design.

That means:

- host-side tool implementations run in the normal `hellm` process context
- the initial spec does not depend on `@anthropic-ai/sandbox-runtime`
- the initial spec does not depend on Smithers `Sandbox`
- the initial spec does not standardize on `bubblewrap`, `nsjail`, `gVisor`, `Firecracker`, or any other outer runtime

Capability control is handled only by deciding which tools are injected for a given `execute_typescript` call.

## Decision: no raw shell in code mode

Not Adopted in Day 1:

- arbitrary `bash` from inside `execute_typescript`
- arbitrary network access from inside the sandbox
- arbitrary process spawning from inside the sandbox

Reason:

- the value comes from composing typed host capabilities, not from embedding a second general shell
- the user explicitly decided to defer sandbox work

## Decision: event model follows TanStack

`hellm` should emit and store these execution events:

- `code_mode:execution_started`
- `code_mode:console`
- `code_mode:external_call`
- `code_mode:external_result`
- `code_mode:external_error`

These should be captured in:

- live UI projections
- episode traces
- machine-readable artifacts

## `hellm` End-to-End Flow

1. The orchestrator decides to use code mode.
2. It chooses the exact host tools to expose for the task.
3. It constructs the flat `external_*` capability registry and generated type stubs.
4. The model receives the normal system prompt plus the code-mode prompt and capability typings.
5. The model calls `execute_typescript({ typescriptCode })`.
6. `hellm` strips TypeScript syntax before execution.
7. `hellm` creates a fresh QuickJS context for this call.
8. `hellm` injects only the chosen `external_*` functions.
9. The code runs in the sandbox.
10. Capability calls bridge back to host implementations.
11. Host implementations run in the normal `hellm` process context.
12. `hellm` captures:
    - result
    - logs
    - call trace
    - durations
    - error details
13. The orchestrator normalizes the outcome into an episode and artifacts.
14. Reconciliation decides:
    - complete
    - continue
    - verify
    - request approval
    - route into Smithers-backed delegated work

## Integration with Direct and Smithers Paths

### Direct path

Use `execute_typescript` when the work is:

- read heavy
- aggregation heavy
- naturally parallel
- structured enough to fit the typed capability surface

Examples:

- repo search and summarization
- collecting test failures and grouping them
- comparing diffs and outputs

### Smithers path

Use the same `execute_typescript` primitive inside Smithers-backed tasks when the work also needs:

- resumability
- approval gates
- durable waiting states
- multi-step delegation
- worktree isolation

This keeps one code-mode primitive across the product instead of inventing a separate Smithers-only variant.

## Explicit Non-Goals

- No new top-level Code Mode product shell
- No raw unrestricted shell from inside `execute_typescript`
- No flat dump of large connector or OpenAPI schemas into every prompt
- No outer sandbox work in the initial implementation
- No namespaced capability API in the initial implementation
- No built-in approval model inside code mode itself

## Recommended Implementation Order

1. Implement `execute_typescript` with the TanStack-style input and output contract.
2. Use QuickJS as the initial runtime.
3. Generate TanStack-style flat `external_*` type stubs for the selected host tools.
4. Expose the initial repo, git, verification, and artifact host tools.
5. Emit TanStack-style events and store full traces in episodes and artifacts.
6. Add large-surface connector discovery later.
7. Add persisted skills later if the base primitive proves valuable.

## Final Recommendation

### Decision

Adopt the pattern.

More specifically:

- borrow TanStack's `execute_typescript` contract directly
- borrow TanStack's flat `external_*` capability model directly
- borrow Cloudflare Shell semantics for the host tool set
- borrow TanStack's event model
- use QuickJS as the only runtime in the initial implementation
- keep sandbox work explicitly out of scope for now

Do not:

- copy Anthropic's hosted container product model directly
- introduce namespaced capability objects in the initial implementation
- introduce a code-mode-specific outer sandbox in the initial implementation
- choose `isolated-vm` or `workerd` as the default initial runtime

## References

### Local product and reference docs

- `docs/prd.md`
- `docs/features.ts`
- `docs/references/pi-mono/packages/coding-agent/docs/extensions.md`
- `docs/references/pi-mono/packages/coding-agent/examples/extensions/sandbox/index.ts`
- `docs/references/smithers/docs/concepts/agents-and-tools.mdx`
- `docs/references/smithers/docs/integrations/tools.mdx`
- `docs/references/smithers/src/components/Sandbox.ts`
- `docs/references/smithers/src/sandbox/transport.ts`
- `docs/references/smithers/src/sandbox/execute.ts`
- `docs/references/smithers/src/tools/bash.ts`

### TanStack

- `https://tanstack.com/blog/tanstack-ai-code-mode`
- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode.md`
- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode-isolates.md`
- `https://github.com/TanStack/ai/blob/main/docs/code-mode/code-mode-with-skills.md`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-code-mode.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-code-mode-tool.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/create-system-prompt.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/types.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/bindings/tool-to-binding.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-code-mode/src/strip-typescript.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-node/src/isolate-driver.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-node/src/isolate-context.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-quickjs/src/isolate-driver.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-quickjs/src/isolate-context.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-cloudflare/src/isolate-driver.ts`
- `https://github.com/TanStack/ai/blob/main/packages/typescript/ai-isolate-cloudflare/src/types.ts`

### Cloudflare

- `https://blog.cloudflare.com/code-mode/`
- `https://blog.cloudflare.com/code-mode-mcp/`
- `https://blog.cloudflare.com/dynamic-workers/`
- `https://github.com/cloudflare/agents/blob/main/docs/codemode.md`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/executor.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/tool.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/shared.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/normalize.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/resolve.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/tanstack-ai.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/codemode/src/mcp.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/shell/README.md`
- `https://github.com/cloudflare/agents/blob/main/packages/shell/src/index.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/shell/src/prompt.ts`
- `https://github.com/cloudflare/agents/blob/main/packages/shell/src/workers.ts`

### Anthropic

- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/code-execution-tool`
- `https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/programmatic-tool-calling`
- `https://www.anthropic.com/engineering/code-execution-with-mcp`
- `https://github.com/anthropic-experimental/sandbox-runtime`

### Additional sandbox references

- `https://github.com/containers/bubblewrap`
- `https://github.com/google/nsjail`
- `https://gvisor.dev/`
- `https://github.com/firecracker-microvm/firecracker`
- `https://github.com/cloudflare/workerd`
- `https://github.com/laverdet/isolated-vm`
