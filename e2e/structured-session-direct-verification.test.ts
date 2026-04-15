import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { e2ePromptScenario, e2eTextStep, e2eToolCallStep, writeE2eControl } from "./support";
import type { SvvyE2eControl } from "../src/bun/e2e-control";

setDefaultTimeout(60_000);

const DIRECT_PROMPT =
  "Run a direct architecture pass, mention verification and workflow in passing, and keep the work direct.";
const VERIFICATION_PROMPT = "Record verification through explicit lifecycle writes.";

const LIFECYCLE_TOOL_NAME = "structured-session-state";

type LifecycleOperation =
  | "startThread"
  | "updateThread"
  | "setThreadResult"
  | "recordVerification"
  | "startWorkflow"
  | "updateWorkflow"
  | "setWaitingState";

function lifecycleToolStep(
  operation: LifecycleOperation,
  argumentsValue: Record<string, unknown>,
) {
  return e2eToolCallStep(LIFECYCLE_TOOL_NAME, {
    operation,
    ...argumentsValue,
  });
}

beforeAll(async () => {
  await ensureBuilt();
});

function controlForJourney(): SvvyE2eControl {
  return {
    prompts: {
      byText: {
        [DIRECT_PROMPT]: e2ePromptScenario({
          stream: [
            lifecycleToolStep("startThread", {
              kind: "direct",
              objective: "Run a direct architecture pass and keep the work direct.",
            }),
            e2eTextStep("Direct thread completed with structured summary.", {
              chunkDelayMs: 120,
              chunks: ["Direct thread completed ", "with structured summary."],
            }),
            lifecycleToolStep("setThreadResult", {
              kind: "analysis-summary",
              summary: "Direct thread completed with structured summary.",
              body: "The direct turn stayed direct even though the prompt mentioned verification and workflow.",
            }),
            lifecycleToolStep("updateThread", {
              status: "completed",
              blockedReason: null,
            }),
          ],
        }),
        [VERIFICATION_PROMPT]: e2ePromptScenario({
          stream: [
            e2eTextStep("Recording verification through explicit lifecycle writes.", {
              chunkDelayMs: 120,
              chunks: ["Recording verification ", "through explicit lifecycle writes."],
            }),
            lifecycleToolStep("startThread", {
              kind: "verification",
              objective: "Run verification for the current change.",
            }),
            lifecycleToolStep("recordVerification", {
              kind: "test",
              status: "failed",
              summary: "Verification failed: build is red.",
              command: "bun test",
            }),
            lifecycleToolStep("setThreadResult", {
              kind: "verification-summary",
              summary: "Verification failed: build is red.",
              body: "The verification result is durable structured state, not transcript text.",
            }),
            lifecycleToolStep("updateThread", {
              status: "failed",
              blockedReason: null,
            }),
          ],
        }),
      },
    },
  };
}

async function launchWithControl<T>(
  homeDir: string,
  control: SvvyE2eControl,
  fn: (app: SvvyApp) => Promise<T>,
): Promise<T> {
  const controlFile = await writeE2eControl(homeDir, control);
  return await withSvvyApp(
    {
      homeDir,
      env: {
        ZAI_API_KEY: "stub-key",
        SVVY_E2E_CONTROL_PATH: controlFile,
      },
    },
    fn,
  );
}

async function submitPrompt(page: SvvyApp["page"], text: string): Promise<void> {
  const textarea = page.locator('textarea[placeholder^="Ask svvy"]');
  await textarea.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

async function waitForActiveSessionStatus(
  driver: SvvyApp["driver"],
  expected: string,
  timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let lastSummary: Record<string, unknown> | undefined;

  while (Date.now() < deadline) {
    const sessionsState = (await driver.stateGet("sessions")).value as {
      activeSessionId?: string | null;
      summaries?: Array<Record<string, unknown>>;
    };
    lastSummary = sessionsState.summaries?.find(
      (summary) => summary.id === sessionsState.activeSessionId,
    );

    if (lastSummary?.status === expected) {
      return lastSummary;
    }

    await Bun.sleep(100);
  }

  throw new Error(
    `Timed out waiting for active session status "${expected}". Last summary: ${JSON.stringify(lastSummary)}`,
  );
}

function expectStructuredProjection(
  summary: Record<string, unknown>,
  expected: {
    status: string;
    waitingOn: null | { threadId: string; reason: string; resumeWhen: string };
    counts: {
      threads: number;
      results: number;
      verifications: number;
      workflows: number;
    };
  },
): void {
  expect(summary.status).toBe(expected.status);
  expect(summary.waitingOn).toEqual(expected.waitingOn);
  expect(summary.counts).toMatchObject(expected.counts);
  expect(summary.threadIdsByStatus).toEqual({
    running: expect.any(Array),
    waiting: expect.any(Array),
    failed: expect.any(Array),
  });
}

function expectRunningThreadProjection(summary: Record<string, unknown>): void {
  const buckets = summary.threadIdsByStatus as
    | { running?: unknown[]; waiting?: unknown[]; failed?: unknown[] }
    | undefined;
  expect(Array.isArray(buckets?.running)).toBe(true);
  expect((buckets?.running ?? []).length).toBeGreaterThan(0);
}

test("direct work followed by verification failure updates sidebar and bridge from structured session summaries and survives relaunch", async () => {
  const homeDir = await createHomeDir();
  try {
    const control = controlForJourney();

    await launchWithControl(homeDir, control, async ({ page, driver }) => {
      await submitPrompt(page, DIRECT_PROMPT);
      const runningSummary = await waitForActiveSessionStatus(driver, "running");
      expectStructuredProjection(runningSummary, {
        status: "running",
        waitingOn: null,
        counts: {
          threads: 1,
          results: 0,
          verifications: 0,
          workflows: 0,
        },
      });
      expectRunningThreadProjection(runningSummary);
      await page.getByText("Direct thread completed with structured summary.").waitFor({
        state: "visible",
      });
      const directSummary = await waitForActiveSessionStatus(driver, "idle");

      expectStructuredProjection(directSummary, {
        status: "idle",
        waitingOn: null,
        counts: {
          threads: 1,
          results: 1,
          verifications: 0,
          workflows: 0,
        },
      });

      await submitPrompt(page, VERIFICATION_PROMPT);
      await page.getByText("Verification failed: build is red.").waitFor({ state: "visible" });
      const failedSummary = await waitForActiveSessionStatus(driver, "error");

      expectStructuredProjection(failedSummary, {
        status: "error",
        waitingOn: null,
        counts: {
          threads: 2,
          results: 2,
          verifications: 1,
          workflows: 0,
        },
      });

      await page.locator(".session-status.status-error").waitFor({ state: "visible" });
      await page.getByText("verification failed", { exact: false }).waitFor({ state: "visible" });
    });

    await launchWithControl(homeDir, control, async ({ page, driver }) => {
      const recoveredSummary = await waitForActiveSessionStatus(driver, "error");
      expectStructuredProjection(recoveredSummary, {
        status: "error",
        waitingOn: null,
        counts: {
          threads: 2,
          results: 2,
          verifications: 1,
          workflows: 0,
        },
      });
      await page.locator(".session-status.status-error").waitFor({ state: "visible" });
    });
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});
