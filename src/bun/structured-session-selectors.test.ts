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
  StructuredWorkflowRecord,
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
  | "workflows"
  | "artifacts"
  | "events"
> & {
  threads?: Partial<StructuredThreadRecord>[];
  turns?: Partial<StructuredTurnRecord>[];
  commands?: Partial<StructuredCommandRecord>[];
  episodes?: Partial<StructuredEpisodeRecord>[];
  verifications?: Partial<StructuredVerificationRecord>[];
  workflows?: Partial<StructuredWorkflowRecord>[];
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
    workflows: overrideWorkflows,
    artifacts: overrideArtifacts,
    events: overrideEvents,
    ...rest
  } = overrides;

  const turns =
    overrideTurns?.map((turn) => {
      const base: StructuredTurnRecord = {
        id: "turn-001",
        sessionId: "session-selectors",
        requestSummary: "Selector turn",
        status: "completed",
        startedAt: "2026-04-14T07:00:00.000Z",
        updatedAt: "2026-04-14T07:01:00.000Z",
        finishedAt: "2026-04-14T07:01:00.000Z",
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
        kind: "task",
        title: "Selector thread",
        objective: "Selector objective",
        status: "completed" as StructuredThreadStatus,
        dependsOnThreadIds: [],
        wait: null,
        startedAt: "2026-04-14T07:00:00.000Z",
        updatedAt: "2026-04-14T07:01:00.000Z",
        finishedAt: "2026-04-14T07:01:00.000Z",
      };
      return { ...base, ...thread };
    }) ?? [];

  const commands =
    overrideCommands?.map((command, index) => {
      const base: StructuredCommandRecord = {
        id: `command-00${index + 1}`,
        sessionId: "session-selectors",
        turnId: "turn-001",
        threadId: "thread-001",
        parentCommandId: null,
        toolName: "execute_typescript",
        executor: "execute_typescript",
        visibility: "trace",
        status: "succeeded",
        attempts: 1,
        title: "Selector command",
        summary: "Selector command summary",
        error: null,
        startedAt: "2026-04-14T07:00:30.000Z",
        updatedAt: "2026-04-14T07:01:00.000Z",
        finishedAt: "2026-04-14T07:01:00.000Z",
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
        artifactIds: [],
        createdAt: "2026-04-14T07:01:00.000Z",
      };
      return { ...base, ...episode };
    }) ?? [];

  const verifications =
    overrideVerifications?.map((verification, index) => {
      const base: StructuredVerificationRecord = {
        id: `verification-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-002",
        commandId: "command-002",
        kind: "test",
        status: "passed",
        summary: "Verification summary",
        command: "bun test",
        startedAt: "2026-04-14T07:01:30.000Z",
        finishedAt: "2026-04-14T07:02:00.000Z",
      };
      return { ...base, ...verification };
    }) ?? [];

  const workflows =
    overrideWorkflows?.map((workflow, index) => {
      const base: StructuredWorkflowRecord = {
        id: `workflow-00${index + 1}`,
        sessionId: "session-selectors",
        threadId: "thread-003",
        commandId: "command-003",
        smithersRunId: `smithers-run-${index + 1}`,
        workflowName: "selector-workflow",
        status: "running",
        summary: "Workflow summary",
        startedAt: "2026-04-14T07:02:30.000Z",
        updatedAt: "2026-04-14T07:03:00.000Z",
        finishedAt: null,
      };
      return { ...base, ...workflow };
    }) ?? [];

  const artifacts =
    overrideArtifacts?.map((artifact, index) => {
      const base: StructuredArtifactRecord = {
        id: `artifact-00${index + 1}`,
        sessionId: "session-selectors",
        episodeId: "episode-001",
        sourceCommandId: "command-001",
        kind: "text",
        name: `artifact-${index + 1}.md`,
        path: undefined,
        content: "artifact content",
        createdAt: "2026-04-14T07:01:30.000Z",
      };
      return { ...base, ...artifact };
    }) ?? [];

  const events =
    overrideEvents?.map((event, index) => {
      const base: StructuredLifecycleEventRecord = {
        id: `event-00${index + 1}`,
        sessionId: "session-selectors",
        at: "2026-04-14T07:00:00.000Z",
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
    },
    pi: {
      sessionId: "session-selectors",
      title: "Selector Session",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "high",
      messageCount: 7,
      status: "idle",
      createdAt: "2026-04-14T07:00:00.000Z",
      updatedAt: "2026-04-14T07:10:00.000Z",
    } satisfies StructuredPiSessionRecord,
    session: {
      id: "session-selectors",
      wait: null,
    },
    turns,
    threads,
    commands,
    episodes,
    verifications,
    workflows,
    artifacts,
    events,
    ...rest,
  };
}

describe("structured session selectors", () => {
  it("derives session status from wait, running work, dependency waits, failures, and idle state", () => {
    expect(
      deriveStructuredSessionStatus({
        wait: {
          threadId: "thread-001",
          kind: "user",
          reason: "Need clarification",
          resumeWhen: "Resume on answer",
          since: "2026-04-14T10:00:00.000Z",
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
            updatedAt: "2026-04-14T10:05:00.000Z",
            dependsOnThreadIds: [],
          },
        ],
      }),
    ).toBe("running");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        turns: [],
        threads: [
          {
            status: "waiting",
            updatedAt: "2026-04-14T10:04:00.000Z",
            dependsOnThreadIds: ["thread-002"],
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
            updatedAt: "2026-04-14T10:00:00.000Z",
          },
        ],
        threads: [
          {
            status: "completed",
            updatedAt: "2026-04-14T10:01:00.000Z",
            dependsOnThreadIds: [],
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
            updatedAt: "2026-04-14T10:05:00.000Z",
            dependsOnThreadIds: [],
          },
        ],
      }),
    ).toBe("idle");
  });

  it("builds a session view with structured counts, buckets, and startedAt thread ordering", () => {
    const snapshot = createSessionSnapshot({
      session: {
        id: "session-selectors",
        wait: {
          threadId: "thread-003",
          kind: "external",
          reason: "Need workflow ownership decision",
          resumeWhen: "Resume when the rollout owner is confirmed.",
          since: "2026-04-14T10:03:00.000Z",
        },
      },
      turns: [
        {
          id: "turn-001",
          status: "completed",
          updatedAt: "2026-04-14T10:01:00.000Z",
        },
      ],
      threads: [
        {
          id: "thread-003",
          kind: "workflow",
          title: "Workflow objective",
          objective: "Workflow body",
          status: "waiting",
          dependsOnThreadIds: [],
          wait: {
            kind: "external",
            reason: "Need clarification",
            resumeWhen: "Resume when the user decides ownership.",
            since: "2026-04-14T10:03:00.000Z",
          },
          startedAt: "2026-04-14T10:02:30.000Z",
          updatedAt: "2026-04-14T10:03:00.000Z",
          finishedAt: null,
        },
        {
          id: "thread-001",
          kind: "task",
          title: "Direct objective",
          objective: "Direct body",
          status: "completed",
          dependsOnThreadIds: [],
          wait: null,
          startedAt: "2026-04-14T10:00:00.000Z",
          updatedAt: "2026-04-14T10:01:00.000Z",
          finishedAt: "2026-04-14T10:01:00.000Z",
        },
        {
          id: "thread-002",
          kind: "verification",
          title: "Verification objective",
          objective: "Verification body",
          status: "failed",
          dependsOnThreadIds: [],
          wait: null,
          startedAt: "2026-04-14T10:00:30.000Z",
          updatedAt: "2026-04-14T10:02:00.000Z",
          finishedAt: "2026-04-14T10:02:00.000Z",
        },
      ],
      commands: [
        {
          id: "command-001",
          threadId: "thread-001",
          updatedAt: "2026-04-14T10:01:00.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-001",
          threadId: "thread-001",
          kind: "analysis",
          summary: "Direct summary",
          createdAt: "2026-04-14T10:01:00.000Z",
        },
        {
          id: "episode-002",
          threadId: "thread-003",
          kind: "workflow",
          summary: "Workflow summary",
          createdAt: "2026-04-14T10:03:30.000Z",
        },
      ],
      verifications: [
        {
          id: "verification-001",
          threadId: "thread-002",
          summary: "Verification failed",
          finishedAt: "2026-04-14T10:02:00.000Z",
        },
      ],
      workflows: [
        {
          id: "workflow-001",
          threadId: "thread-003",
          status: "waiting",
          summary: "Workflow waiting for clarification",
          updatedAt: "2026-04-14T10:03:00.000Z",
        },
      ],
      artifacts: [
        {
          id: "artifact-001",
          episodeId: "episode-001",
          sourceCommandId: "command-001",
          createdAt: "2026-04-14T10:01:30.000Z",
        },
      ],
      events: [
        {
          id: "event-001",
          at: "2026-04-14T10:00:00.000Z",
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
        commands: 1,
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
    });

    const summary = buildStructuredSessionSummaryProjection(snapshot);
    expect(summary).toEqual({
      sessionId: "session-selectors",
      title: "Selector Session",
      preview: "Waiting: Need workflow ownership decision",
      status: "waiting",
      updatedAt: "2026-04-14T10:03:30.000Z",
      counts: view.counts,
      wait: snapshot.session.wait,
      threadIds: view.threadIds,
    });
  });

  it("prefers active workflows, then episodes, then verification summaries in the sidebar preview", () => {
    const workflowSnapshot = createSessionSnapshot({
      session: {
        id: "session-workflow-preview",
        wait: null,
      },
      workflows: [
        {
          id: "workflow-300",
          threadId: "thread-300",
          status: "running",
          summary: "Delegated workflow is running.",
          updatedAt: "2026-04-14T10:03:00.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-300",
          threadId: "thread-300",
          kind: "workflow",
          summary: "Workflow episode summary",
          createdAt: "2026-04-14T10:04:00.000Z",
        },
      ],
      verifications: [
        {
          id: "verification-300",
          threadId: "thread-301",
          summary: "Verification summary",
          finishedAt: "2026-04-14T10:02:00.000Z",
        },
      ],
    });
    const workflowSummary = buildStructuredSessionSummaryProjection(workflowSnapshot);
    expect(workflowSummary.preview).toBe("Workflow: Delegated workflow is running.");

    const episodeSnapshot = createSessionSnapshot({
      session: {
        id: "session-episode-preview",
        wait: null,
      },
      workflows: [],
      episodes: [
        {
          id: "episode-400",
          threadId: "thread-400",
          kind: "verification",
          summary: "Verification completed successfully.",
          createdAt: "2026-04-14T10:04:00.000Z",
        },
      ],
      verifications: [
        {
          id: "verification-400",
          threadId: "thread-401",
          summary: "Older verification summary",
          finishedAt: "2026-04-14T10:02:00.000Z",
        },
      ],
    });
    const episodeSummary = buildStructuredSessionSummaryProjection(episodeSnapshot);
    expect(episodeSummary.preview).toBe("Verification: Verification completed successfully.");

    const waitingSnapshot = createSessionSnapshot({
      session: {
        id: "session-waiting-preview",
        wait: {
          threadId: "thread-500",
          kind: "user",
          reason: "Need clarification before workflow resume.",
          resumeWhen: "Resume when the rollout owner is confirmed.",
          since: "2026-04-14T10:03:00.000Z",
        },
      },
      workflows: [
        {
          id: "workflow-500",
          threadId: "thread-500",
          status: "waiting",
          summary: "Workflow waiting for clarification.",
          updatedAt: "2026-04-14T10:03:00.000Z",
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

  it("detects facts and latest failure context from the new structured records", () => {
    const empty = createSessionSnapshot({
      session: {
        id: "session-empty",
        wait: null,
      },
      turns: [],
      threads: [],
      commands: [],
      episodes: [],
      verifications: [],
      workflows: [],
      artifacts: [],
      events: [],
    });
    expect(hasStructuredSessionFacts(empty)).toBe(false);

    const snapshot = createSessionSnapshot({
      session: {
        id: "session-facts",
        wait: null,
      },
      turns: [
        {
          id: "turn-failed",
          status: "failed",
          requestSummary: "Investigate failure",
          updatedAt: "2026-04-14T10:06:00.000Z",
        },
      ],
      threads: [
        {
          id: "thread-failed",
          status: "failed",
          title: "Thread failure context",
          objective: "Thread objective",
          updatedAt: "2026-04-14T10:07:00.000Z",
          startedAt: "2026-04-14T10:06:30.000Z",
          finishedAt: "2026-04-14T10:07:00.000Z",
        },
      ],
      commands: [
        {
          id: "command-900",
          updatedAt: "2026-04-14T10:07:00.000Z",
        },
      ],
      events: [
        {
          id: "event-900",
          at: "2026-04-14T10:07:00.000Z",
        },
      ],
    });
    expect(hasStructuredSessionFacts(snapshot)).toBe(true);
    expect(getLatestFailureContext(snapshot)).toBe("Thread failure context");
  });
});
