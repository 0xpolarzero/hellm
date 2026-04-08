import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  createOrchestrator,
  type ContextLoader,
  type OrchestratorRequest,
} from "@hellm/orchestrator";
import {
  createArtifact,
  createEmptySessionState,
  createEpisode,
  createThreadSnapshot,
  createVerificationRecord,
  reconstructSessionState,
  type SessionJsonlEntry,
  type StructuredSessionEntry,
} from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  FileBackedSessionJsonlHarness,
  createEpisodeFixture,
  createTempGitWorkspace,
  fixedClock,
  hasGit,
  withTempWorkspace,
} from "@hellm/test-support";

function createFilesystemContextLoader(input: {
  sessionFile: string;
  agentsFile?: string;
  skillsRoot?: string;
}): ContextLoader {
  return {
    async load(request: OrchestratorRequest) {
      const sessionHistory = readSessionFile(input.sessionFile);
      const state = sessionHistory.length
        ? reconstructSessionState(sessionHistory)
        : createEmptySessionState({
            sessionId: request.threadId,
            sessionCwd: request.cwd,
            ...(request.worktreePath
              ? { activeWorktreePath: request.worktreePath }
              : {}),
          });

      return {
        sessionHistory,
        repoAndWorktree: {
          cwd: request.cwd,
          ...(request.worktreePath ? { worktreePath: request.worktreePath } : {}),
        },
        agentsInstructions:
          input.agentsFile && existsSync(input.agentsFile)
            ? readFileSync(input.agentsFile, "utf8")
                .split("\n")
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
            : [],
        relevantSkills:
          input.skillsRoot && existsSync(input.skillsRoot)
            ? readdirSync(input.skillsRoot, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .filter((entry) =>
                  existsSync(`${input.skillsRoot}/${entry.name}/SKILL.md`),
                )
                .map((entry) => entry.name)
            : [],
        priorEpisodes: state.episodes,
        priorArtifacts: state.artifacts,
        state,
      };
    },
  };
}

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

function isStructuredSessionEntry(
  entry: SessionJsonlEntry,
): entry is StructuredSessionEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "type" in entry &&
    entry.type === "message" &&
    "id" in entry &&
    typeof entry.id === "string"
  );
}

