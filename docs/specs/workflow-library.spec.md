# Workflow Library And Artifact Workflow Authoring

## Status

- Date: 2026-04-23
- Status: adopted direction for handler-owned workflow authoring, saved-library discovery, saved-library writes, product entry metadata, and runtime validation feedback
- Scope of this document:
  - define the workspace-owned workflow library shape under `.svvy/workflows/`
  - define the authored artifact-workflow shape under `.svvy/artifacts/workflows/`
  - define handler-side workflow authoring guidance, generated contracts, and discovery
  - define the runnable entry contract consumed by `smithers_list_workflows`
  - define optional product metadata and result schemas for special product lanes such as Project CI
  - define how saved workflow files are written and validated

Related extension specs:

- `docs/specs/extension/smithers.extension.spec.md` defines the draft Smithers extension surface that
  launches and supervises runnable workflow entries.
- `docs/specs/extension/artifacts.extension.spec.md` defines the Artifacts extension API; artifact
  workflows here are persisted workflow source artifacts under `.svvy/artifacts/workflows/`, not
  copied files in the configured Artifacts extension store.

## Purpose

`svvy` needs one clear split between:

- reusable workflow source assets kept in the workspace library
- short-lived artifact workflows authored for one delegated objective
- runnable entries used by handler threads to launch Smithers workflows

The product should optimize for:

- using direct tools when a workflow is unnecessary
- reusing a saved runnable entry when one clearly fits
- authoring a short-lived artifact workflow when saved entries do not fit
- writing reusable saved workflow files only when the user explicitly asks for that
- surfacing validation feedback automatically when saved workflow files are written
- keeping exact handler-authored workflow and workflow task-agent shapes in generated TypeScript declarations
- exposing available provider/model/reasoning choices when a handler must author a fresh workflow
  task-agent configuration

## Core Model

`svvy` uses three related but different workflow concepts:

- reusable saved workflow assets for authoring
- runnable workflow entries for launch and supervision
- authored artifact workflows as durable filesystem source for one delegated objective

The naming rule is:

- the Workflows library read model provides authoring-time asset discovery
- `workflow_list_models` provides handler authoring-time provider/model/reasoning discovery
- `apply_patch` is the handler's file-modification interface for saved workflow files
- `smithers_*` is the handler's launch and supervision capability set

This split is intentional.

Asset discovery and saved-library writes are not workflow launch.

Exact native-tool and `execute_typescript` shapes are provided by generated tool schemas and TypeScript declarations. Exact handler-authored runnable entry and workflow task-agent shapes are provided by the generated workflow-authoring declaration.

## Handler-Owned Authoring

Handler threads own workflow authoring.

Each handler thread receives generated workflow-authoring TypeScript declarations plus the loaded Smithers extension guidance for workflow authoring and supervision.

The handler owns:

- deciding whether direct work is enough
- checking saved runnable entries
- checking reusable saved assets
- authoring a new artifact workflow when needed
- deciding whether reusable saved workflow files should be written
- writing those saved workflow files directly into `.svvy/workflows/...`
- checking the returned validation feedback before considering the write complete

The generated workflow-authoring declaration is the prompt source of truth for:

- runnable entry modules
- runtime entry factory return values
- source scope and product lane metadata
- grouped asset refs
- workflow task agents
- `AgentLike` task-agent usage

## Adopted Layout

### Saved Workflow Library

The workspace-owned saved workflow library lives under:

```text
.svvy/workflows/
  definitions/
  prompts/
  components/
  entries/
```

The folders mean:

- `definitions/`: reusable workflow factories and builders
- `prompts/`: reusable prompt assets
- `components/`: reusable helpers and future packaged-app-safe workflow-agent components
- `entries/`: launchable saved workflow entry wrappers

Product-specific saved assets use subdirectories inside the same library rather than a separate workflow system.

Project CI assets use:

```text
.svvy/workflows/
  definitions/ci/
  prompts/ci/
  components/ci/
  entries/ci/
```

This preserves one workflow library while allowing the UI and runtime to recognize declared product lanes through entry metadata.

### Artifact Workflows

Artifact workflows live under:

```text
.svvy/artifacts/workflows/<artifact_workflow_id>/
  definitions/
  prompts/
  components/
  entries/
  metadata.json
```

