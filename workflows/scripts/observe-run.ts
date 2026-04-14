#!/usr/bin/env bun

import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export type ObserveRunOptions = {
  runId?: string
  intervalMs: number
  once: boolean
  model: string
  reasoningEffort: string
  repoRoot: string
  smithersCwd: string
  smithersBin: string
  dbPath: string
  focusNodes: number
  eventTail: number
  worktreePath?: string
  noCodex: boolean
}

type RunRow = {
  runId: string
  workflowName: string | null
  workflowPath: string | null
  status: string
  createdAtMs: number
  startedAtMs: number | null
  finishedAtMs: number | null
  heartbeatAtMs: number | null
  vcsRoot: string | null
  vcsRevision: string | null
  errorJson: string | null
}

type NodeRow = {
  nodeId: string
  iteration: number
  state: string
  lastAttempt: number | null
  updatedAtMs: number
  label: string | null
}

type EventRow = {
  seq: number
  timestampMs: number
  type: string
  payloadJson: string
}

type RepoContext = {
  path: string
  branch: string | null
  head: string | null
  lastCommit: string | null
  statusShort: string
  changedFiles: string[]
  workingTreeDiffStat: string
  stagedDiffStat: string
}

type CompactToolCall = {
  name: string
  status: string
  durationMs: number | null
  error: string | null
  input: string | null
  output: string | null
}

type CompactAttempt = {
  attempt: number
  state: string
  startedAtMs: number
  liveDurationMs: number | null
  error: string | null
  jjCwd: string | null
  tokens: {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
    costUsd: number | null
  }
  responseText: string | null
  toolCalls: CompactToolCall[]
}

type FocusNodeEvidence = {
  nodeId: string
  label: string | null
  state: string
  iteration: number
  attemptsSummary: Record<string, number>
  latestAttempt: CompactAttempt | null
  recentAttempts: CompactAttempt[]
  validatedOutput: string | null
  rawOutput: string | null
  recentEventLines: string[]
}

type Observation = {
  collectedAtIso: string
  run: {
    id: string
    workflow: string
    workflowPath: string | null
    status: string
    startedAtIso: string | null
    finishedAtIso: string | null
    elapsedMs: number | null
    heartbeatAgeMs: number | null
    lastEventAgeMs: number | null
    vcsRoot: string | null
    vcsRevision: string | null
    error: string | null
  }
  stepStates: Array<{
    id: string
    state: string
    attempt: number | null
    label: string | null
  }>
  stepChanges: string[]
  focusNodes: FocusNodeEvidence[]
  recentEventLines: string[]
  newEventLines: string[]
  repoContexts: RepoContext[]
  whyText: string | null
}

type PreviousObservation = {
  lastEventSeq: number
  stepStateById: Record<string, string>
  repoFingerprints: Record<string, string>
  summary: string
  collectedAtIso: string
}

type CommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const WORKFLOWS_DIR = resolve(SCRIPT_DIR, "..")
const REPO_ROOT = resolve(WORKFLOWS_DIR, "..")
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_SMITHERS_CWD = resolve(REPO_ROOT, "workflows")
const DEFAULT_SMITHERS_BIN = resolve(DEFAULT_SMITHERS_CWD, "node_modules/.bin/smithers")
const DEFAULT_DB_PATH = resolve(DEFAULT_SMITHERS_CWD, "smithers.db")
const SUMMARY_PROMPT_PATH = resolve(DEFAULT_SMITHERS_CWD, "prompts/smithers-run-summary.md")
const FOCUS_STATES = new Set([
  "running",
  "in-progress",
  "failed",
  "waiting-approval",
  "waiting-timer",
  "waiting-event",
])

async function main() {
  const options = parseObserveRunArgs(process.argv.slice(2))
  await runObserver(options)
}

export async function runObserver(options: ObserveRunOptions) {

  if (!existsSync(options.smithersBin)) {
    throw new Error(
      `Smithers binary not found at ${options.smithersBin}. Pass --smithers-bin if your local path differs.`,
    )
  }
  if (!existsSync(options.dbPath)) {
    throw new Error(
      `Smithers DB not found at ${options.dbPath}. Pass --db-path if your run database lives elsewhere.`,
    )
  }

  let previous: PreviousObservation | null = null

  while (true) {
    const observation = await collectObservation(options, previous)
    const summary = options.noCodex
      ? buildDeterministicSummary(observation, previous)
      : await buildNarrativeSummary(observation, previous, options)

    printSummary(observation, summary, options.noCodex)

    if (options.once || isTerminalStatus(observation.run.status)) {
      if (isTerminalStatus(observation.run.status)) {
        console.log(`observer exiting because run ${observation.run.id} is ${observation.run.status}`)
      }
      break
    }

    const repoFingerprints = Object.fromEntries(
      observation.repoContexts.map((context) => [context.path, fingerprintRepoContext(context)]),
    )

    previous = {
      lastEventSeq: await getLatestEventSeq(options.dbPath, observation.run.id),
      stepStateById: Object.fromEntries(
        observation.stepStates.map((step) => [step.id, step.state]),
      ),
      repoFingerprints,
      summary,
      collectedAtIso: observation.collectedAtIso,
    }

    await sleep(options.intervalMs)
  }
}

