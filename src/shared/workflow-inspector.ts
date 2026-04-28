import type {
  WorkspaceCommandArtifactLink,
  WorkspaceWorkflowInspectorDetailTab,
  WorkspaceWorkflowInspectorFrame,
  WorkspaceWorkflowInspectorMode,
  WorkspaceWorkflowInspectorNode,
  WorkspaceWorkflowInspectorNodeStatus,
  WorkspaceWorkflowInspectorNodeType,
  WorkspaceWorkflowInspectorReadModel,
} from "./workspace-contract";

export interface WorkflowInspectorProjectionInput {
  sessionId: string;
  workflowRun: {
    id: string;
    threadId: string;
    smithersRunId: string;
    workflowName?: string | null;
    savedEntryId?: string | null;
    status: WorkspaceWorkflowInspectorReadModel["runHeader"]["svvyStatus"];
    smithersStatus?: string | null;
    input?: unknown;
    startedAt?: string | null;
    finishedAt?: string | null;
    updatedAt?: string | null;
    heartbeatAt?: string | null;
    lastEventSeq?: number | null;
  };
  thread?: {
    id: string;
    title?: string | null;
    surfacePiSessionId?: string | null;
  } | null;
  snapshot: unknown;
  frames?: unknown[];
  events?: unknown[];
  nodeDetail?: unknown;
  artifacts?: WorkspaceCommandArtifactLink[];
  taskAttempts?: Array<{
    workflowTaskAttemptId: string;
    workflowRunId: string;
    nodeId: string;
    kind: string;
    status: string;
    iteration: number;
    attempt: number;
    title?: string;
    summary?: string;
  }>;
  commands?: Array<{
    commandId: string;
    workflowRunId?: string | null;
    workflowTaskAttemptId?: string | null;
    title?: string;
    summary?: string;
    toolName?: string;
  }>;
  ciChecks?: Array<{
    checkResultId: string;
    checkId: string;
    label: string;
    required: boolean;
    command: string[] | null;
    status: string;
  }>;
  selectedNodeKey?: string | null;
  expandedNodeKeys?: string[];
  searchQuery?: string;
  mode?: WorkspaceWorkflowInspectorMode;
}

export function buildWorkflowInspectorReadModel(
  input: WorkflowInspectorProjectionInput,
): WorkspaceWorkflowInspectorReadModel {
  const mode = input.mode ?? { kind: "live" };
  const roots = collectSnapshotRoots(input.snapshot);
  const nodes =
    roots.length > 0
      ? roots.flatMap((root) => projectSnapshotNode({ input, rawNode: root, parentKey: null }))
      : [buildSyntheticRoot(input)];
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  rollupDescendantStates(nodes);

  const searchQuery = input.searchQuery?.trim() ?? "";
  const matchedNodeKeys = searchQuery
    ? nodes
        .filter((node) => searchableText(node).includes(searchQuery.toLowerCase()))
        .map((node) => node.key)
    : [];
  const selectedNodeKey =
    input.selectedNodeKey && byKey.has(input.selectedNodeKey)
      ? input.selectedNodeKey
      : (matchedNodeKeys[0] ?? nodes[0]?.key ?? null);
  const expandedNodeKeys = buildExpandedNodeKeys(
    nodes,
    selectedNodeKey,
    input.expandedNodeKeys ?? [],
  );
  const visibleNodeKeys = buildVisibleNodeKeys(
    nodes,
    expandedNodeKeys,
    searchQuery,
    matchedNodeKeys,
  );
  const selectedNode = selectedNodeKey ? (byKey.get(selectedNodeKey) ?? null) : null;
  const frames = (input.frames ?? [])
    .map(projectFrame)
    .filter(Boolean) as WorkspaceWorkflowInspectorFrame[];
  const lastEvent = latestEvent(input.events ?? []);

  return {
    surfaceId: `workflow-inspector:${input.workflowRun.id}`,
    workflowRunId: input.workflowRun.id,
    smithersRunId: input.workflowRun.smithersRunId,
    owningSessionId: input.sessionId,
    owningThreadId: input.workflowRun.threadId,
    selectedNodeKey,
    expandedNodeKeys,
    mode,
    runHeader: {
      svvyStatus: input.workflowRun.status,
      smithersStatus: input.workflowRun.smithersStatus ?? "unknown",
      runId: input.workflowRun.smithersRunId,
      workflowId: input.workflowRun.savedEntryId ?? input.workflowRun.workflowName ?? null,
      workflowLabel:
        input.workflowRun.workflowName ?? input.workflowRun.savedEntryId ?? "Smithers workflow",
      owningHandlerThreadTitle: input.thread?.title ?? input.workflowRun.threadId,
      startedAt: input.workflowRun.startedAt ?? null,
      finishedAt: input.workflowRun.finishedAt ?? null,
      updatedAt: input.workflowRun.updatedAt ?? null,
      heartbeatAt: input.workflowRun.heartbeatAt ?? null,
      lastEventAt: millisToIso(readNumber(lastEvent, ["timestampMs", "timestamp"])),
      frameNo: readNumber(input.snapshot, ["frameNo", "frame", "frame_no"]),
      frameCount: frames.length,
      lastSeq: input.workflowRun.lastEventSeq ?? readNumber(input.snapshot, ["seq", "lastSeq"]),
    },
    tree: { nodes, visibleNodeKeys, searchQuery, matchedNodeKeys },
    frames,
    selectedNode,
    detailTabs: buildDetailTabs(selectedNode, input),
    rawSnapshot: input.snapshot,
  };
}

