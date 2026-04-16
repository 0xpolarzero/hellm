import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { basename, delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StructuredWorkflowStatus } from "./structured-session-state";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_WORKFLOWS_DIR = resolve(REPO_ROOT, "workflows");
const DEFAULT_SMITHERS_BIN = resolve(DEFAULT_WORKFLOWS_DIR, "node_modules/.bin/smithers");
const DEFAULT_SMITHERS_DB = resolve(DEFAULT_WORKFLOWS_DIR, "smithers.db");
const IMPLEMENT_FEATURE_WORKFLOW = "definitions/implement-feature.tsx";

export type SmithersRunStatus =
  | "running"
  | "waiting-approval"
  | "waiting-event"
  | "waiting-timer"
  | "finished"
  | "failed"
  | "cancelled";

export type SmithersNodeCounts = Record<string, number>;

export interface StartImplementFeatureWorkflowOptions {
  repoRoot?: string;
  smithersBin?: string;
  smithersCwd?: string;
  specPath: string;
  pocPath: string;
  slug?: string;
  worktreeRoot?: string;
  branchPrefix?: string;
  baseBranch?: string;
  maxIterations?: number;
  onMaxReached?: "return-last" | "fail";
}

export interface StartSmithersWorkflowOptions {
  workflowPath: string;
  input: unknown;
  repoRoot?: string;
  runId?: string;
  smithersBin?: string;
  smithersCwd?: string;
  env?: Record<string, string | undefined>;
}

export interface StartSmithersWorkflowResult {
  runId: string;
  stdout: string;
  stderr: string;
}

export interface SmithersRunState {
  runId: string;
  workflowName: string;
  workflowPath: string | null;
  status: SmithersRunStatus;
  createdAtMs: number;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  heartbeatAtMs: number | null;
  vcsRoot: string | null;
  vcsRevision: string | null;
  errorJson: string | null;
  nodeCounts: SmithersNodeCounts;
}

export interface SmithersWorkflowProjectionInput {
  status: StructuredWorkflowStatus;
  summary: string;
}

export async function startImplementFeatureWorkflow(
  options: StartImplementFeatureWorkflowOptions,
): Promise<StartSmithersWorkflowResult> {
  const input = {
    specPath: options.specPath,
    pocPath: options.pocPath,
    ...(options.slug ? { slug: options.slug } : {}),
    ...(options.worktreeRoot ? { worktreeRoot: options.worktreeRoot } : {}),
    ...(options.branchPrefix ? { branchPrefix: options.branchPrefix } : {}),
    ...(options.baseBranch ? { baseBranch: options.baseBranch } : {}),
    ...(options.maxIterations ? { maxIterations: options.maxIterations } : {}),
    ...(options.onMaxReached ? { onMaxReached: options.onMaxReached } : {}),
  };

  return startSmithersWorkflow({
    workflowPath: IMPLEMENT_FEATURE_WORKFLOW,
    input,
    repoRoot: options.repoRoot,
    smithersBin: options.smithersBin,
    smithersCwd: options.smithersCwd,
  });
}

export async function startSmithersWorkflow(
  options: StartSmithersWorkflowOptions,
): Promise<StartSmithersWorkflowResult> {
  const smithersBin = options.smithersBin ?? DEFAULT_SMITHERS_BIN;
  const smithersCwd = options.smithersCwd ?? DEFAULT_WORKFLOWS_DIR;
  const repoRoot = options.repoRoot ?? REPO_ROOT;

  if (!existsSync(smithersBin)) {
    throw new Error(`Smithers binary not found at ${smithersBin}`);
  }

  const args = [
    smithersBin,
    "up",
    options.workflowPath,
    "--detach",
    "true",
    "--root",
    repoRoot,
    "--input",
    JSON.stringify(options.input ?? {}),
  ];
  if (options.runId) {
    args.push("--run-id", options.runId);
  }

  const result = await runCommand(args, smithersCwd, options.env);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "Failed to start Smithers workflow.");
  }

  const runId = extractSmithersRunId(result.stdout);
  if (!runId) {
    throw new Error(`Could not parse a Smithers run id from output:\n${result.stdout}`);
  }

  return {
    runId,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export function extractSmithersRunId(output: string): string | null {
  const text = stripAnsi(output);

  const textMatch = text.match(/runId:\s*([^\s]+)/);
  if (textMatch?.[1]) {
    return textMatch[1];
  }

  const jsonMatch = text.match(/"runId"\s*:\s*"([^"]+)"/);
  if (jsonMatch?.[1]) {
    return jsonMatch[1];
  }

  return null;
}

export function readSmithersRunState(options: {
  dbPath?: string;
  runId: string;
}): SmithersRunState | null {
  const dbPath = options.dbPath ?? DEFAULT_SMITHERS_DB;
  const db = openReadonlyDb(dbPath);

  try {
    const runRow = db
      .query(
        `SELECT
           run_id AS runId,
           workflow_name AS workflowName,
           workflow_path AS workflowPath,
           status AS status,
           created_at_ms AS createdAtMs,
           started_at_ms AS startedAtMs,
           finished_at_ms AS finishedAtMs,
           heartbeat_at_ms AS heartbeatAtMs,
           vcs_root AS vcsRoot,
           vcs_revision AS vcsRevision,
           error_json AS errorJson
         FROM _smithers_runs
         WHERE run_id = ?
         LIMIT 1`,
      )
      .get(options.runId) as {
      runId: string;
      workflowName: string;
      workflowPath: string | null;
      status: SmithersRunStatus;
      createdAtMs: number;
      startedAtMs: number | null;
      finishedAtMs: number | null;
      heartbeatAtMs: number | null;
      vcsRoot: string | null;
      vcsRevision: string | null;
      errorJson: string | null;
    } | null;

    if (!runRow) {
      return null;
    }

    const nodeCounts = Object.fromEntries(
      (
        db
          .query(
            `SELECT
             state AS state,
             COUNT(*) AS count
           FROM _smithers_nodes
           WHERE run_id = ?
           GROUP BY state`,
          )
          .all(options.runId) as Array<{ state: string; count: number }>
      ).map((row) => [row.state, row.count]),
    );

    return {
      ...runRow,
      nodeCounts,
    };
  } finally {
    db.close();
  }
}

