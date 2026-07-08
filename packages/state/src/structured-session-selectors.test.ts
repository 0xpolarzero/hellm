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
  StructuredWorkflowRunRecord,
} from "./structured-session-state";
import {
  buildStructuredCommandInspector,
  buildStructuredHandlerThreadInspector,
  buildStructuredHandlerThreadSummaries,
  buildStructuredThreadCurrentReadModel,
  buildStructuredThreadEpisodesReadModel,
  buildStructuredThreadGroupReadModel,
  buildStructuredThreadListReadModel,
  buildStructuredSessionSummaryProjection,
  buildStructuredSessionView,
  buildStructuredWorkflowTaskAttemptInspector,
  getStructuredThread,
  deriveStructuredSessionStatus,
  getLatestFailureContext,
  groupThreadIdsByStatus,
  hasStructuredSessionFacts,
  type StructuredCommandStdinState,
} from "./structured-session-selectors";

const EMPTY_STDIN_STATE = {
  mode: "none",
  canAttemptWrite: false,
  acceptedWrites: [],
} satisfies StructuredCommandStdinState;

const TERMINAL_EXEC_STDIN_STATE = {
  mode: "continuable",
  canAttemptWrite: false,
  acceptedWrites: [],
} satisfies StructuredCommandStdinState;

type StructuredSessionSnapshotFixture = Omit<
  Partial<StructuredSessionSnapshot>,
  | "session"
  | "turns"
  | "threads"
  | "commands"
  | "episodes"
  | "workflowRuns"
  | "workflowTaskAttempts"
  | "workflowTaskMessages"
  | "generatedAgentContextBindings"
  | "artifacts"
  | "events"
> & {
  session?: Partial<StructuredSessionSnapshot["session"]>;
  threads?: Partial<StructuredThreadRecord>[];
  turns?: Partial<StructuredTurnRecord>[];
  commands?: Partial<StructuredCommandRecord>[];
  episodes?: Partial<StructuredEpisodeRecord>[];
  workflowRuns?: Partial<StructuredWorkflowRunRecord>[];
  workflowTaskAttempts?: Partial<StructuredSessionSnapshot["workflowTaskAttempts"][number]>[];
  workflowTaskMessages?: Partial<StructuredSessionSnapshot["workflowTaskMessages"][number]>[];
  generatedAgentContextBindings?: Partial<
    StructuredSessionSnapshot["generatedAgentContextBindings"][number]
  >[];
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
    workflowRuns: overrideWorkflowRuns,
    workflowTaskAttempts: overrideWorkflowTaskAttempts,
    workflowTaskMessages: overrideWorkflowTaskMessages,
    generatedAgentContextBindings: overrideGeneratedAgentContextBindings,
    artifacts: overrideArtifacts,
    events: overrideEvents,
    session: overrideSession,
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
        threadGroupId: `thread-group-00${index + 1}`,
        surfacePiSessionId: `pi-thread-00${index + 1}`,
        title: "Selector thread",
        objective: "Selector objective",
        historyMode: "isolated",
        objectiveState: "active",
        status: "completed" as StructuredThreadStatus,
        wait: null,
        loadedExtensionIds: [],
        availableExtensionIds: [],
        updateExtensionContextBeforeNextTurn: true,
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
        arguments: null,
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
        generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
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

  const generatedAgentContextBindings =
    overrideGeneratedAgentContextBindings?.map((binding, index) => {
      const base: StructuredSessionSnapshot["generatedAgentContextBindings"][number] = {
        id: `generated-context-binding-00${index + 1}`,
        surfacePiSessionId: "pi-task-agent-001",
        ownerKind: "workflow-task-attempt",
        ownerId: "workflow-task-attempt-001",
        actorKind: "workflow-task",
        aggregateCacheKey: "workflow-task-aggregate-001",
        systemPrompt: "Use the bound workflow task context.",
        svvyxGuidance: "",
        commandsDts: "declare const workflowTask: true;",
        nativeToolSchemasJson: "{}",
        generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
        generatedAgentContextRevision: 1,
        loadedExtensionIds: ["base-workflow-task"],
        availableExtensionIds: [],
        externalSourceHashes: [],
        createdAt: "2026-04-18T07:02:30.000Z",
        updatedAt: "2026-04-18T07:02:30.000Z",
      };
      return { ...base, ...binding };
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
        mimeType: "text/markdown",
        bytes: 0,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        immutable: false,
        createdAt: "2026-04-18T07:01:30.000Z",
        deletedAt: null,
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
      pinnedAt: null,
      archivedAt: null,
      unreadAt: null,
      unreadReason: null,
      lastReadAt: null,
      wait: null,
      ...overrideSession,
    },
    turns,
    threads,
    commands,
    episodes,
    workflowRuns,
    workflowTaskAttempts,
    workflowTaskMessages,
    generatedAgentContextBindings,
    requestUserInputRequests: [],
    artifacts,
    events,
    ...rest,
  };
}

