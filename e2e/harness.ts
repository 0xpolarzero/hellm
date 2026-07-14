import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { connect, type Driver } from "electrobun-browser-tools";
import {
  createIsolatedHomeDir,
  createJsonBridgeMetadataParser,
  launchElectrobunApp,
  resolveElectrobunAppCodeDir,
  resolveElectrobunBuildTargetDir,
  resolveElectrobunLauncherPath,
  resolveElectrobunPlatform,
  resolveElectrobunWorkspaceDir,
  runCommand,
  type LaunchedElectrobunApp,
} from "electrobun-e2e";
import electrobunConfig from "../electrobun.config";
import electrobunE2EConfig from "../electrobun-e2e.config";
import { captureFailureDiagnostics, captureStartupFailureDiagnostics } from "./diagnostics";

const PROJECT_DIR = process.cwd();
const APP_WORKSPACE_DIR = resolveElectrobunWorkspaceDir(PROJECT_DIR);
const FALLBACK_APP_ID = "svvy";
const FALLBACK_APP_READY_PATTERN = /^svvy desktop app started$/;
const PREPARED_HOME_SNAPSHOT_DIRNAME = ".svvy-e2e-launch-snapshot";
const PREPARED_HOME_DURABLE_ENTRY_NAMES = new Set([".config", ".local", ".state"]);
const PREPARED_HOME_DISPOSABLE_DIRECTORY_NAMES = [".cache", ".tmp"] as const;
const BUILD_FINGERPRINT_SCHEMA_VERSION = 1;
const BUILD_FINGERPRINT_PATH = join(PROJECT_DIR, "build", ".svvy-e2e-build-fingerprint.json");
const RUNNER_BUILD_STAMP_PATH = join(PROJECT_DIR, "build", ".electrobun-e2e-build-stamp");
// The browser-tools connection timeout is also its per-command transport timeout.
// Keep it above the longest explicit UI action timeout used by the e2e suite.
const BRIDGE_COMMAND_TIMEOUT_MS = 20_000;
const GRACEFUL_APP_QUIT_TIMEOUT_MS = 10_000;
const GRACEFUL_APP_QUIT_POLL_MS = 50;
const ELECTROBUN_RUNTIME_PORT_COLLISION = /\bPort \d+ in use, trying next port(?:\.\.\.)?/;
const ELECTROBUN_RENDERER_PROFILE_FAILURE = /Cannot create profile at path\b/;
const PI_NATIVE_CLIPBOARD_ADDON = "@mariozechner/clipboard-";
const LINUX_NATIVE_SESSION_LAUNCHER = join(PROJECT_DIR, "scripts", "launch-e2e-app.sh");
const NATIVE_SESSION_METADATA_FILENAME = ".svvy-e2e-native-session";

const parseBridgeMetadata = (() => {
  const parseJsonBridgeMetadata = createJsonBridgeMetadataParser("svvy bridge:");

  return (line: string) => {
    const metadata = parseJsonBridgeMetadata(line);
    if (metadata) {
      return metadata;
    }

    if (FALLBACK_APP_READY_PATTERN.test(line)) {
      return {
        appId: FALLBACK_APP_ID,
        bridgeUrl: null,
      };
    }

    return null;
  };
})();

const BRIDGE_METADATA = {
  metadataLabel: "svvy bridge metadata",
  parseLine: parseBridgeMetadata,
  processLabel: "svvy",
  startupTimeoutMs: 45_000,
} as const;

export const ROOT_WORKSPACE_DIR = APP_WORKSPACE_DIR;
export const PROJECT_ROOT_DIR = PROJECT_DIR;

export type SvvyApp = LaunchedElectrobunApp;

export type GracefulAppQuitEvidence = {
  exitPostcondition: "deadline-exceeded" | "observed" | "unavailable";
  pid: number | null;
  remainingPids: number[];
  request:
    | {
        requestId: string;
        requested: true;
        requestedAt: string;
      }
    | { error: string; requested: false };
  trackedPids: number[];
};

export interface SvvyAppLaunchOptions {
  beforeLaunch?: (context: {
    homeDir: string;
    runtimeEnv: NodeJS.ProcessEnv;
    workspaceDir: string;
  }) => Promise<void> | void;
  env?: Record<string, string | undefined>;
  homeDir?: string;
  openInitialWorkspace?: boolean;
  workspaceDir?: string;
}

