import { describe, expect, it } from "bun:test";
import type { WorkspaceCommandRollup } from "../shared/workspace-contract";
import { projectCommandToolCall, projectRawToolCall } from "./tool-card-projection";

function commandRollup(overrides: Partial<WorkspaceCommandRollup> = {}): WorkspaceCommandRollup {
  return {
    commandId: "command-1",
    threadId: null,
    toolName: "exec_command",
    visibility: "summary",
    status: "succeeded",
    title: "Run shell command",
    summary: "Command completed.",
    arguments: { cmd: "bun test", workdir: "/repo" },
    facts: { exitCode: 0 },
    error: null,
    artifacts: [],
    outputEvents: [],
    stdin: {
      mode: "continuable",
      canAttemptWrite: false,
      acceptedWrites: [],
    },
    argumentSnapshots: [],
    progressEvents: [],
    patchSnapshots: [],
    diagnostics: [],
    childCount: 0,
    summaryChildCount: 0,
    traceChildCount: 0,
    summaryChildren: [],
    startedAt: "2026-06-18T10:00:00.000Z",
    updatedAt: "2026-06-18T10:00:01.250Z",
    finishedAt: "2026-06-18T10:00:01.250Z",
    ...overrides,
  };
}

describe("tool card projection", () => {
  it("projects shell commands as compact execution spans with semantic sections", () => {
    const card = projectCommandToolCall(
      commandRollup({
        outputEvents: [
          {
            eventId: "event-stdout",
            at: "2026-06-18T10:00:00.500Z",
            stream: "stdout",
            source: "runtime",
            text: "ok\n",
          },
        ],
      }),
    );

    expect(card).toMatchObject({
      title: "Run shell command",
      target: "bun test",
      duration: "1.3s",
      outcome: "Command completed.",
      commandId: "command-1",
    });
    expect(card.metrics?.map((metric) => metric.label)).toContain("Duration");
    expect(card.metrics).toContainEqual({ label: "Exit", value: "0", tone: "done" });
    expect(card.sections?.map((section) => section.title)).toEqual([
      "Command",
      "Arguments",
      "Stdout",
    ]);
    expect(card.sections?.[0]?.content).toContain("cwd: /repo");
  });

  it("summarizes patch snapshots without flattening them into generic output", () => {
    const card = projectCommandToolCall(
      commandRollup({
        toolName: "apply_patch",
        title: "Apply patch",
        summary: "Patch applied.",
        arguments: "*** Begin Patch",
        patchSnapshots: [
          {
            eventId: "patch-1",
            at: "2026-06-18T10:00:00.500Z",
            source: "runtime",
            files: [
              { path: "src/app.ts", changeType: "modified", additions: 4, deletions: 1 },
              { path: "src/new.ts", changeType: "created", additions: 8, deletions: 0 },
            ],
          },
        ],
      }),
    );

    expect(card.outcome).toBe("Changed 2 files (+12 / -1).");
    expect(card.metrics).toContainEqual({ label: "Files", value: "2" });
    expect(card.metrics).toContainEqual({ label: "Diff", value: "+12 / -1" });
    expect(card.sections?.find((section) => section.id === "patch")?.content).toContain(
      "modified: src/app.ts",
    );
  });

  it("projects raw streaming tool arguments through the same semantic card model", () => {
    const card = projectRawToolCall({
      id: "streaming-1",
      name: "thread_start",
      status: "running",
      argumentsValue: { objective: "Audit transcript UX" },
    });

    expect(card.target).toBe("Audit transcript UX");
    expect(card.sections).toContainEqual(
      expect.objectContaining({
        id: "arguments",
        title: "Arguments",
      }),
    );
  });

  it("caps transcript section content and points users to the inspector for full output", () => {
    const card = projectCommandToolCall(
      commandRollup({
        outputEvents: [
          {
            eventId: "event-stdout",
            at: "2026-06-18T10:00:00.500Z",
            stream: "stdout",
            source: "runtime",
            text: "x".repeat(9000),
          },
        ],
      }),
    );

    const stdout = card.sections?.find((section) => section.id === "stdout")?.content ?? "";
    expect(stdout.length).toBeLessThan(8300);
    expect(stdout).toContain("Inspect the command for full output.");
  });
});
