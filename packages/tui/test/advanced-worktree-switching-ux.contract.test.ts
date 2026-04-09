import { describe, expect, it, test } from "bun:test";
import {
  createEpisode,
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import {
  VirtualTerminalHarness,
  createTempGitWorkspace,
  hasGit,
} from "../../../test-support/index.ts";

describe("@hellm/tui advanced worktree switching UX contracts", () => {
  it("keeps orchestration projection deterministic when switching between real linked git worktrees", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const primaryWorktree = await workspace.createLinkedWorktree("feature-switch-a");
      const alternateWorktree = await workspace.createLinkedWorktree("feature-switch-b");
      const timestamp = "2026-04-08T09:00:00.000Z";
      const thread = createThread({
        id: "thread-worktree-switch",
        kind: "smithers-workflow",
        objective: "Switch active worktrees while preserving orchestration context",
        status: "running",
        worktreePath: primaryWorktree,
        createdAt: timestamp,
      });
      const episode = createEpisode({
        id: "episode-worktree-switch",
        threadId: thread.id,
        source: "smithers",
        objective: thread.objective,
        status: "blocked",
        conclusions: ["Workflow is running in the selected worktree."],
        artifacts: [],
        provenance: {
          executionPath: "smithers-workflow",
          actor: "smithers",
          notes: "Projection-only contract coverage.",
        },
        startedAt: timestamp,
      });
      const terminal = new VirtualTerminalHarness(200, 40);

      const projectForWorktree = (worktreePath: string, runId: string) =>
        projectThreadSnapshot({
          thread,
          episodes: [episode],
          artifacts: [],
          verification: createGlobalVerificationState(),
          alignment: createSessionWorktreeAlignment({
            sessionCwd: workspace.root,
            activeWorktreePath: worktreePath,
          }),
          workflowRuns: [
            {
              runId,
              threadId: thread.id,
              workflowId: `workflow:${thread.id}`,
              status: "running",
              updatedAt: timestamp,
              worktreePath,
            },
          ],
        });

      const initialProjection = projectForWorktree(primaryWorktree, "run-primary");
      const switchedProjection = projectForWorktree(alternateWorktree, "run-alternate");
      const switchedBackProjection = projectForWorktree(primaryWorktree, "run-primary");

      const initialViewport = terminal.render(initialProjection).join("\n");
      const switchedViewport = terminal.render(switchedProjection).join("\n");
      const switchedBackViewport = terminal.render(switchedBackProjection).join("\n");

      expect(initialProjection.footer).toContain(`worktree ${primaryWorktree}`);
      expect(switchedProjection.footer).toContain(`worktree ${alternateWorktree}`);
      expect(switchedProjection.footer).toContain("not aligned");
      expect(switchedProjection.workflowActivity[0]).toContain("run-alternate");
      expect(switchedViewport).not.toBe(initialViewport);
      expect(switchedBackViewport).toBe(initialViewport);
    } finally {
      await workspace.cleanup();
    }
  });

  test.todo(
    "switch intents atomically update active worktree selection, thread worktree binding, and runtime transition records",
    () => {},
  );
  test.todo(
    "renders a dedicated worktree switcher listing candidate linked worktrees with branch identity and dirty state before confirmation",
    () => {},
  );
  test.todo(
    "requires explicit confirmation before leaving a dirty or unresolved worktree and keeps the current selection unchanged on cancel",
    () => {},
  );
  test.todo(
    "scopes workflow activity and verification panels to the selected worktree during rapid consecutive switches",
    () => {},
  );
  test.todo(
    "restores the last selected worktree from session JSONL on resume while ignoring stale switch events from older episodes",
    () => {},
  );
});