export function parseObserveRunArgs(argv: string[]): ObserveRunOptions {
  const options: ObserveRunOptions = {
    intervalMs: DEFAULT_INTERVAL_MS,
    once: false,
    model: "gpt-5.4",
    reasoningEffort: "high",
    repoRoot: REPO_ROOT,
    smithersCwd: DEFAULT_SMITHERS_CWD,
    smithersBin: DEFAULT_SMITHERS_BIN,
    dbPath: DEFAULT_DB_PATH,
    focusNodes: 3,
    eventTail: 40,
    noCodex: false,
  }

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!

    switch (arg) {
      case "--help":
      case "-h":
        printObserveRunHelp()
        process.exit(0)
      case "--run-id":
        options.runId = readRequiredValue(argv, ++index, arg)
        break
      case "--interval":
        options.intervalMs = parseDurationMs(readRequiredValue(argv, ++index, arg))
        break
      case "--once":
        options.once = true
        break
      case "--model":
        options.model = readRequiredValue(argv, ++index, arg)
        break
      case "--reasoning-effort":
        options.reasoningEffort = readRequiredValue(argv, ++index, arg)
        break
      case "--repo-root":
        options.repoRoot = resolve(readRequiredValue(argv, ++index, arg))
        break
      case "--smithers-cwd":
        options.smithersCwd = resolve(readRequiredValue(argv, ++index, arg))
        break
      case "--smithers-bin":
        options.smithersBin = resolve(readRequiredValue(argv, ++index, arg))
        break
      case "--db-path":
        options.dbPath = resolve(readRequiredValue(argv, ++index, arg))
        break
      case "--focus-nodes":
        options.focusNodes = parsePositiveInt(readRequiredValue(argv, ++index, arg), arg)
        break
      case "--event-tail":
        options.eventTail = parsePositiveInt(readRequiredValue(argv, ++index, arg), arg)
        break
      case "--worktree-path":
        options.worktreePath = resolve(readRequiredValue(argv, ++index, arg))
        break
      case "--no-codex":
        options.noCodex = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

export function printObserveRunHelp() {
  console.log(`
Observe a local Smithers run and emit high-signal summaries.

Usage:
  bun workflows/scripts/observe-run.ts [options]

Options:
  --run-id <id>            Observe a specific run (default: latest active run)
  --once                   Emit one summary and exit
  --interval <duration>    Summary cadence, e.g. 5m, 30s, 1h (default: 5m)
  --model <id>             Codex model for summary synthesis (default: gpt-5.4)
  --reasoning-effort <id>  Codex reasoning effort (default: high)
  --repo-root <path>       Repo root for Codex summary execution
  --smithers-cwd <path>    Smithers working directory (default: workflows/)
  --smithers-bin <path>    Smithers binary path (default: workflows/node_modules/.bin/smithers)
  --db-path <path>         Smithers SQLite path (default: workflows/smithers.db)
  --focus-nodes <n>        Number of focus nodes to inspect deeply (default: 3)
  --event-tail <n>         Number of recent events to include (default: 40)
  --worktree-path <path>   Force a repo/worktree path for git diff context
  --no-codex               Skip narrative synthesis and print deterministic summaries only
`)
}

function readRequiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index]
  if (!value) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

function parsePositiveInt(raw: string, flag: string) {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected a positive integer for ${flag}, got "${raw}"`)
  }
  return value
}

function parseDurationMs(raw: string) {
  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10) * 60_000
  }

  const match = raw.match(/^(\d+)(ms|s|m|h)$/)
  if (!match) {
    throw new Error(`Invalid duration "${raw}". Use values like 30s, 5m, or 1h.`)
  }

  const value = Number.parseInt(match[1]!, 10)
  const unit = match[2]!

  switch (unit) {
    case "ms":
      return value
    case "s":
      return value * 1_000
    case "m":
      return value * 60_000
    case "h":
      return value * 60 * 60_000
    default:
      throw new Error(`Unsupported duration unit: ${unit}`)
  }
}

async function collectObservation(
  options: ObserveRunOptions,
  previous: PreviousObservation | null,
): Promise<Observation> {
  const runId = resolveRunId(options.dbPath, options.runId)
  const runRow = getRunRow(options.dbPath, runId)

  if (!runRow) {
    throw new Error(`Run not found: ${runId}`)
  }

  let inspect: any = null
  try {
    inspect = await runSmithersJson<any>(options, ["inspect", runId])
  } catch {
    inspect = null
  }
  const nodeRows = listNodeRows(options.dbPath, runId)
  const focusNodeRows = selectFocusNodes(nodeRows, options.focusNodes)
  const focusNodes = await Promise.all(
    focusNodeRows.map(async (row) => {
      const recentEventsForNode = listRecentEventsForNode(
        options.dbPath,
        runId,
        row.nodeId,
        row.iteration,
        12,
      )

      try {
        const detail = await runSmithersJson<any>(options, [
          "node",
          row.nodeId,
          "-r",
          runId,
          "--attempts",
          "--tools",
        ])

        return compactNodeDetail(row, detail, recentEventsForNode)
      } catch (error) {
        return {
          nodeId: row.nodeId,
          label: row.label,
          state: row.state,
          iteration: row.iteration,
          attemptsSummary: {},
          latestAttempt: null,
          recentAttempts: [],
          validatedOutput: null,
          rawOutput: truncateText(
            `failed to load node detail: ${error instanceof Error ? error.message : String(error)}`,
            400,
          ),
          recentEventLines: recentEventsForNode.map((event) =>
            formatEventLine(
              event,
              recentEventsForNode.at(0)?.timestampMs ?? event.timestampMs,
            ),
          ),
        } satisfies FocusNodeEvidence
      }
    }),
  )

  const recentEvents = listRecentEvents(options.dbPath, runId, options.eventTail)
  const lastEventSeq = recentEvents.at(-1)?.seq ?? -1
  const newEvents = previous
    ? listEventsAfterSeq(options.dbPath, runId, previous.lastEventSeq, options.eventTail)
    : recentEvents.slice(Math.max(0, recentEvents.length - 12))

  const repoContexts = await collectRepoContexts(options, runRow, focusNodes)
  const whyText =
    runRow.status.startsWith("waiting") || runRow.status === "failed"
      ? await runSmithersText(options, ["why", runId]).catch(() => null)
      : null

  const stepStates = Array.isArray(inspect?.steps)
    ? inspect.steps.map((step: any) => ({
        id: String(step.id ?? step.label ?? "unknown"),
        state: String(step.state ?? "unknown"),
        attempt:
          typeof step.attempt === "number" && Number.isFinite(step.attempt)
            ? step.attempt
            : null,
        label: typeof step.label === "string" ? step.label : null,
      }))
    : nodeRows.map((row) => ({
        id: row.nodeId,
        state: row.state,
        attempt: row.lastAttempt,
        label: row.label,
      }))

  return {
    collectedAtIso: new Date().toISOString(),
    run: {
      id: runId,
      workflow:
        inspect?.run?.workflow ??
        runRow.workflowName ??
        (runRow.workflowPath ? basename(runRow.workflowPath) : "workflow"),
      workflowPath: runRow.workflowPath,
      status: inspect?.run?.status ?? runRow.status,
      startedAtIso: formatIso(runRow.startedAtMs),
      finishedAtIso: formatIso(runRow.finishedAtMs),
      elapsedMs: computeElapsedMs(runRow.startedAtMs, runRow.finishedAtMs),
      heartbeatAgeMs:
        typeof runRow.heartbeatAtMs === "number" ? Date.now() - runRow.heartbeatAtMs : null,
      lastEventAgeMs:
        typeof recentEvents.at(-1)?.timestampMs === "number"
          ? Date.now() - recentEvents.at(-1)!.timestampMs
          : null,
      vcsRoot: runRow.vcsRoot,
      vcsRevision: runRow.vcsRevision,
      error: parseErrorSummary(runRow.errorJson),
    },
    stepStates,
    stepChanges: diffStepStates(stepStates, previous?.stepStateById ?? null),
    focusNodes,
    recentEventLines: recentEvents.map((event) =>
      formatEventLine(event, runRow.startedAtMs ?? runRow.createdAtMs),
    ),
    newEventLines: newEvents.map((event) =>
      formatEventLine(event, runRow.startedAtMs ?? runRow.createdAtMs),
    ),
    repoContexts,
    whyText,
  }
}

function resolveRunId(dbPath: string, requestedRunId?: string) {
  if (requestedRunId) {
    return requestedRunId
  }

  const db = openReadonlyDb(dbPath)
  try {
    const active = db
      .query(
        `SELECT run_id AS runId
         FROM _smithers_runs
         WHERE status IN ('running', 'waiting-approval', 'waiting-timer', 'waiting-event')
         ORDER BY COALESCE(started_at_ms, created_at_ms) DESC
         LIMIT 1`,
      )
      .get() as { runId?: string } | null

    if (active?.runId) {
      return active.runId
    }

    const latest = db
      .query(
        `SELECT run_id AS runId
         FROM _smithers_runs
         ORDER BY COALESCE(started_at_ms, created_at_ms) DESC
         LIMIT 1`,
      )
      .get() as { runId?: string } | null

    if (!latest?.runId) {
      throw new Error("No Smithers runs were found in the configured database.")
    }

    return latest.runId
  } finally {
    db.close()
  }
}

function getRunRow(dbPath: string, runId: string): RunRow | null {
  const db = openReadonlyDb(dbPath)
  try {
    return (db
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
      .get(runId) as RunRow | null)
  } finally {
    db.close()
  }
}

function listNodeRows(dbPath: string, runId: string) {
  const db = openReadonlyDb(dbPath)
  try {
    return db
      .query(
        `SELECT
           node_id AS nodeId,
           iteration AS iteration,
           state AS state,
           last_attempt AS lastAttempt,
           updated_at_ms AS updatedAtMs,
           label AS label
         FROM _smithers_nodes
         WHERE run_id = ?
         ORDER BY updated_at_ms DESC, node_id ASC`,
      )
      .all(runId) as NodeRow[]
  } finally {
    db.close()
  }
}

function listRecentEvents(dbPath: string, runId: string, limit: number) {
  const db = openReadonlyDb(dbPath)
  try {
    const rows = db
      .query(
        `SELECT
           seq AS seq,
           timestamp_ms AS timestampMs,
           type AS type,
           payload_json AS payloadJson
         FROM _smithers_events
         WHERE run_id = ?
         ORDER BY seq DESC
         LIMIT ?`,
      )
      .all(runId, limit) as EventRow[]
    return rows.reverse()
  } finally {
    db.close()
  }
}

function listEventsAfterSeq(dbPath: string, runId: string, afterSeq: number, limit: number) {
  const db = openReadonlyDb(dbPath)
  try {
    return db
      .query(
        `SELECT
           seq AS seq,
           timestamp_ms AS timestampMs,
           type AS type,
           payload_json AS payloadJson
         FROM _smithers_events
         WHERE run_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(runId, afterSeq, limit) as EventRow[]
  } finally {
    db.close()
  }
}

