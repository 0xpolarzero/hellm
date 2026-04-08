/** @jsxImportSource smithers-orchestrator */

import {
  ClaudeCodeAgent,
  CodexAgent,
  MergeQueue,
  Parallel,
  PiAgent,
  Sequence,
  Task,
  Workflow,
  Worktree,
  createSmithers,
} from "smithers-orchestrator";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";
import { ALL_HELLM_FEATURES } from "../docs/features.ts";
import WorkerPrompt from "./prompts/feature-test-fanout/worker.mdx";

const DEFAULT_MAX_CONCURRENCY = parsePositiveInt(
  process.env.HELLM_FEATURE_TEST_MAX_CONCURRENCY,
  6,
);
const DEFAULT_BATCH_SIZE = parsePositiveInt(
  process.env.HELLM_FEATURE_TEST_BATCH_SIZE,
  DEFAULT_MAX_CONCURRENCY,
);
const DEFAULT_TIMEOUT_MS = parsePositiveInt(
  process.env.HELLM_FEATURE_TEST_TIMEOUT_MS,
  30 * 60 * 1000,
);

const inputSchema = z.object({
  features: z.array(z.string()).optional(),
  maxConcurrency: z.number().int().positive().default(DEFAULT_MAX_CONCURRENCY),
  batchSize: z.number().int().positive().default(DEFAULT_BATCH_SIZE),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
  repoRoot: z.string().default("."),
  worktreeRoot: z.string().default(".worktrees/feature-tests"),
  branchPrefix: z.string().default("workflow/feature-tests"),
  baseBranch: z.string().default(
    process.env.HELLM_FEATURE_TEST_BASE_BRANCH ?? "main",
  ),
  deleteMergedBranches: z.boolean().default(true),
  cleanupBlockedWorktrees: z.boolean().default(false),
});

const featureCoverageSchema = z.object({
  featureId: z.string(),
  status: z.enum(["executable", "pending", "deferred", "blocked"]),
  summary: z.string(),
  testFiles: z.array(z.string()),
  supportFiles: z.array(z.string()),
  docsFiles: z.array(z.string()),
  verificationCommands: z.array(z.string()),
  committed: z.boolean(),
  commitSha: z.string().nullable(),
  branch: z.string(),
  worktreePath: z.string(),
  pendingReason: z.string().nullable(),
});

const verificationResultSchema = z.object({
  featureId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  status: z.enum(["passed", "failed", "skipped", "blocked"]),
  executedCommands: z.array(z.string()),
  failedCommands: z.array(z.string()),
  summaries: z.array(z.string()),
  shouldMerge: z.boolean(),
});

const commitResultSchema = z.object({
  featureId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  status: z.enum(["committed", "skipped", "blocked"]),
  summary: z.string(),
  commitSha: z.string().optional(),
});

const mergeResultSchema = z.object({
  featureId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  status: z.enum(["merged", "skipped", "blocked", "conflicted"]),
  summary: z.string(),
  mergeCommitSha: z.string().optional(),
});

const cleanupResultSchema = z.object({
  featureId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  status: z.enum(["cleaned", "retained", "blocked"]),
  removedWorktree: z.boolean(),
  deletedBranch: z.boolean(),
  summary: z.string(),
});

const reportSchema = z.object({
  totalRequested: z.number().int().nonnegative(),
  workerReported: z.number().int().nonnegative(),
  verified: z.number().int().nonnegative(),
  merged: z.number().int().nonnegative(),
  cleaned: z.number().int().nonnegative(),
  executable: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  deferred: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
  missingFeatureIds: z.array(z.string()),
  retainedFeatureIds: z.array(z.string()),
  summary: z.string(),
});

const { smithers, outputs } = createSmithers({
  featureCoverage: featureCoverageSchema,
  verificationResult: verificationResultSchema,
  commitResult: commitResultSchema,
  mergeResult: mergeResultSchema,
  cleanupResult: cleanupResultSchema,
  report: reportSchema,
});

const workerAgentKind = (process.env.HELLM_FEATURE_TEST_AGENT ?? "codex").toLowerCase();
const workerRetries = workerAgentKind === "codex" ? 0 : 1;
type FeatureCoverageResult = z.infer<typeof featureCoverageSchema>;
type VerificationResult = z.infer<typeof verificationResultSchema>;
type CommitResult = z.infer<typeof commitResultSchema>;
type MergeResult = z.infer<typeof mergeResultSchema>;
type CleanupResult = z.infer<typeof cleanupResultSchema>;

