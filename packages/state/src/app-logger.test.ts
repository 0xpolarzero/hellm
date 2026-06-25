import { describe, expect, it } from "bun:test";
import { createAppLogFacade } from "./app-log-facade";
import { appendAppLoggerEvent, createAppLogger } from "./app-logger";

describe("app logger", () => {
  it("stores redacted entry details and errors", () => {
    const appLogs = createAppLogFacade();
    const logger = createAppLogger({ appLogs });

    logger.error(
      "auth.provider",
      "Authorization=Bearer abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
      new Error("Bearer abcdefghijklmnopqrstuvwxyzABCDEF1234567890 failed"),
      {
        apiKey: "sk-abcdefghijklmnopqrstuvwxyzABCDEF1234567890",
        workspaceSessionId: "session-1",
      },
    );

    const [entry] = appLogs.query().entries;
    expect(JSON.stringify(entry)).not.toContain("abcdefghijklmnopqrstuvwxyzABCDEF1234567890");
    expect(entry).toMatchObject({
      message: "Authorization=[REDACTED] [REDACTED]",
      details: {
        apiKey: "[REDACTED]",
      },
      workspaceSessionId: "session-1",
      error: {
        message: "Bearer [REDACTED] failed",
      },
    });
    appLogs.close();
  });

  it("keeps readable warning producer calls on the warn storage contract", () => {
    const appLogs = createAppLogFacade();
    const logger = createAppLogger({ appLogs });

    const entry = logger.warning("workspace", "Workspace warning.");
    logger.debug("renderer", "Renderer detail.");

    expect(entry?.level).toBe("warn");
    expect(appLogs.query({ levels: ["warn"] }).entries.map((log) => log.message)).toEqual([
      "Workspace warning.",
    ]);
    appLogs.close();
  });

  it("persists typed app log events with related ids outside redacted details", () => {
    const appLogs = createAppLogFacade();
    const logger = createAppLogger({ appLogs });

    appendAppLoggerEvent(logger, {
      level: "warning",
      source: "execute_typescript",
      message: "Execute TypeScript blocked by static diagnostics.",
      details: {
        workspaceSessionId: "session-1",
        surfacePiSessionId: "surface-1",
        commandId: "command-1",
        artifactId: "artifact-1",
        diagnosticsCount: 2,
      },
    });

    const [entry] = appLogs.query().entries;
    expect(entry).toMatchObject({
      level: "warn",
      source: "execute_typescript",
      workspaceSessionId: "session-1",
      surfacePiSessionId: "surface-1",
      commandId: "command-1",
      artifactId: "artifact-1",
      details: {
        diagnosticsCount: 2,
      },
    });
    expect(entry?.details).not.toHaveProperty("commandId");
    expect(entry?.details).not.toHaveProperty("artifactId");
    appLogs.close();
  });
});
