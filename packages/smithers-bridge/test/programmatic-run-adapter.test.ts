import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";
import { chmod, readFile } from "node:fs/promises";
import {
  authorWorkflow,
  createSmithersWorkflowBridge,
} from "@hellm/smithers-bridge";
import {
  FakeSmithersWorkflowBridge,
  createEpisodeFixture,
  createThreadFixture,
  runBunModule,
  withTempWorkspace,
} from "@hellm/test-support";

describe("smithers.programmaticRunAdapter", () => {
  it("exposes an enabled default adapter that attempts CLI execution and returns structured failure when the CLI is unavailable", async () => {
    const bridge = createSmithersWorkflowBridge({
      smithersBinary: "nonexistent-smithers-binary-for-testing",
    });
    const thread = createThreadFixture({
      id: "adapter-default-thread",
      kind: "smithers-workflow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Default adapter behavior",
      inputEpisodeIds: [],
      tasks: [],
    });

    expect(bridge.enabled).toBe(true);
    expect(bridge.engine).toBe("smithers");

    const result = await bridge.runWorkflow({
      path: "smithers-workflow",
      thread,
      objective: workflow.objective,
      cwd: "/repo",
      workflow,
    });
    expect(result.status).toBe("failed");
    expect(result.episode.source).toBe("smithers");

    const resumeResult = await bridge.resumeWorkflow({
      runId: "adapter-default-run",
      thread,
      objective: workflow.objective,
    });
    expect(resumeResult.status).toBe("failed");
    expect(resumeResult.episode.source).toBe("smithers");

    await expect(
      bridge.approveRun("adapter-default-run", { approved: true }),
    ).rejects.toThrow("Executable not found in $PATH");
    await expect(
      bridge.denyRun("adapter-default-run", { approved: false }),
    ).rejects.toThrow("Executable not found in $PATH");
  });

  it("propagates real worktree paths and durable run state through the fake adapter request queues", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("feature-adapter");
      const thread = createThreadFixture({
        id: "adapter-fake-thread",
        kind: "smithers-workflow",
        worktreePath,
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Run fake adapter flow",
        inputEpisodeIds: ["episode-previous"],
        tasks: [
          {
            id: "pi-task",
            outputKey: "result",
            prompt: "Implement in worktree",
            agent: "pi",
            worktreePath,
          },
        ],
      });
      const runEpisode = createEpisodeFixture({
        id: "adapter-run-episode",
        threadId: thread.id,
        source: "smithers",
        status: "waiting_approval",
        worktreePath,
        smithersRunId: "adapter-fake-run",
      });
      const resumeEpisode = createEpisodeFixture({
        id: "adapter-resume-episode",
        threadId: thread.id,
        source: "smithers",
        status: "completed",
        worktreePath,
        smithersRunId: "adapter-fake-run",
      });

      const bridge = new FakeSmithersWorkflowBridge();
      bridge.enqueueRunResult({
        run: {
          runId: "adapter-fake-run",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "waiting_approval",
          updatedAt: "2026-04-08T09:00:00.000Z",
          worktreePath,
        },
        status: "waiting_approval",
        outputs: [],
        episode: runEpisode,
        approval: {
          nodeId: "pi-task",
          title: "Approve run",
          summary: "Approve before resume",
          mode: "needsApproval",
        },
        isolation: {
          runId: "adapter-fake-run",
          runStateStore: workspace.path(".smithers/adapter-fake-run.sqlite"),
          sessionEntryIds: ["entry-1"],
        },
      });
      bridge.enqueueResumeResult({
        run: {
          runId: "adapter-fake-run",
          threadId: thread.id,
          workflowId: workflow.workflowId,
          status: "completed",
          updatedAt: "2026-04-08T09:05:00.000Z",
          worktreePath,
        },
        status: "completed",
        outputs: [],
        episode: resumeEpisode,
      });

      const first = await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
        worktreePath,
      });
      await bridge.approveRun("adapter-fake-run", { approved: true });
      await bridge.denyRun("adapter-fake-run", { approved: false });
      const resumed = await bridge.resumeWorkflow({
        runId: "adapter-fake-run",
        thread,
        objective: workflow.objective,
      });

      expect(bridge.runRequests[0]?.worktreePath).toBe(worktreePath);
      expect(bridge.runRequests[0]?.workflow.tasks[0]?.worktreePath).toBe(
        worktreePath,
      );
      expect(bridge.runRequests[0]?.workflow.inputEpisodeIds).toEqual([
        "episode-previous",
      ]);
      expect(first.isolation?.runStateStore).toContain(
        "adapter-fake-run.sqlite",
      );
      expect(bridge.approvals).toEqual([
        { runId: "adapter-fake-run", decision: { approved: true } },
      ]);
      expect(bridge.denials).toEqual([
        { runId: "adapter-fake-run", decision: { approved: false } },
      ]);
      expect(bridge.resumeRequests[0]?.runId).toBe("adapter-fake-run");
      expect(resumed.episode.id).toBe("adapter-resume-episode");
    });
  });

  it("returns deterministic queue-empty errors from the fake adapter for run and resume", async () => {
    const bridge = new FakeSmithersWorkflowBridge();
    const thread = createThreadFixture({
      id: "adapter-queue-errors",
      kind: "smithers-workflow",
    });
    const workflow = authorWorkflow({
      thread,
      objective: "Queue validation",
      inputEpisodeIds: [],
      tasks: [],
    });

    await expect(
      bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: "/repo",
        workflow,
      }),
    ).rejects.toThrow("No queued fake Smithers run result.");
    await expect(
      bridge.resumeWorkflow({
        runId: "missing-resume",
        thread,
        objective: workflow.objective,
      }),
    ).rejects.toThrow("No queued fake Smithers resume result.");
  });

  it("holds the production adapter contract through a real Bun process boundary", () => {
    const entryPath = resolve(import.meta.dir, "fixtures/default-bridge-smoke.ts");
    const repoRoot = resolve(import.meta.dir, "../../../");
    const result = runBunModule({
      entryPath,
      cwd: repoRoot,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    const output = JSON.parse(result.stdout);
    expect(output.engine).toBe("smithers");
    expect(output.enabled).toBe(true);
    expect(output.runStatus).toBe("failed");
    expect(output.resumeStatus).toBe("failed");
    expect(output.errors).toHaveLength(2);
    expect(output.errors[0]).toContain("Executable not found in $PATH");
    expect(output.errors[1]).toContain("Executable not found in $PATH");
  });

  it("persists run cwd before waiting states so resume always executes in the original run cwd", async () => {
    await withTempWorkspace(async (workspace) => {
      const capturePath = workspace.path("resume-cwd-contract.json");
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const runIdIndex = argv.indexOf("--run-id");
const resume = argv.includes("--resume");
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : "missing-run-id";
if (!resume) {
  console.log(JSON.stringify({ status: "waiting_resume", runId }));
  process.exit(0);
}
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  cwd: process.cwd(),
  runId,
  argv,
}));
console.log(JSON.stringify({ status: "completed", runId }));
`,
      );
      await chmod(workspace.path("bin/smithers"), 0o755);

      const bridge = createSmithersWorkflowBridge({
        smithersBinary: workspace.path("bin/smithers"),
      });
      const thread = createThreadFixture({
        id: "resume-cwd-thread",
        kind: "smithers-workflow",
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Persist run cwd across waiting states",
        inputEpisodeIds: [],
        tasks: [
          {
            id: "noop-task",
            outputKey: "result",
            prompt: "static noop",
            agent: "static",
          },
        ],
      });

      const runCwd = await workspace.createWorktree("run-cwd");
      const outsideCwd = await workspace.createWorktree("outside-cwd");

      const waiting = await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: runCwd,
        workflow,
      });
      expect(waiting.status).toBe("waiting_resume");

      const originalCwd = process.cwd();
      process.chdir(outsideCwd);
      try {
        const resumed = await bridge.resumeWorkflow({
          runId: waiting.run.runId,
          thread,
          objective: workflow.objective,
        });
        expect(resumed.status).toBe("completed");
      } finally {
        process.chdir(originalCwd);
      }

      const capture = JSON.parse(await readFile(capturePath, "utf8")) as {
        cwd: string;
        runId: string;
        argv: string[];
      };
      expect(capture.runId).toBe(waiting.run.runId);
      expect(capture.cwd.endsWith("/worktrees/run-cwd")).toBe(true);
      expect(capture.argv).toContain("--resume");
    });
  });

  it("resumes in the original run cwd after bridge restart and process cwd changes", async () => {
    await withTempWorkspace(async (workspace) => {
      const runStateDir = workspace.path(".hellm/smithers-state");
      const capturePath = workspace.path("resume-restart-cwd-contract.json");
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const runIdIndex = argv.indexOf("--run-id");
const resume = argv.includes("--resume");
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : "missing-run-id";
if (!resume) {
  console.log(JSON.stringify({ status: "waiting_resume", runId }));
  process.exit(0);
}
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  cwd: process.cwd(),
  dbPath: process.env.HELLM_SMITHERS_DB_PATH ?? null,
  runId,
}));
console.log(JSON.stringify({ status: "completed", runId }));
`,
      );
      await chmod(workspace.path("bin/smithers"), 0o755);

      const thread = createThreadFixture({
        id: "resume-cwd-restart-thread",
        kind: "smithers-workflow",
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Persist run cwd across bridge restarts",
        inputEpisodeIds: [],
        tasks: [
          {
            id: "noop-task",
            outputKey: "result",
            prompt: "static noop",
            agent: "static",
          },
        ],
      });

      const runCwd = await workspace.createWorktree("run-cwd-restart");
      const outsideCwd = await workspace.createWorktree("outside-cwd-restart");

      const firstBridge = createSmithersWorkflowBridge({
        smithersBinary: workspace.path("bin/smithers"),
        runStateDir,
      });
      const waiting = await firstBridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: runCwd,
        workflow,
      });
      expect(waiting.status).toBe("waiting_resume");

      const secondBridge = createSmithersWorkflowBridge({
        smithersBinary: workspace.path("bin/smithers"),
        runStateDir,
      });
      const originalCwd = process.cwd();
      process.chdir(outsideCwd);
      try {
        const resumed = await secondBridge.resumeWorkflow({
          runId: waiting.run.runId,
          thread,
          objective: workflow.objective,
        });
        expect(resumed.status).toBe("completed");
      } finally {
        process.chdir(originalCwd);
      }

      const capture = JSON.parse(await readFile(capturePath, "utf8")) as {
        cwd: string;
        dbPath: string | null;
        runId: string;
      };
      expect(capture.runId).toBe(waiting.run.runId);
      expect(capture.cwd.endsWith("/worktrees/run-cwd-restart")).toBe(true);
      expect(capture.dbPath).toContain("/.hellm/smithers-state/db/");
    });
  });

  it("resets incompatible run-state storage once and retries default delegated execution", async () => {
    await withTempWorkspace(async (workspace) => {
      const runStateDir = workspace.path(".hellm/smithers-state");
      const capturePath = workspace.path("incompatible-reset-contract.json");
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
import { existsSync, writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const runIdIndex = argv.indexOf("--run-id");
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : "missing-run-id";
const dbPath = process.env.HELLM_SMITHERS_DB_PATH;
if (!dbPath) {
  console.error("missing db path");
  process.exit(1);
}
const attemptPath = dbPath + ".attempt";
if (!existsSync(attemptPath)) {
  writeFileSync(attemptPath, "1");
  writeFileSync(dbPath, "incompatible-state");
  console.error("table result has no column named workflow_id");
  process.exit(1);
}
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  dbPath,
  resetObserved: !existsSync(dbPath),
  runId,
}));
console.log(JSON.stringify({ status: "completed", runId }));
`,
      );
      await chmod(workspace.path("bin/smithers"), 0o755);

      const bridge = createSmithersWorkflowBridge({
        smithersBinary: workspace.path("bin/smithers"),
        runStateDir,
      });
      const thread = createThreadFixture({
        id: "incompatible-reset-thread",
        kind: "smithers-workflow",
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Reset incompatible state then execute",
        inputEpisodeIds: [],
        tasks: [
          {
            id: "noop-task",
            outputKey: "result",
            prompt: "static noop",
            agent: "static",
          },
        ],
      });

      const result = await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
      });

      expect(result.status).toBe("completed");
      expect(result.run.status).toBe("completed");
      const capture = JSON.parse(await readFile(capturePath, "utf8")) as {
        dbPath: string;
        resetObserved: boolean;
        runId: string;
      };
      expect(capture.runId).toBe(result.run.runId);
      expect(capture.resetObserved).toBe(true);
      expect(capture.dbPath).toContain("/.hellm/smithers-state/db/");
      expect(result.isolation?.runStateStore).toBe(capture.dbPath);
    });
  });

  it("executes real smithers up/resume flows with the default bridge command surface", async () => {
    if (!Bun.which("smithers")) {
      return;
    }

    await withTempWorkspace(async (workspace) => {
      const workflowFile = resolve(import.meta.dir, "../src/workflows/bridge-runner.tsx");
      const bridge = createSmithersWorkflowBridge({
        workflowFile,
        runStateDir: workspace.path(".hellm/smithers-logs"),
      });
      const thread = createThreadFixture({
        id: "real-smithers-default-bridge-thread",
        kind: "smithers-workflow",
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Execute bridge runner via real smithers CLI",
        inputEpisodeIds: [],
        tasks: [
          {
            id: "static-payload",
            outputKey: "static.output",
            prompt: "Emit bounded static task payload.",
            agent: "static",
          },
          {
            id: "verify-effect",
            outputKey: "verification.output",
            prompt: `mkdir -p ${JSON.stringify(workspace.path("artifact"))} && echo verified > ${JSON.stringify(workspace.path("artifact/task-effect.txt"))}`,
            agent: "verification",
          },
        ],
      });

      const first = await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
      });

      expect(first.status).toBe("completed");
      expect(first.run.status).toBe("completed");
      expect(first.episode.status).toBe("completed");
      expect(await workspace.read("artifact/task-effect.txt")).toBe("verified\n");
      if (first.outputs.length > 0) {
        expect(
          first.outputs.some((output) => output.nodeId === "verify-effect"),
        ).toBe(true);
      }

      const resumed = await bridge.resumeWorkflow({
        runId: first.run.runId,
        thread,
        objective: workflow.objective,
      });

      expect(resumed.status).toBe("completed");
      expect(resumed.run.runId).toBe(first.run.runId);
      expect(resumed.run.status).toBe("completed");
      expect(resumed.episode.status).toBe("completed");
    });
  });

  it("treats hyphenated waiting statuses with non-zero exits as waiting (not failed) and resumes after approval", async () => {
    await withTempWorkspace(async (workspace) => {
      const approvedMarkerPath = workspace.path("approved.marker");
      const deniedMarkerPath = workspace.path("denied.marker");
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
import { existsSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const command = argv[0];
const runIdIndex = argv.indexOf("--run-id");
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : argv[1] ?? "missing-run-id";
const approvedMarker = ${JSON.stringify(approvedMarkerPath)};
const deniedMarker = ${JSON.stringify(deniedMarkerPath)};

if (command === "approve") {
  writeFileSync(approvedMarker, "approved");
  console.log(JSON.stringify({ status: "approved", runId }));
  process.exit(0);
}

if (command === "deny") {
  writeFileSync(deniedMarker, "denied");
  console.log(JSON.stringify({ status: "denied", runId }));
  process.exit(0);
}

if (command === "up") {
  const isResume = argv.includes("--resume");
  if (!isResume) {
    console.error("status waiting-approval");
    console.log(JSON.stringify({ status: "waiting-approval", runId }));
    process.exit(17);
  }
  if (existsSync(deniedMarker)) {
    console.error("run denied");
    console.log(JSON.stringify({ status: "blocked", runId }));
    process.exit(1);
  }
  if (!existsSync(approvedMarker)) {
    console.error("status waiting-resume");
    console.log(JSON.stringify({ status: "waiting-resume", runId }));
    process.exit(18);
  }
  console.log(JSON.stringify({ status: "completed", runId }));
  process.exit(0);
}

console.error("unsupported command");
process.exit(1);
`,
      );
      await chmod(workspace.path("bin/smithers"), 0o755);

      const bridge = createSmithersWorkflowBridge({
        smithersBinary: workspace.path("bin/smithers"),
      });
      const thread = createThreadFixture({
        id: "adapter-hyphenated-waiting",
        kind: "smithers-workflow",
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Exercise waiting hyphen status parsing",
        inputEpisodeIds: [],
        tasks: [{ id: "noop", outputKey: "noop", prompt: "noop", agent: "static" }],
      });

      const first = await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
      });
      expect(first.status).toBe("waiting_approval");
      expect(first.run.status).toBe("waiting_approval");
      expect(first.episode.status).toBe("waiting_approval");

      const second = await bridge.resumeWorkflow({
        runId: first.run.runId,
        thread,
        objective: workflow.objective,
      });
      expect(second.status).toBe("waiting_resume");
      expect(second.run.status).toBe("waiting_resume");
      expect(second.episode.status).toBe("waiting_input");

      await bridge.approveRun(first.run.runId, { approved: true, decidedBy: "test" });
      const third = await bridge.resumeWorkflow({
        runId: first.run.runId,
        thread,
        objective: workflow.objective,
      });
      expect(third.status).toBe("completed");
      expect(third.run.status).toBe("completed");
      expect(third.episode.status).toBe("completed");
    });
  });

  it("forwards the isolated Smithers DB path to approve and deny commands", async () => {
    await withTempWorkspace(async (workspace) => {
      const capturePath = workspace.path("db-env-capture.json");
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const command = argv[0] ?? "";
const runIdIndex = argv.indexOf("--run-id");
const runId = runIdIndex >= 0 ? argv[runIdIndex + 1] : argv[1] ?? "missing-run-id";
const isResume = command === "up" && argv.includes("--resume");
const capturePath = ${JSON.stringify(capturePath)};

const readCapture = () => {
  if (!existsSync(capturePath)) return [];
  return JSON.parse(readFileSync(capturePath, "utf8"));
};
const appendCapture = (phase) => {
  const next = readCapture();
  next.push({
    phase,
    runId,
    hellmDbPath: process.env.HELLM_SMITHERS_DB_PATH ?? null,
    smithersDbPath: process.env.SMITHERS_DB_PATH ?? null,
  });
  writeFileSync(capturePath, JSON.stringify(next, null, 2));
};

if (command === "approve" || command === "deny") {
  appendCapture(command);
  process.exit(0);
}

if (command === "up" && !isResume) {
  appendCapture("run");
  console.log(JSON.stringify({ status: "waiting-approval", runId }));
  process.exit(0);
}

if (command === "up" && isResume) {
  appendCapture("resume");
  console.log(JSON.stringify({ status: "completed", runId }));
  process.exit(0);
}

console.error("unsupported command");
process.exit(1);
`,
      );
      await chmod(workspace.path("bin/smithers"), 0o755);

      const bridge = createSmithersWorkflowBridge({
        smithersBinary: workspace.path("bin/smithers"),
        runStateDir: workspace.path(".hellm/smithers-state"),
      });
      const thread = createThreadFixture({
        id: "adapter-db-forwarding",
        kind: "smithers-workflow",
      });
      const workflow = authorWorkflow({
        thread,
        objective: "Verify approval command env forwarding.",
        inputEpisodeIds: [],
        tasks: [{ id: "noop", outputKey: "noop", prompt: "noop", agent: "static" }],
      });

      const first = await bridge.runWorkflow({
        path: "smithers-workflow",
        thread,
        objective: workflow.objective,
        cwd: workspace.root,
        workflow,
      });
      const runStateStore = first.isolation?.runStateStore;
      if (!runStateStore) {
        throw new Error("Expected isolated run state store path.");
      }

      await bridge.approveRun(first.run.runId, { approved: true });
      await bridge.denyRun(first.run.runId, { approved: false });
      await bridge.resumeWorkflow({
        runId: first.run.runId,
        thread,
        objective: workflow.objective,
      });

      const captures = JSON.parse(await readFile(capturePath, "utf8")) as Array<{
        phase: string;
        runId: string;
        hellmDbPath: string | null;
        smithersDbPath: string | null;
      }>;

      expect(captures.map((entry) => entry.phase)).toEqual([
        "run",
        "approve",
        "deny",
        "resume",
      ]);
      expect(captures.every((entry) => entry.runId === first.run.runId)).toBe(true);
      expect(
        captures.every((entry) => entry.hellmDbPath === runStateStore),
      ).toBe(true);
      expect(
        captures.every((entry) => entry.smithersDbPath === runStateStore),
      ).toBe(true);
    });
  });

  it("returns actionable approval/deny failures when smithers decision commands fail", async () => {
    await withTempWorkspace(async (workspace) => {
      await workspace.write(
        "bin/smithers",
        `#!/usr/bin/env bun
const [command, runId] = process.argv.slice(2);
if (command === "approve") {
  console.error("approval rejected by test harness");
  process.exit(32);
}
if (command === "deny") {
  console.error("denial rejected by test harness");
  process.exit(33);
}
console.log(JSON.stringify({ status: "completed", runId }));
`,
      );
      await chmod(workspace.path("bin/smithers"), 0o755);

      const bridge = createSmithersWorkflowBridge({
        smithersBinary: workspace.path("bin/smithers"),
      });

      await expect(
        bridge.approveRun("approval-fail-run", { approved: true, note: "approve" }),
      ).rejects.toThrow(
        'Smithers approve failed for run "approval-fail-run" (exit 32)',
      );
      await expect(
        bridge.denyRun("deny-fail-run", { approved: false, note: "deny" }),
      ).rejects.toThrow(
        'Smithers deny failed for run "deny-fail-run" (exit 33)',
      );
    });
  });
});
