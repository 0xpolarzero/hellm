import { describe, expect, it } from "bun:test";
import { sortVisibleSessionsByRecency } from "./session-state";
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
    sessionFile: overrides.sessionFile,
    parentSessionId: overrides.parentSessionId,
    parentSessionFile: overrides.parentSessionFile,
    modelId: overrides.modelId,
    provider: overrides.provider,
    thinkingLevel: overrides.thinkingLevel,
  };
}

describe("sortVisibleSessionsByRecency", () => {
  it("returns sessions sorted by most recent update", () => {
    const sessions = sortVisibleSessionsByRecency([
      session({ id: "oldest", title: "Oldest", updatedAt: "2026-04-10T10:02:00.000Z" }),
      session({ id: "newest", title: "Newest", updatedAt: "2026-04-10T10:05:00.000Z" }),
      session({ id: "middle", title: "Middle", updatedAt: "2026-04-10T10:03:00.000Z" }),
    ]);

    expect(sessions.map((item) => item.id)).toEqual(["newest", "middle", "oldest"]);
  });
});