export default smithers((ctx) => {
  const input = inputSchema.parse(ctx.input ?? {});
  const selectedFeatures = selectFeatures(input.features);
  const batches = chunkFeatures(selectedFeatures, input.batchSize);
  const featureResults = dedupeResults(ctx.outputs.featureCoverage ?? []);
  const verificationResults = dedupeResults(ctx.outputs.verificationResult ?? []);
  const commitResults = dedupeResults(ctx.outputs.commitResult ?? []);
  const mergeResults = dedupeResults(ctx.outputs.mergeResult ?? []);
  const cleanupResults = dedupeResults(ctx.outputs.cleanupResult ?? []);
  const featureById = byFeatureId(featureResults);
  const verificationById = byFeatureId(verificationResults);
  const commitById = byFeatureId(commitResults);
  const mergeById = byFeatureId(mergeResults);

  return (
    <Workflow name="hellm-feature-test-fanout">
      <Sequence>
        {batches.map((batch, batchIndex) => (
          <Sequence key={`batch-${batchIndex}`}>
            <Parallel maxConcurrency={input.maxConcurrency}>
              {batch.map((featureId) => {
                const taskSpec = createTaskSpec(featureId, input);
                const workerAgent = createWorkerAgent(taskSpec);

                return (
                  <Worktree
                    key={taskSpec.taskId}
                    path={taskSpec.worktreePath}
                    branch={taskSpec.branch}
                    baseBranch={input.baseBranch}
                  >
                    <Task
                      id={taskSpec.taskId}
                      output={outputs.featureCoverage}
                      agent={workerAgent}
                      retries={workerRetries}
                      continueOnFail
                      timeoutMs={input.timeoutMs}
                    >
                      <WorkerPrompt
                        featureId={taskSpec.featureId}
                        branch={taskSpec.branch}
                        worktreePath={taskSpec.worktreePath}
                      />
                    </Task>
                  </Worktree>
                );
              })}
            </Parallel>

            <Parallel maxConcurrency={input.maxConcurrency}>
              {batch.map((featureId) => {
                const taskSpec = createTaskSpec(featureId, input);
                const featureResult = featureById.get(featureId);
                if (!featureResult) {
                  return null;
                }

                return (
                  <Task
                    key={`verify-${taskSpec.slug}`}
                    id={`verify-${taskSpec.slug}`}
                    output={outputs.verificationResult}
                    continueOnFail
                  >
                    {async () => verifyFeature(taskSpec, featureResult)}
                  </Task>
                );
              })}
            </Parallel>

            <Parallel maxConcurrency={input.maxConcurrency}>
              {batch.map((featureId) => {
                const taskSpec = createTaskSpec(featureId, input);
                const featureResult = featureById.get(featureId);
                const verificationResult = verificationById.get(featureId);
                if (!featureResult || !verificationResult) {
                  return null;
                }

                return (
                  <Task
                    key={`commit-${taskSpec.slug}`}
                    id={`commit-${taskSpec.slug}`}
                    output={outputs.commitResult}
                    continueOnFail
                  >
                    {async () =>
                      commitFeature({
                        task: taskSpec,
                        feature: featureResult,
                        verification: verificationResult,
                      })}
                  </Task>
                );
              })}
            </Parallel>

            <MergeQueue>
              {batch.map((featureId) => {
                const taskSpec = createTaskSpec(featureId, input);
                const commitResult = commitById.get(featureId);
                if (!commitResult) {
                  return null;
                }

                return (
                  <Task
                    key={`merge-${taskSpec.slug}`}
                    id={`merge-${taskSpec.slug}`}
                    output={outputs.mergeResult}
                    continueOnFail
                  >
                    {async () =>
                      mergeFeature({
                        repoRoot: input.repoRoot,
                        task: taskSpec,
                        commit: commitResult,
                      })}
                  </Task>
                );
              })}
            </MergeQueue>

            <Parallel maxConcurrency={input.maxConcurrency}>
              {batch.map((featureId) => {
                const taskSpec = createTaskSpec(featureId, input);
                const mergeResult = mergeById.get(featureId);
                if (!mergeResult) {
                  return null;
                }

                return (
                  <Task
                    key={`cleanup-${taskSpec.slug}`}
                    id={`cleanup-${taskSpec.slug}`}
                    output={outputs.cleanupResult}
                    continueOnFail
                  >
                    {async () =>
                      cleanupFeature({
                        repoRoot: input.repoRoot,
                        task: taskSpec,
                        merge: mergeResult,
                        deleteMergedBranches: input.deleteMergedBranches,
                        cleanupBlockedWorktrees: input.cleanupBlockedWorktrees,
                      })}
                  </Task>
                );
              })}
            </Parallel>
          </Sequence>
        ))}

        <Task id="feature-test-report" output={outputs.report}>
          {buildReport({
            selectedFeatures,
            featureResults,
            verificationResults,
            mergeResults,
            cleanupResults,
          })}
        </Task>
      </Sequence>
    </Workflow>
  );
});

