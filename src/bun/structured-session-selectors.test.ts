import { describe, expect, it } from "bun:test";
import type {
  StructuredArtifactRecord,
  StructuredCommandRecord,
  StructuredEpisodeRecord,
  StructuredLifecycleEventRecord,
  StructuredPiSessionRecord,
  StructuredProjectCiCheckResultRecord,
  StructuredProjectCiRunRecord,
  StructuredSessionSnapshot,
  StructuredThreadContextRecord,
  StructuredThreadRecord,
  StructuredThreadStatus,
  StructuredTurnRecord,
  StructuredWorkflowRunRecord,
} from "./structured-session-state";
import {
  buildStructuredCommandInspector,
  buildStructuredHandlerThreadInspector,
  buildStructuredHandlerThreadSummaries,
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
  buildStructuredWorkflowTaskAttemptInspector,
  deriveStructuredSessionStatus,
  getLatestFailureContext,
  groupThreadIdsByStatus,
  hasStructuredSessionFacts,
} from "./structured-session-selectors";

type StructuredSessionSnapshotFixture = Omit<
  Partial<StructuredSessionSnapshot>,
  | "turns"
  | "threads"
  | "threadContexts"
  | "commands"
  | "episodes"
  | "ciRuns"
  | "ciCheckResults"
  | "workflowRuns"
  | "workflowTaskAttempts"
  | "workflowTaskMessages"
  | "artifacts"
  | "events"
> & {
  threads?: Partial<StructuredThreadRecord>[];
  threadContexts?: Partial<StructuredThreadContextRecord>[];
  turns?: Partial<StructuredTurnRecord>[];
  commands?: Partial<StructuredCommandRecord>[];
  episodes?: Partial<StructuredEpisodeRecord>[];
  ciRuns?: Partial<StructuredProjectCiRunRecord>[];
  ciCheckResults?: Partial<StructuredProjectCiCheckResultRecord>[];
  workflowRuns?: Partial<StructuredWorkflowRunRecord>[];
  workflowTaskAttempts?: Partial<StructuredSessionSnapshot["workflowTaskAttempts"][number]>[];
  workflowTaskMessages?: Partial<StructuredSessionSnapshot["workflowTaskMessages"][number]>[];
  artifacts?: Partial<StructuredArtifactRecord>[];
  events?: Partial<StructuredLifecycleEventRecord>[];
};

