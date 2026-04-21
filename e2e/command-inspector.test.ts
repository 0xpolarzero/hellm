import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { createStructuredSessionStateStore } from "../src/bun/structured-session-state";
import { createHomeDir, ensureBuilt, withSvvyApp, type SvvyApp } from "./harness";
import {
  assistantTextMessage,
  getTestSessionDir,
  seedSessions,
  type SeedSessionInput,
  userMessage,
} from "./support";

setDefaultTimeout(120_000);

const TIMESTAMP = Date.parse("2026-04-10T12:00:00.000Z");
const STRUCTURED_SESSION_DB_FILENAME = "structured-session-state-v2.sqlite";

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
  timeoutMs = 15_000,
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

  throw new Error("Timed out waiting for inspector content.");
}

async function withPersistentHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function seedStructuredCommandInspector(input: {
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
      updatedAt: new Date(TIMESTAMP + 10).toISOString(),
    });

    const turn = store.startTurn({
      sessionId: input.sessionId,
      surfacePiSessionId: input.sessionId,
      requestSummary: "Inspect structured execute_typescript rollups",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: input.sessionId,
      title: "Inspect execute_typescript",
      objective: "Inspect the execute_typescript parent rollup and child details.",
    });
    const parentCommand = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      toolName: "execute_typescript",
      executor: "orchestrator",
      visibility: "summary",
      title: "Inspect execute_typescript",
      summary: "Read 1 file and created 1 artifact.",
      facts: {
        repoReads: 1,
        artifactsCreated: 1,
      },
    });
    store.startCommand(parentCommand.id);

    const traceChild = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      parentCommandId: parentCommand.id,
      toolName: "repo.readFile",
      executor: "execute_typescript",
      visibility: "trace",
      title: "Read docs/prd.md",
      summary: "Loaded docs/prd.md.",
      facts: {
        path: "docs/prd.md",
        bytesRead: 1024,
      },
    });
    store.finishCommand({
      commandId: traceChild.id,
      status: "succeeded",
      summary: "Loaded docs/prd.md.",
      facts: {
        path: "docs/prd.md",
        bytesRead: 1024,
      },
    });

    const summaryChild = store.createCommand({
      turnId: turn.id,
      threadId: thread.id,
      parentCommandId: parentCommand.id,
      toolName: "artifact.writeText",
      executor: "execute_typescript",
      visibility: "summary",
      title: "Create summary.md",
      summary: "Created summary.md.",
      facts: {
        name: "summary.md",
      },
    });
    store.finishCommand({
      commandId: summaryChild.id,
      status: "succeeded",
      summary: "Created summary.md.",
      facts: {
        name: "summary.md",
      },
    });

    store.createArtifact({
      threadId: thread.id,
      sourceCommandId: parentCommand.id,
      kind: "text",
      name: "execute-typescript.ts",
      content: 'const doc = await api.repo.readFile({ path: "docs/prd.md" });',
    });
    store.createArtifact({
      threadId: thread.id,
      sourceCommandId: summaryChild.id,
      kind: "file",
      name: "summary.md",
      content: "# Summary",
    });

    store.finishCommand({
      commandId: parentCommand.id,
      status: "succeeded",
      summary: "Read 1 file and created 1 artifact.",
      facts: {
        repoReads: 1,
        artifactsCreated: 1,
      },
    });
    store.updateThread({
      threadId: thread.id,
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

async function launchSeededApp<T>(
  input: {
    homeDir: string;
    sessions: SeedSessionInput[];
    seed?: boolean;
  },
  fn: (app: SvvyApp) => Promise<T>,
): Promise<T> {
  return await withSvvyApp(
    {
      homeDir: input.homeDir,
      env: {
        ZAI_API_KEY: "stub-key",
      },
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        if (input.seed === false) {
          return;
        }

        const seededSessions = await seedSessions(homeDir, input.sessions, workspaceDir);
        const primarySession = seededSessions[0];
        if (!primarySession) {
          throw new Error("Expected one seeded session for the command inspector test.");
        }

        await seedStructuredCommandInspector({
          homeDir,
          workspaceDir,
          sessionId: primarySession.id,
          title: input.sessions[0]?.title ?? "Command Inspector Session",
        });
      },
    },
    fn,
  );
}

async function assertCommandInspectorSurface(page: SvvyApp["page"]): Promise<void> {
  await waitForVisible(page.locator(".structured-command-panel"));
  await waitForVisible(page.getByText("Command History"));
  await waitForVisible(page.getByText("Read 1 file and created 1 artifact."));
  await waitForVisible(page.getByText("Created summary.md."));

  const rollupCard = page.locator(".structured-command-card").first();
  const rollupText = (await rollupCard.textContent()) ?? "";
  expect(rollupText).not.toContain("Loaded docs/prd.md.");

  await rollupCard.click({ force: true });
  const dialog = page.getByRole("dialog", { name: "Inspect execute_typescript" });
  await waitForVisible(dialog);
  expect((await dialog.textContent()) ?? "").toContain("Loaded docs/prd.md.");
  expect((await dialog.textContent()) ?? "").toContain("Created summary.md.");
  expect((await dialog.textContent()) ?? "").toContain("execute-typescript.ts");
  expect((await dialog.textContent()) ?? "").toContain("summary.md");

  await page.locator(".ui-dialog-close").click({ force: true });
  await dialog.waitFor({ state: "hidden" });
}

test("renders parent command rollups and opens nested child detail after reload", async () => {
  await withPersistentHome(async (homeDir) => {
    const sessions: SeedSessionInput[] = [
      {
        title: "Command Inspector Session",
        messages: [
          userMessage("Inspect the repo", TIMESTAMP),
          assistantTextMessage("Structured command state is available.", {
            timestamp: TIMESTAMP + 1,
          }),
        ],
      },
    ];

    await launchSeededApp(
      {
        homeDir,
        sessions,
      },
      async ({ page }) => {
        await waitForVisible(page.getByText("Structured command state is available."));
        await assertCommandInspectorSurface(page);
      },
    );

    await launchSeededApp(
      {
        homeDir,
        sessions,
        seed: false,
      },
      async ({ page }) => {
        await waitForVisible(page.getByText("Structured command state is available."));
        await assertCommandInspectorSurface(page);
      },
    );
  });
});
