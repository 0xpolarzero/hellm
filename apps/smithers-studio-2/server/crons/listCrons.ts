import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { loadWorkspaceStatus, WorkspaceHttpError } from "../workspaceBackend";

export type WorkspaceCron = {
  cronId: string;
  workflow: string;
  pattern: string;
  enabled: boolean;
};

function findSmithersDb(root: string): string {
  const candidates = [
    process.env.SMITHERS_STUDIO_DB_PATH,
    join(root, "smithers.db"),
    join(root, ".smithers", "smithers.db"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const dbPath = candidates.map((candidate) => resolve(candidate)).find((candidate) => existsSync(candidate));
  if (!dbPath) {
    throw new WorkspaceHttpError(404, `No smithers.db found for ${root}.`);
  }
  return dbPath;
}

/**
 * List the workspace's real scheduled triggers from the `_smithers_cron` table.
 *
 * The Workflows "Schedules" segment reads these. The `workflow` field carries
 * the cron's `workflow_path` (its launch key), matching the gateway/CLI cron
 * model — no fabricated schedules.
 */
export function listCrons(): WorkspaceCron[] {
  const status = loadWorkspaceStatus();
  if (!status.root) {
    throw new WorkspaceHttpError(404, `.smithers not found from ${status.cwd}`);
  }
  const db = new Database(findSmithersDb(status.root), { readonly: true });
  try {
    const tableExists = Boolean(
      db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_smithers_cron'").get(),
    );
    if (!tableExists) {
      return [];
    }
    const rows = db
      .query(
        `SELECT cron_id AS cronId, workflow_path AS workflowPath, pattern, enabled
         FROM _smithers_cron
         ORDER BY cron_id`,
      )
      .all() as Array<{ cronId: string; workflowPath: string | null; pattern: string | null; enabled: number | null }>;
    return rows.map((row) => ({
      cronId: String(row.cronId),
      workflow: row.workflowPath ?? "",
      pattern: row.pattern ?? "",
      enabled: Boolean(row.enabled),
    }));
  } finally {
    db.close();
  }
}
