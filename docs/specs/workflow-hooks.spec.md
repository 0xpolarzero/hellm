# Workflow Hooks Spec

## Status

- Date: 2026-04-09
- Status: early adopted direction for repo-local workflow hooks
- Scope of this document:
  - define the target product behavior for repo-local preflight and validation hooks
  - capture the currently adopted workflow-hook decisions and open details
  - make explicit what is adopted now versus what is still intentionally open

## Purpose

`svvy` needs a repo-local way to inject project-specific policy and context into consequential delegated work without turning the product into a rigid static workflow engine.

This document defines that initial direction.

## Product Fit

The PRD defines:

- delegated Smithers workflows as the default substrate for consequential delegated work
- repo-local workflow hooks under `.svvy/`
- preflight hooks at the start of consequential workflows
- validation hooks at the end of consequential workflows

Sources:

- `docs/prd.md`
- `docs/execution-model.md`

## Adopted Direction

The adopted `svvy` direction is:

- repo-local workflow hooks live under a `.svvy/` configuration surface
- consequential delegated workflows may be wrapped by two repo-local hooks:
  - `preflight`
  - `validation`
- these hooks are part of product behavior, not one-off implementation glue
- hooks should shape workflow behavior without replacing orchestrator routing
- hook outputs should be durable enough to affect workflow execution, episode content, and later debugging

Nothing below should be read as making the feature more rigid than that.

## Consequential Workflow Policy

The first intended policy boundary is:

- repo-modifying work
- heavy work
- other delegated execution where repo-local policy should apply by default

These are the workflows that should normally pick up preflight and validation behavior.

Not every trivial delegated action needs hooks. The point is to wrap the workflows where local policy, extra context, or required checks materially improve outcomes.

## Preflight Hook

The preflight hook runs at the beginning of a consequential workflow.

Its purpose is to prepare the workflow with repo-local context or policy before the main work executes.

Current intended uses include:

- aggregating context needed by the workflow
- expanding repo-local policy into executable or promptable inputs
- preparing variables or structured inputs for downstream steps
- influencing the first downstream agent or code-execution step with project-specific guidance

Adopted behavioral expectations:

- preflight runs before the main workflow body
- preflight may produce structured outputs for later workflow steps
- preflight should be able to affect the context seen by the first meaningful downstream task
- preflight should be visible in workflow state and inspectable when debugging

## Validation Hook

The validation hook runs at the end of a consequential workflow.

Its purpose is to apply repo-local validation before the workflow result is treated as complete.

Current intended uses include:

- enforcing repo-specific checks
- attaching a final validation step to every consequential workflow run
- producing explicit guidance about what to do when validation fails
- shaping whether the workflow is considered successful, blocked, or failed

Adopted behavioral expectations:

- validation runs after the main workflow body reaches a terminal candidate result
- validation may emit artifacts, structured outputs, and failure guidance
- validation results should influence the normalized workflow outcome, not just appear as logs
- validation should be inspectable in workflow state and resulting episodes

## Hook Inputs and Execution Style

The current intended model is flexible by design.

Hooks may involve:

- variables
- scripts
- prompting
- context aggregation
- structured outputs consumed by downstream steps

The product requirement is flexibility, not a single hook authoring format in v1.

## Integration Expectations

Workflow hooks should integrate with the rest of the product as follows:

- the orchestrator still decides whether to use the delegated workflow path
- Smithers still executes the delegated workflow
- preflight runs near workflow start
- validation runs near workflow end
- hook outputs and failures should surface in workflow state
- meaningful hook outputs should be capturable in artifacts and episodes
- hook behavior should be understandable from the session UI and headless outputs

## Non-Goals

This feature is not trying to:

- replace the orchestrator with a repo-defined static plan
- force every request through hooks
- turn repo policy into an opaque hidden side effect
- require one fixed scripting format before practical experience exists

## Open Details

These points are directionally important but still intentionally open:

- the exact `.svvy/` file format
- whether hook authoring is prompt-first, script-first, or hybrid
- how hook outputs are typed and passed into downstream workflow steps
- the exact failure semantics for validation in partially successful workflows
- how much preflight output should be projected back into the orchestrator versus only into downstream workflow steps