export type E2EBuildFreshnessResult = "adopted-runner-build" | "fresh" | "rebuilt";

export interface E2EBuildFreshnessOptions {
  build: () => Promise<void>;
  buildFingerprintPath: string;
  buildInputPaths: readonly string[];
  cleanOutputPaths: readonly string[];
  log?: (message: string) => void;
  projectRoot: string;
  requiredArtifactPaths: readonly string[];
  runnerBuildStampPath: string;
}

interface BuildInputSnapshot {
  fingerprint: string;
  newestMtimeMs: number;
}

interface BuildFingerprintRecord {
  fingerprint: string;
  schemaVersion: typeof BUILD_FINGERPRINT_SCHEMA_VERSION;
}

let ensureBuiltPromise: Promise<void> | null = null;

export function ensureBuilt(): Promise<void> {
  const buildTargetDir = resolveElectrobunBuildTargetDir(PROJECT_DIR);
  const buildAppName = `${FALLBACK_APP_ID}-dev`;
  const platform = resolveElectrobunPlatform();
  const executableDir =
    platform === "darwin"
      ? join(buildTargetDir, `${buildAppName}.app`, "Contents", "MacOS")
      : join(buildTargetDir, buildAppName, "bin");
  const appCodeDir = resolveElectrobunAppCodeDir(buildTargetDir, buildAppName);
  const executableSuffix = platform === "win32" ? ".exe" : "";
  const nativeWrapperName =
    platform === "darwin"
      ? "libNativeWrapper.dylib"
      : platform === "win32"
        ? "libNativeWrapper.dll"
        : "libNativeWrapper.so";
  const e2eEmbeddedBunReceipt = join(buildTargetDir, buildAppName, "e2e-embedded-bun.json");
  const linuxCefArtifacts =
    platform === "linux" && electrobunConfig.build.linux?.bundleCEF
      ? [
          join(executableDir, "libcef.so"),
          join(executableDir, "cef", "libcef.so"),
          join(executableDir, "icudtl.dat"),
          join(executableDir, "v8_context_snapshot.bin"),
          join(executableDir, "locales", "en-US.pak"),
          join(executableDir, "bun Helper (Renderer)"),
        ]
      : [];

  ensureBuiltPromise ??= ensureFreshElectrobunBuild({
    build: async () => {
      await runCommand(
        electrobunE2EConfig.buildCommand ?? [process.execPath, "run", "build:dev"],
        PROJECT_DIR,
      );
    },
    buildFingerprintPath: BUILD_FINGERPRINT_PATH,
    buildInputPaths: electrobunE2EConfig.buildInputPaths ?? [],
    cleanOutputPaths: [join(PROJECT_DIR, "build"), join(PROJECT_DIR, "dist")],
    log: (message) => console.info(message),
    projectRoot: PROJECT_DIR,
    requiredArtifactPaths: [
      join(executableDir, `launcher${executableSuffix}`),
      join(executableDir, `bun${executableSuffix}`),
      join(executableDir, nativeWrapperName),
      join(dirname(appCodeDir), "main.js"),
      join(appCodeDir, "bun", "index.js"),
      join(appCodeDir, "views", "mainview", "index.html"),
      join(appCodeDir, "views", "mainview", "popout.html"),
      join(PROJECT_DIR, "dist", "index.html"),
      join(PROJECT_DIR, "dist", "popout.html"),
      ...linuxCefArtifacts,
      ...(platform === "linux" && process.arch === "x64" ? [e2eEmbeddedBunReceipt] : []),
    ],
    runnerBuildStampPath: RUNNER_BUILD_STAMP_PATH,
  }).then(() => undefined);
  return ensureBuiltPromise;
}

