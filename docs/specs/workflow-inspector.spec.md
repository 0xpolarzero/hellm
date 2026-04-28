# Workflow Inspector Spec

## Status

- Date: 2026-04-28
- Status: adopted direction for the dedicated workflow inspector surface
- Scope of this document:
  - define the `svvy` workflow inspector user experience
  - adapt the Smithers GUI DevTools tree model to `svvy` panes and durable workflow-run state
  - define what data the inspector needs from Smithers-native surfaces and `svvy` projection

## Purpose

The workflow inspector is the place where a user understands a Smithers workflow run without asking the orchestrator or handler thread to summarize raw execution history.

The inspector should feel closer to React DevTools than to a generic graph viewer:

- a searchable expandable tree is the primary navigation surface
- the selected row drives a detail inspector
- live execution is visible inline through status, timing, and latest activity
- every executable item can expose the command or agent session that produced it
- historical runs remain inspectable after completion

This spec refines section 15 of [progress.md](../progress.md).

## Reference Shape From Smithers GUI

The local Smithers GUI reference under `docs/references/smithers-gui/` already demonstrates the strongest interaction shape.

The most relevant source files are:

- `LiveRunTreeView.swift`: searchable expandable tree, auto-expansion for running paths, keyboard navigation, selected node routing, and latest-log previews on running leaves.
- `TreeRowView.swift`: compact tree rows with tag/prop summaries, state badges, timing, selected-row treatment, failed-descendant indicators, and running-row cues.
- `NodeInspectorView.swift`: selected-node inspector with props plus output, diff, and logs tabs.
- `LiveRunDevToolsStore.swift`: snapshot-plus-delta live tree store, reconnect behavior, historical frame mode, selected-node ghosting, running-node counts, and frame tracking.
- `FrameScrubberView.swift`: historical frame navigation for live or completed runs.
- `RunInspectView.swift`: run-level actions such as live chat, snapshots, hijack, watch, rerun, and approval resolution.

`svvy` should borrow that product shape but integrate it with `svvy` concepts:

- handler-thread ownership
- pane placement and durable inspector surfaces
- workflow-task-attempt records
- Project CI projection
- pi-backed task-agent transcript and command projection

Smithers remains canonical for the workflow tree, run frames, node props, node output, node logs, diffs, approvals, and replayable event history. `svvy` owns the session/workflow-run linkage, durable inspector availability, pane binding, and cross-opening related surfaces.

## Primary Layout

The dedicated workflow inspector is a pane surface with three regions:

1. A compact run header.
2. A left tree pane.
3. A right selected-node inspector.

The run header shows:

- normalized `svvy` workflow-run status
- raw Smithers status
- workflow label and Smithers run id
- owning session and handler thread
- started, elapsed, and finished timing
- heartbeat freshness or last event time
- current frame position when historical scrubbing is active
- compact actions for returning to live, refreshing, cancelling when allowed, and opening the owning handler thread

The tree pane is the default mental model. It represents the workflow structure as nested rows:

- workflow root
- sequence, parallel, loop, conditional, and approval containers
- executable task rows
- Project CI check rows when the backing entry declares `productKind = "project-ci"`
- retry and loop iterations as expandable child rows rather than as noisy edges
- terminal result rows when Smithers exposes an explicit terminal output or result node

The selected-node inspector shows:

- props and launch arguments
- run and node identity
- status, attempt, iteration, timing, and wait reason
- task kind and workflow agent when present
- task root or worktree
- latest output and partial output
- related artifacts
- output, diff, logs, transcript, command, events, and raw JSON tabs as available

## Tree Interaction

The tree must support:

- search over node label, node id, task kind, agent name, state, props, output summaries, artifact paths, and CI check ids
- expand and collapse per row
- auto-expansion of active, waiting, failed, and selected-node ancestor paths
- preservation of user-collapsed paths while live updates arrive
- keyboard movement with up, down, left, right, home, end, enter, escape, and command-f search
- selected-row persistence per inspector surface
- failed-descendant and waiting-descendant indicators on collapsed parents
- latest activity preview on active leaf rows, such as a command line, latest log line, or task-agent assistant stream excerpt

The default tree should prioritize scan speed over visual novelty. A separate DAG or graph mode can be added later only if the tree fails to answer a real debugging question.