An artifact workflow folder may contain only the files and subdirectories relevant to that authored workflow.

It does not need to populate every folder if the workflow only needs some of them.

Artifact workflows are durable filesystem source.

Saved workflow files stand on their own as ordinary workspace files under `.svvy/workflows/...`.

### Artifact Metadata

`metadata.json` is the filesystem-side provenance record for the artifact workflow itself.

It should include at least:

- `artifactWorkflowId`
- `schemaVersion`
- `sessionId`
- `threadId`
- `objectiveSummary`
- `createdAt`
- `updatedAt`
- `entryPaths`

## Saved File Kinds

### Definitions

Definitions are reusable workflow structure.

The normal pattern is:

- export a workflow factory or builder
- accept prompt, workflow agent, or config inputs where variation is expected
- avoid closing over objective-specific state when the definition is meant to be reused

### Prompts

Prompt assets are `mdx` files with frontmatter metadata.

They are saved independently so later workflows can:

- reuse them directly
- layer additional task-specific guidance on top
- substitute a different prompt without rewriting the definition

### Components

Components are reusable TS or TSX files that are not themselves runnable entries.

Examples:

- helpers
- schema utilities
- workflow building blocks
- future workflow-agent values or factories

Workflow-agent component files are future packaged-app-safe Workflows assets. When adopted, they should be ordinary component files that export values conforming to the generated `WorkflowTaskAgentConfig` contract. Provider/model capability metadata used by those controls must come from pi's normalized `Model` records and Agents/workflow-agent configuration; `svvy` must not maintain a second table of provider-specific reasoning quirks or Codex-specific request behavior. Workflow definitions and entries use Smithers `AgentLike` values for adaptive task execution, with the workflow agent configuration describing the svvy task-agent model, prompt, reasoning, and task-local capability set. At runtime, `toolSurface` is selected from the generated ordered task-tool registry; when the cx extension is loaded for a workflow task agent, it contributes prompt-only instructions for running official `cx` CLI commands through `exec_command`, not native `cx_*` tools.

Future workflow-agent component settings are workspace-affecting behavior. Any request that writes or validates workflow-agent component files must carry the target `workspaceId` and resolve that workspace's runtime from the request, not from the active workspace.

A handler lists component assets and reads candidate component files before using their exported values.

### Entries

Entry files are launchable workflow wrappers under `entries/`.

They are not returned by Workflows asset discovery.

They are returned by `smithers_list_workflows`.

## Discovery Metadata Contract

### TS Or TSX Asset Headers

Saved definitions and components must start with the minimal JSDoc metadata required for discovery and validation.

Normative example:

```ts
/**
 * @svvyAssetKind definition
 * @svvyId create_implement_review
 * @svvyTitle Create Implement Review
 * @svvySummary Reusable workflow factory for implement and review stages.
 */
```

For component assets, the same pattern applies with `@svvyAssetKind component`.

The header is a compact index. Handlers inspect the file through `exec_command` when they need
source context.

### MDX Prompt Frontmatter

Prompt files should use frontmatter metadata.

Normative example:

```mdx
---
svvyAssetKind: prompt
svvyId: review_base
title: Review Base
summary: Base review instructions reusable across review-oriented workflows.
---
```

Prompt frontmatter is also a compact index. Handlers read the prompt file before using its body.

## Runnable Entry Contract

Each runnable entry file conforms to the generated `RunnableWorkflowEntryModule` contract.

The grouped asset refs are mandatory.

They are the source of truth for workflow source inspection.

For saved entries, every grouped asset ref must resolve to `.svvy/workflows/...`.

For artifact entries, grouped refs may mix saved-library paths and artifact-local paths.

The flat `assetPaths` value returned by `smithers_list_workflows` is derived from the union of the grouped refs.

`entryPath` is derived from the file location in the registry, not handwritten inside the module.

`productKind` is reserved for product lanes that need specialized projection.

The first adopted product kind is:

- `project-ci`

Entries with `productKind = "project-ci"` must also export `resultSchema`.

That result schema is the only source of Project CI run and check result records.

No product lane may be inferred from labels, filenames, logs, node output, or final prose.

Project CI details are defined in [Project CI Lane Spec](./project-ci.spec.md).

## Handler Workflow-Authoring Flow

The adopted handler-side workflow-authoring flow is:

