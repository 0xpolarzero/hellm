import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const PATH_ROUTING_PROCESS_FIXTURE = fileURLToPath(
  new URL("./fixtures/path-routing-process-runner.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

function parseJsonlEvents(stdout: string): Array<{
  type: string;
  orchestratorId?: string;
  path?: string;
  reason?: string;
  status?: string;
  threadId?: string;
}> {
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

    const events = parseJsonlEvents(result.stdout);

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

  it("routes auto verification requests in a subprocess and emits classified verification JSONL events", async () => {
    const result = runBunModule({
      entryPath: PATH_ROUTING_PROCESS_FIXTURE,
      cwd: REPO_ROOT,
      env: {
        HELLM_REQUEST_JSON: JSON.stringify({
          threadId: "process-auto-verify",
          prompt: "Please VERIFY the branch before merge.",
          cwd: REPO_ROOT,
          routeHint: "auto",
        }),
        HELLM_FAKE_VERIFICATION: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseJsonlEvents(result.stdout);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "verification",
      reason: "Prompt emphasizes verification work.",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      status: "completed",
      threadId: "process-auto-verify",
    });
  });

  it("routes auto approval requests in a subprocess and emits waiting approval JSONL events", async () => {
    const result = runBunModule({
      entryPath: PATH_ROUTING_PROCESS_FIXTURE,
      cwd: REPO_ROOT,
      env: {
        HELLM_REQUEST_JSON: JSON.stringify({
          threadId: "process-auto-approval",
          prompt: "Ship this after approval.",
          cwd: REPO_ROOT,
          routeHint: "auto",
          requireApproval: true,
        }),
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseJsonlEvents(result.stdout);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "approval",
      reason: "Request requires approval or clarification.",
    });
    expect(events.at(-1)).toMatchObject({
      type: "run.waiting",
      status: "waiting_approval",
      threadId: "process-auto-approval",
    });
  });
});