export async function ensureFreshElectrobunBuild(
  options: E2EBuildFreshnessOptions,
): Promise<E2EBuildFreshnessResult> {
  const snapshot = await captureBuildInputSnapshot(options.projectRoot, options.buildInputPaths);
  const artifactsPresent = await allPathsAreFiles(options.requiredArtifactPaths);
  const record = artifactsPresent
    ? await readBuildFingerprintRecord(options.buildFingerprintPath)
    : null;

  if (record?.fingerprint === snapshot.fingerprint) {
    options.log?.("E2E app bundle is fresh; build inputs match the verified bundle fingerprint.");
    return "fresh";
  }

  if (
    artifactsPresent &&
    !record &&
    (await runnerBuildStampCoversInputs(options.runnerBuildStampPath, snapshot.newestMtimeMs))
  ) {
    await writeBuildFingerprintRecord(options.buildFingerprintPath, snapshot.fingerprint);
    options.log?.(
      "E2E app bundle is fresh; adopted the OrbStack runner build and recorded its input fingerprint.",
    );
    return "adopted-runner-build";
  }

  const reason = !artifactsPresent
    ? "required build artifacts are missing"
    : record
      ? "build inputs changed"
      : "the existing bundle has no trustworthy freshness record";
  options.log?.(`E2E app bundle is stale (${reason}); rebuilding before launch.`);

  await Promise.all(
    options.cleanOutputPaths.map((path) => rm(path, { force: true, recursive: true })),
  );
  await options.build();

  if (!(await allPathsAreFiles(options.requiredArtifactPaths))) {
    throw new Error(
      `E2E build completed without all required artifact files: ${options.requiredArtifactPaths.join(", ")}`,
    );
  }

  const builtSnapshot = await captureBuildInputSnapshot(
    options.projectRoot,
    options.buildInputPaths,
  );
  await writeBuildFingerprintRecord(options.buildFingerprintPath, builtSnapshot.fingerprint);
  options.log?.("E2E app bundle rebuild completed and its input fingerprint was recorded.");
  return "rebuilt";
}

async function captureBuildInputSnapshot(
  projectRoot: string,
  buildInputPaths: readonly string[],
): Promise<BuildInputSnapshot> {
  const hash = createHash("sha256");
  let newestMtimeMs = 0;
  const observeMtime = (mtimeMs: number) => {
    newestMtimeMs = Math.max(newestMtimeMs, mtimeMs);
  };

  for (const inputPath of new Set(buildInputPaths).values().toArray().toSorted()) {
    const absolutePath = resolve(projectRoot, inputPath);
    const label = relative(projectRoot, absolutePath).replaceAll("\\", "/");
    await hashBuildInputPath(absolutePath, label, hash, observeMtime);
  }

  return { fingerprint: hash.digest("hex"), newestMtimeMs };
}

async function hashBuildInputPath(
  absolutePath: string,
  label: string,
  hash: ReturnType<typeof createHash>,
  observeMtime: (mtimeMs: number) => void,
): Promise<void> {
  const info = await lstat(absolutePath).catch((error: unknown) => {
    if (isFileNotFoundError(error)) return null;
    throw error;
  });
  if (!info) {
    hash.update(`missing\0${label}\0`);
    return;
  }

  observeMtime(info.mtimeMs);
  if (info.isSymbolicLink()) {
    hash.update(`symlink\0${label}\0${await readlink(absolutePath)}\0`);
    return;
  }
  if (info.isFile()) {
    hash.update(`file\0${label}\0${info.mode}\0`);
    hash.update(await readFile(absolutePath));
    hash.update("\0");
    return;
  }
  if (info.isDirectory()) {
    hash.update(`directory\0${label}\0${info.mode}\0`);
    const entries = await readdir(absolutePath);
    for (const entry of entries.toSorted()) {
      await hashBuildInputPath(join(absolutePath, entry), `${label}/${entry}`, hash, observeMtime);
    }
    return;
  }

  hash.update(`other\0${label}\0${info.mode}\0${info.size}\0`);
}

async function allPathsAreFiles(paths: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    paths.map(async (path) => {
      const info = await stat(path).catch((error: unknown) => {
        if (isFileNotFoundError(error)) return null;
        throw error;
      });
      return info?.isFile() === true;
    }),
  );
  return results.every(Boolean);
}

async function runnerBuildStampCoversInputs(
  runnerBuildStampPath: string,
  newestInputMtimeMs: number,
): Promise<boolean> {
  const runnerStamp = await stat(runnerBuildStampPath).catch((error: unknown) => {
    if (isFileNotFoundError(error)) return null;
    throw error;
  });
  return runnerStamp?.isFile() === true && runnerStamp.mtimeMs >= newestInputMtimeMs;
}

