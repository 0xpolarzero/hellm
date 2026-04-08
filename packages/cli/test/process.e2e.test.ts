import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule, withTempWorkspace } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const DIRECT_DEFAULT_ENTRY = fileURLToPath(
  new URL("./fixtures/direct-default-process-entry.ts", import.meta.url),
);
const APPROVAL_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/approval-process-entry.ts", import.meta.url),
);
const PI_WORKER_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/pi-worker-process-entry.ts", import.meta.url),
);
const SMITHERS_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/smithers-workflow-process.ts", import.meta.url),
);
const VERIFICATION_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/verification-process-entry.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

function parseEvents(stdout: string): Array<{
  type: string;
  orchestratorId?: string;
  path?: string;
  reason?: string;
  status?: string;
  source?: string;
  threadId?: string;
}> {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          orchestratorId?: string;
          path?: string;
          reason?: string;
          status?: string;
          source?: string;
          threadId?: string;
        },
    );
}

describe("@hellm/cli process boundary", () => {
  it("executes the headless entrypoint as a real process and emits JSONL events", async () => {
    const result = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseEvents(result.stdout);

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events[0]).toMatchObject({
      type: "run.started",
      orchestratorId: "main",
      threadId: "cli",
    });
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "direct",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(events.at(-1)?.status).toBe("completed");
  });

  it("defaults to the direct path in a real process when no route hint or other routing signals are provided", async () => {
    const result = runBunModule({
      entryPath: DIRECT_DEFAULT_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const events = lines.map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          path?: string;
          reason?: string;
          status?: string;
          source?: string;
        },
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "direct",
      reason: "Defaulted to direct execution for a small local request.",
    });
    expect(events.at(-1)?.status).toBe("completed");
  });

  it("executes a verification run across the process boundary and emits normalized JSONL status", async () => {
    const result = runBunModule({
      entryPath: VERIFICATION_PROCESS_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const events = lines.map(
      (line) =>
        JSON.parse(line) as {
          type: string;
          path?: string;
          status?: string;
          source?: string;
          reason?: string;
        },
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "verification",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(events[2]).toMatchObject({
      type: "run.episode",
      source: "verification",
      status: "completed_with_issues",
    });
    expect(events[3]).toMatchObject({
      type: "run.completed",
      status: "completed",
    });
  });

  it("emits waiting JSONL events for both clarification and explicit approval requests", async () => {
    const clarification = runBunModule({
      entryPath: APPROVAL_PROCESS_ENTRY,
      cwd: REPO_ROOT,
    });
    const approval = runBunModule({
      entryPath: APPROVAL_PROCESS_ENTRY,
      cwd: REPO_ROOT,
      args: ["approval"],
    });

    expect(clarification.exitCode).toBe(0);
    expect(clarification.stderr.trim()).toBe("");
    expect(approval.exitCode).toBe(0);
    expect(approval.stderr.trim()).toBe("");

    const clarificationEvents = parseEvents(clarification.stdout);
    const approvalEvents = parseEvents(approval.stdout);

    expect(clarificationEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(approvalEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(clarificationEvents[1]).toMatchObject({
      type: "run.classified",
      path: "approval",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(approvalEvents[1]).toMatchObject({
      type: "run.classified",
      path: "approval",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(clarificationEvents[2]).toMatchObject({
      type: "run.episode",
      status: "waiting_input",
      source: "orchestrator",
    });
    expect(approvalEvents[2]).toMatchObject({
      type: "run.episode",
      status: "waiting_approval",
      source: "orchestrator",
    });
    expect(clarificationEvents.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_input",
      threadId: "process-clarification",
    });
    expect(approvalEvents.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
      threadId: "process-approval",
    });
  });

  it("executes the pi-worker raw execution primitive in a real process with file-backed session JSONL", async () => {
    await withTempWorkspace(async (workspace) => {
      const worktreePath = await workspace.createWorktree("feature-pi-process");
      const sessionFile = workspace.path(".pi/sessions/process-pi-worker.jsonl");
      const result = runBunModule({
        entryPath: PI_WORKER_PROCESS_ENTRY,
        cwd: REPO_ROOT,
        env: {
          HELLM_PROCESS_TEST_CWD: workspace.root,
          HELLM_PROCESS_TEST_WORKTREE: worktreePath,
          HELLM_PROCESS_TEST_SESSION_FILE: sessionFile,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");

      const payload = JSON.parse(result.stdout.trim()) as {
        eventTypes: string[];
        classification: {
          path: string;
          reason: string;
        };
        completion: {
          reason: string;
          isComplete: boolean;
        };
        workerRequest: {
          runtimeTransition: {
            reason: string;
            toSessionId: string;
            aligned: boolean;
            toWorktreePath: string;
          };
          scopedContext: {
            relevantPaths: string[];
            priorEpisodeIds: string[];
          };
          toolScope: {
            allow: string[];
            writeRoots: string[];
          };
          completion: {
            type: string;
            maxTurns: number;
          };
        };
        sessionJsonlLineCount: number;
        reconstructedEpisodeIds: string[];
      };

      expect(payload.eventTypes).toEqual([
        "run.started",
        "run.classified",
        "run.episode",
        "run.completed",
      ]);
      expect(payload.classification).toMatchObject({
        path: "pi-worker",
        reason: "Explicit route hint supplied by caller.",
      });
      expect(payload.completion).toEqual({
        reason: "completed",
        isComplete: true,
      });
      expect(payload.workerRequest.runtimeTransition).toEqual({
        reason: "resume",
        toSessionId: "process-pi-worker:pi",
        aligned: false,
        toWorktreePath: worktreePath,
      });
      expect(payload.workerRequest.scopedContext.relevantPaths).toEqual([
        workspace.root,
        worktreePath,
      ]);
      expect(payload.workerRequest.scopedContext.priorEpisodeIds).toEqual([]);
      expect(payload.workerRequest.toolScope).toEqual({
        allow: ["read", "edit", "bash"],
        writeRoots: [workspace.root],
      });
      expect(payload.workerRequest.completion).toEqual({
        type: "episode-produced",
        maxTurns: 1,
      });
      expect(payload.reconstructedEpisodeIds).toEqual(["process-pi-episode"]);
      expect(payload.sessionJsonlLineCount).toBe(5);

      const persistedLines = readFileSync(sessionFile, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(persistedLines).toHaveLength(payload.sessionJsonlLineCount);
    });
  });

  it("executes smithers workflow runs as a real process and emits waiting/completed JSONL events", async () => {
    const waiting = runBunModule({
      entryPath: SMITHERS_PROCESS_ENTRY,
      cwd: REPO_ROOT,
      args: ["waiting"],
    });
    const resumed = runBunModule({
      entryPath: SMITHERS_PROCESS_ENTRY,
      cwd: REPO_ROOT,
      args: ["resume"],
    });

    expect(waiting.exitCode).toBe(0);
    expect(waiting.stderr.trim()).toBe("");
    const waitingEvents = parseEvents(waiting.stdout);
    expect(waitingEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(waitingEvents[1]).toMatchObject({
      type: "run.classified",
      path: "smithers-workflow",
      reason: "Explicit route hint supplied by caller.",
    });
    expect(waitingEvents[2]).toMatchObject({
      type: "run.episode",
      source: "smithers",
      status: "waiting_approval",
    });
    expect(waitingEvents.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
      threadId: "cli-process-smithers",
    });

    expect(resumed.exitCode).toBe(0);
    expect(resumed.stderr.trim()).toBe("");
    const resumedEvents = parseEvents(resumed.stdout);
    expect(resumedEvents.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(resumedEvents[2]).toMatchObject({
      type: "run.episode",
      source: "smithers",
      status: "completed",
    });
    expect(resumedEvents.at(-1)).toMatchObject({
      type: "run.completed",
      status: "completed",
      threadId: "cli-process-smithers",
    });
  });
});
