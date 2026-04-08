import { describe, expect, it, test } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import { VirtualTerminalHarness } from "@hellm/test-support";

describe("@hellm/tui projection", () => {
  it("projects threads, episode details, verification, workflow activity, and session/worktree indicators without snapshots", () => {
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
      episodes: [episode],
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

    expect(projection.threadsPane).toContain("status waiting_approval");
    expect(projection.episodeInspector).toContain("follow-up Approve or deny the workflow");
    expect(projection.workflowActivity[0]).toContain("waiting_approval");
    expect(projection.footer).toContain("not aligned");
    expect(viewport).toContain("[threads]");
    expect(viewport).toContain("[workflow]");
  });

  test.todo(
    "rich slash command surface integrates with the orchestration projection",
    () => {},
  );
});
