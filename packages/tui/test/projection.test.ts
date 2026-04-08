import { describe, expect, it, test } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  createVerificationRecord,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import { VirtualTerminalHarness } from "@hellm/test-support";

describe("@hellm/tui projection", () => {
  it("projects waiting smithers state with latest episode details and workflow activity", () => {
    const thread = createThread({
      id: "thread-ui",
      kind: "smithers-workflow",
      objective: "Show workflow state",
      status: "waiting_approval",
      worktreePath: "/repo/worktrees/ui",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const artifact = createArtifact({
      id: "artifact-ui",
      kind: "note",
      description: "Projection note",
      createdAt: "2026-04-08T09:00:00.000Z",
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
      startedAt: "2026-04-08T09:00:00.000Z",
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
          updatedAt: "2026-04-08T09:00:00.000Z",
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

  test.todo(
    "advanced worktree switching UX remains orchestration-aware",
    () => {},
  );
  test.todo(
    "rich slash command surface integrates with the orchestration projection",
    () => {},
  );
});
