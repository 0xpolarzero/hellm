# Workflow Library, Authoring Assets, And Runnable Entries Spec

## Status

- Date: 2026-04-22
- Status: adopted direction for workflow authoring, saved asset reuse, runnable entries, and artifact promotion
- Scope of this document:
  - define the workspace-owned workflow library shape under `.svvy/workflows/`
  - define the authored artifact workflow shape under `.svvy/artifacts/workflows/`
  - define authoring-time discovery for reusable workflow assets and agent profiles
  - define the runnable entry contract consumed by `smithers.list_workflows`
  - define explicit save and promotion behavior

## Purpose

`svvy` needs one clear split between reusable workflow building blocks and launchable workflow entrypoints.

The reusable value lives in:

- definitions with stable workflow structure
- prompts that can be mixed, reused, and overridden
- components such as helpers and agent profiles
- runnable entries that bind reusable assets into a concrete launchable workflow

The product should optimize for:

- authoring a workflow that fits the current delegated objective
- preserving every authored workflow as a durable artifact
- promoting only the reusable files the user explicitly wants to keep
- letting later actors discover reusable assets through `api.workflow.*`
- letting handlers discover launchable workflows through `smithers.*`

## Core Distinction

`svvy` uses two related but different workflow concepts:

- reusable workflow assets for authoring
- runnable workflow entries for launch and supervision

The naming rule is:

- `api.workflow.listAssets(...)` and `api.workflow.listModels()` are authoring-time discovery tools inside `execute_typescript`
- `smithers.list_workflows` and `smithers.run_workflow.<workflow_id>` are handler-thread launch and supervision tools

This split is intentional.

Asset discovery is not workflow launch.

## Adopted Model

- reusable saved assets live under `.svvy/workflows/definitions/`, `.svvy/workflows/prompts/`, and `.svvy/workflows/components/`
- runnable saved entries live under `.svvy/workflows/entries/`
- authored artifact workflows live under `.svvy/artifacts/workflows/<artifact_workflow_id>/`
- artifact workflows may contain their own `definitions/`, `prompts/`, `components/`, and `entries/` folders when relevant
- runnable entries are thin launchable wrappers around reusable assets or explicit inline defaults
- `smithers.list_workflows` lists all runnable entries, whether they live under the saved library or an artifact workflow
- runnable entry grouped asset refs are mandatory and explicit
- save is explicit promotion of selected reusable files out of an artifact workflow into `.svvy/workflows/`

## Design Principles

### 1. Definitions Are Reusable Structure

Saved definitions should usually export stable factories or builders.

They should accept variation through:

- prompt text
- prompt asset inputs
- component or profile inputs
- ordinary workflow config inputs

Saved definitions are the reusable structural layer, not the default place to bake one objective-specific prompt forever.

### 2. Entries Are Launchable Wrappers

A runnable entry is the launchable wrapper that a handler can execute directly.

An entry should:

- publish one launch schema
- identify the reusable assets it depends on
- bind default saved prompts or profiles when that makes sense
- remain thin enough that future artifact workflows can still wrap the underlying definition differently

The normal pattern is:

- definition = reusable factory
- entry = launchable wrapper
- artifact entry = current-objective wrapper

### 3. Prompts And Components Stay Composable

Prompts, components, and agent profiles are independent reusable files.

That means:

- a saved definition may accept a prompt override instead of importing one directly
- a saved entry may bind a saved prompt as the default if no override is supplied
- an artifact entry may reuse a saved prompt, layer additional guidance on top, or replace it entirely
- a saved prompt may be reusable even if no saved entry currently uses it

### 4. Every Authored Workflow Is A Durable Artifact First

When an actor writes a workflow for the current objective, that workflow should be persisted under `.svvy/artifacts/` by default even if it is never saved for reuse.

This gives:

- provenance
- inspectability
- reproducibility
- a durable source object for later selective save

### 5. Save Is Explicit Reuse Curation

Saving should promote the reusable files the user wants to keep.

It should not imply blindly copying one artifact folder into the saved library.

The save flow may promote:

- definitions
- prompts
- components
- entries

Each promoted file should remain meaningful in its new saved location.