1. A handler thread decides that direct bounded work is not enough and a workflow is justified.
2. The handler uses its injected generated workflow-authoring contract, guide, and examples first.
3. The handler uses the loaded Workflows extension generated client or Workflows library read model as needed.
4. The handler inspects promising saved definitions, prompts, or component files through
   `exec_command` before relying on implementation details.
5. The handler may use future packaged-app-safe workflow-agent components when that Workflows behavior is adopted.
6. The handler calls `workflow_list_models` when it must create or revise a task-agent configuration and no saved configuration clearly fits.
7. The handler authors a short-lived artifact workflow under `.svvy/artifacts/workflows/<artifact_workflow_id>/`, including artifact-local task-agent configuration when needed.
8. The handler calls `smithers_list_workflows`, inspects the artifact entry, and launches it through `smithers_run_workflow({ workflowId, input, runId? })`.
9. If the user explicitly asks to keep reusable workflow files, the handler writes those files
   directly into `.svvy/workflows/...` through `apply_patch`.
10. The handler reads the returned validation feedback in structured command output and keeps editing until the final saved workflow state validates cleanly.

## Discovery Interface

### Authoring-Time Asset Discovery

Handlers discover reusable assets through the loaded Workflows extension generated client and the
Workflows library read model.

This is the primary discovery interface for saved and artifact authoring assets.

The generated client contract is the exact input and output contract. It returns the enforced asset
identity metadata plus a workspace-relative `path`.

Each returned asset has:

- `id`
- `kind`: `definition | prompt | component`
- `title`
- `summary`
- `path`
- `scope`: `saved | artifact`

Supported filters are:

- `kind`
- `pathPrefix`
- `scope`: `saved | artifact | both`

Runnable entries are discovered through `smithers_list_workflows`.

### Provider And Model Discovery

Handlers use:

- `workflow_list_models(input?)`

This is a handler-only, read-only workflow-authoring tool. It exists because a handler writing a
fresh workflow task-agent configuration needs to know which provider/model/reasoning combinations are
available before it can emit valid workflow source.

`workflow_list_models` returns pi-normalized model metadata. `svvy` must not maintain a second table
of provider-specific reasoning quirks or Codex-specific request behavior.

The result includes:

- provider id and display name
- model id and display name
- readiness status and missing setup summary when unavailable
- supported reasoning values
- default reasoning value when one is configured
- context window and output limit when known
- image input support when known
- suitability flags for workflow task agents when known

Supported filters are:

- `providerId?`
- `modelId?`
- `includeUnavailable?`

When the handler has a generated TypeScript client for workflow authoring, the generated client
method must use the same contract as `workflow_list_models`.

### Runnable Workflow Discovery

`smithers_list_workflows` is reserved for runnable workflow entries.

It should list all runnable entries:

