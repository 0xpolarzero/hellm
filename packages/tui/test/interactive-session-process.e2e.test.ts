import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "bun:test";
import { createTempWorkspace, runBunModule } from "../../../test-support/index.ts";

const TUI_ENTRY = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const REPO_ROOT = resolve(import.meta.dir, "../../../");

interface BootstrapObservation {
  alive: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function normalizeTerminalOutput(output: string): string {
  return stripVTControlCharacters(output).replace(/\r/g, "");
}

async function observeTuiBootstrap(input: {
  args?: string[];
  env?: Record<string, string | undefined>;
  settleMs?: number;
} = {}): Promise<BootstrapObservation> {
  const bunBinary = Bun.which("bun") ?? process.execPath;
  const proc = Bun.spawn([bunBinary, TUI_ENTRY, ...(input.args ?? [])], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...(input.env ?? {}),
    },
  });

  const alive = await Promise.race([
    proc.exited.then(() => false),
    Bun.sleep(input.settleMs ?? 1500).then(() => true),
  ]);

  if (alive) {
    proc.kill("SIGINT");
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    alive,
    exitCode,
    stdout: normalizeTerminalOutput(stdout),
    stderr: normalizeTerminalOutput(stderr),
  };
}

describe("@hellm/tui interactive process bootstrap", () => {
  it("boots the real pi runtime from the product entrypoint and exposes the baseline shell surface in init-only mode", async () => {
    const workspace = await createTempWorkspace("hellm-tui-bootstrap-");

    try {
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
      expect(result.stdout).toContain(
        `[hellm/tui] pi-runtime ${workspace.root}`,
      );
      expect(result.stdout).toContain(
        "[hellm/tui] hellm-commands /threads,/reconcile,/verify",
      );
      expect(result.stdout).not.toContain("thread demo");
      expect(result.stdout).not.toContain("workflow none");
    } finally {
      await workspace.cleanup();
    }
  });

  it("prefers --cwd over HELLM_CWD and INIT_CWD during real process startup", async () => {
    const cliWorkspace = await createTempWorkspace("hellm-tui-cli-cwd-");
    const envWorkspace = await createTempWorkspace("hellm-tui-env-cwd-");
    const initWorkspace = await createTempWorkspace("hellm-tui-init-cwd-");

    try {
      const result = runBunModule({
        entryPath: TUI_ENTRY,
        cwd: REPO_ROOT,
        args: ["--init-only", "--cwd", cliWorkspace.root],
        env: {
          HELLM_CWD: envWorkspace.root,
          INIT_CWD: initWorkspace.root,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout).toContain(
        `[hellm/tui] pi-runtime ${cliWorkspace.root}`,
      );
      expect(result.stdout).not.toContain(envWorkspace.root);
      expect(result.stdout).not.toContain(initWorkspace.root);
    } finally {
      await Promise.all([
        cliWorkspace.cleanup(),
        envWorkspace.cleanup(),
        initWorkspace.cleanup(),
      ]);
    }
  });

  it("keeps the pi-hosted interactive shell alive instead of exiting after a demo snapshot", async () => {
    const workspace = await createTempWorkspace("hellm-tui-interactive-");

    try {
      const result = await observeTuiBootstrap({
        env: {
          HELLM_CWD: workspace.root,
        },
      });

      expect(result.alive).toBe(true);
      expect(result.stderr.trim()).toBe("");
      expect(result.stdout).toContain("ctrl+c twice");
      expect(result.stdout).toContain("/ for commands");
      expect(result.stdout).toContain("[threads-overview]");
      expect(result.stdout).toContain("no active thread");
      expect(result.stdout).not.toContain("thread demo");
    } finally {
      await workspace.cleanup();
    }
  });

  it("honors the package-manager cwd fallback when neither --cwd nor HELLM_CWD is provided", async () => {
    const initWorkspace = await createTempWorkspace("hellm-tui-package-cwd-");
    const sentinelWorkspace = await createTempWorkspace("hellm-tui-sentinel-cwd-");

    try {
      const result = runBunModule({
        entryPath: TUI_ENTRY,
        cwd: REPO_ROOT,
        args: ["--init-only"],
        env: {
          INIT_CWD: initWorkspace.root,
          npm_config_local_prefix: sentinelWorkspace.root,
        },
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        `[hellm/tui] pi-runtime ${initWorkspace.root}`,
      );
      expect(result.stdout).not.toContain(sentinelWorkspace.root);
    } finally {
      await Promise.all([
        initWorkspace.cleanup(),
        sentinelWorkspace.cleanup(),
      ]);
    }
  });
});
