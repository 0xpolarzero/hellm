import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Page } from "electrobun-browser-tools";
import { createStructuredSessionStateStore } from "../src/bun/structured-session-state";
import { createHomeDir, ensureBuilt, withSvvyApp } from "./harness";
import { assistantTextMessage, getTestSessionDir, seedSessions, userMessage } from "./support";

setDefaultTimeout(120_000);

const TIMESTAMP = Date.parse("2026-04-24T12:00:00.000Z");
const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v5.sqlite";
const PROJECT_CI_ENTRY_PATH = ".svvy/workflows/entries/ci/project-ci.tsx";
const PROJECT_CI_WORKFLOW_ID = "project_ci";

type ProjectCiSeedState =
  | "not-configured"
  | "configured"
  | "running"
  | "passed"
  | "failed"
  | "blocked"
  | "cancelled";

interface ProjectCiStateFixture {
  expectedDetails: string[];
  expectedLabels: string[];
  hasConfiguredEntry: boolean;
  summary: string;
}

const PROJECT_CI_STATE_FIXTURES: Record<ProjectCiSeedState, ProjectCiStateFixture> = {
  "not-configured": {
    expectedDetails: [
      "No Project CI entry has been configured.",
      "Ask svvy to configure Project CI.",
    ],
    expectedLabels: ["Not configured"],
    hasConfiguredEntry: false,
    summary: "No Project CI entry has been configured.",
  },
  configured: {
    expectedDetails: [PROJECT_CI_WORKFLOW_ID, PROJECT_CI_ENTRY_PATH, "Ready to run Project CI."],
    expectedLabels: ["Configured"],
    hasConfiguredEntry: true,
    summary: "Ready to run Project CI.",
  },
  running: {
    expectedDetails: [PROJECT_CI_WORKFLOW_ID, PROJECT_CI_ENTRY_PATH, "Project CI is running."],
    expectedLabels: ["Running"],
    hasConfiguredEntry: true,
    summary: "Project CI is running.",
  },
  passed: {
    expectedDetails: ["Typecheck", "bun run typecheck", "Typecheck passed.", "Project CI passed."],
    expectedLabels: ["Passed"],
    hasConfiguredEntry: true,
    summary: "Project CI passed.",
  },
  failed: {
    expectedDetails: ["Unit Tests", "bun test", "Unit tests failed.", "Project CI failed."],
    expectedLabels: ["Failed"],
    hasConfiguredEntry: true,
    summary: "Project CI failed.",
  },
  blocked: {
    expectedDetails: [
      "Required Secret",
      "CI requires TEST_DATABASE_URL.",
      "Project CI is blocked.",
    ],
    expectedLabels: ["Blocked"],
    hasConfiguredEntry: true,
    summary: "Project CI is blocked.",
  },
  cancelled: {
    expectedDetails: [
      "Build",
      "bun run build",
      "Build was cancelled.",
      "Project CI was cancelled.",
    ],
    expectedLabels: ["Cancelled"],
    hasConfiguredEntry: true,
    summary: "Project CI was cancelled.",
  },
};

beforeAll(async () => {
  await ensureBuilt();
});

function isTransientBridgeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.toLowerCase().includes("bridge request timed out") ||
      error.message.includes("Resolved element is disabled"))
  );
}

async function waitForVisible(
  locator: {
    isVisible(): Promise<boolean>;
  },
  timeoutMs = 60_000,
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

async function clickWhenReady(
  locator: {
    click(options?: { force?: boolean }): Promise<void>;
    isDisabled?: () => Promise<boolean>;
    getAttribute?: (name: string) => Promise<string | null>;
  },
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const disabled =
        typeof locator.isDisabled === "function"
          ? await locator.isDisabled()
          : typeof locator.getAttribute === "function"
            ? (await locator.getAttribute("disabled")) !== null
            : false;
      if (!disabled) {
        await locator.click({ force: true });
        return;
      }
    } catch (error) {
      if (!isTransientBridgeError(error)) {
        throw error;
      }
    }
    await Bun.sleep(100);
  }

  throw new Error("Timed out clicking Project CI lane action.");
}

async function withPersistentHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir("svvy-project-ci-e2e-home-");
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function withIsolatedTempWorkspace<T>(
  fn: (context: { homeDir: string; workspaceDir: string }) => Promise<T>,
): Promise<T> {
  return await withPersistentHome(async (homeDir) => {
    const workspaceDir = await mkdtemp(join(tmpdir(), "svvy-project-ci-e2e-workspace-"));
    try {
      await writeFile(
        join(workspaceDir, "package.json"),
        `${JSON.stringify({ name: "project-ci-e2e" }, null, 2)}\n`,
      );
      return await fn({ homeDir, workspaceDir });
    } finally {
      await rm(workspaceDir, { force: true, recursive: true });
    }
  });
}