- saved entries under `.svvy/workflows/entries/`
- artifact entries under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`

It should support optional filters such as:

- `workflowId?`
- `productKind?`
- `sourceScope?`

Each returned runnable workflow entry includes the handler-visible launch contract compiled from the generated workflow-authoring contract plus the entry's launch schema.

This preserves the intended split:

- loaded Workflows extension generated clients and read models for authoring-time asset discovery
- `apply_patch` for saved-library writes
- `smithers_*` for launch and supervision

### Workflow Launch Surface

`smithers_run_workflow` is the stable handler launch surface.

Handlers call:

- `smithers_run_workflow({ workflowId, input, runId? })`

Where:

- `workflowId` selects a runnable entry returned by `smithers_list_workflows`
- `input` is validated against that entry's `launchInputSchema`
- supplied `runId` is used only when the handler intends to resume that exact Smithers run and Smithers still considers the run resumable
- omitted `runId` requests a fresh launch and never silently resumes an existing run
- omitted `runId` is rejected when the same handler already owns a nonterminal run with the same `workflowId`; different `workflowId` values can run concurrently under one handler

## Saved Workflow Writes

### Write Surface

Handlers write reusable saved workflow files through:

- `apply_patch` for exact file edits
- `exec_command` for validation, generated inspection, and file-system checks

The handler edits the final file contents under `.svvy/workflows/...` with `apply_patch`. `svvy`
does not add a custom workflow write or edit surface when the normal Codex-like filesystem tools
already solve the write path.

### Validation Feedback

Whenever a handler writes under `.svvy/workflows/...`, the runtime automatically validates the current saved workflow library state.

That validation should check:

- prompt frontmatter for saved prompt assets
- JSDoc metadata headers for saved definitions and components
- TypeScript typecheck across saved definitions, components, and entries
- runnable entry contract validation for saved entries
- product entry metadata validation for entries that declare `productKind`
- result schema validation for entries that declare `productKind = "project-ci"`
- grouped asset refs for saved entries

Validation feedback is surfaced automatically through structured command output.

That means the handler does not need a separate follow-up tool call just to validate what it wrote.

### Completion Rule

Saved workflow edits may produce temporary validation errors while related files are being written one by one.

The final completion rule is:

- the handler should not treat the saved workflow state as complete until the returned validation feedback is clean

## UI Requirements

The desktop app should expose:

- a read-only Workflows library view rooted at `.svvy/workflows/`
- separate groupings for definitions, prompts, components, entries, and artifact workflows
- asset detail views showing title, summary, kind, path, source preview, validation status, and diagnostics
- entry detail views showing entry path, summary, launch schema, grouped asset refs, validation status, and diagnostics
- an open-in-editor action that opens the selected source file in the user's configured external editor
- delete actions for saved definitions, prompts, components, and entries
- a save shortcut on relevant workflow surfaces that sends a predefined save request prompt to the handler thread

The UI save affordance is a shortcut prompt to the handler thread.

The Workflows library surface must not block on an in-app source editor. In-app editing, syntax highlighting, inline diagnostics, and file-tree integration are later editor-surface capabilities. Until those exist, this surface owns workflow-library discovery and inspection, while source editing happens through the configured external editor.

### Workspace Routing

The Workflows library is workspace-owned state. Reads, source previews, validation refreshes, delete actions, open-in-editor actions, artifact workflow grouping, save-shortcut routing, and future workflow-agent component operations must carry explicit `workspaceId`. The backend must never infer the target workspace from the active workspace, focused tab, focused panel, or active runtime, because Workflows library operations can be issued for a background workspace while another workspace is focused.

App-global settings such as model provider credentials, app appearance, preferred external editor,
and app-wide agent profiles remain separate. Only settings that read or write workspace workflow
files, generated workflow diagnostics, or workflow-library projection belong on the workspace-scoped
lane.

## Handler Guidance

Handler-thread instructions should say:

- prefer direct tools for small one-off work that does not benefit from workflow supervision
- use generated declarations for exact code-mode, runnable-entry, and workflow task-agent shapes
- reuse a saved runnable entry when one clearly fits
- otherwise author a short-lived artifact workflow
- mix saved definitions, prompts, and components freely when that produces a clearer workflow than reusing one saved entry unchanged
- use future packaged-app-safe workflow-agent components when that Workflows behavior is adopted
- define task-specific task-agent configuration inside the current artifact workflow when needed
- inspect Agents/workflow-agent configuration and pi-normalized model metadata only when no saved task-agent configuration fits or the user explicitly wants a different provider or model
- write reusable saved workflow files only on explicit request
- rely on the returned validation feedback after writes under `.svvy/workflows/...`
- discover and run configured Project CI entries when CI is needed
- load `project-ci` with `load_extension({ extensionId: "project-ci" })` before configuring or modifying Project CI assets when the extension was not preloaded by `thread_start`

## Selection Policy

The adopted decision order is:

1. if direct bounded work is enough, do that
2. otherwise, if a saved runnable entry clearly fits, run it
3. otherwise author a short-lived artifact workflow, usually reusing saved definitions, prompts, and components
4. run the authored artifact entry through `smithers_run_workflow({ workflowId, input, runId? })`
5. write reusable saved workflow files only on explicit request

Project CI is a special product lane over this same library.

Normal handlers may select a configured Project CI entry through `smithers_list_workflows({ productKind: "project-ci" })`.

CI configuration is owned by whichever handler thread has loaded the `project-ci` extension, either
from a `thread_start` creation-time extension override defined in
`docs/specs/extension/thread-managing.extension.spec.md` or from `load_extension({ extensionId: "project-ci" })`.

## Out Of Scope

This spec does not define:

- remote workflow registries
- marketplace-style sharing
- automatic save of all authored workflows into the reusable library
- a requirement that every saved asset be directly runnable
