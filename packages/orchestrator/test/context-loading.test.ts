import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { createContextLoader, createOrchestrator } from "@hellm/orchestrator";
import {
  createArtifact,
  createEmptySessionState,
  createEpisode,
  createSessionHeader,
  createStructuredSessionEntry,
  createThread,
  reconstructSessionState,
  type SessionJsonlEntry,
} from "@hellm/session-model";
import {
  FileBackedSessionJsonlHarness,
  FakePiRuntimeBridge,
  withTempWorkspace,
} from "@hellm/test-support";

function readSessionFile(filePath: string): SessionJsonlEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }

  return readFileSync(filePath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as SessionJsonlEntry);
}

describe("@hellm/orchestrator context loading", () => {
  it("defaults session history to an empty array when no source is configured", async () => {
    const loader = createContextLoader();

    const context = await loader.load({
      threadId: "thread-default",
      prompt: "What should we load?",
      cwd: "/repo",
    });

    expect(context.sessionHistory).toEqual([]);
  });

  it("passes the request through to loadSessionHistory and preserves the returned entries", async () => {
    const requests: string[] = [];
    const history = [
      createSessionHeader({
        id: "session-source",
        timestamp: "2026-04-08T09:00:00.000Z",
        cwd: "/repo",
      }),
    ];

    const loader = createContextLoader({
      async loadSessionHistory(request) {
        requests.push(`${request.threadId}:${request.cwd}`);
        return history;
      },
    });

    const context = await loader.load({
      threadId: "thread-source",
      prompt: "Load from explicit source",
      cwd: "/repo",
    });

    expect(requests).toEqual(["thread-source:/repo"]);
    expect(context.sessionHistory).toEqual(history);
  });

  it("defaults repo/worktree context from the request and seeds empty state alignment", async () => {
    const loader = createContextLoader();

    const context = await loader.load({
      threadId: "thread-defaults",
      prompt: "Load defaults",
      cwd: "/repo",
    });

    expect(context.relevantSkills).toEqual([]);
  });

  it("passes the request through to loadRelevantSkills and preserves the returned order", async () => {
    const requests: string[] = [];
    const loader = createContextLoader({
      async loadRelevantSkills(request) {
        requests.push(
          `${request.threadId}:${request.cwd}:${request.worktreePath ?? "none"}`,
        );
        return ["frontend-design", "audit", "frontend-design"];
      },
    });

    const context = await loader.load({
      threadId: "thread-skills-source",
      prompt: "Load relevant skills from explicit source.",
      cwd: "/repo",
      worktreePath: "/repo/worktrees/feature",
    });

    expect(requests).toEqual([
      "thread-skills-source:/repo:/repo/worktrees/feature",
    ]);
    expect(context.relevantSkills).toEqual([
      "frontend-design",
      "audit",
      "frontend-design",
    ]);
  });

  it("falls back to an empty relevant skills list when loadRelevantSkills resolves to nullish at runtime", async () => {
    const loader = createContextLoader({
      async loadRelevantSkills() {
        return undefined as unknown as string[];
      },
    });

    const context = await loader.load({
      threadId: "thread-skills-nullish",
      prompt: "Load nullish relevant skills.",
      cwd: "/repo",
    });

    expect(context.relevantSkills).toEqual([]);
  });

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

  it("defaults AGENTS instructions to an empty list when no source is provided", async () => {
    const loader = createContextLoader({
      async loadSessionHistory() {
        return [{ type: "message", role: "custom" } as never];
      },
    });

    const context = await loader.load({
      threadId: "thread-2",
      prompt: "Load default context.",
      cwd: "/repo",
    });

    expect(context.agentsInstructions).toEqual([]);
  });

  it("forwards context-loaded relevant skills into the pi-worker scoped context", async () => {
    const piBridge = new FakePiRuntimeBridge();
    piBridge.enqueueResult({
      status: "completed",
      episode: createEpisode({
        id: "episode-pi-relevant-skills",
        threadId: "thread-pi-relevant-skills",
        source: "pi-worker",
        objective: "Run bounded worker with loaded skills.",
        status: "completed",
        conclusions: ["Pi worker completed."],
        provenance: {
          executionPath: "pi-worker",
          actor: "pi-worker",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      }),
    });

    const orchestrator = createOrchestrator({
      piBridge,
      contextLoader: createContextLoader({
        async loadRelevantSkills() {
          return ["frontend-design", "audit"];
        },
      }),
    });

    const result = await orchestrator.run({
      threadId: "thread-pi-relevant-skills",
      prompt: "Run pi worker with loaded skills context.",
      cwd: "/repo",
      routeHint: "pi-worker",
    });

    expect(result.context.relevantSkills).toEqual(["frontend-design", "audit"]);
    expect(piBridge.workerRequests).toHaveLength(1);
    expect(piBridge.workerRequests[0]?.scopedContext.relevantSkills).toEqual([
      "frontend-design",
      "audit",
    ]);
  });

  it("falls back to request cwd/worktree when no repo source is provided", async () => {
    const loader = createContextLoader();
    const context = await loader.load({
      threadId: "thread-fallback",
      prompt: "Load from request context.",
      cwd: "/repo",
      worktreePath: "/repo/worktrees/fallback",
    });

    expect(context.repoAndWorktree).toEqual({
      cwd: "/repo",
      worktreePath: "/repo/worktrees/fallback",
    });
    expect(context.state.sessionCwd).toBe("/repo");
    expect(context.state.alignment.activeWorktreePath).toBe(
      "/repo/worktrees/fallback",
    );
    expect(context.state.alignment.aligned).toBe(false);
  });

  it("does not invent a worktree when request and sources omit one", async () => {
    const loader = createContextLoader();
    const context = await loader.load({
      threadId: "thread-no-worktree",
      prompt: "Load context without a worktree.",
      cwd: "/repo",
    });

    expect(context.repoAndWorktree).toEqual({
      cwd: "/repo",
    });
    expect(context.state.sessionCwd).toBe("/repo");
    expect(context.state.alignment.activeWorktreePath).toBeUndefined();
    expect(context.state.alignment.aligned).toBe(true);
  });

  it("prefers explicit repo/worktree source values over request values", async () => {
    const loader = createContextLoader({
      async loadRepoAndWorktree() {
        return {
          cwd: "/source/repo",
          worktreePath: "/source/repo/worktrees/feature",
        };
      },
    });

    const context = await loader.load({
      threadId: "thread-source-wins",
      prompt: "Use source context.",
      cwd: "/request/repo",
      worktreePath: "/request/repo/worktrees/feature",
    });

    expect(context.repoAndWorktree).toEqual({
      cwd: "/source/repo",
      worktreePath: "/source/repo/worktrees/feature",
    });
    expect(context.state.sessionCwd).toBe("/source/repo");
    expect(context.state.alignment.activeWorktreePath).toBe(
      "/source/repo/worktrees/feature",
    );
  });

  it("does not merge request worktree into partial repo source results", async () => {
    const loader = createContextLoader({
      async loadRepoAndWorktree() {
        return {
          cwd: "/source/repo",
        };
      },
    });

    const context = await loader.load({
      threadId: "thread-partial-source",
      prompt: "Use source cwd only.",
      cwd: "/request/repo",
      worktreePath: "/request/repo/worktrees/feature",
    });

    expect(context.repoAndWorktree).toEqual({
      cwd: "/source/repo",
    });
    expect(context.repoAndWorktree.worktreePath).toBeUndefined();
    expect(context.state.sessionCwd).toBe("/source/repo");
    expect(context.state.alignment.activeWorktreePath).toBeUndefined();
  });

  it("hydrates prior episodes and prior artifacts from loaded state", async () => {
    const now = "2026-04-08T09:00:00.000Z";
    const priorArtifact = createArtifact({
      id: "artifact-prior-log",
      kind: "log",
      description: "Prior build output",
      path: "/repo/reports/prior.log",
      createdAt: now,
    });
    const priorEpisode = createEpisode({
      id: "episode-prior",
      threadId: "thread-1",
      source: "orchestrator",
      objective: "Prior context",
      status: "completed",
      conclusions: ["Prior result"],
      artifacts: [priorArtifact],
      provenance: {
        executionPath: "direct",
        actor: "orchestrator",
      },
      startedAt: now,
      completedAt: now,
      inputEpisodeIds: ["episode-bootstrap"],
    });
    const priorState = {
      ...createEmptySessionState({
        sessionId: "session-1",
        sessionCwd: "/repo",
      }),
      episodes: [priorEpisode],
      artifacts: [priorArtifact],
    };
    const loader = createContextLoader({
      async loadState() {
        return priorState;
      },
    });

    const context = await loader.load({
      threadId: "thread-1",
      prompt: "Load historical context",
      cwd: "/repo",
    });

    expect(context.priorEpisodes).toEqual([priorEpisode]);
    expect(context.priorArtifacts).toEqual([priorArtifact]);
    expect(context.priorEpisodes[0]?.inputEpisodeIds).toEqual([
      "episode-bootstrap",
    ]);
    expect(context.state.episodes).toEqual([priorEpisode]);
    expect(context.state.artifacts).toEqual([priorArtifact]);
  });

  it("retains prior artifacts even when no prior episode references them", async () => {
    const priorArtifact = createArtifact({
      id: "artifact-unattached-note",
      kind: "file",
      description: "Unattached prior artifact",
      path: "/repo/notes/context.txt",
      createdAt: "2026-04-08T09:00:00.000Z",
    });
    const priorState = {
      ...createEmptySessionState({
        sessionId: "session-1",
        sessionCwd: "/repo",
      }),
      artifacts: [priorArtifact],
    };
    const loader = createContextLoader({
      async loadState() {
        return priorState;
      },
    });

    const context = await loader.load({
      threadId: "thread-1",
      prompt: "Load only artifacts",
      cwd: "/repo",
    });

    expect(context.priorEpisodes).toEqual([]);
    expect(context.priorArtifacts).toEqual([priorArtifact]);
    expect(context.state.artifacts).toEqual([priorArtifact]);
  });

  it("loads prior episodes and artifacts from a real JSONL session reconstruction flow", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/thread-context.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-context",
        cwd: workspace.root,
      });
      const artifactPath = await workspace.write(
        "reports/prior-context.log",
        "prior context artifact\n",
      );
      const priorArtifact = createArtifact({
        id: "artifact-prior-context",
        kind: "log",
        description: "Prior context artifact",
        path: artifactPath,
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const priorEpisode = createEpisode({
        id: "episode-prior-context",
        threadId: "thread-context",
        source: "orchestrator",
        objective: "Prior context objective",
        status: "completed",
        conclusions: ["Prior context is available."],
        artifacts: [priorArtifact],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
          notes: "Loaded from file-backed session state.",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
        inputEpisodeIds: ["episode-bootstrap"],
      });

      harness.append({ kind: "episode", data: priorEpisode });
      harness.append({ kind: "artifact", data: priorArtifact });

      const loader = createContextLoader({
        async loadState() {
          return reconstructSessionState(readSessionFile(sessionFile));
        },
      });

      const context = await loader.load({
        threadId: "thread-context",
        prompt: "Load reconstructed context",
        cwd: workspace.root,
      });

      expect(context.priorEpisodes).toHaveLength(1);
      expect(context.priorArtifacts).toHaveLength(1);
      expect(context.priorEpisodes[0]?.id).toBe("episode-prior-context");
      expect(context.priorEpisodes[0]?.threadId).toBe("thread-context");
      expect(context.priorEpisodes[0]?.inputEpisodeIds).toEqual([
        "episode-bootstrap",
      ]);
      expect(context.priorEpisodes[0]?.artifacts[0]).toEqual(priorArtifact);
      expect(context.priorArtifacts[0]).toEqual(priorArtifact);
      expect(context.priorArtifacts[0]?.path).toBe(artifactPath);
    });
  });

  it("falls back to request cwd/worktree and initializes prior state from empty structured state when no sources are provided", async () => {
    const loader = createContextLoader();
    const request = {
      threadId: "thread-2",
      prompt: "Load context for a structured-state-first run.",
      cwd: "/repo",
      worktreePath: "/repo/worktrees/feature-2",
    } as const;

    const context = await loader.load(request);

    expect(context.sessionHistory).toEqual([]);
    expect(context.repoAndWorktree).toEqual({
      cwd: "/repo",
      worktreePath: "/repo/worktrees/feature-2",
    });
    expect(context.state.sessionId).toBe("thread-2");
    expect(context.state.sessionCwd).toBe("/repo");
    expect(context.state.alignment.activeWorktreePath).toBe(
      "/repo/worktrees/feature-2",
    );
    expect(context.state.alignment.aligned).toBe(false);
    expect(context.priorEpisodes).toBe(context.state.episodes);
    expect(context.priorArtifacts).toBe(context.state.artifacts);
    expect(context.priorEpisodes).toEqual([]);
    expect(context.priorArtifacts).toEqual([]);
  });

  it("chains new structured entries to the latest structured entry in session history", async () => {
    const timestamp = "2026-04-08T09:00:00.000Z";
    const priorThread = createThread({
      id: "thread-prior",
      kind: "direct",
      objective: "Prior objective",
      status: "completed",
      inputEpisodeIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const priorStructuredEntry = createStructuredSessionEntry({
      id: "entry-prior",
      parentId: null,
      timestamp,
      payload: { kind: "thread", data: priorThread },
    });
    const sessionHistory = [
      createSessionHeader({
        id: "thread-next",
        timestamp,
        cwd: "/repo",
      }),
      priorStructuredEntry,
    ];

    const orchestrator = createOrchestrator({
      clock: () => timestamp,
      contextLoader: {
        async load(request) {
          return {
            sessionHistory,
            repoAndWorktree: { cwd: request.cwd },
            agentsInstructions: [],
            relevantSkills: [],
            priorEpisodes: [],
            priorArtifacts: [],
            state: createEmptySessionState({
              sessionId: request.threadId,
              sessionCwd: request.cwd,
            }),
          };
        },
      },
    });

    const result = await orchestrator.run({
      threadId: "thread-next",
      prompt: "Run direct path.",
      cwd: "/repo",
      routeHint: "direct",
    });

    expect(result.sessionEntries).toHaveLength(4);
    expect(result.sessionEntries[0]?.parentId).toBe("entry-prior");
  });
});
