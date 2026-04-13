import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { connect, type Driver, type Page } from "electrobun-browser-tools";
import { resolveElectrobunLauncherPath } from "../scripts/electrobun-paths";
import { DEFAULT_CHAT_SETTINGS } from "../src/mainview/chat-settings";
import { createHomeDir, ensureBuilt, launchHellmApp, type HellmApp } from "./harness";
import { withTransientLinuxLaunchRetries } from "./launch-retry";
import { assistantTextMessage, seedSessions, userMessage, writeE2eControl } from "./support";

setDefaultTimeout(60_000);

const APP_START_TIMEOUT_MS = 30_000;
const DRIVER_CONNECT_TIMEOUT_MS = 20_000;
const INITIAL_BRANCH = "bootstrap-main";
const UPDATED_BRANCH = "bootstrap-updated";

type LaunchableApp = {
  driver: Driver;
  page: Page;
  homeDir: string;
  proc: ReturnType<typeof Bun.spawn>;
  appPid: number | null;
  close: () => Promise<void>;
};

beforeAll(async () => {
  await ensureBuilt();
});

async function createWorkspaceDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
}

async function withHomeDir<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function withWorkspaceDir<T>(
  fn: (workspaceDir: string) => Promise<T>,
  prefix = "hellm-e2e-workspace-",
): Promise<T> {
  const workspaceDir = await createWorkspaceDir(prefix);
  try {
    return await fn(workspaceDir);
  } finally {
    await rm(workspaceDir, { force: true, recursive: true });
  }
}

function resolveLauncherPath(): string {
  return resolveElectrobunLauncherPath(process.cwd());
}

function createRuntimeEnv(
  homeDir: string,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const xdgConfigHome = join(homeDir, ".config");
  const xdgDataHome = join(homeDir, ".local", "share");
  const xdgCacheHome = join(homeDir, ".cache");
  const xdgStateHome = join(homeDir, ".state");
  const tmpDir = join(homeDir, ".tmp");

  return {
    ...process.env,
    CI: "1",
    HOME: homeDir,
    TMPDIR: tmpDir,
    XDG_CACHE_HOME: xdgCacheHome,
    XDG_CONFIG_HOME: xdgConfigHome,
    XDG_DATA_HOME: xdgDataHome,
    XDG_STATE_HOME: xdgStateHome,
    ...overrides,
  };
}

async function waitForBridgeMetadata(
  proc: ReturnType<typeof Bun.spawn>,
  stdout: string[],
  stderr: string[],
): Promise<{ appId: string; bridgeUrl: string | null }> {
  let settled = false;

  return await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(
        new Error(
          formatAppFailure("Timed out waiting for hellm bridge metadata.", proc, stdout, stderr),
        ),
      );
    }, APP_START_TIMEOUT_MS);

    const finish = (value: { appId: string; bridgeUrl: string | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(value);
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      reject(new Error(formatAppFailure(message, proc, stdout, stderr)));
    };

    void pumpLines(proc.stdout, (line) => {
      stdout.push(line);
      const match = line.match(/^hellm bridge:\s*(\{.*\})$/);
      if (!match) return;

      try {
        const parsed = JSON.parse(match[1] as string) as {
          appId?: string;
          bridgeUrl?: string | null;
        };

        if (!parsed.appId) {
          fail("hellm bridge metadata did not include an appId.");
          return;
        }

        finish({
          appId: parsed.appId,
          bridgeUrl: parsed.bridgeUrl ?? null,
        });
      } catch (error) {
        fail(error instanceof Error ? error.message : "Failed to parse hellm bridge metadata.");
      }
    }).catch((error) => fail(error instanceof Error ? error.message : String(error)));

    void pumpLines(proc.stderr, (line) => {
      stderr.push(line);
    }).catch(() => {});

    void proc.exited.then((exitCode) => {
      if (settled) return;
      fail(`hellm exited before the bridge became available (exit code ${exitCode}).`);
    });
  });
}

async function launchObservedApp(options: {
  bootstrapDelayMs?: number;
  bootstrapError?: string;
  beforeLaunch?: (context: {
    homeDir: string;
    runtimeEnv: NodeJS.ProcessEnv;
    workspaceDir: string;
  }) => Promise<void> | void;
  workspaceDir: string;
}): Promise<LaunchableApp> {
  await ensureBuilt();

  return await withTransientLinuxLaunchRetries("launchObservedApp", async () => {
    const homeDir = await createHomeDir();

    try {
      return await launchObservedAppOnce(options, homeDir);
    } catch (error) {
      await rm(homeDir, { force: true, recursive: true });
      throw error;
    }
  });
}

