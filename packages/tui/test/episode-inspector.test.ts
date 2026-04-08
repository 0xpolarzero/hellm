import { describe, expect, it } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import { VirtualTerminalHarness } from "@hellm/test-support";

describe("@hellm/tui episode inspector", () => {
  it("renders an explicit empty state when no episodes exist", () => {
    const thread = createThread({
      id: "thread-empty",
      kind: "direct",
      objective: "No episodes yet",
      status: "running",
      createdAt: "2026-04-08T10:00:00.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    });

    const terminal = new VirtualTerminalHarness(80, 10);
    const viewport = terminal.render(projection);

    expect(projection.episodeInspector).toEqual(["episode none"]);
    expect(viewport).toContain("[episode]");
    expect(viewport).toContain("episode none");
  });

  it("projects only the latest episode details in inspector order", () => {
    const thread = createThread({
      id: "thread-latest",
      kind: "smithers-workflow",
      objective: "Summarize latest episode details",
      status: "completed",
      createdAt: "2026-04-08T11:00:00.000Z",
    });
    const artifact = createArtifact({
      id: "artifact-latest",
      kind: "note",
      description: "Inspector coverage artifact",
      createdAt: "2026-04-08T11:00:00.000Z",
    });
    const olderEpisode = createEpisode({
      id: "episode-older",
      threadId: thread.id,
      source: "orchestrator",
      objective: thread.objective,
      status: "completed",
      conclusions: ["Older conclusion should not render"],
      artifacts: [artifact],
      followUpSuggestions: ["Older follow-up should not render"],
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
      },
      startedAt: "2026-04-08T11:00:00.000Z",
      completedAt: "2026-04-08T11:00:01.000Z",
    });
    const latestEpisode = createEpisode({
      id: "episode-latest",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "completed_with_issues",
      conclusions: ["Latest completion summary"],
      unresolvedIssues: ["Approval still required"],
      followUpSuggestions: ["Approve or deny the workflow"],
      artifacts: [artifact],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: "2026-04-08T11:01:00.000Z",
      completedAt: "2026-04-08T11:01:05.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [olderEpisode, latestEpisode],
      artifacts: [artifact],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    });

    expect(projection.episodeInspector).toEqual([
      "episode episode-latest",
      "source smithers",
      "status completed_with_issues",
      "conclusion Latest completion summary",
      "issue Approval still required",
      "follow-up Approve or deny the workflow",
    ]);
    expect(projection.episodeInspector).not.toContain(
      "conclusion Older conclusion should not render",
    );
    expect(projection.episodeInspector).not.toContain(
      "follow-up Older follow-up should not render",
    );
  });
});
