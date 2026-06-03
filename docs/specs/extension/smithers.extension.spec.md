# Smithers Extension Spec

## Status

- Date: 2026-06-03
- Status: accepted extension surface direction
- Scope:
  - centralize the current Smithers extension record
  - resolve Smithers as a first-party native tool extension, not an Incur-backed `svvyx` extension
  - point to the existing workflow supervision and workflow library specs

## Extension Record

```json
{
  "id": "smithers",
  "category": "shipped",
  "interface": "native_tool",
  "title": "Smithers",
  "description": "Smithers-native workflow run, inspection, supervision, approval, signal, transcript, and artifact controls.",
  "typescriptApiEnabled": true
}
```

Default usage:

| Actor kind | State |
| --- | --- |
| Orchestrator | `unavailable` |
| Handler thread | `default_loaded` |
| Workflow task agent | `unavailable` |

## Current Intended Surface

The Smithers extension is the handler-thread workflow-supervision capability. It should preserve
Smithers-native names instead of inventing a parallel `workflow_*` abstraction.

Currently referenced controls include:

```ts
smithers_run_workflow({ workflowId, input, runId? })
smithers_list_workflows({ workflowId?, productKind? })
smithers_list_runs(...)
get_run(...)
watch_run(...)
explain_run(...)
list_pending_approvals(...)
resolve_approval(...)
get_node_detail(...)
list_artifacts(...)
get_chat_transcript(...)
get_run_events(...)
runs.cancel(...)
signals.send(...)
frames.list(...)
getDevToolsSnapshot(...)
streamDevTools(...)
```

## Notes

- Exact input/output schemas are not centralized in this file yet.
- Smithers is not an Incur-backed `svvyx` extension. Handler-thread agent-facing workflow control is
  exposed as first-party `smithers_*` tools through the Bun-owned Smithers bridge.
- Workflow run behavior is currently defined in `docs/specs/workflow-supervision.spec.md`.
- Workflow authoring and saved entry behavior is currently defined in
  `docs/specs/workflow-library.spec.md`.
- This file should become the canonical Smithers extension API spec before implementation relies on
  generated declarations from it.
