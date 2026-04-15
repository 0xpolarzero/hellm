import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { e2ePromptScenario, e2eTextStep, e2eToolCallStep, writeE2eControl } from "./support";
import type { SvvyE2eControl } from "../src/bun/e2e-control";

setDefaultTimeout(60_000);

const WORKFLOW_PROMPT = "Use explicit lifecycle writes to start a workflow and wait for clarification.";
const RESUME_PROMPT = "Resume the explicit workflow and finish it.";

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

function controlForWorkflowJourney(): SvvyE2eControl {
  return {
    prompts: {
      byText: {
        [WORKFLOW_PROMPT]: e2ePromptScenario({
          stream: [
            lifecycleToolStep("startThread", {
              kind: "workflow",
              objective: "Represent the delegated Smithers workflow in structured state.",
            }),
            lifecycleToolStep("startWorkflow", {
              smithersRunId: "smithers-run-001",
              workflowName: "workflow-resume-poc",
              summary: "Delegated workflow started and projected into session state.",
            }),
            lifecycleToolStep("setWaitingState", {
              kind: "user",
              reason: "Need clarification about rollout ownership.",
              resumeWhen: "Resume when the user answers the workflow ownership question.",
            }),
            e2eTextStep(
              "Workflow delegated. Waiting for clarification about rollout ownership.",
              {
                chunkDelayMs: 120,
                chunks: [
                  "Workflow delegated. Waiting for ",
                  "clarification about rollout ownership.",
                ],
              },
            ),
          ],
        }),
        [RESUME_PROMPT]: e2ePromptScenario({
          stream: [
            lifecycleToolStep("updateWorkflow", {
              status: "completed",
              summary: "Workflow resumed and completed after clarification.",
            }),
            lifecycleToolStep("setThreadResult", {
              kind: "workflow-summary",
              summary: "Workflow resumed and completed after clarification.",
              body: "The delegated workflow completed after clarification.",
            }),
            lifecycleToolStep("updateThread", {
              status: "completed",
              blockedReason: null,
            }),
            e2eTextStep("Workflow resumed and completed after clarification."),
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

async function waitForActiveSessionSummary(
  driver: SvvyApp["driver"],
  predicate: (summary: Record<string, unknown>) => boolean,
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
    if (lastSummary && predicate(lastSummary)) {
      return lastSummary;
    }
    await Bun.sleep(100);
  }

  throw new Error(
    `Timed out waiting for structured workflow summary predicate. Last summary: ${JSON.stringify(lastSummary)}`,
  );
}

function expectWaitingProjection(summary: Record<string, unknown>): void {
  expect(summary.status).toBe("waiting");
  expect(summary.waitingOn).toEqual({
    threadId: expect.any(String),
    reason: expect.stringContaining("clarification"),
    resumeWhen: expect.stringContaining("Resume"),
    since: expect.any(String),
  });
  expect(summary.counts).toMatchObject({
    threads: 1,
    results: 0,
    workflows: 1,
  });
  expect(summary.preview).toEqual(expect.stringContaining("clarification"));
  expect(summary.threadIdsByStatus).toEqual({
    running: [],
    waiting: [expect.any(String)],
    failed: [],
  });
}

function expectCompletedWorkflowProjection(summary: Record<string, unknown>): void {
  expect(summary.status).toBe("idle");
  expect(summary.waitingOn).toBeNull();
  expect(summary.counts).toMatchObject({
    threads: 1,
    results: 1,
    workflows: 1,
  });
  expect(summary.preview).toContain("Workflow resumed and completed after clarification.");
  expect(summary.threadIdsByStatus).toEqual({
    running: [],
    waiting: [],
    failed: [],
  });
}

test("delegated workflow projection enters waiting, survives relaunch, then resumes from durable state", async () => {
  const homeDir = await createHomeDir();
  try {
    const control = controlForWorkflowJourney();

    await launchWithControl(homeDir, control, async ({ page, driver }) => {
      await submitPrompt(page, WORKFLOW_PROMPT);
      await waitForActiveSessionSummary(driver, (summary) => summary.status === "running");
      await page
        .getByText("Workflow delegated. Waiting for clarification about rollout ownership.")
        .waitFor({ state: "visible" });

      const waitingSummary = await waitForActiveSessionSummary(
        driver,
        (summary) => summary.status === "waiting",
      );
      expectWaitingProjection(waitingSummary);
      await page.getByText("Waiting", { exact: false }).waitFor({ state: "visible" });
    });

    await launchWithControl(homeDir, control, async ({ page, driver }) => {
      const recoveredWaiting = await waitForActiveSessionSummary(
        driver,
        (summary) => summary.status === "waiting",
      );
      expectWaitingProjection(recoveredWaiting);
      await page.getByText("Waiting", { exact: false }).waitFor({ state: "visible" });

      await submitPrompt(page, RESUME_PROMPT);
      await page.getByText("Workflow resumed and completed after clarification.").waitFor({
        state: "visible",
      });

      const resumedSummary = await waitForActiveSessionSummary(
        driver,
        (summary) => summary.status === "idle",
      );
      expectCompletedWorkflowProjection(resumedSummary);
    });

    await launchWithControl(homeDir, control, async ({ driver }) => {
      const recoveredCompleted = await waitForActiveSessionSummary(
        driver,
        (summary) => summary.status === "idle",
      );
      expectCompletedWorkflowProjection(recoveredCompleted);
    });
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
});
