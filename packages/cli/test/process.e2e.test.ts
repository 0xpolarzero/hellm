import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const DIRECT_DEFAULT_ENTRY = fileURLToPath(
  new URL("./fixtures/direct-default-process-entry.ts", import.meta.url),
);
const APPROVAL_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/approval-process-entry.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

function parseStdoutEvents(stdout: string) {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map(
    (line) =>
      JSON.parse(line) as {
        type: string;
        orchestratorId?: string;
        path?: string;
        reason?: string;
        status?: string;
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

    const events = parseStdoutEvents(result.stdout);

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

    const clarificationEvents = parseStdoutEvents(clarification.stdout);
    const approvalEvents = parseStdoutEvents(approval.stdout);

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
});
