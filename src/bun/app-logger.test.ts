import { describe, expect, it } from "bun:test";
import { createAppLogger } from "./app-logger";
import { createStateAppLogsFacade } from "@svvy/state";

const testClock = () => "2026-06-21T12:00:00.000Z";

describe("bun app logger", () => {
  it("forwards the same redacted entry shape used by app logs to the bridge", () => {
    const appLogs = createStateAppLogsFacade({ now: testClock });
    const forwarded: unknown[] = [];
    const logger = createAppLogger({
      appLogs,
      forwardBridgeLog: (level, message, source, details, error) => {
        forwarded.push({ level, message, source, details, error });
      },
    });

    logger.error(
      "auth.provider",
      "Authorization=Bearer abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
      new Error("Bearer abcdefghijklmnopqrstuvwxyzABCDEF1234567890 failed"),
      {
        apiKey: "sk-abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
        workspaceSessionId: "session-1",
      },
    );

    expect(JSON.stringify(forwarded[0])).not.toContain(
      "abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
    );
    expect(forwarded[0]).toMatchObject({
      level: "error",
      message: "Authorization=[REDACTED] [REDACTED]",
      source: "auth.provider",
      details: {
        apiKey: "[REDACTED]",
        workspaceSessionId: "session-1",
      },
      error: {
        message: "Bearer [REDACTED] failed",
      },
    });
    appLogs.close();
  });

  it("uses warn as the bridge level for warning producer calls", () => {
    const appLogs = createStateAppLogsFacade({ now: testClock });
    const forwarded: unknown[] = [];
    const logger = createAppLogger({
      appLogs,
      forwardBridgeLog: (level, message, source) => {
        forwarded.push({ level, message, source });
      },
    });

    logger.warning("workspace", "Workspace warning.");
    logger.debug("renderer", "Renderer detail.");

    expect(forwarded).toEqual([
      { level: "warn", message: "Workspace warning.", source: "workspace" },
      { level: "debug", message: "Renderer detail.", source: "renderer" },
    ]);
    appLogs.close();
  });
});
