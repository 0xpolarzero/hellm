import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const SMITHERS_PROCESS_ENTRY = fileURLToPath(
  new URL("./fixtures/smithers-workflow-process.ts", import.meta.url),
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
