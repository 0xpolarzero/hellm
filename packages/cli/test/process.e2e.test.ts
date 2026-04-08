import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const WORKFLOW_SEED_ENTRY = fileURLToPath(
  new URL("./fixtures/workflow-seed-process.ts", import.meta.url),
);
const REPO_ROOT = resolve(import.meta.dir, "../../../");

describe("@hellm/cli process boundary", () => {
  it("executes the headless entrypoint as a real process and emits JSONL events", async () => {
    const result = runBunModule({
      entryPath: CLI_ENTRY,
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
          orchestratorId?: string;
          path?: string;
          reason?: string;
          status?: string;
          threadId?: string;
        },
    );

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

  it("preserves workflow seed routing semantics across a real process boundary", async () => {
    const result = runBunModule({
      entryPath: WORKFLOW_SEED_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const parsed = lines.map(
      (line) =>
        JSON.parse(line) as
          | {
              type: string;
              path?: string;
              reason?: string;
            }
          | {
              type: "seed.assertions";
              classificationPath: string;
              classificationReason: string;
              runObjective?: string;
              workflowObjective?: string;
            },
    );
    const events = parsed.filter(
      (entry): entry is { type: string; path?: string; reason?: string } =>
        entry.type !== "seed.assertions",
    );
    const assertions = parsed.find(
      (entry): entry is {
        type: "seed.assertions";
        classificationPath: string;
        classificationReason: string;
        runObjective?: string;
        workflowObjective?: string;
      } => entry.type === "seed.assertions",
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "run.classified",
      path: "smithers-workflow",
      reason: "Structured workflow seed requested a preferred path.",
    });
    expect(assertions).toEqual({
      type: "seed.assertions",
      classificationPath: "smithers-workflow",
      classificationReason: "Structured workflow seed requested a preferred path.",
      runObjective: "Seeded objective from process fixture",
      workflowObjective: "Seeded objective from process fixture",
    });
  });
});
