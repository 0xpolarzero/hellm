import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { connect, type Driver, type Page } from "electrobun-browser-tools";
import {
  resolveElectrobunBuildTargetDir,
  resolveElectrobunLauncherPath,
  resolveElectrobunWorkspaceDir,
} from "../scripts/electrobun-paths";
import { withTransientLinuxLaunchRetries } from "./launch-retry";

const PROJECT_DIR = process.cwd();
const APP_WORKSPACE_DIR = resolveElectrobunWorkspaceDir(PROJECT_DIR);
const BUN = process.execPath;
const APP_START_TIMEOUT_MS = 30_000;
const DRIVER_CONNECT_TIMEOUT_MS = 20_000;

let buildPromise: Promise<void> | null = null;

export const ROOT_WORKSPACE_DIR = APP_WORKSPACE_DIR;
export const PROJECT_ROOT_DIR = PROJECT_DIR;

export interface HellmApp {
  appId: string;
  bridgeUrl: string | null;
  driver: Driver;
  page: Page;
  homeDir: string;
  workspaceDir: string;
  stdout: string[];
  stderr: string[];
  close: () => Promise<void>;
}

export interface HellmAppLaunchOptions {
  beforeLaunch?: (context: {
    homeDir: string;
    runtimeEnv: NodeJS.ProcessEnv;
    workspaceDir: string;
  }) => Promise<void> | void;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  workspaceDir?: string;
}

export function ensureBuilt(): Promise<void> {
  if (buildPromise) {
    return buildPromise;
  }

  if (existsSync(resolveElectrobunBuildTargetDir(PROJECT_DIR))) {
    return Promise.resolve();
  }

  buildPromise = runCommand([BUN, "run", "build"], PROJECT_DIR).finally(() => {
    buildPromise = null;
  });
  return buildPromise;
}

export async function createHomeDir(prefix = "hellm-e2e-home-"): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

