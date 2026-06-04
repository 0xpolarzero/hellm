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
  "typescriptApiEnabled": false
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

Agent-visible tools use the `smithers_*` namespace. When the underlying Smithers operation uses a
dotted or camelCase name, the model-facing tool name is the snake_case `smithers_` form while final
command facts preserve the raw Smithers operation name.

Currently referenced model-facing controls include:

```ts
smithers_run_workflow({ workflowId, input, runId? })
smithers_list_workflows({ workflowId?, productKind? })
smithers_list_runs(...)
smithers_get_run(...)
smithers_watch_run(...)
smithers_explain_run(...)
smithers_list_pending_approvals(...)
smithers_resolve_approval(...)
smithers_get_node_detail(...)
smithers_list_artifacts(...)
smithers_get_chat_transcript(...)
smithers_get_run_events(...)
smithers_runs_cancel(...)
smithers_signals_send(...)
smithers_frames_list(...)
smithers_get_devtools_snapshot(...)
smithers_stream_devtools(...)
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
