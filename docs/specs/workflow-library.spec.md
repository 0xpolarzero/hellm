# Workflow Library And Artifact Workflow Authoring

## Status

- Date: 2026-04-23
- Status: adopted direction for handler-owned workflow authoring, saved-library discovery, saved-library writes, product entry metadata, and runtime validation feedback
- Scope of this document:
  - define the workspace-owned workflow library shape under `.svvy/workflows/`
  - define the authored artifact-workflow shape under `.svvy/artifacts/workflows/`
  - define handler-side workflow authoring guidance, generated contracts, and discovery
  - define the runnable entry contract consumed by `smithers.list_workflows`
  - define optional product metadata and result schemas for special product lanes such as Project CI
  - define how saved workflow files are written and validated

## Purpose

`svvy` needs one clear split between:

- reusable workflow source assets kept in the workspace library
- short-lived artifact workflows authored for one delegated objective
- runnable entries used by handler threads to launch Smithers workflows

The product should optimize for:

- using direct `execute_typescript` when a workflow is unnecessary
- reusing a saved runnable entry when one clearly fits
- authoring a short-lived artifact workflow when saved entries do not fit
- writing reusable saved workflow files only when the user explicitly asks for that
- surfacing validation feedback automatically when saved workflow files are written
- keeping exact handler-authored workflow and workflow task-agent shapes in generated TypeScript declarations

## Core Model

`svvy` uses three related but different workflow concepts:

- reusable saved workflow assets for authoring
- runnable workflow entries for launch and supervision
- authored artifact workflows as durable filesystem source for one delegated objective

The naming rule is:

- `api.workflow.*` is the handler's authoring-time discovery surface inside `execute_typescript`
- `api.repo.writeFile(...)` and `api.repo.writeJson(...)` are the handler's write surface for saved workflow files
- `smithers.*` is the handler's launch and supervision surface

This split is intentional.

Asset discovery and saved-library writes are not workflow launch.

Exact `api.*` shapes are provided by the generated `execute_typescript` declaration. Exact handler-authored runnable entry and workflow task-agent shapes are provided by the generated workflow-authoring declaration.

## Handler-Owned Authoring

Handler threads own workflow authoring.

Each handler thread receives generated workflow-authoring TypeScript declarations plus bundled workflow-authoring guidance and curated examples in its prompt context.

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
- `components/`: reusable helpers and workflow agents
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
- workflow agent values or factories

Workflow agent files are ordinary component files that export values conforming to the generated `WorkflowTaskAgentConfig` contract. The conventional saved workflow agents live in `.svvy/workflows/components/agents.ts` and export `explorer`, `implementer`, and `reviewer`. App settings seed and synchronize those three conventional exports by writing the component file directly; workflow discovery and validation still treat it as a normal saved component asset. Workflow definitions and entries use Smithers `AgentLike` values for adaptive task execution, with the workflow agent configuration describing the svvy task-agent model, prompt, reasoning, and task-local tool surface.

A handler lists component assets and reads candidate component files before using their exported values.

### Entries

Entry files are launchable workflow wrappers under `entries/`.

They are not returned by `api.workflow.listAssets(...)`.

They are returned by `smithers.list_workflows`.

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

The header is a compact index. Handlers read the file through `api.repo.readFile(...)` when they need source context.

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

The flat `assetPaths` value returned by `smithers.list_workflows` is derived from the union of the grouped refs.

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
3. The handler calls `api.workflow.listAssets(...)` as needed.
4. The handler reads promising saved definitions, prompts, or component files through ordinary file reads before relying on implementation details.
5. The handler reads `.svvy/workflows/components/agents.ts` when a Smithers task needs a reusable explorer, implementer, or reviewer.
6. The handler optionally calls `api.workflow.listModels()` when it must create or revise a workflow agent.
7. The handler authors a short-lived artifact workflow under `.svvy/artifacts/workflows/<artifact_workflow_id>/`, including artifact-local workflow agents when the conventional saved agents are not a good fit.
8. The handler calls `smithers.list_workflows`, inspects the artifact entry, and launches it through `smithers.run_workflow({ workflowId, input, runId? })`.
9. If the user explicitly asks to keep reusable workflow files, the handler writes those files directly into `.svvy/workflows/...` through normal repo write APIs.
10. The handler reads the returned validation feedback in the enclosing `execute_typescript` result and keeps editing until the final saved workflow state validates cleanly.

## Discovery Surface

### Authoring-Time Asset Discovery

Handlers discover reusable assets through:

- `api.workflow.listAssets(input)`

This is the primary discovery surface for saved and artifact authoring assets.

The generated `execute_typescript` declaration is the exact input and output contract for this method.

`listAssets(...)` returns the enforced asset identity metadata plus a workspace-relative `path`.

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

