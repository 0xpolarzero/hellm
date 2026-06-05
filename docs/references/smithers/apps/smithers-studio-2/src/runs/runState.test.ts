import { describe, expect, test } from "bun:test";
import { isRunningState, isTerminalState, normalizeState } from "./runState";

/**
 * Real unit test for the run-state vocabulary — pure functions, real inputs, no
 * mocking. This is the colocated `*.test.ts` convention the `test:unit` runner
 * picks up (run with `bun run test:unit`). It NEVER touches the Playwright e2e
 * specs in tests/e2e (those run under `pnpm exec playwright test`).
 */
describe("normalizeState", () => {
  test("collapses the Gateway's wider status vocabulary to surface states", () => {
    expect(normalizeState("finished")).toBe("succeeded");
    expect(normalizeState("completed")).toBe("succeeded");
    expect(normalizeState("error")).toBe("failed");
    expect(normalizeState("canceled")).toBe("cancelled");
    expect(normalizeState("active")).toBe("running");
    expect(normalizeState("blocked_approval")).toBe("waiting-approval");
  });

  test("is case- and separator-insensitive", () => {
    expect(normalizeState("WAITING_EVENT")).toBe("waiting-event");
    expect(normalizeState("Waiting-Timer")).toBe("waiting-timer");
  });
});

describe("isTerminalState / isRunningState", () => {
  test("terminal states are succeeded / failed / cancelled", () => {
    expect(isTerminalState("succeeded")).toBe(true);
    expect(isTerminalState("failed")).toBe(true);
    expect(isTerminalState("cancelled")).toBe(true);
    expect(isTerminalState("running")).toBe(false);
    expect(isTerminalState("waiting-approval")).toBe(false);
  });

  test("running covers the live + waiting states", () => {
    expect(isRunningState("running")).toBe(true);
    expect(isRunningState("waiting-approval")).toBe(true);
    expect(isRunningState("succeeded")).toBe(false);
  });
});