function createSessionSnapshot(
  overrides: StructuredSessionSnapshotFixture = {},
): StructuredSessionSnapshot {
  const {
    threads: overrideThreads,
    threadContexts: overrideThreadContexts,
    turns: overrideTurns,
    commands: overrideCommands,
    episodes: overrideEpisodes,
    ciRuns: overrideCiRuns,
    ciCheckResults: overrideCiCheckResults,
    workflowRuns: overrideWorkflowRuns,
    workflowTaskAttempts: overrideWorkflowTaskAttempts,
    workflowTaskMessages: overrideWorkflowTaskMessages,
    artifacts: overrideArtifacts,
    events: overrideEvents,
    ...rest
  } = overrides;

  const turns =
    overrideTurns?.map((turn) => {
      const base: StructuredTurnRecord = {
        id: "turn-001",
        sessionId: "session-selectors",
        surfacePiSessionId: "session-selectors",
        threadId: null,
        requestSummary: "Selector turn",
        turnDecision: "reply",
        status: "completed",
        startedAt: "2026-04-18T07:00:00.000Z",
        updatedAt: "2026-04-18T07:01:00.000Z",
        finishedAt: "2026-04-18T07:01:00.000Z",
      };
      return { ...base, ...turn };
    }) ?? [];

  const threads =
    overrideThreads?.map((thread, index) => {
      const base: StructuredThreadRecord = {
        id: `thread-00${index + 1}`,
        sessionId: "session-selectors",
        turnId: "turn-001",
        parentThreadId: null,
        surfacePiSessionId: `pi-thread-00${index + 1}`,
        title: "Selector thread",
        objective: "Selector objective",
        status: "completed" as StructuredThreadStatus,
        wait: null,
        loadedContextKeys: [],
        startedAt: "2026-04-18T07:00:00.000Z",
        updatedAt: "2026-04-18T07:01:00.000Z",
        finishedAt: "2026-04-18T07:01:00.000Z",
      };
      return { ...base, ...thread };
    }) ?? [];

  const threadContexts =
    overrideThreadContexts?.map((threadContext, index) => {
      const base: StructuredThreadContextRecord = {
        id: `thread-context-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-001",
        contextKey: "ci",
        contextVersion: "2026-04-18",
        loadedByCommandId: null,
        loadedAt: "2026-04-18T07:00:30.000Z",
      };
      return { ...base, ...threadContext };
    }) ?? [];

  const commands =
    overrideCommands?.map((command, index) => {
      const base: StructuredCommandRecord = {
        id: `command-00${index + 1}`,
        sessionId: "session-selectors",
        turnId: "turn-001",
        workflowTaskAttemptId: null,
        surfacePiSessionId: "pi-thread-001",
        threadId: "thread-001",
        workflowRunId: null,
        parentCommandId: null,
        toolName: "execute_typescript",
        executor: "handler",
        visibility: "trace",
        status: "succeeded",
        attempts: 1,
        title: "Selector command",
        summary: "Selector command summary",
        facts: null,
        error: null,
        startedAt: "2026-04-18T07:00:30.000Z",
        updatedAt: "2026-04-18T07:01:00.000Z",
        finishedAt: "2026-04-18T07:01:00.000Z",
      };
      return { ...base, ...command };
    }) ?? [];

  const episodes =
    overrideEpisodes?.map((episode, index) => {
      const base: StructuredEpisodeRecord = {
        id: `episode-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-001",
        sourceCommandId: "command-001",
        kind: "analysis",
        title: "Selector episode",
        summary: "Selector episode summary",
        body: "Selector body",
        createdAt: "2026-04-18T07:01:00.000Z",
      };
      return { ...base, ...episode };
    }) ?? [];

  const ciRuns =
    overrideCiRuns?.map((ciRun, index) => {
      const base: StructuredProjectCiRunRecord = {
        id: `ci-run-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-002",
        workflowRunId: "workflow-001",
        smithersRunId: `smithers-ci-run-${index + 1}`,
        workflowId: "project_ci",
        entryPath: ".svvy/workflows/entries/ci/project-ci.tsx",
        status: "passed",
        summary: "Project CI summary",
        createdAt: "2026-04-18T07:01:30.000Z",
        updatedAt: "2026-04-18T07:02:00.000Z",
        startedAt: "2026-04-18T07:01:30.000Z",
        finishedAt: "2026-04-18T07:02:00.000Z",
      };
      return { ...base, ...ciRun };
    }) ?? [];

  const ciCheckResults =
    overrideCiCheckResults?.map((ciCheckResult, index) => {
      const base: StructuredProjectCiCheckResultRecord = {
        id: `ci-check-00${index + 1}`,
        sessionId: "session-selectors",
        ciRunId: "ci-run-001",
        workflowRunId: "workflow-001",
        checkId: "test",
        label: "Tests",
        kind: "test",
        status: "passed",
        required: true,
        command: ["bun", "test"],
        exitCode: 0,
        summary: "Tests passed.",
        artifactIds: [],
        startedAt: "2026-04-18T07:01:30.000Z",
        finishedAt: "2026-04-18T07:02:00.000Z",
        createdAt: "2026-04-18T07:01:30.000Z",
        updatedAt: "2026-04-18T07:02:00.000Z",
      };
      return { ...base, ...ciCheckResult };
    }) ?? [];

  const workflowRuns =
    overrideWorkflowRuns?.map((workflowRun, index) => {
      const base: StructuredWorkflowRunRecord = {
        id: `workflow-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-003",
        commandId: "command-003",
        smithersRunId: `smithers-run-${index + 1}`,
        workflowName: "selector-workflow",
        workflowSource: "saved",
        entryPath: ".svvy/workflows/entries/selector-workflow.tsx",
        savedEntryId: "selector_workflow",
        status: "running",
        smithersStatus: "running",
        waitKind: null,
        continuedFromRunIds: [],
        activeDescendantRunId: null,
        lastEventSeq: -1,
        pendingAttentionSeq: null,
        lastAttentionSeq: null,
        heartbeatAt: null,
        summary: "Workflow summary",
        startedAt: "2026-04-18T07:02:30.000Z",
        updatedAt: "2026-04-18T07:03:00.000Z",
        finishedAt: null,
      };
      return { ...base, ...workflowRun };
    }) ?? [];

  const workflowTaskAttempts =
    overrideWorkflowTaskAttempts?.map((workflowTaskAttempt, index) => {
      const base: StructuredSessionSnapshot["workflowTaskAttempts"][number] = {
        id: `workflow-task-attempt-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-001",
        workflowRunId: "workflow-001",
        smithersRunId: `smithers-run-${index + 1}`,
        nodeId: "task",
        iteration: 0,
        attempt: index + 1,
        surfacePiSessionId: "pi-task-agent-001",
        title: "task",
        summary: "Workflow task attempt summary",
        kind: "agent",
        status: "completed",
        smithersState: "finished",
        prompt: "Solve the delegated task.",
        responseText: '{"status":"completed"}',
        error: null,
        cached: false,
        jjPointer: null,
        jjCwd: null,
        heartbeatAt: null,
        agentId: "svvy-workflow-task-agent",
        agentModel: "gpt-5.4",
        agentEngine: "pi",
        agentResume: "/tmp/task-agent-session",
        meta: null,
        startedAt: "2026-04-18T07:02:30.000Z",
        updatedAt: "2026-04-18T07:03:00.000Z",
        finishedAt: "2026-04-18T07:03:00.000Z",
      };
      return { ...base, ...workflowTaskAttempt };
    }) ?? [];

  const workflowTaskMessages =
    overrideWorkflowTaskMessages?.map((workflowTaskMessage, index) => {
      const base: StructuredSessionSnapshot["workflowTaskMessages"][number] = {
        id: `workflow-task-message-00${index + 1}`,
        sessionId: "session-selectors",
        workflowTaskAttemptId: "workflow-task-attempt-001",
        role: index === 0 ? "user" : "assistant",
        source: index === 0 ? "prompt" : "responseText",
        smithersEventSeq: null,
        text: index === 0 ? "Solve the delegated task." : '{"status":"completed"}',
        createdAt: "2026-04-18T07:02:45.000Z",
      };
      return { ...base, ...workflowTaskMessage };
    }) ?? [];

  const artifacts =
    overrideArtifacts?.map((artifact, index) => {
      const base: StructuredArtifactRecord = {
        id: `artifact-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-001",
        workflowRunId: null,
        workflowTaskAttemptId: null,
        sourceCommandId: "command-001",
        kind: "text",
        name: `artifact-${index + 1}.md`,
        path: undefined,
        content: "artifact content",
        createdAt: "2026-04-18T07:01:30.000Z",
      };
      return { ...base, ...artifact };
    }) ?? [];

  const events =
    overrideEvents?.map((event, index) => {
      const base: StructuredLifecycleEventRecord = {
        id: `event-00${index + 1}`,
        sessionId: "session-selectors",
        at: "2026-04-18T07:00:00.000Z",
        kind: "session.created",
        subject: { kind: "session", id: "session-selectors" },
      };
      return { ...base, ...event };
    }) ?? [];

  return {
    workspace: {
      id: "/repo/svvy",
      label: "svvy",
      cwd: "/repo/svvy",
      artifactDir: "/repo/svvy/.svvy/artifacts",
    },
    pi: {
      sessionId: "session-selectors",
      title: "Selector Session",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 7,
      status: "idle",
      createdAt: "2026-04-18T07:00:00.000Z",
      updatedAt: "2026-04-18T07:10:00.000Z",
    } satisfies StructuredPiSessionRecord,
    session: {
      id: "session-selectors",
      orchestratorPiSessionId: "session-selectors",
      wait: null,
    },
    turns,
    threads,
    threadContexts,
    commands,
    episodes,
    ciRuns,
    ciCheckResults,
    workflowRuns,
    workflowTaskAttempts,
    workflowTaskMessages,
    artifacts,
    events,
    ...rest,
  };
}

