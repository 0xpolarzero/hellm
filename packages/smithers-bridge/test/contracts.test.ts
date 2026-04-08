import { describe, expect, it } from "bun:test";
import {
  authorWorkflow,
  createSmithersWorkflowBridge,
  translateSmithersRunToEpisode,
  type SmithersRunResult,
} from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createArtifactFixture,
  createEpisodeFixture,
  createThreadFixture,
  withTempWorkspace,
  createVerificationFixture,
} from "@hellm/test-support";

const SCOPED_CONTEXT_MARKER = "[[SCOPED_CONTEXT_JSON]]";

interface TaskScopedContextEnvelope {
  taskId: string;
  sessionHistory: string[];
  relevantPaths: string[];
  agentsInstructions: string[];
  relevantSkills: string[];
  priorEpisodeIds: string[];
}

function withScopedContextPrompt(
  prompt: string,
  scopedContext: TaskScopedContextEnvelope,
): string {
  return `${prompt}\n\n${SCOPED_CONTEXT_MARKER}${JSON.stringify(scopedContext)}`;
}

function parseScopedContext(prompt: string): TaskScopedContextEnvelope {
  const markerIndex = prompt.indexOf(SCOPED_CONTEXT_MARKER);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  const payload = prompt.slice(markerIndex + SCOPED_CONTEXT_MARKER.length);
  return JSON.parse(payload) as TaskScopedContextEnvelope;
}

