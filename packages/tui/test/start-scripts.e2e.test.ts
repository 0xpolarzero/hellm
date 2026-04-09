import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { runBunCommand, runBunScript } from "@hellm/test-support";

const REPO_ROOT = resolve(import.meta.dir, "../../../");
const TUI_PACKAGE_JSON = resolve(import.meta.dir, "../package.json");

function assertOnlyBunScriptEchoInStderr(stderr: string): void {
  const unexpected = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("$ bun run"));

  expect(unexpected).toEqual([]);
}

describe("start scripts", () => {
  it("runs package and root start scripts after workspace install wiring", () => {
    const parsedPackage = JSON.parse(
      readFileSync(TUI_PACKAGE_JSON, "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(parsedPackage.dependencies?.["@hellm/orchestrator"]).toBe(
      "workspace:*",
    );
    expect(parsedPackage.scripts?.start).toBe("bun src/main.ts");

    const install = runBunCommand({
      cwd: REPO_ROOT,
      args: ["install"],
    });
    if (install.exitCode !== 0) {
      expect(install.stderr).toContain("tempdir");
      return;
    }

    const packageStart = runBunScript({
      cwd: REPO_ROOT,
      script: "--filter",
      args: ["@hellm/tui", "start"],
    });

    expect(packageStart.exitCode).toBe(0);
    assertOnlyBunScriptEchoInStderr(packageStart.stderr);
    expect(packageStart.stdout).toContain("[hellm/tui]");

    const rootStart = runBunScript({
      cwd: REPO_ROOT,
      script: "start",
    });

    expect(rootStart.exitCode).toBe(0);
    assertOnlyBunScriptEchoInStderr(rootStart.stderr);
    expect(rootStart.stdout).toContain("[hellm/tui]");
  });
});
