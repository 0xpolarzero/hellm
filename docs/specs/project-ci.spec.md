# Project CI Lane Spec

## Status

- Date: 2026-04-24
- Status: adopted direction for project CI configuration, execution, persistence, and UI
- Scope of this document:
  - define the dedicated Project CI product lane
  - define how CI assets live inside the existing Smithers saved workflow library
  - define the CI runnable-entry contract
  - define when CI state is recorded
  - define how handler threads load CI authoring context only when needed

Typed context-pack mechanics are defined in [Handler Context Packs Spec](./handler-context-packs.spec.md).

## Naming

The product feature is called **Project CI**.

Use these terms consistently:

- **Project CI**: the dedicated product lane for configuring and running the repository's repeatable confidence checks.
- **CI lane**: the UI entry point that opens or focuses a normal handler thread with the `ci` context pack loaded.
- **CI context pack**: the typed optional context loaded by `thread.start({ context: ["ci"] })` or by a handler calling `request_context({ keys: ["ci"] })`.
- **CI entry**: a normal Smithers runnable saved workflow entry that declares `productKind = "project-ci"`.
- **CI run**: one Smithers workflow run launched from a CI entry and recorded as Project CI state.
- **CI check result**: one structured check inside a CI run, such as typecheck, test, lint, build, integration, or manual check.

Do not use `verification` as the product model name.

Use `validation` only for schema validation, saved-workflow validation, launch-input validation, and result-output validation.

## Purpose

Project CI gives `svvy` a reliable way to answer:

- what checks this repository considers important
- when those checks last ran
- whether they passed, failed, were skipped, were cancelled, or were blocked
- which handler thread and workflow run produced those results
- which logs and artifacts explain failures

The important constraint is reliability.

Project CI must be first-class without becoming a large extra concept that every ordinary workflow author has to learn.

That means:

- no heuristic inference from arbitrary workflow outputs
- no parsing node logs or final text to guess check results
- no custom `svvy` CI component that agents must import into every workflow
- no fake default CI that claims the project passed without running real checks
- no CI authoring prompt injected into normal handler threads
- no Project CI-specific runtime profile in the adopted model

## Non-Goals

Project CI does not:

- replace Smithers workflow execution
- create a second CI engine outside Smithers
- require every workflow to include CI steps
- scan arbitrary workflow runs looking for CI-shaped output
- infer test, lint, build, or manual outcomes from logs
- scaffold a passing placeholder command such as `echo ok`
- require every repository to have `test`, `lint`, `typecheck`, or `build` scripts
- preload CI authoring context into every normal handler thread
- treat one-off user-requested commands as durable Project CI unless they run through a declared CI entry

## Product Shape

Project CI is a dedicated lane beside normal orchestrator and handler work.

The UI should expose at least:

- a `Configure CI` action when Project CI is not configured
- a `Run CI` action when one or more CI entries are configured
- a Project CI surface that shows configuration status, latest CI run, check results, and linked artifacts
- a clear `CI not configured` state instead of fake green status

The `Configure CI` action starts or focuses a normal handler thread with the `ci` context pack loaded.

Mechanically, this is the same handler-thread actor class and default handler runtime shape used for other delegated work.

The difference is only the loaded context keys.

Ordinary orchestrator and handler sessions do not receive the `ci` context pack by default.

Runtime profiles and context packs are different concepts.

A runtime profile describes execution shape, such as model, reasoning, and tool surface.

A context pack describes optional product knowledge and instructions.

Project CI uses the default handler runtime profile plus the `ci` context pack.

## Actor Responsibilities

### Normal Orchestrator

This is the normal `svvy` orchestrator.

There is no CI-specific orchestrator.

There is also no special CI-specific `thread.start` tool.

The orchestrator may:

- tell the user whether Project CI is configured
- open the CI lane when the user asks to configure checks by calling `thread.start` with `context: ["ci"]`
- delegate implementation work to normal handler threads
- reconcile handoffs that include CI state

The orchestrator knows only a lightweight routing fact:

- `ci` is an available handler context key for Project CI authoring.

The orchestrator should not receive Smithers workflow tools directly.

The orchestrator should not author CI entries itself.

The orchestrator should not receive `request_context`.

`request_context` is a handler-only tool.

