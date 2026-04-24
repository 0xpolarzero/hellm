import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { createStructuredSessionStateStore } from "../src/bun/structured-session-state";
import { createHomeDir, ensureBuilt, withSvvyApp } from "./harness";
import { assistantTextMessage, getTestSessionDir, seedSessions, userMessage } from "./support";

setDefaultTimeout(120_000);

const TIMESTAMP = Date.parse("2026-04-24T12:00:00.000Z");
const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v5.sqlite";

beforeAll(async () => {
  await ensureBuilt();
});

function isTransientBridgeError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("bridge request timed out");
}

async function waitForVisible(
  locator: {
    isVisible(): Promise<boolean>;
  },
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      if (await locator.isVisible()) {
        return;
      }
    } catch (error) {
      if (!isTransientBridgeError(error)) {
        throw error;
      }
    }

    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for Project CI lane UI.");
}

async function withPersistentHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir("svvy-project-ci-e2e-home-");
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function seedProjectCiState(input: {
  homeDir: string;
  workspaceDir: string;
  sessionId: string;
  title: string;
}): Promise<void> {
  const sessionDir = getTestSessionDir(input.homeDir, input.workspaceDir);
  const store = createStructuredSessionStateStore({
    databasePath: join(sessionDir, STRUCTURED_SESSION_DB_FILENAME),
    workspace: {
      id: input.workspaceDir,
      label: basename(input.workspaceDir),
      cwd: input.workspaceDir,
    },
  });

  try {
    store.upsertPiSession({
      sessionId: input.sessionId,
      title: input.title,
      provider: "openai",
      model: "gpt-4o",
      reasoningEffort: "medium",
      messageCount: 2,
      status: "idle",
      createdAt: new Date(TIMESTAMP).toISOString(),
      updatedAt: new Date(TIMESTAMP + 10_000).toISOString(),
    });

    const turn = store.startTurn({
      sessionId: input.sessionId,
      surfacePiSessionId: input.sessionId,
      requestSummary: "Open Project CI handler",
    });
    const orchestratorThread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: input.sessionId,
      title: "Open Project CI handler",
      objective: "Delegate Project CI execution.",
    });
    const preloadCommand = store.createCommand({
      turnId: turn.id,
      threadId: orchestratorThread.id,
      toolName: "thread.start",
      executor: "orchestrator",
      visibility: "surface",
      title: "Start Project CI handler",
      summary: "Open a normal handler thread with CI context loaded.",
    });
    store.startCommand(preloadCommand.id);

    const handlerThread = store.createThread({
      turnId: turn.id,
      parentThreadId: orchestratorThread.id,
      surfacePiSessionId: "pi-thread-project-ci-e2e",
      title: "Project CI Handler",
      objective: "Run the declared Project CI workflow and report the result.",
    });
    store.loadThreadContext({
      threadId: handlerThread.id,
      contextKey: "ci",
      contextVersion: "2026-04-24",
      loadedByCommandId: preloadCommand.id,
    });
    store.finishCommand({
      commandId: preloadCommand.id,
      status: "succeeded",
      summary: "Opened Project CI Handler with CI context.",
    });

    const runCommand = store.createCommand({
      turnId: turn.id,
      threadId: handlerThread.id,
      toolName: "smithers.run_workflow",
      executor: "smithers",
      visibility: "surface",
      title: "Run Project CI",
      summary: "Launch the declared Project CI workflow.",
    });
    store.startCommand(runCommand.id);
    const workflowRun = store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: runCommand.id,
      smithersRunId: "smithers-project-ci-e2e",
      workflowName: "project_ci",
      workflowSource: "saved",
      entryPath: ".svvy/workflows/entries/ci/project-ci.tsx",
      savedEntryId: "project_ci",
      status: "completed",
      smithersStatus: "finished",
      summary: "Project CI passed.",
    });
    store.recordProjectCiResult({
      workflowRunId: workflowRun.id,
      workflowId: "project_ci",
      entryPath: ".svvy/workflows/entries/ci/project-ci.tsx",
      status: "passed",
      summary: "Project CI passed.",
      checks: [
        {
          checkId: "typecheck",
          label: "Typecheck",
          kind: "typecheck",
          status: "passed",
          required: true,
          command: ["bun", "run", "typecheck"],
          exitCode: 0,
          summary: "Typecheck passed.",
        },
      ],
    });
    store.finishCommand({
      commandId: runCommand.id,
      status: "succeeded",
      summary: "Project CI passed.",
    });
    store.updateThread({
      threadId: handlerThread.id,
      status: "completed",
    });
    store.finishTurn({
      turnId: turn.id,
      status: "completed",
    });
  } finally {
    store.close();
  }
}

test("renders typed Project CI context and persisted CI results after app boot", async () => {
  await withPersistentHome(async (homeDir) => {
    const seededSessions = await seedSessions(homeDir, [
      {
        title: "Project CI E2E",
        messages: [
          userMessage("Run Project CI.", TIMESTAMP),
          assistantTextMessage("Project CI is available.", {
            timestamp: TIMESTAMP + 1,
          }),
        ],
      },
    ]);
    const primarySession = seededSessions[0];
    if (!primarySession) {
      throw new Error("Expected one seeded session for Project CI e2e.");
    }

    await withSvvyApp(
      {
        homeDir,
        env: {
          ZAI_API_KEY: "stub-key",
        },
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          await seedProjectCiState({
            homeDir: launchHomeDir,
            workspaceDir,
            sessionId: primarySession.id,
            title: "Project CI E2E",
          });
        },
      },
      async ({ page }) => {
        await waitForVisible(page.getByText("Project CI E2E"));
        await waitForVisible(page.getByText("CI 1"));
        await waitForVisible(page.getByText("Delegated Threads"));

        const threadCard = page.locator(".handler-thread-card").filter({
          has: page.getByText("Project CI Handler", { exact: true }),
        });
        await waitForVisible(threadCard);
        const cardText = (await threadCard.textContent()) ?? "";
        expect(cardText).toContain("Completed");
        expect(cardText).toContain("Project CI passed.");
        expect(cardText).toContain("1 workflow");
        expect(cardText).toContain("1 CI run");
        expect(cardText).toContain("Context ci");

        await threadCard.getByRole("button", { name: "Inspect" }).click({ force: true });

        const inspector = page.getByRole("dialog", { name: "Project CI Handler" });
        await waitForVisible(inspector);
        const inspectorText = (await inspector.textContent()) ?? "";
        expect(inspectorText).toContain("1 workflow");
        expect(inspectorText).toContain("1 CI run");
        expect(inspectorText).toContain("Context ci");
        expect(inspectorText).toContain("Workflow Runs");
        expect(inspectorText).toContain("project_ci");
        expect(inspectorText).toContain("Project CI passed.");
      },
    );
  });
});