describe("structured session selectors", () => {
  it("derives session status from wait, running work, latest failed thread, and idle state", () => {
    expect(
      deriveStructuredSessionStatus({
        wait: {
          owner: { kind: "thread", threadId: "thread-001" },
          kind: "user",
          reason: "Need clarification",
          resumeWhen: "Resume on answer",
          since: "2026-04-18T10:00:00.000Z",
        },
        threads: [],
      }),
    ).toBe("waiting");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        threads: [
          {
            status: "running-handler",
            updatedAt: "2026-04-18T10:05:00.000Z",
          },
        ],
      }),
    ).toBe("running");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        threads: [
          {
            status: "completed",
            updatedAt: "2026-04-18T10:01:00.000Z",
          },
          {
            status: "troubleshooting",
            updatedAt: "2026-04-18T10:02:00.000Z",
          },
        ],
      }),
    ).toBe("error");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        threads: [
          {
            status: "completed",
            updatedAt: "2026-04-18T10:05:00.000Z",
          },
        ],
      }),
    ).toBe("idle");
  });

  it("builds a session view with workflow-run-centric counts and summary fields", () => {
    const snapshot = createSessionSnapshot({
      session: {
        id: "session-selectors",
        orchestratorPiSessionId: "session-selectors",
        wait: {
          owner: { kind: "thread", threadId: "thread-003" },
          kind: "external",
          reason: "Need workflow ownership decision",
          resumeWhen: "Resume when the rollout owner is confirmed.",
          since: "2026-04-18T10:03:00.000Z",
        },
      },
      turns: [
        {
          id: "turn-001",
          status: "completed",
          updatedAt: "2026-04-18T10:01:00.000Z",
        },
      ],
      threads: [
        {
          id: "thread-003",
          title: "Workflow objective",
          objective: "Workflow body",
          status: "waiting",
          wait: {
            owner: "handler",
            kind: "external",
            reason: "Need clarification",
            resumeWhen: "Resume when the user decides ownership.",
            since: "2026-04-18T10:03:00.000Z",
          },
          startedAt: "2026-04-18T10:02:30.000Z",
          updatedAt: "2026-04-18T10:03:00.000Z",
          finishedAt: null,
        },
        {
          id: "thread-001",
          title: "Direct objective",
          objective: "Direct body",
          status: "completed",
          startedAt: "2026-04-18T10:00:00.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
          finishedAt: "2026-04-18T10:01:00.000Z",
        },
        {
          id: "thread-002",
          title: "Project CI objective",
          objective: "Project CI body",
          status: "troubleshooting",
          startedAt: "2026-04-18T10:00:30.000Z",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      commands: [
        {
          id: "command-001",
          toolName: "execute_typescript",
          visibility: "summary",
          title: "Inspect docs",
          summary: "Read 2 files and created 1 artifact.",
          facts: {
            repoReads: 2,
            artifactsCreated: 1,
          },
          threadId: "thread-001",
          updatedAt: "2026-04-18T10:01:00.000Z",
        },
        {
          id: "command-002",
          parentCommandId: "command-001",
          toolName: "api.repo.readFile",
          visibility: "trace",
          title: "Read docs/prd.md",
          summary: "Loaded docs/prd.md.",
          facts: {
            path: "docs/prd.md",
          },
          threadId: "thread-001",
          updatedAt: "2026-04-18T10:00:30.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-001",
          threadId: "thread-001",
          kind: "analysis",
          summary: "Direct summary",
          createdAt: "2026-04-18T10:01:00.000Z",
        },
        {
          id: "episode-002",
          threadId: "thread-003",
          kind: "workflow",
          summary: "Workflow episode summary",
          createdAt: "2026-04-18T10:03:30.000Z",
        },
      ],
      ciRuns: [
        {
          id: "ci-run-001",
          threadId: "thread-002",
          workflowRunId: "workflow-002",
          status: "failed",
          summary: "Project CI failed",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      ciCheckResults: [
        {
          id: "ci-check-001",
          ciRunId: "ci-run-001",
          workflowRunId: "workflow-002",
          checkId: "test",
          label: "Tests",
          status: "failed",
          exitCode: 1,
          summary: "Regression test failed.",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "workflow-001",
          threadId: "thread-003",
          status: "waiting",
          summary: "Workflow waiting for clarification",
          updatedAt: "2026-04-18T10:03:00.000Z",
        },
      ],
      artifacts: [
        {
          id: "artifact-001",
          threadId: "thread-001",
          sourceCommandId: "command-001",
          createdAt: "2026-04-18T10:01:30.000Z",
        },
      ],
      events: [
        {
          id: "event-001",
          at: "2026-04-18T10:00:00.000Z",
        },
      ],
    });

    const view = buildStructuredSessionView(snapshot);
    expect(view).toEqual({
      title: "Selector Session",
      sessionStatus: "waiting",
      wait: snapshot.session.wait,
      counts: {
        turns: 1,
        threads: 3,
        commands: 2,
        episodes: 2,
        ciRuns: 1,
        ciChecks: 1,
        workflows: 1,
        artifacts: 1,
        events: 1,
      },
      threadIdsByStatus: {
        runningHandler: [],
        runningWorkflow: [],
        waiting: ["thread-003"],
        troubleshooting: ["thread-002"],
      },
      threadIds: ["thread-001", "thread-002", "thread-003"],
      latestEpisodePreview: "Workflow episode summary",
      latestWorkflowRunSummary: "Workflow waiting for clarification",
      commandRollups: [
        {
          commandId: "command-001",
          threadId: "thread-001",
          workflowRunId: null,
          workflowTaskAttemptId: null,
          toolName: "execute_typescript",
          visibility: "summary",
          status: "succeeded",
          title: "Inspect docs",
          summary: "Read 2 files and created 1 artifact.",
          childCount: 1,
          summaryChildCount: 0,
          traceChildCount: 1,
          summaryChildren: [],
          updatedAt: "2026-04-18T10:01:00.000Z",
        },
      ],
    });

    const summary = buildStructuredSessionSummaryProjection(snapshot);
    expect(summary).toEqual({
      sessionId: "session-selectors",
      title: "Selector Session",
      sessionStatus: "waiting",
      status: "waiting",
      preview: "Waiting: Need workflow ownership decision",
      updatedAt: "2026-04-18T10:03:30.000Z",
      counts: view.counts,
      wait: snapshot.session.wait,
      threadIds: view.threadIds,
      latestEpisodePreview: "Workflow episode summary",
      latestWorkflowRunSummary: "Workflow waiting for clarification",
    });
  });

  it("builds a command inspector with parent artifacts plus summary and trace child detail", () => {
    const snapshot = createSessionSnapshot({
      commands: [
        {
          id: "command-parent",
          toolName: "execute_typescript",
          visibility: "summary",
          title: "Inspect docs",
          summary: "Read 2 files and created 1 artifact.",
          facts: {
            repoReads: 2,
            artifactsCreated: 1,
          },
          threadId: "thread-001",
          startedAt: "2026-04-18T10:00:10.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
          finishedAt: "2026-04-18T10:01:00.000Z",
        },
        {
          id: "command-summary-child",
          parentCommandId: "command-parent",
          toolName: "artifact.writeText",
          visibility: "summary",
          title: "Create summary.md",
          summary: "Created summary.md.",
          facts: {
            artifactId: "artifact-child",
            name: "summary.md",
          },
          threadId: "thread-001",
          startedAt: "2026-04-18T10:00:30.000Z",
          updatedAt: "2026-04-18T10:00:40.000Z",
          finishedAt: "2026-04-18T10:00:40.000Z",
        },
        {
          id: "command-trace-child",
          parentCommandId: "command-parent",
          toolName: "repo.readFile",
          visibility: "trace",
          title: "Read docs/prd.md",
          summary: "Loaded docs/prd.md.",
          facts: {
            path: "docs/prd.md",
            bytesRead: 12,
          },
          threadId: "thread-001",
          startedAt: "2026-04-18T10:00:15.000Z",
          updatedAt: "2026-04-18T10:00:20.000Z",
          finishedAt: "2026-04-18T10:00:20.000Z",
        },
      ],
      artifacts: [
        {
          id: "artifact-parent",
          threadId: "thread-001",
          sourceCommandId: "command-parent",
          kind: "text",
          name: "execute-typescript.ts",
          path: "/repo/svvy/.svvy/artifacts/execute-typescript.ts",
          createdAt: "2026-04-18T10:00:11.000Z",
        },
        {
          id: "artifact-child",
          threadId: "thread-001",
          sourceCommandId: "command-summary-child",
          kind: "file",
          name: "summary.md",
          path: "/repo/svvy/.svvy/artifacts/summary.md",
          createdAt: "2026-04-18T10:00:39.000Z",
        },
      ],
    });

    const inspector = buildStructuredCommandInspector(snapshot, "command-trace-child");
    expect(inspector).toEqual({
      commandId: "command-parent",
      threadId: "thread-001",
      workflowRunId: null,
      workflowTaskAttemptId: null,
      toolName: "execute_typescript",
      visibility: "summary",
      status: "succeeded",
      title: "Inspect docs",
      summary: "Read 2 files and created 1 artifact.",
      facts: {
        repoReads: 2,
        artifactsCreated: 1,
      },
      error: null,
      startedAt: "2026-04-18T10:00:10.000Z",
      updatedAt: "2026-04-18T10:01:00.000Z",
      finishedAt: "2026-04-18T10:01:00.000Z",
      artifacts: [
        {
          artifactId: "artifact-parent",
          kind: "text",
          name: "execute-typescript.ts",
          path: "/repo/svvy/.svvy/artifacts/execute-typescript.ts",
          createdAt: "2026-04-18T10:00:11.000Z",
        },
      ],
      childCount: 2,
      summaryChildCount: 1,
      traceChildCount: 1,
      summaryChildren: [
        {
          commandId: "command-summary-child",
          toolName: "artifact.writeText",
          status: "succeeded",
          title: "Create summary.md",
          summary: "Created summary.md.",
          error: null,
          visibility: "summary",
          facts: {
            artifactId: "artifact-child",
            name: "summary.md",
          },
          startedAt: "2026-04-18T10:00:30.000Z",
          updatedAt: "2026-04-18T10:00:40.000Z",
          finishedAt: "2026-04-18T10:00:40.000Z",
          artifacts: [
            {
              artifactId: "artifact-child",
              kind: "file",
              name: "summary.md",
              path: "/repo/svvy/.svvy/artifacts/summary.md",
              createdAt: "2026-04-18T10:00:39.000Z",
            },
          ],
        },
      ],
      traceChildren: [
        {
          commandId: "command-trace-child",
          toolName: "repo.readFile",
          status: "succeeded",
          title: "Read docs/prd.md",
          summary: "Loaded docs/prd.md.",
          error: null,
          visibility: "trace",
          facts: {
            path: "docs/prd.md",
            bytesRead: 12,
          },
          startedAt: "2026-04-18T10:00:15.000Z",
          updatedAt: "2026-04-18T10:00:20.000Z",
          finishedAt: "2026-04-18T10:00:20.000Z",
          artifacts: [],
        },
      ],
    });
  });

  it("projects delegated handler-thread summaries and inspector detail without pulling in orchestrator-local threads", () => {
    const snapshot = createSessionSnapshot({
      session: {
        id: "session-thread-summary",
        orchestratorPiSessionId: "session-thread-summary",
        wait: null,
      },
      threads: [
        {
          id: "thread-local",
          surfacePiSessionId: "session-thread-summary",
          title: "Local reply",
          objective: "Answer in orchestrator",
          status: "completed",
          updatedAt: "2026-04-18T10:01:00.000Z",
        },
        {
          id: "thread-handler",
          surfacePiSessionId: "pi-thread-handler",
          title: "Parser fix thread",
          objective: "Patch the parser bug and add regression coverage.",
          status: "completed",
          loadedContextKeys: ["ci"],
          updatedAt: "2026-04-18T10:04:30.000Z",
          finishedAt: "2026-04-18T10:04:30.000Z",
        },
      ],
      commands: [
        {
          id: "command-handler-parent",
          threadId: "thread-handler",
          toolName: "execute_typescript",
          visibility: "summary",
          title: "Patch parser transitions",
          summary: "Updated parser transitions and wrote a regression test.",
          updatedAt: "2026-04-18T10:03:20.000Z",
          startedAt: "2026-04-18T10:03:00.000Z",
          finishedAt: "2026-04-18T10:03:20.000Z",
        },
        {
          id: "command-handler-child",
          threadId: "thread-handler",
          parentCommandId: "command-handler-parent",
          toolName: "artifact.writeText",
          visibility: "summary",
          title: "Write parser test",
          summary: "Created parser regression coverage.",
          updatedAt: "2026-04-18T10:03:10.000Z",
          startedAt: "2026-04-18T10:03:05.000Z",
          finishedAt: "2026-04-18T10:03:10.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-handler-1",
          threadId: "thread-handler",
          kind: "change",
          title: "First handoff",
          summary: "Patched the parser state transitions.",
          createdAt: "2026-04-18T10:03:30.000Z",
        },
        {
          id: "episode-handler-2",
          threadId: "thread-handler",
          kind: "change",
          title: "Latest handoff",
          summary: "Added parser regression coverage and handed back the thread.",
          createdAt: "2026-04-18T10:04:30.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "workflow-handler-1",
          threadId: "thread-handler",
          workflowName: "single_task",
          status: "completed",
          summary: "Patched parser transitions.",
          updatedAt: "2026-04-18T10:03:25.000Z",
        },
        {
          id: "workflow-handler-2",
          threadId: "thread-handler",
          workflowName: "project_ci",
          status: "completed",
          summary: "Project CI passed after adding regression coverage.",
          updatedAt: "2026-04-18T10:04:10.000Z",
        },
      ],
      ciRuns: [
        {
          id: "ci-run-handler-1",
          threadId: "thread-handler",
          workflowRunId: "workflow-handler-2",
          workflowId: "project_ci",
          status: "passed",
          summary: "Project CI passed.",
          updatedAt: "2026-04-18T10:04:10.000Z",
          finishedAt: "2026-04-18T10:04:10.000Z",
        },
      ],
      ciCheckResults: [
        {
          id: "ci-check-handler-1",
          ciRunId: "ci-run-handler-1",
          workflowRunId: "workflow-handler-2",
          checkId: "regression",
          label: "Regression coverage",
          status: "passed",
          summary: "Regression coverage passed.",
          updatedAt: "2026-04-18T10:04:10.000Z",
          finishedAt: "2026-04-18T10:04:10.000Z",
        },
      ],
      artifacts: [
        {
          id: "artifact-handler-1",
          threadId: "thread-handler",
          sourceCommandId: "command-handler-parent",
          kind: "file",
          name: "parser-regression.test.ts",
          path: "/repo/svvy/.svvy/artifacts/parser-regression.test.ts",
          createdAt: "2026-04-18T10:03:12.000Z",
        },
      ],
    });

    expect(buildStructuredHandlerThreadSummaries(snapshot)).toEqual([
      {
        threadId: "thread-handler",
        surfacePiSessionId: "pi-thread-handler",
        title: "Parser fix thread",
        objective: "Patch the parser bug and add regression coverage.",
        status: "completed",
        wait: null,
        startedAt: "2026-04-18T07:00:00.000Z",
        updatedAt: "2026-04-18T10:04:30.000Z",
        finishedAt: "2026-04-18T10:04:30.000Z",
        commandCount: 2,
        workflowRunCount: 2,
        workflowTaskAttemptCount: 0,
        episodeCount: 2,
        artifactCount: 1,
        ciRunCount: 1,
        loadedContextKeys: ["ci"],
        latestWorkflowRun: {
          workflowRunId: "workflow-handler-2",
          workflowName: "project_ci",
          status: "completed",
          summary: "Project CI passed after adding regression coverage.",
          updatedAt: "2026-04-18T10:04:10.000Z",
        },
        latestCiRun: {
          ciRunId: "ci-run-handler-1",
          workflowRunId: "workflow-handler-2",
          workflowId: "project_ci",
          status: "passed",
          summary: "Project CI passed.",
          updatedAt: "2026-04-18T10:04:10.000Z",
        },
        latestEpisode: {
          episodeId: "episode-handler-2",
          kind: "change",
          title: "Latest handoff",
          summary: "Added parser regression coverage and handed back the thread.",
          createdAt: "2026-04-18T10:04:30.000Z",
        },
      },
    ]);

    expect(buildStructuredHandlerThreadInspector(snapshot, "thread-handler")).toEqual({
      threadId: "thread-handler",
      surfacePiSessionId: "pi-thread-handler",
      title: "Parser fix thread",
      objective: "Patch the parser bug and add regression coverage.",
      status: "completed",
      wait: null,
      startedAt: "2026-04-18T07:00:00.000Z",
      updatedAt: "2026-04-18T10:04:30.000Z",
      finishedAt: "2026-04-18T10:04:30.000Z",
      commandCount: 2,
      workflowRunCount: 2,
      workflowTaskAttemptCount: 0,
      episodeCount: 2,
      artifactCount: 1,
      ciRunCount: 1,
      loadedContextKeys: ["ci"],
      latestWorkflowRun: {
        workflowRunId: "workflow-handler-2",
        workflowName: "project_ci",
        status: "completed",
        summary: "Project CI passed after adding regression coverage.",
        updatedAt: "2026-04-18T10:04:10.000Z",
      },
      latestCiRun: {
        ciRunId: "ci-run-handler-1",
        workflowRunId: "workflow-handler-2",
        workflowId: "project_ci",
        status: "passed",
        summary: "Project CI passed.",
        updatedAt: "2026-04-18T10:04:10.000Z",
      },
      latestEpisode: {
        episodeId: "episode-handler-2",
        kind: "change",
        title: "Latest handoff",
        summary: "Added parser regression coverage and handed back the thread.",
        createdAt: "2026-04-18T10:04:30.000Z",
      },
      commandRollups: [
        {
          commandId: "command-handler-parent",
          threadId: "thread-handler",
          workflowRunId: null,
          workflowTaskAttemptId: null,
          toolName: "execute_typescript",
          visibility: "summary",
          status: "succeeded",
          title: "Patch parser transitions",
          summary: "Updated parser transitions and wrote a regression test.",
          childCount: 1,
          summaryChildCount: 1,
          traceChildCount: 0,
          summaryChildren: [
            {
              commandId: "command-handler-child",
              toolName: "artifact.writeText",
              status: "succeeded",
              title: "Write parser test",
              summary: "Created parser regression coverage.",
              error: null,
            },
          ],
          updatedAt: "2026-04-18T10:03:20.000Z",
        },
      ],
      workflowRuns: [
        {
          workflowRunId: "workflow-handler-2",
          workflowName: "project_ci",
          status: "completed",
          summary: "Project CI passed after adding regression coverage.",
          updatedAt: "2026-04-18T10:04:10.000Z",
        },
        {
          workflowRunId: "workflow-handler-1",
          workflowName: "single_task",
          status: "completed",
          summary: "Patched parser transitions.",
          updatedAt: "2026-04-18T10:03:25.000Z",
        },
      ],
      workflowTaskAttempts: [],
      episodes: [
        {
          episodeId: "episode-handler-2",
          kind: "change",
          title: "Latest handoff",
          summary: "Added parser regression coverage and handed back the thread.",
          createdAt: "2026-04-18T10:04:30.000Z",
        },
        {
          episodeId: "episode-handler-1",
          kind: "change",
          title: "First handoff",
          summary: "Patched the parser state transitions.",
          createdAt: "2026-04-18T10:03:30.000Z",
        },
      ],
      artifacts: [
        {
          artifactId: "artifact-handler-1",
          kind: "file",
          name: "parser-regression.test.ts",
          path: "/repo/svvy/.svvy/artifacts/parser-regression.test.ts",
          createdAt: "2026-04-18T10:03:12.000Z",
        },
      ],
    });
    expect(buildStructuredHandlerThreadInspector(snapshot, "thread-local")).toBeNull();
  });

  it("derives session status from all structured threads while keeping delegated-thread counts separate", () => {
    const snapshot = createSessionSnapshot({
      session: {
        id: "session-sidebar",
        orchestratorPiSessionId: "session-sidebar",
        wait: null,
      },
      threads: [
        {
          id: "thread-local-running",
          surfacePiSessionId: "session-sidebar",
          title: "Orchestrator reconciliation turn",
          objective: "Review the latest handoff.",
          status: "running-handler",
          updatedAt: "2026-04-18T10:05:00.000Z",
        },
        {
          id: "thread-handler-complete",
          surfacePiSessionId: "pi-thread-handler-1",
          title: "Parser fix thread",
          objective: "Patch the parser bug.",
          status: "completed",
          updatedAt: "2026-04-18T10:04:30.000Z",
          finishedAt: "2026-04-18T10:04:30.000Z",
        },
      ],
    });

    expect(buildStructuredSessionView(snapshot)).toMatchObject({
      sessionStatus: "running",
      counts: {
        threads: 1,
      },
      threadIdsByStatus: {
        runningHandler: [],
        runningWorkflow: [],
        waiting: [],
        troubleshooting: [],
      },
      threadIds: ["thread-handler-complete"],
    });

    expect(buildStructuredSessionSummaryProjection(snapshot)).toMatchObject({
      status: "running",
      counts: {
        threads: 1,
      },
      threadIds: ["thread-handler-complete"],
    });
  });

  it("prefers active workflow runs, then terminal episodes, then Project CI summaries in preview", () => {
    const workflowSnapshot = createSessionSnapshot({
      session: {
        id: "session-workflow-preview",
        orchestratorPiSessionId: "session-workflow-preview",
        wait: null,
      },
      workflowRuns: [
        {
          id: "workflow-300",
          threadId: "thread-300",
          status: "running",
          summary: "Delegated workflow is running.",
          updatedAt: "2026-04-18T10:03:00.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-300",
          threadId: "thread-300",
          kind: "workflow",
          summary: "Workflow episode summary",
          createdAt: "2026-04-18T10:04:00.000Z",
        },
      ],
    });
    const workflowSummary = buildStructuredSessionSummaryProjection(workflowSnapshot);
    expect(workflowSummary.preview).toBe("Workflow: Delegated workflow is running.");
    expect(workflowSummary.latestWorkflowRunSummary).toBe("Delegated workflow is running.");

    const episodeSnapshot = createSessionSnapshot({
      session: {
        id: "session-episode-preview",
        orchestratorPiSessionId: "session-episode-preview",
        wait: null,
      },
      workflowRuns: [],
      episodes: [
        {
          id: "episode-400",
          threadId: "thread-400",
          kind: "change",
          summary: "Handler completed successfully.",
          createdAt: "2026-04-18T10:04:00.000Z",
        },
      ],
      ciRuns: [
        {
          id: "ci-run-400",
          threadId: "thread-401",
          workflowRunId: "workflow-401",
          summary: "Older Project CI summary",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
    });
    const episodeSummary = buildStructuredSessionSummaryProjection(episodeSnapshot);
    expect(episodeSummary.preview).toBe("Handler completed successfully.");
    expect(episodeSummary.latestEpisodePreview).toBe("Handler completed successfully.");

    const ciSnapshot = createSessionSnapshot({
      session: {
        id: "session-ci-preview",
        orchestratorPiSessionId: "session-ci-preview",
        wait: null,
      },
      workflowRuns: [],
      episodes: [],
      ciRuns: [
        {
          id: "ci-run-401",
          threadId: "thread-401",
          workflowRunId: "workflow-401",
          summary: "Project CI passed.",
          updatedAt: "2026-04-18T10:05:00.000Z",
          finishedAt: "2026-04-18T10:05:00.000Z",
        },
      ],
    });
    const ciSummary = buildStructuredSessionSummaryProjection(ciSnapshot);
    expect(ciSummary.preview).toBe("Project CI: Project CI passed.");

    const waitingSnapshot = createSessionSnapshot({
      session: {
        id: "session-waiting-preview",
        orchestratorPiSessionId: "session-waiting-preview",
        wait: {
          owner: { kind: "thread", threadId: "thread-500" },
          kind: "user",
          reason: "Need clarification before workflow resume.",
          resumeWhen: "Resume when the rollout owner is confirmed.",
          since: "2026-04-18T10:03:00.000Z",
        },
      },
      workflowRuns: [
        {
          id: "workflow-500",
          threadId: "thread-500",
          status: "waiting",
          summary: "Workflow waiting for clarification.",
          updatedAt: "2026-04-18T10:03:00.000Z",
        },
      ],
    });
    const waitingSummary = buildStructuredSessionSummaryProjection(waitingSnapshot);
    expect(waitingSummary.preview).toBe("Waiting: Need clarification before workflow resume.");
    expect(waitingSummary.status).toBe("waiting");
  });

  it("groups thread ids by status and ignores completed threads", () => {
    const grouped = groupThreadIdsByStatus([
      { id: "thread-001", status: "running-handler" },
      { id: "thread-001a", status: "running-workflow" },
      { id: "thread-002", status: "waiting" },
      { id: "thread-003", status: "troubleshooting" },
      { id: "thread-004", status: "completed" },
    ]);

    expect(grouped).toEqual({
      runningHandler: ["thread-001"],
      runningWorkflow: ["thread-001a"],
      waiting: ["thread-002"],
      troubleshooting: ["thread-003"],
    });
  });

  it("detects facts and latest failure context from workflow-run-centric records", () => {
    const empty = createSessionSnapshot({
      session: {
        id: "session-empty",
        orchestratorPiSessionId: "session-empty",
        wait: null,
      },
      turns: [],
      threads: [],
      commands: [],
      episodes: [],
      ciRuns: [],
      ciCheckResults: [],
      workflowRuns: [],
      artifacts: [],
      events: [],
    });
    expect(hasStructuredSessionFacts(empty)).toBe(false);

    const snapshot = createSessionSnapshot({
      session: {
        id: "session-facts",
        orchestratorPiSessionId: "session-facts",
        wait: null,
      },
      turns: [
        {
          id: "turn-failed",
          status: "failed",
          requestSummary: "Investigate failure",
          updatedAt: "2026-04-18T10:06:00.000Z",
        },
      ],
      threads: [
        {
          id: "thread-failed",
          status: "troubleshooting",
          title: "Thread failure context",
          objective: "Thread objective",
          updatedAt: "2026-04-18T10:07:00.000Z",
          startedAt: "2026-04-18T10:06:30.000Z",
          finishedAt: "2026-04-18T10:07:00.000Z",
        },
      ],
      commands: [
        {
          id: "command-900",
          updatedAt: "2026-04-18T10:07:00.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "workflow-900",
          threadId: "thread-failed",
          summary: "Workflow failed.",
          updatedAt: "2026-04-18T10:07:00.000Z",
        },
      ],
      events: [
        {
          id: "event-900",
          at: "2026-04-18T10:07:00.000Z",
        },
      ],
    });
    expect(hasStructuredSessionFacts(snapshot)).toBe(true);
    expect(getLatestFailureContext(snapshot)).toBe("Thread failure context");
  });

  it("builds a workflow task attempt inspector with transcript, nested command rollups, and artifacts", () => {
    const snapshot = createSessionSnapshot({
      workflowRuns: [
        {
          id: "workflow-attempt-1",
          threadId: "thread-001",
          summary: "Task workflow completed.",
        },
      ],
      workflowTaskAttempts: [
        {
          id: "workflow-task-attempt-1",
          threadId: "thread-001",
          workflowRunId: "workflow-attempt-1",
          smithersRunId: "smithers-run-task-attempt",
          nodeId: "task",
          attempt: 1,
          summary: "Task-agent attempt completed.",
          status: "completed",
          smithersState: "finished",
          prompt: "Read the brief and write the proof file.",
          responseText: '{"status":"completed"}',
          agentResume: "/tmp/task-agent-session.json",
          updatedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      workflowTaskMessages: [
        {
          id: "workflow-task-message-1",
          workflowTaskAttemptId: "workflow-task-attempt-1",
          role: "user",
          source: "prompt",
          text: "Read the brief and write the proof file.",
          createdAt: "2026-04-18T10:01:10.000Z",
        },
        {
          id: "workflow-task-message-2",
          workflowTaskAttemptId: "workflow-task-attempt-1",
          role: "assistant",
          source: "responseText",
          text: '{"status":"completed"}',
          createdAt: "2026-04-18T10:01:20.000Z",
        },
      ],
      commands: [
        {
          id: "command-task-parent",
          workflowTaskAttemptId: "workflow-task-attempt-1",
          threadId: "thread-001",
          workflowRunId: "workflow-attempt-1",
          toolName: "execute_typescript",
          executor: "workflow-task-agent",
          visibility: "summary",
          title: "Run task execute_typescript",
          summary: "Generated the workflow proof file.",
          updatedAt: "2026-04-18T10:01:25.000Z",
        },
        {
          id: "command-task-child",
          workflowTaskAttemptId: "workflow-task-attempt-1",
          threadId: "thread-001",
          workflowRunId: "workflow-attempt-1",
          parentCommandId: "command-task-parent",
          toolName: "repo.writeFile",
          executor: "execute_typescript",
          visibility: "summary",
          title: "Write workflow-proof.txt",
          summary: "Wrote workflow-proof.txt.",
          updatedAt: "2026-04-18T10:01:15.000Z",
          finishedAt: "2026-04-18T10:01:15.000Z",
        },
      ],
      artifacts: [
        {
          id: "artifact-task-1",
          workflowTaskAttemptId: "workflow-task-attempt-1",
          threadId: "thread-001",
          workflowRunId: "workflow-attempt-1",
          sourceCommandId: "command-task-parent",
          kind: "text",
          name: "workflow-proof.txt",
          path: "/repo/svvy/workflow-proof.txt",
          createdAt: "2026-04-18T10:01:30.000Z",
        },
      ],
    });

    expect(
      buildStructuredWorkflowTaskAttemptInspector(snapshot, "workflow-task-attempt-1"),
    ).toEqual({
      workflowTaskAttemptId: "workflow-task-attempt-1",
      workflowRunId: "workflow-attempt-1",
      smithersRunId: "smithers-run-task-attempt",
      nodeId: "task",
      iteration: 0,
      attempt: 1,
      title: "task",
      kind: "agent",
      status: "completed",
      summary: "Task-agent attempt completed.",
      updatedAt: "2026-04-18T10:02:00.000Z",
      commandCount: 2,
      artifactCount: 1,
      transcriptMessageCount: 2,
      surfacePiSessionId: "pi-task-agent-001",
      smithersState: "finished",
      prompt: "Read the brief and write the proof file.",
      responseText: '{"status":"completed"}',
      error: null,
      cached: false,
      jjPointer: null,
      jjCwd: null,
      heartbeatAt: null,
      agentId: "svvy-workflow-task-agent",
      agentModel: "gpt-5.4",
      agentEngine: "pi",
      agentResume: "/tmp/task-agent-session.json",
      meta: null,
      startedAt: "2026-04-18T07:02:30.000Z",
      finishedAt: "2026-04-18T07:03:00.000Z",
      transcript: [
        {
          messageId: "workflow-task-message-1",
          role: "user",
          source: "prompt",
          text: "Read the brief and write the proof file.",
          createdAt: "2026-04-18T10:01:10.000Z",
        },
        {
          messageId: "workflow-task-message-2",
          role: "assistant",
          source: "responseText",
          text: '{"status":"completed"}',
          createdAt: "2026-04-18T10:01:20.000Z",
        },
      ],
      commandRollups: [
        {
          commandId: "command-task-parent",
          threadId: "thread-001",
          workflowRunId: "workflow-attempt-1",
          workflowTaskAttemptId: "workflow-task-attempt-1",
          toolName: "execute_typescript",
          visibility: "summary",
          status: "succeeded",
          title: "Run task execute_typescript",
          summary: "Generated the workflow proof file.",
          childCount: 1,
          summaryChildCount: 1,
          traceChildCount: 0,
          summaryChildren: [
            {
              commandId: "command-task-child",
              toolName: "repo.writeFile",
              status: "succeeded",
              title: "Write workflow-proof.txt",
              summary: "Wrote workflow-proof.txt.",
              error: null,
            },
          ],
          updatedAt: "2026-04-18T10:01:25.000Z",
        },
      ],
      artifacts: [
        {
          artifactId: "artifact-task-1",
          kind: "text",
          name: "workflow-proof.txt",
          path: "/repo/svvy/workflow-proof.txt",
          createdAt: "2026-04-18T10:01:30.000Z",
        },
      ],
    });
  });
});
