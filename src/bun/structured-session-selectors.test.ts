import { describe, expect, it } from "bun:test";
import type {
  StructuredArtifactRecord,
  StructuredCommandRecord,
  StructuredEpisodeRecord,
  StructuredLifecycleEventRecord,
  StructuredPiSessionRecord,
  StructuredSessionSnapshot,
  StructuredThreadRecord,
  StructuredThreadStatus,
  StructuredTurnRecord,
  StructuredVerificationRecord,
  StructuredWorkflowRunRecord,
} from "./structured-session-state";
import {
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
  deriveStructuredSessionStatus,
  getLatestFailureContext,
  groupThreadIdsByStatus,
  hasStructuredSessionFacts,
} from "./structured-session-selectors";

type StructuredSessionSnapshotFixture = Omit<
  Partial<StructuredSessionSnapshot>,
  | "turns"
  | "threads"
  | "commands"
  | "episodes"
  | "verifications"
  | "workflowRuns"
  | "artifacts"
  | "events"
> & {
  threads?: Partial<StructuredThreadRecord>[];
  turns?: Partial<StructuredTurnRecord>[];
  commands?: Partial<StructuredCommandRecord>[];
  episodes?: Partial<StructuredEpisodeRecord>[];
  verifications?: Partial<StructuredVerificationRecord>[];
  workflowRuns?: Partial<StructuredWorkflowRunRecord>[];
  artifacts?: Partial<StructuredArtifactRecord>[];
  events?: Partial<StructuredLifecycleEventRecord>[];
};

function createSessionSnapshot(
  overrides: StructuredSessionSnapshotFixture = {},
): StructuredSessionSnapshot {
  const {
    threads: overrideThreads,
    turns: overrideTurns,
    commands: overrideCommands,
    episodes: overrideEpisodes,
    verifications: overrideVerifications,
    workflowRuns: overrideWorkflowRuns,
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
        latestWorkflowRunId: null,
        startedAt: "2026-04-18T07:00:00.000Z",
        updatedAt: "2026-04-18T07:01:00.000Z",
        finishedAt: "2026-04-18T07:01:00.000Z",
      };
      return { ...base, ...thread };
    }) ?? [];

  const commands =
    overrideCommands?.map((command, index) => {
      const base: StructuredCommandRecord = {
        id: `command-00${index + 1}`,
        sessionId: "session-selectors",
        turnId: "turn-001",
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

  const verifications =
    overrideVerifications?.map((verification, index) => {
      const base: StructuredVerificationRecord = {
        id: `verification-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-002",
        workflowRunId: "workflow-001",
        commandId: "command-002",
        kind: "test",
        status: "passed",
        summary: "Verification summary",
        command: "bun test",
        startedAt: "2026-04-18T07:01:30.000Z",
        finishedAt: "2026-04-18T07:02:00.000Z",
      };
      return { ...base, ...verification };
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
        templateId: "single_task",
        presetId: null,
        status: "running",
        summary: "Workflow summary",
        startedAt: "2026-04-18T07:02:30.000Z",
        updatedAt: "2026-04-18T07:03:00.000Z",
        finishedAt: null,
      };
      return { ...base, ...workflowRun };
    }) ?? [];

  const artifacts =
    overrideArtifacts?.map((artifact, index) => {
      const base: StructuredArtifactRecord = {
        id: `artifact-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-001",
        workflowRunId: null,
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
    commands,
    episodes,
    verifications,
    workflowRuns,
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
        turns: [],
        threads: [],
      }),
    ).toBe("waiting");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        turns: [],
        threads: [
          {
            status: "running",
            updatedAt: "2026-04-18T10:05:00.000Z",
          },
        ],
      }),
    ).toBe("running");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        turns: [
          {
            status: "failed",
            updatedAt: "2026-04-18T10:00:00.000Z",
          },
        ],
        threads: [
          {
            status: "completed",
            updatedAt: "2026-04-18T10:01:00.000Z",
          },
          {
            status: "failed",
            updatedAt: "2026-04-18T10:02:00.000Z",
          },
        ],
      }),
    ).toBe("error");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        turns: [],
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
            kind: "external",
            reason: "Need clarification",
            resumeWhen: "Resume when the user decides ownership.",
            since: "2026-04-18T10:03:00.000Z",
          },
          latestWorkflowRunId: "workflow-001",
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
          title: "Verification objective",
          objective: "Verification body",
          status: "failed",
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
      verifications: [
        {
          id: "verification-001",
          threadId: "thread-002",
          workflowRunId: "workflow-002",
          summary: "Verification failed",
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
        verifications: 1,
        workflows: 1,
        artifacts: 1,
        events: 1,
      },
      threadIdsByStatus: {
        running: [],
        waiting: ["thread-003"],
        failed: ["thread-002"],
      },
      threadIds: ["thread-001", "thread-002", "thread-003"],
      latestEpisodePreview: "Workflow episode summary",
      latestWorkflowRunSummary: "Workflow waiting for clarification",
      commandRollups: [
        {
          commandId: "command-001",
          threadId: "thread-001",
          workflowRunId: null,
          toolName: "execute_typescript",
          visibility: "summary",
          status: "succeeded",
          title: "Inspect docs",
          summary: "Read 2 files and created 1 artifact.",
          childCount: 1,
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

  it("prefers active workflow runs, then terminal episodes, then verification summaries in preview", () => {
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
          kind: "verification",
          summary: "Verification completed successfully.",
          createdAt: "2026-04-18T10:04:00.000Z",
        },
      ],
      verifications: [
        {
          id: "verification-400",
          threadId: "thread-401",
          workflowRunId: "workflow-401",
          summary: "Older verification summary",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
    });
    const episodeSummary = buildStructuredSessionSummaryProjection(episodeSnapshot);
    expect(episodeSummary.preview).toBe("Verification: Verification completed successfully.");
    expect(episodeSummary.latestEpisodePreview).toBe("Verification completed successfully.");

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
      { id: "thread-001", status: "running" },
      { id: "thread-002", status: "waiting" },
      { id: "thread-003", status: "failed" },
      { id: "thread-004", status: "completed" },
    ]);

    expect(grouped).toEqual({
      running: ["thread-001"],
      waiting: ["thread-002"],
      failed: ["thread-003"],
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
      verifications: [],
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
          status: "failed",
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
});
