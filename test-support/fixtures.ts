import {
  createArtifact,
  createEpisode,
  createThread,
  createVerificationRecord,
  type ArtifactRecord,
  type Episode,
  type ThreadRef,
  type VerificationRecord,
} from "@hellm/session-model";

let fixtureCounter = 0;

export function nextFixtureId(prefix: string): string {
  fixtureCounter += 1;
  return `${prefix}-${fixtureCounter.toString(16).padStart(4, "0")}`;
}

export function fixedClock(
  start = "2026-04-08T09:00:00.000Z",
): () => string {
  let offset = 0;
  return () => {
    const value = new Date(Date.parse(start) + offset * 1_000).toISOString();
    offset += 1;
    return value;
  };
}

export function createThreadFixture(
  overrides: Partial<ThreadRef> = {},
): ThreadRef {
  const timestamp = overrides.createdAt ?? "2026-04-08T09:00:00.000Z";
  return createThread({
    id: overrides.id ?? nextFixtureId("thread"),
    kind: overrides.kind ?? "direct",
    objective: overrides.objective ?? "Fixture objective",
    ...(overrides.inputEpisodeIds ? { inputEpisodeIds: overrides.inputEpisodeIds } : {}),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.parentThreadId
      ? { parentThreadId: overrides.parentThreadId }
      : {}),
    ...(overrides.worktreePath ? { worktreePath: overrides.worktreePath } : {}),
    ...(overrides.smithersRunId
      ? { smithersRunId: overrides.smithersRunId }
      : {}),
    createdAt: timestamp,
    ...(overrides.updatedAt ? { updatedAt: overrides.updatedAt } : {}),
  });
}

export function createArtifactFixture(
  overrides: Partial<ArtifactRecord> = {},
): ArtifactRecord {
  const kind = overrides.kind ?? "note";
  const path =
    overrides.path ??
    (kind === "file" ||
    kind === "diff" ||
    kind === "log" ||
    kind === "test-report" ||
    kind === "screenshot"
      ? `/tmp/${kind}-${nextFixtureId("path")}.txt`
      : undefined);

  return createArtifact({
    id: overrides.id ?? nextFixtureId("artifact"),
    kind,
    description: overrides.description ?? "Fixture artifact",
    ...(path ? { path } : {}),
    createdAt: overrides.createdAt ?? "2026-04-08T09:00:00.000Z",
  });
}

export function createVerificationFixture(
  overrides: Partial<VerificationRecord> = {},
): VerificationRecord {
  return createVerificationRecord({
    id: overrides.id ?? nextFixtureId("verification"),
    kind: overrides.kind ?? "test",
    status: overrides.status ?? "passed",
    summary: overrides.summary ?? "Fixture verification summary",
    ...(overrides.artifactIds ? { artifactIds: overrides.artifactIds } : {}),
    createdAt: overrides.createdAt ?? "2026-04-08T09:00:00.000Z",
  });
}

export function createEpisodeFixture(
  overrides: Partial<Episode> = {},
): Episode {
  const timestamp = overrides.startedAt ?? "2026-04-08T09:00:00.000Z";
  return createEpisode({
    id: overrides.id ?? nextFixtureId("episode"),
    threadId: overrides.threadId ?? "thread-0001",
    source: overrides.source ?? "orchestrator",
    objective: overrides.objective ?? "Fixture episode objective",
    status: overrides.status ?? "completed",
    ...(overrides.conclusions ? { conclusions: overrides.conclusions } : {}),
    ...(overrides.changedFiles ? { changedFiles: overrides.changedFiles } : {}),
    ...(overrides.artifacts ? { artifacts: overrides.artifacts } : {}),
    ...(overrides.verification ? { verification: overrides.verification } : {}),
    ...(overrides.unresolvedIssues
      ? { unresolvedIssues: overrides.unresolvedIssues }
      : {}),
    ...(overrides.followUpSuggestions
      ? { followUpSuggestions: overrides.followUpSuggestions }
      : {}),
    provenance: overrides.provenance ?? {
      executionPath: "direct",
      actor: "orchestrator",
      notes: "Fixture provenance",
    },
    ...(overrides.smithersRunId ? { smithersRunId: overrides.smithersRunId } : {}),
    ...(overrides.worktreePath ? { worktreePath: overrides.worktreePath } : {}),
    startedAt: timestamp,
    ...(overrides.completedAt ? { completedAt: overrides.completedAt } : {}),
    ...(overrides.inputEpisodeIds
      ? { inputEpisodeIds: overrides.inputEpisodeIds }
      : {}),
  });
}