async function launchObservedAppOnce(
  options: {
    bootstrapDelayMs?: number;
    bootstrapError?: string;
    beforeLaunch?: (context: {
      homeDir: string;
      runtimeEnv: NodeJS.ProcessEnv;
      workspaceDir: string;
    }) => Promise<void> | void;
    workspaceDir: string;
  },
  homeDir: string,
): Promise<LaunchableApp> {
  const launcherPath = resolveLauncherPath();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let driver: Driver | null = null;
  let appPid: number | null = null;

  await Promise.all([
    mkdir(join(homeDir, ".config"), { recursive: true }),
    mkdir(join(homeDir, ".local"), { recursive: true }),
    mkdir(join(homeDir, ".cache"), { recursive: true }),
    mkdir(join(homeDir, ".state"), { recursive: true }),
    mkdir(join(homeDir, ".tmp"), { recursive: true }),
  ]);

  const controlFile = await writeE2eControl(homeDir, {
    ...(typeof options.bootstrapDelayMs === "number"
      ? { bootstrapDelayMs: options.bootstrapDelayMs }
      : {}),
    ...(options.bootstrapError ? { bootstrapError: options.bootstrapError } : {}),
    workspaceCwd: options.workspaceDir,
  });

  await options.beforeLaunch?.({
    homeDir,
    runtimeEnv: createRuntimeEnv(homeDir, {
      HELLM_E2E_CONTROL_PATH: controlFile,
    }),
    workspaceDir: options.workspaceDir,
  });

  try {
    proc = Bun.spawn([launcherPath], {
      cwd: dirname(launcherPath),
      env: createRuntimeEnv(homeDir, {
        HELLM_E2E_CONTROL_PATH: controlFile,
      }),
      stdout: "pipe",
      stderr: "pipe",
    });

    const bridge = await waitForBridgeMetadata(proc, stdout, stderr);
    driver = await connect({
      ...(bridge.bridgeUrl ? { url: bridge.bridgeUrl } : { app: bridge.appId }),
      timeout: DRIVER_CONNECT_TIMEOUT_MS,
    });
    appPid = await resolveAppPid(driver);

    return {
      driver,
      page: driver.page("active"),
      homeDir,
      proc,
      appPid,
      close: async () => {
        await closeObservedApp(driver, proc, appPid);
        await rm(homeDir, { force: true, recursive: true });
      },
    };
  } catch (error) {
    if (driver && proc) {
      try {
        await closeObservedApp(driver, proc, appPid);
      } catch {
        // Ignore cleanup failures while unwinding a failed launch.
      }
    } else if (proc) {
      await terminateTrackedProcesses(buildTrackedPidList(proc.pid), proc);
    }

    throw new Error(
      formatAppFailure(
        error instanceof Error ? error.message : String(error),
        proc,
        stdout,
        stderr,
      ),
      { cause: error },
    );
  }
}

async function launchWorkspaceApp(options: {
  homeDir?: string;
  workspaceDir: string;
}): Promise<HellmApp> {
  return await launchHellmApp({
    homeDir: options.homeDir,
    workspaceDir: options.workspaceDir,
    beforeLaunch: async ({ homeDir, runtimeEnv }) => {
      const controlFile = await writeE2eControl(homeDir, {
        workspaceCwd: options.workspaceDir,
      });
      runtimeEnv.HELLM_E2E_CONTROL_PATH = controlFile;
    },
  });
}

async function launchWorkspaceAppWithBootstrapError(options: {
  workspaceDir: string;
  bootstrapError: string;
}): Promise<LaunchableApp> {
  return await launchObservedApp({
    bootstrapError: options.bootstrapError,
    workspaceDir: options.workspaceDir,
  });
}

async function waitForWorkspaceChrome(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
  await page.locator(".workspace-titlebar").waitFor({ state: "visible" });
  await page.locator(".workspace-footer").waitFor({ state: "visible" });
}

async function waitForLoadingCard(page: Page): Promise<void> {
  await page.getByText("Starting hellm").waitFor({ state: "visible" });
}

async function waitForStartupErrorCard(page: Page, message: string): Promise<void> {
  await page.getByText("Startup failed").waitFor({ state: "visible" });
  await page.getByText(message).waitFor({ state: "visible" });
}

async function currentText(page: Page, selector: string): Promise<string> {
  return (await page.locator(selector).textContent())?.trim() ?? "";
}

async function sessionCountText(page: Page): Promise<string> {
  return (await currentText(page, ".sidebar-context")).replace(/\s+/g, " ").trim();
}

