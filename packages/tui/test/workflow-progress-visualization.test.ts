import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  createThreadSnapshot,
  type ThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import {
  FileBackedSessionJsonlHarness,
  runBunModule,
  VirtualTerminalHarness,
  withTempWorkspace,
} from "../../../test-support/index.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../../");
const WORKFLOW_PROGRESS_ENTRY = fileURLToPath(
  new URL("./fixtures/workflow-progress-main.ts", import.meta.url),
);
const TIMESTAMP = "2026-04-08T09:00:00.000Z";

describe("@hellm/tui workflow progress visualization", () => {
  it("renders workflow status updates from reconstructed JSONL session state", async () => {
    await withTempWorkspace(async (workspace) => {
      const sessionCwd = workspace.path("repo");
      const workflowWorktree = await workspace.createWorktree("workflow-progress");
      const sessionHarness = new FileBackedSessionJsonlHarness({
        filePath: workspace.path("sessions/workflow-progress.jsonl"),
        cwd: sessionCwd,
        timestamp: TIMESTAMP,
      });

      const thread = createThread({
        id: "thread-ui-progress",
        kind: "smithers-workflow",
        objective: "Track workflow progress visually",
        status: "running",
        worktreePath: workflowWorktree,
        createdAt: TIMESTAMP,
      });

      sessionHarness.append({ kind: "thread", data: thread }, TIMESTAMP);
      sessionHarness.append(
        {
          kind: "workflow-run",
          data: {
            runId: "run-1",
            threadId: thread.id,
            workflowId: "workflow:thread-ui-progress/running",
            status: "running",
            updatedAt: TIMESTAMP,
            worktreePath: workflowWorktree,
          },
        },
        TIMESTAMP,
      );
      sessionHarness.append(
        {
          kind: "workflow-run",
          data: {
            runId: "run-2",
            threadId: thread.id,
            workflowId: "workflow:thread-ui-progress/waiting-approval",
            status: "waiting_approval",
            updatedAt: TIMESTAMP,
            worktreePath: workflowWorktree,
          },
        },
        TIMESTAMP,
      );
      sessionHarness.append(
        {
          kind: "workflow-run",
          data: {
            runId: "run-3",
            threadId: thread.id,
            workflowId: "workflow:thread-ui-progress/waiting-resume",
            status: "waiting_resume",
            updatedAt: TIMESTAMP,
            worktreePath: workflowWorktree,
          },
        },
        TIMESTAMP,
      );
      sessionHarness.append(
        {
          kind: "workflow-run",
          data: {
            runId: "run-other-thread",
            threadId: "thread-other",
            workflowId: "workflow:other-thread",
            status: "running",
            updatedAt: TIMESTAMP,
          },
        },
        TIMESTAMP,
      );

      const sessionState = sessionHarness.reconstruct();
      const projection = projectThreadSnapshot(
        createThreadSnapshot(sessionState, thread.id),
      );
      const terminal = new VirtualTerminalHarness(120, 24);
      const frame = terminal.render(projection);

      expect(projection.workflowActivity).toEqual([
        "workflow:thread-ui-progress/running: running (run-1)",
        "workflow:thread-ui-progress/waiting-approval: waiting_approval (run-2)",
        "workflow:thread-ui-progress/waiting-resume: waiting_resume (run-3)",
      ]);
      expect(frame).toContain("[workflow]");
      expect(frame).not.toContain("workflow:other-thread: running (run-other-thread)");
    });
  });

  it("shows a fallback workflow line when the thread has no workflow runs", () => {
    const snapshot: ThreadSnapshot = {
      thread: createThread({
        id: "thread-no-runs",
        kind: "direct",
        objective: "No workflow activity should render clearly",
        status: "completed",
        createdAt: TIMESTAMP,
      }),
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [],
    };

    const projection = projectThreadSnapshot(snapshot);
    const terminal = new VirtualTerminalHarness(120, 24);
    const frame = terminal.render(projection);

    expect(projection.workflowActivity).toEqual(["workflow none"]);
    expect(frame).toContain("[workflow]");
    expect(frame).toContain("workflow none");
  });

  it("keeps workflow progress visible under narrow viewport constraints", () => {
    const snapshot: ThreadSnapshot = {
      thread: createThread({
        id: "thread-narrow",
        kind: "smithers-workflow",
        objective: "Long workflow names should truncate safely",
        status: "running",
        createdAt: TIMESTAMP,
      }),
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
      }),
      workflowRuns: [
        {
          runId: "run-narrow",
          threadId: "thread-narrow",
          workflowId:
            "workflow:thread-narrow/very-long-progress-identifier-for-terminal-rendering",
          status: "running",
          updatedAt: TIMESTAMP,
        },
      ],
    };

    const projection = projectThreadSnapshot(snapshot);
    const terminal = new VirtualTerminalHarness(44, 24);
    const frame = terminal.render(projection);
    const workflowLine = frame.find((line) => line.startsWith("workflow:thread-narrow/"));

    expect(projection.workflowActivity[0]?.length).toBeGreaterThan(44);
    expect(workflowLine).toBeDefined();
    expect(workflowLine?.endsWith("...")).toBe(true);
  });

  it("renders workflow progress from the projection-helper process boundary", () => {
    const result = runBunModule({
      entryPath: WORKFLOW_PROGRESS_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(result.stdout).toContain("[workflow-progress] [workflow]");
    expect(result.stdout).toContain(
      "[workflow-progress] workflow:process-boundary/running: running (run-process-1)",
    );
    expect(result.stdout).toContain(
      "[workflow-progress] workflow:process-boundary/waiting-approval: waiting_approval (run-process-2)",
    );
  });
});
