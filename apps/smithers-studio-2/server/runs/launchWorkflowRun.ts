import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { handleWorkspaceBackendRequest, loadWorkspaceStatus, WorkspaceHttpError } from "../workspaceBackend";

const execFileAsync = promisify(execFile);

export type WorkflowLaunchResult = {
  runId: string;
  workflow: string;
};

/**
 * Resolve a workflow launch key to its `.tsx` file path on disk via the real
 * `GET /workflow-sources/<key>` resolution that the Source tab uses.
 */
async function resolveWorkflowPath(root: string, workflow: string): Promise<string> {
  const response = await handleWorkspaceBackendRequest({
    method: "GET",
    path: `/__smithers_studio/api/workflow-sources/${encodeURIComponent(workflow)}`,
    query: {},
  });
  if (response.status !== 200) {
    const message = response.payload && typeof response.payload === "object" && "error" in response.payload
      ? String((response.payload as { error: unknown }).error)
      : `Workflow ${workflow} was not found.`;
    throw new WorkspaceHttpError(response.status === 404 ? 404 : 400, message);
  }
  const payload = response.payload as { workflow?: { path?: string } };
  const relativePath = payload.workflow?.path;
  if (!relativePath) {
    throw new WorkspaceHttpError(404, `Workflow ${workflow} has no source path.`);
  }
  const absolute = resolve(join(root, relativePath));
  if (!existsSync(absolute)) {
    throw new WorkspaceHttpError(404, `Workflow file not found: ${relativePath}`);
  }
  return absolute;
}

/**
 * Launch a REAL detached workflow run via the `smithers up --detach` CLI and
 * return the run id it prints. The Workflows launch form posts here; the run
 * then appears in the gateway's run store (and the Runs surface) like any other
 * run. No synthetic run ids.
 */
export async function launchWorkflowRun(workflow: string, input: Record<string, unknown>): Promise<WorkflowLaunchResult> {
  const trimmed = workflow.trim();
  if (!trimmed) {
    throw new WorkspaceHttpError(400, "workflow is required.");
  }
  const status = loadWorkspaceStatus();
  if (!status.root) {
    throw new WorkspaceHttpError(404, `.smithers not found from ${status.cwd}`);
  }
  const workflowPath = await resolveWorkflowPath(status.root, trimmed);

  // Ask the CLI for its structured output envelope rather than scraping stdout:
  // `smithers up --detach` prints a human "Next steps" CTA block as its LAST
  // line, so the previous last-line scrape returned a CTA string, not the run
  // id. `--format json --full-output` emits `{ ok, data: { runId, ... }, meta }`
  // which we parse and validate.
  const args = ["up", workflowPath, "--detach", "--format", "json", "--full-output"];
  if (input && Object.keys(input).length > 0) {
    args.push("--input", JSON.stringify(input));
  }

  let stdout: string;
  try {
    const result = await execFileAsync("smithers", args, {
      cwd: status.root,
      env: { ...process.env, NO_COLOR: "1" },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    });
    stdout = result.stdout;
  } catch (error: unknown) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const message = stderr || (error instanceof Error ? error.message : String(error));
    throw new WorkspaceHttpError(500, `Failed to launch ${trimmed}: ${message}`);
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout.trim());
  } catch {
    throw new WorkspaceHttpError(502, `Launch of ${trimmed} produced unparseable output.`);
  }
  if (!envelope || typeof envelope !== "object") {
    throw new WorkspaceHttpError(502, `Launch of ${trimmed} produced no run envelope.`);
  }
  const env = envelope as { ok?: unknown; data?: unknown; error?: unknown };
  if (env.ok !== true) {
    const message = typeof env.error === "string" && env.error
      ? env.error
      : `Launch of ${trimmed} was not acknowledged by the CLI.`;
    throw new WorkspaceHttpError(502, message);
  }
  const data = env.data && typeof env.data === "object" ? (env.data as { runId?: unknown }) : null;
  const runId = data && typeof data.runId === "string" ? data.runId.trim() : "";
  if (!runId) {
    throw new WorkspaceHttpError(502, `Launch of ${trimmed} produced no run id.`);
  }
  return { runId, workflow: trimmed };
}
