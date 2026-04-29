import { afterEach, describe, expect, it } from "bun:test";
import { formatRelativeSessionTime, formatSessionStatusLabel } from "./session-format";
import type { WorkspaceSessionSummary } from "../shared/workspace-contract";

const realDateNow = Date.now;

afterEach(() => {
  Date.now = realDateNow;
});

function freezeNow(value: string): void {
  Date.now = () => new Date(value).getTime();
}

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
    isPinned: overrides.isPinned ?? false,
    pinnedAt: overrides.pinnedAt ?? null,
    isArchived: overrides.isArchived ?? false,
    archivedAt: overrides.archivedAt ?? null,
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

describe("formatRelativeSessionTime", () => {
  it("formats recent session times with deterministic English labels", () => {
    freezeNow("2026-04-10T10:00:00.000Z");

    expect(formatRelativeSessionTime("2026-04-10T09:59:31.000Z")).toBe("just now");
    expect(formatRelativeSessionTime("2026-04-10T09:59:00.000Z")).toBe("1 min ago");
    expect(formatRelativeSessionTime("2026-04-10T09:45:00.000Z")).toBe("15 min ago");
    expect(formatRelativeSessionTime("2026-04-10T08:00:00.000Z")).toBe("2 hr ago");
    expect(formatRelativeSessionTime("2026-04-07T10:00:00.000Z")).toBe("3 days ago");
  });

  it("keeps clock-skew future times deterministic", () => {
    freezeNow("2026-04-10T10:00:00.000Z");

    expect(formatRelativeSessionTime("2026-04-10T10:00:29.000Z")).toBe("just now");
    expect(formatRelativeSessionTime("2026-04-10T10:01:00.000Z")).toBe("in 1 min");
    expect(formatRelativeSessionTime("2026-04-11T10:00:00.000Z")).toBe("in 1 day");
  });

  it("returns an empty label for invalid timestamps", () => {
    expect(formatRelativeSessionTime("not a timestamp")).toBe("");
  });
});

describe("formatSessionStatusLabel", () => {
  it("formats delegated running work as threading", () => {
    expect(
      formatSessionStatusLabel(
        session({
          id: "session-threading",
          title: "Threading",
          status: "running",
          threadIdsByStatus: {
            runningHandler: ["thread-1"],
            runningWorkflow: [],
            waiting: [],
            troubleshooting: [],
          },
        }),
      ),
    ).toBe("Threading");
  });

  it("keeps ordinary running, waiting, error, and idle labels stable", () => {
    expect(
      formatSessionStatusLabel(
        session({ id: "session-running", title: "Running", status: "running" }),
      ),
    ).toBe("Running");
    expect(
      formatSessionStatusLabel(
        session({ id: "session-waiting", title: "Waiting", status: "waiting" }),
      ),
    ).toBe("Waiting");
    expect(
      formatSessionStatusLabel(session({ id: "session-error", title: "Error", status: "error" })),
    ).toBe("Error");
    expect(
      formatSessionStatusLabel(session({ id: "session-idle", title: "Idle", status: "idle" })),
    ).toBe("Idle");
  });
});
