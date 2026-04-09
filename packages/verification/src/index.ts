import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createArtifact,
  createEpisode,
  createVerificationRecord,
  type ArtifactRecord,
  type Episode,
  type VerificationKind,
  type VerificationRecord,
} from "@hellm/session-model";

export interface VerificationRequest {
  threadId: string;
  cwd: string;
  objective: string;
  kinds: VerificationKind[];
  manualChecks?: string[];
}

export interface VerificationRunResult {
  status: "passed" | "failed" | "unknown";
  records: VerificationRecord[];
  artifacts: ArtifactRecord[];
  episode?: Episode;
}

export interface VerificationRunner {
  run(request: VerificationRequest): Promise<VerificationRunResult>;
}

export interface SubprocessVerificationConfig {
  buildCommand?: string[];
  testCommand?: string[];
  lintCommand?: string[];
  integrationCommand?: string[];
}

async function runSubprocess(
  command: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { exitCode, stdout, stderr };
}

export function createSubprocessVerificationRunner(
  config: SubprocessVerificationConfig = {},
): VerificationRunner {
  const buildCommand = config.buildCommand ?? ["bun", "run", "build"];
  const testCommand = config.testCommand ?? ["bun", "test"];
  const lintCommand = config.lintCommand ?? ["bun", "run", "lint"];
  const integrationCommand = config.integrationCommand ?? ["bun", "test"];

  return {
    async run(request) {
      const records: VerificationRecord[] = [];
      const artifacts: ArtifactRecord[] = [];
      const now = new Date().toISOString();
      let index = 0;

      for (const kind of request.kinds) {
        const recordId = `verification-${request.threadId}:${kind}:${now}`;
        index += 1;

        if (kind === "manual") {
          const checks = request.manualChecks ?? [];
          records.push(
            createVerificationRecord({
              id: recordId,
              kind,
              status: checks.length > 0 ? "skipped" : "unknown",
              summary:
                checks.length > 0
                  ? `Manual checks deferred: ${checks.join("; ")}`
                  : "No manual checks specified.",
              createdAt: now,
            }),
          );
          continue;
        }

        const commandMap: Record<string, string[]> = {
          build: buildCommand,
          test: testCommand,
          lint: lintCommand,
          integration: integrationCommand,
        };
        const command = commandMap[kind] ?? testCommand;

        try {
          const result = await runSubprocess(command, request.cwd);
          const passed = result.exitCode === 0;
          const outputLog = result.stdout || result.stderr;

          const artifactId = `artifact-${request.threadId}:${kind}:${now}`;
          let artifactPath: string | undefined;

          if (outputLog) {
            const artifactDir = join(request.cwd, ".hellm", "verification");
            await mkdir(artifactDir, { recursive: true });
            artifactPath = join(artifactDir, `${kind}-${now.replace(/[:.]/g, "-")}.log`);
            await writeFile(artifactPath, outputLog, "utf8");

            artifacts.push(
              createArtifact({
                id: artifactId,
                kind: "log",
                description: `${kind} verification output`,
                path: artifactPath,
                createdAt: now,
              }),
            );
          }

          records.push(
            createVerificationRecord({
              id: recordId,
              kind,
              status: passed ? "passed" : "failed",
              summary: passed
                ? `${kind} verification passed.`
                : `${kind} verification failed with exit code ${result.exitCode}.`,
              artifactIds: outputLog ? [artifactId] : [],
              createdAt: now,
            }),
          );
        } catch (error) {
          records.push(
            createVerificationRecord({
              id: recordId,
              kind,
              status: "unknown",
              summary: `${kind} verification could not run: ${error instanceof Error ? error.message : String(error)}`,
              createdAt: now,
            }),
          );
        }
      }

      const hasFailure = records.some(
        (record) => record.status === "failed",
      );
      const allSkipped = records.every(
        (record) => record.status === "skipped" || record.status === "unknown",
      );

      return {
        status: hasFailure ? "failed" : allSkipped ? "unknown" : "passed",
        records,
        artifacts,
      };
    },
  };
}

export function normalizeVerificationRunToEpisode(input: {
  threadId: string;
  objective: string;
  result: VerificationRunResult;
  startedAt: string;
  completedAt: string;
  inputEpisodeIds?: string[];
}): Episode {
  if (input.result.episode) {
    return input.result.episode;
  }

  return createEpisode({
    id: `${input.threadId}:verification:${input.completedAt}`,
    threadId: input.threadId,
    source: "verification",
    objective: input.objective,
    status: input.result.status === "failed" ? "completed_with_issues" : "completed",
    conclusions: [input.result.status === "failed" ? "Verification failed." : "Verification completed."],
    artifacts: input.result.artifacts,
    verification: input.result.records,
    unresolvedIssues:
      input.result.status === "failed"
        ? input.result.records
            .filter((record) => record.status === "failed")
            .map((record) => record.summary)
        : [],
    followUpSuggestions:
      input.result.status === "failed"
        ? ["Resolve the failing verification steps before closing the thread."]
        : [],
    provenance: {
      executionPath: "verification",
      actor: "verification",
      notes: "Normalized verification execution path.",
    },
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    inputEpisodeIds: input.inputEpisodeIds ?? [],
  });
}

export function createVerificationRunner(
  config?: SubprocessVerificationConfig,
): VerificationRunner {
  return createSubprocessVerificationRunner(config);
}