### Handler With `ci` Context

A handler thread that has loaded the `ci` context pack owns Project CI configuration work.

It is still a normal handler thread.

It receives `ci` context explaining how to:

- inspect the repository for likely checks
- inspect `package.json`, lockfiles, task runners, existing CI files, Makefiles, README docs, and test config
- ask the user what should always be checked when confidence is low
- suggest an initial CI shape without pretending every repo has the same scripts
- write CI workflow assets under the existing saved workflow library
- validate saved workflow files after writes
- run the CI entry and refine it until the result contract is valid

A handler with `ci` context may write reusable CI assets under `.svvy/workflows/.../ci/`.

A handler with `ci` context may run Project CI entries through Smithers.

The `ci` context may be loaded in either of two ways:

- the orchestrator starts the handler with `thread.start({ objective, context: ["ci"] })`
- an existing handler calls `request_context({ keys: ["ci"] })`

Loading the same context key more than once is idempotent.

### Normal Handler Threads

Normal handler threads may:

- discover configured CI entries with `smithers.list_workflows`
- run a configured CI entry with `smithers.run_workflow`
- inspect CI run state and artifacts
- mention CI status in a handoff when relevant
- call `request_context({ keys: ["ci"] })` if they need to configure or modify Project CI

Normal handler threads start without:

- the CI authoring guide
- repository-specific CI assumptions
- knowledge of how to write CI entries beyond the existence of the `ci` context key

If a normal handler only needs to run existing CI, it does not need the `ci` context pack.

If a normal handler needs to configure or modify Project CI, it should first call:

```ts
request_context({ keys: ["ci"] });
```

If a normal handler wants confidence checks and no CI entry exists, it should either:

- ask the user to configure Project CI
- call `request_context({ keys: ["ci"] })` when the current thread should configure it
- run explicitly user-provided commands as ordinary commands, not as Project CI records

## Storage Layout

Project CI uses the normal saved workflow library.

Reusable CI assets live under CI subdirectories:

```text
.svvy/workflows/
  definitions/
    ci/
  prompts/
    ci/
  components/
    ci/
  entries/
    ci/
```

The default project entry should be:

```text
.svvy/workflows/entries/ci/project-ci.tsx
```

The default workflow id should be:

```text
project_ci
```

Additional CI entries are allowed when they represent distinct repeatable lanes, such as:

- `project_ci_fast`
- `project_ci_release`
- `project_ci_docs`

Artifact workflows may still be used while a handler with `ci` context experiments:

```text
.svvy/artifacts/workflows/<artifact_workflow_id>/
  definitions/
  prompts/
  components/
  entries/
  metadata.json
```

Reusable Project CI configuration is not complete until a handler with `ci` context writes a saved CI entry under `.svvy/workflows/entries/ci/`.

## CI Entry Contract

A CI entry is a normal runnable Smithers entry with additional product metadata.

Every runnable entry still exports:

- `workflowId`
- `label`
- `summary`
- `launchSchema`
- `definitionPaths`
- `promptPaths`
- `componentPaths`
- `createRunnableEntry(...)`

A CI entry additionally exports:

- `productKind = "project-ci" as const`
- `resultSchema`

Normative shape:

```ts
import { z } from "zod";
import {
  createProjectCiWorkflow,
  projectCiLaunchSchema,
  projectCiResultSchema,
} from "../../definitions/ci/project-ci";

export const workflowId = "project_ci";
export const label = "Project CI";
export const summary = "Run the repository's configured Project CI checks.";
export const productKind = "project-ci" as const;
export const launchSchema = projectCiLaunchSchema;
export const resultSchema = projectCiResultSchema;

export const definitionPaths = [
  ".svvy/workflows/definitions/ci/project-ci.tsx",
] as const;

export const promptPaths = [
  ".svvy/workflows/prompts/ci/check-policy.mdx",
] as const;

export const componentPaths = [
  ".svvy/workflows/components/ci/check-runner.tsx",
] as const;

export function createRunnableEntry(input: { dbPath: string }) {
  return {
    workflowId,
    workflowSource: "saved" as const,
    productKind,
    launchSchema,
    resultSchema,
    workflow: createProjectCiWorkflow({ dbPath: input.dbPath }),
  };
}
```

