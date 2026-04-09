import { describe, expect, it } from "bun:test";
import {
  THREAD_STATUS_TRANSITIONS,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  type ThreadSnapshot,
  type ThreadStatus,
  type WorkflowRunReference,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import { VirtualTerminalHarness } from "../../../test-support/index.ts";

const TIMESTAMP = "2026-04-08T09:00:00.000Z";
const THREAD_STATUSES = Object.keys(THREAD_STATUS_TRANSITIONS) as ThreadStatus[];
const WORKFLOW_RUN_STATUSES: WorkflowRunReference["status"][] = [
  "running",
  "waiting_approval",
  "waiting_resume",
  "completed",
  "failed",
  "cancelled",
];

function buildWorkflowRun(
  threadId: string,
  status: WorkflowRunReference["status"],
): WorkflowRunReference {
  return {
    runId: `run-${status}`,
    threadId,
    workflowId: `workflow:${threadId}`,
    status,
    updatedAt: TIMESTAMP,
    worktreePath: `/repo/worktrees/${threadId}`,
  };
}

function buildSnapshot(input: {
  threadStatus: ThreadStatus;
  workflowRuns?: WorkflowRunReference[];
}): ThreadSnapshot {
  const threadId = "thread-workstream";
  const thread = createThread({
    id: threadId,
    kind: "smithers-workflow",
    objective: "Keep workstream status visible in the TUI.",
    status: input.threadStatus,
    worktreePath: `/repo/worktrees/${threadId}`,
    createdAt: TIMESTAMP,
  });

  return {
    thread,
    episodes: [],
    artifacts: [],
    verification: createGlobalVerificationState(),
    alignment: createSessionWorktreeAlignment({
      sessionCwd: "/repo",
      activeWorktreePath: `/repo/worktrees/${threadId}`,
    }),
    workflowRuns: input.workflowRuns ?? [],
  };
}

describe("@hellm/tui workstream status visibility", () => {
  it("renders every thread lifecycle status in both projection and viewport", () => {
    const terminal = new VirtualTerminalHarness(120, 24);

    for (const status of THREAD_STATUSES) {
      const projection = projectThreadSnapshot(
        buildSnapshot({
          threadStatus: status,
        }),
      );
      const viewport = terminal.render(projection);

      expect(projection.threadsPane).toContain(`status ${status}`);
      expect(viewport).toContain(`status ${status}`);
    }
  });

  it("renders every workflow run status in both projection and viewport", () => {
    const terminal = new VirtualTerminalHarness(120, 24);

    for (const status of WORKFLOW_RUN_STATUSES) {
      const run = buildWorkflowRun("thread-workstream", status);
      const projection = projectThreadSnapshot(
        buildSnapshot({
          threadStatus: "running",
          workflowRuns: [run],
        }),
      );
      const viewport = terminal.render(projection);
      const expectedLine = `${run.workflowId}: ${status} (${run.runId})`;

      expect(projection.workflowActivity).toContain(expectedLine);
      expect(viewport).toContain(expectedLine);
    }
  });

  it("keeps thread and workflow statuses visible when they differ", () => {
    const run = buildWorkflowRun("thread-workstream", "waiting_resume");
    const projection = projectThreadSnapshot(
      buildSnapshot({
        threadStatus: "blocked",
        workflowRuns: [run],
      }),
    );
    const viewport = new VirtualTerminalHarness(120, 24).render(projection);

    expect(viewport).toContain("status blocked");
    expect(viewport).toContain("workflow:thread-workstream: waiting_resume (run-waiting_resume)");
  });

  it("renders explicit workflow none when no workflow run is active", () => {
    const projection = projectThreadSnapshot(
      buildSnapshot({
        threadStatus: "completed",
      }),
    );
    const viewport = new VirtualTerminalHarness(120, 24).render(projection);

    expect(projection.workflowActivity).toEqual(["workflow none"]);
    expect(viewport).toContain("workflow none");
  });
});