export async function withHellmApp<T>(
  options: HellmAppLaunchOptions,
  fn: (app: HellmApp) => Promise<T>,
): Promise<T>;
export async function withHellmApp<T>(fn: (app: HellmApp) => Promise<T>): Promise<T>;
export async function withHellmApp<T>(
  optionsOrFn: HellmAppLaunchOptions | ((app: HellmApp) => Promise<T>),
  maybeFn?: (app: HellmApp) => Promise<T>,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (!fn) {
    throw new Error("withHellmApp requires a test callback.");
  }

  const app = await launchHellmApp(options);
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

export async function launchHellmApp(options: HellmAppLaunchOptions = {}): Promise<HellmApp> {
  await ensureBuilt();

  const workspaceDir = options.workspaceDir ?? APP_WORKSPACE_DIR;
  const providedHomeDir = options.homeDir;
  const preparedRuntimeEnv = providedHomeDir
    ? createRuntimeEnv(providedHomeDir, {
        HELLM_E2E_WORKSPACE_CWD: workspaceDir,
        ...options.env,
      })
    : null;

  if (providedHomeDir && preparedRuntimeEnv) {
    await ensureHomeDirLayout(providedHomeDir);
    await options.beforeLaunch?.({
      homeDir: providedHomeDir,
      runtimeEnv: preparedRuntimeEnv,
      workspaceDir,
    });
  }

  return await withTransientLinuxLaunchRetries("launchHellmApp", async () => {
    const ownsHomeDir = !providedHomeDir;
    const homeDir = providedHomeDir ?? (await createHomeDir());
    const runtimeEnv =
      preparedRuntimeEnv ??
      createRuntimeEnv(homeDir, {
        HELLM_E2E_WORKSPACE_CWD: workspaceDir,
        ...options.env,
      });

    try {
      if (ownsHomeDir) {
        await ensureHomeDirLayout(homeDir);
        await options.beforeLaunch?.({
          homeDir,
          runtimeEnv,
          workspaceDir,
        });
      }

      return await launchHellmAppOnce({
        homeDir,
        ownsHomeDir,
        runtimeEnv,
        workspaceDir,
      });
    } catch (error) {
      if (ownsHomeDir) {
        await rm(homeDir, { force: true, recursive: true });
      }
      throw error;
    }
  });
}

async function launchHellmAppOnce(
  options: {
    homeDir: string;
    ownsHomeDir: boolean;
    runtimeEnv: NodeJS.ProcessEnv;
    workspaceDir: string;
  },
): Promise<HellmApp> {
  const launcherPath = resolveLauncherPath();
  const stdout: string[] = [];
  const stderr: string[] = [];
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let driver: Driver | null = null;
  let appPid: number | null = null;

  await ensureHomeDirLayout(options.homeDir);

  try {
    proc = Bun.spawn([launcherPath], {
      cwd: dirname(launcherPath),
      env: options.runtimeEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const bridge = await waitForBridgeMetadata(proc, stdout, stderr);
    driver = await connect({
      ...(bridge.bridgeUrl ? { url: bridge.bridgeUrl } : { app: bridge.appId }),
      timeout: DRIVER_CONNECT_TIMEOUT_MS,
    });
    appPid = await resolveAppPid(driver);
    const page = driver.page("active");
    await waitForWorkspaceChrome(page);

    return {
      appId: bridge.appId,
      bridgeUrl: bridge.bridgeUrl,
      driver,
      page,
      homeDir: options.homeDir,
      workspaceDir: options.workspaceDir,
      stdout,
      stderr,
      close: async () => {
        await closeApp(driver, proc, appPid);
        if (options.ownsHomeDir) {
          await rm(options.homeDir, { force: true, recursive: true });
        }
      },
    };
  } catch (error) {
    if (driver && proc) {
      try {
        await closeApp(driver, proc, appPid);
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

async function ensureHomeDirLayout(homeDir: string): Promise<void> {
  await Promise.all([
    mkdir(join(homeDir, ".config"), { recursive: true }),
    mkdir(join(homeDir, ".local"), { recursive: true }),
    mkdir(join(homeDir, ".cache"), { recursive: true }),
    mkdir(join(homeDir, ".state"), { recursive: true }),
    mkdir(join(homeDir, ".tmp"), { recursive: true }),
  ]);
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
          formatAppFailure(
            "Timed out waiting for hellm bridge metadata.",
            proc,
            stdout,
            stderr,
          ),
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

async function closeApp(
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

async function waitForWorkspaceChrome(page: Page): Promise<void> {
  const deadline = Date.now() + DRIVER_CONNECT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (await page.getByRole("button", { name: "Open settings" }).isVisible()) {
      return;
    }

    const startupFailed = page.getByText("Startup failed").first();
    if (await startupFailed.isVisible()) {
      const bootstrapText = (await page.locator(".ui-surface").textContent())?.replace(/\s+/g, " ").trim();
      throw new Error(`hellm renderer bootstrap failed: ${bootstrapText ?? "Startup failed"}`);
    }

    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for hellm workspace chrome.");
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

function resolveLauncherPath(): string {
  return resolveElectrobunLauncherPath(PROJECT_DIR);
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

async function runCommand(command: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd,
    env: {
      ...process.env,
      CI: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed (${exitCode}): ${command.join(" ")}`);
  }
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
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
        if (line) {
          onLine(line);
        }
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    }
  } finally {
    const trailing = buffer.replace(/\r$/, "").trimEnd();
    if (trailing) {
      onLine(trailing);
    }
    reader.releaseLock();
  }
}

function formatAppFailure(
  message: string,
  proc: ReturnType<typeof Bun.spawn> | null,
  stdout: string[],
  stderr: string[],
): string {
  const lines = [
    message,
    `exitCode=${proc?.exitCode ?? "null"}`,
    stdout.length > 0 ? `stdout:\n${stdout.join("\n")}` : "stdout: <empty>",
    stderr.length > 0 ? `stderr:\n${stderr.join("\n")}` : "stderr: <empty>",
  ];
  return lines.join("\n");
}

export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
