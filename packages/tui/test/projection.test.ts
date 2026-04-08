import { describe, expect, it, test } from "bun:test";
import {
  createArtifact,
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import { VirtualTerminalHarness } from "@hellm/test-support";

const TIMESTAMP = "2026-04-08T09:00:00.000Z";

describe("@hellm/tui projection", () => {
  it("projects threads, episode details, verification, workflow activity, and session/worktree indicators without snapshots", () => {
    const thread = createThread({
      id: "thread-ui",
      kind: "smithers-workflow",
      objective: "Show workflow state",
      status: "waiting_approval",
      worktreePath: "/repo/worktrees/ui",
      createdAt: TIMESTAMP,
    });
    const artifact = createArtifact({
      id: "artifact-ui",
      kind: "note",
      description: "Projection note",
      createdAt: TIMESTAMP,
    });
    const episode = createEpisode({
      id: "episode-ui",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "waiting_approval",
      conclusions: ["Workflow paused for approval"],
      artifacts: [artifact],
      followUpSuggestions: ["Approve or deny the workflow"],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
        notes: "Workflow projection",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:01.000Z",
    });
    const projection = projectThreadSnapshot({
      thread,
      episodes: [episode],
      artifacts: [artifact],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({
        sessionCwd: "/repo",
        activeWorktreePath: "/repo/worktrees/ui",
      }),
      workflowRuns: [
        {
          runId: "run-ui",
          threadId: thread.id,
          workflowId: "workflow:thread-ui",
          status: "waiting_approval",
          updatedAt: TIMESTAMP,
          worktreePath: "/repo/worktrees/ui",
        },
      ],
    });
    const terminal = new VirtualTerminalHarness(120, 20);
    const viewport = terminal.render(projection);

    expect(projection.threadsPane).toContain("status waiting_approval");
    expect(projection.episodeInspector).toContain("follow-up Approve or deny the workflow");
    expect(projection.workflowActivity[0]).toContain("waiting_approval");
    expect(projection.footer).toContain("not aligned");
    expect(viewport).toContain("[threads]");
    expect(viewport).toContain("[workflow]");
  });

  it("shows waiting_input visibility across thread, latest episode, and viewport when no workflow run is active", () => {
    const thread = createThread({
      id: "thread-waiting-input",
      kind: "approval",
      objective: "Clarify missing requirement",
      status: "waiting_input",
      createdAt: TIMESTAMP,
    });
    const episode = createEpisode({
      id: "episode-waiting-input",
      threadId: thread.id,
      source: "orchestrator",
      objective: thread.objective,
      status: "waiting_input",
      conclusions: ["Need one clarification before continuing."],
      followUpSuggestions: ["Provide the missing requirement."],
      provenance: {
        executionPath: "approval",
        actor: "orchestrator",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:02.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [episode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    });
    const viewport = new VirtualTerminalHarness(120, 20).render(projection);

    expect(projection.threadsPane).toContain("status waiting_input");
    expect(projection.episodeInspector).toContain("status waiting_input");
    expect(projection.workflowActivity).toEqual(["workflow none"]);
    expect(viewport).toContain("status waiting_input");
  });

  it("shows waiting_approval visibility across thread, latest episode, workflow activity, and viewport", () => {
    const thread = createThread({
      id: "thread-waiting-approval",
      kind: "smithers-workflow",
      objective: "Wait for approval gate",
      status: "waiting_approval",
      createdAt: TIMESTAMP,
    });
    const episode = createEpisode({
      id: "episode-waiting-approval",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "waiting_approval",
      conclusions: ["Workflow gate paused for approval."],
      followUpSuggestions: ["Approve or deny this step."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:03.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [episode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [
        {
          runId: "run-waiting-approval",
          threadId: thread.id,
          workflowId: "workflow:thread-waiting-approval",
          status: "waiting_approval",
          updatedAt: TIMESTAMP,
        },
      ],
    });
    const viewport = new VirtualTerminalHarness(120, 20).render(projection);

    expect(projection.threadsPane).toContain("status waiting_approval");
    expect(projection.episodeInspector).toContain("status waiting_approval");
    expect(projection.workflowActivity).toContain(
      "workflow:thread-waiting-approval: waiting_approval (run-waiting-approval)",
    );
    expect(viewport).toContain("status waiting_approval");
  });

  it("keeps blocked visibility explicit even when workflow activity is failed and the latest episode changed from waiting", () => {
    const thread = createThread({
      id: "thread-blocked",
      kind: "smithers-workflow",
      objective: "Handle blocked dependency",
      status: "blocked",
      createdAt: TIMESTAMP,
    });
    const waitingEpisode = createEpisode({
      id: "episode-before-blocked",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "waiting_approval",
      conclusions: ["Previously waiting on an approval gate."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:04.000Z",
    });
    const blockedEpisode = createEpisode({
      id: "episode-blocked",
      threadId: thread.id,
      source: "smithers",
      objective: thread.objective,
      status: "blocked",
      conclusions: ["Workflow is blocked by missing dependency."],
      unresolvedIssues: ["Dependency package is unavailable."],
      followUpSuggestions: ["Install the dependency and resume."],
      provenance: {
        executionPath: "smithers-workflow",
        actor: "smithers",
      },
      startedAt: TIMESTAMP,
      completedAt: "2026-04-08T09:00:05.000Z",
    });

    const projection = projectThreadSnapshot({
      thread,
      episodes: [waitingEpisode, blockedEpisode],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [
        {
          runId: "run-blocked-failed",
          threadId: thread.id,
          workflowId: "workflow:thread-blocked",
          status: "failed",
          updatedAt: TIMESTAMP,
        },
      ],
    });
    const viewport = new VirtualTerminalHarness(120, 20).render(projection);

    expect(projection.threadsPane).toContain("status blocked");
    expect(projection.episodeInspector).toContain("episode episode-blocked");
    expect(projection.episodeInspector).toContain("status blocked");
    expect(projection.episodeInspector).toContain(
      "issue Dependency package is unavailable.",
    );
    expect(projection.workflowActivity).toContain(
      "workflow:thread-blocked: failed (run-blocked-failed)",
    );
    expect(viewport).toContain("status blocked");
  });

  test.todo(
    "advanced worktree switching UX remains orchestration-aware",
    () => {},
  );
  test.todo(
    "rich slash command surface integrates with the orchestration projection",
    () => {},
  );
});
