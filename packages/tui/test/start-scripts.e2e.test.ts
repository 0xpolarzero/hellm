import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import { runBunCommand, runBunScript, withTempWorkspace } from "../../../test-support/index.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../../");
const TUI_PACKAGE_JSON = resolve(import.meta.dir, "../package.json");

function assertOnlyBunScriptEchoInStderr(stderr: string): void {
  const unexpected = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("$ bun "));

  expect(unexpected).toEqual([]);
}

describe("start scripts", () => {
  it("runs package and root start scripts through pi init-only boot", async () => {
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

    await withTempWorkspace(async (workspace) => {
      const env = {
        HELLM_TUI_INIT_ONLY: "1",
        HELLM_CWD: workspace.root,
      };

      const packageStart = runBunScript({
        cwd: REPO_ROOT,
        script: "--filter",
        args: ["@hellm/tui", "start"],
        env,
      });

      expect(packageStart.exitCode).toBe(0);
      assertOnlyBunScriptEchoInStderr(packageStart.stderr);
      expect(packageStart.stdout).toContain(`[hellm/tui] pi-runtime ${workspace.root}`);
      expect(packageStart.stdout).toContain("/threads");
      expect(packageStart.stdout).toContain("/reconcile");
      expect(packageStart.stdout).toContain("/verify");

      const rootStart = runBunScript({
        cwd: REPO_ROOT,
        script: "start",
        env,
      });

      expect(rootStart.exitCode).toBe(0);
      assertOnlyBunScriptEchoInStderr(rootStart.stderr);
      expect(rootStart.stdout).toContain(`[hellm/tui] pi-runtime ${workspace.root}`);
      expect(rootStart.stdout).toContain("/threads");
      expect(rootStart.stdout).toContain("/reconcile");
      expect(rootStart.stdout).toContain("/verify");
    });
  });
});
