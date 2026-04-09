import { basename } from "node:path";
import { describe, expect, it } from "bun:test";
import {
  createEpisode,
  createSessionWorktreeAlignment,
  createThread,
} from "@hellm/session-model";
import {
  FakePiRuntimeBridge,
  FakeSmithersWorkflowBridge,
  FakeVerificationRunner,
  createEpisodeFixture,
  createInteractiveTuiSessionHarness,
  createVerificationFixture,
  fixedClock,
  withTempWorkspace,
} from "../../../test-support/index.ts";

function forceInteractivePath(path: "direct" | "smithers-workflow" | "verification" | "approval") {
  return () => ({
    path,
    confidence: "high" as const,
    reason: `Forced ${path} path for interactive session coverage.`,
  });
}

describe("@hellm/tui interactive session e2e", () => {
  it("refreshes the pi-hosted widget from an empty session via /threads", async () => {
    await withTempWorkspace(async (workspace) => {
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
      });

      try {
        await harness.runCommand("threads");

        expect(harness.notifications.at(-1)?.message).toBe("No threads recorded.");
        expect(harness.widgetText("hellm-state")).toContain("[threads-overview]");
        expect(harness.widgetText("hellm-state")).toContain("no active thread");
        expect(harness.widgetText("hellm-state")).toContain(`[footer]`);
        expect(harness.widgetText("hellm-state")).toContain(`session ${workspace.root}`);
        expect(harness.widgetText("hellm-state")).toContain(`worktree ${workspace.root}`);
        expect(harness.titles.at(-1)).toBe(`hellm • ${basename(workspace.root)}`);
      } finally {
        await harness.dispose();
      }
    });
  });

  it("handles interactive direct input through the pi-hosted runtime and updates session-backed UI state", async () => {
    await withTempWorkspace(async (workspace) => {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "direct-worker-episode",
          threadId: "ignored-by-direct-normalization",
          source: "pi-worker",
          status: "completed",
          conclusions: ["Direct path completed from interactive session."],
        }),
      });
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
        orchestratorOverrides: {
          classifier: forceInteractivePath("direct"),
          piBridge,
          clock: fixedClock(),
        },
      });

      try {
        const result = await harness.emitInput(
          "Explain the workspace contract from the interactive shell.",
        );
        const state = harness.readState();

        expect(result.action).toBe("handled");
        expect(piBridge.workerRequests).toHaveLength(1);
        expect(state.threads).toHaveLength(1);
        expect(state.threads[0]?.kind).toBe("direct");
        expect(state.threads[0]?.status).toBe("completed");
        expect(state.episodes).toHaveLength(1);
        expect(state.episodes[0]?.source).toBe("orchestrator");
        expect(state.episodes[0]?.conclusions).toContain(
          "Direct path completed from interactive session.",
        );
        expect(harness.statuses.at(-1)?.value).toBe("direct:completed");
        expect(harness.notifications.at(-1)?.message).toBe("direct: completed");
        expect(harness.widgetText("hellm-state")).toContain("kind direct");
        expect(harness.widgetText("hellm-state")).toContain("status completed");
        expect(harness.widgetText("hellm-state")).toContain(
          "conclusion Direct path completed from interactive session.",
        );
      } finally {
        await harness.dispose();
      }
    });
  });

  it("reuses the active waiting_input thread for subsequent interactive input instead of creating a new thread", async () => {
    await withTempWorkspace(async (workspace) => {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "waiting_input",
        episode: createEpisodeFixture({
          id: "waiting-input-episode",
          source: "pi-worker",
          status: "waiting_input",
          conclusions: ["Need clarification before continuing."],
        }),
      });
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "completed-after-clarification",
          source: "pi-worker",
          status: "completed",
          conclusions: ["Clarification incorporated."],
        }),
      });
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
        orchestratorOverrides: {
          classifier: forceInteractivePath("direct"),
          piBridge,
          clock: fixedClock(),
        },
      });

      try {
        await harness.emitInput("Need more context before proceeding.");
        const firstState = harness.readState();
        const firstThreadId = firstState.threads[0]?.id;
        expect(firstThreadId).toBeDefined();
        expect(firstState.threads[0]?.status).toBe("waiting_input");

        await harness.emitInput("Here is the missing clarification.");
        const secondState = harness.readState();

        expect(secondState.threads).toHaveLength(1);
        expect(secondState.threads[0]?.id).toBe(firstThreadId);
        expect(secondState.threads[0]?.status).toBe("completed");
        expect(secondState.episodes).toHaveLength(2);
        expect(secondState.episodes.map((episode) => episode.threadId)).toEqual([
          firstThreadId,
          firstThreadId,
        ]);
        expect(harness.widgetText("hellm-state")).toContain(
          "conclusion Clarification incorporated.",
        );
      } finally {
        await harness.dispose();
      }
    });
  });

  it("switches the active thread via /threads <id> and rejects unknown ids without mutating the selection", async () => {
    await withTempWorkspace(async (workspace) => {
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
      });

      try {
        harness.appendStructuredEntry(
          "thread",
          createThread({
            id: "thread-alpha",
            kind: "direct",
            objective: "Alpha thread",
            status: "completed",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        );
        harness.appendStructuredEntry(
          "thread",
          createThread({
            id: "thread-beta",
            kind: "verification",
            objective: "Beta thread",
            status: "running",
            createdAt: "2026-04-08T09:01:00.000Z",
          }),
        );

        await harness.runCommand("threads", "thread-beta");

        expect(harness.notifications.at(-1)?.message).toBe(
          "Active thread: thread-beta",
        );
        expect(harness.widgetText("hellm-state")).toContain(
          "> thread-beta [verification] running (0 episodes)",
        );

        await harness.runCommand("threads", "thread-missing");

        expect(harness.notifications.at(-1)?.message).toBe(
          "Unknown thread: thread-missing",
        );
        expect(harness.notifications.at(-1)?.level).toBe("error");
        expect(harness.widgetText("hellm-state")).toContain(
          "> thread-beta [verification] running (0 episodes)",
        );
      } finally {
        await harness.dispose();
      }
    });
  });

  it("routes /reconcile through the active thread objective by default and accepts an explicit reconcile prompt", async () => {
    await withTempWorkspace(async (workspace) => {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "reconcile-default-objective",
          threadId: "thread-reconcile",
          source: "pi-worker",
          conclusions: ["Reconciled from active thread objective."],
        }),
      });
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "reconcile-explicit-objective",
          threadId: "thread-reconcile",
          source: "pi-worker",
          conclusions: ["Reconciled from explicit slash-command args."],
        }),
      });
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
        orchestratorOverrides: {
          classifier: forceInteractivePath("direct"),
          piBridge,
          clock: fixedClock(),
        },
      });

      try {
        harness.appendStructuredEntry(
          "thread",
          createThread({
            id: "thread-reconcile",
            kind: "direct",
            objective: "Reconcile the active thread objective.",
            status: "waiting_input",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        );

        await harness.runCommand("reconcile");
        await harness.runCommand("reconcile", "Use an explicit reconcile prompt.");

        expect(piBridge.workerRequests).toHaveLength(2);
        expect(piBridge.workerRequests[0]?.thread.id).toBe("thread-reconcile");
        expect(piBridge.workerRequests[0]?.objective).toBe(
          "Reconcile the active thread objective.",
        );
        expect(piBridge.workerRequests[1]?.objective).toBe(
          "Use an explicit reconcile prompt.",
        );
        expect(harness.readState().episodes).toHaveLength(2);
        expect(harness.widgetText("hellm-state")).toContain(
          "conclusion Reconciled from explicit slash-command args.",
        );
      } finally {
        await harness.dispose();
      }
    });
  });

  it("runs /verify against the active thread and surfaces verification state inside the interactive widget", async () => {
    await withTempWorkspace(async (workspace) => {
      const verificationRunner = new FakeVerificationRunner();
      verificationRunner.enqueueResult({
        status: "passed",
        records: [
          createVerificationFixture({
            id: "verify-build",
            kind: "build",
            status: "passed",
            summary: "Build passed from /verify.",
          }),
          createVerificationFixture({
            id: "verify-test",
            kind: "test",
            status: "passed",
            summary: "Tests passed from /verify.",
          }),
        ],
        artifacts: [],
      });
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
        orchestratorOverrides: {
          verificationRunner,
          clock: fixedClock(),
        },
      });

      try {
        harness.appendStructuredEntry(
          "thread",
          createThread({
            id: "thread-verify",
            kind: "direct",
            objective: "Verify the current workspace state.",
            status: "waiting_input",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        );

        await harness.runCommand("verify");
        const state = harness.readState();

        expect(verificationRunner.calls).toHaveLength(1);
        expect(verificationRunner.calls[0]?.objective).toBe(
          "Verify the current workspace state.",
        );
        expect(state.threads[0]?.id).toBe("thread-verify");
        expect(state.threads[0]?.kind).toBe("verification");
        expect(state.threads[0]?.status).toBe("completed");
        expect(state.episodes.at(-1)?.source).toBe("verification");
        expect(harness.statuses.at(-1)?.value).toBe("verification:completed");
        expect(harness.widgetText("hellm-state")).toContain("[verification]");
        expect(harness.widgetText("hellm-state")).toContain(
          "build: passed - Build passed from /verify.",
        );
        expect(harness.widgetText("hellm-state")).toContain(
          "test: passed - Tests passed from /verify.",
        );
      } finally {
        await harness.dispose();
      }
    });
  });

  it("surfaces waiting workflow activity and waiting_approval status inside the interactive session when reconciliation routes to Smithers", async () => {
    await withTempWorkspace(async (workspace) => {
      const smithersBridge = new FakeSmithersWorkflowBridge();
      smithersBridge.enqueueRunResult({
        run: {
          runId: "run-waiting-approval",
          threadId: "thread-workflow",
          workflowId: "workflow:thread-workflow",
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
        },
        status: "waiting_approval",
        outputs: [],
        approval: {
          nodeId: "approve-step",
          title: "Approve workflow step",
          summary: "Needs approval before continuing.",
          mode: "needsApproval",
        },
        episode: createEpisodeFixture({
          id: "workflow-waiting-episode",
          threadId: "thread-workflow",
          source: "smithers",
          status: "waiting_approval",
          smithersRunId: "run-waiting-approval",
          conclusions: ["Workflow paused for approval."],
        }),
      });
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
        orchestratorOverrides: {
          classifier: () => ({
            path: "smithers-workflow",
            confidence: "high",
            reason: "Forced smithers-workflow for interactive session coverage.",
          }),
          smithersBridge,
          clock: fixedClock(),
        },
      });

      try {
        harness.appendStructuredEntry(
          "thread",
          createThread({
            id: "thread-workflow",
            kind: "smithers-workflow",
            objective: "Run a delegated workflow from the interactive shell.",
            status: "running",
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        );

        await harness.runCommand("reconcile");

        expect(smithersBridge.runRequests).toHaveLength(1);
        expect(smithersBridge.runRequests[0]?.thread.id).toBe("thread-workflow");
        expect(harness.statuses.at(-1)?.value).toBe(
          "smithers-workflow:waiting_approval",
        );
        expect(harness.widgetText("hellm-state")).toContain(
          "status waiting_approval",
        );
        expect(harness.widgetText("hellm-state")).toContain(
          "workflow:thread-workflow: waiting_approval (run-waiting-approval)",
        );
      } finally {
        await harness.dispose();
      }
    });
  });

  it("keeps blocked visibility explicit in the interactive widget when the active thread is blocked", async () => {
    await withTempWorkspace(async (workspace) => {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "blocked",
        episode: createEpisodeFixture({
          id: "blocked-direct-episode",
          source: "pi-worker",
          status: "blocked",
          conclusions: ["Blocked on a missing credential."],
          unresolvedIssues: ["Missing credential for the target environment."],
        }),
      });
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
        orchestratorOverrides: {
          classifier: forceInteractivePath("direct"),
          piBridge,
          clock: fixedClock(),
        },
      });

      try {
        await harness.emitInput("Continue even though credentials are missing.");

        expect(harness.statuses.at(-1)?.value).toBe("direct:blocked");
        expect(harness.widgetText("hellm-state")).toContain("status blocked");
        expect(harness.widgetText("hellm-state")).toContain(
          "issue Missing credential for the target environment.",
        );
      } finally {
        await harness.dispose();
      }
    });
  });

  it("renders session and worktree alignment from persisted session-backed entries inside the interactive widget", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("feature-session-ui");
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
      });

      try {
        harness.appendStructuredEntry(
          "thread",
          createThread({
            id: "thread-worktree",
            kind: "direct",
            objective: "Surface worktree alignment in-session.",
            status: "running",
            worktreePath: worktreePath,
            createdAt: "2026-04-08T09:00:00.000Z",
          }),
        );
        harness.appendStructuredEntry(
          "alignment",
          createSessionWorktreeAlignment({
            sessionCwd: workspace.root,
            activeWorktreePath: worktreePath,
          }),
        );

        await harness.runCommand("threads");

        expect(harness.widgetText("hellm-state")).toContain(`session ${workspace.root}`);
        expect(harness.widgetText("hellm-state")).toContain(`worktree ${worktreePath}`);
        expect(harness.widgetText("hellm-state")).toContain("not aligned");
      } finally {
        await harness.dispose();
      }
    });
  });

  it("reconstructs persisted hellm state when a new pi-hosted runtime is opened for the same workspace", async () => {
    await withTempWorkspace(async (workspace) => {
      const piBridge = new FakePiRuntimeBridge();
      piBridge.enqueueResult({
        status: "completed",
        episode: createEpisodeFixture({
          id: "persisted-session-episode",
          source: "pi-worker",
          status: "completed",
          conclusions: ["Persist this thread across runtime restarts."],
        }),
      });
      const firstHarness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
        orchestratorOverrides: {
          classifier: forceInteractivePath("direct"),
          piBridge,
          clock: fixedClock(),
        },
      });

      let threadId: string | undefined;
      let sessionId: string | undefined;

      try {
        await firstHarness.emitInput("Persist this thread across runtime restarts.");
        threadId = firstHarness.readState().threads[0]?.id;
        sessionId = firstHarness.sessionId();
      } finally {
        await firstHarness.dispose();
      }

      const secondHarness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
      });

      try {
        await secondHarness.runCommand("threads");

        expect(secondHarness.sessionId()).toBeDefined();
        expect(secondHarness.readState().threads.map((thread) => thread.id)).toContain(
          threadId,
        );
        expect(secondHarness.widgetText("hellm-state")).toContain(
          "Persist this thread across runtime restarts.",
        );
      } finally {
        await secondHarness.dispose();
      }
    });
  });

  it("shows a dedicated latest-episodes list in the interactive widget when multiple thread episodes exist", async () => {
    await withTempWorkspace(async (workspace) => {
      const harness = await createInteractiveTuiSessionHarness({
        cwd: workspace.root,
      });

      try {
        const threadA = createThread({
          id: "thread-latest-a",
          kind: "direct",
          objective: "Thread A",
          status: "completed",
          createdAt: "2026-04-08T09:00:00.000Z",
        });
        const threadB = createThread({
          id: "thread-latest-b",
          kind: "verification",
          objective: "Thread B",
          status: "completed",
          createdAt: "2026-04-08T09:01:00.000Z",
        });

        harness.appendStructuredEntry("thread", threadA);
        harness.appendStructuredEntry("thread", threadB);
        harness.appendStructuredEntry(
          "episode",
          createEpisode({
            id: "episode-latest-a",
            threadId: threadA.id,
            source: "orchestrator",
            objective: threadA.objective,
            status: "completed",
            conclusions: ["Latest episode from thread A."],
            provenance: {
              executionPath: "direct",
              actor: "orchestrator",
            },
            startedAt: "2026-04-08T09:00:00.000Z",
            completedAt: "2026-04-08T09:02:00.000Z",
          }),
        );
        harness.appendStructuredEntry(
          "episode",
          createEpisode({
            id: "episode-latest-b",
            threadId: threadB.id,
            source: "verification",
            objective: threadB.objective,
            status: "completed_with_issues",
            conclusions: ["Latest episode from thread B."],
            provenance: {
              executionPath: "verification",
              actor: "verification",
            },
            startedAt: "2026-04-08T09:01:00.000Z",
            completedAt: "2026-04-08T09:03:00.000Z",
          }),
        );

        await harness.runCommand("threads");

        expect(harness.widgetText("hellm-state")).toContain("[latest-episodes]");
        expect(harness.widgetText("hellm-state")).toContain("episode-latest-a");
        expect(harness.widgetText("hellm-state")).toContain("episode-latest-b");
      } finally {
        await harness.dispose();
      }
    });
  });
});
