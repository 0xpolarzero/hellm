# Project CI Lane Spec

## Status

- Date: 2026-04-24
- Status: adopted direction for project CI configuration, execution, persistence, and UI
- Scope of this document:
  - define the Project CI product lane as a status and result projection over normal workflow execution
  - define how CI assets live inside the existing Smithers saved workflow library
  - define the CI runnable-entry contract
  - define when CI state is recorded
  - define how handler threads load the Project CI authoring extension only when needed
  - define how Project CI is configured organically through normal handler work rather than a setup launcher

The Project CI prompt-only extension record and draft extension-instruction contract are defined in
[Project CI Extension Spec](./extension/project-ci.extension.spec.md). Extension loading mechanics
are defined in [Extensions And Tools Spec](./extensions-and-tools.spec.md).

## Naming

The product feature is called **Project CI**.

Use these terms consistently:

- **Project CI**: the dedicated product lane for configuring and running the repository's repeatable confidence checks.
- **CI lane**: the product projection for Project CI status, configured entries, latest run, check results, and linked workflow artifacts.
- **CI status surface**: the UI surface or panel that renders the CI lane. It may route user requests into normal handler threads, but it is not a separate setup launcher or runtime.
- **Project CI extension**: the shipped prompt-only extension loaded by `thread_start` extension overrides or by a handler calling `load_extension({ extensionId: "project-ci" })`.
- **CI entry**: a normal Smithers runnable saved workflow entry that declares `productKind = "project-ci"`.
- **CI run**: one `svvy` product projection row for a Smithers workflow run launched from a CI entry.
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

- the CI lane is a product status and result projection, not a separate setup flow
- Project CI configuration happens through ordinary handler work when a user asks for it or a handler discovers it is needed
- no heuristic inference from arbitrary workflow outputs
- no parsing node logs or final text to guess check results
- no custom `svvy` CI component that agents must import into every workflow
- no fake default CI that claims the project passed without running real checks
- no CI authoring prompt injected into normal handler threads
- normal handler-thread execution with the `project-ci` extension loaded when CI authoring knowledge is needed

## Non-Goals

Project CI does not:

- replace Smithers workflow execution
- create a second CI engine outside Smithers
- require every workflow to include CI steps
- scan arbitrary workflow runs looking for CI-shaped output
- infer test, lint, build, or manual outcomes from logs
- scaffold a passing placeholder command such as `echo ok`
- require every repository to have `test`, `lint`, `typecheck`, or `build` scripts
- preload Project CI authoring guidance into every normal handler thread
- treat one-off user-requested commands as durable Project CI unless they run through a declared CI entry

## Product Shape

Project CI is a dedicated status and result lane over normal orchestrator, handler, and Smithers workflow work.

The UI should expose at least:

- configuration status
- latest CI run, check results, and linked artifacts
- configured Project CI entries when they exist
- a way for user requests to configure or run Project CI to land in a normal handler thread
- a clear `CI not configured` state instead of fake green status

The UI must not require or imply a separate Project CI setup wizard, setup launcher, CI-specific orchestrator, or custom CI execution surface.

When the user asks to configure Project CI from chat or from the CI status surface, that request is handled as ordinary handler-thread work.

The orchestrator may start a normal handler thread with the `project-ci` extension loaded when the
request clearly needs CI authoring guidance from the first handler turn.

An existing handler may load the same extension later with `load_extension({ extensionId: "project-ci" })`.

Mechanically, this is the same handler-thread agent kind used for other delegated work.

The difference is only the generated agent context binding for that handler.

Ordinary orchestrator and handler sessions do not load Project CI authoring guidance by default.

The `project-ci` extension describes optional product knowledge and instructions.

Project CI uses normal handler-thread execution plus that extension when configuration or modification is needed.

## Actor Responsibilities

### Normal Orchestrator

This is the normal `svvy` orchestrator.

There is no CI-specific orchestrator.

There is also no special CI-specific `thread_start` tool.

The orchestrator may:

- tell the user whether Project CI is configured
- start or reuse a normal handler thread with the `project-ci` extension loaded when the user asks to configure checks and the next handler turn clearly needs CI authoring guidance
- delegate implementation work to normal handler threads
- reconcile handoffs that include CI state

The orchestrator knows only a lightweight routing fact:

- `project-ci` is a handler-available shipped prompt-only extension for Project CI authoring.

The orchestrator does not load Smithers workflow tools by default.

The orchestrator should not author CI entries itself.

The orchestrator should delegate Project CI workflow work to a handler instead of loading Smithers
for ordinary CI routing.

The orchestrator may use only `thread_start` extension overrides to preload Project CI authoring guidance for a new handler.

### Handler With `project-ci` Loaded

A handler thread that has loaded the `project-ci` extension owns Project CI configuration work.

It is still a normal handler thread.

It receives Project CI extension instructions explaining how to:

- inspect the repository for likely checks
- inspect `package.json`, lockfiles, task runners, existing CI files, Makefiles, README docs, and test config
- ask the user what should always be checked when confidence is low
- suggest an initial CI shape without pretending every repo has the same scripts
- write CI workflow assets under the existing saved workflow library
- validate saved workflow files after writes
- run the CI entry and refine it until the result contract is valid

A handler with the `project-ci` extension loaded may write reusable CI assets under
`.svvy/workflows/.../ci/`.

A handler with the `project-ci` extension loaded may run Project CI entries through Smithers.

The `project-ci` extension may be loaded in either of two ways:

- the orchestrator starts the handler with a `thread_start` creation-time extension override that
  sets `project-ci` to `default_loaded`; the exact API is defined in
  `docs/specs/extension/thread-managing.extension.spec.md`
- an existing handler calls `load_extension({ extensionId: "project-ci" })`

Loading the same extension more than once is idempotent.

### Normal Handler Threads

Normal handler threads may:

- discover configured CI entries with `smithers_list_workflows`
- run a configured CI entry with `smithers_run_workflow`
- inspect CI run state and artifacts
- mention CI status in a handoff when relevant
- call `load_extension({ extensionId: "project-ci" })` if they need to configure or modify Project CI

Normal handler threads start without:

- the CI authoring guide
- repository-specific CI assumptions
- knowledge of how to write CI entries beyond the lightweight fact that `project-ci` can be loaded
  when CI configuration or modification is needed

If a normal handler only needs to run existing CI, it does not need the `project-ci` extension.

If a normal handler needs to configure or modify Project CI, it should first call:

```ts
load_extension({ extensionId: "project-ci" });
```

If a normal handler wants confidence checks and no CI entry exists, it should either:

- ask the user to configure Project CI
- call `load_extension({ extensionId: "project-ci" })` when the current thread should configure it
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

The recommended conventional project entry path is:

```text
.svvy/workflows/entries/ci/project-ci.tsx
```

The recommended conventional workflow id is:

```text
project_ci
```

These conventions guide handler-authored reusable CI configuration.

They do not mean `svvy` ships, auto-creates, or assumes a built-in saved Project CI entry.

Additional CI entries are allowed when they represent distinct repeatable lanes, such as:

- `project_ci_fast`
- `project_ci_release`
- `project_ci_docs`

Artifact workflows may still be used while a handler with the `project-ci` extension loaded
experiments:

```text
.svvy/artifacts/workflows/<artifact_workflow_id>/
  definitions/
  prompts/
  components/
  entries/
  metadata.json
```

Reusable Project CI configuration is not complete until a handler with the `project-ci` extension
loaded writes a saved CI entry under `.svvy/workflows/entries/ci/`.

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

export const definitionPaths = [".svvy/workflows/definitions/ci/project-ci.tsx"] as const;

export const promptPaths = [".svvy/workflows/prompts/ci/check-policy.mdx"] as const;

export const componentPaths = [".svvy/workflows/components/ci/check-runner.tsx"] as const;

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

`smithers_list_workflows` must return `productKind` and `resultSchema` metadata for entries that declare them.

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

Project CI records come only from terminal Smithers result output or an equivalent Smithers-owned declared result payload that validates against the CI entry's `resultSchema`.