describe("structured session selectors", () => {
  it("derives session status from orchestrator-local wait and turns only", () => {
    expect(
      deriveStructuredSessionStatus({
        wait: {
          owner: { kind: "orchestrator" },
          kind: "user",
          reason: "Need clarification",
          resumeWhen: "Resume on answer",
          since: "2026-04-18T10:00:00.000Z",
        },
        turns: [],
      }),
    ).toBe("waiting");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        turns: [
          {
            threadId: null,
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
            threadId: "thread-child",
            status: "failed",
            updatedAt: "2026-04-18T10:01:00.000Z",
          },
          {
            threadId: null,
            status: "failed",
            updatedAt: "2026-04-18T10:02:00.000Z",
          },
        ],
      }),
    ).toBe("error");

    expect(
      deriveStructuredSessionStatus({
        wait: null,
        turns: [
          {
            threadId: "thread-child",
            status: "failed",
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
          title: "Repair objective",
          objective: "Repair body",
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
          toolName: "extensions.artifacts.run",
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
      sessionStatus: "idle",
      wait: snapshot.session.wait,
      counts: {
        turns: 1,
        threads: 3,
        commands: 2,
        episodes: 2,
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
      sidebarThreads: [
        {
          threadId: "thread-001",
          surfacePiSessionId: "pi-thread-002",
          title: "Direct objective",
          objective: "Direct body",
          status: "completed",
          subtitle: {
            badge: "text",
            text: "Direct summary",
            tone: "muted",
          },
          latestCommandRollup: {
            commandId: "command-001",
            threadId: "thread-001",
            workflowRunId: null,
            workflowTaskAttemptId: null,
            toolName: "execute_typescript",
            visibility: "summary",
            status: "succeeded",
            title: "Inspect docs",
            summary: "Read 2 files and created 1 artifact.",
            arguments: null,
            facts: {
              artifactsCreated: 1,
              repoReads: 2,
            },
            error: null,
            artifacts: [
              {
                artifactId: "artifact-001",
                kind: "text",
                name: "artifact-1.md",
                createdAt: "2026-04-18T10:01:30.000Z",
                sourceCommandId: "command-001",
                producerLabel: "Inspect docs",
              },
            ],
            outputEvents: [],
            stdin: EMPTY_STDIN_STATE,
            argumentSnapshots: [],
            patchSnapshots: [],
            diagnostics: [],
            childCount: 1,
            summaryChildCount: 0,
            traceChildCount: 1,
            summaryChildren: [],
            startedAt: "2026-04-18T07:00:30.000Z",
            updatedAt: "2026-04-18T10:01:00.000Z",
            finishedAt: "2026-04-18T07:01:00.000Z",
          },
          updatedAt: "2026-04-18T10:01:00.000Z",
          workflows: [],
        },
        {
          threadId: "thread-002",
          surfacePiSessionId: "pi-thread-003",
          title: "Repair objective",
          objective: "Repair body",
          status: "troubleshooting",
          subtitle: {
            badge: "workflow",
            text: "troubleshooting",
            tone: "muted",
          },
          latestCommandRollup: null,
          updatedAt: "2026-04-18T10:02:00.000Z",
          workflows: [],
        },
        {
          threadId: "thread-003",
          surfacePiSessionId: "pi-thread-001",
          title: "Workflow objective",
          objective: "Workflow body",
          status: "waiting",
          subtitle: {
            badge: "waiting",
            text: "Need clarification",
            tone: "waiting",
          },
          latestCommandRollup: null,
          updatedAt: "2026-04-18T10:03:00.000Z",
          workflows: [
            {
              workflowRunId: "workflow-001",
              workflowName: "selector-workflow",
              status: "waiting",
              subtitle: {
                badge: "waiting",
                text: "Workflow waiting for clarification",
                tone: "waiting",
              },
              updatedAt: "2026-04-18T10:03:00.000Z",
            },
          ],
        },
      ],
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
          arguments: null,
          facts: {
            artifactsCreated: 1,
            repoReads: 2,
          },
          error: null,
          artifacts: [
            {
              artifactId: "artifact-001",
              kind: "text",
              name: "artifact-1.md",
              createdAt: "2026-04-18T10:01:30.000Z",
              sourceCommandId: "command-001",
              producerLabel: "Inspect docs",
            },
          ],
          outputEvents: [],
          stdin: EMPTY_STDIN_STATE,
          argumentSnapshots: [],
          patchSnapshots: [],
          diagnostics: [],
          childCount: 1,
          summaryChildCount: 0,
          traceChildCount: 1,
          summaryChildren: [],
          startedAt: "2026-04-18T07:00:30.000Z",
          updatedAt: "2026-04-18T10:01:00.000Z",
          finishedAt: "2026-04-18T07:01:00.000Z",
        },
      ],
      productEvents: [],
    });

    const summary = buildStructuredSessionSummaryProjection(snapshot);
    expect(summary).toEqual({
      sessionId: "session-selectors",
      title: "Selector Session",
      sessionStatus: "idle",
      status: "idle",
      preview: "Selector turn",
      updatedAt: "2026-04-18T10:03:30.000Z",
      isPinned: false,
      pinnedAt: null,
      isArchived: false,
      archivedAt: null,
      counts: view.counts,
      wait: snapshot.session.wait,
      threadIds: view.threadIds,
      latestEpisodePreview: "Workflow episode summary",
      latestWorkflowRunSummary: "Workflow waiting for clarification",
    });
  });

  it("ignores invalid workflow task attempt context budget metadata", () => {
    const snapshot = createSessionSnapshot({
      workflowTaskAttempts: [
        {
          id: "workflow-task-attempt-1",
          meta: {
            contextBudget: {
              usedTokens: "not-a-number",
              maxTokens: 1000,
            },
          },
        },
      ],
    });

    expect(
      buildStructuredWorkflowTaskAttemptInspector(snapshot, "workflow-task-attempt-1")
        ?.contextBudget,
    ).toBeNull();
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
          toolName: "exec_command",
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
          toolName: "read",
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
          missingFile: true,
          createdAt: "2026-04-18T10:00:11.000Z",
        },
        {
          id: "artifact-child",
          threadId: "thread-001",
          sourceCommandId: "command-summary-child",
          kind: "file",
          name: "summary.md",
          path: "/repo/svvy/.svvy/artifacts/summary.md",
          missingFile: true,
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
          sourceCommandId: "command-parent",
          producerLabel: "Inspect docs",
          missingFile: true,
        },
      ],
      outputEvents: [],
      stdin: EMPTY_STDIN_STATE,
      argumentSnapshots: [],
      patchSnapshots: [],
      diagnostics: [],
      childCount: 2,
      summaryChildCount: 1,
      traceChildCount: 1,
      summaryChildren: [
        {
          commandId: "command-summary-child",
          toolName: "exec_command",
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
              sourceCommandId: "command-summary-child",
              producerLabel: "Create summary.md",
              missingFile: true,
            },
          ],
          outputEvents: [],
          stdin: TERMINAL_EXEC_STDIN_STATE,
          argumentSnapshots: [],
          patchSnapshots: [],
          diagnostics: [],
        },
      ],
      traceChildren: [
        {
          commandId: "command-trace-child",
          toolName: "read",
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
          outputEvents: [],
          stdin: EMPTY_STDIN_STATE,
          argumentSnapshots: [],
          patchSnapshots: [],
          diagnostics: [],
        },
      ],
    });
  });

  it("recovers command output events in the command inspector read model", () => {
    const snapshot = createSessionSnapshot({
      commands: [
        {
          id: "command-output",
          toolName: "exec_command",
          visibility: "summary",
          title: "Run tests",
          summary: "Tests failed.",
          arguments: {
            cmd: "bun test",
          },
          facts: {
            exitCode: 1,
          },
          threadId: "thread-001",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      events: [
        {
          id: "event-stdout",
          at: "2026-04-18T10:01:00.000Z",
          kind: "command.output",
          subject: {
            kind: "command",
            id: "command-output",
          },
          data: {
            stream: "stdout",
            source: "final-result",
            text: "1 pass\n",
          },
        },
        {
          id: "event-stderr",
          at: "2026-04-18T10:01:01.000Z",
          kind: "command.output",
          subject: {
            kind: "command",
            id: "command-output",
          },
          data: {
            stream: "stderr",
            source: "final-result",
            text: "1 fail\n",
          },
        },
        {
          id: "event-ignored",
          at: "2026-04-18T10:01:02.000Z",
          kind: "command.output",
          subject: {
            kind: "command",
            id: "command-output",
          },
          data: {
            stream: "progress",
            source: "final-result",
            text: "not exposed by this slice",
          },
        },
      ],
    });

    expect(buildStructuredSessionView(snapshot).commandRollups[0]).toMatchObject({
      commandId: "command-output",
      arguments: {
        cmd: "bun test",
      },
      facts: {
        exitCode: 1,
      },
      error: null,
      artifacts: [],
      outputEvents: [
        {
          eventId: "event-stdout",
          stream: "stdout",
          source: "final-result",
          text: "1 pass\n",
        },
        {
          eventId: "event-stderr",
          stream: "stderr",
          source: "final-result",
          text: "1 fail\n",
        },
      ],
    });

    const inspector = buildStructuredCommandInspector(snapshot, "command-output");

    expect(inspector?.outputEvents).toEqual([
      {
        eventId: "event-stdout",
        at: "2026-04-18T10:01:00.000Z",
        stream: "stdout",
        source: "final-result",
        text: "1 pass\n",
      },
      {
        eventId: "event-stderr",
        at: "2026-04-18T10:01:01.000Z",
        stream: "stderr",
        source: "final-result",
        text: "1 fail\n",
      },
    ]);
  });

  it("recovers accepted stdin writes and derives command stdin actionability", () => {
    const snapshot = createSessionSnapshot({
      commands: [
        {
          id: "command-stdin",
          toolName: "exec_command",
          visibility: "summary",
          status: "running",
          title: "Run interactive command",
          summary: "Waiting for input.",
          arguments: {
            cmd: "read answer",
          },
          threadId: "thread-001",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: null,
        },
        {
          id: "command-terminal",
          toolName: "exec_command",
          visibility: "summary",
          status: "succeeded",
          title: "Finished command",
          summary: "Done.",
          threadId: "thread-001",
          updatedAt: "2026-04-18T10:03:00.000Z",
          finishedAt: "2026-04-18T10:03:00.000Z",
        },
      ],
      events: [
        {
          id: "event-stdin-2",
          at: "2026-04-18T10:01:01.000Z",
          kind: "command.stdin",
          subject: {
            kind: "command",
            id: "command-stdin",
          },
          data: {
            text: "second\n",
            acceptedBytes: 7,
          },
        },
        {
          id: "event-stdin-1",
          at: "2026-04-18T10:01:00.000Z",
          kind: "command.stdin",
          subject: {
            kind: "command",
            id: "command-stdin",
          },
          data: {
            text: "first\n",
            acceptedBytes: 6,
          },
        },
        {
          id: "event-stdin-ignored",
          at: "2026-04-18T10:01:02.000Z",
          kind: "command.stdin",
          subject: {
            kind: "command",
            id: "command-stdin",
          },
          data: {
            text: "invalid\n",
            acceptedBytes: -1,
          },
        },
      ],
    });

    expect(buildStructuredSessionView(snapshot).commandRollups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          commandId: "command-stdin",
          stdin: {
            mode: "continuable",
            canAttemptWrite: true,
            acceptedWrites: [
              {
                eventId: "event-stdin-1",
                at: "2026-04-18T10:01:00.000Z",
                text: "first\n",
                acceptedBytes: 6,
              },
              {
                eventId: "event-stdin-2",
                at: "2026-04-18T10:01:01.000Z",
                text: "second\n",
                acceptedBytes: 7,
              },
            ],
          },
        }),
        expect.objectContaining({
          commandId: "command-terminal",
          stdin: {
            mode: "continuable",
            canAttemptWrite: false,
            acceptedWrites: [],
          },
        }),
      ]),
    );

    expect(buildStructuredCommandInspector(snapshot, "command-stdin")?.stdin).toEqual({
      mode: "continuable",
      canAttemptWrite: true,
      acceptedWrites: [
        {
          eventId: "event-stdin-1",
          at: "2026-04-18T10:01:00.000Z",
          text: "first\n",
          acceptedBytes: 6,
        },
        {
          eventId: "event-stdin-2",
          at: "2026-04-18T10:01:01.000Z",
          text: "second\n",
          acceptedBytes: 7,
        },
      ],
    });
  });

  it("recovers command argument snapshots in rollups and the command inspector", () => {
    const snapshot = createSessionSnapshot({
      commands: [
        {
          id: "command-args",
          toolName: "exec_command",
          visibility: "summary",
          title: "Run streamed command",
          summary: "Arguments streamed before execution.",
          arguments: {
            cmd: "bun test",
          },
          threadId: "thread-001",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      events: [
        {
          id: "event-args-1",
          at: "2026-04-18T10:00:00.000Z",
          kind: "command.arg_snapshot",
          subject: {
            kind: "command",
            id: "command-args",
          },
          data: {
            source: "streaming",
            arguments: {
              cmd: "bun",
            },
          },
        },
        {
          id: "event-args-2",
          at: "2026-04-18T10:00:01.000Z",
          kind: "command.arg_snapshot",
          subject: {
            kind: "command",
            id: "command-args",
          },
          data: {
            source: "streaming-final",
            arguments: {
              cmd: "bun test",
            },
          },
        },
      ],
    });

    const expected = [
      {
        eventId: "event-args-1",
        at: "2026-04-18T10:00:00.000Z",
        source: "streaming",
        arguments: {
          cmd: "bun",
        },
      },
      {
        eventId: "event-args-2",
        at: "2026-04-18T10:00:01.000Z",
        source: "streaming-final",
        arguments: {
          cmd: "bun test",
        },
      },
    ];

    expect(buildStructuredSessionView(snapshot).commandRollups[0]?.argumentSnapshots).toEqual(
      expected,
    );
    expect(buildStructuredCommandInspector(snapshot, "command-args")?.argumentSnapshots).toEqual(
      expected,
    );
  });

  it("recovers command progress events in rollups and the command inspector", () => {
    const snapshot = createSessionSnapshot({
      commands: [
        {
          id: "command-progress",
          toolName: "exec_command",
          visibility: "summary",
          title: "List workflows",
          summary: "Listed workflow exports.",
          arguments: {
            cmd: "svvyx workflows list --json",
          },
          facts: {
            exitCode: 0,
          },
          threadId: "thread-001",
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      events: [
        {
          id: "event-started",
          at: "2026-04-18T10:01:00.000Z",
          kind: "command.progress",
          subject: {
            kind: "command",
            id: "command-progress",
          },
          data: {
            command: "svvyx workflows list --json",
            family: "workflows",
            phase: "started",
            source: "svvyx-dispatch",
            progress: -1,
          },
        },
        {
          id: "event-succeeded",
          at: "2026-04-18T10:01:01.000Z",
          kind: "command.progress",
          subject: {
            kind: "command",
            id: "command-progress",
          },
          data: {
            command: "svvyx workflows list --json",
            family: "workflows",
            phase: "succeeded",
            source: "svvyx-dispatch",
            progress: 2,
            facts: {
              workflowExportCount: 1,
            },
          },
        },
        {
          id: "event-ignored",
          at: "2026-04-18T10:01:02.000Z",
          kind: "command.progress",
          subject: {
            kind: "command",
            id: "other-command",
          },
          data: {
            phase: "started",
          },
        },
      ],
    });

    expect(buildStructuredSessionView(snapshot).commandRollups[0]).toMatchObject({
      commandId: "command-progress",
      progressEvents: [
        {
          eventId: "event-started",
          at: "2026-04-18T10:01:00.000Z",
          source: "svvyx-dispatch",
          phase: "started",
          family: "workflows",
          command: "svvyx workflows list --json",
          progress: 0,
        },
        {
          eventId: "event-succeeded",
          at: "2026-04-18T10:01:01.000Z",
          source: "svvyx-dispatch",
          phase: "succeeded",
          family: "workflows",
          command: "svvyx workflows list --json",
          progress: 1,
          facts: {
            workflowExportCount: 1,
          },
        },
      ],
    });

    expect(buildStructuredCommandInspector(snapshot, "command-progress")?.progressEvents).toEqual([
      {
        eventId: "event-started",
        at: "2026-04-18T10:01:00.000Z",
        source: "svvyx-dispatch",
        phase: "started",
        family: "workflows",
        command: "svvyx workflows list --json",
        progress: 0,
      },
      {
        eventId: "event-succeeded",
        at: "2026-04-18T10:01:01.000Z",
        source: "svvyx-dispatch",
        phase: "succeeded",
        family: "workflows",
        command: "svvyx workflows list --json",
        progress: 1,
        facts: {
          workflowExportCount: 1,
        },
      },
    ]);
  });

  it("recovers command diagnostics in the command inspector read model", () => {
    const snapshot = createSessionSnapshot({
      commands: [
        {
          id: "command-diagnostics",
          turnId: "turn-001",
          threadId: null,
          toolName: "execute_typescript",
          executor: "orchestrator",
          visibility: "summary",
          status: "failed",
          title: "Run execute_typescript",
          summary: "Type error",
          facts: {
            diagnosticsCount: 1,
          },
          updatedAt: "2026-04-18T10:01:02.000Z",
          finishedAt: "2026-04-18T10:01:02.000Z",
        },
      ],
      events: [
        {
          id: "event-diagnostics",
          sessionId: "session-001",
          at: "2026-04-18T10:01:01.000Z",
          kind: "command.diagnostics",
          subject: {
            kind: "command",
            id: "command-diagnostics",
          },
          data: {
            source: "execute_typescript",
            stage: "typecheck",
            diagnostics: [
              {
                severity: "error",
                message: "Type mismatch",
                file: "execute-typescript.ts",
                line: 1,
                column: 7,
                code: "2322",
              },
            ],
          },
        },
      ],
    });

    expect(buildStructuredSessionView(snapshot).commandRollups[0]).toMatchObject({
      commandId: "command-diagnostics",
      diagnostics: [
        {
          eventId: "event-diagnostics",
          stage: "typecheck",
          source: "execute_typescript",
          diagnostics: [
            {
              severity: "error",
              message: "Type mismatch",
              file: "execute-typescript.ts",
              line: 1,
              column: 7,
              code: "2322",
            },
          ],
        },
      ],
    });

    expect(buildStructuredCommandInspector(snapshot, "command-diagnostics")?.diagnostics).toEqual([
      {
        eventId: "event-diagnostics",
        at: "2026-04-18T10:01:01.000Z",
        source: "execute_typescript",
        stage: "typecheck",
        diagnostics: [
          {
            severity: "error",
            message: "Type mismatch",
            file: "execute-typescript.ts",
            line: 1,
            column: 7,
            code: "2322",
          },
        ],
      },
    ]);
  });

  it("projects durable extension revert product events into the session view", () => {
    const snapshot = createSessionSnapshot({
      events: [
        {
          id: "event-extension-revert",
          at: "2026-06-10T10:01:00.000Z",
          kind: "Extension change reverted",
          subject: {
            kind: "thread",
            id: "thread-001",
          },
          data: {
            title: "Extension change reverted",
            summary: "User reverted extension extension_files chg_abc_123 for linear.",
            changeId: "chg_abc_123",
            extensionId: "linear",
            surface: "handler",
            surfacePiSessionId: "pi-thread-001",
            threadId: "thread-001",
          },
        },
      ],
    });

    expect(buildStructuredSessionView(snapshot).productEvents).toEqual([
      {
        eventId: "event-extension-revert",
        at: "2026-06-10T10:01:00.000Z",
        title: "Extension change reverted",
        summary: "User reverted extension extension_files chg_abc_123 for linear.",
        subject: {
          kind: "thread",
          id: "thread-001",
        },
        details: {
          title: "Extension change reverted",
          summary: "User reverted extension extension_files chg_abc_123 for linear.",
          changeId: "chg_abc_123",
          extensionId: "linear",
          surface: "handler",
          surfacePiSessionId: "pi-thread-001",
          threadId: "thread-001",
        },
      },
    ]);
  });

  it("does not project obsolete agent context update terminal events into the session view", () => {
    const snapshot = createSessionSnapshot({
      events: [
        {
          id: "event-context-applied",
          at: "2026-06-10T10:02:00.000Z",
          kind: "Removed context update applied",
          subject: {
            kind: "session",
            id: "session-001",
          },
          data: {
            title: "Removed context update applied",
            summary: "Removed context update applied: r3->r4, 2 changes.",
            state: "applied",
            surface: "orchestrator",
            surfacePiSessionId: "session-001",
            queueMessageId: "sqm-context-001",
            requestedRevision: 3,
            currentRevision: 4,
            systemPromptChanged: true,
            loadedExtensionIds: {
              added: ["linear"],
              removed: [],
            },
          },
        },
        {
          id: "event-context-cancelled",
          at: "2026-06-10T10:03:00.000Z",
          kind: "Removed context update cancelled",
          subject: {
            kind: "thread",
            id: "thread-001",
          },
          data: {
            title: "Removed context update cancelled",
            summary: "Removed context update cancelled: r3->r4.",
            state: "cancelled",
            surface: "handler",
            surfacePiSessionId: "pi-thread-001",
            threadId: "thread-001",
            queueMessageId: "sqm-context-002",
            requestedRevision: 3,
            currentRevision: 4,
          },
        },
      ],
    });

    expect(buildStructuredSessionView(snapshot).productEvents).toEqual([]);
  });

  it("projects apply_patch final facts through the command inspector read model", () => {
    const snapshot = createSessionSnapshot({
      turns: [{ id: "turn-001", turnDecision: "apply_patch" }],
      threads: [{ id: "thread-001", turnId: "turn-001" }],
      commands: [
        {
          id: "command-apply-patch",
          turnId: "turn-001",
          threadId: "thread-001",
          toolName: "apply_patch",
          executor: "orchestrator",
          visibility: "summary",
          status: "succeeded",
          title: "Run apply_patch",
          summary: "Patch applied successfully.",
          facts: {
            changedFiles: ["src/mainview/WorkflowsPane.svelte"],
            createdFiles: [],
            deletedFiles: [],
            errors: [],
          },
          updatedAt: "2026-04-18T10:02:00.000Z",
          finishedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      events: [
        {
          id: "event-patch-snapshot",
          sessionId: "session-001",
          at: "2026-04-18T10:01:59.000Z",
          kind: "command.patch_snapshot",
          subject: {
            kind: "command",
            id: "command-apply-patch",
          },
          data: {
            source: "accepted-arguments",
            files: [
              {
                path: "src/mainview/WorkflowsPane.svelte",
                changeType: "modified",
                additions: 2,
                deletions: 1,
              },
            ],
          },
        },
      ],
    });

    const inspector = buildStructuredCommandInspector(snapshot, "command-apply-patch");

    expect(inspector).toMatchObject({
      commandId: "command-apply-patch",
      toolName: "apply_patch",
      visibility: "summary",
      status: "succeeded",
      summary: "Patch applied successfully.",
      facts: {
        changedFiles: ["src/mainview/WorkflowsPane.svelte"],
        createdFiles: [],
        deletedFiles: [],
        errors: [],
      },
      patchSnapshots: [
        {
          eventId: "event-patch-snapshot",
          at: "2026-04-18T10:01:59.000Z",
          source: "accepted-arguments",
          files: [
            {
              path: "src/mainview/WorkflowsPane.svelte",
              changeType: "modified",
              additions: 2,
              deletions: 1,
            },
          ],
        },
      ],
      childCount: 0,
      summaryChildren: [],
      traceChildren: [],
    });
  });

  it("does not expose a Project CI status panel selector", async () => {
    const selectors = await import("./structured-session-selectors");
    expect("buildStructuredProjectCiStatusPanel" in selectors).toBe(false);
  });

  it("builds compact current-thread read models with pending report requests", () => {
    const snapshot = createSessionSnapshot({
      threads: [
        {
          id: "thread-current",
          threadGroupId: "thread-group-a",
          surfacePiSessionId: "pi-thread-current",
          title: "Current handler",
          objective: "Return only compact handler state.",
          objectiveState: "active",
          status: "waiting",
          wait: {
            owner: "handler",
            kind: "signal",
            reason: "Waiting for CI.",
            resumeWhen: "CI finishes.",
            since: "2026-04-18T10:02:00.000Z",
          },
          loadedExtensionIds: ["shell", "thread-handling"],
          availableExtensionIds: ["web"],
          updatedAt: "2026-04-18T10:04:00.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-old",
          threadId: "thread-current",
          title: "Old report",
          summary: "Older compact report.",
          body: "Older durable episode body must not leak into current.",
          createdAt: "2026-04-18T10:01:00.000Z",
        },
        {
          id: "episode-latest",
          threadId: "thread-current",
          title: "Latest report",
          summary: "Latest compact report.",
          body: "Latest durable episode body must not leak into current.",
          createdAt: "2026-04-18T10:03:00.000Z",
        },
      ],
      queuedMessages: [
        {
          id: "queue-report-1",
          sessionId: "session-selectors",
          surfacePiSessionId: "pi-thread-current",
          threadId: "thread-current",
          workflowTaskAttemptId: null,
          kind: "report_request",
          idempotencyKey: "report-request:1",
          messageJson: "{}",
          payloadJson: JSON.stringify({ request: "Summarize the focused checks." }),
          status: "queued",
          priority: "runtime",
          orderingKey: "surface:pi-thread-current",
          sequence: 1,
          position: 1,
          sourceCommandId: null,
          claimOwnerId: null,
          claimLeaseExpiresAt: null,
          leaseVersion: 0,
          attemptCount: 0,
          maxAttempts: 3,
          nextAttemptAt: null,
          lastErrorJson: null,
          createdAt: "2026-04-18T10:04:30.000Z",
          updatedAt: "2026-04-18T10:04:30.000Z",
          deliveredAt: null,
          failedAt: null,
          failureError: null,
          cancelledAt: null,
        },
      ],
    });
    const thread = getStructuredThread(snapshot, "thread-current");

    expect(thread).not.toBeNull();
    expect(buildStructuredThreadCurrentReadModel(snapshot, thread!)).toEqual({
      threadId: "thread-current",
      threadGroupId: "thread-group-a",
      workspaceSessionId: "session-selectors",
      surfacePiSessionId: "pi-thread-current",
      title: "Current handler",
      objective: "Return only compact handler state.",
      objectiveState: "active",
      status: "waiting",
      wait: {
        kind: "external",
        reason: "Waiting for CI.",
        resumeWhen: "CI finishes.",
      },
      latestEpisode: {
        id: "episode-latest",
        title: "Latest report",
        summary: "Latest compact report.",
        createdAt: "2026-04-18T10:03:00.000Z",
      },
      pendingReportRequests: [
        {
          queuedMessageId: "queue-report-1",
          request: "Summarize the focused checks.",
          createdAt: "2026-04-18T10:04:30.000Z",
        },
      ],
    });
  });

  it("builds compact thread lists with attention ordering and no transcript leakage", () => {
    const snapshot = createSessionSnapshot({
      threads: [
        {
          id: "thread-completed",
          status: "completed",
          updatedAt: "2026-04-18T10:10:00.000Z",
        },
        {
          id: "thread-running",
          status: "running-handler",
          updatedAt: "2026-04-18T10:03:00.000Z",
        },
        {
          id: "thread-waiting",
          status: "waiting",
          updatedAt: "2026-04-18T10:01:00.000Z",
        },
        {
          id: "thread-troubleshooting",
          status: "troubleshooting",
          updatedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-waiting",
          threadId: "thread-waiting",
          title: "Waiting report",
          summary: "Waiting summary.",
          body: "Full episode body should not appear in compact list.",
        },
      ],
      commands: [
        {
          id: "command-hidden",
          threadId: "thread-waiting",
          summary: "workflow summary should not leak",
        },
      ],
    });

    const readModel = buildStructuredThreadListReadModel(snapshot, { limit: 3 });

    expect(readModel.threads.map((thread) => thread.threadId)).toEqual([
      "thread-waiting",
      "thread-troubleshooting",
      "thread-running",
    ]);
    expect(JSON.stringify(readModel)).not.toContain("Full episode body");
    expect(JSON.stringify(readModel)).not.toContain("workflow summary");
    expect(JSON.stringify(readModel)).not.toContain("command-hidden");
  });

  it("builds body-bearing thread episode read models with current-thread defaults", () => {
    const snapshot = createSessionSnapshot({
      threads: [
        {
          id: "thread-current",
          threadGroupId: "thread-group-a",
        },
        {
          id: "thread-sibling",
          threadGroupId: "thread-group-a",
        },
      ],
      episodes: [
        {
          id: "episode-current",
          threadId: "thread-current",
          kind: "change",
          title: "Current body",
          summary: "Current summary.",
          body: "Current durable body.",
          createdAt: "2026-04-18T10:02:00.000Z",
        },
        {
          id: "episode-sibling",
          threadId: "thread-sibling",
          kind: "report",
          title: "Sibling body",
          summary: "Sibling summary.",
          body: "Sibling durable body.",
          createdAt: "2026-04-18T10:03:00.000Z",
        },
      ],
    });

    expect(
      buildStructuredThreadEpisodesReadModel(snapshot, {
        target: { kind: "thread", threadId: "thread-current" },
      }),
    ).toEqual({
      episodes: [
        {
          id: "episode-current",
          sessionId: "session-selectors",
          threadId: "thread-current",
          threadGroupId: "thread-group-a",
          sourceCommandId: "command-001",
          kind: "change",
          title: "Current body",
          summary: "Current summary.",
          body: "Current durable body.",
          createdAt: "2026-04-18T10:02:00.000Z",
        },
      ],
    });
    expect(
      buildStructuredThreadEpisodesReadModel(snapshot, {
        target: { kind: "thread-group", threadGroupId: "thread-group-a" },
        limit: 1,
      }).episodes.map((episode) => episode.id),
    ).toEqual(["episode-sibling"]);
  });

  it("builds compact thread group topology without episode bodies", () => {
    const snapshot = createSessionSnapshot({
      threads: [
        {
          id: "thread-current",
          threadGroupId: "thread-group-a",
          status: "idle",
        },
        {
          id: "thread-sibling",
          threadGroupId: "thread-group-a",
          status: "waiting",
        },
        {
          id: "thread-other",
          threadGroupId: "thread-group-b",
          status: "troubleshooting",
        },
      ],
      episodes: [
        {
          id: "episode-sibling",
          threadId: "thread-sibling",
          body: "Sibling durable body should not leak into group topology.",
        },
      ],
    });
    const currentThread = getStructuredThread(snapshot, "thread-current");

    expect(currentThread).not.toBeNull();
    const readModel = buildStructuredThreadGroupReadModel(snapshot, currentThread!);
    expect(readModel.threadGroupId).toBe("thread-group-a");
    expect(readModel.currentThreadId).toBe("thread-current");
    expect(readModel.threads.map((thread) => thread.threadId)).toEqual([
      "thread-sibling",
      "thread-current",
    ]);
    expect(JSON.stringify(readModel)).not.toContain("Sibling durable body");
    expect(JSON.stringify(readModel)).not.toContain("thread-other");
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
          toolName: "exec_command",
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
          workflowName: "regression_workflow",
          status: "completed",
          summary: "Regression workflow passed after adding coverage.",
          updatedAt: "2026-04-18T10:04:10.000Z",
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
          missingFile: true,
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
        objectiveState: "active",
        historyMode: "isolated",
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
        latestCommandRollup: {
          commandId: "command-handler-parent",
          threadId: "thread-handler",
          workflowRunId: null,
          workflowTaskAttemptId: null,
          toolName: "execute_typescript",
          visibility: "summary",
          status: "succeeded",
          title: "Patch parser transitions",
          summary: "Updated parser transitions and wrote a regression test.",
          arguments: null,
          facts: null,
          error: null,
          artifacts: [
            {
              artifactId: "artifact-handler-1",
              kind: "file",
              name: "parser-regression.test.ts",
              path: "/repo/svvy/.svvy/artifacts/parser-regression.test.ts",
              createdAt: "2026-04-18T10:03:12.000Z",
              sourceCommandId: "command-handler-parent",
              producerLabel: "Patch parser transitions",
              missingFile: true,
            },
          ],
          outputEvents: [],
          stdin: EMPTY_STDIN_STATE,
          argumentSnapshots: [],
          patchSnapshots: [],
          diagnostics: [],
          childCount: 1,
          summaryChildCount: 1,
          traceChildCount: 0,
          summaryChildren: [
            {
              commandId: "command-handler-child",
              toolName: "exec_command",
              status: "succeeded",
              title: "Write parser test",
              summary: "Created parser regression coverage.",
              error: null,
            },
          ],
          startedAt: "2026-04-18T10:03:00.000Z",
          updatedAt: "2026-04-18T10:03:20.000Z",
          finishedAt: "2026-04-18T10:03:20.000Z",
        },
        latestWorkflowRun: {
          workflowRunId: "workflow-handler-2",
          workflowName: "regression_workflow",
          status: "completed",
          summary: "Regression workflow passed after adding coverage.",
          updatedAt: "2026-04-18T10:04:10.000Z",
          artifacts: [],
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
      objectiveState: "active",
      historyMode: "isolated",
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
      latestCommandRollup: {
        commandId: "command-handler-parent",
        threadId: "thread-handler",
        workflowRunId: null,
        workflowTaskAttemptId: null,
        toolName: "execute_typescript",
        visibility: "summary",
        status: "succeeded",
        title: "Patch parser transitions",
        summary: "Updated parser transitions and wrote a regression test.",
        arguments: null,
        facts: null,
        error: null,
        artifacts: [
          {
            artifactId: "artifact-handler-1",
            kind: "file",
            name: "parser-regression.test.ts",
            path: "/repo/svvy/.svvy/artifacts/parser-regression.test.ts",
            createdAt: "2026-04-18T10:03:12.000Z",
            sourceCommandId: "command-handler-parent",
            producerLabel: "Patch parser transitions",
            missingFile: true,
          },
        ],
        outputEvents: [],
        stdin: EMPTY_STDIN_STATE,
        argumentSnapshots: [],
        patchSnapshots: [],
        diagnostics: [],
        childCount: 1,
        summaryChildCount: 1,
        traceChildCount: 0,
        summaryChildren: [
          {
            commandId: "command-handler-child",
            toolName: "exec_command",
            status: "succeeded",
            title: "Write parser test",
            summary: "Created parser regression coverage.",
            error: null,
          },
        ],
        startedAt: "2026-04-18T10:03:00.000Z",
        updatedAt: "2026-04-18T10:03:20.000Z",
        finishedAt: "2026-04-18T10:03:20.000Z",
      },
      latestWorkflowRun: {
        workflowRunId: "workflow-handler-2",
        workflowName: "regression_workflow",
        status: "completed",
        summary: "Regression workflow passed after adding coverage.",
        updatedAt: "2026-04-18T10:04:10.000Z",
        artifacts: [],
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
          arguments: null,
          facts: null,
          error: null,
          artifacts: [
            {
              artifactId: "artifact-handler-1",
              kind: "file",
              name: "parser-regression.test.ts",
              path: "/repo/svvy/.svvy/artifacts/parser-regression.test.ts",
              createdAt: "2026-04-18T10:03:12.000Z",
              sourceCommandId: "command-handler-parent",
              producerLabel: "Patch parser transitions",
              missingFile: true,
            },
          ],
          outputEvents: [],
          stdin: EMPTY_STDIN_STATE,
          argumentSnapshots: [],
          patchSnapshots: [],
          diagnostics: [],
          childCount: 1,
          summaryChildCount: 1,
          traceChildCount: 0,
          summaryChildren: [
            {
              commandId: "command-handler-child",
              toolName: "exec_command",
              status: "succeeded",
              title: "Write parser test",
              summary: "Created parser regression coverage.",
              error: null,
            },
          ],
          startedAt: "2026-04-18T10:03:00.000Z",
          updatedAt: "2026-04-18T10:03:20.000Z",
          finishedAt: "2026-04-18T10:03:20.000Z",
        },
      ],
      workflowRuns: [
        {
          workflowRunId: "workflow-handler-2",
          workflowName: "regression_workflow",
          status: "completed",
          summary: "Regression workflow passed after adding coverage.",
          updatedAt: "2026-04-18T10:04:10.000Z",
          artifacts: [],
        },
        {
          workflowRunId: "workflow-handler-1",
          workflowName: "single_task",
          status: "completed",
          summary: "Patched parser transitions.",
          updatedAt: "2026-04-18T10:03:25.000Z",
          artifacts: [],
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
          sourceCommandId: "command-handler-parent",
          producerLabel: "Patch parser transitions",
          missingFile: true,
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
      sessionStatus: "idle",
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
      sidebarThreads: [
        {
          threadId: "thread-handler-complete",
          status: "completed",
          subtitle: null,
        },
      ],
    });

    expect(buildStructuredSessionSummaryProjection(snapshot)).toMatchObject({
      status: "idle",
      counts: {
        threads: 1,
      },
      threadIds: ["thread-handler-complete"],
    });
  });

  it("keeps workflow summaries out of the parent preview and exposes them on child rows", () => {
    const workflowSnapshot = createSessionSnapshot({
      session: {
        id: "session-workflow-preview",
        orchestratorPiSessionId: "session-workflow-preview",
        wait: null,
      },
      threads: [
        {
          id: "thread-300",
          title: "Workflow handler",
          objective: "Run delegated workflow.",
          status: "running-workflow",
          updatedAt: "2026-04-18T10:03:00.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "workflow-300",
          threadId: "thread-300",
          status: "running",
          summary: "Delegated workflow is running.",
          updatedAt: "2026-04-18T10:03:00.000Z",
        },
      ],
    });
    const workflowSummary = buildStructuredSessionSummaryProjection(workflowSnapshot);
    const workflowView = buildStructuredSessionView(workflowSnapshot);
    expect(workflowSummary.preview).toBe("");
    expect(workflowSummary.latestWorkflowRunSummary).toBe("Delegated workflow is running.");
    expect(workflowView.sidebarThreads[0]?.subtitle).toEqual({
      badge: "workflow",
      text: "Delegated workflow is running.",
      tone: "muted",
    });
    expect(workflowView.sidebarThreads[0]?.workflows[0]?.subtitle).toEqual({
      badge: "workflow",
      text: "Delegated workflow is running.",
      tone: "muted",
    });

    const episodeSnapshot = createSessionSnapshot({
      session: {
        id: "session-episode-preview",
        orchestratorPiSessionId: "session-episode-preview",
        wait: null,
      },
      threads: [
        {
          id: "thread-400",
          title: "Completed handler",
          objective: "Report delegated work.",
          status: "completed",
          surfacePiSessionId: "pi-thread-400",
          updatedAt: "2026-04-18T10:04:00.000Z",
        },
      ],
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
    });
    const episodeSummary = buildStructuredSessionSummaryProjection(episodeSnapshot);
    expect(episodeSummary.preview).toBe("");
    expect(episodeSummary.latestEpisodePreview).toBe("Handler completed successfully.");
    expect(buildStructuredSessionView(episodeSnapshot).sidebarThreads[0]?.subtitle).toEqual({
      badge: "text",
      text: "Handler completed successfully.",
      tone: "muted",
    });

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
      threads: [
        {
          id: "thread-500",
          title: "Waiting handler",
          objective: "Resume workflow after clarification.",
          status: "waiting",
          wait: {
            owner: "workflow",
            kind: "user",
            reason: "Need clarification before workflow resume.",
            resumeWhen: "Resume when the rollout owner is confirmed.",
            since: "2026-04-18T10:03:00.000Z",
          },
          updatedAt: "2026-04-18T10:03:00.000Z",
        },
      ],
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
    const waitingView = buildStructuredSessionView(waitingSnapshot);
    expect(waitingSummary.preview).toBe("");
    expect(waitingSummary.status).toBe("idle");
    expect(waitingView.sidebarThreads[0]?.subtitle).toEqual({
      badge: "waiting",
      text: "Need clarification before workflow resume.",
      tone: "waiting",
    });

    const failedWorkflowSnapshot = createSessionSnapshot({
      session: {
        id: "session-failed-workflow-preview",
        orchestratorPiSessionId: "session-failed-workflow-preview",
        wait: null,
      },
      threads: [
        {
          id: "thread-600",
          title: "Repair workflow",
          objective: "Inspect failed workflow.",
          status: "troubleshooting",
          updatedAt: "2026-04-18T10:06:00.000Z",
        },
      ],
      workflowRuns: [
        {
          id: "workflow-600",
          threadId: "thread-600",
          status: "failed",
          summary: "Workflow failed while editing.",
          updatedAt: "2026-04-18T10:06:00.000Z",
        },
      ],
    });
    const failedWorkflowView = buildStructuredSessionView(failedWorkflowSnapshot);
    expect(failedWorkflowView.sidebarThreads[0]?.workflows[0]?.subtitle).toEqual({
      badge: "workflow",
      text: "troubleshooting",
      tone: "muted",
    });
  });

  it("exposes active handler commands on child rows without changing the parent preview", () => {
    const snapshot = createSessionSnapshot({
      session: {
        id: "session-handler-command",
        orchestratorPiSessionId: "session-handler-command",
        wait: null,
      },
      turns: [
        {
          id: "turn-handler-command",
          sessionId: "session-handler-command",
          surfacePiSessionId: "pi-thread-command",
          threadId: "thread-command",
        },
      ],
      threads: [
        {
          id: "thread-command",
          title: "Command handler",
          objective: "Run handler commands.",
          status: "running-handler",
          surfacePiSessionId: "pi-thread-command",
          updatedAt: "2026-04-18T10:08:00.000Z",
        },
      ],
      commands: [
        {
          id: "command-complete",
          sessionId: "session-handler-command",
          turnId: "turn-handler-command",
          threadId: "thread-command",
          surfacePiSessionId: "pi-thread-command",
          executor: "handler",
          visibility: "summary",
          status: "succeeded",
          title: "Completed command",
          summary: "Completed command summary.",
          updatedAt: "2026-04-18T10:08:00.000Z",
        },
        {
          id: "command-running",
          sessionId: "session-handler-command",
          turnId: "turn-handler-command",
          threadId: "thread-command",
          surfacePiSessionId: "pi-thread-command",
          executor: "handler",
          visibility: "summary",
          status: "running",
          title: "Running command",
          summary: "Running command summary.",
          updatedAt: "2026-04-18T10:07:00.000Z",
        },
      ],
    });

    const summary = buildStructuredSessionSummaryProjection(snapshot);
    const view = buildStructuredSessionView(snapshot);

    expect(summary.preview).toBe("");
    expect(view.sidebarThreads[0]?.latestCommandRollup).toMatchObject({
      commandId: "command-running",
      status: "running",
      title: "Running command",
      summary: "Running command summary.",
    });
    expect(view.sidebarThreads[0]?.subtitle).toBeNull();
  });

  it("uses the latest handler episode as the child-row delegated summary fallback", () => {
    const snapshot = createSessionSnapshot({
      session: {
        id: "session-handler-episode",
        orchestratorPiSessionId: "session-handler-episode",
        wait: null,
      },
      turns: [
        {
          id: "turn-handler-episode",
          sessionId: "session-handler-episode",
          surfacePiSessionId: "pi-thread-episode",
          threadId: "thread-episode",
        },
      ],
      threads: [
        {
          id: "thread-episode",
          title: "Episode handler",
          objective: "Summarize delegated work.",
          status: "completed",
          surfacePiSessionId: "pi-thread-episode",
          updatedAt: "2026-04-18T10:10:00.000Z",
        },
      ],
      episodes: [
        {
          id: "episode-older",
          sessionId: "session-handler-episode",
          threadId: "thread-episode",
          sourceCommandId: null,
          summary: "Older delegated summary.",
          createdAt: "2026-04-18T10:09:00.000Z",
        },
        {
          id: "episode-newer",
          sessionId: "session-handler-episode",
          threadId: "thread-episode",
          sourceCommandId: null,
          summary: "Latest delegated summary.",
          createdAt: "2026-04-18T10:10:00.000Z",
        },
      ],
    });

    const view = buildStructuredSessionView(snapshot);

    expect(view.sidebarThreads[0]?.subtitle).toEqual({
      badge: "text",
      text: "Latest delegated summary.",
      tone: "muted",
    });
    expect(view.sidebarThreads[0]?.latestCommandRollup).toBeNull();
  });

  it("falls back to the latest turn request instead of repeating the session title", () => {
    const snapshot = createSessionSnapshot({
      turns: [
        {
          id: "turn-older",
          requestSummary: "Initial parser investigation request.",
          updatedAt: "2026-04-18T10:00:00.000Z",
        },
        {
          id: "turn-newer",
          requestSummary: "Check whether the sidebar preview duplicates the title.",
          updatedAt: "2026-04-18T10:05:00.000Z",
        },
      ],
    });

    const summary = buildStructuredSessionSummaryProjection(snapshot);
    expect(summary.title).toBe("Selector Session");
    expect(summary.preview).toBe("Check whether the sidebar preview duplicates the title.");
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
          meta: {
            contextBudget: {
              usedTokens: 401.8,
              maxTokens: 1000.2,
            },
          },
          updatedAt: "2026-04-18T10:02:00.000Z",
        },
      ],
      generatedAgentContextBindings: [
        {
          ownerId: "workflow-task-attempt-1",
          surfacePiSessionId: "pi-task-agent-001",
          systemPrompt: "Use the historical workflow task prompt.",
          generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
          generatedAgentContextRevision: 7,
          loadedExtensionIds: ["base-workflow-task", "shell"],
          availableExtensionIds: ["github"],
          externalSourceHashes: ["AGENTS.md:initial:true"],
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
          toolName: "write",
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
          missingFile: true,
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
      contextBudget: {
        usedTokens: 401,
        maxTokens: 1000,
        percent: 40.1,
        tone: "orange",
        label: "40.1% context",
        detail: "401 of 1.0k tokens",
      },
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
      generatedAgentContextFingerprint: "workflow-task-fingerprint-001",
      generatedAgentContextBinding: {
        systemPrompt: "Use the historical workflow task prompt.",
        generatedAgentContextRevision: 7,
        loadedExtensionIds: ["base-workflow-task", "shell"],
        availableExtensionIds: ["github"],
        externalSourceHashes: ["AGENTS.md:initial:true"],
      },
      meta: {
        contextBudget: {
          usedTokens: 401.8,
          maxTokens: 1000.2,
        },
      },
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
          arguments: null,
          facts: null,
          error: null,
          artifacts: [],
          outputEvents: [],
          stdin: EMPTY_STDIN_STATE,
          argumentSnapshots: [],
          patchSnapshots: [],
          diagnostics: [],
          childCount: 1,
          summaryChildCount: 1,
          traceChildCount: 0,
          summaryChildren: [
            {
              commandId: "command-task-child",
              toolName: "write",
              status: "succeeded",
              title: "Write workflow-proof.txt",
              summary: "Wrote workflow-proof.txt.",
              error: null,
            },
          ],
          startedAt: "2026-04-18T07:00:30.000Z",
          updatedAt: "2026-04-18T10:01:25.000Z",
          finishedAt: "2026-04-18T07:01:00.000Z",
        },
      ],
      artifacts: [
        {
          artifactId: "artifact-task-1",
          kind: "text",
          name: "workflow-proof.txt",
          path: "/repo/svvy/workflow-proof.txt",
          createdAt: "2026-04-18T10:01:30.000Z",
          sourceCommandId: "command-task-parent",
          workflowRunId: "workflow-attempt-1",
          workflowName: "selector-workflow",
          producerLabel: "selector-workflow",
          missingFile: true,
        },
      ],
    });
  });
});
