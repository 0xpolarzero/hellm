import { describe, expect, it } from "bun:test";
import { createOrchestrator } from "@hellm/orchestrator";
import { createEmptySessionState } from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  FileBackedSessionJsonlHarness,
  createEpisodeFixture,
  createVerificationFixture,
  fixedClock,
  withTempWorkspace,
} from "@hellm/test-support";

function createVisibleStateOrchestrator(
  dependencies: Parameters<typeof createOrchestrator>[0] = {},
) {
  return createOrchestrator({
    ...dependencies,
    clock: fixedClock(),
    contextLoader: {
      async load(request) {
        return {
          sessionHistory: [],
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
}

describe("@hellm/orchestrator visible state", () => {
  it("reports direct execution as a completed visible summary without waiting or blocked flags", async () => {
    const orchestrator = createVisibleStateOrchestrator();
    const result = await orchestrator.run({
      threadId: "visible-direct",
      prompt: "Describe visible state.",
      cwd: "/repo",
      routeHint: "direct",
    });

    expect(result.state.visibleSummary).toBe("direct:completed:completed");
    expect(result.state.waiting).toBe(false);
    expect(result.state.blocked).toBe(false);
  });

  it("reports verification failures as completed thread state with completed_with_issues episode state", async () => {
    const verificationRunner = new FakeVerificationRunner();
    verificationRunner.enqueueResult({
      status: "failed",
      records: [
        createVerificationFixture({
          id: "verification-visible-failed",
          kind: "build",
          status: "failed",
          summary: "Build failed",
        }),
      ],
      artifacts: [],
    });

    const orchestrator = createVisibleStateOrchestrator({ verificationRunner });
    const result = await orchestrator.run({
      threadId: "visible-verification",
      prompt: "Verify this branch.",
      cwd: "/repo",
      routeHint: "verification",
    });

    expect(result.state.visibleSummary).toBe(
      "verification:completed:completed_with_issues",
    );
    expect(result.state.waiting).toBe(false);
    expect(result.state.blocked).toBe(false);
  });

  it("distinguishes waiting_input from waiting_approval in visible state", async () => {
    const orchestrator = createVisibleStateOrchestrator();

    const waitingInput = await orchestrator.run({
      threadId: "visible-waiting-input",
      prompt: "Need clarification before proceeding.",
      cwd: "/repo",
      routeHint: "approval",
    });
    const waitingApproval = await orchestrator.run({
      threadId: "visible-waiting-approval",
      prompt: "Approve this change.",
      cwd: "/repo",
      routeHint: "approval",
      requireApproval: true,
    });

    expect(waitingInput.state.visibleSummary).toBe(
      "approval:waiting_input:waiting_input",
    );
    expect(waitingInput.state.waiting).toBe(true);
    expect(waitingInput.state.blocked).toBe(false);
    expect(waitingApproval.state.visibleSummary).toBe(
      "approval:waiting_approval:waiting_approval",
    );
    expect(waitingApproval.state.waiting).toBe(true);
    expect(waitingApproval.state.blocked).toBe(false);
  });

  it("marks smithers blocked runs as blocked visible state while preserving workflow run visibility", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "visible-smithers-blocked",
        threadId: "visible-smithers",
        workflowId: "workflow:visible-smithers",
        status: "failed",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "blocked",
      outputs: [],
      episode: createEpisodeFixture({
        id: "visible-smithers-blocked-episode",
        threadId: "visible-smithers",
        source: "smithers",
        status: "blocked",
        smithersRunId: "visible-smithers-blocked",
      }),
    });

    const orchestrator = createVisibleStateOrchestrator({ smithersBridge });
    const result = await orchestrator.run({
      threadId: "visible-smithers",
      prompt: "Run delegated workflow.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
    });

    expect(result.state.visibleSummary).toBe("smithers-workflow:blocked:blocked");
    expect(result.state.waiting).toBe(false);
    expect(result.state.blocked).toBe(true);
    expect(result.state.workflowRuns.map((run) => run.runId)).toEqual([
      "visible-smithers-blocked",
    ]);
  });

  it("updates visible summary when smithers run transitions from waiting approval to completed on resume", async () => {
    const smithersBridge = new FakeSmithersWorkflowBridge();
    smithersBridge.enqueueRunResult({
      run: {
        runId: "visible-smithers-resume",
        threadId: "visible-smithers-resume-thread",
        workflowId: "workflow:visible-smithers-resume-thread",
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "waiting_approval",
      outputs: [],
      approval: {
        nodeId: "approve-visible",
        title: "Approve visible transition",
        summary: "Waiting for approval",
        mode: "needsApproval",
      },
      episode: createEpisodeFixture({
        id: "visible-smithers-waiting",
        threadId: "visible-smithers-resume-thread",
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: "visible-smithers-resume",
      }),
    });
    smithersBridge.enqueueResumeResult({
      run: {
        runId: "visible-smithers-resume",
        threadId: "visible-smithers-resume-thread",
        workflowId: "workflow:visible-smithers-resume-thread",
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
      },
      status: "completed",
      outputs: [],
      episode: createEpisodeFixture({
        id: "visible-smithers-completed",
        threadId: "visible-smithers-resume-thread",
        source: "smithers",
        status: "completed",
        smithersRunId: "visible-smithers-resume",
      }),
    });

    const orchestrator = createVisibleStateOrchestrator({ smithersBridge });
    const first = await orchestrator.run({
      threadId: "visible-smithers-resume-thread",
      prompt: "Start workflow.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      requireApproval: true,
    });
    const second = await orchestrator.run({
      threadId: "visible-smithers-resume-thread",
      prompt: "Resume workflow.",
      cwd: "/repo",
      routeHint: "smithers-workflow",
      resumeRunId: "visible-smithers-resume",
    });

    expect(first.state.visibleSummary).toBe(
      "smithers-workflow:waiting_approval:waiting_approval",
    );
    expect(first.state.waiting).toBe(true);
    expect(first.state.blocked).toBe(false);
    expect(second.state.visibleSummary).toBe("smithers-workflow:completed:completed");
    expect(second.state.waiting).toBe(false);
    expect(second.state.blocked).toBe(false);
  });

  it("maps failed and cancelled worker episodes to non-waiting visible summaries", async () => {
    const cases = [
      {
        name: "failed",
        workerStatus: "failed" as const,
        episodeStatus: "failed" as const,
        expectedThreadStatus: "failed",
      },
      {
        name: "cancelled",
        workerStatus: "completed" as const,
        episodeStatus: "cancelled" as const,
        expectedThreadStatus: "cancelled",
      },
    ];

    for (const entry of cases) {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: entry.workerStatus,
        episode: createEpisodeFixture({
          id: `visible-${entry.name}-episode`,
          threadId: `visible-${entry.name}`,
          source: "pi-worker",
          status: entry.episodeStatus,
        }),
      });

      const orchestrator = createVisibleStateOrchestrator({ piBridge });
      const result = await orchestrator.run({
        threadId: `visible-${entry.name}`,
        prompt: `Run ${entry.name} worker path.`,
        cwd: "/repo",
        routeHint: "pi-worker",
      });

      expect(result.threadSnapshot.thread.status).toBe(entry.expectedThreadStatus);
      expect(result.state.visibleSummary).toBe(
        `pi-worker:${entry.episodeStatus}:${entry.episodeStatus}`,
      );
      expect(result.state.waiting).toBe(false);
      expect(result.state.blocked).toBe(false);
    }
  });

  it("reconstructs session JSONL state across orchestrator instances and updates visible state on smithers resume", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadId = "visible-smithers-jsonl-resume";
      const harness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path(".pi/sessions/visible-smithers-jsonl-resume.jsonl"),
        sessionId: threadId,
        cwd: workspace.root,
      });

      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: "visible-smithers-jsonl-run",
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        status: "waiting_approval",
        outputs: [],
        approval: {
          nodeId: "approve-jsonl-visible",
          title: "Approve JSONL resume",
          summary: "Waiting for approval before resume",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "visible-smithers-jsonl-waiting-episode",
          threadId,
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: "visible-smithers-jsonl-run",
        }),
      });
      smithersBridge.enqueueResumeResult({
        run: {
          runId: "visible-smithers-jsonl-run",
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "visible-smithers-jsonl-completed-episode",
          threadId,
          source: "smithers",
          status: "completed",
          smithersRunId: "visible-smithers-jsonl-run",
        }),
      });

      const createFileBackedOrchestrator = () =>
        createOrchestrator({
          clock: fixedClock(),
          smithersBridge,
          contextLoader: {
            async load(request) {
              const state = harness.reconstruct();
              return {
                sessionHistory: harness.lines(),
                repoAndWorktree: { cwd: request.cwd },
                agentsInstructions: [],
                relevantSkills: [],
                priorEpisodes: state.episodes,
                priorArtifacts: state.artifacts,
                state,
              };
            },
          },
        });

      const first = await createFileBackedOrchestrator().run({
        threadId,
        prompt: "Start workflow and wait for approval.",
        cwd: workspace.root,
        routeHint: "smithers-workflow",
        requireApproval: true,
      });
      harness.appendEntries(first.sessionEntries);

      const second = await createFileBackedOrchestrator().run({
        threadId,
        prompt: "Resume workflow after approval.",
        cwd: workspace.root,
        routeHint: "smithers-workflow",
        resumeRunId: "visible-smithers-jsonl-run",
      });

      expect(first.state.visibleSummary).toBe(
        "smithers-workflow:waiting_approval:waiting_approval",
      );
      expect(second.context.priorEpisodes.map((episode) => episode.id)).toEqual([
        "visible-smithers-jsonl-waiting-episode",
      ]);
      expect(second.state.visibleSummary).toBe("smithers-workflow:completed:completed");
      expect(second.state.waiting).toBe(false);
      expect(second.state.blocked).toBe(false);
      expect(second.state.workflowRuns).toEqual([
        {
          runId: "visible-smithers-jsonl-run",
          threadId,
          workflowId: `workflow:${threadId}`,
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
        },
      ]);
    });
  });
});
