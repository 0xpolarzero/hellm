import { describe, expect, it } from "bun:test";
import { createContextLoader } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";

describe("@hellm/orchestrator context loading", () => {
  it("defaults repo/worktree context from the request and seeds empty state alignment", async () => {
    const loader = createContextLoader();

    const context = await loader.load({
      threadId: "thread-defaults",
      prompt: "Load defaults.",
      cwd: "/repo",
      worktreePath: "/repo/worktrees/default",
    });

    expect(context.repoAndWorktree).toEqual({
      cwd: "/repo",
      worktreePath: "/repo/worktrees/default",
    });
    expect(context.state.sessionCwd).toBe("/repo");
    expect(context.state.alignment.activeWorktreePath).toBe(
      "/repo/worktrees/default",
    );
    expect(context.state.alignment.aligned).toBe(false);
    expect(context.sessionHistory).toEqual([]);
  });

  it("uses explicit repo/worktree sources as authoritative over request fallbacks", async () => {
    const loader = createContextLoader({
      async loadRepoAndWorktree() {
        return {
          cwd: "/source-repo",
        };
      },
    });

    const context = await loader.load({
      threadId: "thread-explicit-source",
      prompt: "Load explicit source values.",
      cwd: "/request-repo",
      worktreePath: "/request-repo/worktrees/feature",
    });

    expect(context.repoAndWorktree).toEqual({
      cwd: "/source-repo",
    });
    expect(context.state.sessionCwd).toBe("/source-repo");
    expect(context.state.alignment.activeWorktreePath).toBeUndefined();
    expect(context.state.alignment.aligned).toBe(true);
  });

  it("preserves explicitly loaded state even when repo/worktree context differs", async () => {
    const loadedState = createEmptySessionState({
      sessionId: "session-loaded",
      sessionCwd: "/state-repo",
      activeWorktreePath: "/state-repo/worktrees/existing",
    });

    const loader = createContextLoader({
      async loadRepoAndWorktree() {
        return {
          cwd: "/repo",
          worktreePath: "/repo/worktrees/current",
        };
      },
      async loadState() {
        return loadedState;
      },
    });

    const context = await loader.load({
      threadId: "thread-loaded-state",
      prompt: "Load state and context.",
      cwd: "/repo",
    });

    expect(context.repoAndWorktree).toEqual({
      cwd: "/repo",
      worktreePath: "/repo/worktrees/current",
    });
    expect(context.state).toBe(loadedState);
    expect(context.state.sessionCwd).toBe("/state-repo");
    expect(context.state.alignment.activeWorktreePath).toBe(
      "/state-repo/worktrees/existing",
    );
  });

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
