import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { Driver, Page } from "electrobun-browser-tools";
import { APP_LOG_DATABASE_FILENAME, redactAppLogValue } from "../packages/state/src/app-log-store";

const DEFAULT_EVIDENCE_DIRNAME = "e2e-results";
const NATIVE_SESSION_METADATA_FILENAME = ".svvy-e2e-native-session";
const MAX_BUFFERED_RECORDS = 10_000;
const NON_DIAGNOSTIC_HOME_DIRECTORY_NAMES = new Set([
  "artifacts",
  "build",
  "cache",
  "extensions",
  "generated",
  "node_modules",
  "snapshots",
  "workflows",
]);

type DiagnosticApp = {
  appId: string;
  bridgeUrl: string | null;
  driver: Driver;
  homeDir: string;
  page: Page;
  stderr: string[];
  stdout: string[];
  workspaceDir: string;
};

type CaptureStatus = "captured" | "failed" | "unsupported";

type CaptureRecord = {
  error?: string;
  name: string;
  path?: string;
  status: CaptureStatus;
};

type FailureEvidenceManifest = {
  app: {
    appId: string;
    bridgeUrl: string | null;
    homeDir: string;
    workspaceDir: string;
  };
  captureFinishedAt: string;
  captureStartedAt: string;
  captures: CaptureRecord[];
  error: ReturnType<typeof describeThrownValue>;
  evidenceDir: string;
  failureId: string;
  nativeCrashCores: string[];
  runId: string;
  schemaVersion: 1;
};

type StartupFailureEvidenceManifest = {
  captureFinishedAt: string;
  captureStartedAt: string;
  error: ReturnType<typeof describeThrownValue>;
  evidenceDir: string;
  failureId: string;
  homeDir: string;
  nativeCrashCores: string[];
  runId: string;
  schemaVersion: 1;
  workspaceDir: string;
};

type AppLogDatabaseEvidence = {
  databasePath: string;
  entryCount: number;
  workspaceRuntime: string | null;
};

type AppLogEvidenceEntry = {
  artifactId?: string;
  commandId?: string;
  createdAt: string;
  details?: unknown;
  error?: unknown;
  id: string;
  level: string;
  message: string;
  origin: Omit<AppLogDatabaseEvidence, "entryCount">;
  seq: number;
  source: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  workspaceSessionId?: string;
};

type AppLogRow = {
  artifact_id: string | null;
  command_id: string | null;
  created_at: string;
  details_json: string | null;
  error_json: string | null;
  id: string;
  level: string;
  message: string;
  seq: number;
  source: string;
  surface_pi_session_id: string | null;
  thread_id: string | null;
  workflow_run_id: string | null;
  workflow_task_attempt_id: string | null;
  workspace_session_id: string | null;
};

/**
 * Capture a live failure bundle while the app bridge and isolated HOME still exist.
 * Every individual probe is best-effort so one unsupported capability cannot hide
 * the remaining evidence or replace the test's original thrown value.
 */
