import { mkdirSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createOrchestrator,
  createFilesystemContextLoader,
  type Orchestrator,
  type OrchestratorRequest,
  type OrchestratorRunResult,
  type WorkflowSeedInput,
} from "@hellm/orchestrator";
import {
  createSessionHeader,
  serializeStructuredEntry,
  type StructuredSessionEntry,
  type ThreadSnapshot,
} from "@hellm/session-model";

export type JsonlEvent =
  | {
      type: "run.started";
      orchestratorId: string;
      threadId: string;
    }
  | {
      type: "run.classified";
      path: OrchestratorRunResult["classification"]["path"];
      reason: string;
    }
  | {
      type: "run.episode";
      episodeId: string;
      status: ThreadSnapshot["episodes"][number]["status"];
      source: ThreadSnapshot["episodes"][number]["source"];
    }
  | {
      type: "run.completed" | "run.waiting";
      threadId: string;
      status: ThreadSnapshot["thread"]["status"];
      latestEpisodeId: string;
    };

export interface HeadlessRequest extends OrchestratorRequest {
  workflowSeedInput?: WorkflowSeedInput;
}

export interface HeadlessStructuredOutput {
  threadId: string;
  status: ThreadSnapshot["thread"]["status"];
  latestEpisodeId: string;
  summary: string;
  workflowRunIds: string[];
}

export interface HeadlessResult {
  orchestratorId: string;
  threadSnapshot: ThreadSnapshot;
  output: HeadlessStructuredOutput;
  events: JsonlEvent[];
  raw: OrchestratorRunResult;
}

function resolveSessionFile(sessionDir: string, sessionId: string): string {
  return join(sessionDir, `${sessionId}.jsonl`);
}

function ensureSessionHeader(filePath: string, sessionId: string, cwd: string): boolean {
  try {
    if (existsSync(filePath)) {
      return true;
    }

    const dir = resolve(filePath, "..");
    mkdirSync(dir, { recursive: true });

    const header = createSessionHeader({
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd,
    });
    appendFileSync(filePath, `${JSON.stringify(header)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function appendStructuredEntries(
  filePath: string,
  entries: readonly StructuredSessionEntry[],
): void {
  try {
    for (const entry of entries) {
      appendFileSync(filePath, `${serializeStructuredEntry(entry)}\n`, "utf8");
    }
  } catch {
    // Session file not writable; entries still available in result.sessionEntries
  }
}

export interface HeadlessSessionConfig {
  sessionDir?: string;
}

export async function executeHeadlessRun(
  request: HeadlessRequest,
  options: {
    orchestrator?: Orchestrator;
    sessionConfig?: HeadlessSessionConfig;
  } = {},
): Promise<HeadlessResult> {
  const sessionDir = options.sessionConfig?.sessionDir ?? join(request.cwd, ".hellm", "sessions");
  const sessionFile = resolveSessionFile(sessionDir, request.threadId);

  const sessionWritable = ensureSessionHeader(sessionFile, request.threadId, request.cwd);

  const contextLoader = sessionWritable
    ? createFilesystemContextLoader({
        sessionFile,
        ...(existsSync(join(request.cwd, "AGENTS.md"))
          ? { agentsFile: join(request.cwd, "AGENTS.md") }
          : {}),
        skillsRoot: join(request.cwd, ".hellm", "skills"),
      })
    : undefined;

  const orchestrator =
    options.orchestrator ??
    createOrchestrator(
      contextLoader ? { contextLoader } : {},
    );

  const raw = await orchestrator.run(request);
  const events = createJsonlEvents(orchestrator, raw);
  const latestEpisode = raw.threadSnapshot.episodes.at(-1);
  if (!latestEpisode) {
    throw new Error("Headless execution did not produce an episode.");
  }

  if (sessionWritable) {
    appendStructuredEntries(sessionFile, raw.sessionEntries);
  }

  return {
    orchestratorId: orchestrator.id,
    threadSnapshot: raw.threadSnapshot,
    output: {
      threadId: raw.threadSnapshot.thread.id,
      status: raw.threadSnapshot.thread.status,
      latestEpisodeId: latestEpisode.id,
      summary:
        latestEpisode.conclusions[0] ??
        latestEpisode.followUpSuggestions[0] ??
        latestEpisode.objective,
      workflowRunIds: raw.threadSnapshot.workflowRuns.map((run) => run.runId),
    },
    events,
    raw,
  };
}

export function createJsonlEvents(
  orchestrator: Orchestrator,
  result: OrchestratorRunResult,
): JsonlEvent[] {
  const latestEpisode = result.threadSnapshot.episodes.at(-1);
  if (!latestEpisode) {
    throw new Error("Cannot build JSONL events without an episode.");
  }

  return [
    {
      type: "run.started",
      orchestratorId: orchestrator.id,
      threadId: result.threadSnapshot.thread.id,
    },
    {
      type: "run.classified",
      path: result.classification.path,
      reason: result.classification.reason,
    },
    {
      type: "run.episode",
      episodeId: latestEpisode.id,
      status: latestEpisode.status,
      source: latestEpisode.source,
    },
    {
      type: result.completion.isComplete ? "run.completed" : "run.waiting",
      threadId: result.threadSnapshot.thread.id,
      status: result.threadSnapshot.thread.status,
      latestEpisodeId: latestEpisode.id,
    },
  ];
}

export function serializeJsonlEvents(events: readonly JsonlEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join("\n");
}

function parseHeadlessInputFile(path: string): Partial<HeadlessRequest> {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid --input-file payload at ${path}. Expected JSON object.`);
  }
  return parsed as Partial<HeadlessRequest>;
}

