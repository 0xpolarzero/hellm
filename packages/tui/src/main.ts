import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  createSessionHeader,
  serializeStructuredEntry,
  type ThreadSnapshot,
} from "@hellm/session-model";
import {
  createOrchestrator,
  createFilesystemContextLoader,
} from "@hellm/orchestrator";
import { projectSessionState, renderMultiThreadProjection, projectThreadSnapshot, renderProjection } from "./index.ts";

function ensureSessionFile(filePath: string, sessionId: string, cwd: string): void {
  if (existsSync(filePath)) {
    return;
  }

  const dir = join(filePath, "..");
  mkdirSync(dir, { recursive: true });

  const header = createSessionHeader({
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd,
  });
  appendFileSync(filePath, `${JSON.stringify(header)}\n`, "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const prompt = args.find((arg) => !arg.startsWith("--")) ?? args[args.length - 1];

  if (!prompt) {
    const timestamp = new Date().toISOString();
    const snapshot: ThreadSnapshot = {
      thread: createThread({
        id: "demo",
        kind: "direct",
        objective: "Idle. Awaiting request.",
        status: "completed",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: process.cwd() }),
      workflowRuns: [],
    };

    for (const line of renderProjection(projectThreadSnapshot(snapshot))) {
      console.log(`[hellm/tui] ${line}`);
    }
    return;
  }

  const cwd = process.cwd();
  const threadId = `tui-${Date.now()}`;
  const sessionDir = join(cwd, ".hellm", "sessions");
  const sessionFile = join(sessionDir, `${threadId}.jsonl`);

  ensureSessionFile(sessionFile, threadId, cwd);

  const contextLoader = createFilesystemContextLoader({
    sessionFile,
    ...(existsSync(join(cwd, "AGENTS.md"))
      ? { agentsFile: join(cwd, "AGENTS.md") }
      : {}),
    skillsRoot: join(cwd, ".hellm", "skills"),
  });

  const orchestrator = createOrchestrator({ contextLoader });
  const result = await orchestrator.run({
    threadId,
    prompt,
    cwd,
  });

  for (const entry of result.sessionEntries) {
    appendFileSync(sessionFile, `${serializeStructuredEntry(entry)}\n`, "utf8");
  }

  const multiProjection = projectSessionState(result.sessionState, result.threadSnapshot.thread.id);
  for (const line of renderMultiThreadProjection(multiProjection)) {
    console.log(`[hellm/tui] ${line}`);
  }

  console.log(`[hellm/tui] classification: ${result.classification.path} (${result.classification.confidence})`);
  console.log(`[hellm/tui] status: ${result.state.visibleSummary}`);
  console.log(`[hellm/tui] completion: ${result.completion.isComplete ? "complete" : "waiting"} (${result.completion.reason})`);
  console.log(`[hellm/tui] session: ${sessionFile}`);
}

main().catch((error) => {
  console.error("[hellm/tui] fatal:", error);
  process.exit(1);
});
