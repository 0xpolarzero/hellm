import { describe, expect, it } from "bun:test";
import { createContextLoader } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";

describe("@hellm/orchestrator context loading", () => {
  it("loads session history, repo/worktree state, AGENTS instructions, relevant skills, and prior state from explicit sources", async () => {
    const loader = createContextLoader({
      async loadSessionHistory() {
        return [{ type: "message", role: "custom" } as never];
      },
      async loadRepoAndWorktree() {
        return {
          cwd: "/repo",
          worktreePath: "/repo/worktrees/feature",
        };
      },
      async loadAgentsInstructions() {
        return ["Read docs/prd.md before doing any work."];
      },
      async loadRelevantSkills() {
        return ["frontend-design", "audit"];
      },
      async loadState() {
        return createEmptySessionState({
          sessionId: "session-1",
          sessionCwd: "/repo",
          activeWorktreePath: "/repo/worktrees/feature",
        });
      },
    });

    const context = await loader.load({
      threadId: "thread-1",
      prompt: "What should we load?",
      cwd: "/repo",
    });

    expect(context.sessionHistory).toHaveLength(1);
    expect(context.repoAndWorktree.worktreePath).toBe("/repo/worktrees/feature");
    expect(context.agentsInstructions).toEqual([
      "Read docs/prd.md before doing any work.",
    ]);
    expect(context.relevantSkills).toEqual(["frontend-design", "audit"]);
    expect(context.priorEpisodes).toEqual([]);
    expect(context.priorArtifacts).toEqual([]);
    expect(context.state.alignment.aligned).toBe(false);
  });
});
