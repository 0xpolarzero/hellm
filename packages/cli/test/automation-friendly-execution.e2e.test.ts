import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import {
  createTempGitWorkspace,
  hasGit,
  runBunModule,
} from "@hellm/test-support";

type ProcessScenario =
  | "direct-completed"
  | "approval-waiting"
  | "pi-blocked"
  | "missing-episode";

const PROCESS_DRIVER = fileURLToPath(
  new URL("./fixtures/headless-process-driver.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

describe("@hellm/cli automation-friendly execution process contracts", () => {
  it("emits machine-parseable waiting JSONL events with a zero exit code", () => {
    const result = runProcessScenario("approval-waiting");
    const events = parseJsonl(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.waiting",
    ]);
    expect(events[0]).toMatchObject({
      type: "run.started",
      orchestratorId: "main",
      threadId: "process-approval-waiting",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
    });
  });

  it("represents blocked worker outcomes as waiting events so automation can retry", () => {
    const result = runProcessScenario("pi-blocked");
    const events = parseJsonl(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    expect(events.find((event) => event.type === "run.episode")).toMatchObject({
      source: "pi-worker",
      status: "blocked",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "blocked",
      threadId: "process-pi-blocked",
    });
  });

  it("returns non-zero and deterministic diagnostics when JSONL cannot be produced", () => {
    const result = runProcessScenario("missing-episode");

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.trim()).toBe("");
    expect(result.stderr).toContain("Cannot build JSONL events without an episode.");
  });

  it("preserves the JSONL automation contract inside a real linked git worktree", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace("hellm-cli-automation-");
    try {
      const worktreePath = await workspace.createLinkedWorktree(
        "feature-automation-friendly",
      );
      const result = runProcessScenario("direct-completed", {
        requestCwd: worktreePath,
        threadId: "process-linked-worktree",
      });
      const events = parseJsonl(result.stdout);

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(events.map((event) => event.type)).toEqual([
        "run.started",
        "run.classified",
        "run.episode",
        "run.completed",
      ]);
      expect(events[0]).toMatchObject({
        type: "run.started",
        threadId: "process-linked-worktree",
      });
      expect(events[1]).toMatchObject({
        type: "run.classified",
        path: "direct",
      });
    } finally {
      await workspace.cleanup();
    }
  });
});

function runProcessScenario(
  scenario: ProcessScenario,
  options: { processCwd?: string; requestCwd?: string; threadId?: string } = {},
) {
  return runBunModule({
    entryPath: PROCESS_DRIVER,
    cwd: options.processCwd ?? REPO_ROOT,
    env: {
      HELLM_PROCESS_SCENARIO: scenario,
      ...(options.threadId
        ? { HELLM_PROCESS_THREAD_ID: options.threadId }
        : {}),
      ...(options.requestCwd ? { HELLM_PROCESS_CWD: options.requestCwd } : {}),
    },
  });
}

function parseJsonl(stdout: string): Array<Record<string, unknown>> {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map(
    (line) => JSON.parse(line) as Record<string, unknown>,
  );
}