function createWorkerAgent(taskSpec?: { slug: string }) {
  const agentKind = workerAgentKind;

  switch (agentKind) {
    case "pi":
      return new PiAgent({
        provider: process.env.HELLM_FEATURE_TEST_PI_PROVIDER ?? "openai-codex",
        model: process.env.HELLM_FEATURE_TEST_PI_MODEL ?? "gpt-5.4",
        mode: "rpc",
        tools: ["read", "edit", "bash"],
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    case "claude":
      return new ClaudeCodeAgent({
        model:
          process.env.HELLM_FEATURE_TEST_CLAUDE_MODEL ?? "claude-sonnet-4-20250514",
        timeoutMs: DEFAULT_TIMEOUT_MS,
      });
    default:
      {
        const codexEnv = createIsolatedCodexWorkerEnv(taskSpec?.slug ?? "shared");
      return new CodexAgent({
        model: process.env.HELLM_FEATURE_TEST_CODEX_MODEL ?? "gpt-5.3-codex",
        sandbox:
          (process.env.HELLM_FEATURE_TEST_SANDBOX as
            | "read-only"
            | "workspace-write"
            | "danger-full-access"
            | undefined) ?? "workspace-write",
        fullAuto: process.env.HELLM_FEATURE_TEST_FULL_AUTO !== "0",
        timeoutMs: DEFAULT_TIMEOUT_MS,
        env: codexEnv,
        extraArgs: ["--ephemeral"],
        config: {
          model_reasoning_effort:
            process.env.HELLM_FEATURE_TEST_REASONING_EFFORT ?? "high",
          "features.multi_agent": false,
          "agents.max_threads": 1,
        },
      });
    }
  }
}

function createIsolatedCodexWorkerEnv(taskSlug: string): Record<string, string> {
  const configuredHome = process.env.HELLM_FEATURE_TEST_CODEX_HOME?.trim();
  const codexHomeRoot =
    configuredHome && configuredHome.length > 0
      ? resolve(configuredHome)
      : tmpdir();
  mkdirSync(codexHomeRoot, { recursive: true });
  const codexHome = mkdtempSync(
    resolve(codexHomeRoot, `hellm-codex-home-${taskSlug}-`),
  );

  mkdirSync(codexHome, { recursive: true });

  const sourceCodexHome =
    process.env.CODEX_HOME?.trim() || resolve(process.env.HOME ?? homedir(), ".codex");
  for (const filename of ["auth.json", "config.toml"]) {
    const source = resolve(sourceCodexHome, filename);
    const target = resolve(codexHome, filename);
    if (existsSync(source) && !existsSync(target)) {
      copyFileSync(source, target);
    }
  }

  return {
    CODEX_HOME: codexHome,
  };
}

function selectFeatures(requested?: string[]): string[] {
  if (!requested || requested.length === 0) {
    return [...ALL_HELLM_FEATURES];
  }

  const known = new Set(ALL_HELLM_FEATURES);
  const deduped = [...new Set(requested)];
  const unknown = deduped.filter((feature) => !known.has(feature));

  if (unknown.length > 0) {
    throw new Error(
      `Unknown feature ids requested: ${unknown.join(", ")}.`,
    );
  }

  return deduped;
}

function featureSlug(featureId: string): string {
  return featureId
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function createTaskSpec(
  featureId: string,
  input: z.infer<typeof inputSchema>,
) {
  const slug = featureSlug(featureId);
  const repoRoot = resolve(input.repoRoot);
  return {
    featureId,
    slug,
    taskId: `feature-${slug}`,
    branch: `${input.branchPrefix}/${slug}`,
    worktreePath: resolve(repoRoot, input.worktreeRoot, slug),
  };
}

function dedupeResults<T extends { featureId: string }>(results: T[]): T[] {
  const byFeature = new Map<string, T>();

  for (const result of results) {
    byFeature.set(result.featureId, result);
  }

  return [...byFeature.values()];
}

function byFeatureId<T extends { featureId: string }>(results: T[]): Map<string, T> {
  return new Map(results.map((result) => [result.featureId, result]));
}

function chunkFeatures(features: string[], batchSize: number): string[][] {
  const chunks: string[][] = [];

  for (let index = 0; index < features.length; index += batchSize) {
    chunks.push(features.slice(index, index + batchSize));
  }

  return chunks;
}

async function verifyFeature(
  task: ReturnType<typeof createTaskSpec>,
  feature: FeatureCoverageResult,
): Promise<VerificationResult> {
  const worktreePath = task.worktreePath;
  const worktreeState = inspectWorktree(worktreePath);
  if (!worktreeState.ok) {
    return {
      featureId: feature.featureId,
      branch: task.branch,
      worktreePath,
      status: "blocked",
      executedCommands: [],
      failedCommands: [],
      summaries: [worktreeState.error],
      shouldMerge: false,
    };
  }

  if (feature.verificationCommands.length === 0) {
    return {
      featureId: feature.featureId,
      branch: task.branch,
      worktreePath,
      status: worktreeState.dirty || feature.committed ? "blocked" : "skipped",
      executedCommands: [],
      failedCommands: [],
      summaries:
        worktreeState.dirty || feature.committed
          ? ["Repo changes exist but no verification commands were provided."]
          : ["No repo changes and no verification commands were provided."],
      shouldMerge: false,
    };
  }

  const executedCommands: string[] = [];
  const failedCommands: string[] = [];
  const summaries: string[] = [];

  for (const command of feature.verificationCommands) {
    const result = runShellCommand(worktreePath, command);
    executedCommands.push(command);
    if (result.code !== 0) {
      failedCommands.push(command);
      summaries.push(
        `${command}: failed (${truncateOutput(commandFailureOutput(result))})`,
      );
      return {
        featureId: feature.featureId,
        branch: task.branch,
        worktreePath,
        status: "failed",
        executedCommands,
        failedCommands,
        summaries,
        shouldMerge: false,
      };
    }

    summaries.push(`${command}: passed`);
  }

  return {
    featureId: feature.featureId,
    branch: task.branch,
    worktreePath,
    status: executedCommands.length > 0 ? "passed" : "skipped",
    executedCommands,
    failedCommands,
    summaries:
      summaries.length > 0
        ? summaries
        : ["No verification commands were required."],
    shouldMerge: worktreeState.dirty || feature.committed,
  };
}

async function commitFeature(input: {
  task: ReturnType<typeof createTaskSpec>;
  feature: FeatureCoverageResult;
  verification: VerificationResult;
}): Promise<CommitResult> {
  const worktreePath = input.task.worktreePath;

  if (!input.verification.shouldMerge) {
    return {
      featureId: input.feature.featureId,
      branch: input.task.branch,
      worktreePath,
      status: input.verification.status === "blocked" ? "blocked" : "skipped",
      summary:
        input.verification.status === "blocked"
          ? "Verification blocked commit creation."
          : "Verification did not authorize a commit.",
    };
  }

  const worktreeState = inspectWorktree(worktreePath);
  if (!worktreeState.ok) {
    return {
      featureId: input.feature.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "blocked",
      summary: worktreeState.error,
    };
  }

  if (input.feature.committed) {
    if (worktreeState.dirty) {
      return {
        featureId: input.feature.featureId,
        branch: input.task.branch,
        worktreePath,
        status: "blocked",
        summary: "Worker reported a commit, but the feature worktree is still dirty.",
      };
    }

    const head = runGit(worktreePath, ["rev-parse", "HEAD"]);
    return {
      featureId: input.feature.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "committed",
      summary: "Worker already committed the feature branch.",
      ...(head.code === 0
        ? { commitSha: input.feature.commitSha ?? stdoutText(head).trim() }
        : input.feature.commitSha
          ? { commitSha: input.feature.commitSha }
          : {}),
    };
  }

  if (!worktreeState.dirty) {
    return {
      featureId: input.feature.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "skipped",
      summary: "Feature worktree is clean; no commit was created.",
    };
  }

  const addAll = runGit(worktreePath, ["add", "-A"]);
  if (addAll.code !== 0) {
    return {
      featureId: input.feature.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "blocked",
      summary: `Failed to stage feature changes: ${truncateOutput(commandFailureOutput(addAll))}`,
    };
  }

  const commit = runGit(worktreePath, [
    "commit",
    "-m",
    `test(feature-fanout): cover ${input.task.slug}`,
  ]);
  if (commit.code !== 0) {
    return {
      featureId: input.feature.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "blocked",
      summary: `Failed to commit feature changes: ${truncateOutput(commandFailureOutput(commit))}`,
    };
  }

  const head = runGit(worktreePath, ["rev-parse", "HEAD"]);
  return {
    featureId: input.feature.featureId,
    branch: input.task.branch,
    worktreePath,
    status: "committed",
    summary: "Committed verified feature changes on the feature branch.",
    ...(head.code === 0 ? { commitSha: stdoutText(head).trim() } : {}),
  };
}

async function mergeFeature(input: {
  repoRoot: string;
  task: ReturnType<typeof createTaskSpec>;
  commit: CommitResult;
}): Promise<MergeResult> {
  const repoRoot = resolve(input.repoRoot);

  if (input.commit.status !== "committed") {
    return {
      featureId: input.commit.featureId,
      branch: input.task.branch,
      worktreePath: input.task.worktreePath,
      status: input.commit.status === "blocked" ? "blocked" : "skipped",
      summary:
        input.commit.status === "blocked"
          ? input.commit.summary
          : "No committed changes to merge.",
    };
  }

  const cleanliness = runGit(repoRoot, ["status", "--porcelain"]);
  if (cleanliness.code !== 0) {
    return {
      featureId: input.commit.featureId,
      branch: input.task.branch,
      worktreePath: input.task.worktreePath,
      status: "blocked",
      summary: `Unable to inspect root worktree state: ${truncateOutput(commandFailureOutput(cleanliness))}`,
    };
  }
  if (stdoutText(cleanliness).trim().length > 0) {
    return {
      featureId: input.commit.featureId,
      branch: input.task.branch,
      worktreePath: input.task.worktreePath,
      status: "blocked",
      summary: "Root repository is dirty; merge was skipped.",
    };
  }

  const merge = runGit(repoRoot, ["merge", "--no-ff", "--no-edit", input.task.branch]);
  if (merge.code !== 0) {
    runGit(repoRoot, ["merge", "--abort"]);
    return {
      featureId: input.commit.featureId,
      branch: input.task.branch,
      worktreePath: input.task.worktreePath,
      status: "conflicted",
      summary: `Merge failed for ${input.task.branch}: ${truncateOutput(commandFailureOutput(merge))}`,
    };
  }

  const head = runGit(repoRoot, ["rev-parse", "HEAD"]);
  return {
    featureId: input.commit.featureId,
    branch: input.task.branch,
    worktreePath: input.task.worktreePath,
    status: "merged",
    summary: `Merged ${input.task.branch} into the main checkout.`,
    ...(head.code === 0 ? { mergeCommitSha: stdoutText(head).trim() } : {}),
  };
}

async function cleanupFeature(input: {
  repoRoot: string;
  task: ReturnType<typeof createTaskSpec>;
  merge: MergeResult;
  deleteMergedBranches: boolean;
  cleanupBlockedWorktrees: boolean;
}): Promise<CleanupResult> {
  const repoRoot = resolve(input.repoRoot);
  const worktreePath = input.task.worktreePath;
  const worktreeState = inspectWorktree(worktreePath);

  if (!worktreeState.ok) {
    return {
      featureId: input.merge.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "blocked",
      removedWorktree: false,
      deletedBranch: false,
      summary: worktreeState.error,
    };
  }

  if (
    input.merge.status !== "merged" &&
    input.merge.status !== "skipped" &&
    !input.cleanupBlockedWorktrees
  ) {
    return {
      featureId: input.merge.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "retained",
      removedWorktree: false,
      deletedBranch: false,
      summary: "Retained worktree and branch for manual follow-up.",
    };
  }

  if (worktreeState.dirty) {
    return {
      featureId: input.merge.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "retained",
      removedWorktree: false,
      deletedBranch: false,
      summary: "Retained dirty worktree for manual follow-up.",
    };
  }

  const remove = runGit(repoRoot, ["worktree", "remove", worktreePath]);
  if (remove.code !== 0) {
    return {
      featureId: input.merge.featureId,
      branch: input.task.branch,
      worktreePath,
      status: "blocked",
      removedWorktree: false,
      deletedBranch: false,
      summary: `Failed to remove worktree: ${truncateOutput(commandFailureOutput(remove))}`,
    };
  }

  let deletedBranch = false;
  if (input.deleteMergedBranches) {
    const deleteBranch = runGit(repoRoot, ["branch", "-d", input.task.branch]);
    deletedBranch = deleteBranch.code === 0;
  }

  return {
    featureId: input.merge.featureId,
    branch: input.task.branch,
    worktreePath,
    status: "cleaned",
    removedWorktree: true,
    deletedBranch,
    summary: deletedBranch
      ? "Removed worktree and deleted merged branch."
      : "Removed worktree.",
  };
}

function buildReport(input: {
  selectedFeatures: string[];
  featureResults: FeatureCoverageResult[];
  verificationResults: VerificationResult[];
  mergeResults: MergeResult[];
  cleanupResults: CleanupResult[];
}): z.infer<typeof reportSchema> {
  const counts = {
    executable: 0,
    pending: 0,
    deferred: 0,
    blocked: 0,
  };

  for (const result of input.featureResults) {
    counts[result.status] += 1;
  }

  const reported = new Set(input.featureResults.map((result) => result.featureId));
  const missingFeatureIds = input.selectedFeatures.filter(
    (feature) => !reported.has(feature),
  );
  const retainedFeatureIds = input.cleanupResults
    .filter((result) => result.status !== "cleaned")
    .map((result) => result.featureId);

  return {
    totalRequested: input.selectedFeatures.length,
    workerReported: input.featureResults.length,
    verified: input.verificationResults.length,
    merged: input.mergeResults.filter((result) => result.status === "merged").length,
    cleaned: input.cleanupResults.filter((result) => result.status === "cleaned").length,
    executable: counts.executable,
    pending: counts.pending,
    deferred: counts.deferred,
    blocked: counts.blocked,
    missingFeatureIds,
    retainedFeatureIds,
    summary:
      missingFeatureIds.length === 0 && retainedFeatureIds.length === 0
        ? `Processed all ${input.selectedFeatures.length} requested features through worker, verification, merge, and cleanup.`
        : `Processed ${input.featureResults.length}/${input.selectedFeatures.length} requested features; retained ${retainedFeatureIds.length} worktrees for follow-up.`,
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inspectWorktree(worktreePath: string) {
  const status = runGit(worktreePath, ["status", "--porcelain"]);
  if (status.code !== 0) {
    return {
      ok: false as const,
      error: `Unable to inspect feature worktree state: ${truncateOutput(commandFailureOutput(status))}`,
    };
  }

  return {
    ok: true as const,
    dirty: stdoutText(status).trim().length > 0,
  };
}

function runGit(cwd: string, args: string[]) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
}

function runShellCommand(cwd: string, command: string) {
  return spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
  });
}

function stdoutText(result: SpawnSyncReturns<string>): string {
  return typeof result.stdout === "string" ? result.stdout : "";
}

function commandFailureOutput(result: SpawnSyncReturns<string>): string {
  if (typeof result.stderr === "string" && result.stderr.trim().length > 0) {
    return result.stderr;
  }
  if (typeof result.stdout === "string" && result.stdout.trim().length > 0) {
    return result.stdout;
  }
  if (result.error?.message) {
    return result.error.message;
  }
  return "command produced no output";
}

function truncateOutput(value: string | null | undefined, maxLength = 240): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}
