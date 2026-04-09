import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "bun:test";
import {
  createHellmRuntime,
  renderTuiFrame,
  type TuiProjection,
} from "@hellm/tui";
import { runBunModule, withTempWorkspace } from "../../../test-support/index.ts";

const TUI_ENTRY = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const REPO_ROOT = resolve(import.meta.dir, "../../../");

function stripTerminalOutput(output: string): string {
  return stripVTControlCharacters(output).replace(/\r/g, "");
}

async function observeInteractiveTui(launchCwd: string): Promise<{
  alive: boolean;
  stdout: string;
  stderr: string;
}> {
  const bunBinary = Bun.which("bun") ?? process.execPath;
  const proc = Bun.spawn([bunBinary, TUI_ENTRY], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      HELLM_CWD: launchCwd,
      NO_COLOR: "1",
    },
  });

  const status = await Promise.race([
    proc.exited.then(() => "exited" as const),
    Bun.sleep(1500).then(() => "alive" as const),
  ]);

  if (status === "alive") {
    proc.kill("SIGINT");
  }

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    alive: status === "alive",
    stdout: stripTerminalOutput(stdout),
    stderr: stripTerminalOutput(stderr),
  };
}

describe("@hellm/tui frame and runtime bootstrap", () => {
  it("truncates wide content and respects viewport height without snapshots", () => {
    const projection: TuiProjection = {
      threadsPane: ["thread a", "status completed"],
      episodeInspector: [
        "episode one",
        "conclusion this is a deliberately long line that should be truncated",
      ],
      verificationPanel: ["overall passed"],
      workflowActivity: ["workflow none"],
      footer: ["session /repo"],
    };

    const frame = renderTuiFrame(projection, { width: 24, height: 7 });

    expect(frame).toHaveLength(7);
    expect(frame[0]).toBe("[threads]");
    expect(frame.some((line) => line.endsWith("..."))).toBe(true);
    expect(frame).not.toContain("[footer]");
  });

  it("creates a pi-owned runtime with hellm commands registered", async () => {
    await withTempWorkspace(async (workspace) => {
      const originalCwd = process.cwd();
      const runtime = await createHellmRuntime({
        cwd: workspace.root,
      });

      try {
        const commands =
          runtime.session.extensionRunner
            ?.getRegisteredCommands()
            .map((command) => command.invocationName)
            .toSorted() ?? [];

        expect(runtime.cwd).toBe(workspace.root);
        expect(commands).toEqual(["reconcile", "threads", "verify"]);
      } finally {
        await runtime.dispose();
        if (process.cwd() !== originalCwd) {
          process.chdir(originalCwd);
        }
      }
    });
  });

  it("bootstraps the real pi runtime in init-only mode as a real process", async () => {
    await withTempWorkspace(async (workspace) => {
      const result = runBunModule({
        entryPath: TUI_ENTRY,
        cwd: REPO_ROOT,
        args: ["--init-only"],
        env: {
          HELLM_CWD: workspace.root,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout).toContain(`[hellm/tui] pi-runtime ${workspace.root}`);
      expect(result.stdout).toContain("[hellm/tui] hellm-commands");
      expect(result.stdout).toContain("/threads");
      expect(result.stdout).toContain("/reconcile");
      expect(result.stdout).toContain("/verify");
    });
  });

  it("keeps the pi-owned interactive shell alive instead of printing a demo and exiting", async () => {
    await withTempWorkspace(async (workspace) => {
      const result = await observeInteractiveTui(workspace.root);

      expect(result.alive).toBe(true);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout).toContain("ctrl+c twice");
      expect(result.stdout).toContain("/ for commands");
      expect(result.stdout).toContain("[threads-overview]");
      expect(result.stdout).toContain("no active thread");
    });
  });
});
