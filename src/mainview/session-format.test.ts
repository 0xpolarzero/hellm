import { describe, expect, it } from "bun:test";
import { formatSessionStatusLabel } from "./session-format";
import type { WorkspaceSessionSummary } from "./chat-rpc";

function session(
  overrides: Partial<WorkspaceSessionSummary> & Pick<WorkspaceSessionSummary, "id" | "title">,
): WorkspaceSessionSummary {
  return {
    id: overrides.id,
    title: overrides.title,
    preview: overrides.preview ?? "",
    createdAt: overrides.createdAt ?? "2026-04-10T10:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-10T10:00:00.000Z",
    messageCount: overrides.messageCount ?? 0,
    status: overrides.status ?? "idle",
    wait: overrides.wait,
    counts: overrides.counts,
    threadIdsByStatus: overrides.threadIdsByStatus,
    threadIds: overrides.threadIds,
    sessionFile: overrides.sessionFile,
    parentSessionId: overrides.parentSessionId,
    parentSessionFile: overrides.parentSessionFile,
    modelId: overrides.modelId,
    provider: overrides.provider,
    thinkingLevel: overrides.thinkingLevel,
    commandRollups: overrides.commandRollups,
  };
}

describe("formatSessionStatusLabel", () => {
  it("formats delegated running work as threading", () => {
    expect(
      formatSessionStatusLabel(
        session({
          id: "session-threading",
          title: "Threading",
          status: "running",
          threadIdsByStatus: {
            running: ["thread-1"],
            waiting: [],
            failed: [],
          },
        }),
      ),
    ).toBe("Threading");
  });

  it("keeps ordinary running, waiting, error, and idle labels stable", () => {
    expect(
      formatSessionStatusLabel(session({ id: "session-running", title: "Running", status: "running" })),
    ).toBe("Running");
    expect(
      formatSessionStatusLabel(session({ id: "session-waiting", title: "Waiting", status: "waiting" })),
    ).toBe("Waiting");
    expect(
      formatSessionStatusLabel(session({ id: "session-error", title: "Error", status: "error" })),
    ).toBe("Error");
    expect(
      formatSessionStatusLabel(session({ id: "session-idle", title: "Idle", status: "idle" })),
    ).toBe("Idle");
  });
});