function listRecentEventsForNode(
  dbPath: string,
  runId: string,
  nodeId: string,
  iteration: number,
  limit: number,
) {
  const db = openReadonlyDb(dbPath)
  try {
    const rows = db
      .query(
        `SELECT
           seq AS seq,
           timestamp_ms AS timestampMs,
           type AS type,
           payload_json AS payloadJson
         FROM _smithers_events
         WHERE run_id = ?
           AND json_extract(payload_json, '$.nodeId') = ?
           AND COALESCE(CAST(json_extract(payload_json, '$.iteration') AS INTEGER), 0) = ?
         ORDER BY seq DESC
         LIMIT ?`,
      )
      .all(runId, nodeId, iteration, limit) as EventRow[]
    return rows.reverse()
  } finally {
    db.close()
  }
}

async function collectRepoContexts(
  options: ObserveRunOptions,
  runRow: RunRow,
  focusNodes: FocusNodeEvidence[],
) {
  const candidatePaths = new Set<string>()

  if (options.worktreePath) {
    candidatePaths.add(options.worktreePath)
  }
  for (const node of focusNodes) {
    const jjCwd = node.latestAttempt?.jjCwd
    if (jjCwd) {
      candidatePaths.add(jjCwd)
    }
  }
  if (typeof runRow.vcsRoot === "string" && runRow.vcsRoot.length > 0) {
    candidatePaths.add(runRow.vcsRoot)
  }

  const results: RepoContext[] = []
  for (const candidate of candidatePaths) {
    const context = await inspectGitRepo(candidate)
    if (context) {
      results.push(context)
    }
  }
  return results
}