### 6. Agent Profiles Are Components

Agent profiles should live in `components/`.

They should be reusable component values or factories that define at least:

- provider
- model
- reasoning effort when relevant
- tool surface
- instructions or system prompt content

Profiles are discovered through `api.workflow.listAssets(...)`, not through a separate profile registry.

### 7. Model Discovery Is The Escape Hatch

Most workflows should reuse saved agent profiles.

`api.workflow.listModels()` exists for the cases where:

- no saved profile fits
- a new profile is being authored
- the user explicitly wants a different provider or model

## Storage Layout

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

### Artifact Metadata

`metadata.json` should include enough provenance for UI and save flows:

- artifact workflow id
- owning session or thread ids when relevant
- creation timestamp
- latest update timestamp
- originating objective summary
- authoring actor identity
- entry path
- last known execution status if it was run

## Saved File Kinds

### Definition Assets

Definition assets are reusable workflow structure.

The usual saved-definition pattern is:

- export a workflow factory or builder
- accept prompt, profile, or config inputs where variation is expected
- avoid closing over artifact-local state

### Prompt Assets

Prompt assets are `mdx` files with frontmatter metadata.

They are saved independently so later workflows can:

- reuse them directly
- layer additional task-specific guidance on top
- substitute a different prompt without rewriting the definition

### Component Assets

Component assets are reusable TS or TSX files that are not themselves runnable entries.

Examples:

- helpers
- schema utilities
- workflow building blocks
- agent profile values or factories

### Entry Files

Entry files are launchable workflow wrappers under `entries/`.

They are not returned by `api.workflow.listAssets(...)`.

They are returned by `smithers.list_workflows`.

## Discovery Metadata Contract For Assets

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

- profile subtype or tag
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

The grouped refs may include both saved and artifact paths when an artifact entry mixes saved assets with artifact-local files.

The flat `assetPaths` value returned by `smithers.list_workflows` is derived from the union of those grouped refs.

`entryPath` is derived from the file location in the registry, not handwritten inside the module.

### Normative Entry Shape

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

## Discovery Contract

### Authoring-Time Asset Discovery

The workflow-writing actor should discover reusable assets through:

- `api.workflow.listAssets(input)`

This is the adopted primary discovery surface for saved and artifact authoring assets.

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

After listing, the actor should inspect promising files through ordinary file reads.

### Provider And Model Discovery

The workflow-writing actor should use:

- `api.workflow.listModels()`

Each entry should include:

- provider id
- model id
- auth availability
- source of auth when useful for diagnostics
- any capability flags the product already knows about

### Runnable Workflow Discovery

`smithers.list_workflows` is reserved for runnable workflow entries.

It should list all runnable entries:

- saved entries under `.svvy/workflows/entries/`
- artifact entries under `.svvy/artifacts/workflows/<artifact_workflow_id>/entries/`

Each returned runnable workflow entry should include:

- `id`
- `label`
- `summary`
- `sourceScope`: `saved | artifact`
- `launchToolName`
- `launchInputSchema`
- `entryPath`
- `definitionPaths`
- `promptPaths`
- `componentPaths`
- derived `assetPaths`

This preserves the intended split:

- `api.workflow.*` for authoring-time asset discovery
- `smithers.*` for launch and supervision

## Workflow Authoring Flow

The adopted workflow-authoring flow is:

1. A handler thread decides that direct bounded work is not enough and a workflow is justified.
2. The workflow-writing actor receives:
   - the delegated objective
   - the bundled authoring guide
   - bundled best-practice examples
   - `svvy` conventions for assets, entries, and imports
3. The actor calls `api.workflow.listAssets(...)` as needed.
4. The actor reads promising saved definitions, prompts, components, or agent-profile files through ordinary file reads.
5. The actor optionally calls `api.workflow.listModels()` when it must create or revise an agent profile.
6. The actor writes a short-lived artifact workflow under `.svvy/artifacts/workflows/<artifact_workflow_id>/`.
7. The handler calls `smithers.list_workflows`, inspects the artifact entry, and launches it through `smithers.run_workflow.<workflow_id>`.
8. If the workflow proves reusable and the user explicitly asks to save it, the product promotes the selected reusable files into `.svvy/workflows/`.