async function seedProjectCiEntry(workspaceDir: string): Promise<void> {
  const absoluteEntryPath = join(workspaceDir, PROJECT_CI_ENTRY_PATH);
  await mkdir(dirname(absoluteEntryPath), { recursive: true });
  await writeFile(
    absoluteEntryPath,
    [
      'import { z } from "zod";',
      "",
      `export const workflowId = "${PROJECT_CI_WORKFLOW_ID}";`,
      'export const productKind = "project-ci" as const;',
      'export const label = "Project CI";',
      'export const summary = "Runs the repository Project CI checks.";',
      'export const launchSchema = z.object({ scope: z.enum(["fast", "full"]).default("fast") });',
      "export const resultSchema = z.object({",
      '  status: z.enum(["passed", "failed", "cancelled", "blocked"]),',
      "  summary: z.string().min(1),",
      "  checks: z.array(z.object({",
      "    checkId: z.string().min(1),",
      "    label: z.string().min(1),",
      "    kind: z.string().min(1),",
      '    status: z.enum(["passed", "failed", "cancelled", "skipped", "blocked"]),',
      "    required: z.boolean().default(true),",
      "    command: z.array(z.string()).optional(),",
      "    exitCode: z.number().int().nullable().optional(),",
      "    summary: z.string().min(1),",
      "    artifactIds: z.array(z.string()).default([]),",
      "  })),",
      "});",
      "export const definitionPaths = [] as const;",
      "export const promptPaths = [] as const;",
      "export const componentPaths = [] as const;",
      "export function createRunnableEntry() {",
      "  return {",
      "    workflowId,",
      '    workflowSource: "saved" as const,',
      "    productKind,",
      "    launchSchema,",
      "    resultSchema,",
      "    workflow: {} as any,",
      "  };",
      "}",
    ].join("\n") + "\n",
  );
}

async function seedProjectCiState(input: {
  homeDir: string;
  state: ProjectCiSeedState;
  workspaceDir: string;
  sessionId: string;
  title: string;
}): Promise<void> {
  if (PROJECT_CI_STATE_FIXTURES[input.state].hasConfiguredEntry) {
    await seedProjectCiEntry(input.workspaceDir);
  }

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

    if (input.state === "not-configured" || input.state === "configured") {
      const summary = PROJECT_CI_STATE_FIXTURES[input.state].summary;
      store.finishCommand({
        commandId: runCommand.id,
        status: input.state === "configured" ? "succeeded" : "failed",
        summary,
      });
      store.updateThread({
        threadId: handlerThread.id,
        status: input.state === "configured" ? "completed" : "troubleshooting",
      });
      store.finishTurn({
        turnId: turn.id,
        status: input.state === "configured" ? "completed" : "failed",
      });
      return;
    }

    const workflowStatusByState = {
      blocked: "completed",
      cancelled: "cancelled",
      failed: "failed",
      passed: "completed",
      running: "running",
    } as const;
    const smithersStatusByState = {
      blocked: "finished",
      cancelled: "cancelled",
      failed: "failed",
      passed: "finished",
      running: "running",
    } as const;
    const workflowRun = store.recordWorkflow({
      threadId: handlerThread.id,
      commandId: runCommand.id,
      smithersRunId: `smithers-project-ci-e2e-${input.state}`,
      workflowName: PROJECT_CI_WORKFLOW_ID,
      workflowSource: "saved",
      entryPath: PROJECT_CI_ENTRY_PATH,
      savedEntryId: PROJECT_CI_WORKFLOW_ID,
      status: workflowStatusByState[input.state],
      smithersStatus: smithersStatusByState[input.state],
      summary: PROJECT_CI_STATE_FIXTURES[input.state].summary,
    });

    if (input.state === "running") {
      store.updateThread({
        threadId: handlerThread.id,
        status: "running-workflow",
      });
      return;
    }

    const checkByState = {
      blocked: {
        checkId: "required-secret",
        label: "Required Secret",
        kind: "manual",
        status: "blocked",
        required: true,
        command: null,
        exitCode: null,
        summary: "CI requires TEST_DATABASE_URL.",
      },
      cancelled: {
        checkId: "build",
        label: "Build",
        kind: "build",
        status: "cancelled",
        required: true,
        command: ["bun", "run", "build"],
        exitCode: null,
        summary: "Build was cancelled.",
      },
      failed: {
        checkId: "unit-tests",
        label: "Unit Tests",
        kind: "test",
        status: "failed",
        required: true,
        command: ["bun", "test"],
        exitCode: 1,
        summary: "Unit tests failed.",
      },
      passed: {
        checkId: "typecheck",
        label: "Typecheck",
        kind: "typecheck",
        status: "passed",
        required: true,
        command: ["bun", "run", "typecheck"],
        exitCode: 0,
        summary: "Typecheck passed.",
      },
    } as const;
    const ciStatus = input.state;
    store.recordProjectCiResult({
      workflowRunId: workflowRun.id,
      workflowId: PROJECT_CI_WORKFLOW_ID,
      entryPath: PROJECT_CI_ENTRY_PATH,
      status: ciStatus,
      summary: PROJECT_CI_STATE_FIXTURES[input.state].summary,
      checks: [checkByState[input.state]],
    });
    const commandStatusByState = {
      blocked: "failed",
      cancelled: "cancelled",
      failed: "failed",
      passed: "succeeded",
    } as const;
    store.finishCommand({
      commandId: runCommand.id,
      status: commandStatusByState[input.state],
      summary: PROJECT_CI_STATE_FIXTURES[input.state].summary,
    });
    store.updateThread({
      threadId: handlerThread.id,
      status:
        input.state === "failed" || input.state === "blocked" ? "troubleshooting" : "completed",
    });
    store.finishTurn({
      turnId: turn.id,
      status: input.state === "failed" || input.state === "blocked" ? "failed" : "completed",
    });
  } finally {
    store.close();
  }
}

