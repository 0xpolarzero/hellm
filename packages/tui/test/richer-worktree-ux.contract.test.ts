import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, test } from "bun:test";
import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  type ThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import {
  VirtualTerminalHarness,
  createTempGitWorkspace,
  hasGit,
} from "../../../test-support/index.ts";

function createWorktreeSnapshot(input: {
  threadWorktreePath: string;
  activeWorktreePath: string;
}): ThreadSnapshot {
  const timestamp = "2026-04-08T09:00:00.000Z";
  const thread = createThread({
    id: "thread-richer-worktree",
    kind: "smithers-workflow",
    objective: "Inspect active worktree details in the TUI",
    status: "running",
    worktreePath: input.threadWorktreePath,
    createdAt: timestamp,
  });

  return {
    thread,
    episodes: [],
    artifacts: [],
    verification: createGlobalVerificationState(),
    alignment: createSessionWorktreeAlignment({
      sessionCwd: "/repo",
      activeWorktreePath: input.activeWorktreePath,
    }),
    workflowRuns: [],
  };
}

describe("@hellm/tui advanced richer worktree UX contract", () => {
  it("keeps richer worktree UX deferred to footer-only alignment output", () => {
    const worktreePath = "/repo/worktrees/feature-richer";
    const projection = projectThreadSnapshot(
      createWorktreeSnapshot({
        threadWorktreePath: worktreePath,
        activeWorktreePath: worktreePath,
      }),
    );
    const frame = new VirtualTerminalHarness(140, 30).render(projection);

    expect(frame).toContain(`worktree ${worktreePath}`);
    expect(frame.some((line) => line.startsWith("branch "))).toBe(false);
    expect(frame.some((line) => line.startsWith("dirty "))).toBe(false);
    expect(frame).not.toContain("[worktree]");
  });

  it("uses real linked git worktrees as contract inputs without inventing richer UI output", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace();
    try {
      const worktreePath = await workspace.createLinkedWorktree("feature-richer-ux");
      await appendFile(resolve(worktreePath, "README.md"), "dirty worktree\n", "utf8");
      const branch = workspace.git(["branch", "--show-current"], worktreePath);
      const dirtyState = workspace.git(["status", "--porcelain"], worktreePath);
      const projection = projectThreadSnapshot(
        createWorktreeSnapshot({
          threadWorktreePath: worktreePath,
          activeWorktreePath: worktreePath,
        }),
      );
      const frame = new VirtualTerminalHarness(140, 30).render(projection);

      expect(branch).toBe("feature-richer-ux");
      expect(dirtyState.length).toBeGreaterThan(0);
      expect(frame).toContain(`worktree ${worktreePath}`);
      expect(frame).not.toContain(`branch ${branch}`);
      expect(frame.some((line) => line.includes("dirty"))).toBe(false);
    } finally {
      await workspace.cleanup();
    }
  });

  it("keeps worktree projection deterministic across render frames for the same snapshot", () => {
    const worktreePath = "/repo/worktrees/feature-deterministic";
    const projection = projectThreadSnapshot(
      createWorktreeSnapshot({
        threadWorktreePath: worktreePath,
        activeWorktreePath: worktreePath,
      }),
    );
    const terminal = new VirtualTerminalHarness(100, 20);

    const firstFrame = terminal.render(projection);
    const secondFrame = terminal.render(projection);

    expect(secondFrame).toEqual(firstFrame);
  });

  test.todo(
    "renders a dedicated worktree panel beyond the baseline footer, including branch name and dirty/clean state for the active thread worktree",
    () => {},
  );
  test.todo(
    "derives branch identity and dirty status directly from real linked git worktree state instead of requiring precomputed metadata",
    () => {},
  );
  test.todo(
    "highlights mismatches between session cwd, active worktree, and thread-bound worktree with explicit operator guidance and a remediation hint",
    () => {},
  );
  test.todo(
    "shows worktree-isolated workflow activity so delegated runs remain understandable when multiple worktrees are active simultaneously",
    () => {},
  );
});
