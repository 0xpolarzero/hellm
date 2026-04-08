import { describe, test } from "bun:test";

describe("@hellm/orchestrator smithers default delegated path contract", () => {
  test.todo(
    "classifies delegated requests to `smithers-workflow` by default when `routeHint` is `auto` and no explicit preferred path is provided",
    () => {},
  );
  test.todo(
    "treats a single bounded subagent request as delegated work and chooses `smithers-workflow` instead of `pi-worker`",
    () => {},
  );
  test.todo(
    "promotes structured delegated intent (for example, bounded workflow tasks) to `smithers-workflow` without requiring explicit `preferredPath`",
    () => {},
  );
  test.todo(
    "dispatches delegated-default routing through `smithersBridge.runWorkflow` and avoids `piBridge.runWorker` for equivalent bounded work",
    () => {},
  );
  test.todo(
    "keeps delegated-default routing stable across real session/worktree context boundaries and records the resulting workflow run reference",
    () => {},
  );
});