function formatAppFailure(
  errorMessage: string,
  proc: ReturnType<typeof Bun.spawn> | null,
  stdout: string[],
  stderr: string[],
): string {
  const parts = [errorMessage];
  if (proc) {
    parts.push(`pid=${proc.pid}`);
  }
  if (stdout.length > 0) {
    parts.push(`stdout=${stdout.join(" | ")}`);
  }
  if (stderr.length > 0) {
    parts.push(`stderr=${stderr.join(" | ")}`);
  }
  return parts.join("\n");
}

function listDescendantPids(rootPid: number): number[] {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    return [];
  }

  const pending = [rootPid];
  const seen = new Set<number>();
  const descendants: number[] = [];

  while (pending.length > 0) {
    const currentPid = pending.pop();
    if (!currentPid || seen.has(currentPid)) {
      continue;
    }
    seen.add(currentPid);

    let output = "";
    try {
      const result = spawnSync("pgrep", ["-P", String(currentPid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (result.status !== 0) {
        continue;
      }
      output = result.stdout;
    } catch {
      continue;
    }

    for (const line of output.split("\n")) {
      const pid = Number(line.trim());
      if (!Number.isInteger(pid) || pid <= 0 || seen.has(pid)) {
        continue;
      }
      descendants.push(pid);
      pending.push(pid);
    }
  }

  return descendants;
}

function signalPidList(pids: number[], signal: "SIGTERM" | "SIGKILL"): void {
  const command = signal === "SIGKILL" ? "-KILL" : "-TERM";

  for (const pid of pids) {
    try {
      spawnSync("kill", [command, String(pid)], {
        stdio: "ignore",
      });
    } catch {
      // Ignore already-exited descendants.
    }
  }
}

function buildTrackedPidList(...rootPids: Array<number | null | undefined>): number[] {
  const tracked = new Set<number>();

  for (const rootPid of rootPids) {
    if (!Number.isInteger(rootPid) || rootPid <= 0) {
      continue;
    }

    tracked.add(rootPid);
    for (const descendantPid of listDescendantPids(rootPid)) {
      tracked.add(descendantPid);
    }
  }

  return [...tracked];
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    const result = spawnSync("kill", ["-0", String(pid)], {
      stdio: "ignore",
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

async function waitForExit(
  proc: ReturnType<typeof Bun.spawn>,
  timeoutMs: number,
): Promise<number | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      proc.exited,
      new Promise<null>((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function waitForPidListExit(pids: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (pids.every((pid) => !isPidAlive(pid))) {
      return true;
    }
    await Bun.sleep(100);
  }

  return pids.every((pid) => !isPidAlive(pid));
}

async function terminateTrackedProcesses(
  trackedPids: number[],
  proc: ReturnType<typeof Bun.spawn>,
): Promise<void> {
  if (trackedPids.length === 0) {
    return;
  }

  signalPidList(trackedPids, "SIGTERM");
  await Promise.all([waitForExit(proc, 2_000), waitForPidListExit(trackedPids, 3_000)]);

  if (trackedPids.every((pid) => !isPidAlive(pid))) {
    return;
  }

  signalPidList(trackedPids, "SIGKILL");
  await Promise.all([waitForExit(proc, 2_000), waitForPidListExit(trackedPids, 2_000)]);
}

async function resolveAppPid(driver: Driver): Promise<number | null> {
  try {
    const doctor = await driver.doctor();
    const pid = doctor?.app?.pid;
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function closeObservedApp(
  driver: Driver,
  proc: ReturnType<typeof Bun.spawn>,
  appPid: number | null,
): Promise<void> {
  try {
    await driver.close();
  } catch {
    // Ignore bridge teardown errors during shutdown.
  }

  await terminateTrackedProcesses(buildTrackedPidList(proc.pid, appPid), proc);
}

async function pumpLines(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream) return;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        onLine(buffer.slice(0, newlineIndex).replace(/\r$/, ""));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      onLine(buffer.replace(/\r$/, ""));
    }
    reader.releaseLock();
  }
}

test("shows the loading card during bootstrap and clears it once the shell is ready", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchObservedApp({
      bootstrapDelayMs: 1_000,
      workspaceDir,
      beforeLaunch: async ({ homeDir, workspaceDir: launchWorkspaceDir }) => {
        const base = Date.now() - 10_000;
        await seedSessions(
          homeDir,
          Array.from({ length: 150 }, (_, index) => {
            const timestamp = base + index * 100;
            const title = `Bootstrap session ${String(index + 1).padStart(2, "0")}`;
            return {
              key: `session-${index + 1}`,
              title,
              messages: [
                userMessage(`Seed prompt ${index + 1}`, timestamp),
                assistantTextMessage(`Seed response ${index + 1}`, { timestamp: timestamp + 1 }),
              ],
            };
          }),
          launchWorkspaceDir,
        );
      },
    });
    try {
      await waitForLoadingCard(app.page);
      expect(await app.page.getByText("Starting hellm").isVisible()).toBe(true);
      expect(await app.page.getByRole("button", { name: "Open settings" }).isVisible()).toBe(false);

      await waitForWorkspaceChrome(app.page);
      expect(await app.page.getByRole("button", { name: "Open settings" }).isVisible()).toBe(true);
      expect(await app.page.getByText("Starting hellm").isVisible()).toBe(false);
    } finally {
      await app.close();
    }
  });
});

test("shows the startup error card when Bun bootstrap is forced to fail", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const bootstrapError = "Forced bootstrap failure from the e2e control file.";
    const app = await launchWorkspaceAppWithBootstrapError({
      workspaceDir,
      bootstrapError,
    });

    try {
      await waitForStartupErrorCard(app.page, bootstrapError);
      expect(await app.page.getByRole("button", { name: "Open settings" }).count()).toBe(0);
      expect(await app.page.getByText("Starting hellm").count()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

test("workspace identity follows the cwd override and git branch", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    runGit(workspaceDir, ["init"]);
    runGit(workspaceDir, ["checkout", "-b", INITIAL_BRANCH]);
    await writeFile(join(workspaceDir, "README.md"), "bootstrap identity\n", "utf8");
    runGit(workspaceDir, ["config", "user.name", "Hellm E2E"]);
    runGit(workspaceDir, ["config", "user.email", "hellm-e2e@example.com"]);
    runGit(workspaceDir, ["add", "."]);
    runGit(workspaceDir, ["commit", "-m", "initial"]);

    const app = await launchWorkspaceApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);

      expect(await currentText(app.page, ".workspace-titlebar-title")).toBe("hellm");
      expect(await currentText(app.page, ".sidebar-header-copy h2")).toBe(basename(workspaceDir));
      expect(await sessionCountText(app.page)).toContain(INITIAL_BRANCH);
      expect(await sessionCountText(app.page)).toContain("1 sessions");
    } finally {
      await app.close();
    }
  });
});