async function inspectGitRepo(repoPath: string): Promise<RepoContext | null> {
  if (!existsSync(repoPath)) {
    return null
  }

  const gitCheck = await runCommand("git", ["-C", repoPath, "rev-parse", "--show-toplevel"])
  if (gitCheck.exitCode !== 0) {
    return null
  }

  const [branch, head, lastCommit, statusShort, workingTreeDiffStat, stagedDiffStat] =
    await Promise.all([
      runCommand("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"]),
      runCommand("git", ["-C", repoPath, "rev-parse", "--short", "HEAD"]),
      runCommand("git", ["-C", repoPath, "log", "-1", "--oneline"]),
      runCommand("git", ["-C", repoPath, "status", "--short", "--branch"]),
      runCommand("git", ["-C", repoPath, "diff", "--stat"]),
      runCommand("git", ["-C", repoPath, "diff", "--cached", "--stat"]),
    ])

  return {
    path: repoPath,
    branch: branch.exitCode === 0 ? normalizeMultiline(branch.stdout) : null,
    head: head.exitCode === 0 ? normalizeMultiline(head.stdout) : null,
    lastCommit:
      lastCommit.exitCode === 0 ? normalizeMultiline(lastCommit.stdout) : null,
    statusShort: clipTailLines(statusShort.stdout, 80),
    changedFiles: parseChangedFiles(statusShort.stdout),
    workingTreeDiffStat: clipTailLines(workingTreeDiffStat.stdout, 40),
    stagedDiffStat: clipTailLines(stagedDiffStat.stdout, 40),
  }
}

function parseChangedFiles(statusShort: string) {
  const files: string[] = []
  for (const line of statusShort.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("##")) {
      continue
    }
    const file = trimmed.slice(3).trim()
    if (file.length > 0) {
      files.push(file)
    }
  }
  return files
}

