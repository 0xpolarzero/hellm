import { existsSync, readdirSync, readFileSync } from "node:fs";
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

describe("@hellm/orchestrator filesystem and worktree integration", () => {
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
      expect(snapshot.thread.worktreePath).toBe(worktreePath);
      expect(snapshot.thread.smithersRunId).toBe("run-smithers");
      expect(snapshot.workflowRuns[0]?.status).toBe("waiting_approval");
      expect(reconstructed.smithersIsolations[0]?.runStateStore).toContain(
        "run-smithers.sqlite",
      );
      expect(snapshot.alignment.activeWorktreePath).toBe(worktreePath);
      expect(snapshot.alignment.aligned).toBe(false);
      expect(snapshot.episodes.at(-1)?.inputEpisodeIds).toEqual(["episode-prior"]);
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

  it("propagates verification kinds, manual checks, and disk-backed artifacts through reconciliation", async () => {
    await withTempWorkspace(async (workspace) => {
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
        routeHint: "verification",
        workflowSeedInput: {
          verificationKinds: ["build", "manual", "integration"],
          manualChecks: ["Open the app and verify the change."],
        },
      });

      harness.appendEntries(result.sessionEntries);
      const reconstructed = harness.reconstruct();

      expect(verificationRunner.calls[0]?.kinds).toEqual([
        "build",
        "manual",
        "integration",
      ]);
      expect(verificationRunner.calls[0]?.manualChecks).toEqual([
        "Open the app and verify the change.",
      ]);
      expect(result.threadSnapshot.episodes.at(-1)?.artifacts[0]?.path).toBe(reportPath);
      expect(reconstructed.verification.overallStatus).toBe("unknown");
      expect(reconstructed.verification.byKind.build?.status).toBe("passed");
      expect(reconstructed.verification.byKind.manual?.status).toBe("skipped");
      expect(result.threadSnapshot.thread.status).toBe("completed");
    });
  });
});
