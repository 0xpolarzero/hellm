# Workflow Library Spec

## Status

- Date: 2026-04-22
- Status: adopted direction for workflow-library discovery, save, and reuse
- Scope of this document:
  - define the product workflow-library shape exposed to handler threads
  - define how bundled templates, saved workflows, and authored custom workflows relate
  - define explicit save and delete behavior for reusable workflows

## Purpose

`svvy` needs a workflow library that is clear enough for agents to choose from without guessing and small enough that it does not pretend to know every recurring task in advance.

The library should provide:

- a tiny bundled set of structural templates
- workspace-saved reusable workflows when a user wants them available later
- one-off custom workflows authored on demand when the reusable layers do not fit

It should not ship a broad preset catalog that looks authoritative but is actually too vague or too brittle.

## Product Fit

The PRD defines:

- Smithers as the delegated execution substrate
- handler threads as the workflow-selection and supervision unit
- bundled structural templates under `src/bun/smithers-runtime/`
- workflow discovery through `smithers.list_workflows`

This means the workflow library is:

- a handler-thread decision aid
- a real runtime registry, not prompt-only guidance
- a product-owned discovery surface, not just access to `smithers.sh/llms-full.txt`
- separate from the repo-root `workflows/` authoring workspace used to build `svvy`

## Workflow Library Layers

The workflow library has three layers:

1. bundled structural templates
2. workspace-saved workflows
3. one-off authored custom workflows

### Bundled Structural Templates

The bundled set should stay intentionally small:

- `single_task`
- `ordered_steps`
- `parallel_branches`

These are reusable structural building blocks, not an exhaustive catalog of named business workflows.

Their purpose is to make good Smithers structure discoverable:

- one bounded task
- ordered multi-step execution
- parallel branches plus join

Verification is not a core structural template id.

Verification is a first-class workflow category built on the same runtime and may use the structural templates, saved workflows, or one-off authored workflows depending on the job.

### Workspace-Saved Workflows

Saved workflows are reusable runtime assets stored under the workspace-owned `.svvy/workflows/` area.

They come from authored custom workflows that a user or handler thread decided were worth keeping for later reuse.

Saved workflows are:

- discoverable by later handler threads through `smithers.list_workflows`
- launchable through the same generated `smithers.run_workflow.<workflow_id>` surface as bundled templates
- removable by the user from a saved-workflows library view

Saved workflows are not bundled app assets and are not repo-root authoring workflows.

### One-Off Authored Custom Workflows

When neither a saved workflow nor a bundled structural template is a good fit, the handler thread may author a custom workflow for the current delegated objective.

By default, that workflow is ephemeral.

It exists to solve the current objective unless it is later saved explicitly.

## Selection Policy

The handler-thread decision order is:

1. if a saved workflow clearly fits the objective and expected inputs or outputs, reuse it
2. otherwise choose the smallest bundled structural template that handles the work clearly
3. otherwise author a custom workflow
4. execute the selected workflow

Handlers should prefer clarity over forced reuse.

They should not stretch an almost-fitting saved workflow or template past the point where the workflow becomes misleading.

## Discovery Contract

`smithers.list_workflows` should expose a workflow library view that is explicit enough for handlers to choose the right workflow without opening source files.

The response should group workflows by source:

- bundled templates
- saved workflows

Each discoverable workflow entry should include:

- `id`
- `workflowSource`
- `label`
- `description`
- `launchToolName`
- `baseTemplateId`
- `launchInputSchema`
- `bestFor`
- `avoidWhen`

The grouped response should make it obvious which workflows are product-shipped structural templates and which are workspace-specific saved workflows.

## Save Behavior

Newly authored custom workflows remain ephemeral until an explicit save action happens.

The product should support two save paths:

- the user clicks `Save workflow` in the UI
- the handler thread saves the workflow when the user explicitly asks for that

When a custom workflow looks reusable but no explicit save request has happened yet, the handler should propose saving it instead of silently cluttering the workspace library.

## Storage Shape

Saved workflows live under:

- `.svvy/workflows/<workflow_id>/workflow.tsx`
- `.svvy/workflows/<workflow_id>/manifest.json`

The manifest should include enough metadata for discovery and UI:

- stable workflow id
- title
- description
- base template id when relevant
- created and updated timestamps

Historical workflow-run records must stay inspectable even if a saved workflow is later deleted from the workspace library.

Deleting a saved workflow removes it from future discovery and launch, not from historical run provenance.

## UI Requirements

The desktop app should expose:

- a `Save workflow` action on saveable authored workflows
- a saved-workflows tab in the workspace shell
- saved-workflow list items with title, description, base template, and recency metadata
- delete actions for saved workflows

Bundled templates should not appear as deletable saved workflows.

## Agent Guidance

Handler-thread instructions should say:

- inspect the workflow library before inventing a reusable workflow from scratch
- save a workflow when the user asks
- propose saving when a newly authored workflow looks reusable in future objectives
- do not auto-save every custom workflow

## Out Of Scope

This spec does not define:

- a broad preset catalog
- import or export of workflow libraries between workspaces
- remote workflow registries
- marketplace-style workflow sharing