export async function captureFailureDiagnostics(
  app: DiagnosticApp,
  thrownValue: unknown,
): Promise<string> {
  const captureStartedAt = new Date().toISOString();
  const runId = safeFileName(process.env.SVVY_E2E_RUN_ID?.trim() || "untracked-run");
  const failureId = `${captureStartedAt.replace(/[:.]/g, "-")}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const evidenceRoot = resolve(
    process.cwd(),
    process.env.SVVY_E2E_EVIDENCE_DIR?.trim() || DEFAULT_EVIDENCE_DIRNAME,
  );
  const evidenceDir = join(evidenceRoot, runId, "failures", failureId);
  const captures: CaptureRecord[] = [];
  await mkdir(evidenceDir, { recursive: true });

  const captureJson = async <T>(
    name: string,
    relativePath: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> => {
    try {
      const value = await action();
      await writeJson(join(evidenceDir, relativePath), value);
      captures.push({ name, path: relativePath, status: "captured" });
      return value;
    } catch (error) {
      await recordCaptureFailure(evidenceDir, captures, name, relativePath, "failed", error);
      return undefined;
    }
  };

  const captureText = async (
    name: string,
    relativePath: string,
    action: () => Promise<string>,
  ): Promise<void> => {
    try {
      const value = await action();
      await writeText(join(evidenceDir, relativePath), value);
      captures.push({ name, path: relativePath, status: "captured" });
    } catch (error) {
      await recordCaptureFailure(evidenceDir, captures, name, relativePath, "failed", error);
    }
  };

  const unsupported = async (name: string, relativePath: string, reason: string): Promise<void> => {
    await recordCaptureFailure(
      evidenceDir,
      captures,
      name,
      relativePath,
      "unsupported",
      new Error(reason),
    );
  };

  await writeJson(join(evidenceDir, "error.json"), describeThrownValue(thrownValue));
  captures.push({ name: "original error", path: "error.json", status: "captured" });
  await writeText(join(evidenceDir, "process/stdout.log"), linesToText(app.stdout));
  captures.push({ name: "app stdout", path: "process/stdout.log", status: "captured" });
  await writeText(join(evidenceDir, "process/stderr.log"), linesToText(app.stderr));
  captures.push({ name: "app stderr", path: "process/stderr.log", status: "captured" });

  const screenshotPath = "page/screenshot.png";
  let nativeScreenshotCaptured = false;
  if (process.platform === "linux") {
    try {
      await captureHeadlessDisplayScreenshot(app.homeDir, join(evidenceDir, screenshotPath));
      captures.push({
        name: "headless display screenshot (scrot)",
        path: screenshotPath,
        status: "captured",
      });
      nativeScreenshotCaptured = true;
    } catch (error) {
      await recordCaptureFailure(
        evidenceDir,
        captures,
        "headless display screenshot (scrot)",
        screenshotPath,
        "failed",
        error,
      );
    }
  }

  const doctor = await captureJson("browser doctor", "browser/doctor.json", () =>
    app.driver.doctor(),
  );
  const browserAndPageCaptures: Promise<unknown>[] = [
    captureJson("browser status", "browser/status.json", () => app.driver.status()),
    captureJson("browser tree", "browser/tree.json", () =>
      app.driver.tree({ depth: 12, includeHidden: true }),
    ),
    captureText("page URL", "page/url.txt", () => app.page.url()),
  ];
  if (doctor?.capabilities.layoutInspection === false) {
    browserAndPageCaptures.push(
      unsupported(
        "page snapshot",
        "page/snapshot.json",
        "The browser-tools bridge reports layout inspection as unsupported.",
      ),
    );
  } else {
    browserAndPageCaptures.push(
      captureJson("page snapshot", "page/snapshot.json", () =>
        app.page.snapshot({
          depth: 24,
          includeHidden: true,
          includeStyles: true,
          maxNodes: 20_000,
        }),
      ),
    );
  }

  if (doctor?.capabilities.domInspection === false) {
    browserAndPageCaptures.push(
      unsupported(
        "body text",
        "page/body.txt",
        "The browser-tools bridge reports DOM inspection as unsupported.",
      ),
      unsupported(
        "body HTML",
        "page/body.html",
        "The browser-tools bridge reports DOM inspection as unsupported.",
      ),
    );
  } else {
    browserAndPageCaptures.push(
      captureText(
        "body text",
        "page/body.txt",
        async () => (await app.page.locator("body").textContent()) ?? "",
      ),
      captureText(
        "body HTML",
        "page/body.html",
        async () => (await app.page.locator("body").innerHTML()) ?? "",
      ),
    );
  }
  await Promise.all(browserAndPageCaptures);

  if (doctor?.capabilities.state === false) {
    await unsupported(
      "state namespaces",
      "state/namespaces.json",
      "The browser-tools bridge reports state inspection as unsupported.",
    );
  } else {
    const namespaces = await captureJson("state namespaces", "state/namespaces.json", () =>
      app.driver.stateList(),
    );
    if (namespaces) {
      for (const [index, entry] of namespaces.entries()) {
        await captureJson(
          `state namespace ${entry.namespace}`,
          `state/${String(index + 1).padStart(2, "0")}-${safeFileName(entry.namespace)}.json`,
          () => app.driver.stateGet(entry.namespace),
        );
      }
    }
  }

  const telemetryCaptures: Promise<unknown>[] = [
    captureJson("events", "events/records.json", () =>
      collectRecords(app.driver.eventsTail({ follow: false })),
    ),
    captureJson("event summary", "events/summary.json", () =>
      app.driver.eventsSummary({ groupBy: "event" }),
    ),
  ];

  if (doctor?.capabilities.logs === false) {
    telemetryCaptures.push(
      unsupported(
        "browser logs",
        "logs/records.json",
        "The browser-tools bridge reports log inspection as unsupported.",
      ),
      unsupported(
        "log summary by level",
        "logs/summary-by-level.json",
        "The browser-tools bridge reports log inspection as unsupported.",
      ),
      unsupported(
        "log summary by source",
        "logs/summary-by-source.json",
        "The browser-tools bridge reports log inspection as unsupported.",
      ),
    );
  } else {
    telemetryCaptures.push(
      captureJson("browser logs", "logs/records.json", () => collectRecords(app.driver.logsTail())),
      captureJson("log summary by level", "logs/summary-by-level.json", () =>
        app.driver.logsSummary({ groupBy: "level" }),
      ),
      captureJson("log summary by source", "logs/summary-by-source.json", () =>
        app.driver.logsSummary({ groupBy: "source" }),
      ),
    );
  }

  if (doctor?.capabilities.errors === false) {
    telemetryCaptures.push(
      unsupported(
        "browser errors",
        "errors/records.json",
        "The browser-tools bridge reports error inspection as unsupported.",
      ),
    );
  } else {
    telemetryCaptures.push(
      captureJson("browser errors", "errors/records.json", () => app.driver.errorsList()),
    );
  }

  if (doctor?.capabilities.network === false) {
    telemetryCaptures.push(
      unsupported(
        "network records",
        "network/records.json",
        "The browser-tools bridge reports network inspection as unsupported.",
      ),
      unsupported(
        "network summary",
        "network/summary.json",
        "The browser-tools bridge reports network inspection as unsupported.",
      ),
    );
  } else {
    telemetryCaptures.push(
      captureJson("network records", "network/records.json", () =>
        collectRecords(app.driver.networkTail()),
      ),
      captureJson("network summary", "network/summary.json", () => app.driver.networkSummary()),
    );
  }

  if (doctor?.capabilities.perf === false) {
    telemetryCaptures.push(
      unsupported(
        "performance summary",
        "perf/summary.json",
        "The browser-tools bridge reports performance inspection as unsupported.",
      ),
      unsupported(
        "performance marks",
        "perf/marks.json",
        "The browser-tools bridge reports performance inspection as unsupported.",
      ),
    );
  } else {
    telemetryCaptures.push(
      captureJson("performance summary", "perf/summary.json", () => app.driver.perfSummary()),
      captureJson("performance marks", "perf/marks.json", () => app.driver.perfMarks()),
    );
  }
  await Promise.all(telemetryCaptures);

  if (doctor?.capabilities.screenshots === false) {
    await unsupported(
      "browser page screenshot",
      "page/browser-screenshot.png",
      "The browser-tools bridge reports screenshot capture as unsupported on this runtime.",
    );
  } else {
    try {
      const browserScreenshotPath = "page/browser-screenshot.png";
      const absoluteScreenshotPath = join(evidenceDir, browserScreenshotPath);
      await mkdir(dirname(absoluteScreenshotPath), { recursive: true });
      const result = await app.page.screenshot({ path: absoluteScreenshotPath });
      await stat(absoluteScreenshotPath);
      await writeJson(join(evidenceDir, "page/screenshot.json"), result);
      captures.push({
        name: "browser page screenshot",
        path: browserScreenshotPath,
        status: "captured",
      });
      if (!nativeScreenshotCaptured) {
        await copyFile(absoluteScreenshotPath, join(evidenceDir, screenshotPath));
      }
    } catch (error) {
      await recordCaptureFailure(
        evidenceDir,
        captures,
        "browser page screenshot",
        "page/browser-screenshot.png",
        "failed",
        error,
      );
    }
  }
  try {
    const copiedFiles = await copyUsefulHomeDiagnostics(app.homeDir, evidenceDir);
    await writeJson(join(evidenceDir, "home-files.json"), { copiedFiles });
    captures.push({
      name: "isolated HOME diagnostics",
      path: "home-files.json",
      status: "captured",
    });
  } catch (error) {
    await recordCaptureFailure(
      evidenceDir,
      captures,
      "isolated HOME diagnostics",
      "home-files.json",
      "failed",
      error,
    );
  }

  await captureJson("merged app logs", "app-logs/merged.json", () =>
    collectCopiedAppLogs(evidenceDir),
  );
  const nativeCrashCores = await stageNativeCrashCores({
    evidenceRoot,
    failureId,
    projectRoot: process.cwd(),
    runId,
  });

  const manifest: FailureEvidenceManifest = {
    schemaVersion: 1,
    runId,
    failureId,
    captureStartedAt,
    captureFinishedAt: new Date().toISOString(),
    evidenceDir,
    nativeCrashCores,
    app: {
      appId: app.appId,
      bridgeUrl: app.bridgeUrl,
      homeDir: app.homeDir,
      workspaceDir: app.workspaceDir,
    },
    error: describeThrownValue(thrownValue),
    captures,
  };
  await writeJson(join(evidenceDir, "manifest.json"), manifest);
  return evidenceDir;
}

export async function readNativeSessionDisplayEnv(
  homeDir: string,
): Promise<{ DISPLAY: string; XAUTHORITY?: string }> {
  const metadata = await readFile(join(homeDir, NATIVE_SESSION_METADATA_FILENAME));
  const [display, xauthority] = metadata.toString("utf8").split("\0");
  if (!display) {
    throw new Error("The app launch did not publish its isolated native display.");
  }
  return {
    DISPLAY: display,
    ...(xauthority ? { XAUTHORITY: xauthority } : {}),
  };
}

async function captureHeadlessDisplayScreenshot(
  homeDir: string,
  absoluteScreenshotPath: string,
): Promise<void> {
  await mkdir(dirname(absoluteScreenshotPath), { recursive: true });
  await rm(absoluteScreenshotPath, { force: true });
  const nativeDisplayEnv = await readNativeSessionDisplayEnv(homeDir);
  const proc = Bun.spawn(["scrot", "--silent", absoluteScreenshotPath], {
    env: {
      ...process.env,
      DISPLAY: nativeDisplayEnv.DISPLAY,
      ...(nativeDisplayEnv.XAUTHORITY
        ? { XAUTHORITY: nativeDisplayEnv.XAUTHORITY }
        : { XAUTHORITY: "" }),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `scrot exited with code ${exitCode}.${stderr.trim() ? ` stderr: ${stderr.trim()}` : ""}${
        stdout.trim() ? ` stdout: ${stdout.trim()}` : ""
      }`,
    );
  }
  await stat(absoluteScreenshotPath);
}

/** Capture the evidence that exists before the inspection bridge is available. */
export async function captureStartupFailureDiagnostics(input: {
  homeDir: string;
  thrownValue: unknown;
  workspaceDir: string;
}): Promise<string> {
  const captureStartedAt = new Date().toISOString();
  const runId = safeFileName(process.env.SVVY_E2E_RUN_ID?.trim() || "untracked-run");
  const failureId = `${captureStartedAt.replace(/[:.]/g, "-")}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const evidenceRoot = resolve(
    process.cwd(),
    process.env.SVVY_E2E_EVIDENCE_DIR?.trim() || DEFAULT_EVIDENCE_DIRNAME,
  );
  const evidenceDir = join(evidenceRoot, runId, "startup-failures", failureId);
  await mkdir(evidenceDir, { recursive: true });

  await writeJson(join(evidenceDir, "error.json"), describeThrownValue(input.thrownValue));
  await writeText(join(evidenceDir, "error.log"), formatThrownValue(input.thrownValue));
  await writeJson(join(evidenceDir, "runtime.json"), {
    arch: process.arch,
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    platform: process.platform,
    versions: process.versions,
  });
  const copiedFiles = await copyUsefulHomeDiagnostics(input.homeDir, evidenceDir);
  await writeJson(join(evidenceDir, "home-files.json"), { copiedFiles });
  await writeJson(
    join(evidenceDir, "app-logs/merged.json"),
    await collectCopiedAppLogs(evidenceDir),
  );
  const nativeCrashCores = await stageNativeCrashCores({
    evidenceRoot,
    failureId,
    projectRoot: process.cwd(),
    runId,
  });

  const manifest: StartupFailureEvidenceManifest = {
    schemaVersion: 1,
    runId,
    failureId,
    captureStartedAt,
    captureFinishedAt: new Date().toISOString(),
    evidenceDir,
    homeDir: input.homeDir,
    nativeCrashCores,
    workspaceDir: input.workspaceDir,
    error: describeThrownValue(input.thrownValue),
  };
  await writeJson(join(evidenceDir, "manifest.json"), manifest);
  return evidenceDir;
}

