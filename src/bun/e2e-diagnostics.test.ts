import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Driver, Page } from "electrobun-browser-tools";
import {
  captureFailureDiagnostics,
  captureStartupFailureDiagnostics,
  readNativeSessionDisplayEnv,
  stageNativeCrashCores,
} from "../../e2e/diagnostics";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function* records<T>(...values: T[]): AsyncIterable<T> {
  for (const value of values) yield value;
}

async function listFiles(directory: string): Promise<string[]> {
  const paths: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else paths.push(path);
    }
  };
  await visit(directory);
  return paths;
}

function quietDiagnosticApp(homeDir: string): Parameters<typeof captureFailureDiagnostics>[0] {
  const page = {
    url: async () => "http://127.0.0.1/app",
    snapshot: async () => ({ role: "document" }),
    locator: () => ({
      textContent: async () => "Ready",
      innerHTML: async () => "<main>Ready</main>",
    }),
    screenshot: async ({ path }: { path: string }) => {
      await writeFile(path, new Uint8Array([137, 80, 78, 71]));
      return { path };
    },
  } as unknown as Page;
  const driver = {
    doctor: async () => ({
      capabilities: {
        layoutInspection: true,
        domInspection: true,
        state: true,
        logs: true,
        errors: true,
        network: true,
        perf: true,
        screenshots: true,
      },
    }),
    status: async () => ({ connected: true }),
    tree: async () => ({ root: "app" }),
    stateList: async () => [],
    stateGet: async () => ({}),
    eventsTail: () => records(),
    eventsSummary: async () => ({ total: 0 }),
    logsTail: () => records(),
    logsSummary: async () => ({ total: 0 }),
    errorsList: async () => [],
    networkTail: () => records(),
    networkSummary: async () => ({ total: 0 }),
    perfSummary: async () => ({}),
    perfMarks: async () => [],
  } as unknown as Driver;
  return {
    appId: "svvy-test",
    bridgeUrl: "http://127.0.0.1:59999",
    driver,
    homeDir,
    page,
    stderr: [],
    stdout: [],
    workspaceDir: "/workspace",
  };
}

async function captureTestFailure(
  homeDir: string,
  evidenceRoot: string,
  thrownValue: unknown,
): Promise<string> {
  const previousEvidenceDir = process.env.SVVY_E2E_EVIDENCE_DIR;
  const previousRunId = process.env.SVVY_E2E_RUN_ID;
  process.env.SVVY_E2E_EVIDENCE_DIR = evidenceRoot;
  process.env.SVVY_E2E_RUN_ID = "unit-run";
  try {
    return await captureFailureDiagnostics(quietDiagnosticApp(homeDir), thrownValue);
  } finally {
    if (previousEvidenceDir === undefined) delete process.env.SVVY_E2E_EVIDENCE_DIR;
    else process.env.SVVY_E2E_EVIDENCE_DIR = previousEvidenceDir;
    if (previousRunId === undefined) delete process.env.SVVY_E2E_RUN_ID;
    else process.env.SVVY_E2E_RUN_ID = previousRunId;
  }
}

async function createAppLogDatabase(
  databasePath: string,
  rows: Array<{
    createdAt: string;
    detailsJson?: string;
    errorJson?: string;
    id: string;
    message: string;
    seq: number;
  }>,
): Promise<void> {
  await mkdir(join(databasePath, ".."), { recursive: true });
  const database = new Database(databasePath);
  try {
    database.exec(`
      CREATE TABLE app_log (
        id TEXT PRIMARY KEY,
        seq INTEGER NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        error_json TEXT,
        workspace_session_id TEXT,
        surface_pi_session_id TEXT,
        thread_id TEXT,
        workflow_run_id TEXT,
        workflow_task_attempt_id TEXT,
        command_id TEXT,
        artifact_id TEXT
      )
    `);
    const insert = database.query(`
      INSERT INTO app_log (
        id, seq, created_at, level, source, message, details_json, error_json,
        workspace_session_id, surface_pi_session_id, thread_id, workflow_run_id,
        workflow_task_attempt_id, command_id, artifact_id
      ) VALUES (?, ?, ?, 'error', 'runtime', ?, ?, ?, 'session-1', NULL, NULL, NULL, NULL, NULL, NULL)
    `);
    for (const row of rows) {
      insert.run(
        row.id,
        row.seq,
        row.createdAt,
        row.message,
        row.detailsJson ?? null,
        row.errorJson ?? null,
      );
    }
  } finally {
    database.close();
  }
}

