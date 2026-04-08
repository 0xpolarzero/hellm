import {
  createEpisode,
  type ArtifactRecord,
  type Episode,
  type VerificationKind,
  type VerificationRecord,
} from "@hellm/session-model";

const NOT_IMPLEMENTED = "Not implemented";

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

export function createVerificationRunner(): VerificationRunner {
  return {
    async run() {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
