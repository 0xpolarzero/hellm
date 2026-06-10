import { describe, expect, it } from "bun:test";
import { createAppLogStore } from "./app-log-store";
import { appendAppLoggerEvent, createAppLogger } from "./app-logger";

describe("app logger", () => {
  it("forwards the same redacted entry shape used by app logs", () => {
    const store = createAppLogStore();
    const forwarded: unknown[] = [];
    const logger = createAppLogger({
      store,
      forwardBridgeLog: (_level, message, _source, details, error) => {
        forwarded.push({ message, details, error });
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
      message: "Authorization=[REDACTED] [REDACTED]",
      details: {
        apiKey: "[REDACTED]",
        workspaceSessionId: "session-1",
      },
      error: {
        message: "Bearer [REDACTED] failed",
      },
    });
    store.close();
  });

  it("keeps readable warning producer calls on the warn storage and bridge contract", () => {
    const store = createAppLogStore();
    const forwarded: unknown[] = [];
    const logger = createAppLogger({
      store,
      forwardBridgeLog: (level, message, source) => {
        forwarded.push({ level, message, source });
      },
    });

    const entry = logger.warning("workspace", "Workspace warning.");
    logger.debug("renderer", "Renderer detail.");

    expect(entry?.level).toBe("warn");
    expect(store.query({ levels: ["warn"] }).entries.map((log) => log.message)).toEqual([
      "Workspace warning.",
    ]);
    expect(forwarded).toEqual([
      { level: "warn", message: "Workspace warning.", source: "workspace" },
      { level: "debug", message: "Renderer detail.", source: "renderer" },
    ]);
    store.close();
  });

  it("persists typed app log events with related ids outside redacted details", () => {
    const store = createAppLogStore();
    const logger = createAppLogger({ store });

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

    const [entry] = store.query().entries;
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
    store.close();
  });
});
