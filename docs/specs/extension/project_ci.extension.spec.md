# Project CI Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted prompt-only extension instruction spec
- Scope:
  - define the shipped Project CI extension record
  - separate the prompt-only authoring extension from the broader Project CI lane spec

## Extension Record

```json
{
  "id": "project-ci",
  "category": "shipped",
  "interface": "instructions",
  "title": "Project CI",
  "description": "Project CI authoring guidance for defining and maintaining repository confidence-check workflow lanes.",
  "typescriptApiEnabled": false
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `unavailable` |
| Handler thread | `available` |
| Workflow task agent | `unavailable` |

## Tool Surface

Project CI exposes no native `project_ci_*` tools, no `svvyx project-ci`, and no generated TypeScript
client.

When loaded, it contributes prompt-only guidance for authoring and maintaining Project CI workflow
entries. Runtime execution of existing Project CI entries uses the Smithers extension.

## Current Source Of Truth

The broader Project CI product lane is defined in `docs/specs/project-ci.spec.md`.

That broad spec owns:

- CI lane status and projection
- CI saved workflow entry contracts
- CI run and check-result semantics
- when handlers should load this extension
- how Project CI uses Smithers saved workflow entries

## Loaded Instructions

Loaded Project CI guidance should say:

```md
Project CI is a repository confidence-check lane backed by normal saved Smithers workflow entries.

Use this guidance only inside handler threads. Do not create a separate CI runtime, setup launcher,
or CI-specific orchestrator.

If Project CI only needs to be run, discover configured CI entries with
`smithers_list_workflows({ productKind: "project-ci" })` and run one through
`smithers_run_workflow({ workflowId, input })`.

If Project CI needs to be configured or modified, author normal saved workflow assets under
`.svvy/workflows/definitions/ci/`, `.svvy/workflows/prompts/ci/`,
`.svvy/workflows/components/ci/`, and `.svvy/workflows/entries/ci/`. The runnable entry must declare
`productKind = "project-ci"` and a `resultSchema` for the terminal result.

Do not infer CI results from arbitrary logs, node output, command names, or final prose. Project CI
projection records only validated terminal results from declared Project CI entries.
```

## Minimal Available Instructions

Minimal available Project CI guidance should say:

```md
Load Project CI only in handler threads when you need to configure or modify the workspace's
Project CI saved workflow assets. Existing configured CI entries can be discovered and run through
Smithers without loading this extension.
```

The broad Project CI lane spec remains separate because it defines product state and UI, not only
extension behavior.