export async function stageNativeCrashCores(input: {
  evidenceRoot: string;
  failureId: string;
  projectRoot: string;
  runId: string;
}): Promise<string[]> {
  const buildRoot = join(input.projectRoot, "build");
  const corePaths = await findFilesNamed(buildRoot, "core");
  if (corePaths.length === 0) return [];

  const stagedDir = join(input.evidenceRoot, input.runId, "native-cores");
  await mkdir(stagedDir, { recursive: true });
  const stagedPaths: string[] = [];
  for (const [index, corePath] of corePaths.toSorted().entries()) {
    const coreName = `${input.failureId}-${String(index + 1).padStart(2, "0")}`;
    const stagedPath = join(stagedDir, `${coreName}.core`);
    await rename(corePath, stagedPath);
    await writeText(`${stagedPath.slice(0, -".core".length)}.bin-dir.txt`, dirname(corePath));
    stagedPaths.push(relative(input.evidenceRoot, stagedPath).replaceAll(sep, "/"));
  }
  return stagedPaths;
}

async function collectRecords<T>(records: AsyncIterable<T>): Promise<{
  records: T[];
  truncated: boolean;
}> {
  const collected: T[] = [];
  let truncated = false;
  for await (const record of records) {
    if (collected.length >= MAX_BUFFERED_RECORDS) {
      truncated = true;
      break;
    }
    collected.push(record);
  }
  return { records: collected, truncated };
}