describe("e2e failure diagnostics", () => {
  test("captures the native display before any potentially wedged bridge probe", async () => {
    const source = await readFile(
      join(import.meta.dir, "..", "..", "e2e", "diagnostics.ts"),
      "utf8",
    );
    const captureStart = source.indexOf("export async function captureFailureDiagnostics");
    const nativeScreenshot = source.indexOf("await captureHeadlessDisplayScreenshot", captureStart);
    const browserDoctor = source.indexOf(
      'const doctor = await captureJson("browser doctor"',
      captureStart,
    );

    expect(nativeScreenshot).toBeGreaterThan(captureStart);
    expect(nativeScreenshot).toBeLessThan(browserDoctor);
  });

  test("targets screenshots at the app launch's isolated native display", async () => {
    const homeDir = await temporaryDirectory("svvy-e2e-native-display-");
    await writeFile(join(homeDir, ".svvy-e2e-native-session"), ":97\0/tmp/xauth-97\0");

    expect(await readNativeSessionDisplayEnv(homeDir)).toEqual({
      DISPLAY: ":97",
      XAUTHORITY: "/tmp/xauth-97",
    });
  });

  test("stages every fixed-name native core before another launch can overwrite it", async () => {
    const root = await temporaryDirectory("svvy-e2e-native-cores-");
    const projectRoot = join(root, "project");
    const evidenceRoot = join(root, "evidence");
    const firstBin = join(projectRoot, "build", "first", "bin");
    const secondBin = join(projectRoot, "build", "second", "bin");
    await Promise.all([
      mkdir(firstBin, { recursive: true }),
      mkdir(secondBin, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(firstBin, "core"), "first-core"),
      writeFile(join(secondBin, "core"), "second-core"),
    ]);

    const staged = await stageNativeCrashCores({
      evidenceRoot,
      failureId: "failure-one",
      projectRoot,
      runId: "run-one",
    });

    expect(staged).toEqual([
      "run-one/native-cores/failure-one-01.core",
      "run-one/native-cores/failure-one-02.core",
    ]);
    expect(await readFile(join(evidenceRoot, staged[0]!), "utf8")).toBe("first-core");
    expect(await readFile(join(evidenceRoot, staged[1]!), "utf8")).toBe("second-core");
    expect(
      await readFile(join(evidenceRoot, "run-one/native-cores/failure-one-01.bin-dir.txt"), "utf8"),
    ).toBe(firstBin);
    expect(await Bun.file(join(firstBin, "core")).exists()).toBe(false);
    expect(await Bun.file(join(secondBin, "core")).exists()).toBe(false);
  });

  test("captures startup evidence before the isolated HOME is removed", async () => {
    const root = await temporaryDirectory("svvy-e2e-startup-diagnostics-");
    const homeDir = join(root, "home");
    const evidenceRoot = join(root, "evidence");
    const sessionDir = join(homeDir, ".config", "svvy", "sessions");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "startup.json"), '{"status":"booting"}\n');

    const previousEvidenceDir = process.env.SVVY_E2E_EVIDENCE_DIR;
    const previousRunId = process.env.SVVY_E2E_RUN_ID;
    process.env.SVVY_E2E_EVIDENCE_DIR = evidenceRoot;
    process.env.SVVY_E2E_RUN_ID = "startup-unit-run";
    let evidenceDir: string;
    try {
      evidenceDir = await captureStartupFailureDiagnostics({
        homeDir,
        thrownValue: new Error("bridge never became available"),
        workspaceDir: "/workspace",
      });
    } finally {
      if (previousEvidenceDir === undefined) delete process.env.SVVY_E2E_EVIDENCE_DIR;
      else process.env.SVVY_E2E_EVIDENCE_DIR = previousEvidenceDir;
      if (previousRunId === undefined) delete process.env.SVVY_E2E_RUN_ID;
      else process.env.SVVY_E2E_RUN_ID = previousRunId;
    }

    expect(relative(evidenceRoot, evidenceDir!)).toStartWith("startup-unit-run/startup-failures/");
    expect(await readFile(join(evidenceDir!, "error.log"), "utf8")).toContain(
      "bridge never became available",
    );
    expect(await Bun.file(join(evidenceDir!, "runtime.json")).json()).toMatchObject({
      arch: process.arch,
      bunRevision: Bun.revision,
      bunVersion: Bun.version,
      platform: process.platform,
    });
    expect(await Bun.file(join(evidenceDir!, "home-files.json")).json()).toEqual({
      copiedFiles: [".config/svvy/sessions/startup.json"],
    });
  });

  test("captures a complete redacted bundle and copies only allowlisted HOME state", async () => {
    const root = await temporaryDirectory("svvy-e2e-diagnostics-");
    const homeDir = join(root, "home");
    const evidenceRoot = join(root, "evidence");
    const configDir = join(homeDir, ".config", "svvy");
    const sessionDir = join(configDir, "sessions");
    const secret = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890-secret";
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(configDir, "state.sqlite"), "sqlite-state");
    await writeFile(join(sessionDir, "session.json"), `{"apiKey":"${secret}"}`);
    await writeFile(join(configDir, "auth.json"), secret);
    await writeFile(join(configDir, "provider-token.sqlite"), secret);

    const page = {
      url: async () => "http://127.0.0.1/app",
      snapshot: async () => ({ role: "document", apiKey: secret }),
      locator: () => ({
        textContent: async () => `Authorization=Bearer ${secret}`,
        innerHTML: async () => `<main data-api-key="${secret}">Ready</main>`,
      }),
      screenshot: async ({ path }: { path: string }) => {
        await writeFile(path, new Uint8Array([137, 80, 78, 71]));
        return { path };
      },
    } as unknown as Page;
    const driver = {
      doctor: async () => ({
        capabilities: {
          layoutInspection: true,
          domInspection: true,
          state: true,
          logs: true,
          errors: true,
          network: true,
          perf: true,
          screenshots: true,
        },
      }),
      status: async () => ({ connected: true }),
      tree: async () => ({ root: "app" }),
      stateList: async () => [{ namespace: "sessions" }],
      stateGet: async () => ({ apiKey: secret, status: "idle" }),
      eventsTail: () => records({ event: "runtime.failed", authorization: secret }),
      eventsSummary: async () => ({ total: 1 }),
      logsTail: () => records({ level: "error", message: `API_KEY=${secret}` }),
      logsSummary: async () => ({ error: 1 }),
      errorsList: async () => [{ message: `Bearer ${secret}` }],
      networkTail: () => records({ url: "/chat", authorization: secret }),
      networkSummary: async () => ({ total: 1 }),
      perfSummary: async () => ({ durationMs: 12 }),
      perfMarks: async () => [{ name: "ready" }],
    } as unknown as Driver;

    const previousEvidenceDir = process.env.SVVY_E2E_EVIDENCE_DIR;
    const previousRunId = process.env.SVVY_E2E_RUN_ID;
    process.env.SVVY_E2E_EVIDENCE_DIR = evidenceRoot;
    process.env.SVVY_E2E_RUN_ID = "unit-run";
    let evidenceDir: string;
    try {
      evidenceDir = await captureFailureDiagnostics(
        {
          appId: "svvy-test",
          bridgeUrl: "http://127.0.0.1:59999",
          driver,
          homeDir,
          page,
          stderr: [`API_KEY=${secret}`],
          stdout: [`Authorization=Bearer ${secret}`],
          workspaceDir: "/workspace",
        },
        new Error(`request failed with Bearer ${secret}`),
      );
    } finally {
      if (previousEvidenceDir === undefined) delete process.env.SVVY_E2E_EVIDENCE_DIR;
      else process.env.SVVY_E2E_EVIDENCE_DIR = previousEvidenceDir;
      if (previousRunId === undefined) delete process.env.SVVY_E2E_RUN_ID;
      else process.env.SVVY_E2E_RUN_ID = previousRunId;
    }

    expect(relative(evidenceRoot, evidenceDir!)).toStartWith("unit-run/failures/");
    const manifest = JSON.parse(await readFile(join(evidenceDir!, "manifest.json"), "utf8")) as {
      captures: Array<{ name: string; status: string }>;
      runId: string;
      schemaVersion: number;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.runId).toBe("unit-run");
    expect(manifest.captures.some((capture) => capture.name === "browser page screenshot")).toBe(
      true,
    );

    const homeFiles = JSON.parse(await readFile(join(evidenceDir!, "home-files.json"), "utf8")) as {
      copiedFiles: string[];
    };
    expect(homeFiles.copiedFiles).toEqual([
      ".config/svvy/sessions/session.json",
      ".config/svvy/state.sqlite",
    ]);

    const textualEvidence = (
      await Promise.all(
        (
          await listFiles(evidenceDir!)
        )
          .filter((path) => !path.endsWith(".png") && !path.endsWith(".sqlite"))
          .map((path) => readFile(path, "utf8")),
      )
    ).join("\n");
    expect(textualEvidence).not.toContain(secret);
    expect(textualEvidence).toContain("[REDACTED]");
  });

  test("merges every copied app-log database into one deterministic readable artifact", async () => {
    const root = await temporaryDirectory("svvy-e2e-app-log-diagnostics-");
    const homeDir = join(root, "home");
    const evidenceRoot = join(root, "evidence");
    const runtimesRoot = join(homeDir, ".config", "svvy", "workspace-runtimes");
    const secret = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890-secret";
    await createAppLogDatabase(join(runtimesRoot, "runtime-a", "app-logs-v2.sqlite"), [
      {
        id: "app-log-a1",
        seq: 1,
        createdAt: "2026-07-13T10:00:02.000Z",
        message: "same-time runtime A",
        detailsJson: JSON.stringify({ apiKey: secret, reason: "context-refresh" }),
      },
    ]);
    await createAppLogDatabase(join(runtimesRoot, "runtime-b", "app-logs-v2.sqlite"), [
      {
        id: "app-log-b1",
        seq: 1,
        createdAt: "2026-07-13T10:00:01.000Z",
        message: "earliest runtime B",
        errorJson: JSON.stringify({ message: "refresh failed", operation: "queue-drain" }),
      },
      {
        id: "app-log-b2",
        seq: 2,
        createdAt: "2026-07-13T10:00:02.000Z",
        message: "same-time runtime B",
      },
    ]);

    const evidenceDir = await captureTestFailure(
      homeDir,
      evidenceRoot,
      new Error("original e2e failure"),
    );
    const mergedPath = join(evidenceDir, "app-logs", "merged.json");
    const mergedText = await readFile(mergedPath, "utf8");
    const merged = JSON.parse(mergedText) as {
      databases: Array<{
        databasePath: string;
        entryCount: number;
        workspaceRuntime: string;
      }>;
      entries: Array<{
        details?: Record<string, unknown>;
        error?: Record<string, unknown>;
        message: string;
        origin: { databasePath: string; workspaceRuntime: string };
        workspaceSessionId?: string;
      }>;
      schemaVersion: number;
    };

    expect(merged.schemaVersion).toBe(1);
    expect(merged.databases).toEqual([
      {
        databasePath: "home/.config/svvy/workspace-runtimes/runtime-a/app-logs-v2.sqlite",
        entryCount: 1,
        workspaceRuntime: "runtime-a",
      },
      {
        databasePath: "home/.config/svvy/workspace-runtimes/runtime-b/app-logs-v2.sqlite",
        entryCount: 2,
        workspaceRuntime: "runtime-b",
      },
    ]);
    expect(merged.entries.map((entry) => entry.message)).toEqual([
      "earliest runtime B",
      "same-time runtime A",
      "same-time runtime B",
    ]);
    expect(merged.entries[0]?.origin).toEqual({
      databasePath: "home/.config/svvy/workspace-runtimes/runtime-b/app-logs-v2.sqlite",
      workspaceRuntime: "runtime-b",
    });
    expect(merged.entries[0]?.error).toEqual({
      message: "refresh failed",
      operation: "queue-drain",
    });
    expect(merged.entries[0]?.workspaceSessionId).toBe("session-1");
    expect(merged.entries[1]?.details).toEqual({
      apiKey: "[REDACTED]",
      reason: "context-refresh",
    });
    expect(mergedText).not.toContain(secret);
    expect(
      await readFile(
        join(evidenceDir, "home/.config/svvy/workspace-runtimes/runtime-a/app-logs-v2.sqlite"),
      ),
    ).not.toHaveLength(0);
  });

  test("records app-log export errors without replacing the original failure bundle", async () => {
    const root = await temporaryDirectory("svvy-e2e-app-log-error-");
    const homeDir = join(root, "home");
    const evidenceRoot = join(root, "evidence");
    const invalidDatabasePath = join(
      homeDir,
      ".config",
      "svvy",
      "workspace-runtimes",
      "broken-runtime",
      "app-logs-v2.sqlite",
    );
    await mkdir(join(invalidDatabasePath, ".."), { recursive: true });
    await writeFile(invalidDatabasePath, "not a sqlite database");

    const evidenceDir = await captureTestFailure(
      homeDir,
      evidenceRoot,
      new Error("failure that must remain primary"),
    );
    const originalError = JSON.parse(await readFile(join(evidenceDir, "error.json"), "utf8")) as {
      message: string;
    };
    const manifest = JSON.parse(await readFile(join(evidenceDir, "manifest.json"), "utf8")) as {
      captures: Array<{ name: string; path: string; status: string }>;
    };
    const mergedCapture = manifest.captures.find((capture) => capture.name === "merged app logs");

    expect(originalError.message).toBe("failure that must remain primary");
    expect(mergedCapture).toMatchObject({
      name: "merged app logs",
      path: "app-logs/merged.json.error.txt",
      status: "failed",
    });
    expect(
      await readFile(join(evidenceDir, "app-logs", "merged.json.error.txt"), "utf8"),
    ).toContain("not a database");
    expect(
      await readFile(
        join(evidenceDir, "home/.config/svvy/workspace-runtimes/broken-runtime/app-logs-v2.sqlite"),
        "utf8",
      ),
    ).toBe("not a sqlite database");
  });
});
