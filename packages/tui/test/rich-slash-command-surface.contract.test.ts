import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, test } from "bun:test";
import {
  createGlobalVerificationState,
  createSessionWorktreeAlignment,
  createThread,
  type ThreadSnapshot,
} from "@hellm/session-model";
import { projectThreadSnapshot, renderProjection } from "@hellm/tui";
import { runBunModule } from "@hellm/test-support";

const TUI_ENTRY = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const REPO_ROOT = resolve(import.meta.dir, "../../../");

function assertNoRichSlashSurface(lines: readonly string[]): void {
  const rendered = lines.join("\n");
  expect(rendered).not.toContain("/threads");
  expect(rendered).not.toContain("/reconcile");
}

const RICH_SLASH_COMMAND_SURFACE_PENDING_CONTRACTS = [
  "supports a /threads command that lists active thread ids, kind, status, and worktree/session context from orchestrator-backed state",
  "renders /threads output deterministically (ordering, grouping, and truncation) across viewport resizes in the virtual terminal harness",
  "resolves /threads against file-backed branched session JSONL history so resume/fork flows expose the correct active thread set",
  "supports a /reconcile command that triggers reconciliation and surfaces resulting episode + verification updates in the orchestration-aware UI",
  "routes /reconcile through the same orchestrator reconciliation path used by non-command flows so provenance and completion semantics stay aligned",
  "provides discoverable slash-command help that includes at least /threads and /reconcile without requiring headless mode",
  "surfaces slash-command help and command output from the interactive TUI process boundary, not just projection helpers",
  "handles unknown slash commands with deterministic non-mutating feedback and preserves the active thread/worktree selection",
  "records slash-command-triggered state transitions through the same session-backed JSONL entries used by non-command orchestration flows",
] as const;

describe("@hellm/tui rich slash command surface contracts", () => {
  it("keeps the slash-command surface deferred in current projection output", () => {
    const timestamp = "2026-04-08T09:00:00.000Z";
    const snapshot: ThreadSnapshot = {
      thread: createThread({
        id: "thread-rich-slash-contract",
        kind: "direct",
        objective: "Render baseline orchestration state.",
        status: "completed",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      episodes: [],
      artifacts: [],
      verification: createGlobalVerificationState(),
      alignment: createSessionWorktreeAlignment({ sessionCwd: "/repo" }),
      workflowRuns: [],
    };

    const projection = projectThreadSnapshot(snapshot);
    assertNoRichSlashSurface(renderProjection(projection));
  });

  it("keeps the slash-command surface deferred in the real TUI process entrypoint", () => {
    const result = runBunModule({
      entryPath: TUI_ENTRY,
      cwd: REPO_ROOT,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr.trim()).toBe("");
    assertNoRichSlashSurface(result.stdout.trim().split("\n"));
  });

  for (const contract of RICH_SLASH_COMMAND_SURFACE_PENDING_CONTRACTS) {
    test.todo(contract, () => {});
  }
});