describe("@hellm/smithers-bridge contract surface", () => {
  it("authors deterministic workflow metadata for dynamic plans", () => {
    const thread = createThreadFixture({
      id: "thread-authoring",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/authoring",
    });
    const tasks = [
      {
        id: "task-plan",
        outputKey: "plan",
        prompt: "Plan the migration.",
        agent: "pi" as const,
        retryLimit: 2,
      },
      {
        id: "task-verify",
        outputKey: "verification",
        prompt: "Run verification checks.",
        agent: "verification" as const,
        needsApproval: true,
        worktreePath: "/repo/worktrees/authoring",
      },
    ];

    const workflow = authorWorkflow({
      thread,
      objective: "Run dynamic authoring workflow",
      inputEpisodeIds: ["episode-a", "episode-b"],
      tasks,
    });

    expect(workflow).toEqual({
      workflowId: "workflow:thread-authoring",
      name: "Run dynamic authoring workflow",
      objective: "Run dynamic authoring workflow",
      inputEpisodeIds: ["episode-a", "episode-b"],
      tasks,
    });
  });

  it("ships a default bridge that is explicit about missing implementation", async () => {
    const bridge = createSmithersWorkflowBridge();
    const thread = createThreadFixture({ id: "thread-smithers", kind: "smithers-workflow" });

    await expect(
      bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: "Run workflow",
        cwd: "/repo",
        workflow: authorWorkflow({
          thread,
          objective: "Run workflow",
          inputEpisodeIds: [],
          tasks: [],
        }),
      }),
    ).rejects.toThrow("Not implemented");
  });

  it("surfaces explicit not-implemented errors for approval-gate control methods", async () => {
    const bridge = createSmithersWorkflowBridge();
    const thread = createThreadFixture({
      id: "thread-smithers-approval",
      kind: "smithers-workflow",
    });

    await expect(
      bridge.resumeWorkflow({
        runId: "run-approval",
        thread,
        objective: "Resume workflow",
      }),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.approveRun("run-approval", {
        approved: true,
        decidedBy: "reviewer",
      }),
    ).rejects.toThrow("Not implemented");
    await expect(
      bridge.denyRun("run-approval", {
        approved: false,
        decidedBy: "reviewer",
      }),
    ).rejects.toThrow("Not implemented");
  });

  it("preserves both Smithers approval-gate modes and captures approve/deny decisions in the fake bridge", async () => {
    const bridge = new FakeSmithersWorkflowBridge();
    const thread = createThreadFixture({
      id: "thread-smithers-modes",
      kind: "smithers-workflow",
    });

    const needsApprovalWorkflow = authorWorkflow({
      thread,
      objective: "Gate task output for approval",
      inputEpisodeIds: [],
      tasks: [
        {
          id: "task-needs-approval",
          outputKey: "result",
          prompt: "Implement change and wait for sign-off",
          agent: "pi",
          needsApproval: true,
        },
      ],
    });
    const approvalNodeWorkflow = authorWorkflow({
      thread,
      objective: "Ask for explicit decision node",
      inputEpisodeIds: [],
      tasks: [
        {
          id: "task-approval-node",
          outputKey: "result",
          prompt: "Pause on explicit approval node",
          agent: "pi",
        },
      ],
    });

    bridge.enqueueRunResult({
      run: {
        runId: "run-needs-approval",
        threadId: thread.id,
        workflowId: needsApprovalWorkflow.workflowId,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
      },
      status: "waiting_approval",
      outputs: [],
      approval: {
        nodeId: "task-needs-approval",
        title: "Approve task output",
        summary: "Task is gated by needsApproval.",
        mode: "needsApproval",
      },
      episode: createEpisodeFixture({
        id: "episode-needs-approval",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: "run-needs-approval",
      }),
    });
    bridge.enqueueRunResult({
      run: {
        runId: "run-approval-node",
        threadId: thread.id,
        workflowId: approvalNodeWorkflow.workflowId,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:01:00.000Z",
      },
      status: "waiting_approval",
      outputs: [],
      approval: {
        nodeId: "task-approval-node",
        title: "Approve explicit node",
        summary: "Workflow is paused on an Approval node.",
        mode: "approval-node",
      },
      episode: createEpisodeFixture({
        id: "episode-approval-node",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: "run-approval-node",
      }),
    });

    const needsApprovalResult = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: needsApprovalWorkflow.objective,
      cwd: "/repo",
      workflow: needsApprovalWorkflow,
    });
    await bridge.approveRun("run-needs-approval", {
      approved: true,
      note: "Approved output.",
      decidedAt: "2026-04-08T09:02:00.000Z",
      decidedBy: "maintainer",
    });

    const approvalNodeResult = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: approvalNodeWorkflow.objective,
      cwd: "/repo",
      workflow: approvalNodeWorkflow,
    });
    await bridge.denyRun("run-approval-node", {
      approved: false,
      note: "Denied explicit decision node.",
      decidedAt: "2026-04-08T09:03:00.000Z",
      decidedBy: "maintainer",
    });

    expect(needsApprovalResult.status).toBe("waiting_approval");
    expect(needsApprovalResult.approval?.mode).toBe("needsApproval");
    expect(approvalNodeResult.status).toBe("waiting_approval");
    expect(approvalNodeResult.approval?.mode).toBe("approval-node");
    expect(needsApprovalWorkflow.tasks[0]?.needsApproval).toBe(true);
    expect(approvalNodeWorkflow.tasks[0]?.needsApproval).toBeUndefined();
    expect(bridge.approvals).toEqual([
      {
        runId: "run-needs-approval",
        decision: {
          approved: true,
          note: "Approved output.",
          decidedAt: "2026-04-08T09:02:00.000Z",
          decidedBy: "maintainer",
        },
      },
    ]);
    expect(bridge.denials).toEqual([
      {
        runId: "run-approval-node",
        decision: {
          approved: false,
          note: "Denied explicit decision node.",
          decidedAt: "2026-04-08T09:03:00.000Z",
          decidedBy: "maintainer",
        },
      },
    ]);
    expect(translateSmithersRunToEpisode(needsApprovalResult).id).toBe(
      "episode-needs-approval",
    );
    expect(translateSmithersRunToEpisode(approvalNodeResult).id).toBe(
      "episode-approval-node",
    );
  });

  it("authors deterministic workflow plans and preserves typed outputs, approvals, retries, and worktree state through the fake bridge", async () => {
    const thread = createThreadFixture({
      id: "thread-smithers",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/flow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Run a durable workflow",
      inputEpisodeIds: ["episode-0"],
      tasks: [
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Implement the change",
          agent: "pi",
          needsApproval: true,
          retryLimit: 2,
          worktreePath: thread.worktreePath,
        },
      ],
    });
    const waitingEpisode = createEpisodeFixture({
      id: "episode-waiting",
      threadId: thread.id,
      source: "smithers",
      status: "waiting_approval",
      worktreePath: thread.worktreePath!,
      smithersRunId: "run-1",
    });
    const completedEpisode = createEpisodeFixture({
      id: "episode-complete",
      threadId: thread.id,
      source: "smithers",
      status: "completed",
      worktreePath: thread.worktreePath!,
      smithersRunId: "run-1",
    });
    const waitingResult: SmithersRunResult = {
      run: {
        runId: "run-1",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "waiting_approval",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 1 },
        },
      ],
      episode: waitingEpisode,
      approval: {
        nodeId: "pi-task",
        title: "Approve workflow step",
        summary: "Needs approval before continuing.",
        mode: "needsApproval",
      },
      retryCount: 1,
      isolation: {
        runId: "run-1",
        runStateStore: "/tmp/run-1.sqlite",
        sessionEntryIds: ["entry-1"],
      },
    };
    const resumeResult: SmithersRunResult = {
      run: {
        ...waitingResult.run,
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
      },
      status: "completed",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 2, approved: true },
        },
      ],
      episode: completedEpisode,
      retryCount: 2,
      isolation: waitingResult.isolation,
    };

    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult(waitingResult);
    bridge.enqueueResumeResult(resumeResult);

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
      worktreePath: thread.worktreePath!,
    });
    await bridge.approveRun("run-1", {
      approved: true,
      decidedBy: "tester",
    });
    const resumed = await bridge.resumeWorkflow({
      runId: "run-1",
      thread,
      objective: workflow.objective,
    });

    expect(workflow.inputEpisodeIds).toEqual(["episode-0"]);
    expect(workflow.tasks).toHaveLength(1);
    expect(workflow.tasks[0]?.agent).toBe("pi");
    expect(workflow.tasks[0]?.id).toBe("pi-task");
    expect(first.approval?.nodeId).toBe("pi-task");
    expect(first.retryCount).toBe(1);
    expect(first.run.worktreePath).toBe("/repo/worktrees/flow");
    expect(resumed.outputs[0]?.value).toEqual({ attempt: 2, approved: true });
    expect(bridge.approvals[0]?.runId).toBe("run-1");
    expect(translateSmithersRunToEpisode(resumed).id).toBe("episode-complete");
  });

  it("preserves run identity across waiting_resume and approval-gated resume stages", async () => {
    const thread = createThreadFixture({
      id: "thread-smithers-resume-chain",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/resume-chain",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Resume durable smithers workflow until complete",
      inputEpisodeIds: ["episode-prior"],
      tasks: [
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Continue workflow after persisted pause",
          agent: "pi",
          needsApproval: true,
          retryLimit: 3,
          worktreePath: thread.worktreePath,
        },
      ],
    });
    const runId = "run-resume-chain";
    const waitingResume: SmithersRunResult = {
      run: {
        runId,
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_resume",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "waiting_resume",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 1, phase: "paused" },
        },
      ],
      waitReason: "workflow paused and must be resumed",
      retryCount: 1,
      episode: createEpisodeFixture({
        id: "episode-smithers-waiting-resume",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_input",
        smithersRunId: runId,
        worktreePath: thread.worktreePath!,
      }),
      isolation: {
        runId,
        runStateStore: "/tmp/run-resume-chain-v1.sqlite",
        sessionEntryIds: ["entry-1"],
      },
    };
    const waitingApproval: SmithersRunResult = {
      run: {
        ...waitingResume.run,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:03:00.000Z",
      },
      status: "waiting_approval",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 2, phase: "ready-for-approval" },
        },
      ],
      approval: {
        nodeId: "pi-task",
        title: "Approve resumed workflow",
        summary: "Resumed workflow now needs approval",
        mode: "needsApproval",
      },
      retryCount: 2,
      episode: createEpisodeFixture({
        id: "episode-smithers-waiting-approval",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        smithersRunId: runId,
        worktreePath: thread.worktreePath!,
      }),
      isolation: {
        runId,
        runStateStore: "/tmp/run-resume-chain-v2.sqlite",
        sessionEntryIds: ["entry-1", "entry-2"],
      },
    };
    const completed: SmithersRunResult = {
      run: {
        ...waitingApproval.run,
        status: "completed",
        updatedAt: "2026-04-08T09:05:00.000Z",
      },
      status: "completed",
      outputs: [
        {
          nodeId: "pi-task",
          schema: "result",
          value: { attempt: 3, approved: true, completed: true },
        },
      ],
      retryCount: 3,
      episode: createEpisodeFixture({
        id: "episode-smithers-complete",
        threadId: thread.id,
        source: "smithers",
        status: "completed",
        smithersRunId: runId,
        worktreePath: thread.worktreePath!,
      }),
      isolation: waitingApproval.isolation,
    };

    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult(waitingResume);
    bridge.enqueueResumeResult(waitingApproval);
    bridge.enqueueResumeResult(completed);

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
      worktreePath: thread.worktreePath!,
    });
    const second = await bridge.resumeWorkflow({
      runId,
      thread,
      objective: workflow.objective,
    });
    await bridge.approveRun(runId, { approved: true, decidedBy: "tester" });
    const third = await bridge.resumeWorkflow({
      runId,
      thread,
      objective: workflow.objective,
    });

    expect([first.status, second.status, third.status]).toEqual([
      "waiting_resume",
      "waiting_approval",
      "completed",
    ]);
    expect(first.run.runId).toBe(runId);
    expect(second.run.runId).toBe(runId);
    expect(third.run.runId).toBe(runId);
    expect(second.approval?.nodeId).toBe("pi-task");
    expect(third.outputs[0]?.value).toEqual({
      attempt: 3,
      approved: true,
      completed: true,
    });
    expect(bridge.resumeRequests.map((request) => request.runId)).toEqual([
      runId,
      runId,
    ]);
    expect(bridge.approvals[0]?.runId).toBe(runId);
    expect(first.isolation?.runStateStore).toContain("v1");
    expect(second.isolation?.runStateStore).toContain("v2");
    expect(translateSmithersRunToEpisode(third)).toMatchObject({
      id: "episode-smithers-complete",
      status: "completed",
      smithersRunId: runId,
    });
  });

  it("models a looped retry execution across waiting_resume attempts before completion", async () => {
    const thread = createThreadFixture({
      id: "thread-smithers-retry",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/retry",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Retry until the workflow passes verification",
      inputEpisodeIds: ["episode-before-retry"],
      tasks: [
        {
          id: "retry-task",
          outputKey: "result",
          prompt: "Implement and verify",
          agent: "pi",
          retryLimit: 3,
          worktreePath: thread.worktreePath,
        },
      ],
    });
    const bridge = new FakeSmithersWorkflowBridge();
    bridge.enqueueRunResult({
      run: {
        runId: "run-retry",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_resume",
        updatedAt: "2026-04-08T09:00:00.000Z",
        worktreePath: thread.worktreePath,
      },
      status: "waiting_resume",
      outputs: [
        {
          nodeId: "retry-task",
          schema: "result",
          value: { attempt: 1, passed: false },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-retry-1",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_input",
        smithersRunId: "run-retry",
        worktreePath: thread.worktreePath!,
        followUpSuggestions: ["Retry attempt 1 failed verification; resume run."],
      }),
      waitReason: "Attempt 1 failed verification.",
      retryCount: 1,
    });
    bridge.enqueueResumeResult({
      run: {
        runId: "run-retry",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "waiting_resume",
        updatedAt: "2026-04-08T09:01:00.000Z",
        worktreePath: thread.worktreePath,
      },
      status: "waiting_resume",
      outputs: [
        {
          nodeId: "retry-task",
          schema: "result",
          value: { attempt: 2, passed: false },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-retry-2",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_input",
        smithersRunId: "run-retry",
        worktreePath: thread.worktreePath!,
        followUpSuggestions: ["Retry attempt 2 failed verification; resume run."],
      }),
      waitReason: "Attempt 2 failed verification.",
      retryCount: 2,
    });
    bridge.enqueueResumeResult({
      run: {
        runId: "run-retry",
        threadId: thread.id,
        workflowId: workflow.workflowId,
        status: "completed",
        updatedAt: "2026-04-08T09:02:00.000Z",
        worktreePath: thread.worktreePath,
      },
      status: "completed",
      outputs: [
        {
          nodeId: "retry-task",
          schema: "result",
          value: { attempt: 3, passed: true },
        },
      ],
      episode: createEpisodeFixture({
        id: "episode-retry-3",
        threadId: thread.id,
        source: "smithers",
        status: "completed",
        smithersRunId: "run-retry",
        worktreePath: thread.worktreePath!,
      }),
      retryCount: 3,
    });

    const first = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
      worktreePath: thread.worktreePath!,
    });
    const second = await bridge.resumeWorkflow({
      runId: "run-retry",
      thread,
      objective: workflow.objective,
    });
    const third = await bridge.resumeWorkflow({
      runId: "run-retry",
      thread,
      objective: workflow.objective,
    });

    expect(bridge.runRequests).toHaveLength(1);
    expect(bridge.runRequests[0]?.workflow.tasks[0]?.retryLimit).toBe(3);
    expect(bridge.resumeRequests.map((request) => request.runId)).toEqual([
      "run-retry",
      "run-retry",
    ]);
    expect(first.status).toBe("waiting_resume");
    expect(first.waitReason).toBe("Attempt 1 failed verification.");
    expect(first.retryCount).toBe(1);
    expect(second.status).toBe("waiting_resume");
    expect(second.waitReason).toBe("Attempt 2 failed verification.");
    expect(second.retryCount).toBe(2);
    expect(third.status).toBe("completed");
    expect(third.retryCount).toBe(3);
    expect(third.outputs[0]?.value).toEqual({ attempt: 3, passed: true });
    expect(translateSmithersRunToEpisode(first).id).toBe("episode-retry-1");
    expect(translateSmithersRunToEpisode(second).id).toBe("episode-retry-2");
    expect(translateSmithersRunToEpisode(third).id).toBe("episode-retry-3");
  });

  it("keeps context payloads task-scoped when callers encode them inside per-task prompts", async () => {
    await withTempWorkspace(async (workspace) => {
      const threadWorktreePath = await workspace.createWorktree("thread-scope");
      const taskOneScopePath = await workspace.createWorktree("task-one");
      const taskTwoScopePath = await workspace.createWorktree("task-two");
      const thread = createThreadFixture({
        id: "thread-smithers-scoped-context",
        kind: "smithers-workflow",
        worktreePath: threadWorktreePath,
      });
      const taskOneContext: TaskScopedContextEnvelope = {
        taskId: "pi-task-one",
        sessionHistory: ['{"type":"message","id":"entry-1"}'],
        relevantPaths: [workspace.root, taskOneScopePath],
        agentsInstructions: ["Only inspect task-one files."],
        relevantSkills: ["tests"],
        priorEpisodeIds: ["episode-0"],
      };
      const taskTwoContext: TaskScopedContextEnvelope = {
        taskId: "pi-task-two",
        sessionHistory: ['{"type":"message","id":"entry-2"}'],
        relevantPaths: [workspace.root, taskTwoScopePath],
        agentsInstructions: ["Only inspect task-two files."],
        relevantSkills: ["lint"],
        priorEpisodeIds: ["episode-1"],
      };
      const workflow = authorWorkflow({
        thread,
        objective: "Run scoped workflow",
        inputEpisodeIds: ["episode-0", "episode-1"],
        tasks: [
          {
            id: "pi-task-one",
            outputKey: "result-one",
            prompt: withScopedContextPrompt("Implement task one", taskOneContext),
            agent: "pi",
            worktreePath: threadWorktreePath,
          },
          {
            id: "pi-task-two",
            outputKey: "result-two",
            prompt: withScopedContextPrompt("Implement task two", taskTwoContext),
            agent: "pi",
            worktreePath: threadWorktreePath,
          },
        ],
      });
      const bridge = new FakeSmithersWorkflowBridge();
      bridge.enqueueRunResult({
        run: {
          runId: "run-scoped",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "completed",
          updatedAt: "2026-04-08T10:00:00.000Z",
          worktreePath: threadWorktreePath,
        },
        status: "completed",
        outputs: [],
        episode: createEpisodeFixture({
          id: "episode-scoped",
          threadId: thread.id,
          source: "smithers",
          status: "completed",
          worktreePath: threadWorktreePath,
          smithersRunId: "run-scoped",
        }),
      });

      await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
        worktreePath: threadWorktreePath,
      });

      const submittedWorkflow = bridge.runRequests[0]?.workflow;
      expect(submittedWorkflow?.tasks).toHaveLength(2);
      const submittedTaskOneContext = parseScopedContext(
        submittedWorkflow?.tasks[0]?.prompt ?? "",
      );
      const submittedTaskTwoContext = parseScopedContext(
        submittedWorkflow?.tasks[1]?.prompt ?? "",
      );

      expect(submittedTaskOneContext).toEqual(taskOneContext);
      expect(submittedTaskTwoContext).toEqual(taskTwoContext);
      expect(submittedTaskOneContext.relevantPaths).not.toContain(taskTwoScopePath);
      expect(submittedTaskTwoContext.relevantPaths).not.toContain(taskOneScopePath);
    });
  });

  it("documents the current API gap: WorkflowTaskSpec has no dedicated scopedContext field yet", () => {
    const thread = createThreadFixture({
      id: "thread-smithers-context-gap",
      kind: "smithers-workflow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Capture scoped context contract gap",
      inputEpisodeIds: [],
      tasks: [
        {
          id: "pi-task",
          outputKey: "result",
          prompt: "Context currently rides inside prompt text.",
          agent: "pi",
        },
      ],
    });

    const task = workflow.tasks[0] as Record<string, unknown>;
    expect(task).not.toHaveProperty("scopedContext");
  });

  it("translates smithers run results into episodes without dropping rich episode fields", () => {
    const artifact = createArtifactFixture({
      id: "artifact-smithers-translation",
      kind: "log",
      path: "/repo/.smithers/logs/run-translation.log",
      description: "Smithers workflow execution log",
    });
    const verification = createVerificationFixture({
      id: "verification-smithers-translation",
      kind: "integration",
      status: "failed",
      summary: "Integration checks failed in workflow sandbox.",
      artifactIds: [artifact.id],
    });
    const translatedEpisode = createEpisodeFixture({
      id: "episode-smithers-translation",
      threadId: "thread-smithers-translation",
      source: "smithers",
      status: "completed_with_issues",
      objective: "Translate smithers run output to a reusable episode.",
      conclusions: ["Workflow completed with known integration failures."],
      changedFiles: ["packages/orchestrator/src/index.ts"],
      artifacts: [artifact],
      verification: [verification],
      unresolvedIssues: ["Integration test flakes in linux-arm64 container."],
      followUpSuggestions: ["Re-run integration verification after dependency bump."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
        sourceRef: "workflow:thread-smithers-translation/task-verify",
        notes: "Translated from smithers workflow run output.",
      },
      smithersRunId: "run-translation",
      worktreePath: "/repo/.worktrees/feature-translation",
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:05:00.000Z",
      inputEpisodeIds: ["episode-prior-a", "episode-prior-b"],
    });
    const runResult: SmithersRunResult = {
      run: {
        runId: "run-translation",
        threadId: "thread-smithers-translation",
        workflowId: "workflow:thread-smithers-translation",
        status: "failed",
        updatedAt: "2026-04-08T09:06:00.000Z",
        worktreePath: "/repo/.worktrees/feature-translation",
      },
      status: "failed",
      outputs: [
        {
          nodeId: "task-verify",
          schema: "verification",
          value: {
            failedKinds: ["integration"],
            artifactId: artifact.id,
          },
        },
      ],
      waitReason: "manual-inspection-required",
      retryCount: 3,
      episode: translatedEpisode,
    };

    const episode = translateSmithersRunToEpisode(runResult);

    expect(episode).toEqual(translatedEpisode);
    expect(episode.status).toBe("completed_with_issues");
    expect(episode.artifacts).toEqual([artifact]);
    expect(episode.verification).toEqual([verification]);
    expect(episode.smithersRunId).toBe("run-translation");
    expect(episode.inputEpisodeIds).toEqual([
      "episode-prior-a",
      "episode-prior-b",
    ]);
    expect(episode.followUpSuggestions).toEqual([
      "Re-run integration verification after dependency bump.",
    ]);
  });

  it("keeps a smithers-supplied normalized episode unchanged during translation", () => {
    const thread = createThreadFixture({
      id: "thread-smithers-normalization",
      kind: "smithers-workflow",
      worktreePath: "/repo/worktrees/episode-normalization",
    });
    const episode = createEpisodeFixture({
      id: "episode-smithers-normalized",
      threadId: thread.id,
      source: "smithers",
      status: "completed_with_issues",
      conclusions: ["Workflow run completed with follow-up work."],
      changedFiles: ["packages/cli/src/index.ts"],
      artifacts: [
        createArtifactFixture({
          id: "artifact-smithers-log",
          kind: "log",
          path: "/repo/worktrees/episode-normalization/logs/run.log",
          description: "Smithers workflow log",
        }),
      ],
      verification: [
        createVerificationFixture({
          id: "verification-smithers-test",
          kind: "test",
          status: "failed",
          summary: "A single contract assertion is still failing.",
        }),
      ],
      unresolvedIssues: ["Resolve the remaining failing assertion before merge."],
      followUpSuggestions: ["Run targeted smithers normalization tests after fix."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
        sourceRef: "smithers://run-smithers-normalization",
        notes: "Episode came from a durable smithers workflow run.",
      },
      smithersRunId: "run-smithers-normalization",
      worktreePath: thread.worktreePath!,
      startedAt: "2026-04-08T09:00:00.000Z",
      completedAt: "2026-04-08T09:04:00.000Z",
      inputEpisodeIds: ["episode-prior-normalization"],
    });
    const runResult: SmithersRunResult = {
      run: {
        runId: "run-smithers-normalization",
        threadId: thread.id,
        workflowId: `workflow:${thread.id}`,
        status: "waiting_approval",
        updatedAt: "2026-04-08T09:04:00.000Z",
        worktreePath: thread.worktreePath!,
      },
      status: "waiting_approval",
      outputs: [],
      episode,
      approval: {
        nodeId: "approve-normalized",
        title: "Approval not yet applied to run metadata",
        summary: "Run state can lag episode translation in tests.",
        mode: "approval-node",
      },
    };

    const translated = translateSmithersRunToEpisode(runResult);

    expect(translated).toBe(episode);
    expect(translated.status).toBe("completed_with_issues");
    expect(translated.smithersRunId).toBe("run-smithers-normalization");
    expect(translated.worktreePath).toBe(thread.worktreePath);
    expect(translated.inputEpisodeIds).toEqual(["episode-prior-normalization"]);
    expect(translated.artifacts[0]?.id).toBe("artifact-smithers-log");
    expect(translated.verification[0]?.id).toBe("verification-smithers-test");
  });

  it.todo(
    "adds a first-class `scopedContext` object on smithers workflow pi-agent tasks so orchestrator context is structured instead of prompt-encoded",
    () => {},
  );

  it.todo(
    "pi-agent tasks inside smithers carry explicit scoped context from the orchestrator without assuming Slate internals",
    () => {},
  );
  it.todo(
    "pi-agent tasks inside smithers carry explicit tool scoping for bounded execution",
    () => {},
  );
  it.todo(
    "pi-agent tasks inside smithers carry explicit completion conditions for episode handoff",
    () => {},
  );
  it.todo(
    "concrete smithers bridge execution enforces retryLimit exhaustion behavior without rerunning already completed workflow nodes",
    () => {},
  );
});
