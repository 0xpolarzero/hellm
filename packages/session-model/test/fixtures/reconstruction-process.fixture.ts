import { resolve } from "node:path";
import {
  createEpisode,
  createSessionWorktreeAlignment,
  createThread,
  createVerificationRecord,
} from "@hellm/session-model";
import { FileBackedSessionJsonlHarness } from "@hellm/test-support";

const [command, sessionFileArg, sessionCwdArg, processCwdArg] = Bun.argv.slice(2);

if (!command || !sessionFileArg || !sessionCwdArg) {
  throw new Error(
    "Usage: bun reconstruction-process.fixture.ts <append-initial|append-final|reconstruct> <session-file> <session-cwd>",
  );
}

const sessionFile = resolve(sessionFileArg);
const sessionCwd = resolve(sessionCwdArg);
const worktreePath = resolve(sessionCwd, "worktrees/feature");

if (processCwdArg) {
  process.chdir(resolve(processCwdArg));
}

const harness = new FileBackedSessionJsonlHarness({
  filePath: sessionFile,
  sessionId: "session-process-reconstruction",
  cwd: sessionCwd,
  timestamp: "2026-04-08T09:00:00.000Z",
});

switch (command) {
  case "append-initial":
    harness.append({
      kind: "thread",
      data: createThread({
        id: "thread-process",
        kind: "verification",
        objective: "Reconstruct state across process boundaries",
        status: "running",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:00:01.000Z",
        inputEpisodeIds: ["episode-seed"],
      }),
    });
    harness.append({
      kind: "episode",
      data: createEpisode({
        id: "episode-process",
        threadId: "thread-process",
        source: "verification",
        objective: "Initial verification run",
        status: "blocked",
        conclusions: ["Initial reconstruction state is blocked."],
        unresolvedIssues: ["Manual approval is still pending."],
        provenance: {
          executionPath: "verification",
          actor: "verification",
        },
        startedAt: "2026-04-08T09:00:02.000Z",
        inputEpisodeIds: ["episode-seed"],
      }),
    });
    break;
  case "append-final":
    harness.append({
      kind: "thread",
      data: createThread({
        id: "thread-process",
        kind: "verification",
        objective: "Reconstruct state across process boundaries",
        status: "completed",
        createdAt: "2026-04-08T09:00:00.000Z",
        updatedAt: "2026-04-08T09:05:00.000Z",
        inputEpisodeIds: ["episode-seed", "episode-previous"],
        worktreePath,
      }),
    });
    harness.append({
      kind: "episode",
      data: createEpisode({
        id: "episode-process",
        threadId: "thread-process",
        source: "verification",
        objective: "Final verification run",
        status: "completed",
        conclusions: ["Process-boundary reconstruction is complete."],
        unresolvedIssues: [],
        followUpSuggestions: ["Ship the reconstructed state projection."],
        changedFiles: [resolve(sessionCwd, "src/index.ts")],
        verification: [
          createVerificationRecord({
            id: "verification-process-build",
            kind: "build",
            status: "passed",
            summary: "Build passed after restart.",
            createdAt: "2026-04-08T09:04:00.000Z",
          }),
        ],
        provenance: {
          executionPath: "verification",
          actor: "verification",
        },
        startedAt: "2026-04-08T09:04:00.000Z",
        completedAt: "2026-04-08T09:05:00.000Z",
        inputEpisodeIds: ["episode-seed", "episode-previous"],
        worktreePath,
      }),
    });
    harness.append({
      kind: "alignment",
      data: createSessionWorktreeAlignment({
        sessionCwd,
        activeWorktreePath: worktreePath,
      }),
    });
    break;
  case "reconstruct": {
    const state = harness.reconstruct();
    const thread = state.threads.find((candidate) => candidate.id === "thread-process");
    const episode = state.episodes.find(
      (candidate) => candidate.id === "episode-process",
    );
    console.log(
      JSON.stringify({
        sessionId: state.sessionId,
        sessionCwd: state.sessionCwd,
        threadStatus: thread?.status,
        threadInputEpisodeIds: thread?.inputEpisodeIds ?? [],
        episodeStatus: episode?.status,
        episodeConclusions: episode?.conclusions ?? [],
        verificationOverallStatus: state.verification.overallStatus,
        alignment: state.alignment,
      }),
    );
    break;
  }
  default:
    throw new Error(`Unknown command: ${command}`);
}