## Expandable Work

Every executable item should be expandable to the most useful live surface for that item:

- script or shell-like command nodes open the command record, stdout/stderr, exit status, timing, and artifacts
- PI-backed task-agent nodes open the task-agent transcript, command timeline, artifacts, usage, and latest live assistant/tool activity
- approval nodes show pending approval text, available choices, requester, and resolution history
- Project CI check nodes show check status, required flag, command, exit code, summary, and linked artifacts
- workflow container nodes show launch arguments, child summary, and rollup status

Opening a deeper item must not create a parallel runtime. It either expands inline inside the inspector, selects an inspector tab, or opens an existing related `svvy` surface into a chosen pane.

## Live And Historical Modes

The inspector uses a snapshot-plus-delta model:

- initial load reads a Smithers DevTools snapshot or equivalent tree projection
- live mode applies Smithers deltas/events as they arrive
- reconnect resumes from durable workflow-run cursor state when possible
- historical mode loads a selected frame without discarding buffered live progress
- returning to live reapplies the latest live tree

Historical scrubbing is an inspection feature, not a workflow control feature by default. Destructive rewind or replay controls must stay separate and require explicit confirmation if adopted.

Completed workflow inspectors remain available as durable historical pane surfaces. They should be restorable after app restart without requiring the original handler thread to be active.

## Data Contract

The projected inspector model should preserve Smithers names and identities where possible.

At minimum, the inspector read model needs:

```ts
type WorkflowInspectorSurface = {
  surfaceId: string;
  workflowRunId: string;
  smithersRunId: string;
  owningSessionId: string;
  owningThreadId: string;
  selectedNodeKey: string | null;
  expandedNodeKeys: string[];
  mode: { kind: "live" } | { kind: "historical"; frameNo: number };
};

type WorkflowInspectorNode = {
  key: string;
  smithersNodeId: string | null;
  parentKey: string | null;
  type:
    | "workflow"
    | "sequence"
    | "parallel"
    | "loop"
    | "conditional"
    | "approval"
    | "task-agent"
    | "script"
    | "project-ci-check"
    | "wait"
    | "retry"
    | "terminal-result"
    | "unknown";
  label: string;
  status: "pending" | "running" | "waiting" | "retrying" | "completed" | "failed" | "cancelled" | "skipped";
  props: Record<string, unknown>;
  launchArguments?: Record<string, unknown>;
  task?: {
    nodeId: string;
    kind: string;
    agent?: string;
    iteration?: number;
    attempt?: number;
    workflowTaskAttemptId?: string;
  };
  projectCi?: {
    checkId: string;
    required: boolean;
    command: string | null;
  };
  detail: {
    status: WorkflowInspectorNode["status"];
    objectiveOrLabel: string;
    latestOutput: string | null;
    partialOutput: string | null;
    relatedArtifacts: Array<{ artifactId: string; name: string; path?: string }>;
    workflowAgent: string | null;
    taskAttempt: {
      workflowTaskAttemptId: string;
      iteration: number;
      attempt: number;
      status: string;
      responseText: string | null;
      error: string | null;
    } | null;
    command: {
      commandId: string;
      toolName: string;
      status: string;
      summary: string;
    } | null;
    worktree: string | null;
    timing: {
      startedAt: string | null;
      finishedAt: string | null;
      updatedAt: string | null;
      elapsedMs: number | null;
    };
    waitReason: string | null;
  };
  relatedSurfaceTargets: Array<
    | { kind: "handler-thread"; threadId: string }
    | { kind: "task-agent"; workflowTaskAttemptId: string }
    | { kind: "command"; commandId: string }
    | { kind: "artifact"; artifactId: string }
    | { kind: "project-ci-check"; checkResultId: string }
  >;
};
```

This shape is a product projection contract, not a replacement for Smithers' own DevTools types. The projection should be derived from Smithers snapshots/events plus `svvy` workflow-run, workflow-task-attempt, command, artifact, and CI records.

## Non-Goals

- Do not make the workflow inspector the default orchestration or reconciliation path.
- Do not ask the orchestrator to ingest raw workflow trees by default.
- Do not introduce a `workflow.*` abstraction parallel to Smithers-native tool names.
- Do not depend on repo-root Smithers authoring workspace assets.
- Do not make graph layout the first implementation target.