export function mapSmithersRunStateToWorkflowProjectionInput(
  run: SmithersRunState,
): SmithersWorkflowProjectionInput {
  return {
    status: mapRunStatusToWorkflowStatus(run.status),
    summary: buildWorkflowSummary(run),
  };
}

export function readSmithersWorkflowProjectionInput(options: {
  dbPath?: string;
  runId: string;
}): SmithersWorkflowProjectionInput | null {
  const run = readSmithersRunState(options);
  return run ? mapSmithersRunStateToWorkflowProjectionInput(run) : null;
}

async function runCommand(
  command: string[],
  cwd: string,
  envOverride?: Record<string, string | undefined>,
) {
  const env = buildCommandEnv(envOverride ?? process.env);

  const proc = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  return {
    stdout: stripAnsi(stdout),
    stderr: stripAnsi(stderr),
    exitCode,
  };
}

function openReadonlyDb(dbPath: string) {
  return new Database(dbPath, {
    readonly: true,
    create: false,
  });
}

function mapRunStatusToWorkflowStatus(status: SmithersRunStatus): StructuredWorkflowStatus {
  switch (status) {
    case "running":
      return "running";
    case "waiting-approval":
    case "waiting-event":
      return "waiting";
    case "waiting-timer":
      return "running";
    case "finished":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function buildCommandEnv(baseEnv: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = { ...baseEnv };
  const bunExecutablePath = resolveBunExecutablePath(baseEnv);
  if (!bunExecutablePath) {
    return env;
  }

  env.PATH = prependPathEntry(baseEnv.PATH, dirname(bunExecutablePath));
  return env;
}

function resolveBunExecutablePath(env: Record<string, string | undefined>) {
  const envBun = env.BUN_EXECUTABLE;
  if (envBun && existsSync(envBun)) {
    return envBun;
  }

  if (isBunExecutablePath(process.execPath) && existsSync(process.execPath)) {
    return process.execPath;
  }

  return null;
}

function isBunExecutablePath(path: string) {
  const name = basename(path).toLowerCase();
  return name === "bun" || name === "bun.exe";
}

function prependPathEntry(pathValue: string | undefined, entry: string) {
  if (!pathValue) {
    return entry;
  }

  const parts = pathValue.split(delimiter).filter(Boolean);
  if (parts.includes(entry)) {
    return parts.join(delimiter);
  }

  return [entry, ...parts].join(delimiter);
}

function buildWorkflowSummary(run: SmithersRunState): string {
  const statusText = describeWorkflowSummaryStatus(run.status);
  const errorText =
    run.status === "failed" || run.status === "cancelled" ? parseErrorSummary(run.errorJson) : null;
  const nodeCountsText = formatNodeCounts(run.nodeCounts);

  const parts = [`${run.workflowName} run ${run.runId} is ${statusText}`];
  if (errorText) {
    parts[0] += `: ${errorText}`;
  }
  if (nodeCountsText) {
    parts[0] += `; ${nodeCountsText}`;
  }

  return `${parts[0]}.`;
}

function describeWorkflowSummaryStatus(status: SmithersRunStatus): string {
  switch (status) {
    case "waiting-approval":
      return "waiting for approval";
    case "waiting-event":
      return "waiting for an external event";
    case "waiting-timer":
      return "running on a timer wait";
    default:
      return status;
  }
}

function formatNodeCounts(nodeCounts: SmithersNodeCounts): string {
  const orderedStates = [
    "in-progress",
    "finished",
    "pending",
    "waiting-approval",
    "waiting-event",
    "waiting-timer",
    "failed",
    "cancelled",
    "skipped",
  ];
  const knownStates = new Set(orderedStates);
  const entries: string[] = [];

  for (const state of orderedStates) {
    const count = nodeCounts[state];
    if (typeof count === "number" && count > 0) {
      entries.push(`${count} ${state}`);
    }
  }

  const extraStates = Object.keys(nodeCounts)
    .filter((state) => !knownStates.has(state))
    .toSorted();
  for (const state of extraStates) {
    const count = nodeCounts[state];
    if (typeof count === "number" && count > 0) {
      entries.push(`${count} ${state}`);
    }
  }

  return entries.join(", ");
}

function parseErrorSummary(raw: string | null) {
  if (!raw) {
    return null;
  }

  const parsed = parsePayload(raw);
  if (typeof parsed === "string") {
    return parsed;
  }
  if (parsed && typeof parsed === "object") {
    if (typeof (parsed as { message?: unknown }).message === "string") {
      return (parsed as { message: string }).message;
    }
    if (typeof (parsed as { error?: unknown }).error === "string") {
      return (parsed as { error: string }).error;
    }
  }

  return truncateText(stringifyValue(parsed), 240);
}

function parsePayload(raw: string | null | undefined) {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function stripAnsi(value: string) {
  const escape = String.fromCharCode(0x1b);
  return value.replace(new RegExp(`${escape}\\[[0-9;]*[A-Za-z]`, "g"), "");
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function stringifyValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