That output is a durable Smithers workflow fact, not process-local memory and not a `svvy`-owned output copy. The runtime may observe that the output changed through a live Smithers completion event, a terminal Smithers snapshot, or a persisted Smithers run/result record, but Project CI reconciliation must read the authoritative terminal result from Smithers durable state. The `svvy` workflow-run record supplies ownership and product binding only.

Recommended default result schema:

```ts
export const ciCheckStatusSchema = z.enum(["passed", "failed", "cancelled", "skipped", "blocked"]);

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
3. The terminal product output is directly available from Smithers' declared durable result output.
4. The terminal product output validates against the entry's `resultSchema`.

If any condition is false, the runtime must not synthesize Project CI records.

Invalid or missing CI output is a durable CI projection failure and workflow troubleshooting state.

It is not an invitation to parse logs, read node text, inspect final prose, or guess partial results.

The runtime must record enough `svvy` troubleshooting detail to explain why CI projection failed, such as missing Smithers terminal result, schema validation failure, mismatched product kind, or missing entry metadata. It must not silently skip a declared CI run just because the result was missing from process memory.

## Reconciliation Model

Project CI is an event-triggered reconciliation over durable Smithers execution facts and durable `svvy` product-binding facts.

The sanctioned triggers are:

- CI workflow launch, resume, completion, cancellation, or failure events
- workflow monitor reconnect or terminal bootstrap reads
- app restart recovery for nonterminal or terminal workflow runs whose CI projection has not been reconciled
- durable Smithers result writes or `svvy` workflow-run ownership/projection writes that affect a declared Project CI entry

Each trigger should run the same idempotent derivation:

1. Load the durable `svvy` workflow-run record and owning handler/thread/session facts.
2. Confirm the runnable entry still resolves as `productKind = "project-ci"`.
3. Load the durable terminal result payload from Smithers.
4. Validate that payload against the entry's `resultSchema`.
5. Upsert exactly one `ci_run` for the workflow run and stable `ci_check_result` rows by `checkId`.
6. If the durable result is missing or invalid, record a projection failure or troubleshooting state instead of creating partial CI records.

In-memory maps, live monitors, UI state, transcript text, and copied `svvy` output fields are not authoritative. They may trigger reconciliation or carry live progress, but the UI/read models must derive from durable `ci_run`, `ci_check_result`, `svvy` workflow-run binding, and Smithers result facts.

## Durable State

Project CI state belongs in structured session state as:

- `ci_run`
- `ci_check_result`

The exact database table names should match those concepts.

These are `svvy` product projection rows. They do not replace or copy Smithers run, node, attempt, wait, approval, timer, output, artifact, or event tables. They store the Project CI view that `svvy` needs for routing and UI, with foreign keys back to the owning Smithers run and `svvy` workflow-run record.

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

The workspace shell should also expose a compact latest CI summary near the focused surface or session status area.

That compact summary should show:

- current CI state
- latest run summary
- check counts by status
- link to inspect the latest run when it exists

An inspected handler thread should show CI detail only when that thread launched, configured, modified, or otherwise owns the relevant CI run.

## Handler Lifecycle Examples

### Configuring CI From A User Request

1. User asks in chat, or from the CI status surface, to configure Project CI.
2. If the request clearly needs CI authoring from the first delegated turn, the orchestrator starts a normal handler thread with the `project-ci` extension loaded.
3. If the request arrives in an existing normal handler thread, that handler calls `load_extension({ extensionId: "project-ci" })` before authoring CI assets.
4. The handler runs with the default handler runtime shape plus the `project-ci` extension instructions.
5. The handler inspects repository facts through `execute_typescript`.
6. The handler sees `package.json` with `test` and `typecheck`, but no `lint`.
7. The handler asks whether lint should be part of Project CI or omitted.
8. The user says to include `test` and `typecheck` only.
9. The handler writes:
   - `.svvy/workflows/definitions/ci/project-ci.tsx`
   - `.svvy/workflows/components/ci/check-runner.tsx`
   - `.svvy/workflows/prompts/ci/check-policy.mdx`
   - `.svvy/workflows/entries/ci/project-ci.tsx`
10. Saved-workflow validation runs automatically after the writes.
11. The handler fixes any saved-workflow validation diagnostics.
12. The handler calls `smithers_list_workflows` and confirms `project_ci` is listed with `productKind = "project-ci"`.
13. The handler calls `smithers_run_workflow({ workflowId: "project_ci", input: { scope: "fast", reason: "initial configuration" } })`.
14. The workflow returns output that validates against `resultSchema`.
15. The runtime records one `ci_run` plus one `ci_check_result` per returned check.
16. The CI status surface leaves `not-configured` and shows the latest Project CI result.

### Normal Implementation Work

1. User asks the orchestrator to implement a feature.
2. The orchestrator delegates to a normal handler thread.
3. The handler implements the feature through direct work or Smithers workflows.
4. The handler wants final confidence.
5. The handler calls `smithers_list_workflows({ productKind: "project-ci" })`.
6. If a CI entry exists, the handler calls `smithers_run_workflow({ workflowId: "project_ci", input: { scope: "fast", reason: "post-implementation" } })`.
7. The runtime records CI state only if the terminal output validates against the CI result schema.
8. The handler includes the CI outcome in its handoff.

### No CI Configured

1. A normal handler wants confidence checks.
2. The handler calls `smithers_list_workflows({ productKind: "project-ci" })`.
3. No entries are returned.
4. The handler asks the user whether to configure Project CI or run explicit one-off commands.
5. If the current thread should configure Project CI, the handler calls `load_extension({ extensionId: "project-ci" })`.
6. After the `project-ci` extension is loaded, the same handler may author the Project CI saved entry.
7. If the user gives explicit commands instead, those commands run as ordinary command records and artifacts, not Project CI state.

## Extension Boundaries

Project CI authoring guidance is loaded only through the optional `project-ci` extension.

Normal handler prompts should only include this small rule through the minimal available
`project-ci` loading hint:

```text
If Project CI only needs to be run, discover configured CI entries with smithers_list_workflows filtered to productKind "project-ci" and run one through smithers_run_workflow. If Project CI needs to be configured or modified, call load_extension({ extensionId: "project-ci" }) before authoring CI assets.
```

That rule is intentionally short.

It tells normal handlers how to request the missing context instead of teaching them how to build CI entries by default.

`load_extension` is a native control tool.

It is not exposed through `execute_typescript` because it changes the handler's loaded extension
binding and generated agent context rather than doing repository work.

## Relationship To Workflow Library

Project CI does not create a separate workflow library.

It is a product lane over a subset of normal saved workflow entries.

The only extra entry metadata is:

- `productKind = "project-ci"`
- `resultSchema`

This keeps Project CI compatible with Smithers entry discovery and launch while giving `svvy` a reliable product-level result.

## Relationship To Workflow Supervision

Smithers remains the source of truth for workflow execution facts:

- run lifecycle
- waits
- failures
- cancellation
- node inspection
- artifacts
- transcripts
- events

Workflow supervision owns the `svvy` binding and projection around those Smithers facts: handler ownership, attention cursors, thread status, UI links, troubleshooting summaries, and product lanes such as Project CI.

Project CI state is a `svvy` product projection produced after a CI entry reaches a terminal Smithers result and validates the result schema.

The CI projection does not replace workflow-run records.

It points back to them.

## Invariants

- Project CI records are created only from declared CI entries.
- CI entries are normal Smithers runnable entries.
- CI entries live in the saved workflow library when reusable.
- CI configuration is ordinary handler-thread work, not a dedicated setup launcher or runtime.
- CI authoring guidance is isolated to the optional `project-ci` extension.
- Normal handler threads may run configured CI entries without loading the `project-ci` extension.
- Normal handler threads may configure or modify Project CI after loading the `project-ci` extension with `load_extension`.
- No runtime path parses arbitrary workflow logs, node outputs, or final prose to infer CI.
- No fake passing Project CI entry is scaffolded by default.
- No generic verification table or event kind is used for Project CI.
- Invalid result output fails CI recording instead of triggering best-effort recovery.
- Replayed terminal workflow observations are idempotent.
