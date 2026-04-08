import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { runBunModule } from "@hellm/test-support";

const CLI_ENTRY = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const REPO_ROOT = resolve(import.meta.dir, "../../../");

interface ProcessJsonlEvent {
  type: string;
  orchestratorId?: string;
  path?: string;
  reason?: string;
  status?: string;
  threadId?: string;
  episodeId?: string;
  latestEpisodeId?: string;
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

    expectHeadlessOneShotEventOrder(events);
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

  it("supports repeated one-shot process invocations without carrying prior process state", async () => {
    const first = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
    });
    const second = runBunModule({
      entryPath: CLI_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(first.exitCode).toBe(0);
    expect(first.stderr.trim()).toBe("");
    expect(second.exitCode).toBe(0);
    expect(second.stderr.trim()).toBe("");

    const firstEvents = parseJsonlEvents(first.stdout);
    const secondEvents = parseJsonlEvents(second.stdout);
    expectHeadlessOneShotEventOrder(firstEvents);
    expectHeadlessOneShotEventOrder(secondEvents);
    expect(firstEvents[0]?.threadId).toBe("cli");
    expect(secondEvents[0]?.threadId).toBe("cli");
    expect(firstEvents[1]?.path).toBe("direct");
    expect(secondEvents[1]?.path).toBe("direct");

    const firstEpisode = firstEvents.find((event) => event.type === "run.episode");
    const firstTerminal = firstEvents.at(-1);
    expect(firstEpisode?.episodeId).toBe(firstTerminal?.latestEpisodeId);

    const secondEpisode = secondEvents.find((event) => event.type === "run.episode");
    const secondTerminal = secondEvents.at(-1);
    expect(secondEpisode?.episodeId).toBe(secondTerminal?.latestEpisodeId);
  });
});

function parseJsonlEvents(stdout: string): ProcessJsonlEvent[] {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line) => JSON.parse(line) as ProcessJsonlEvent);
}

function expectHeadlessOneShotEventOrder(events: ProcessJsonlEvent[]): void {
  expect(events.map((event) => event.type)).toEqual([
    "run.started",
    "run.classified",
    "run.episode",
    "run.completed",
  ]);
}