async function seedProjectCiTestSession(input: {
  homeDir: string;
  workspaceDir: string;
  title: string;
}): Promise<string> {
  const seededSessions = await seedSessions(
    input.homeDir,
    [
      {
        title: input.title,
        messages: [
          userMessage("Run Project CI.", TIMESTAMP),
          assistantTextMessage("Project CI is available.", {
            timestamp: TIMESTAMP + 1,
          }),
        ],
      },
    ],
    input.workspaceDir,
  );
  const primarySession = seededSessions[0];
  if (!primarySession) {
    throw new Error("Expected one seeded session for Project CI e2e.");
  }
  return primarySession.id;
}

async function expectProjectCiRegion(input: {
  page: Page;
  state: ProjectCiSeedState;
}): Promise<void> {
  const region = input.page.locator(".project-ci-panel");
  await waitForVisible(region);
  const regionText = (await region.textContent()) ?? "";
  const fixture = PROJECT_CI_STATE_FIXTURES[input.state];

  expect(regionText).toContain("Project CI");
  for (const label of fixture.expectedLabels) {
    expect(regionText).toContain(label);
  }
  for (const detail of fixture.expectedDetails) {
    expect(regionText).toContain(detail);
  }
}

test("renders typed Project CI context and persisted CI results after app boot", async () => {
  await withIsolatedTempWorkspace(async ({ homeDir, workspaceDir }) => {
    const sessionId = await seedProjectCiTestSession({
      homeDir,
      workspaceDir,
      title: "Project CI E2E",
    });

    await withSvvyApp(
      {
        homeDir,
        workspaceDir,
        env: {
          ZAI_API_KEY: "stub-key",
        },
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir: launchWorkspaceDir }) => {
          await seedProjectCiState({
            homeDir: launchHomeDir,
            state: "passed",
            workspaceDir: launchWorkspaceDir,
            sessionId,
            title: "Project CI E2E",
          });
        },
      },
      async ({ page }) => {
        await waitForVisible(page.getByText("Project CI E2E"));
        await waitForVisible(page.getByText("CI 1"));
        await waitForVisible(page.getByText("Delegated Threads"));
        await expectProjectCiRegion({ page, state: "passed" });

        const threadCard = page.locator(".handler-thread-reference-entry").first();
        await waitForVisible(threadCard);
        const cardText = (await threadCard.textContent()) ?? "";
        expect(cardText).toContain("Project CI Handler");
        expect(cardText).toContain("Done");
        expect(cardText).toContain("Project CI passed.");
        expect(cardText).toContain("1 workflow");
        expect(cardText).toContain("1 CI run");
        expect(cardText).toContain("Context ci");

        await clickWhenReady(page.locator(".handler-thread-actions button").first());

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

for (const state of [
  "not-configured",
  "configured",
  "running",
  "failed",
  "blocked",
  "cancelled",
] as const satisfies readonly ProjectCiSeedState[]) {
  test(`renders future Project CI panel ${state} state`, async () => {
    await withIsolatedTempWorkspace(async ({ homeDir, workspaceDir }) => {
      const sessionId = await seedProjectCiTestSession({
        homeDir,
        workspaceDir,
        title: `Project CI ${state}`,
      });

      await withSvvyApp(
        {
          homeDir,
          workspaceDir,
          env: {
            ZAI_API_KEY: "stub-key",
          },
          beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir: launchWorkspaceDir }) => {
            await seedProjectCiState({
              homeDir: launchHomeDir,
              state,
              workspaceDir: launchWorkspaceDir,
              sessionId,
              title: `Project CI ${state}`,
            });
          },
        },
        async ({ page }) => {
          await waitForVisible(page.getByText(`Project CI ${state}`));
          await expectProjectCiRegion({ page, state });
        },
      );
    });
  });
}