function selectFocusNodes(nodeRows: NodeRow[], limit: number) {
  const ordered = [...nodeRows].sort((left, right) => {
    const leftFocus = FOCUS_STATES.has(left.state) ? 1 : 0
    const rightFocus = FOCUS_STATES.has(right.state) ? 1 : 0

    if (leftFocus !== rightFocus) {
      return rightFocus - leftFocus
    }
    if ((left.lastAttempt ?? 0) !== (right.lastAttempt ?? 0)) {
      return (right.lastAttempt ?? 0) - (left.lastAttempt ?? 0)
    }
    return right.updatedAtMs - left.updatedAtMs
  })

  return ordered.slice(0, limit)
}

function compactNodeDetail(
  row: NodeRow,
  detail: any,
  recentEvents: EventRow[],
): FocusNodeEvidence {
  const attempts = Array.isArray(detail?.attempts) ? detail.attempts : []
  const recentAttempts = attempts.slice(-3).map(compactAttempt)
  const latestAttempt = attempts.length > 0 ? compactAttempt(attempts.at(-1)) : null
  const recentEventBaseMs =
    latestAttempt?.startedAtMs ??
    recentEvents.at(0)?.timestampMs ??
    Date.now()

  return {
    nodeId: row.nodeId,
    label: typeof detail?.node?.label === "string" ? detail.node.label : row.label,
    state: typeof detail?.status === "string" ? detail.status : row.state,
    iteration:
      typeof detail?.node?.iteration === "number" ? detail.node.iteration : row.iteration,
    attemptsSummary:
      detail?.attemptsSummary && typeof detail.attemptsSummary === "object"
        ? detail.attemptsSummary
        : {},
    latestAttempt,
    recentAttempts,
    validatedOutput: compactStructuredValue(detail?.output?.validated, 1_200),
    rawOutput: compactStructuredValue(detail?.output?.raw, 800),
    recentEventLines: recentEvents.map((event) =>
      formatEventLine(event, recentEventBaseMs),
    ),
  }
}

function compactAttempt(attempt: any): CompactAttempt {
  const toolCalls = Array.isArray(attempt?.toolCalls) ? attempt.toolCalls : []
  const liveDurationMs =
    typeof attempt?.finishedAtMs === "number"
      ? normalizeDurationMs(attempt?.startedAtMs, attempt?.finishedAtMs)
      : typeof attempt?.startedAtMs === "number"
        ? Date.now() - attempt.startedAtMs
        : null

  return {
    attempt: typeof attempt?.attempt === "number" ? attempt.attempt : 0,
    state: typeof attempt?.state === "string" ? attempt.state : "unknown",
    startedAtMs: typeof attempt?.startedAtMs === "number" ? attempt.startedAtMs : 0,
    liveDurationMs,
    error: typeof attempt?.error === "string" ? attempt.error : null,
    jjCwd: typeof attempt?.jjCwd === "string" ? attempt.jjCwd : null,
    tokens: {
      input: toNumber(attempt?.tokenUsage?.inputTokens) ?? 0,
      output: toNumber(attempt?.tokenUsage?.outputTokens) ?? 0,
      reasoning: toNumber(attempt?.tokenUsage?.reasoningTokens) ?? 0,
      cacheRead: toNumber(attempt?.tokenUsage?.cacheReadTokens) ?? 0,
      cacheWrite: toNumber(attempt?.tokenUsage?.cacheWriteTokens) ?? 0,
      costUsd:
        typeof attempt?.tokenUsage?.costUsd === "number"
          ? attempt.tokenUsage.costUsd
          : null,
    },
    responseText:
      typeof attempt?.responseText === "string"
        ? truncateText(attempt.responseText, 1_500)
        : null,
    toolCalls: toolCalls.slice(-5).map((toolCall: any) => ({
      name: typeof toolCall?.name === "string" ? toolCall.name : "tool",
      status: typeof toolCall?.status === "string" ? toolCall.status : "unknown",
      durationMs: normalizeDurationMs(toolCall?.startedAtMs, toolCall?.finishedAtMs),
      error: typeof toolCall?.error === "string" ? toolCall.error : null,
      input: compactStructuredValue(toolCall?.input, 400),
      output: compactStructuredValue(toolCall?.output, 400),
    })),
  }
}

function diffStepStates(
  currentSteps: Observation["stepStates"],
  previousStateById: Record<string, string> | null,
) {
  if (!previousStateById) {
    return currentSteps
      .filter((step) => FOCUS_STATES.has(step.state))
      .map((step) => `${step.id} entered ${step.state}`)
  }

  const changes: string[] = []
  for (const step of currentSteps) {
    const previous = previousStateById[step.id]
    if (!previous) {
      changes.push(`${step.id} appeared as ${step.state}`)
      continue
    }
    if (previous !== step.state) {
      changes.push(`${step.id}: ${previous} -> ${step.state}`)
    }
  }
  return changes
}