describe("@hellm/orchestrator filesystem and worktree integration", () => {
  it("loads AGENTS instructions from disk by trimming lines and dropping blanks", async () => {
    await withTempWorkspace(async (workspace) => {
      const loader = createFilesystemContextLoader({
        sessionFile: workspace.path(".pi/sessions/thread-agents-parse.jsonl"),
        agentsFile: workspace.path("AGENTS.md"),
      });
      await workspace.write(
        "AGENTS.md",
        "  Read docs/prd.md before doing any work.  \n\n  Use Smithers for delegated work. \n   \n",
      );

      const context = await loader.load({
        threadId: "thread-agents-parse",
        prompt: "Load AGENTS instructions from disk.",
        cwd: workspace.root,
      });

      expect(context.agentsInstructions).toEqual([
        "Read docs/prd.md before doing any work.",
        "Use Smithers for delegated work.",
      ]);
    });
  });

  it("falls back to empty AGENTS instructions when the file is absent and forwards that empty context to the pi worker", async () => {
    await withTempWorkspace(async (workspace) => {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "episode-pi-no-agents",
          threadId: "thread-pi-no-agents",
          source: "pi-worker",
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
        contextLoader: createFilesystemContextLoader({
          sessionFile: workspace.path(".pi/sessions/thread-pi-no-agents.jsonl"),
          agentsFile: workspace.path("AGENTS.md"),
        }),
      });

      const result = await orchestrator.run({
        threadId: "thread-pi-no-agents",
        prompt: "Run the bounded worker path.",
        cwd: workspace.root,
        routeHint: "pi-worker",
      });

      expect(result.context.agentsInstructions).toEqual([]);
      expect(piBridge.workerRequests[0]?.scopedContext.agentsInstructions).toEqual(
        [],
      );
    });
  });

  it("loads only valid skill directories that include SKILL.md from the filesystem", async () => {
    await withTempWorkspace(async (workspace) => {
      await workspace.write("skills/frontend-design/SKILL.md", "# frontend-design\n");
      await workspace.write("skills/audit/SKILL.md", "# audit\n");
      await workspace.write("skills/not-a-skill/README.md", "# readme\n");
      await workspace.write("skills/NOTES.txt", "ignore me\n");

      const loader = createFilesystemContextLoader({
        sessionFile: workspace.path(".pi/sessions/thread-skills.jsonl"),
        skillsRoot: workspace.path("skills"),
      });

      const context = await loader.load({
        threadId: "thread-skills",
        prompt: "Load skills context",
        cwd: workspace.root,
      });

      expect([...context.relevantSkills].sort()).toEqual([
        "audit",
        "frontend-design",
      ]);
    });
  });

  it("returns an empty relevant skills list when the configured skills root does not exist", async () => {
    await withTempWorkspace(async (workspace) => {
      const loader = createFilesystemContextLoader({
        sessionFile: workspace.path(".pi/sessions/thread-missing-skills.jsonl"),
        skillsRoot: workspace.path("missing-skills"),
      });

      const context = await loader.load({
        threadId: "thread-missing-skills",
        prompt: "Load missing skills",
        cwd: workspace.root,
      });

      expect(context.relevantSkills).toEqual([]);
    });
  });

  it("reconciles a smithers workflow run into a file-backed session inside a real git worktree", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree("feature-smithers");
      await workspace.write(
        "AGENTS.md",
        "Read docs/prd.md before doing any work.\nUse Smithers for delegated work.\n",
      );
      await workspace.write("skills/testing/SKILL.md", "# testing\n");

      const sessionFile = workspace.path(".pi/sessions/thread-smithers.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-smithers",
        cwd: workspace.root,
      });
      const priorArtifact = createArtifact({
        id: "artifact-prior",
        kind: "file",
        description: "Prior note",
        path: await workspace.write("notes/prior.txt", "prior episode\n"),
        createdAt: "2026-04-08T09:00:00.000Z",
      });
      const priorEpisode = createEpisode({
        id: "episode-prior",
        threadId: "thread-smithers",
        source: "orchestrator",
        objective: "Prior objective",
        status: "completed",
        conclusions: ["Prior episode"],
        artifacts: [priorArtifact],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      });
      harness.append({ kind: "episode", data: priorEpisode });
      const priorEntryId = readSessionFile(sessionFile)
        .filter(isStructuredSessionEntry)
        .at(-1)?.id;

      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: "run-smithers",
          threadId: "thread-smithers",
          workflowId: "workflow:thread-smithers",
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_approval",
        outputs: [
          {
            nodeId: "task-implement",
            schema: "result",
            value: { summary: "Pending approval" },
          },
        ],
        approval: {
          nodeId: "task-implement",
          title: "Approve implementation",
          summary: "Workflow is waiting for approval.",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "episode-smithers",
          threadId: "thread-smithers",
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: "run-smithers",
          worktreePath,
          inputEpisodeIds: ["episode-prior"],
          followUpSuggestions: ["Approve the workflow to continue."],
        }),
        isolation: {
          runId: "run-smithers",
          runStateStore: workspace.path(".smithers/run-smithers.sqlite"),
          sessionEntryIds: ["entry-1", "entry-2"],
        },
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        smithersBridge,
        contextLoader: createFilesystemContextLoader({
          sessionFile,
          agentsFile: workspace.path("AGENTS.md"),
          skillsRoot: workspace.path("skills"),
        }),
      });

      const result = await orchestrator.run({
        threadId: "thread-smithers",
        prompt: "Implement the delegated workflow.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "smithers-workflow",
        workflowSeedInput: {
          preferredPath: "smithers-workflow",
          tasks: [
            {
              id: "task-implement",
              outputKey: "result",
              prompt: "Implement the delegated change",
              agent: "pi",
              needsApproval: true,
              worktreePath,
            },
          ],
        },
      });

      harness.appendEntries(result.sessionEntries);
      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(reconstructed, "thread-smithers");

      expect(result.context.agentsInstructions).toContain(
        "Read docs/prd.md before doing any work.",
      );
      expect(result.context.relevantSkills).toEqual(["testing"]);
      expect(result.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        "episode-prior",
      ]);
      expect(
        smithersBridge.runRequests[0]?.workflow.inputEpisodeIds,
      ).toEqual(["episode-prior"]);
      expect(
        smithersBridge.runRequests[0]?.workflow.tasks[0]?.worktreePath,
      ).toBe(worktreePath);
      expect(smithersBridge.runRequests[0]?.worktreePath).toBe(worktreePath);
      expect(result.completion).toEqual({
        isComplete: false,
        reason: "waiting_approval",
      });
      expect(result.state.waiting).toBe(true);
      expect(result.state.visibleSummary).toContain("smithers-workflow");
      expect(result.sessionState.workflowRuns[0]?.runId).toBe("run-smithers");
      expect(result.sessionState.smithersIsolations[0]?.runId).toBe(
        "run-smithers",
      );
      expect(
        result.sessionEntries.map((entry) => entry.message.customType),
      ).toEqual([
        "hellm/thread",
        "hellm/episode",
        "hellm/verification",
        "hellm/alignment",
        "hellm/workflow-run",
        "hellm/smithers-isolation",
      ]);
      expect(result.sessionEntries[0]?.parentId).toBe(priorEntryId ?? null);
      expect(
        result.sessionEntries
          .slice(1)
          .every((entry, index) => entry.parentId === result.sessionEntries[index]?.id),
      ).toBe(true);
      expect(snapshot.thread.worktreePath).toBe(worktreePath);
      expect(snapshot.thread.smithersRunId).toBe("run-smithers");
      expect(snapshot.workflowRuns[0]?.status).toBe("waiting_approval");
      expect(reconstructed.smithersIsolations[0]?.runStateStore).toContain(
        "run-smithers.sqlite",
      );
      expect(snapshot.alignment.activeWorktreePath).toBe(worktreePath);
      expect(snapshot.alignment.aligned).toBe(false);
      expect(snapshot.episodes.at(-1)?.inputEpisodeIds).toEqual(["episode-prior"]);
      const persistedEntries = readSessionFile(sessionFile)
        .filter(isStructuredSessionEntry)
        .slice(-result.sessionEntries.length);
      expect(persistedEntries.map((entry) => entry.id)).toEqual(
        result.sessionEntries.map((entry) => entry.id),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("resumes a smithers workflow from persisted file-backed session state and replaces run records by run id", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree(
        "feature-smithers-resume",
      );
      const sessionFile = workspace.path(".pi/sessions/thread-smithers-resume.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-smithers-resume",
        cwd: workspace.root,
      });

      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: "run-smithers-resume",
          threadId: "thread-smithers-resume",
          workflowId: "workflow:thread-smithers-resume",
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_approval",
        outputs: [],
        approval: {
          nodeId: "approve",
          title: "Approve workflow",
          summary: "Waiting for approval",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "episode-smithers-resume-wait",
          threadId: "thread-smithers-resume",
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: "run-smithers-resume",
          worktreePath,
        }),
        isolation: {
          runId: "run-smithers-resume",
          runStateStore: workspace.path(".smithers/run-smithers-resume-old.sqlite"),
          sessionEntryIds: ["entry-old"],
        },
      });
      smithersBridge.enqueueResumeResult({
        run: {
          runId: "run-smithers-resume",
          threadId: "thread-smithers-resume",
          workflowId: "workflow:thread-smithers-resume",
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [
          {
            nodeId: "pi-task",
            schema: "result",
            value: { approved: true },
          },
        ],
        episode: createEpisodeFixture({
          id: "episode-smithers-resume-done",
          threadId: "thread-smithers-resume",
          source: "smithers",
          status: "completed",
          smithersRunId: "run-smithers-resume",
          worktreePath,
          inputEpisodeIds: ["episode-smithers-resume-wait"],
        }),
        isolation: {
          runId: "run-smithers-resume",
          runStateStore: workspace.path(".smithers/run-smithers-resume-new.sqlite"),
          sessionEntryIds: ["entry-new"],
        },
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        smithersBridge,
        contextLoader: createFilesystemContextLoader({
          sessionFile,
        }),
      });

      const waiting = await orchestrator.run({
        threadId: "thread-smithers-resume",
        prompt: "Run smithers workflow and wait for approval.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "smithers-workflow",
        requireApproval: true,
      });
      harness.appendEntries(waiting.sessionEntries);

      const resumed = await orchestrator.run({
        threadId: "thread-smithers-resume",
        prompt: "Resume smithers workflow.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "smithers-workflow",
        resumeRunId: "run-smithers-resume",
      });
      harness.appendEntries(resumed.sessionEntries);

      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(reconstructed, "thread-smithers-resume");
      const appendedEntries = [...waiting.sessionEntries, ...resumed.sessionEntries];
      const persistedEntries = readSessionFile(sessionFile)
        .filter(isStructuredSessionEntry)
        .slice(-appendedEntries.length);

      expect(waiting.completion).toEqual({
        isComplete: false,
        reason: "waiting_approval",
      });
      expect(resumed.completion).toEqual({
        isComplete: true,
        reason: "completed",
      });
      expect(smithersBridge.runRequests[0]?.path).toBe("smithers-workflow");
      expect(smithersBridge.resumeRequests[0]?.runId).toBe("run-smithers-resume");
      expect(resumed.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        "episode-smithers-resume-wait",
      ]);
      expect(snapshot.thread.status).toBe("completed");
      expect(snapshot.thread.worktreePath).toBe(worktreePath);
      expect(snapshot.thread.smithersRunId).toBe("run-smithers-resume");
      expect(snapshot.workflowRuns).toEqual([
        {
          runId: "run-smithers-resume",
          threadId: "thread-smithers-resume",
          workflowId: "workflow:thread-smithers-resume",
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
          worktreePath,
        },
      ]);
      expect(reconstructed.smithersIsolations).toEqual([
        {
          runId: "run-smithers-resume",
          runStateStore: workspace.path(".smithers/run-smithers-resume-new.sqlite"),
          sessionEntryIds: ["entry-new"],
        },
      ]);
      expect(snapshot.episodes.map((episode) => episode.id)).toEqual([
        "episode-smithers-resume-wait",
        "episode-smithers-resume-done",
      ]);
      expect(snapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
        "episode-smithers-resume-wait",
      ]);
      expect(snapshot.alignment.activeWorktreePath).toBe(worktreePath);
      expect(persistedEntries.map((entry) => entry.id)).toEqual(
        appendedEntries.map((entry) => entry.id),
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("authors a default single pi-task smithers workflow in a linked worktree when no seed tasks are provided", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree(
        "feature-single-subagent",
      );
      const sessionFile = workspace.path(".pi/sessions/thread-smithers-single.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-smithers-single",
        cwd: workspace.root,
      });
      const priorEpisode = createEpisode({
        id: "episode-prior-single",
        threadId: "thread-smithers-single",
        source: "orchestrator",
        objective: "Prior objective",
        status: "completed",
        conclusions: ["Prior episode"],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      });
      harness.append({ kind: "episode", data: priorEpisode });

      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: "run-smithers-single",
          threadId: "thread-smithers-single",
          workflowId: "workflow:thread-smithers-single",
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_approval",
        outputs: [],
        approval: {
          nodeId: "pi-task",
          title: "Approve single delegated step",
          summary: "Waiting for approval before continuing.",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "episode-smithers-single",
          threadId: "thread-smithers-single",
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: "run-smithers-single",
          worktreePath,
          inputEpisodeIds: ["episode-prior-single"],
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        smithersBridge,
        contextLoader: createFilesystemContextLoader({
          sessionFile,
        }),
      });

      const result = await orchestrator.run({
        threadId: "thread-smithers-single",
        prompt: "Implement from the single-subagent fallback.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "smithers-workflow",
        requireApproval: true,
      });

      expect(smithersBridge.runRequests).toHaveLength(1);
      expect(smithersBridge.resumeRequests).toHaveLength(0);
      expect(smithersBridge.runRequests[0]?.workflow.workflowId).toBe(
        "workflow:thread-smithers-single",
      );
      expect(smithersBridge.runRequests[0]?.workflow.inputEpisodeIds).toEqual([
        "episode-prior-single",
      ]);
      expect(smithersBridge.runRequests[0]?.workflow.tasks).toEqual([
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Implement from the single-subagent fallback.",
          agent: "pi",
          needsApproval: true,
          worktreePath,
        },
      ]);
      expect(smithersBridge.runRequests[0]?.worktreePath).toBe(worktreePath);
      expect(result.classification.path).toBe("smithers-workflow");
      expect(result.state.waiting).toBe(true);
      expect(result.state.visibleSummary).toBe(
        "smithers-workflow:waiting_approval:waiting_approval",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("forwards scoped pi worker context and runtime transitions from a file-backed worktree session", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree("feature-pi");
      await workspace.write("AGENTS.md", "Respect AGENTS instructions.\n");
      await workspace.write("skills/fs-skill/SKILL.md", "# fs-skill\n");

      const sessionFile = workspace.path(".pi/sessions/thread-pi.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-pi",
        cwd: workspace.root,
      });
      const priorEpisode = createEpisode({
        id: "episode-prior",
        threadId: "thread-pi",
        source: "orchestrator",
        objective: "Prior objective",
        status: "completed",
        conclusions: ["Prior episode"],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      });
      harness.append({ kind: "episode", data: priorEpisode });
      const expectedSessionHistory = readSessionFile(sessionFile).map((entry) =>
        JSON.stringify(entry),
      );

      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "episode-pi",
          threadId: "thread-pi",
          source: "pi-worker",
          worktreePath,
          inputEpisodeIds: ["episode-prior"],
        }),
        runtimeTransition: {
          reason: "new",
          toSessionId: "thread-pi:pi",
          aligned: false,
          toWorktreePath: worktreePath,
        },
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
        contextLoader: createFilesystemContextLoader({
          sessionFile,
          agentsFile: workspace.path("AGENTS.md"),
          skillsRoot: workspace.path("skills"),
        }),
      });

      const result = await orchestrator.run({
        threadId: "thread-pi",
        prompt: "Run the bounded worker path.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "pi-worker",
      });

      harness.appendEntries(result.sessionEntries);
      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(reconstructed, "thread-pi");

      expect(piBridge.workerRequests[0]?.scopedContext.sessionHistory).not.toHaveLength(
        0,
      );
      expect(piBridge.workerRequests[0]?.scopedContext.sessionHistory).toEqual(
        expectedSessionHistory,
      );
      expect(piBridge.workerRequests[0]?.scopedContext.relevantPaths).toEqual([
        workspace.root,
        worktreePath,
      ]);
      expect(piBridge.workerRequests[0]?.scopedContext.agentsInstructions).toEqual([
        "Respect AGENTS instructions.",
      ]);
      expect(piBridge.workerRequests[0]?.scopedContext.relevantSkills).toEqual([
        "fs-skill",
      ]);
      expect(piBridge.workerRequests[0]?.runtimeTransition).toEqual({
        reason: "new",
        toSessionId: "thread-pi:pi",
        aligned: false,
        toWorktreePath: worktreePath,
      });
      expect(snapshot.thread.kind).toBe("pi-worker");
      expect(snapshot.thread.status).toBe("completed");
      expect(snapshot.thread.worktreePath).toBe(worktreePath);
      expect(snapshot.episodes.at(-1)?.inputEpisodeIds).toEqual(["episode-prior"]);
      expect(snapshot.alignment.activeWorktreePath).toBe(worktreePath);
    } finally {
      await workspace.cleanup();
    }
  });

  it("prefers reconstructed structured prior episodes for input episode IDs over decoy raw transcript entries", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(".pi/sessions/thread-structured-state.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-structured-state",
        cwd: workspace.root,
      });
      const priorEpisodeOne = createEpisode({
        id: "episode-structured-1",
        threadId: "thread-structured-state",
        source: "orchestrator",
        objective: "First structured episode",
        status: "completed",
        conclusions: ["Structured prior one"],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T09:00:00.000Z",
        completedAt: "2026-04-08T09:00:01.000Z",
      });
      const priorEpisodeTwo = createEpisode({
        id: "episode-structured-2",
        threadId: "thread-structured-state",
        source: "orchestrator",
        objective: "Second structured episode",
        status: "completed",
        conclusions: ["Structured prior two"],
        provenance: {
          executionPath: "direct",
          actor: "orchestrator",
        },
        startedAt: "2026-04-08T09:00:02.000Z",
        completedAt: "2026-04-08T09:00:03.000Z",
        inputEpisodeIds: ["episode-structured-1"],
      });
      harness.append({ kind: "episode", data: priorEpisodeOne });
      harness.append({ kind: "episode", data: priorEpisodeTwo });

      const decoyEntries: SessionJsonlEntry[] = [
        {
          type: "message",
          id: "entry-decoy-user",
          parentId: null,
          timestamp: "2026-04-08T09:00:04.000Z",
          message: {
            role: "user",
            content: "Decoy transcript references episode-decoy.",
            timestamp: Date.parse("2026-04-08T09:00:04.000Z"),
          },
        },
        {
          type: "message",
          id: "entry-decoy-assistant",
          parentId: "entry-decoy-user",
          timestamp: "2026-04-08T09:00:05.000Z",
          message: {
            role: "assistant",
            content: '{"inputEpisodeIds":["episode-decoy"]}',
            timestamp: Date.parse("2026-04-08T09:00:05.000Z"),
          },
        },
      ];
      appendFileSync(
        sessionFile,
        `${decoyEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8",
      );

      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "episode-pi-structured-state",
          threadId: "thread-structured-state",
          source: "pi-worker",
          inputEpisodeIds: ["episode-structured-1", "episode-structured-2"],
        }),
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        piBridge,
        contextLoader: createFilesystemContextLoader({
          sessionFile,
        }),
      });

      const result = await orchestrator.run({
        threadId: "thread-structured-state",
        prompt: "Execute bounded worker with reconstructed state.",
        cwd: workspace.root,
        routeHint: "pi-worker",
      });

      harness.appendEntries(result.sessionEntries);
      const snapshot = createThreadSnapshot(
        harness.reconstruct(),
        "thread-structured-state",
      );

      expect(result.context.sessionHistory).toHaveLength(5);
      expect(result.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        "episode-structured-1",
        "episode-structured-2",
      ]);
      expect(
        piBridge.workerRequests[0]?.scopedContext.sessionHistory.some((entry) =>
          entry.includes("\"entry-decoy-user\""),
        ),
      ).toBe(true);
      expect(piBridge.workerRequests[0]?.inputEpisodeIds).toEqual([
        "episode-structured-1",
        "episode-structured-2",
      ]);
      expect(piBridge.workerRequests[0]?.inputEpisodeIds).not.toContain(
        "episode-decoy",
      );
      expect(piBridge.workerRequests[0]?.scopedContext.priorEpisodeIds).toEqual([
        "episode-structured-1",
        "episode-structured-2",
      ]);
      expect(snapshot.episodes.at(-1)?.id).toBe("episode-pi-structured-state");
      expect(snapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
        "episode-structured-1",
        "episode-structured-2",
      ]);
    });
  });

  it("persists thread worktree binding through direct-path reconciliation in a file-backed worktree session", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree("feature-direct");
      const sessionFile = workspace.path(".pi/sessions/thread-direct.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-direct",
        cwd: workspace.root,
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        contextLoader: createFilesystemContextLoader({
          sessionFile,
        }),
      });

      const result = await orchestrator.run({
        threadId: "thread-direct",
        prompt: "Summarize the requested change.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "direct",
      });

      harness.appendEntries(result.sessionEntries);
      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(reconstructed, "thread-direct");

      expect(result.threadSnapshot.thread.worktreePath).toBe(worktreePath);
      expect(result.threadSnapshot.episodes.at(-1)?.worktreePath).toBe(worktreePath);
      expect(result.threadSnapshot.alignment.activeWorktreePath).toBe(worktreePath);
      expect(snapshot.thread.worktreePath).toBe(worktreePath);
      expect(snapshot.episodes.at(-1)?.worktreePath).toBe(worktreePath);
      expect(snapshot.alignment.activeWorktreePath).toBe(worktreePath);
    } finally {
      await workspace.cleanup();
    }
  });

  it("re-enters direct-path reconciliation from persisted file-backed state and preserves worktree plus prior episode inputs", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const threadId = "thread-direct-reenter";
      const worktreePath = await workspace.createLinkedWorktree("feature-direct-reenter");
      const sessionFile = workspace.path(".pi/sessions/thread-direct-reenter.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: threadId,
        cwd: workspace.root,
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        contextLoader: createFilesystemContextLoader({
          sessionFile,
        }),
      });

      const first = await orchestrator.run({
        threadId,
        prompt: "Summarize the first direct request.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "direct",
      });
      harness.appendEntries(first.sessionEntries);

      const lastFirstStructuredEntryId = readSessionFile(sessionFile)
        .filter(isStructuredSessionEntry)
        .at(-1)?.id;
      const firstEpisodeId = first.threadSnapshot.episodes.at(-1)?.id;
      if (!firstEpisodeId) {
        throw new Error("Expected first direct-path run to produce an episode.");
      }

      const second = await orchestrator.run({
        threadId,
        prompt: "Continue from persisted direct-path state.",
        cwd: workspace.root,
        routeHint: "direct",
      });
      harness.appendEntries(second.sessionEntries);
      const snapshot = createThreadSnapshot(harness.reconstruct(), threadId);

      expect(second.context.repoAndWorktree.worktreePath).toBeUndefined();
      expect(second.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        firstEpisodeId,
      ]);
      expect(second.threadSnapshot.thread.worktreePath).toBe(worktreePath);
      expect(second.threadSnapshot.episodes.at(-1)?.worktreePath).toBe(worktreePath);
      expect(second.threadSnapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([
        firstEpisodeId,
      ]);
      expect(second.sessionEntries[0]?.parentId).toBe(
        lastFirstStructuredEntryId ?? null,
      );
      expect(snapshot.thread.worktreePath).toBe(worktreePath);
      expect(snapshot.episodes).toHaveLength(2);
      expect(snapshot.episodes.at(-1)?.inputEpisodeIds).toEqual([firstEpisodeId]);
      expect(snapshot.alignment.activeWorktreePath).toBe(worktreePath);
    } finally {
      await workspace.cleanup();
    }
  });

  it("propagates verification kinds, manual checks, and disk-backed artifacts through reconciliation", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree("feature-verify");
      const sessionFile = workspace.path(".pi/sessions/thread-verify.jsonl");
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-verify",
        cwd: workspace.root,
      });
      const verificationRunner = new FakeVerificationRunner();
      const reportPath = await workspace.write(
        "reports/integration.log",
        "integration passed\n",
      );
      verificationRunner.enqueueResult({
        status: "passed",
        records: [
          createVerificationRecord({
            id: "verification-build",
            kind: "build",
            status: "passed",
            summary: "Build passed",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
          createVerificationRecord({
            id: "verification-manual",
            kind: "manual",
            status: "skipped",
            summary: "Manual check deferred",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        ],
        artifacts: [
          createArtifact({
            id: "artifact-report",
            kind: "log",
            description: "Integration report",
            path: reportPath,
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        ],
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        verificationRunner,
        contextLoader: createFilesystemContextLoader({
          sessionFile,
        }),
      });

      const result = await orchestrator.run({
        threadId: "thread-verify",
        prompt: "Verify the repository state.",
        cwd: workspace.root,
        worktreePath,
        routeHint: "verification",
        workflowSeedInput: {
          verificationKinds: ["build", "manual", "integration"],
          manualChecks: ["Open the app and verify the change."],
        },
      });

      harness.appendEntries(result.sessionEntries);
      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(reconstructed, "thread-verify");

      expect(verificationRunner.calls[0]?.kinds).toEqual([
        "build",
        "manual",
        "integration",
      ]);
      expect(verificationRunner.calls[0]?.manualChecks).toEqual([
        "Open the app and verify the change.",
      ]);
      expect(result.context.relevantSkills).toEqual([]);
      expect(result.threadSnapshot.episodes.at(-1)?.artifacts[0]?.path).toBe(reportPath);
      expect(result.threadSnapshot.thread.worktreePath).toBe(worktreePath);
      expect(result.threadSnapshot.alignment.activeWorktreePath).toBe(worktreePath);
      expect(reconstructed.verification.overallStatus).toBe("unknown");
      expect(reconstructed.verification.byKind.build?.status).toBe("passed");
      expect(reconstructed.verification.byKind.manual?.status).toBe("skipped");
      expect(result.threadSnapshot.thread.status).toBe("completed");
      expect(snapshot.thread.worktreePath).toBe(worktreePath);
      expect(snapshot.alignment.activeWorktreePath).toBe(worktreePath);
    } finally {
      await workspace.cleanup();
    }
  });

  it("persists normalized verification episodes across file-backed re-entry and refreshes global verification state by kind", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionFile = workspace.path(
        ".pi/sessions/thread-verify-normalization.jsonl",
      );
      const harness = new FileBackedSessionJsonlHarness({
        filePath: sessionFile,
        sessionId: "thread-verify-normalization",
        cwd: workspace.root,
      });
      const verificationRunner = new FakeVerificationRunner();
      const failedReportPath = await workspace.write(
        "reports/verification-failed.log",
        "verification failed\n",
      );
      const passedReportPath = await workspace.write(
        "reports/verification-passed.log",
        "verification passed\n",
      );

      verificationRunner.enqueueResult({
        status: "failed",
        records: [
          createVerificationRecord({
            id: "verification-first-build",
            kind: "build",
            status: "passed",
            summary: "Build passed",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
          createVerificationRecord({
            id: "verification-first-test",
            kind: "test",
            status: "failed",
            summary: "Test suite failed",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
          createVerificationRecord({
            id: "verification-first-lint",
            kind: "lint",
            status: "failed",
            summary: "Lint failed",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        ],
        artifacts: [
          createArtifact({
            id: "artifact-verification-failed",
            kind: "log",
            description: "Failed verification report",
            path: failedReportPath,
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        ],
      });
      verificationRunner.enqueueResult({
        status: "passed",
        records: [
          createVerificationRecord({
            id: "verification-second-build",
            kind: "build",
            status: "passed",
            summary: "Build passed on rerun",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
          createVerificationRecord({
            id: "verification-second-test",
            kind: "test",
            status: "passed",
            summary: "Tests passed on rerun",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
          createVerificationRecord({
            id: "verification-second-lint",
            kind: "lint",
            status: "passed",
            summary: "Lint passed on rerun",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        ],
        artifacts: [
          createArtifact({
            id: "artifact-verification-passed",
            kind: "log",
            description: "Passing verification report",
            path: passedReportPath,
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        ],
      });

      const orchestrator = createOrchestrator({
        clock: fixedClock(),
        verificationRunner,
        contextLoader: createFilesystemContextLoader({ sessionFile }),
      });

      const first = await orchestrator.run({
        threadId: "thread-verify-normalization",
        prompt: "Run verification and normalize failures.",
        cwd: workspace.root,
        routeHint: "verification",
      });
      harness.appendEntries(first.sessionEntries);
      const firstEpisode = first.threadSnapshot.episodes.at(-1);

      expect(firstEpisode).toBeDefined();
      expect(firstEpisode?.source).toBe("verification");
      expect(firstEpisode?.status).toBe("completed_with_issues");
      expect(firstEpisode?.unresolvedIssues).toEqual([
        "Test suite failed",
        "Lint failed",
      ]);
      expect(firstEpisode?.followUpSuggestions).toEqual([
        "Resolve the failing verification steps before closing the thread.",
      ]);
      expect(firstEpisode?.provenance).toEqual({
        executionPath: "verification",
        actor: "verification",
        notes: "Normalized verification execution path.",
      });

      const second = await orchestrator.run({
        threadId: "thread-verify-normalization",
        prompt: "Rerun verification after fixes.",
        cwd: workspace.root,
        routeHint: "verification",
      });
      harness.appendEntries(second.sessionEntries);
      const secondEpisode = second.threadSnapshot.episodes.at(-1);
      const firstEpisodeId = firstEpisode?.id;
      const reconstructed = harness.reconstruct();
      const snapshot = createThreadSnapshot(
        reconstructed,
        "thread-verify-normalization",
      );

      expect(verificationRunner.calls).toHaveLength(2);
      expect(verificationRunner.calls[0]?.kinds).toEqual(["build", "test", "lint"]);
      expect(verificationRunner.calls[1]?.kinds).toEqual(["build", "test", "lint"]);
      expect(secondEpisode?.status).toBe("completed");
      expect(secondEpisode?.unresolvedIssues).toEqual([]);
      expect(secondEpisode?.followUpSuggestions).toEqual([]);
      expect(firstEpisodeId).toBeDefined();
      expect(secondEpisode?.inputEpisodeIds).toEqual([firstEpisodeId!]);
      expect(snapshot.episodes.map((episode) => episode.status)).toEqual([
        "completed_with_issues",
        "completed",
      ]);
      expect(snapshot.verification.overallStatus).toBe("passed");
      expect(snapshot.verification.byKind.build?.status).toBe("passed");
      expect(snapshot.verification.byKind.test?.status).toBe("passed");
      expect(snapshot.verification.byKind.lint?.status).toBe("passed");
      expect(snapshot.artifacts.map((artifact) => artifact.path)).toEqual(
        expect.arrayContaining([failedReportPath, passedReportPath]),
      );
    });
  });
});
