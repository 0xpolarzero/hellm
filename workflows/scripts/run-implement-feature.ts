#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseObserveRunArgs,
  printObserveRunHelp,
  runObserver,
  type ObserveRunOptions,
} from "./observe-run";

type RunImplementFeatureOptions = {
  specPath: string;
  pocPath: string;
  slug?: string;
  worktreeRoot?: string;
  branchPrefix?: string;
  baseBranch?: string;
  maxIterations?: number;
  onMaxReached?: "return-last" | "fail";
  explicitRunId?: string;
  observer: ObserveRunOptions;
};

const IMPLEMENT_FEATURE_WORKFLOW = "definitions/implement-feature.tsx";

async function main() {
  const options = parseRunImplementFeatureArgs(process.argv.slice(2));
  const runId = await startWorkflow(options);
  await waitForPath(options.observer.dbPath, 15_000);

  console.log(`started workflow ${IMPLEMENT_FEATURE_WORKFLOW} as run ${runId}`);
  await runObserver({
    ...options.observer,
    runId,
  });
}

function parseRunImplementFeatureArgs(argv: string[]): RunImplementFeatureOptions {
  const observer = parseObserveRunArgs([]);
  let specPath: string | undefined;
  let pocPath: string | undefined;
  let slug: string | undefined;
  let worktreeRoot: string | undefined;
  let branchPrefix: string | undefined;
  let baseBranch: string | undefined;
  let maxIterations: number | undefined;
  let onMaxReached: "return-last" | "fail" | undefined;
  let explicitRunId: string | undefined;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;

    switch (arg) {
      case "--help":
      case "-h":
        printRunImplementFeatureHelp();
        process.exit(0);
      case "--spec":
        specPath = readRequiredValue(argv, ++index, arg);
        break;
      case "--poc":
        pocPath = readRequiredValue(argv, ++index, arg);
        break;
      case "--slug":
        slug = readRequiredValue(argv, ++index, arg);
        break;
      case "--worktree-root":
        worktreeRoot = readRequiredValue(argv, ++index, arg);
        break;
      case "--branch-prefix":
        branchPrefix = readRequiredValue(argv, ++index, arg);
        break;
      case "--base-branch":
        baseBranch = readRequiredValue(argv, ++index, arg);
        break;
      case "--max-iterations":
        maxIterations = parsePositiveInt(readRequiredValue(argv, ++index, arg), arg);
        break;
      case "--on-max-reached": {
        const value = readRequiredValue(argv, ++index, arg);
        if (value !== "return-last" && value !== "fail") {
          throw new Error(`Invalid value for ${arg}: ${value}`);
        }
        onMaxReached = value;
        break;
      }
      case "--run-id":
        explicitRunId = readRequiredValue(argv, ++index, arg);
        break;
      case "--interval":
        observer.intervalMs = parseDurationMs(readRequiredValue(argv, ++index, arg));
        break;
      case "--once":
        observer.once = true;
        break;
      case "--model":
        observer.model = readRequiredValue(argv, ++index, arg);
        break;
      case "--reasoning-effort":
        observer.reasoningEffort = readRequiredValue(argv, ++index, arg);
        break;
      case "--repo-root":
        observer.repoRoot = resolve(readRequiredValue(argv, ++index, arg));
        break;
      case "--smithers-cwd":
        observer.smithersCwd = resolve(readRequiredValue(argv, ++index, arg));
        break;
      case "--smithers-bin":
        observer.smithersBin = resolve(readRequiredValue(argv, ++index, arg));
        break;
      case "--db-path":
        observer.dbPath = resolve(readRequiredValue(argv, ++index, arg));
        break;
      case "--focus-nodes":
        observer.focusNodes = parsePositiveInt(readRequiredValue(argv, ++index, arg), arg);
        break;
      case "--event-tail":
        observer.eventTail = parsePositiveInt(readRequiredValue(argv, ++index, arg), arg);
        break;
      case "--worktree-path":
        observer.worktreePath = resolve(readRequiredValue(argv, ++index, arg));
        break;
      case "--no-codex":
        observer.noCodex = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!specPath) {
    throw new Error("Missing --spec <path>");
  }

  if (!pocPath) {
    throw new Error("Missing --poc <path>");
  }

  return {
    specPath,
    pocPath,
    slug,
    worktreeRoot,
    branchPrefix,
    baseBranch,
    maxIterations,
    onMaxReached,
    explicitRunId,
    observer,
  };
}