export function classifyWorkflowInspectorNode(
  raw: unknown,
  input: WorkflowInspectorProjectionInput,
): WorkspaceWorkflowInspectorNodeType {
  const kind = String(
    readValue(raw, ["type", "kind", "nodeType", "tag", "component"]) ?? "",
  ).toLowerCase();
  const label = String(readValue(raw, ["label", "name", "id", "nodeId"]) ?? "").toLowerCase();
  const nodeId = String(readValue(raw, ["nodeId", "node_id", "id"]) ?? "");
  if (input.ciChecks?.some((check) => check.checkId === nodeId || check.label === label))
    return "project-ci-check";
  if (kind.includes("workflow")) return "workflow";
  if (kind.includes("sequence")) return "sequence";
  if (kind.includes("parallel")) return "parallel";
  if (kind.includes("loop")) return "loop";
  if (kind.includes("branch") || kind.includes("conditional")) return "conditional";
  if (kind.includes("approval")) return "approval";
  if (kind.includes("wait") || kind.includes("signal")) return "wait";
  if (kind.includes("retry") || label.includes("retry")) return "retry";
  if (kind.includes("terminal") || label.includes("terminal result")) return "terminal-result";
  if (kind.includes("task") && hasTaskAgent(raw)) return "task-agent";
  if (kind.includes("task") || kind.includes("script") || kind.includes("command")) return "script";
  return "unknown";
}