test("workspace identity hides the branch badge outside a git repo", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchWorkspaceApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);

      expect(await currentText(app.page, ".sidebar-header-copy h2")).toBe(basename(workspaceDir));
      expect(await sessionCountText(app.page)).toBe("1 sessions");
      expect(await app.page.locator(".sidebar-context span").count()).toBe(1);
    } finally {
      await app.close();
    }
  });
});

test("default provider and model bootstrap from Bun-side defaults", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchWorkspaceApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);

      expect(await currentText(app.page, ".model-control strong")).toBe("GLM-5-Turbo");
      expect(await currentText(app.page, ".thinking-field strong")).toBe(
        DEFAULT_CHAT_SETTINGS.reasoningEffort,
      );
      expect(await currentText(app.page, ".workspace-main-title")).toBe("New Session");
      expect(await currentText(app.page, ".workspace-main-meta")).toContain("Ready");
    } finally {
      await app.close();
    }
  });
});

test("branch refreshes on relaunch when the git branch changes", async () => {
  await withHomeDir(async (homeDir) => {
    await withWorkspaceDir(async (workspaceDir) => {
      runGit(workspaceDir, ["init"]);
      runGit(workspaceDir, ["checkout", "-b", INITIAL_BRANCH]);
      await writeFile(join(workspaceDir, "README.md"), "branch refresh\n", "utf8");
      runGit(workspaceDir, ["config", "user.name", "Hellm E2E"]);
      runGit(workspaceDir, ["config", "user.email", "hellm-e2e@example.com"]);
      runGit(workspaceDir, ["add", "."]);
      runGit(workspaceDir, ["commit", "-m", "initial"]);

      const firstLaunch = await launchWorkspaceApp({ homeDir, workspaceDir });
      try {
        await waitForWorkspaceChrome(firstLaunch.page);
        expect(await currentText(firstLaunch.page, ".sidebar-context")).toContain(INITIAL_BRANCH);
      } finally {
        await firstLaunch.close();
      }

      runGit(workspaceDir, ["checkout", "-b", UPDATED_BRANCH]);

      const secondLaunch = await launchWorkspaceApp({ homeDir, workspaceDir });
      try {
        await waitForWorkspaceChrome(secondLaunch.page);
        expect(await currentText(secondLaunch.page, ".sidebar-context")).toContain(UPDATED_BRANCH);
        expect(await currentText(secondLaunch.page, ".sidebar-context")).not.toContain(
          INITIAL_BRANCH,
        );
      } finally {
        await secondLaunch.close();
      }
    });
  });
});
