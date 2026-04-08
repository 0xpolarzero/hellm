import { describe, test } from "bun:test";

describe("@hellm/tui rich slash command surface contracts", () => {
  test.todo(
    "supports a /threads command that lists active thread ids, kind, status, and worktree/session context from orchestrator-backed state",
    () => {},
  );
  test.todo(
    "supports a /reconcile command that triggers reconciliation and surfaces resulting episode + verification updates in the orchestration-aware UI",
    () => {},
  );
  test.todo(
    "provides discoverable slash-command help that includes at least /threads and /reconcile without requiring headless mode",
    () => {},
  );
  test.todo(
    "handles unknown slash commands with deterministic non-mutating feedback and preserves the active thread/worktree selection",
    () => {},
  );
  test.todo(
    "records slash-command-triggered state transitions through the same session-backed JSONL entries used by non-command orchestration flows",
    () => {},
  );
});
