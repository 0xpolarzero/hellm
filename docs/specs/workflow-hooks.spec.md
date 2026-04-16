# Workflow Hooks Spec

## Status

- Date: 2026-04-16
- Status: adopted direction for repo-local workflow hooks
- Scope of this document:
  - define the target product behavior for repo-local workflow hooks
  - explain how hooks fit into the shared command model
  - pin the first-slice hook boundary and the remaining open details

## Purpose

`svvy` needs a repo-local way to inject project-specific policy and context into consequential delegated workflows without turning the product into a rigid static workflow engine.

## Product Fit

The PRD and execution model define:

- one shared command model
- `workflow.start` and `workflow.resume` as native control tools
- Smithers as the delegated workflow executor
- repo-local workflow hooks under `.svvy/`

Workflow hooks are therefore:

- policy around delegated workflow commands
- not a separate execution path
- not a replacement for orchestrator routing
- not a way to turn control tools into `api.*` helpers

## Adopted Direction

The adopted `svvy` direction is:

- repo-local workflow hooks live under a `.svvy/` configuration surface
- consequential delegated workflows may be wrapped by two repo-local hooks:
  - `preflight`
  - `validation`
- hooks are part of product behavior, not one-off implementation glue
- hooks may use `execute_typescript` for generic context gathering or synthesis work
- hooks should shape workflow behavior without replacing orchestrator routing
- hook outputs should be durable enough to affect workflow execution, workflow records, episodes, and later debugging

## Consequential Workflow Policy

The first intended policy boundary is:

- repo-modifying work
- heavy work
- other delegated execution where repo-local policy should apply by default

These are the workflows that should normally pick up preflight and validation behavior.

## Placement In The Execution Model

Hooks live around `workflow.start` and `workflow.resume`.

In practice that means:

- the orchestrator decides to call `workflow.start` or `workflow.resume`
- the workflow handler discovers and runs any configured hooks
- hook execution emits durable command and event facts
- hook outputs may affect workflow status, workflow summary, artifacts, and resulting episodes
- if a hook needs generic computation, it may use `execute_typescript`
- if a hook needs to change product-level control flow, it must stay on the native control tools

## Preflight Hook

The preflight hook runs near the beginning of a consequential workflow.

Its purpose is to prepare the workflow with repo-local context or policy before the main delegated work executes.

Current intended uses include:

- aggregating context needed by the workflow
- expanding repo-local policy into executable or promptable inputs
- preparing variables or structured inputs for downstream steps
- influencing the first downstream agent or `execute_typescript` step with project-specific guidance

Adopted behavioral expectations:

- preflight runs before the main workflow body
- preflight may produce structured outputs for later workflow steps
- preflight should be visible in workflow-related command history and debugging surfaces
- preflight may create artifacts and influence the initial workflow summary

## Validation Hook

The validation hook runs near the end of a consequential workflow.

Its purpose is to apply repo-local validation before the workflow result is treated as complete.

Current intended uses include:

- enforcing repo-specific checks
- attaching a final validation step to consequential workflow runs
- producing explicit guidance about what to do when validation fails
- shaping whether the workflow is considered successful, waiting, or failed

Adopted behavioral expectations:

- validation runs after the main workflow body reaches a terminal candidate result
- validation may emit artifacts, structured outputs, and failure guidance
- validation results should influence normalized workflow outcome, not just appear as logs
- validation should be inspectable in workflow-related command history, workflow records, and resulting episodes

## Hook Inputs And Execution Style

The current intended model is flexible by design.

Hooks may involve:

- variables
- scripts
- prompts
- context aggregation
- structured outputs consumed by downstream workflow steps
- `execute_typescript` when generic capability composition is the cleanest implementation

The product requirement is flexibility, not a single hook authoring format in v1.

## State And Recording Expectations

Hooks should integrate with the structured session state model as follows:

- hook execution should create commands and lifecycle events
- meaningful hook outputs should be capturable in artifacts and episodes
- hook failures should influence workflow status rather than only showing up as hidden logs
- hook behavior should be understandable from the session UI and workflow inspection surfaces

Hooks must not bypass the shared command model or write arbitrary state directly.

## Non-Goals

This feature is not trying to:

- replace the orchestrator with a repo-defined static plan
- force every request through hooks
- turn repo policy into an opaque hidden side effect
- require one fixed scripting format before practical experience exists
- flatten workflow, verification, or wait control into `api.*`

## Open Details

These points are directionally important but still intentionally open:

- the exact `.svvy/` file format
- whether hook authoring is prompt-first, script-first, or hybrid
- how hook outputs are typed and passed into downstream workflow steps
- the exact failure semantics for validation in partially successful workflows
- how much preflight output should be projected back into the orchestrator versus only into downstream workflow steps

## Sources

### Local Sources

- [PRD](../prd.md)
- [Execution Model](../execution-model.md)
- [Structured Session State Spec](./structured-session-state.spec.md)
