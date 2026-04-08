import { describe, test } from "bun:test";

describe("@hellm/cli richer remote attachment patterns contract", () => {
  test.todo(
    "extends headless input with explicit remote attachment descriptors without changing baseline prompt, routeHint, or workflowSeedInput semantics",
    () => {},
  );
  test.todo(
    "materializes supported remote attachments into deterministic local artifacts and records stable digest-backed references in the resulting episode",
    () => {},
  );
  test.todo(
    "fails closed for unpinned or non-reproducible attachment sources and reports a structured blocked/waiting outcome instead of silently proceeding",
    () => {},
  );
  test.todo(
    "reuses cached attachment materializations for offline reruns so repeated headless executions stay deterministic when remote sources are unavailable",
    () => {},
  );
  test.todo(
    "keeps remote attachment fetch credentials out of session JSONL and emitted JSONL events while still providing actionable provenance metadata",
    () => {},
  );
  test.todo(
    "isolates attachment materialization paths by worktree/thread scope so delegated runs cannot read another workstream's remote attachment payloads by default",
    () => {},
  );
});
