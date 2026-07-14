import { describe, expect, it } from "bun:test";
import { runDesktopBootstrap } from "./desktop-bootstrap";

describe("desktop bootstrap sequencing", () => {
  it("does not acquire facades or expose desktop resources when readiness fails", async () => {
    const events: string[] = [];
    const readinessFailure = new Error("raw readiness details");

    const result = runDesktopBootstrap({
      awaitReadiness: async () => {
        events.push("readiness");
        throw readinessFailure;
      },
      acquireFacades: async () => {
        events.push("facades");
        return {};
      },
      startDesktop: async () => {
        events.push("desktop");
      },
      onStartupFailure: (error) => {
        expect(error).toBe(readinessFailure);
        events.push("startup-diagnostics");
      },
      rejectRendererCalls: (error) => {
        events.push(`reject:${error.reason}`);
      },
      cleanup: async (reason) => {
        events.push(`cleanup:${reason}`);
      },
      showStartupFailure: async (cause) => {
        expect(cause).toBe(readinessFailure);
        events.push("failure-surface");
      },
      finalizeFailure: () => {
        events.push("finalize");
      },
    });

    await expect(result).rejects.toMatchObject({
      operation: "desktop.startup",
      reason: "desktop-shutdown",
    });
    expect(events).toEqual([
      "readiness",
      "startup-diagnostics",
      "reject:desktop-shutdown",
      "cleanup:startup-failure",
      "failure-surface",
      "finalize",
    ]);
  });

  it("rejects renderer calls before cleaning up a partially started desktop", async () => {
    const events: string[] = [];
    const startupFailure = new Error("window failed");

    await expect(
      runDesktopBootstrap({
        awaitReadiness: async () => {
          events.push("readiness");
        },
        acquireFacades: async () => {
          events.push("facades");
          return { healthy: true };
        },
        startDesktop: async (facades) => {
          expect(facades).toEqual({ healthy: true });
          events.push("desktop");
          throw startupFailure;
        },
        rejectRendererCalls: () => {
          events.push("reject");
        },
        cleanup: async (reason) => {
          events.push(`cleanup:${reason}`);
        },
        showStartupFailure: async () => {
          events.push("failure-surface");
        },
      }),
    ).rejects.toMatchObject({ reason: "desktop-shutdown" });
    expect(events).toEqual([
      "readiness",
      "facades",
      "desktop",
      "reject",
      "cleanup:startup-failure",
      "failure-surface",
    ]);
  });

  it("keeps the normalized startup error authoritative when cleanup, UI, and diagnostics fail", async () => {
    const auxiliaryFailures: string[] = [];
    const result = runDesktopBootstrap({
      awaitReadiness: async () => {
        throw new Error("readiness failed");
      },
      acquireFacades: async () => ({}),
      startDesktop: async () => {},
      onStartupFailure: () => {
        throw new Error("startup diagnostics failed");
      },
      rejectRendererCalls: () => {
        throw new Error("renderer rejection failed");
      },
      cleanup: async (reason) => {
        throw new Error(`cleanup failed: ${reason}`);
      },
      showStartupFailure: async () => {
        throw new Error("dialog failed");
      },
      finalizeFailure: () => {
        throw new Error("finalization failed");
      },
      onAuxiliaryFailure: (error, phase) => {
        auxiliaryFailures.push(`${phase}:${String(error)}`);
        throw new Error(`diagnostics failed: ${phase}`);
      },
    });

    await expect(result).rejects.toMatchObject({
      operation: "desktop.startup",
      reason: "desktop-shutdown",
    });
    expect(auxiliaryFailures).toEqual([
      "startup-diagnostics:Error: startup diagnostics failed",
      "renderer-rejection:Error: renderer rejection failed",
      "cleanup:Error: cleanup failed: startup-failure",
      "failure-surface:Error: dialog failed",
      "finalization:Error: finalization failed",
    ]);
  });

  it("returns the started desktop result without running failure cleanup", async () => {
    let cleanupCalls = 0;
    await expect(
      runDesktopBootstrap({
        awaitReadiness: async () => {},
        acquireFacades: async () => ({ healthy: true }),
        startDesktop: async () => "started" as const,
        rejectRendererCalls: () => {},
        cleanup: async () => {
          cleanupCalls += 1;
        },
        showStartupFailure: async () => {},
      }),
    ).resolves.toBe("started");
    expect(cleanupCalls).toBe(0);
  });
});