async function copyUsefulHomeDiagnostics(homeDir: string, evidenceDir: string): Promise<string[]> {
  const sourceRoot = join(homeDir, ".config", "svvy");
  const copiedFiles: string[] = [];

  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }

    for (const entry of entries) {
      const sourcePath = join(directory, entry.name);
      const relativePath = relative(homeDir, sourcePath);
      if (isSensitiveDiagnosticPath(relativePath) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (NON_DIAGNOSTIC_HOME_DIRECTORY_NAMES.has(entry.name.toLowerCase())) continue;
        await visit(sourcePath);
        continue;
      }
      if (!entry.isFile() || !isUsefulDiagnosticFile(relativePath)) continue;

      const destinationPath = join(evidenceDir, "home", relativePath);
      await mkdir(dirname(destinationPath), { recursive: true });
      const extension = extname(entry.name).toLowerCase();
      if (extension === ".json" || extension === ".jsonl") {
        await writeText(
          destinationPath,
          redactSessionText(await readFile(sourcePath, "utf8"), extension),
        );
      } else {
        await copyFile(sourcePath, destinationPath);
      }
      copiedFiles.push(relativePath.split(sep).join("/"));
    }
  };

  await visit(sourceRoot);
  return copiedFiles.toSorted();
}

async function collectCopiedAppLogs(evidenceDir: string): Promise<{
  databases: AppLogDatabaseEvidence[];
  entries: AppLogEvidenceEntry[];
  schemaVersion: 1;
}> {
  const databasePaths = await findFilesNamed(join(evidenceDir, "home"), APP_LOG_DATABASE_FILENAME);
  const databases: AppLogDatabaseEvidence[] = [];
  const entries: AppLogEvidenceEntry[] = [];

  for (const absoluteDatabasePath of databasePaths) {
    const databasePath = relative(evidenceDir, absoluteDatabasePath).split(sep).join("/");
    const workspaceRuntime = workspaceRuntimeFromEvidencePath(databasePath);
    const database = new Database(absoluteDatabasePath, { readonly: true });
    try {
      const rows = database
        .query(
          `SELECT
             id,
             seq,
             created_at,
             level,
             source,
             message,
             details_json,
             error_json,
             workspace_session_id,
             surface_pi_session_id,
             thread_id,
             workflow_run_id,
             workflow_task_attempt_id,
             command_id,
             artifact_id
           FROM app_log
           ORDER BY created_at ASC, seq ASC, id ASC`,
        )
        .all() as AppLogRow[];
      databases.push({ databasePath, entryCount: rows.length, workspaceRuntime });
      for (const row of rows) {
        entries.push({
          id: row.id,
          seq: row.seq,
          createdAt: row.created_at,
          level: row.level,
          source: row.source,
          message: row.message,
          ...(row.details_json
            ? {
                details: parseAppLogJsonColumn(
                  row.details_json,
                  "details_json",
                  databasePath,
                  row.id,
                ),
              }
            : {}),
          ...(row.error_json
            ? {
                error: parseAppLogJsonColumn(row.error_json, "error_json", databasePath, row.id),
              }
            : {}),
          ...(row.workspace_session_id ? { workspaceSessionId: row.workspace_session_id } : {}),
          ...(row.surface_pi_session_id ? { surfacePiSessionId: row.surface_pi_session_id } : {}),
          ...(row.thread_id ? { threadId: row.thread_id } : {}),
          ...(row.workflow_run_id ? { workflowRunId: row.workflow_run_id } : {}),
          ...(row.workflow_task_attempt_id
            ? { workflowTaskAttemptId: row.workflow_task_attempt_id }
            : {}),
          ...(row.command_id ? { commandId: row.command_id } : {}),
          ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
          origin: { databasePath, workspaceRuntime },
        });
      }
    } finally {
      database.close();
    }
  }

  entries.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.origin.databasePath.localeCompare(right.origin.databasePath) ||
      left.seq - right.seq ||
      left.id.localeCompare(right.id),
  );
  return { schemaVersion: 1, databases, entries };
}