`smithers.list_workflows` must return `productKind` and `resultSchema` metadata for entries that declare them.

Entries without `productKind = "project-ci"` are ordinary workflow entries.

Ordinary workflow entries never produce Project CI records, even if their labels, logs, or final text mention tests or verification.

## Launch Contract

The launch schema describes inputs needed to start CI.

Recommended default shape:

```ts
export const projectCiLaunchSchema = z.object({
  scope: z.enum(["fast", "full", "release"]).default("fast"),
  reason: z.string().optional(),
  worktree: z.string().optional(),
});
```

Repositories may define a narrower or broader launch schema.

The launch schema does not define persisted CI results.

The result schema does.

## Result Contract

Project CI records come only from terminal output that validates against the CI entry's `resultSchema`.

Recommended default result schema:

```ts
export const ciCheckStatusSchema = z.enum([
  "passed",
  "failed",
  "cancelled",
  "skipped",
  "blocked",
]);

export const projectCiResultSchema = z.object({
  status: z.enum(["passed", "failed", "cancelled", "blocked"]),
  summary: z.string().min(1),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
  checks: z.array(
    z.object({
      checkId: z.string().min(1),
      label: z.string().min(1),
      kind: z.string().min(1),
      status: ciCheckStatusSchema,
      required: z.boolean().default(true),
      command: z.array(z.string()).optional(),
      exitCode: z.number().int().nullable().optional(),
      summary: z.string().min(1),
      artifactIds: z.array(z.string()).default([]),
    }),
  ),
});
```

Use open string `kind` values so repositories can name their own check categories.

Recommended built-in kind names are:

- `typecheck`
- `test`
- `lint`
- `build`
- `integration`
- `docs`
- `manual`

`checkId` must be stable inside the CI entry.

Examples:

- `typecheck`
- `unit_tests`
- `eslint`
- `storybook_build`

## Recording Rule

The runtime records Project CI state only when all of these are true:

1. The Smithers run was launched from a runnable entry that declares `productKind = "project-ci"`.
2. The run reaches a terminal Smithers state.
3. The terminal product output is directly available from the entry's declared result output.
4. The terminal product output validates against the entry's `resultSchema`.

If any condition is false, the runtime must not synthesize Project CI records.

Invalid CI output is a CI workflow failure or troubleshooting state.

It is not an invitation to parse logs, read node text, inspect final prose, or guess partial results.

## Durable State

Project CI state belongs in structured session state as:

- `ci_run`
- `ci_check_result`

The exact database table names should match those concepts.

`ci_run` should store:

- stable local id
- workspace session id
- owning thread id
- owning workflow run id
- Smithers run id
- workflow id
- entry path
- status
- summary
- started at
- finished at
- created at
- updated at

`ci_check_result` should store:

- stable local id
- CI run id
- workflow run id
- stable check id
- label
- kind
- status
- required flag
- command argv when applicable
- exit code when applicable
- summary
- artifact ids or artifact refs
- started at when known
- finished at when known

Idempotency rule:

- upsert one `ci_run` per `workflowRunId`
- upsert one `ci_check_result` per `ciRunId + checkId`

Do not create duplicate check rows when terminal snapshots, reconnect reads, or final stream flushes observe the same completed run more than once.

## Events

The structured event ledger should use CI-specific event kinds:

- `ciRun.recorded`
- `ciCheckResult.recorded`

Do not use generic `verification.recorded`.

## UI Projection

The UI should show Project CI as a dedicated surface or panel.

Required states:

- `not-configured`: no runnable entry with `productKind = "project-ci"` exists
- `configured`: one or more CI entries exist, but no run has been recorded yet
- `running`: a CI workflow run is active
- `passed`: latest recorded CI run passed
- `failed`: latest recorded CI run failed
- `blocked`: latest recorded CI run could not complete because a required check was blocked
- `cancelled`: latest recorded CI run was cancelled

The latest CI panel should show:

- status
- summary
- CI entry label
- workflow run link
- owning handler thread link
- check list with status, label, kind, command, and summary
- linked artifacts and logs

## Handler Lifecycle Example

### First-Time Setup

