import { describe, expect, it, test } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  createThreadSnapshot,
  createVerificationRecord,
  type ThreadStatus,
} from "@hellm/session-model";
import { projectThreadSnapshot, renderProjection } from "@hellm/tui";
import {
  FileBackedSessionJsonlHarness,
  VirtualTerminalHarness,
  withTempWorkspace,
} from "../../../test-support/index.ts";

const TIMESTAMP = "2026-04-08T09:00:00.000Z";

describe("@hellm/tui projection", () => {
  it("renders deterministic empty-state panes for a fresh orchestrator snapshot", () => {
    const thread = createThread({
      id: "thread-empty",
      kind: "direct",
      objective: "Await work",
      status: "pending",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });

    expect(projection.threadsPane).toEqual([
      "thread thread-empty",
      "kind direct",
      "status pending",
      "objective Await work",
    ]);
    expect(projection.episodeInspector).toEqual(["episode none"]);
    expect(projection.verificationPanel).toEqual([
      "overall unknown",
      "verification: unknown",
    ]);
    expect(projection.workflowActivity).toEqual(["workflow none"]);
    expect(projection.footer).toEqual([
      "session /repo",
      "worktree /repo",
      "aligned",
    ]);
    expect(renderProjection(projection)).toEqual([
      "[threads]",
      ...projection.threadsPane,
      "[episode]",
      ...projection.episodeInspector,
      "[verification]",
      ...projection.verificationPanel,
      "[workflow]",
      ...projection.workflowActivity,
      "[footer]",
      ...projection.footer,
    ]);
  });

  it("renders deterministic threads pane lines for id, kind, status, and objective", () => {
    const thread = createThread({
      id: "thread-pane-order",
      kind: "verification",
      objective: "Show deterministic thread metadata order",
      status: "running",
      createdAt: "2026-04-08T09:00:00.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });

    expect(projection.threadsPane).toEqual([
      "thread thread-pane-order",
      "kind verification",
      "status running",
      "objective Show deterministic thread metadata order",
    ]);
  });

  it("keeps thread lifecycle statuses visible in the threads pane", () => {
    const statuses: readonly ThreadStatus[] = [
      "pending",
      "running",
      "waiting_input",
      "waiting_approval",
      "blocked",
      "completed",
      "failed",
      "cancelled",
    ];

    for (const status of statuses) {
      const thread = createThread({
        id: `thread-${status}`,
        kind: "direct",
        objective: "Track status visibility",
        status,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const projection = projectThreadSnapshot({
        thread,
        episodes: [],
        artifacts: [],
        verification: createGlobalVerificationState(),
        alignment: createSessionWorktreeAlignment({
          sessionCwd: "/repo",
        }),
        workflowRuns: [],
      });

      expect(projection.threadsPane).toContain(`status ${status}`);
    }
  });

  it("prioritizes rendering the threads pane in constrained viewports", () => {
    const thread = createThread({
      id: "thread-priority",
      kind: "direct",
      objective: "Ensure threads pane remains visible first",
      status: "blocked",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });
    const terminal = new VirtualTerminalHarness(120, 5);
    const viewport = terminal.render(projection);

    expect(viewport).toEqual([
      "[threads]",
      "thread thread-priority",
      "kind direct",
      "status blocked",
      "objective Ensure threads pane remains visible first",
    ]);
  });

  it("shows the latest episode details and excludes stale episode conclusions", () => {
    const thread = createThread({
      id: "thread-latest-episode",
      kind: "smithers-workflow",
      objective: "Continue delegated workflow",
      status: "running",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const olderEpisode = createEpisode({
      id: "episode-older",
      threadId: thread.id,
      source: "orchestrator",
      objective: "Old completion",
      status: "completed",
      conclusions: ["old conclusion"],
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
      },
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:00:01.000Z",
    });
    const latestEpisode = createEpisode({
      id: "episode-latest",
      threadId: thread.id,
      source: "smithers",
      objective: "Current run",
      status: "blocked",
      conclusions: ["current conclusion"],
      unresolvedIssues: ["blocked on missing token"],
      followUpSuggestions: ["supply token"],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: "2026-04-08T09:05:00.000Z",
      completedAt: "2026-04-08T09:06:00.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [olderEpisode, latestEpisode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });

    expect(projection.episodeInspector).toContain("episode episode-latest");
    expect(projection.episodeInspector).toContain("status blocked");
    expect(projection.episodeInspector).toContain("conclusion current conclusion");
    expect(projection.episodeInspector).toContain("issue blocked on missing token");
    expect(projection.episodeInspector).toContain("follow-up supply token");
    expect(projection.episodeInspector).not.toContain("conclusion old conclusion");
  });

  it("projects verification records by kind and removes unknown fallback when records exist", () => {
    const thread = createThread({
      id: "thread-verification",
      kind: "verification",
      objective: "Summarize checks",
      status: "completed",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const build = createVerificationRecord({
      id: "verification-build",
      kind: "build",
      status: "passed",
      summary: "Build passed",
      createdAt: "2026-04-08T09:01:00.000Z",
    });
    const manual = createVerificationRecord({
      id: "verification-manual",
      kind: "manual",
      status: "failed",
      summary: "Manual checks failed",
      createdAt: "2026-04-08T09:02:00.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState([build, manual]),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });

    expect(projection.verificationPanel).toContain("overall failed");
    expect(projection.verificationPanel).toContain("build: passed - Build passed");
    expect(projection.verificationPanel).toContain(
      "manual: failed - Manual checks failed",
    );
    expect(projection.verificationPanel).not.toContain("verification: unknown");
  });

  it("roundtrips a real JSONL session file into an orchestration-aware TUI projection", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("ui-projection");
      const sessionFile = workspace.path(".pi/sessions/orchestration-ui.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "session-ui",
        cwd: workspace.root,
      });
      const thread = createThread({
        id: "thread-jsonl-ui",
        kind: "smithers-workflow",
        objective: "Render orchestration summary from JSONL",
        status: "waiting_approval",
        worktreePath,
        smithersRunId: "run-jsonl-ui",
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const artifact = createArtifact({
        id: "artifact-jsonl-ui",
        kind: "note",
        description: "Workflow summary artifact",
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const verification = createVerificationRecord({
        id: "verification-jsonl-ui",
        kind: "test",
        status: "failed",
        summary: "Tests failed in delegated run",
        createdAt: "2026-04-08T09:00:01.000Z",
      });
      const episode = createEpisode({
        id: "episode-jsonl-ui",
        threadId: thread.id,
        source: "smithers",
        objective: thread.objective,
        status: "waiting_approval",
        conclusions: ["Awaiting operator approval."],
        unresolvedIssues: ["Operator approval required"],
        followUpSuggestions: ["Approve the workflow"],
        artifacts: [artifact],
        verification: [verification],
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
        },
        smithersRunId: "run-jsonl-ui",
        worktreePath,
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      });

      harness.append({ kind: "thread", data: thread });
      harness.append({ kind: "episode", data: episode });
      harness.append({
        kind: "alignment",
        data: createSessionWorktreeAlignment({
          sessionCwd: workspace.root,
          activeWorktreePath: worktreePath,
        }),
      });
      harness.append({
        kind: "workflow-run",
        data: {
          runId: "run-jsonl-ui",
          threadId: thread.id,
          workflowId: "workflow:thread-jsonl-ui",
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:01.000Z",
          worktreePath,
        },
      });

      const state = harness.reconstruct();
      const snapshot = createThreadSnapshot(state, thread.id);
      const projection = projectThreadSnapshot(snapshot);
      const terminal = new VirtualTerminalHarness(120, 24);
      const viewport = terminal.render(projection);

      expect(viewport).toContain("[threads]");
      expect(viewport).toContain("[episode]");
      expect(viewport).toContain("[verification]");
      expect(viewport).toContain("[workflow]");
      expect(viewport).toContain("[footer]");
      expect(projection.threadsPane).toContain("status waiting_approval");
      expect(projection.episodeInspector).toContain(
        "issue Operator approval required",
      );
      expect(projection.verificationPanel).toContain(
        "test: failed - Tests failed in delegated run",
      );
      expect(projection.workflowActivity).toEqual([
        "workflow:thread-jsonl-ui: waiting_approval (run-jsonl-ui)",
      ]);
      expect(projection.footer).toContain("not aligned");
    });
  });

  it("projects threads, episode details, verification, workflow activity, and session/worktree indicators without snapshots", () => {
    const thread = createThread({
      id: "thread-ui",
      kind: "smithers-workflow",
      objective: "Show workflow state",
      status: "waiting_approval",
      worktreePath: "/repo/worktrees/ui",
      createdAt: TIMESTAMP,
    });
    const artifact = createArtifact({
      id: "artifact-ui",
      kind: "note",
      description: "Projection note",
      createdAt: TIMESTAMP,
    });
    const olderEpisode = createEpisode({
      id: "episode-ui-old",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "completed",
      conclusions: ["Older conclusion should not be projected"],
      artifacts: [artifact],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: "2026-04-08T08:59:59.000Z",
      completedAt: "2026-04-08T09:00:00.000Z",
    });
    const episode = createEpisode({
      id: "episode-ui",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "waiting_approval",
      conclusions: ["Workflow paused for approval"],
      artifacts: [artifact],
      followUpSuggestions: ["Approve or deny the workflow"],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
        notes: "Workflow projection",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:01.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [olderEpisode, episode],
      artifacts: [artifact],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
        activeWorktreePath: "/repo/worktrees/ui",
      }),
      workflowRuns: [
        {
          runId: "run-ui",
          threadId: thread.id,
          workflowId: "workflow:thread-ui",
          status: "waiting_approval",
          updatedAt: TIMESTAMP,
          worktreePath: "/repo/worktrees/ui",
        },
      ],
    });
    const terminal = new VirtualTerminalHarness(120, 20);
    const viewport = terminal.render(projection);

    expect(projection.threadsPane).toContain("thread thread-ui");
    expect(projection.threadsPane).toContain("status waiting_approval");
    expect(projection.episodeInspector).toContain("episode episode-ui");
    expect(projection.episodeInspector).toContain(
      "conclusion Workflow paused for approval",
    );
    expect(projection.episodeInspector).not.toContain(
      "conclusion Older conclusion should not be projected",
    );
    expect(projection.episodeInspector).toContain("follow-up Approve or deny the workflow");
    expect(projection.workflowActivity[0]).toContain("waiting_approval");
    expect(projection.footer).toContain("not aligned");
    expect(projection.footer).toContain("session /repo");
    expect(projection.footer).toContain("worktree /repo/worktrees/ui");
    expect(viewport).toContain("[threads]");
    expect(viewport).toContain("[workflow]");
    expect(viewport).toContain("episode episode-ui");
  });

  it("renders explicit fallback lines when state is empty", () => {
    const thread = createThread({
      id: "thread-ui-empty",
      kind: "direct",
      objective: "Show empty orchestrator state projection",
      status: "pending",
      createdAt: "2026-04-08T10:00:00.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });

    expect(projection.episodeInspector).toEqual(["episode none"]);
    expect(projection.verificationPanel).toEqual([
      "overall unknown",
      "verification: unknown",
    ]);
    expect(projection.workflowActivity).toEqual(["workflow none"]);
    expect(projection.footer).toEqual([
      "session /repo",
      "worktree /repo",
      "aligned",
    ]);
  });

  it("projects normalized verification records by kind", () => {
    const thread = createThread({
      id: "thread-ui-verification",
      kind: "verification",
      objective: "Show verification state",
      status: "completed",
      createdAt: "2026-04-08T11:00:00.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState([
        createVerificationRecord({
          id: "verify-build-old",
          kind: "build",
          status: "failed",
          summary: "Old build failure",
          createdAt: "2026-04-08T11:00:00.000Z",
        }),
        createVerificationRecord({
          id: "verify-build-new",
          kind: "build",
          status: "passed",
          summary: "Build recovered",
          createdAt: "2026-04-08T11:01:00.000Z",
        }),
        createVerificationRecord({
          id: "verify-test",
          kind: "test",
          status: "failed",
          summary: "Tests still failing",
          createdAt: "2026-04-08T11:01:00.000Z",
        }),
      ]),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    });

    expect(projection.verificationPanel).toContain("overall failed");
    expect(projection.verificationPanel).toContain(
      "build: passed - Build recovered",
    );
    expect(projection.verificationPanel).toContain(
      "test: failed - Tests still failing",
    );
    expect(projection.verificationPanel.join("\n")).not.toContain(
      "build: failed - Old build failure",
    );
  });

  it("shows waiting_input visibility across thread, latest episode, and viewport when no workflow run is active", () => {
    const thread = createThread({
      id: "thread-waiting-input",
      kind: "approval",
      objective: "Clarify missing requirement",
      status: "waiting_input",
      createdAt: TIMESTAMP,
    });
    const episode = createEpisode({
      id: "episode-waiting-input",
      threadId: thread.id,
      source: "orchestrator",
      objective: thread.objective,
      status: "waiting_input",
      conclusions: ["Need one clarification before continuing."],
      followUpSuggestions: ["Provide the missing requirement."],
      provenance: {
        executionPath: "approval",
        actor: "orchestrator",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:02.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [episode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    });
    const viewport = new VirtualTerminalHarness(120, 20).render(projection);

    expect(projection.threadsPane).toContain("status waiting_input");
    expect(projection.episodeInspector).toContain("status waiting_input");
    expect(projection.workflowActivity).toEqual(["workflow none"]);
    expect(viewport).toContain("status waiting_input");
  });

  it("shows waiting_approval visibility across thread, latest episode, workflow activity, and viewport", () => {
    const thread = createThread({
      id: "thread-waiting-approval",
      kind: "smithers-workflow",
      objective: "Wait for approval gate",
      status: "waiting_approval",
      createdAt: TIMESTAMP,
    });
    const episode = createEpisode({
      id: "episode-waiting-approval",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "waiting_approval",
      conclusions: ["Workflow gate paused for approval."],
      followUpSuggestions: ["Approve or deny this step."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:03.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [episode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [
        {
          runId: "run-waiting-approval",
          threadId: thread.id,
          workflowId: "workflow:thread-waiting-approval",
          status: "waiting_approval",
          updatedAt: TIMESTAMP,
        },
      ],
    });
    const viewport = new VirtualTerminalHarness(120, 20).render(projection);

    expect(projection.threadsPane).toContain("status waiting_approval");
    expect(projection.episodeInspector).toContain("status waiting_approval");
    expect(projection.workflowActivity).toContain(
      "workflow:thread-waiting-approval: waiting_approval (run-waiting-approval)",
    );
    expect(viewport).toContain("status waiting_approval");
  });

  it("keeps blocked visibility explicit even when workflow activity is failed and the latest episode changed from waiting", () => {
    const thread = createThread({
      id: "thread-blocked",
      kind: "smithers-workflow",
      objective: "Handle blocked dependency",
      status: "blocked",
      createdAt: TIMESTAMP,
    });
    const waitingEpisode = createEpisode({
      id: "episode-before-blocked",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "waiting_approval",
      conclusions: ["Previously waiting on an approval gate."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:04.000Z",
    });
    const blockedEpisode = createEpisode({
      id: "episode-blocked",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "blocked",
      conclusions: ["Workflow is blocked by missing dependency."],
      unresolvedIssues: ["Dependency package is unavailable."],
      followUpSuggestions: ["Install the dependency and resume."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:05.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [waitingEpisode, blockedEpisode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [
        {
          runId: "run-blocked-failed",
          threadId: thread.id,
          workflowId: "workflow:thread-blocked",
          status: "failed",
          updatedAt: TIMESTAMP,
        },
      ],
    });
    const viewport = new VirtualTerminalHarness(120, 20).render(projection);

    expect(projection.threadsPane).toContain("status blocked");
    expect(projection.episodeInspector).toContain("episode episode-blocked");
    expect(projection.episodeInspector).toContain("status blocked");
    expect(projection.episodeInspector).toContain(
      "issue Dependency package is unavailable.",
    );
    expect(projection.workflowActivity).toContain(
      "workflow:thread-blocked: failed (run-blocked-failed)",
    );
    expect(viewport).toContain("status blocked");
  });

  test.todo(
    "rich slash command surface integrates with the orchestration projection",
    () => {},
  );
});
