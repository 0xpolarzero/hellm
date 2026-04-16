import { describe, expect, it } from "bun:test";
import {
  buildVerificationSummary,
  displayCommand,
  formatVerificationBody,
  runVerificationBridge,
} from "./verification-bridge";

describe("verification bridge", () => {
  it("formats verification summaries and bodies from command outcomes", () => {
    expect(buildVerificationSummary("test", "passed", 0)).toBe("test verification passed.");
    expect(buildVerificationSummary("lint", "failed", 1)).toBe(
      "lint verification failed (exit 1).",
    );
    expect(buildVerificationSummary("integration", "cancelled", 130)).toBe(
      "integration verification cancelled.",
    );
    expect(displayCommand(["bun", "test", "--", "src/app.test.ts"])).toBe(
      "bun test -- src/app.test.ts",
    );

    expect(
      formatVerificationBody({
        kind: "test",
        command: "bun test -- src/app.test.ts",
        status: "failed",
        exitCode: 1,
        stdout: "stdout line\n",
        stderr: "stderr line\n",
        launched: true,
        cancelled: true,
        signal: "SIGTERM",
      }),
    ).toContain("status: failed");
  });

  it("runs a launched verification command and captures stdout and stderr", async () => {
    const result = await runVerificationBridge({
      command: [
        process.execPath,
        "-e",
        "console.log('verification stdout'); console.error('verification stderr');",
      ],
      cwd: process.cwd(),
    });

    expect(result).toEqual(
      expect.objectContaining({
        launched: true,
        exitCode: 0,
        cancelled: false,
      }),
    );
    if (!result.launched) {
      throw new Error("Expected a launched verification result.");
    }

    expect(result.stdout).toContain("verification stdout");
    expect(result.stderr).toContain("verification stderr");
  });

  it("reports launch failures without fabricating a run", async () => {
    const result = await runVerificationBridge({
      command: ["/definitely/missing-svvy-verification-runner"],
    });

    expect(result.launched).toBe(false);
    if (result.launched) {
      throw new Error("Expected a launch failure result.");
    }

    expect(result.error.message.length).toBeGreaterThan(0);
  });
});