function printRunImplementFeatureHelp() {
  console.log(`
Run the implement-feature workflow with normal flags, then observe it with periodic summaries.

Usage:
  bun run workflow:implement-feature -- --spec <path> --poc <path> [options]
  ./workflows/scripts/run-implement-feature.ts --spec <path> --poc <path> [options]
  bun workflows/scripts/run-implement-feature.ts --spec <path> --poc <path> [options]

Examples:
  bun run workflow:implement-feature -- --spec docs/specs/foo.spec.md --poc docs/pocs/foo.poc.ts
  ./workflows/scripts/run-implement-feature.ts --spec docs/specs/foo.spec.md --poc docs/pocs/foo.poc.ts
  ./workflows/scripts/run-implement-feature.ts --spec docs/specs/foo.spec.md --poc docs/pocs/foo.poc.ts --slug foo --interval 5m

Workflow input options:
  --spec <path>            Required spec path, usually under docs/specs/
  --poc <path>             Required POC path, usually under docs/pocs/
  --slug <value>           Optional workflow slug
  --worktree-root <path>   Worktree root for the workflow input
  --branch-prefix <value>  Branch prefix for the workflow input
  --base-branch <value>    Base branch for the workflow input
  --max-iterations <n>     Maximum review/address loop iterations
  --on-max-reached <mode>  One of return-last or fail

Observer options:
  --run-id <id>            Explicit Smithers run id
  --interval <duration>    Summary cadence, e.g. 5s, 5m, 1h
  --once                   Emit one summary and exit
  --model <id>             Codex summary model (default: gpt-5.4)
  --reasoning-effort <id>  Codex summary reasoning effort (default: high)
  --repo-root <path>       Repo root passed to Smithers --root
  --smithers-cwd <path>    Smithers working directory
  --smithers-bin <path>    Smithers binary path
  --db-path <path>         Smithers database path
  --focus-nodes <n>        Number of nodes to inspect deeply
  --event-tail <n>         Number of recent events to retain
  --worktree-path <path>   Force git/worktree context
  --no-codex               Skip narrative synthesis and print deterministic summaries

More observer details:
`);
  printObserveRunHelp();
}

async function startWorkflow(options: RunImplementFeatureOptions) {
  if (!existsSync(options.observer.smithersBin)) {
    throw new Error(`Smithers binary not found at ${options.observer.smithersBin}`);
  }

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

  const args = [
    options.observer.smithersBin,
    "up",
    IMPLEMENT_FEATURE_WORKFLOW,
    "--detach",
    "true",
    "--root",
    options.observer.repoRoot,
    "--input",
    JSON.stringify(input),
  ];

  if (options.explicitRunId) {
    args.push("--run-id", options.explicitRunId);
  }

  const result = await runCommand(args, options.observer.smithersCwd);
  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr || result.stdout || "Failed to start implement-feature workflow.",
    );
  }

  const runId = extractRunId(result.stdout);
  if (!runId) {
    throw new Error(`Could not parse run id from Smithers output:\n${result.stdout}`);
  }

  return runId;
}

function parseDurationMs(raw: string) {
  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10) * 60_000;
  }

  const match = raw.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid duration "${raw}". Use values like 5s, 5m, or 1h.`);
  }

  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;

  switch (unit) {
    case "ms":
      return value;
    case "s":
      return value * 1_000;
    case "m":
      return value * 60_000;
    case "h":
      return value * 60 * 60_000;
    default:
      throw new Error(`Unsupported duration unit: ${unit}`);
  }
}

function parsePositiveInt(raw: string, flag: string) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Expected a positive integer for ${flag}, got "${raw}"`);
  }
  return value;
}

function readRequiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index];
  if (!value) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

async function runCommand(command: string[], cwd: string) {
  const proc = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
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

function extractRunId(output: string) {
  const textMatch = output.match(/runId:\s*([^\s]+)/);
  if (textMatch?.[1]) {
    return textMatch[1];
  }

  const jsonMatch = output.match(/"runId"\s*:\s*"([^"]+)"/);
  if (jsonMatch?.[1]) {
    return jsonMatch[1];
  }

  return null;
}

function stripAnsi(value: string) {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}

const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[A-Za-z]`, "g");

async function waitForPath(path: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Timed out waiting for ${path} to appear.`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