async function findFilesNamed(root: string, fileName: string): Promise<string[]> {
  const matches: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw error;
    }
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === fileName) matches.push(path);
    }
  };
  await visit(root);
  return matches;
}

function workspaceRuntimeFromEvidencePath(databasePath: string): string | null {
  const parts = databasePath.split("/");
  const workspaceRuntimesIndex = parts.indexOf("workspace-runtimes");
  return workspaceRuntimesIndex === -1 ? null : (parts[workspaceRuntimesIndex + 1] ?? null);
}

function parseAppLogJsonColumn(
  value: string,
  column: "details_json" | "error_json",
  databasePath: string,
  entryId: string,
): unknown {
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new Error(`Could not parse ${column} for app-log entry ${entryId} in ${databasePath}.`, {
      cause,
    });
  }
}

function redactSessionText(contents: string, extension: ".json" | ".jsonl"): string {
  if (extension === ".json") {
    try {
      return `${safeJsonStringify(redactAppLogValue(JSON.parse(contents)))}\n`;
    } catch {
      return "[Malformed session JSON omitted because it could not be safely redacted.]\n";
    }
  }

  return `${contents
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.stringify(redactAppLogValue(JSON.parse(line)));
      } catch {
        return "[Malformed session JSONL record omitted because it could not be safely redacted.]";
      }
    })
    .join("\n")}\n`;
}