async function readBuildFingerprintRecord(path: string): Promise<BuildFingerprintRecord | null> {
  const source = await readFile(path, "utf8").catch((error: unknown) => {
    if (isFileNotFoundError(error)) return null;
    throw error;
  });
  if (source === null) return null;

  try {
    const value = JSON.parse(source) as Partial<BuildFingerprintRecord>;
    if (
      value.schemaVersion !== BUILD_FINGERPRINT_SCHEMA_VERSION ||
      typeof value.fingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.fingerprint)
    ) {
      return null;
    }
    return value as BuildFingerprintRecord;
  } catch {
    return null;
  }
}

async function writeBuildFingerprintRecord(path: string, fingerprint: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ schemaVersion: BUILD_FINGERPRINT_SCHEMA_VERSION, fingerprint })}\n`,
    );
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function createHomeDir(prefix = "svvy-e2e-home-"): Promise<string> {
  return await createIsolatedHomeDir(prefix);
}

export async function withSvvyApp<T>(
  options: SvvyAppLaunchOptions,
  fn: (app: SvvyApp) => Promise<T>,
): Promise<T>;
export async function withSvvyApp<T>(fn: (app: SvvyApp) => Promise<T>): Promise<T>;
export async function withSvvyApp<T>(
  optionsOrFn: SvvyAppLaunchOptions | ((app: SvvyApp) => Promise<T>),
  maybeFn?: (app: SvvyApp) => Promise<T>,
): Promise<T> {
  const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
  const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
  if (!fn) {
    throw new Error("withSvvyApp requires a test callback.");
  }

  const app = await launchSvvyApp(options);
  return await runWithSvvyApp(app, fn);
}

export async function runWithSvvyApp<T>(
  app: SvvyApp,
  fn: (app: SvvyApp) => Promise<T>,
  captureDiagnostics: typeof captureFailureDiagnostics = captureFailureDiagnostics,
): Promise<T> {
  let result: T;
  try {
    result = await fn(app);
    assertNoElectrobunRuntimePortCollision(app);
    assertNoElectrobunRendererProfileFailure(app);
  } catch (error) {
    try {
      const evidenceDir = await captureDiagnostics(app, error);
      console.error(`svvy e2e failure evidence: ${evidenceDir}`);
    } catch (diagnosticsError) {
      console.error(
        "svvy e2e failure evidence capture failed:",
        diagnosticsError instanceof Error ? diagnosticsError.stack : diagnosticsError,
      );
    }
    try {
      await app.close();
    } catch (cleanupError) {
      console.error(
        "svvy e2e app cleanup failed after the original test failure:",
        cleanupError instanceof Error ? cleanupError.stack : cleanupError,
      );
    }
    throw error;
  }

  await app.close();
  return result;
}

export async function launchSvvyApp(options: SvvyAppLaunchOptions = {}): Promise<SvvyApp> {
  const ownedHomeDir = options.homeDir ? null : await createHomeDir();
  const effectiveOptions = ownedHomeDir ? { ...options, homeDir: ownedHomeDir } : options;
  const readyDriver: { current: Driver | null } = { current: null };
  const launchOptions = createLaunchOptions(effectiveOptions, (driver) => {
    readyDriver.current = driver;
  });

  const app = await launchElectrobunApp(launchOptions).catch(async (error) => {
    await readyDriver.current?.close().catch(() => undefined);
    try {
      const evidenceDir = await captureStartupFailureDiagnostics({
        homeDir: effectiveOptions.homeDir!,
        thrownValue: error,
        workspaceDir: effectiveOptions.workspaceDir ?? APP_WORKSPACE_DIR,
      });
      console.error(`svvy e2e startup failure evidence: ${evidenceDir}`);
    } catch (diagnosticsError) {
      console.error(
        "svvy e2e startup failure evidence capture failed:",
        diagnosticsError instanceof Error ? diagnosticsError.stack : diagnosticsError,
      );
    }
    if (ownedHomeDir) {
      await rm(ownedHomeDir, { force: true, recursive: true });
    }
    throw error;
  });
  if (!readyDriver.current) {
    await app.close();
    if (ownedHomeDir) {
      await rm(ownedHomeDir, { force: true, recursive: true });
    }
    throw new Error("The Electrobun app reached readiness without a browser-tools driver.");
  }
  const readyApp = adoptReadyDriver(app, readyDriver.current, ownedHomeDir);
  try {
    assertNoElectrobunRuntimePortCollision(readyApp);
    assertNoElectrobunRendererProfileFailure(readyApp);
    await assertPiNativeClipboardAddonIsLazy(readyApp.driver);
    return readyApp;
  } catch (error) {
    try {
      const evidenceDir = await captureFailureDiagnostics(readyApp, error);
      console.error(`svvy e2e startup health failure evidence: ${evidenceDir}`);
    } catch (diagnosticsError) {
      console.error(
        "svvy e2e startup health evidence capture failed:",
        diagnosticsError instanceof Error ? diagnosticsError.stack : diagnosticsError,
      );
    }
    await readyApp.close().catch(() => undefined);
    throw error;
  }
}

export function assertNoElectrobunRuntimePortCollision(app: Pick<SvvyApp, "stdout">): void {
  const collision = app.stdout.find((line) => ELECTROBUN_RUNTIME_PORT_COLLISION.test(line));
  if (!collision) return;

  throw new Error(
    `The app initialized more than one Electrobun runtime in a single process: ${collision}`,
  );
}

export function assertNoElectrobunRendererProfileFailure(app: Pick<SvvyApp, "stdout">): void {
  const failure = app.stdout.find((line) => ELECTROBUN_RENDERER_PROFILE_FAILURE.test(line));
  if (!failure) return;

  throw new Error(`Electrobun could not initialize its persistent renderer profile: ${failure}`);
}

export async function assertPiNativeClipboardAddonIsLazy(
  driver: Pick<Driver, "doctor">,
): Promise<void> {
  if (process.platform !== "linux") return;

  const doctor = await driver.doctor();
  const processMaps = await readFile(`/proc/${doctor.app.pid}/maps`, "utf8");
  assertLinuxCefRendererIsLoaded(processMaps);
  assertPiNativeClipboardAddonIsAbsent(processMaps);
}

export function assertLinuxCefRendererIsLoaded(processMaps: string): void {
  if (processMaps.includes("libcef.so")) return;

  throw new Error(
    "The Linux app did not load its packaged CEF renderer; the validated desktop e2e lane must not fall back to WebKitGTK.",
  );
}

export function assertPiNativeClipboardAddonIsAbsent(processMaps: string): void {
  if (!processMaps.includes(PI_NATIVE_CLIPBOARD_ADDON)) return;

  throw new Error(
    "pi eagerly loaded its optional native clipboard addon before first use; this destabilizes Electrobun startup under Bun on Linux.",
  );
}

function adoptReadyDriver(app: SvvyApp, driver: Driver, ownedHomeDir: string | null): SvvyApp {
  const closeLaunchedApp = app.close;
  let closed = false;
  return {
    ...app,
    driver,
    page: driver.page("active"),
    close: async () => {
      if (closed) return;
      closed = true;
      const gracefulQuit = await requestGracefulAppQuit(driver);
      try {
        await closeLaunchedApp();
      } finally {
        console.info(`svvy e2e close: ${JSON.stringify(gracefulQuit)}`);
        if (ownedHomeDir) {
          await rm(ownedHomeDir, { force: true, recursive: true });
        }
      }
      assertGracefulAppQuitObserved(gracefulQuit);
    },
  };
}

export function assertGracefulAppQuitObserved(evidence: GracefulAppQuitEvidence): void {
  if (evidence.request.requested && evidence.exitPostcondition === "observed") return;

  throw new Error(
    `svvy did not complete app-owned graceful shutdown before launcher fallback cleanup: ${JSON.stringify(evidence)}`,
  );
}

export async function requestGracefulAppQuit(
  driver: Pick<Driver, "doctor" | "requestQuit">,
  options: {
    isProcessAlive?: (pid: number) => boolean;
    listTrackedPids?: (pid: number) => Promise<number[]>;
    now?: () => number;
    timeoutMs?: number;
    wait?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<GracefulAppQuitEvidence> {
  const isProcessAlive = options.isProcessAlive ?? isPidAlive;
  const listTrackedPids = options.listTrackedPids ?? listAppProcessTree;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? GRACEFUL_APP_QUIT_TIMEOUT_MS;
  const wait = options.wait ?? ((milliseconds) => Bun.sleep(milliseconds));
  let pid: number | null = null;
  let trackedPids: number[] = [];

  try {
    const doctor = await driver.doctor();
    pid = Number.isInteger(doctor.app.pid) && doctor.app.pid > 0 ? doctor.app.pid : null;
    if (pid !== null) {
      trackedPids = [...new Set(await listTrackedPids(pid))]
        .filter((candidate) => Number.isInteger(candidate) && candidate > 1)
        .toSorted((left, right) => left - right);
      if (!trackedPids.includes(pid)) trackedPids.push(pid);
    }
  } catch {
    // The trusted quit request remains useful even when PID discovery is unavailable.
  }

  let request: GracefulAppQuitEvidence["request"];
  try {
    request = await driver.requestQuit();
  } catch (error) {
    return {
      exitPostcondition: pid === null ? "unavailable" : "deadline-exceeded",
      pid,
      remainingPids: trackedPids.filter(isProcessAlive),
      request: {
        error: error instanceof Error ? error.message : String(error),
        requested: false,
      },
      trackedPids,
    };
  }

  if (pid === null) {
    return {
      exitPostcondition: "unavailable",
      pid,
      remainingPids: [],
      request,
      trackedPids: [],
    };
  }

  try {
    const deadline = now() + timeoutMs;
    let remainingPids = trackedPids.filter(isProcessAlive);
    while (remainingPids.length > 0 && now() < deadline) {
      await wait(Math.min(GRACEFUL_APP_QUIT_POLL_MS, Math.max(0, deadline - now())));
      remainingPids = trackedPids.filter(isProcessAlive);
    }
    return {
      exitPostcondition: remainingPids.length > 0 ? "deadline-exceeded" : "observed",
      pid,
      remainingPids,
      request,
      trackedPids,
    };
  } catch {
    return {
      exitPostcondition: "deadline-exceeded",
      pid,
      remainingPids: trackedPids.filter(isProcessAlive),
      request,
      trackedPids,
    };
  }
}

export async function listAppProcessTree(
  appPid: number,
  options: {
    readProcFile?: (path: string) => Promise<string>;
    testProcessPid?: number;
  } = {},
): Promise<number[]> {
  if (process.platform !== "linux") return [appPid];

  const readProcFile =
    options.readProcFile ??
    (async (path: string) => {
      return await readFile(path, "utf8");
    });
  const testProcessPid = options.testProcessPid ?? process.pid;
  const tracked = new Set<number>([appPid]);
  let launchRootPid = appPid;

  while (launchRootPid !== testProcessPid) {
    const status = await readProcFile(`/proc/${launchRootPid}/status`).catch((error: unknown) => {
      if (isFileNotFoundError(error)) return "";
      throw error;
    });
    const parentPid = Number.parseInt(/^PPid:\s+(\d+)$/m.exec(status)?.[1] ?? "", 10);
    if (!Number.isInteger(parentPid) || parentPid <= 1 || parentPid === testProcessPid) break;
    if (tracked.has(parentPid)) break;
    tracked.add(parentPid);
    launchRootPid = parentPid;
  }

  const visitChildren = async (pid: number): Promise<void> => {
    const children = await readProcFile(`/proc/${pid}/task/${pid}/children`).catch(
      (error: unknown) => {
        if (isFileNotFoundError(error)) return "";
        throw error;
      },
    );
    for (const child of children.trim().split(/\s+/)) {
      if (!child) continue;
      const childPid = Number.parseInt(child, 10);
      if (!Number.isInteger(childPid) || childPid <= 1) continue;
      if (!tracked.has(childPid)) tracked.add(childPid);
      await visitChildren(childPid);
    }
  };
  await visitChildren(launchRootPid);
  return [...tracked].toSorted((left, right) => left - right);
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}

function getPreparedHomeSnapshotDir(homeDir: string): string {
  return join(homeDir, PREPARED_HOME_SNAPSHOT_DIRNAME);
}

async function copyPreparedHomeEntry(sourcePath: string, destinationPath: string): Promise<void> {
  await cp(sourcePath, destinationPath, {
    filter: async (candidatePath) => {
      const candidate = await lstat(candidatePath);
      return candidate.isDirectory() || candidate.isFile();
    },
    recursive: true,
  });
}

export async function snapshotPreparedHomeDir(homeDir: string): Promise<void> {
  const snapshotDir = getPreparedHomeSnapshotDir(homeDir);
  await rm(snapshotDir, { force: true, recursive: true });
  await mkdir(snapshotDir, { recursive: true });

  const entries = await readdir(homeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!PREPARED_HOME_DURABLE_ENTRY_NAMES.has(entry.name)) {
      continue;
    }

    await copyPreparedHomeEntry(join(homeDir, entry.name), join(snapshotDir, entry.name));
  }
}

export async function restorePreparedHomeDir(homeDir: string): Promise<void> {
  const snapshotDir = getPreparedHomeSnapshotDir(homeDir);

  const entries = await readdir(homeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === PREPARED_HOME_SNAPSHOT_DIRNAME) {
      continue;
    }

    await rm(join(homeDir, entry.name), { force: true, recursive: true });
  }

  const snapshotEntries = await readdir(snapshotDir, { withFileTypes: true });
  for (const entry of snapshotEntries) {
    await copyPreparedHomeEntry(join(snapshotDir, entry.name), join(homeDir, entry.name));
  }

  await Promise.all(
    PREPARED_HOME_DISPOSABLE_DIRECTORY_NAMES.map((entryName) =>
      mkdir(join(homeDir, entryName), { recursive: true }),
    ),
  );
}

function createLaunchOptions(
  options: SvvyAppLaunchOptions,
  onReadyDriver: (driver: Driver) => void,
) {
  const workspaceDir = options.workspaceDir ?? APP_WORKSPACE_DIR;
  const realLauncherPath = resolveElectrobunLauncherPath(PROJECT_DIR);
  const nativeSessionMetadataPath = options.homeDir
    ? join(options.homeDir, NATIVE_SESSION_METADATA_FILENAME)
    : null;
  const preparedHomeDirs = new Set<string>();
  const env = {
    OPENAI_API_KEY: "svvy-e2e-openai-key",
    ZAI_API_KEY: "svvy-e2e-zai-key",
    ...options.env,
    ...(options.openInitialWorkspace === false ? {} : { SVVY_WORKSPACE_CWD: workspaceDir }),
    ...(process.platform === "linux" && nativeSessionMetadataPath
      ? {
          SVVY_E2E_NATIVE_SESSION_METADATA: nativeSessionMetadataPath,
          SVVY_E2E_REAL_LAUNCHER: realLauncherPath,
        }
      : {}),
  };

  return {
    beforeLaunch: async (context: {
      homeDir: string;
      runtimeEnv: NodeJS.ProcessEnv;
      workspaceDir: string;
    }) => {
      if (preparedHomeDirs.has(context.homeDir)) {
        await restorePreparedHomeDir(context.homeDir);
        return;
      }

      await options.beforeLaunch?.(context);
      await snapshotPreparedHomeDir(context.homeDir);
      preparedHomeDirs.add(context.homeDir);
    },
    bridgeMetadata: BRIDGE_METADATA,
    driverConnectTimeoutMs: BRIDGE_COMMAND_TIMEOUT_MS,
    env,
    homeDir: options.homeDir,
    launcherPath: process.platform === "linux" ? LINUX_NATIVE_SESSION_LAUNCHER : realLauncherPath,
    projectRoot: PROJECT_DIR,
    ready: async ({ appId, bridgeUrl }: { appId: string; bridgeUrl: string | null }) => {
      const driver = await connect({
        ...(bridgeUrl ? { url: bridgeUrl } : { app: appId }),
        timeout: BRIDGE_COMMAND_TIMEOUT_MS,
      });
      try {
        await waitForAppReady(driver);
        onReadyDriver(driver);
      } catch (error) {
        await driver.close().catch(() => undefined);
        throw error;
      }
    },
    workspaceDir,
  } as const;
}

export async function waitForAppReady(
  driver: Pick<Driver, "eventsWait" | "stateGet">,
): Promise<void> {
  const ready = await driver.eventsWait("app.ready", { timeout: 40_000 });
  if (!ready.matched || !ready.event) {
    throw new Error("Timed out waiting for the authoritative svvy app.ready event.");
  }

  const workspace = await driver.stateGet("workspace");
  if (
    workspace.namespace !== "workspace" ||
    !workspace.value ||
    typeof workspace.value !== "object" ||
    !("activeWorkspaceId" in workspace.value)
  ) {
    throw new Error("svvy app.ready fired before the workspace bridge state was readable.");
  }
}

export function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
