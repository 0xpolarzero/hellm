# Workflow Library And Artifact Workflow Authoring

## Status

- Date: 2026-04-23
- Status: adopted direction for handler-owned workflow authoring, saved-library discovery, saved-library writes, and runtime validation feedback
- Scope of this document:
  - define the workspace-owned workflow library shape under `.svvy/workflows/`
  - define the authored artifact-workflow shape under `.svvy/artifacts/workflows/`
  - define handler-side workflow authoring guidance and discovery
  - define the runnable entry contract consumed by `smithers.list_workflows`
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

## Handler-Owned Authoring

Handler threads own workflow authoring.

Each handler thread receives bundled workflow-authoring guidance and curated examples in its prompt context.

The handler owns:

- deciding whether direct work is enough
- checking saved runnable entries
- checking reusable saved assets
- authoring a new artifact workflow when needed
- deciding whether reusable saved workflow files should be written
- writing those saved workflow files directly into `.svvy/workflows/...`
- checking the returned validation feedback before considering the write complete

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
- `components/`: reusable helpers and agent profiles
- `entries/`: launchable saved workflow entry wrappers

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
- accept prompt, profile, or config inputs where variation is expected
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
- agent profile values or factories

### Entries

Entry files are launchable workflow wrappers under `entries/`.

They are not returned by `api.workflow.listAssets(...)`.

They are returned by `smithers.list_workflows`.

## Discovery Metadata Contract

### TS Or TSX Asset Headers

Saved definitions and components should start with JSDoc metadata rich enough for discovery.

Normative example:

```ts
/**
 * @svvyAssetKind definition
 * @svvyId create_implement_review_verify
 * @svvyTitle Create Implement Review Verify
 * @svvySummary Reusable workflow factory for implement, review, and verification stages.
 * @svvyTags sequential, coding, review, verification
 * @svvyExports implementReviewVerifyLaunchSchema, createImplementReviewVerifyWorkflow
 */
```

For component assets, the same pattern applies with `@svvyAssetKind component`.

For agent profiles, the header should additionally declare:

- subtype such as `agent-profile`
- provider and model summary
- toolset summary

### MDX Prompt Frontmatter

Prompt files should use frontmatter metadata.

Normative example:

```mdx
---
svvyAssetKind: prompt
svvyId: review_base
title: Review Base
summary: Base review instructions reusable across review-oriented workflows.
tags:
  - review
  - reusable
variables:
  - objective
---
```

## Runnable Entry Contract

Each runnable entry file should export:

- `workflowId`
- `label`
- `summary`
- `launchSchema`
- `definitionPaths`
- `promptPaths`
- `componentPaths`
- `createRunnableEntry(...)`

The grouped asset refs are mandatory.

They are the source of truth for workflow source inspection.

For saved entries, every grouped asset ref must resolve to `.svvy/workflows/...`.

For artifact entries, grouped refs may mix saved-library paths and artifact-local paths.

The flat `assetPaths` value returned by `smithers.list_workflows` is derived from the union of the grouped refs.

`entryPath` is derived from the file location in the registry, not handwritten inside the module.

Normative shape:

```ts
export const workflowId = "implement_review_verify";
export const label = "Implement Review Verify";
export const summary = "Run sequential implement, review, and verification stages.";
export const launchSchema = implementReviewVerifyLaunchSchema;

export const definitionPaths = [
  ".svvy/workflows/definitions/create-implement-review-verify.tsx",
];

export const promptPaths = [".svvy/workflows/prompts/review-base.mdx"];

export const componentPaths = [".svvy/workflows/components/agent-profiles.tsx"];

export function createRunnableEntry(input: { dbPath: string }) {
  return {
    workflowId,
    workflowSource: "saved" as const,
    launchSchema,
    workflow: createImplementReviewVerifyWorkflow(...),
  };
}
```

## Handler Workflow-Authoring Flow

The adopted handler-side workflow-authoring flow is:

1. A handler thread decides that direct bounded work is not enough and a workflow is justified.
2. The handler uses its injected workflow-authoring guide and examples first.
3. The handler calls `api.workflow.listAssets(...)` as needed.
4. The handler reads promising saved definitions, prompts, components, or agent-profile files through ordinary file reads.
5. The handler optionally calls `api.workflow.listModels()` when it must create or revise an agent profile.
6. The handler authors a short-lived artifact workflow under `.svvy/artifacts/workflows/<artifact_workflow_id>/`.
7. The handler calls `smithers.list_workflows`, inspects the artifact entry, and launches it through `smithers.run_workflow({ workflowId, input, runId? })`.
8. If the user explicitly asks to keep reusable workflow files, the handler writes those files directly into `.svvy/workflows/...` through normal repo write APIs.
9. The handler reads the returned validation feedback in the enclosing `execute_typescript` result and keeps editing until the final saved workflow state validates cleanly.

## Discovery Surface

### Authoring-Time Asset Discovery

Handlers discover reusable assets through:

- `api.workflow.listAssets(input)`

This is the primary discovery surface for saved and artifact authoring assets.

It should support filters such as:

- `kind`: `definition | prompt | component`
- `subtype`: optional finer-grained filter such as `agent-profile`
- `tags`
- `pathPrefix`
- `exports`
- `scope`: `saved | artifact | both`

The response should return compact but exhaustive asset metadata, including:

- asset id
- asset kind
- asset subtype when relevant
- title
- summary
- tags
- path
- exported symbols when relevant
- prompt variables when relevant
- provider and model summary when relevant
- toolset summary when relevant
- source scope: `saved` or `artifact`
- created and updated timestamps when known

`listAssets(...)` does not list runnable entries.

### Provider And Model Discovery

Handlers use:

- `api.workflow.listModels()`

Each entry should include:

- provider id
- model id
- auth availability
- source of auth when useful for diagnostics
- capability flags the product already knows about

### Runnable Workflow Discovery

`smithers.list_workflows` is reserved for runnable workflow entries.

It should list all runnable entries:

- saved entries under `.svvy/workflows/entries/`
- artifact entries under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`

It should support optional filters such as:

- `workflowId?`
- `sourceScope?`

Each returned runnable workflow entry should include the full workflow contract data needed for handler-side selection and launch:

- `workflowId`
- `label`
- `summary`
- `sourceScope`: `saved | artifact`
- `entryPath`
- `definitionPaths`
- `promptPaths`
- `componentPaths`
- derived `assetPaths`
- `launchInputSchema`

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
- grouped asset refs for saved entries

Validation feedback is surfaced automatically in the enclosing `execute_typescript` result through captured console logs.

That means the handler does not need a separate follow-up tool call just to validate what it wrote.

### Completion Rule

Saved workflow edits may produce temporary validation errors while related files are being written one by one.

The final completion rule is:

- the handler should not treat the saved workflow state as complete until the returned validation feedback is clean

## UI Requirements

The desktop app should expose:

- a saved workflow library view rooted at `.svvy/workflows/`
- separate groupings for definitions, prompts, components, and entries
- explicit indication when a component is an agent profile
- asset detail views showing path, summary, tags, exported symbols or prompt variables, and last-updated metadata
- entry detail views showing entry path, summary, launch schema, and grouped asset refs
- delete actions for saved definitions, prompts, components, and entries
- a save shortcut on relevant workflow surfaces that sends a predefined save request prompt to the handler thread

The UI save affordance is a shortcut prompt to the handler thread.

## Handler Guidance

Handler-thread instructions should say:

- prefer direct `execute_typescript` for small one-off work that does not benefit from workflow supervision
- reuse a saved runnable entry when one clearly fits
- otherwise author a short-lived artifact workflow
- mix saved definitions, prompts, components, and agent profiles freely when that produces a clearer workflow than reusing one saved entry unchanged
- use saved agent profiles before creating new ones
- call `api.workflow.listModels()` only when no saved profile fits or the user explicitly wants a different provider or model
- write reusable saved workflow files only on explicit request
- rely on the returned validation feedback after writes under `.svvy/workflows/...`

## Selection Policy

The adopted decision order is:

1. if direct bounded work in `execute_typescript` is enough, do that
2. otherwise, if a saved runnable entry clearly fits, run it
3. otherwise author a short-lived artifact workflow, usually reusing saved definitions, prompts, components, or agent profiles
4. run the authored artifact entry through `smithers.run_workflow({ workflowId, input, runId? })`
5. write reusable saved workflow files only on explicit request

## Out Of Scope

This spec does not define:

- remote workflow registries
- marketplace-style sharing
- automatic save of all authored workflows into the reusable library
- a requirement that every saved asset be directly runnable