function isUsefulDiagnosticFile(relativePath: string): boolean {
  const lowerPath = relativePath.toLowerCase();
  const fileName = basename(lowerPath);
  const sqliteLike =
    fileName.endsWith(".sqlite") ||
    fileName.endsWith(".sqlite-wal") ||
    fileName.endsWith(".sqlite-shm") ||
    fileName.endsWith(".db") ||
    fileName.endsWith(".db-wal") ||
    fileName.endsWith(".db-shm");
  if (sqliteLike) return true;

  const parts = lowerPath.split(/[\\/]+/);
  const isSessionRecord = parts.includes("sessions");
  const extension = extname(fileName);
  return isSessionRecord && (extension === ".json" || extension === ".jsonl");
}

function isSensitiveDiagnosticPath(relativePath: string): boolean {
  const parts = relativePath.toLowerCase().split(/[\\/]+/);
  return parts.some((part) => {
    if (!part) return false;
    if (part === "auth.json" || part === ".npmrc" || part === ".netrc") return true;
    if (part.includes("oauth")) return true;
    if (part === ".env" || part.startsWith(".env.")) return true;
    if ([".key", ".pem", ".p12", ".pfx"].includes(extname(part))) return true;
    return /(^|[._-])(auth|credential|credentials|key|keys|keychain|secret|secrets|token|tokens)([._-]|$)/i.test(
      part,
    );
  });
}