export function normalizeWorkflowInspectorStatus(
  raw: unknown,
): WorkspaceWorkflowInspectorNodeStatus {
  const props = readValue(raw, ["props"]);
  const status = String(
    readValue(raw, ["status", "state", "smithersStatus"]) ??
      readValue(props, ["status", "state", "smithersStatus"]) ??
      "",
  ).toLowerCase();
  if (["running", "in-progress", "executing", "active"].includes(status)) return "running";
  if (status.includes("approval") || status.includes("waiting") || status.includes("blocked"))
    return "waiting";
  if (status.includes("retry")) return "retrying";
  if (["finished", "complete", "completed", "success", "succeeded", "passed"].includes(status))
    return "completed";
  if (["failed", "error", "errored"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (status.includes("skip")) return "skipped";
  return "pending";
}

function projectSnapshotNode(args: {
  input: WorkflowInspectorProjectionInput;
  rawNode: unknown;
  parentKey: string | null;
}): WorkspaceWorkflowInspectorNode[] {
  const nodeId = stringify(readValue(args.rawNode, ["nodeId", "node_id", "id"]));
  const key = args.parentKey
    ? `${args.parentKey}/${nodeId ?? createStableLabel(args.rawNode)}`
    : (nodeId ?? "workflow");
  const children = collectChildren(args.rawNode);
  const type = classifyWorkflowInspectorNode(args.rawNode, args.input);
  const taskAttempt = nodeId
    ? args.input.taskAttempts?.find((attempt) => attempt.nodeId === nodeId)
    : undefined;
  const rawTask = readValue(args.rawNode, ["task"]);
  const ciCheck = nodeId
    ? args.input.ciChecks?.find((check) => check.checkId === nodeId)
    : undefined;
  const command = taskAttempt
    ? args.input.commands?.find(
        (entry) => entry.workflowTaskAttemptId === taskAttempt.workflowTaskAttemptId,
      )
    : nodeId
      ? args.input.commands?.find(
          (entry) => entry.title?.includes(nodeId) || entry.summary?.includes(nodeId),
        )
      : undefined;
  const node: WorkspaceWorkflowInspectorNode = {
    key,
    smithersNodeId: nodeId,
    parentKey: args.parentKey,
    type: ciCheck ? "project-ci-check" : type,
    label:
      ciCheck?.label ??
      stringify(readValue(args.rawNode, ["label", "name", "title"])) ??
      nodeId ??
      "Workflow",
    status: ciCheck
      ? normalizeWorkflowInspectorStatus({ status: ciCheck.status })
      : normalizeWorkflowInspectorStatus(args.rawNode),
    props: objectValue(readValue(args.rawNode, ["props", "attributes", "meta"])) ?? {},
    launchArguments:
      objectValue(args.input.workflowRun.input) ??
      objectValue(readValue(args.rawNode, ["input", "launchArguments"])),
    task: nodeId
      ? {
          nodeId,
          kind:
            taskAttempt?.kind ??
            String(
              readValue(rawTask, ["kind", "mode"]) ??
                readValue(args.rawNode, ["taskKind", "mode", "kind"]) ??
                "unknown",
            ),
          agent:
            stringify(readValue(args.rawNode, ["agent", "agentName"])) ??
            stringify(readValue(rawTask, ["agent", "agentName"])) ??
            undefined,
          iteration:
            readNumber(args.rawNode, ["iteration"]) ??
            readNumber(rawTask, ["iteration"]) ??
            undefined,
          attempt: taskAttempt?.attempt ?? readNumber(args.rawNode, ["attempt"]) ?? undefined,
          workflowTaskAttemptId: taskAttempt?.workflowTaskAttemptId,
        }
      : undefined,
    projectCi: ciCheck
      ? {
          checkId: ciCheck.checkId,
          required: ciCheck.required,
          command: ciCheck.command?.join(" ") ?? null,
          checkResultId: ciCheck.checkResultId,
        }
      : undefined,
    timing: {
      startedAt:
        millisToIso(readNumber(args.rawNode, ["startedAtMs", "started_at_ms"])) ??
        stringify(readValue(args.rawNode, ["startedAt"])) ??
        null,
      finishedAt:
        millisToIso(readNumber(args.rawNode, ["finishedAtMs", "finished_at_ms"])) ??
        stringify(readValue(args.rawNode, ["finishedAt"])) ??
        null,
      updatedAt:
        millisToIso(readNumber(args.rawNode, ["updatedAtMs", "updated_at_ms"])) ??
        stringify(readValue(args.rawNode, ["updatedAt"])) ??
        null,
      elapsedMs: readNumber(args.rawNode, ["elapsedMs", "durationMs"]),
    },
    waitReason: stringify(readValue(args.rawNode, ["waitReason", "reason", "blockedReason"])),
    latestActivity:
      stringify(readValue(args.rawNode, ["latestActivity", "latestLog", "preview"])) ??
      command?.summary ??
      taskAttempt?.summary ??
      null,
    outputPreview: stringify(
      readValue(args.rawNode, ["outputPreview", "output", "result", "summary"]),
    ),
    hasFailedDescendant: false,
    hasWaitingDescendant: false,
    relatedSurfaceTargets: [
      { kind: "handler-thread", threadId: args.input.workflowRun.threadId },
      ...(taskAttempt
        ? [
            {
              kind: "task-agent" as const,
              workflowTaskAttemptId: taskAttempt.workflowTaskAttemptId,
            },
          ]
        : []),
      ...(command ? [{ kind: "command" as const, commandId: command.commandId }] : []),
      ...(ciCheck
        ? [{ kind: "project-ci-check" as const, checkResultId: ciCheck.checkResultId }]
        : []),
      ...(args.input.artifacts ?? []).map((artifact) => ({
        kind: "artifact" as const,
        artifactId: artifact.artifactId,
      })),
    ],
    raw: args.rawNode,
  };
  return [
    node,
    ...children.flatMap((child) =>
      projectSnapshotNode({ input: args.input, rawNode: child, parentKey: key }),
    ),
  ];
}

function buildSyntheticRoot(
  input: WorkflowInspectorProjectionInput,
): WorkspaceWorkflowInspectorNode {
  return {
    key: "workflow",
    smithersNodeId: null,
    parentKey: null,
    type: "workflow",
    label:
      input.workflowRun.workflowName ??
      input.workflowRun.savedEntryId ??
      input.workflowRun.smithersRunId,
    status: normalizeWorkflowInspectorStatus({ status: input.workflowRun.status }),
    props: {},
    launchArguments: objectValue(input.workflowRun.input) ?? {},
    timing: {
      startedAt: input.workflowRun.startedAt ?? null,
      finishedAt: input.workflowRun.finishedAt ?? null,
      updatedAt: input.workflowRun.updatedAt ?? null,
      elapsedMs: null,
    },
    waitReason: null,
    latestActivity: null,
    outputPreview: null,
    hasFailedDescendant: false,
    hasWaitingDescendant: false,
    relatedSurfaceTargets: [{ kind: "handler-thread", threadId: input.workflowRun.threadId }],
    raw: input.snapshot,
  };
}

function buildExpandedNodeKeys(
  nodes: WorkspaceWorkflowInspectorNode[],
  selected: string | null,
  existing: string[],
): string[] {
  const expanded = new Set(existing);
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  for (const node of nodes) {
    if (
      node.status === "running" ||
      node.status === "waiting" ||
      node.status === "failed" ||
      node.key === selected
    ) {
      let cursor: WorkspaceWorkflowInspectorNode | undefined = node;
      while (cursor?.parentKey) {
        expanded.add(cursor.parentKey);
        cursor = byKey.get(cursor.parentKey);
      }
    }
  }
  return [...expanded].filter((key) => byKey.has(key));
}

export function buildVisibleNodeKeys(
  nodes: WorkspaceWorkflowInspectorNode[],
  expandedNodeKeys: string[],
  searchQuery = "",
  matchedNodeKeys: string[] = [],
): string[] {
  if (searchQuery.trim()) {
    const visible = new Set(matchedNodeKeys);
    const byKey = new Map(nodes.map((node) => [node.key, node]));
    for (const key of matchedNodeKeys) {
      let cursor = byKey.get(key);
      while (cursor?.parentKey) {
        visible.add(cursor.parentKey);
        cursor = byKey.get(cursor.parentKey);
      }
    }
    return nodes.filter((node) => visible.has(node.key)).map((node) => node.key);
  }
  const expanded = new Set(expandedNodeKeys);
  return nodes
    .filter((node) => {
      let parent = node.parentKey;
      while (parent) {
        if (!expanded.has(parent)) return false;
        parent = nodes.find((candidate) => candidate.key === parent)?.parentKey ?? null;
      }
      return true;
    })
    .map((node) => node.key);
}

function rollupDescendantStates(nodes: WorkspaceWorkflowInspectorNode[]): void {
  for (const node of nodes.toReversed()) {
    const descendants = nodes.filter((candidate) => candidate.parentKey === node.key);
    node.hasFailedDescendant = descendants.some(
      (child) => child.status === "failed" || child.hasFailedDescendant,
    );
    node.hasWaitingDescendant = descendants.some(
      (child) => child.status === "waiting" || child.hasWaitingDescendant,
    );
  }
}

function buildDetailTabs(
  node: WorkspaceWorkflowInspectorNode | null,
  input: WorkflowInspectorProjectionInput,
): WorkspaceWorkflowInspectorDetailTab[] {
  const events = node?.smithersNodeId
    ? (input.events ?? []).filter((event) => JSON.stringify(event).includes(node.smithersNodeId!))
    : (input.events ?? []);
  return [
    {
      id: "output",
      label: "Output",
      content: node?.outputPreview ?? input.nodeDetail ?? null,
      empty: !node?.outputPreview && !input.nodeDetail,
    },
    {
      id: "diff",
      label: "Diff",
      content:
        readValue(input.nodeDetail, ["diff", "changes"]) ??
        readValue(node?.raw, ["diff", "changes"]) ??
        null,
      empty:
        !readValue(input.nodeDetail, ["diff", "changes"]) &&
        !readValue(node?.raw, ["diff", "changes"]),
    },
    {
      id: "logs",
      label: "Logs",
      content: node?.latestActivity ?? null,
      empty: !node?.latestActivity,
    },
    {
      id: "transcript",
      label: "Transcript",
      content: readValue(input.nodeDetail, ["transcript", "messages"]) ?? null,
      empty: !readValue(input.nodeDetail, ["transcript", "messages"]),
    },
    {
      id: "command",
      label: "Command",
      content: node?.relatedSurfaceTargets.filter((target) => target.kind === "command") ?? [],
      empty: !node?.relatedSurfaceTargets.some((target) => target.kind === "command"),
    },
    { id: "events", label: "Events", content: events, empty: events.length === 0 },
    { id: "raw", label: "Raw JSON", content: node?.raw ?? input.snapshot, empty: false },
  ];
}

function collectSnapshotRoots(snapshot: unknown): unknown[] {
  const root = readValue(snapshot, ["root"]);
  if (root) return [root];
  return collectChildren(snapshot);
}

function collectChildren(raw: unknown): unknown[] {
  for (const key of ["children", "nodes", "childNodes", "items"]) {
    const value = readValue(raw, [key]);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function projectFrame(raw: unknown): WorkspaceWorkflowInspectorFrame | null {
  const frameNo = readNumber(raw, ["frameNo", "frame_no", "frame"]);
  if (frameNo == null) return null;
  const seq = readNumber(raw, ["seq", "eventSeq"]);
  return {
    frameNo,
    seq,
    createdAt:
      millisToIso(readNumber(raw, ["createdAtMs", "timestampMs"])) ??
      stringify(readValue(raw, ["createdAt"])) ??
      null,
    label: `Frame ${frameNo}`,
  };
}

function searchableText(node: WorkspaceWorkflowInspectorNode): string {
  return [
    node.label,
    node.key,
    node.smithersNodeId,
    node.type,
    node.status,
    node.latestActivity,
    node.outputPreview,
    JSON.stringify(node.props),
    JSON.stringify(node.task),
    JSON.stringify(node.projectCi),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function latestEvent(events: unknown[]): unknown | null {
  return (
    events.toSorted(
      (left, right) => (readNumber(right, ["seq"]) ?? 0) - (readNumber(left, ["seq"]) ?? 0),
    )[0] ?? null
  );
}

function hasTaskAgent(raw: unknown): boolean {
  const task = readValue(raw, ["task"]);
  return Boolean(
    readValue(raw, ["agent", "agentName", "model", "prompt"]) ??
    readValue(task, ["agent", "agentName", "model", "prompt"]),
  );
}

function readValue(raw: unknown, keys: string[]): unknown {
  if (!raw || typeof raw !== "object") return undefined;
  for (const key of keys) {
    if (key in raw) return (raw as Record<string, unknown>)[key];
  }
  return undefined;
}

function readNumber(raw: unknown, keys: string[]): number | null {
  const value = readValue(raw, keys);
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function stringify(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function millisToIso(value: number | null): string | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function createStableLabel(raw: unknown): string {
  return stringify(readValue(raw, ["label", "name", "type", "kind"])) ?? "node";
}
