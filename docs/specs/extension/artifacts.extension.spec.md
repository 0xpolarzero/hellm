# Artifacts Extension Spec

## Status

- Date: 2026-06-03
- Status: draft extension spec
- Scope:
  - record Artifacts as an intended shipped extension
  - mark the callable artifact API as unresolved
  - point to existing artifact state and projection specs

## Extension Record

```json
{
  "id": "artifacts",
  "category": "shipped",
  "interface": "native_tool",
  "title": "Artifacts",
  "description": "Create, inspect, link, and project durable byproducts and evidence files.",
  "typescriptApiEnabled": true
}
```

Draft default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `default_loaded` |
| Handler thread | `default_loaded` |
| Workflow task agent | `default_loaded` |

## Current Product Model

Artifacts are durable byproducts or evidence files produced by commands, workflow runs, Project CI,
and related execution. They are file-backed records linked to sessions, handler threads, workflow
runs, commands, and CI checks.

Existing artifact behavior is defined in:

- `docs/specs/structured-session-state.spec.md`, "Artifact Model"
- `docs/specs/workspace-navigation-core-projection.spec.md`, "Artifact Projection"
- `docs/specs/workflow-library.spec.md`, "Artifact Workflows"

## Draft Notes

- The concrete model-callable API is not specced yet.
- This spec should decide whether artifact operations are native tools, generated TypeScript clients,
  or both.
- This spec should define creation, read, preview, link, size, trust, redaction, and retention rules
  for agent-facing artifact operations.
- Existing automatic artifacts from commands and `execute_typescript` attempts are product behavior,
  but they are not yet represented as a loaded extension API.