## Reuse Model

Saved reusable workflow assets should be consumed by entries and later artifact workflows.

The preferred reuse model is:

- import a saved definition
- import useful saved prompts or components
- bind defaults in a saved entry when direct reuse is valuable
- bind current-objective overrides in an artifact entry when customization is needed
- run the selected entry through `smithers.run_workflow.<workflow_id>`

The normal layering is:

- saved definition exports a reusable factory
- saved entry binds the default saved prompts or profiles for a common case
- artifact entry wraps the same definition with objective-specific prompts, profiles, or config

This keeps definitions, prompts, components, and entries composable instead of treating them as frozen packages.

## Save And Promotion Behavior

### Default Rule

Authored workflows remain artifact-only until an explicit save action happens.

### Save Triggers

Saving should happen only when:

- the user clicks `Save workflow`
- the user explicitly asks the handler or workflow-writing actor to save reusable pieces

If a workflow looks broadly reusable and the user has not asked to save it, the handler should propose saving it instead of doing so silently.

### Promotion Semantics

Saving promotes the selected reusable files out of an artifact workflow into the saved library.

Saving should:

- identify which definitions, prompts, components, or entries are worth keeping
- copy those files into the matching `.svvy/workflows/` subdirectories
- preserve or improve their metadata
- rewrite imports when needed so the saved files are stable in their saved location
- keep the original artifact workflow intact for provenance

Promotion is selective.

The actor may decide that:

- only a prompt is worth saving
- only a component or agent profile is worth saving
- a definition is worth saving but the artifact entry is too objective-specific
- an entry is worth saving after it has been generalized into a stable saved wrapper

If a saved entry is promoted, it should remain a meaningful saved runnable entry in its new location.

That means it should reference the saved assets it depends on through its explicit grouped asset refs or carry intentional inline defaults.

## UI Requirements

The desktop app should expose:

- a `Save workflow` action for artifact workflows
- a saved workflow library view rooted at `.svvy/workflows/`
- separate groupings for:
  - definitions
  - prompts
  - components
  - entries
- explicit indication when a component is an agent profile
- asset detail views showing:
  - path
  - summary
  - tags
  - exported symbols or prompt variables
  - last-updated metadata
- entry detail views showing:
  - entry path
  - summary
  - launch schema
  - grouped asset refs
- delete actions for saved definitions, prompts, components, and entries

## Handler Guidance

Handler-thread instructions should say:

- prefer direct `execute_typescript` for small one-off work that does not benefit from workflow supervision
- reuse a saved runnable entry when one clearly fits
- otherwise author a short-lived artifact workflow
- mix saved definitions, prompts, components, and agent profiles freely when that produces a clearer workflow than reusing one saved entry unchanged
- use saved agent profiles before creating new ones
- call `api.workflow.listModels()` only when no saved profile fits or the user explicitly wants a different provider or model
- propose saving reusable pieces when they look broadly reusable

## Workflow-Writing Actor Guidance

The workflow-writing actor should be instructed to:

- rely on the injected authoring guide and examples first
- use `api.workflow.listAssets(...)` to discover reusable assets
- read the most relevant assets directly before reusing them
- treat definitions, prompts, components, and agent profiles as composable assets
- keep artifact workflows small and explicit
- extract reusable prompts and profiles into their own files when appropriate
- write saved definitions as reusable factories when future variation is likely
- keep saved entries thin and explicit

## Selection Policy

The adopted decision order is:

1. if direct bounded work in `execute_typescript` is enough, do that
2. otherwise, if a saved runnable entry clearly fits, run it
3. otherwise author a short-lived artifact workflow, usually reusing saved definitions, prompts, components, or agent profiles
4. run the authored artifact entry through `smithers.run_workflow.<workflow_id>`
5. save reusable files only on explicit request

## Out Of Scope

This spec does not define:

- remote workflow registries
- marketplace-style sharing
- automatic save of all authored workflows into the reusable library
- a search API for bundled examples
- a requirement that every saved asset be directly runnable
