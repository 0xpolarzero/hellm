import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule, withTempWorkspace } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const HEADLESS_REQUEST_RUNNER = fileURLToPath(
  new URL("./fixtures/run-headless-request.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

function parseJsonlEvents(output: string): Array<{
  type: string;
  orchestratorId?: string;
  path?: string;
  reason?: string;
  status?: string;
  threadId?: string;
  latestEpisodeId?: string;
}> {
  return output
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
          threadId?: string;
          latestEpisodeId?: string;
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

  it("preserves request-classification precedence and reasons across a real process boundary", async () => {
    await withTempWorkspace(async (workspace) => {
      const scenarios = [
        {
          name: "explicit-route-hint",
          request: {
            threadId: "proc-explicit-route-hint",
            prompt: "VERIFY and request approval",
            cwd: workspace.root,
            routeHint: "pi-worker" as const,
            requireApproval: true,
            workflowSeedInput: {
              preferredPath: "smithers-workflow" as const,
            },
          },
          expectedClassification: {
            path: "pi-worker",
            reason: "Explicit route hint supplied by caller.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
        {
          name: "seed-preferred-path",
          request: {
            threadId: "proc-seed-hint",
            prompt: "verify this and wait for approval",
            cwd: workspace.root,
            routeHint: "auto" as const,
            requireApproval: true,
            workflowSeedInput: {
              preferredPath: "smithers-workflow" as const,
            },
          },
          expectedClassification: {
            path: "smithers-workflow",
            reason: "Structured workflow seed requested a preferred path.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
        {
          name: "approval-over-verification",
          request: {
            threadId: "proc-approval-over-verification",
            prompt: "please verify this change",
            cwd: workspace.root,
            requireApproval: true,
          },
          expectedClassification: {
            path: "approval",
            reason: "Request requires approval or clarification.",
          },
          expectedCompletion: {
            type: "run.waiting",
            status: "waiting_approval",
          },
        },
        {
          name: "verification-heuristic",
          request: {
            threadId: "proc-verification-heuristic",
            prompt: "PLEASE VERIFY THE WORKSPACE",
            cwd: workspace.root,
          },
          expectedClassification: {
            path: "verification",
            reason: "Prompt emphasizes verification work.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
        {
          name: "direct-default",
          request: {
            threadId: "proc-direct-default",
            prompt: "summarize the architecture",
            cwd: workspace.root,
          },
          expectedClassification: {
            path: "direct",
            reason: "Defaulted to direct execution for a small local request.",
          },
          expectedCompletion: {
            type: "run.completed",
            status: "completed",
          },
        },
      ] as const;

      for (const scenario of scenarios) {
        const result = runBunModule({
          entryPath: HEADLESS_REQUEST_RUNNER,
          cwd: REPO_ROOT,
          args: [JSON.stringify(scenario.request)],
        });

        expect(result.exitCode).toBe(0);
        expect(result.stderr.trim()).toBe("");

        const events = parseJsonlEvents(result.stdout);
        expect(events.map((event) => event.type)).toEqual([
          "run.started",
          "run.classified",
          "run.episode",
          scenario.expectedCompletion.type,
        ]);
        expect(events[1]).toMatchObject({
          type: "run.classified",
          path: scenario.expectedClassification.path,
          reason: scenario.expectedClassification.reason,
        });
        expect(events.at(-1)).toMatchObject({
          type: scenario.expectedCompletion.type,
          status: scenario.expectedCompletion.status,
        });
      }
    });
  });
});
