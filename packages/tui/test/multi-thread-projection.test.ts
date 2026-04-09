import { describe, expect, it } from "bun:test";
import {
  createEmptySessionState,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  type SessionState,
} from "@hellm/session-model";
import {
  projectSessionState,
  renderMultiThreadProjection,
  renderMultiThreadTuiFrame,
} from "@hellm/tui";

const TIMESTAMP = "2026-04-08T09:00:00.000Z";

describe("@hellm/tui multi-thread projection", () => {
  it("projects an empty session with no threads", () => {
    const state = createEmptySessionState({
      sessionId: "session-empty",
      sessionCwd: "/repo",
    });

    const projection = projectSessionState(state);

    expect(projection.threadsOverview).toEqual(["no threads"]);
    expect(projection.activeThread.threadsPane).toEqual(["no active thread"]);
    expect(projection.activeThread.episodeInspector).toEqual(["episode none"]);
    expect(projection.activeThread.footer).toContain("aligned");
  });

  it("projects a session with multiple threads showing all of them in the overview", () => {
    const threadA = createThread({
      id: "thread-a",
      kind: "direct",
      objective: "Direct task",
      status: "completed",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    const threadB = createThread({
      id: "thread-b",
      kind: "smithers-workflow",
      objective: "Delegated work",
      status: "running",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    const threadC = createThread({
      id: "thread-c",
      kind: "verification",
      objective: "Run verification",
      status: "blocked",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });

    const episodeA = createEpisode({
      id: "episode-a",
      threadId: threadA.id,
      source: "orchestrator",
      objective: threadA.objective,
      status: "completed",
      conclusions: ["Direct answer."],
      provenance: { executionPath: "direct", actor: "orchestrator" },
      startedAt: TIMESTAMP,
      completedAt: TIMESTAMP,
    });
    const episodeB = createEpisode({
      id: "episode-b",
      threadId: threadB.id,
      source: "smithers",
      objective: threadB.objective,
      status: "completed",
      conclusions: ["Workflow finished."],
      provenance: { executionPath: "smithers-workflow", actor: "smithers" },
      startedAt: TIMESTAMP,
      completedAt: TIMESTAMP,
    });
    const episodeC = createEpisode({
      id: "episode-c",
      threadId: threadC.id,
      source: "verification",
      objective: threadC.objective,
      status: "completed_with_issues",
      conclusions: ["Verification failed."],
      unresolvedIssues: ["Test failure."],
      provenance: { executionPath: "verification", actor: "verification" },
      startedAt: TIMESTAMP,
      completedAt: TIMESTAMP,
    });

    const state: SessionState = {
      sessionId: "session-multi",
      sessionCwd: "/repo",
      threads: [threadA, threadB, threadC],
      episodes: [episodeA, episodeB, episodeC],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
      smithersIsolations: [],
    };

    const projection = projectSessionState(state, "thread-b");

    expect(projection.threadsOverview).toEqual([
      "  thread-a [direct] completed (1 episodes)",
      "> thread-b [smithers-workflow] running (1 episodes)",
      "  thread-c [verification] blocked (1 episodes)",
    ]);

    expect(projection.activeThread.threadsPane).toEqual([
      "thread thread-b",
      "kind smithers-workflow",
      "status running",
      "objective Delegated work",
    ]);

    expect(projection.activeThread.episodeInspector).toEqual([
      "episode episode-b",
      "source smithers",
      "status completed",
      "conclusion Workflow finished.",
    ]);
  });

  it("defaults the active thread to the last thread when no activeThreadId is specified", () => {
    const threadA = createThread({
      id: "thread-first",
      kind: "direct",
      objective: "First",
      status: "completed",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    const threadB = createThread({
      id: "thread-last",
      kind: "direct",
      objective: "Last",
      status: "running",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });

    const state: SessionState = {
      sessionId: "session-default-active",
      sessionCwd: "/repo",
      threads: [threadA, threadB],
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
      smithersIsolations: [],
    };

    const projection = projectSessionState(state);

    expect(projection.threadsOverview[1]).toContain("> thread-last");
    expect(projection.activeThread.threadsPane[0]).toBe("thread thread-last");
  });

  it("renders a complete multi-thread projection with all sections", () => {
    const thread = createThread({
      id: "thread-render",
      kind: "direct",
      objective: "Render test",
      status: "completed",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });

    const state: SessionState = {
      sessionId: "session-render",
      sessionCwd: "/repo",
      threads: [thread],
      episodes: [
        createEpisode({
          id: "episode-render",
          threadId: thread.id,
          source: "orchestrator",
          objective: thread.objective,
          status: "completed",
          conclusions: ["Done."],
          provenance: { executionPath: "direct", actor: "orchestrator" },
          startedAt: TIMESTAMP,
          completedAt: TIMESTAMP,
        }),
      ],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
      smithersIsolations: [],
    };

    const lines = renderMultiThreadProjection(projectSessionState(state, thread.id));

    expect(lines[0]).toBe("[threads-overview]");
    expect(lines.find((l) => l.includes("thread-render"))).toBeDefined();
    expect(lines.find((l) => l === "[threads]")).toBeDefined();
    expect(lines.find((l) => l === "[episode]")).toBeDefined();
    expect(lines.find((l) => l === "[verification]")).toBeDefined();
    expect(lines.find((l) => l === "[footer]")).toBeDefined();
  });

  it("frames multi-thread projection within width and height bounds", () => {
    const thread = createThread({
      id: "thread-frame",
      kind: "direct",
      objective: "Frame test",
      status: "completed",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });

    const state: SessionState = {
      sessionId: "session-frame",
      sessionCwd: "/repo",
      threads: [thread],
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
      smithersIsolations: [],
    };

    const frame = renderMultiThreadTuiFrame(
      projectSessionState(state, thread.id),
      { width: 40, height: 8 },
    );

    expect(frame.length).toBeLessThanOrEqual(8);
    for (const line of frame) {
      expect(line.length).toBeLessThanOrEqual(40);
    }
  });
});