async function buildNarrativeSummary(
  observation: Observation,
  previous: PreviousObservation | null,
  options: ObserveRunOptions,
) {
  const prompt = await buildSummaryPrompt(observation, previous)
  const outputDir = mkdtempSync(resolve(tmpdir(), "svvy-smithers-observer-"))
  const outputLastMessage = resolve(outputDir, "last-message.txt")

  try {
    const result = await runCommand(
      "codex",
      [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--cd",
        options.repoRoot,
        "--model",
        options.model,
        "-c",
        `model_reasoning_effort=${options.reasoningEffort}`,
        "-c",
        "features.multi_agent=false",
        "-c",
        "agents.max_threads=1",
        "--output-last-message",
        outputLastMessage,
        "-",
      ],
      {
        cwd: options.repoRoot,
        input: prompt,
      },
    )

    if (result.exitCode !== 0) {
      return [
        "Codex summary generation failed; falling back to deterministic summary.",
        "",
        buildDeterministicSummary(observation, previous),
        "",
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n")
    }

    const finalText = existsSync(outputLastMessage)
      ? Bun.file(outputLastMessage).text()
      : Promise.resolve("")

    const resolved = normalizeMultiline(await finalText)
    if (!resolved) {
      return buildDeterministicSummary(observation, previous)
    }
    return resolved
  } finally {
    rmSync(outputDir, { recursive: true, force: true })
  }
}

async function buildSummaryPrompt(
  observation: Observation,
  previous: PreviousObservation | null,
) {
  const summaryPrompt = await readSummaryPrompt()
  const repoContext = observation.repoContexts.map((context) => ({
    path: context.path,
    branch: context.branch,
    head: context.head,
    lastCommit: context.lastCommit,
    changedFiles: context.changedFiles,
    statusShort: context.statusShort,
    workingTreeDiffStat: context.workingTreeDiffStat,
    stagedDiffStat: context.stagedDiffStat,
  }))

  const evidence = {
    run: observation.run,
    stepStates: observation.stepStates,
    stepChanges: observation.stepChanges,
    focusNodes: observation.focusNodes,
    recentEvents: observation.recentEventLines,
    newEventsSincePreviousSummary: observation.newEventLines,
    repoContext,
    why: observation.whyText,
    previousSummary:
      previous == null
        ? null
        : {
            collectedAtIso: previous.collectedAtIso,
            summary: previous.summary,
          },
  }

  return [
    summaryPrompt,
    "",
    "Evidence JSON:",
    JSON.stringify(evidence, null, 2),
  ].join("\n")
}

async function readSummaryPrompt() {
  if (existsSync(SUMMARY_PROMPT_PATH)) {
    return Bun.file(SUMMARY_PROMPT_PATH).text()
  }

  return [
    "You are summarizing a local Smithers workflow run for a developer.",
    "The developer wants excellent insight, not generic status repetition.",
    "Use only the evidence below.",
    "Explain what the workflow is actually doing now, what changed since the previous summary, whether progress looks real or suspicious, and what likely happens next.",
    "Prefer concrete references to node outputs, tool activity, retries, repo diffs, and changed files when evidence exists.",
    "If the run looks stuck or low-signal, say so plainly.",
    "Do not use tools.",
    "",
    "Output format:",
    "## Snapshot",
    "One short paragraph.",
    "## New Since Last Summary",
    "Use flat bullets only.",
    "## Risks / Attention",
    "Use flat bullets only.",
    "## Next Likely Move",
    "One short paragraph.",
  ].join("\n")
}

function buildDeterministicSummary(
  observation: Observation,
  previous: PreviousObservation | null,
) {
  const lines: string[] = []

  const activeSteps = observation.stepStates.filter((step) => FOCUS_STATES.has(step.state))
  const activeStepText =
    activeSteps.length > 0
      ? activeSteps.map((step) => `${step.id}=${step.state}`).join(", ")
      : "no active focus steps"

  lines.push(
    `${observation.run.workflow} run ${observation.run.id} is ${observation.run.status}; ${activeStepText}.`,
  )

  if (observation.stepChanges.length > 0) {
    lines.push("")
    lines.push("Step changes:")
    for (const change of observation.stepChanges) {
      lines.push(`- ${change}`)
    }
  }

  if (observation.focusNodes.length > 0) {
    lines.push("")
    lines.push("Focus nodes:")
    for (const node of observation.focusNodes) {
      const latestAttempt = node.latestAttempt
      const bits = [
        `state=${node.state}`,
        latestAttempt ? `attempt=${latestAttempt.attempt}` : null,
        latestAttempt?.liveDurationMs != null
          ? `duration=${formatDuration(latestAttempt.liveDurationMs)}`
          : null,
        latestAttempt?.error ? `error=${latestAttempt.error}` : null,
      ].filter(Boolean)
      lines.push(`- ${node.nodeId}: ${bits.join(", ")}`)
      if (latestAttempt?.responseText) {
        lines.push(`- ${node.nodeId} latest response: ${truncateText(latestAttempt.responseText, 220)}`)
      }
    }
  }

  if (observation.repoContexts.length > 0) {
    lines.push("")
    lines.push("Repo context:")
    for (const repo of observation.repoContexts) {
      const branch = repo.branch ?? "unknown-branch"
      const changedFiles =
        repo.changedFiles.length > 0
          ? repo.changedFiles.slice(0, 8).join(", ")
          : "no changed files"
      lines.push(`- ${repo.path}: ${branch}; ${changedFiles}`)
    }
  }

  if (observation.newEventLines.length > 0) {
    lines.push("")
    lines.push("Recent events:")
    for (const eventLine of observation.newEventLines.slice(-8)) {
      lines.push(`- ${eventLine}`)
    }
  } else if (previous) {
    lines.push("")
    lines.push("Recent events:")
    lines.push(
      `- no new persisted events since ${previous.collectedAtIso}; last event age ${formatDuration(observation.run.lastEventAgeMs)}`,
    )
  }

  if (observation.whyText) {
    lines.push("")
    lines.push("Block diagnosis:")
    lines.push(observation.whyText)
  }

  return lines.join("\n")
}

function printSummary(
  observation: Observation,
  summary: string,
  deterministic: boolean,
) {
  console.log("")
  console.log(
    `=== smithers-observer ${observation.collectedAtIso} run=${observation.run.id} status=${observation.run.status}${deterministic ? " mode=deterministic" : ""} ===`,
  )
  console.log(summary)
}

function isTerminalStatus(status: string) {
  return status === "finished" || status === "failed" || status === "cancelled"
}

function openReadonlyDb(dbPath: string) {
  return new Database(dbPath, {
    readonly: true,
    create: false,
  })
}

async function runSmithersJson<T>(
  options: ObserveRunOptions,
  args: string[],
): Promise<T> {
  const result = await runCommand(options.smithersBin, ["--format", "json", ...args], {
    cwd: options.smithersCwd,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Smithers command failed: ${args.join(" ")}`)
  }

  return parseJson<T>(result.stdout)
}

async function runSmithersText(options: ObserveRunOptions, args: string[]) {
  const result = await runCommand(options.smithersBin, args, {
    cwd: options.smithersCwd,
  })

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `Smithers command failed: ${args.join(" ")}`)
  }

  return clipTailLines(result.stdout, 120)
}

async function runCommand(
  command: string,
  args: string[],
  input?: {
    cwd?: string
    input?: string
  },
): Promise<CommandResult> {
  const proc = Bun.spawn([command, ...args], {
    cwd: input?.cwd,
    stdin:
      typeof input?.input === "string"
        ? new TextEncoder().encode(input.input)
        : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ])

  return {
    stdout: stripAnsi(stdout),
    stderr: stripAnsi(stderr),
    exitCode,
  }
}

function parseJson<T>(raw: string): T {
  const trimmed = normalizeMultiline(raw)
  return JSON.parse(trimmed) as T
}

function parsePayload(raw: string | null | undefined) {
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function formatEventLine(event: EventRow, baseMs: number) {
  const payload = parsePayload(event.payloadJson) as any
  const prefix = `[${formatRelativeOffset(baseMs, event.timestampMs)}]`

  switch (event.type) {
    case "RunStatusChanged":
      return `${prefix} run status -> ${payload?.status ?? "unknown"}`
    case "RunFinished":
      return `${prefix} run finished`
    case "RunFailed":
      return `${prefix} run failed: ${truncateText(String(payload?.error ?? "unknown"), 180)}`
    case "NodeStarted":
      return `${prefix} ${payload?.nodeId ?? "node"} started (attempt ${payload?.attempt ?? 1})`
    case "NodeFinished":
      return `${prefix} ${payload?.nodeId ?? "node"} finished (attempt ${payload?.attempt ?? 1})`
    case "NodeFailed":
      return `${prefix} ${payload?.nodeId ?? "node"} failed (attempt ${payload?.attempt ?? 1}): ${truncateText(String(payload?.error ?? "unknown"), 180)}`
    case "NodeRetrying":
      return `${prefix} ${payload?.nodeId ?? "node"} retrying (attempt ${payload?.attempt ?? 1})`
    case "NodeWaitingApproval":
      return `${prefix} ${payload?.nodeId ?? "node"} waiting for approval`
    case "ToolCallStarted":
      return `${prefix} ${payload?.nodeId ?? "node"} -> tool ${payload?.toolName ?? "tool"}`
    case "ToolCallFinished":
      return `${prefix} ${payload?.nodeId ?? "node"} <- tool ${payload?.toolName ?? "tool"} (${payload?.status ?? "done"})`
    case "TaskHeartbeat":
      return `${prefix} ${payload?.nodeId ?? "node"} heartbeat (${payload?.dataSizeBytes ?? 0} bytes)`
    case "TokenUsageReported":
      return `${prefix} ${payload?.nodeId ?? "node"} tokens in=${payload?.inputTokens ?? 0} out=${payload?.outputTokens ?? 0}`
    case "NodeOutput":
      return `${prefix} ${payload?.nodeId ?? "node"} ${payload?.stream ?? "stdout"}: ${truncateText(String(payload?.text ?? ""), 180)}`
    case "AgentEvent":
      return `${prefix} ${payload?.nodeId ?? "node"} agent: ${summarizeAgentEvent(payload?.event)}`
    case "FrameCommitted":
      return `${prefix} frame ${payload?.frameNo ?? "?"} committed`
    case "SnapshotCaptured":
      return `${prefix} snapshot ${payload?.frameNo ?? "?"} captured`
    default:
      return `${prefix} ${event.type} ${truncateText(stringifyValue(payload), 160)}`
  }
}

function summarizeAgentEvent(event: any) {
  if (!event || typeof event !== "object") {
    return "unknown event"
  }

  const type = typeof event.type === "string" ? event.type : "unknown"

  if (type === "action") {
    const phase = typeof event.phase === "string" ? event.phase : "phase"
    const kind = typeof event.action?.kind === "string" ? event.action.kind : "action"
    const title =
      typeof event.action?.title === "string"
        ? truncateText(event.action.title, 100)
        : kind
    return `${phase} ${kind}: ${title}`
  }

  if (type === "started") {
    if (typeof event.message === "string" && event.message.length > 0) {
      return truncateText(event.message, 120)
    }
    return "started"
  }

  if (type === "turn") {
    const turnNo = toNumber(event.turnNumber) ?? toNumber(event.turn)
    return turnNo == null ? "turn" : `turn ${turnNo}`
  }

  if (type === "completed") {
    return event.ok === false ? "completed with error" : "completed"
  }

  if (type === "error") {
    return truncateText(String(event.error ?? "error"), 120)
  }

  if (type === "message") {
    return truncateText(String(event.message ?? "message"), 120)
  }

  return type
}

function compactStructuredValue(value: unknown, maxChars: number) {
  if (value == null) {
    return null
  }
  return truncateText(stringifyValue(value), maxChars)
}

function stringifyValue(value: unknown) {
  if (typeof value === "string") {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseErrorSummary(raw: string | null) {
  if (!raw) {
    return null
  }
  const parsed = parsePayload(raw)
  if (typeof parsed === "string") {
    return parsed
  }
  if (parsed && typeof parsed === "object") {
    if (typeof (parsed as any).message === "string") {
      return (parsed as any).message
    }
    if (typeof (parsed as any).error === "string") {
      return (parsed as any).error
    }
  }
  return truncateText(stringifyValue(parsed), 240)
}

function computeElapsedMs(startedAtMs: number | null, finishedAtMs: number | null) {
  if (typeof startedAtMs !== "number") {
    return null
  }
  return (finishedAtMs ?? Date.now()) - startedAtMs
}

function normalizeDurationMs(startedAtMs: unknown, finishedAtMs: unknown) {
  const started = toNumber(startedAtMs)
  const finished = toNumber(finishedAtMs)
  if (started == null || finished == null) {
    return null
  }
  const duration = finished - started
  return duration >= 0 ? duration : null
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function formatRelativeOffset(baseMs: number, eventMs: number) {
  const elapsed = Math.max(0, eventMs - baseMs)
  const totalSeconds = Math.floor(elapsed / 1_000)
  const millis = elapsed % 1_000
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const pad2 = (value: number) => String(value).padStart(2, "0")
  const pad3 = (value: number) => String(value).padStart(3, "0")

  if (hours > 0) {
    return `+${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`
  }

  return `+${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`
}

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxChars - 3))}...`
}

function clipTailLines(value: string, maxLines: number) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  return lines.slice(-maxLines).join("\n")
}

function stripAnsi(value: string) {
  return value.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "")
}

function normalizeMultiline(value: string) {
  return value.trim()
}

function formatIso(timestampMs: number | null) {
  return typeof timestampMs === "number" ? new Date(timestampMs).toISOString() : null
}

function formatDuration(durationMs: number | null) {
  if (durationMs == null || !Number.isFinite(durationMs)) {
    return "unknown"
  }

  const seconds = Math.floor(durationMs / 1_000)
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`
  }

  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function fingerprintRepoContext(context: RepoContext) {
  return JSON.stringify({
    branch: context.branch,
    head: context.head,
    statusShort: context.statusShort,
    workingTreeDiffStat: context.workingTreeDiffStat,
    stagedDiffStat: context.stagedDiffStat,
  })
}

async function getLatestEventSeq(dbPath: string, runId: string) {
  const db = openReadonlyDb(dbPath)
  try {
    const row = db
      .query(
        `SELECT COALESCE(MAX(seq), -1) AS seq
         FROM _smithers_events
         WHERE run_id = ?`,
      )
      .get(runId) as { seq?: number } | null
    return typeof row?.seq === "number" ? row.seq : -1
  } finally {
    db.close()
  }
}

function sleep(ms: number) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
