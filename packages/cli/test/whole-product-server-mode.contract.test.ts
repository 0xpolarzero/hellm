import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test } from "bun:test";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const REPO_ROOT = resolve(import.meta.dir, "../../../");

interface JsonlEventRecord {
  type: string;
}

describe("@hellm/cli whole-product server mode contract", () => {
  it("remains a finite one-shot process until deferred server mode is implemented", () => {
    const result = runCliProcess({ timeoutMs: 5_000 });

    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");

    const events = parseJsonlEvents(result.stdout);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.classified",
      "run.episode",
      "run.completed",
    ]);
    expect(events.filter((event) => event.type === "run.started")).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.type === "run.completed" || event.type === "run.waiting",
      ),
    ).toHaveLength(1);
  });

  test.todo(
    "accepts multiple request envelopes in a single long-lived process while reusing the same orchestrator contract",
    () => {},
  );
  test.todo(
    "emits per-request JSONL streams with stable request ids while preserving the existing run.started/run.classified/run.episode/run.completed event taxonomy",
    () => {},
  );
  test.todo(
    "resumes workflow-backed runs in server mode using the same thread/session/worktree alignment guarantees as one-shot execution",
    () => {},
  );
  test.todo(
    "supports explicit shutdown semantics that flush in-flight events and leave durable session state for clean reattach",
    () => {},
  );
});

function runCliProcess(input: {
  timeoutMs: number;
}): {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
} {
  const bunBinary = Bun.which("bun") ?? process.execPath;
  const result = spawnSync(bunBinary, [CLI_ENTRY], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: input.timeoutMs,
  });

  const error = result.error as NodeJS.ErrnoException | undefined;
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: error?.code === "ETIMEDOUT",
  };
}

function parseJsonlEvents(stdout: string): JsonlEventRecord[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonlEventRecord);
}
