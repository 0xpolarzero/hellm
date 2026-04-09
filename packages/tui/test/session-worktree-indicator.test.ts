import { describe, expect, it } from "bun:test";
import {
  createSessionWorktreeAlignment,
  createThread,
  createThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot } from "@hellm/tui";
import {
  FileBackedSessionJsonlHarness,
  VirtualTerminalHarness,
  createTempGitWorkspace,
  createTempWorkspace,
  hasGit,
} from "../../../test-support/index.ts";

const TIMESTAMP = "2026-04-08T09:00:00.000Z";

function projectFromFileBackedSession(input: {
  sessionFile: string;
  sessionCwd: string;
  activeWorktreePath?: string;
  threadWorktreePath?: string;
}) {
  const harness = new FileBackedSessionJsonlHarness({
    filePath: input.sessionFile,
    sessionId: "thread-session-worktree-indicator",
    cwd: input.sessionCwd,
    timestamp: TIMESTAMP,
  });
  const thread = createThread({
    id: "thread-session-worktree-indicator",
    kind: "direct",
    objective: "Render session and worktree context in the footer.",
    status: "running",
    createdAt: TIMESTAMP,
    ...(input.threadWorktreePath ? { worktreePath: input.threadWorktreePath } : {}),
  });
  const alignment = input.activeWorktreePath
    ? createSessionWorktreeAlignment({
        sessionCwd: input.sessionCwd,
        activeWorktreePath: input.activeWorktreePath,
      })
    : createSessionWorktreeAlignment({
        sessionCwd: input.sessionCwd,
      });

  harness.append({ kind: "thread", data: thread }, TIMESTAMP);
  harness.append({ kind: "alignment", data: alignment }, TIMESTAMP);

  return projectThreadSnapshot(createThreadSnapshot(harness.reconstruct(), thread.id));
}

describe("@hellm/tui session worktree indicator", () => {
  it("renders linked worktree context from file-backed JSONL session state", async () => {
    if (!hasGit()) {
      return;
    }

    const workspace = await createTempGitWorkspace("hellm-tui-session-worktree-");
    try {
      const worktreePath = await workspace.createLinkedWorktree("feature-session-indicator");
      const projection = projectFromFileBackedSession({
        sessionFile: workspace.path(".pi/sessions/thread-session-worktree-indicator.jsonl"),
        sessionCwd: workspace.root,
        activeWorktreePath: worktreePath,
        threadWorktreePath: worktreePath,
      });
      const viewport = new VirtualTerminalHarness(200, 24).render(projection);

      expect(projection.footer).toEqual([
        `session ${workspace.root}`,
        `worktree ${worktreePath}`,
        "not aligned",
      ]);
      expect(viewport).toContain("[footer]");
      expect(viewport).toContain(`session ${workspace.root}`);
      expect(viewport).toContain(`worktree ${worktreePath}`);
      expect(viewport).toContain("not aligned");
    } finally {
      await workspace.cleanup();
    }
  });

  it("falls back to session cwd when no active worktree is recorded", async () => {
    const workspace = await createTempWorkspace("hellm-tui-session-worktree-");
    try {
      const projection = projectFromFileBackedSession({
        sessionFile: workspace.path(".pi/sessions/thread-session-worktree-indicator.jsonl"),
        sessionCwd: workspace.root,
      });
      const viewport = new VirtualTerminalHarness(160, 24).render(projection);

      expect(projection.footer).toEqual([
        `session ${workspace.root}`,
        `worktree ${workspace.root}`,
        "aligned",
      ]);
      expect(viewport).toContain("[footer]");
      expect(viewport).toContain(`session ${workspace.root}`);
      expect(viewport).toContain(`worktree ${workspace.root}`);
      expect(viewport).toContain("aligned");
    } finally {
      await workspace.cleanup();
    }
  });
});