export function parseHeadlessCliRequest(args: readonly string[]): HeadlessRequest {
  const valueFlags = new Set([
    "--hint",
    "--cwd",
    "--session",
    "--worktree",
    "--resume-run-id",
    "--approve-run",
    "--deny-run",
    "--approval-note",
    "--approval-by",
    "--input-file",
  ]);
  let promptFromArgs: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith("--")) {
      if (valueFlags.has(arg)) {
        index += 1;
      }
      continue;
    }
    promptFromArgs = arg;
  }

  const hintIndex = args.indexOf("--hint");
  const cwdIndex = args.indexOf("--cwd");
  const sessionIndex = args.indexOf("--session");
  const worktreeIndex = args.indexOf("--worktree");
  const resumeRunIdIndex = args.indexOf("--resume-run-id");
  const approveRunIndex = args.indexOf("--approve-run");
  const denyRunIndex = args.indexOf("--deny-run");
  const approvalNoteIndex = args.indexOf("--approval-note");
  const approvalByIndex = args.indexOf("--approval-by");
  const inputFileIndex = args.indexOf("--input-file");

  const requestFromFile =
    inputFileIndex >= 0
      ? parseHeadlessInputFile(args[inputFileIndex + 1]!)
      : {};

  const routeHint = hintIndex >= 0
    ? args[hintIndex + 1] as "direct" | "smithers-workflow" | "verification" | "approval"
    : requestFromFile.routeHint;
  const cwd =
    cwdIndex >= 0 ? args[cwdIndex + 1]! : requestFromFile.cwd ?? process.cwd();
  const sessionId =
    sessionIndex >= 0
      ? args[sessionIndex + 1]!
      : requestFromFile.threadId ?? `cli-${Date.now()}`;
  const worktreePath =
    worktreeIndex >= 0 ? args[worktreeIndex + 1] : requestFromFile.worktreePath;
  const resumeRunId =
    resumeRunIdIndex >= 0
      ? args[resumeRunIdIndex + 1]
      : requestFromFile.resumeRunId;
  const prompt = promptFromArgs ?? requestFromFile.prompt ?? "help";
  if (approveRunIndex >= 0 && denyRunIndex >= 0) {
    throw new Error("Specify only one of --approve-run or --deny-run.");
  }

  const approvalRunId =
    approveRunIndex >= 0
      ? args[approveRunIndex + 1]
      : denyRunIndex >= 0
        ? args[denyRunIndex + 1]
        : undefined;
  const approvalDecision = approvalRunId
    ? {
        runId: approvalRunId,
        approved: approveRunIndex >= 0,
        ...(approvalNoteIndex >= 0
          ? { note: args[approvalNoteIndex + 1] }
          : {}),
        ...(approvalByIndex >= 0
          ? { decidedBy: args[approvalByIndex + 1] }
          : {}),
      }
    : requestFromFile.approvalDecision;

  return {
    ...requestFromFile,
    threadId: sessionId,
    prompt,
    cwd,
    ...(routeHint ? { routeHint } : {}),
    ...(worktreePath ? { worktreePath } : {}),
    ...(resumeRunId ? { resumeRunId } : {}),
    ...(approvalDecision ? { approvalDecision } : {}),
  };
}

if (import.meta.main) {
  const request = parseHeadlessCliRequest(process.argv.slice(2));
  const result = await executeHeadlessRun(request);

  console.log(serializeJsonlEvents(result.events));
}