Runnable entries are discovered through `smithers.list_workflows`.

### Provider And Model Discovery

Handlers use:

- `api.workflow.listModels()`

The generated `execute_typescript` declaration is the exact result contract for model discovery.

### Runnable Workflow Discovery

`smithers.list_workflows` is reserved for runnable workflow entries.

It should list all runnable entries:

- saved entries under `.svvy/workflows/entries/`
- artifact entries under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`

It should support optional filters such as:

- `workflowId?`
- `productKind?`
- `sourceScope?`

Each returned runnable workflow entry includes the handler-visible launch contract compiled from the generated workflow-authoring contract plus the entry's launch schema.

This preserves the intended split:

- `api.workflow.*` for authoring-time asset discovery
- `api.repo.writeFile(...)` and `api.repo.writeJson(...)` for saved-library writes
- `smithers.*` for launch and supervision

### Workflow Launch Surface

`smithers.run_workflow` is the stable handler launch surface.

Handlers call:

- `smithers.run_workflow({ workflowId, input, runId? })`

Where:

- `workflowId` selects a runnable entry returned by `smithers.list_workflows`
- `input` is validated against that entry's `launchInputSchema`
- `runId` is optional and is used only when the handler intends to resume the same Smithers run and Smithers still considers that run resumable

## Saved Workflow Writes

### Write Surface

Handlers write reusable saved workflow files through:

- `api.repo.writeFile(...)`
- `api.repo.writeJson(...)`

The handler writes the final file contents directly into `.svvy/workflows/...`.

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

Validation feedback is surfaced automatically in the enclosing `execute_typescript` result through captured console logs.

That means the handler does not need a separate follow-up tool call just to validate what it wrote.

### Completion Rule

Saved workflow edits may produce temporary validation errors while related files are being written one by one.

The final completion rule is:

- the handler should not treat the saved workflow state as complete until the returned validation feedback is clean

## UI Requirements

The desktop app should expose:

- a read-only saved workflow library view rooted at `.svvy/workflows/`
- separate groupings for definitions, prompts, components, entries, and artifact workflows
- asset detail views showing title, summary, kind, path, source preview, validation status, and diagnostics
- entry detail views showing entry path, summary, launch schema, grouped asset refs, validation status, and diagnostics
- an open-in-editor action that opens the selected source file in the user's configured external editor
- delete actions for saved definitions, prompts, components, and entries
- a save shortcut on relevant workflow surfaces that sends a predefined save request prompt to the handler thread

The UI save affordance is a shortcut prompt to the handler thread.

The saved workflow library surface must not block on an in-app source editor. In-app editing, syntax highlighting, inline diagnostics, and file-tree integration are later editor-surface capabilities. Until those exist, this surface owns workflow-library discovery and inspection, while source editing happens through the configured external editor.

## Handler Guidance

Handler-thread instructions should say:

- prefer direct `execute_typescript` for small one-off work that does not benefit from workflow supervision
- use generated declarations for exact `api.*`, runnable-entry, and workflow task-agent shapes
- reuse a saved runnable entry when one clearly fits
- otherwise author a short-lived artifact workflow
- mix saved definitions, prompts, and components freely when that produces a clearer workflow than reusing one saved entry unchanged
- read `.svvy/workflows/components/agents.ts` before creating new workflow agents and reuse `explorer`, `implementer`, or `reviewer` when one clearly fits
- define task-specific workflow agents inside the current artifact workflow when the conventional saved agents do not fit
- call `api.workflow.listModels()` only when no saved workflow agent fits or the user explicitly wants a different provider or model
- write reusable saved workflow files only on explicit request
- rely on the returned validation feedback after writes under `.svvy/workflows/...`
- discover and run configured Project CI entries when CI is needed
- call `request_context({ keys: ["ci"] })` before configuring or modifying Project CI assets

## Selection Policy

The adopted decision order is:

1. if direct bounded work in `execute_typescript` is enough, do that
2. otherwise, if a saved runnable entry clearly fits, run it
3. otherwise author a short-lived artifact workflow, usually reusing saved definitions, prompts, and components
4. run the authored artifact entry through `smithers.run_workflow({ workflowId, input, runId? })`
5. write reusable saved workflow files only on explicit request

Project CI is a special product lane over this same library.

Normal handlers may select a configured Project CI entry through `smithers.list_workflows({ productKind: "project-ci" })`.

CI configuration is owned by whichever handler thread has loaded the typed `ci` context pack, either from `thread.start({ context: ["ci"] })` or from `request_context({ keys: ["ci"] })`.

## Out Of Scope

This spec does not define:

- remote workflow registries
- marketplace-style sharing
- automatic save of all authored workflows into the reusable library
- a requirement that every saved asset be directly runnable
