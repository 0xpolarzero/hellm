/**
 * Structured session state POC
 *
 * This file is a lightweight executable sketch of the adopted model in
 * `docs/specs/structured-session-state.spec.md`.
 *
 * It is intentionally small and biased toward clarity over completeness.
 *
 * Core assumptions:
 * - the main orchestrator surface is backed by one pi session
 * - each delegated handler thread is backed by its own pi session
 * - a handler thread may supervise many workflow runs
 * - a handler thread stays interactive across many turns and emits ordered handoff episodes only when it explicitly hands control back
 * - waiting lives in thread/session state, not in fake wait episodes
 */

type WaitState = {
  kind: "user" | "external";
  reason: string;
  resumeWhen: string;
  since: string;
};

type TurnRecord = {
  id: string;
  surfacePiSessionId: string;
  threadId: string | null;
  requestSummary: string;
  status: "running" | "waiting" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type ThreadRecord = {
  id: string;
  parentThreadId: string | null;
  surfacePiSessionId: string;
  title: string;
  objective: string;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  wait: WaitState | null;
  worktree?: string;
  latestWorkflowRunId: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type WorkflowRunRecord = {
  id: string;
  threadId: string;
  smithersRunId: string;
  workflowName: string;
  templateId: string | null;
  presetId: string | null;
  status: "running" | "waiting" | "completed" | "failed" | "cancelled";
  summary: string;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type CommandRecord = {
  id: string;
  turnId: string;
  surfacePiSessionId: string;
  threadId: string | null;
  workflowRunId: string | null;
  parentCommandId: string | null;
  toolName: string;
  executor: "orchestrator" | "handler" | "execute_typescript" | "runtime" | "smithers";
  visibility: "trace" | "summary" | "surface";
  status: "requested" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";
  attempts: number;
  title: string;
  summary: string;
  facts: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type EpisodeRecord = {
  id: string;
  threadId: string;
  // Provenance only: a command may be the thread.handoff action or the most relevant underlying work command,
  // but commands still keep their own summaries and do not emit episodes themselves.
  sourceCommandId: string | null;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
};

type VerificationRecord = {
  id: string;
  threadId: string;
  workflowRunId: string;
  kind: string;
  status: "passed" | "failed" | "cancelled";
  summary: string;
  startedAt: string;
  finishedAt: string;
};

type ArtifactRecord = {
  id: string;
  threadId: string | null;
  workflowRunId: string | null;
  sourceCommandId: string | null;
  kind: "text" | "log" | "json" | "file";
  name: string;
  path: string;
  createdAt: string;
};

type EventRecord = {
  id: string;
  at: string;
  kind: string;
  subject: {
    kind:
      | "session"
      | "turn"
      | "thread"
      | "workflowRun"
      | "command"
      | "episode"
      | "verification"
      | "artifact";
    id: string;
  };
  data?: Record<string, unknown>;
};

type StructuredSessionState = {
  workspace: {
    id: string;
    label: string;
    cwd: string;
    artifactDir: string;
  };
  session: {
    id: string;
    orchestratorPiSessionId: string;
    wait: null | {
      owner: { kind: "orchestrator" } | { kind: "thread"; threadId: string };
      kind: "user" | "external";
      reason: string;
      resumeWhen: string;
      since: string;
    };
  };
  turns: TurnRecord[];
  threads: ThreadRecord[];
  workflowRuns: WorkflowRunRecord[];
  commands: CommandRecord[];
  episodes: EpisodeRecord[];
  verifications: VerificationRecord[];
  artifacts: ArtifactRecord[];
  events: EventRecord[];
};

function now(label: string): string {
  return new Date(`2026-04-18T${label}:00.000Z`).toISOString();
}

const state: StructuredSessionState = {
  workspace: {
    id: "workspace-svvy",
    label: "svvy",
    cwd: "/Users/polarzero/code/projects/svvy",
    artifactDir: ".svvy/artifacts",
  },
  session: {
    id: "session-1",
    orchestratorPiSessionId: "pi-root-session-1",
    wait: null,
  },
  turns: [
    {
      id: "turn-root-1",
      surfacePiSessionId: "pi-root-session-1",
      threadId: null,
      requestSummary: "Design delegated workflow execution for svvy.",
      status: "completed",
      startedAt: now("09:00"),
      updatedAt: now("09:02"),
      finishedAt: now("09:02"),
    },
    {
      id: "turn-thread-1",
      surfacePiSessionId: "pi-thread-session-1",
      threadId: "thread-1",
      requestSummary: "Reuse or author the workflow that should handle the delegated design task.",
      status: "completed",
      startedAt: now("09:02"),
      updatedAt: now("09:11"),
      finishedAt: now("09:11"),
    },
    {
      id: "turn-thread-2",
      surfacePiSessionId: "pi-thread-session-1",
      threadId: "thread-1",
      requestSummary:
        "Clarification from the user about how workflow pause and resume should behave.",
      status: "completed",
      startedAt: now("09:12"),
      updatedAt: now("09:20"),
      finishedAt: now("09:20"),
    },
  ],
  threads: [
    {
      id: "thread-1",
      parentThreadId: null,
      surfacePiSessionId: "pi-thread-session-1",
      title: "Workflow Execution Design",
      objective:
        "Own the delegated design task and supervise workflow selection, pause, resume, and final synthesis.",
      status: "completed",
      wait: null,
      latestWorkflowRunId: "run-2",
      startedAt: now("09:02"),
      updatedAt: now("09:20"),
      finishedAt: now("09:20"),
    },
  ],
  workflowRuns: [
    {
      id: "run-1",
      threadId: "thread-1",
      smithersRunId: "smithers-run-101",
      workflowName: "authored-design-workflow",
      templateId: "single_task",
      presetId: null,
      status: "waiting",
      summary:
        "Paused for clarification about whether the handler thread or orchestrator owns workflow resume decisions.",
      startedAt: now("09:03"),
      updatedAt: now("09:11"),
      finishedAt: null,
    },
    {
      id: "run-2",
      threadId: "thread-1",
      smithersRunId: "smithers-run-102",
      workflowName: "authored-design-workflow-v2",
      templateId: "single_task",
      presetId: null,
      status: "completed",
      summary: "Completed after clarification and produced the final design synthesis.",
      startedAt: now("09:14"),
      updatedAt: now("09:20"),
      finishedAt: now("09:20"),
    },
  ],
  commands: [
    {
      id: "cmd-1",
      turnId: "turn-root-1",
      surfacePiSessionId: "pi-root-session-1",
      threadId: null,
      workflowRunId: null,
      parentCommandId: null,
      toolName: "thread.start",
      executor: "orchestrator",
      visibility: "surface",
      status: "succeeded",
      attempts: 1,
      title: "Start handler thread",
      summary: "Opened a delegated handler thread for the workflow execution design objective.",
      facts: { threadId: "thread-1", title: "Workflow Execution Design" },
      error: null,
      startedAt: now("09:02"),
      updatedAt: now("09:02"),
      finishedAt: now("09:02"),
    },
    {
      id: "cmd-2",
      turnId: "turn-thread-1",
      surfacePiSessionId: "pi-thread-session-1",
      threadId: "thread-1",
      workflowRunId: "run-1",
      parentCommandId: null,
      toolName: "workflow.start",
      executor: "handler",
      visibility: "surface",
      status: "waiting",
      attempts: 1,
      title: "Start workflow run",
      summary: "Started the first workflow run for the delegated design objective.",
      facts: { smithersRunId: "smithers-run-101" },
      error: null,
      startedAt: now("09:03"),
      updatedAt: now("09:11"),
      finishedAt: null,
    },
    {
      id: "cmd-3",
      turnId: "turn-thread-2",
      surfacePiSessionId: "pi-thread-session-1",
      threadId: "thread-1",
      workflowRunId: "run-2",
      parentCommandId: null,
      toolName: "workflow.start",
      executor: "handler",
      visibility: "surface",
      status: "succeeded",
      attempts: 1,
      title: "Start repaired workflow run",
      summary:
        "Started the repaired workflow run after clarification and completed the delegated objective.",
      facts: { smithersRunId: "smithers-run-102" },
      error: null,
      startedAt: now("09:14"),
      updatedAt: now("09:20"),
      finishedAt: now("09:20"),
    },
  ],
  episodes: [
    {
      id: "episode-1",
      threadId: "thread-1",
      sourceCommandId: "cmd-3",
      title: "Workflow Execution Design Finalized",
      summary:
        "Settled that the orchestrator delegates to handler threads, handler threads supervise Smithers workflow runs, and each handler thread explicitly hands control back through ordered handoff episodes.",
      body: "The delegated objective should live inside a handler thread backed by pi. That handler thread may reuse a template, use a preset, author a custom workflow, rerun after repair, and resume after clarification. Smithers owns workflow execution, while the handler thread owns the delegated objective lifecycle until it explicitly hands control back to the orchestrator with a handoff episode.",
      createdAt: now("09:20"),
    },
  ],
  verifications: [],
  artifacts: [
    {
      id: "artifact-1",
      threadId: "thread-1",
      workflowRunId: "run-2",
      sourceCommandId: "cmd-3",
      kind: "text",
      name: "design-summary.md",
      path: ".svvy/artifacts/thread-1/design-summary.md",
      createdAt: now("09:20"),
    },
  ],
  events: [
    {
      id: "event-1",
      at: now("09:02"),
      kind: "thread.created",
      subject: { kind: "thread", id: "thread-1" },
      data: { title: "Workflow Execution Design" },
    },
    {
      id: "event-2",
      at: now("09:03"),
      kind: "workflowRun.created",
      subject: { kind: "workflowRun", id: "run-1" },
      data: { smithersRunId: "smithers-run-101" },
    },
    {
      id: "event-3",
      at: now("09:20"),
      kind: "episode.created",
      subject: { kind: "episode", id: "episode-1" },
      data: { threadId: "thread-1" },
    },
  ],
};

console.log(JSON.stringify(state, null, 2));