async function recordCaptureFailure(
  evidenceDir: string,
  captures: CaptureRecord[],
  name: string,
  intendedRelativePath: string,
  status: Exclude<CaptureStatus, "captured">,
  error: unknown,
): Promise<void> {
  const message = formatThrownValue(error);
  const failurePath = `${intendedRelativePath}.error.txt`;
  await writeText(join(evidenceDir, failurePath), message).catch(() => undefined);
  captures.push({ error: message, name, path: failurePath, status });
}

function describeThrownValue(value: unknown): {
  cause?: unknown;
  message: string;
  name: string;
  stack?: string;
  thrownValue?: unknown;
} {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
      ...(value.cause === undefined ? {} : { cause: jsonSafeValue(value.cause) }),
    };
  }
  return {
    name: "NonErrorThrownValue",
    message: String(value),
    thrownValue: jsonSafeValue(value),
  };
}

function formatThrownValue(value: unknown): string {
  const description = describeThrownValue(value);
  return `${description.stack ?? `${description.name}: ${description.message}`}\n`;
}

function jsonSafeValue(value: unknown): unknown {
  try {
    return JSON.parse(safeJsonStringify(value));
  } catch {
    return String(value);
  }
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, candidate: unknown) => {
      if (typeof candidate === "bigint") return candidate.toString();
      if (candidate instanceof Error) return describeThrownValue(candidate);
      if (candidate && typeof candidate === "object") {
        if (seen.has(candidate)) return "[Circular]";
        seen.add(candidate);
      }
      return candidate;
    },
    2,
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${safeJsonStringify(redactAppLogValue(value))}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, String(redactAppLogValue(value)), "utf8");
}

function linesToText(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "namespace";
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