1. User clicks `Configure CI`.
2. `svvy` opens a normal handler thread with `context: ["ci"]`.
3. The handler starts with the default handler runtime shape plus the `ci` context pack.
4. The handler inspects repository facts through `execute_typescript`.
5. The handler sees `package.json` with `test` and `typecheck`, but no `lint`.
6. The handler asks whether lint should be part of Project CI or omitted.
7. The user says to include `test` and `typecheck` only.
8. The handler writes:
   - `.svvy/workflows/definitions/ci/project-ci.tsx`
   - `.svvy/workflows/components/ci/check-runner.tsx`
   - `.svvy/workflows/prompts/ci/check-policy.mdx`
   - `.svvy/workflows/entries/ci/project-ci.tsx`
9. Saved-workflow validation runs automatically after the writes.
10. The handler fixes any saved-workflow validation diagnostics.
11. The handler calls `smithers.list_workflows` and confirms `project_ci` is listed with `productKind = "project-ci"`.
12. The handler calls `smithers.run_workflow({ workflowId: "project_ci", input: { scope: "fast", reason: "initial setup" } })`.
13. The workflow returns output that validates against `resultSchema`.
14. The runtime records one `ci_run` plus one `ci_check_result` per returned check.
15. The UI leaves `not-configured` and shows the latest Project CI result.

### Normal Implementation Work

1. User asks the orchestrator to implement a feature.
2. The orchestrator delegates to a normal handler thread.
3. The handler implements the feature through direct work or Smithers workflows.
4. The handler wants final confidence.
5. The handler calls `smithers.list_workflows({ productKind: "project-ci" })`.
6. If a CI entry exists, the handler calls `smithers.run_workflow({ workflowId: "project_ci", input: { scope: "fast", reason: "post-implementation" } })`.
7. The runtime records CI state only if the terminal output validates against the CI result schema.
8. The handler includes the CI outcome in its handoff.

### No CI Configured

1. A normal handler wants confidence checks.
2. The handler calls `smithers.list_workflows({ productKind: "project-ci" })`.
3. No entries are returned.
4. The handler asks the user whether to configure Project CI or run explicit one-off commands.
5. If the current thread should configure Project CI, the handler calls `request_context({ keys: ["ci"] })`.
6. After the `ci` context pack is loaded, the same handler may author the Project CI saved entry.
7. If the user gives explicit commands instead, those commands run as ordinary command records and artifacts, not Project CI state.

## Context Boundaries

The CI authoring context is loaded only through the typed `ci` context pack.

Normal handler prompts should only include this small rule:

```text
If Project CI only needs to be run, discover configured CI entries with smithers.list_workflows filtered to productKind "project-ci" and run one through smithers.run_workflow. If Project CI needs to be configured or modified, call request_context({ keys: ["ci"] }) before authoring CI assets.
```

That rule is intentionally short.

It tells normal handlers how to request the missing context instead of teaching them how to build CI entries by default.

`request_context` is a top-level handler tool.

It is not exposed through `execute_typescript` because it changes the handler's loaded prompt context rather than doing repository work.

## Relationship To Workflow Library

Project CI does not create a separate workflow library.

It is a product lane over a subset of normal saved workflow entries.

The only extra entry metadata is:

- `productKind = "project-ci"`
- `resultSchema`

This keeps Project CI compatible with Smithers entry discovery and launch while giving `svvy` a reliable product-level result.

## Relationship To Workflow Supervision

Workflow supervision remains the source of truth for:

- run lifecycle
- waits
- failures
- cancellation
- node inspection
- artifacts
- transcripts
- events

Project CI state is a product projection produced after a CI entry reaches a terminal result and validates the result schema.

The CI projection does not replace workflow-run records.

It points back to them.

## Invariants

- Project CI records are created only from declared CI entries.
- CI entries are normal Smithers runnable entries.
- CI entries live in the saved workflow library when reusable.
- CI authoring context is isolated to the typed `ci` context pack.
- Normal handler threads may run configured CI entries without loading the `ci` context pack.
- Normal handler threads may configure or modify Project CI after loading the `ci` context pack with `request_context`.
- No runtime path parses arbitrary workflow logs, node outputs, or final prose to infer CI.
- No fake passing Project CI entry is scaffolded by default.
- No generic verification table or event kind is used for Project CI.
- Invalid result output fails CI recording instead of triggering best-effort recovery.
- Replayed terminal workflow observations are idempotent.
