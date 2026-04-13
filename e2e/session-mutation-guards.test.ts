import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import type { HellmE2eControl } from "../src/bun/e2e-control";
import { ensureBuilt, createHomeDir, withHellmApp, type HellmApp } from "./harness";
import {
  assistantTextMessage,
  seedProviderApiKeys,
  seedSessions,
  type SeedSessionInput,
  userMessage,
  writeE2eControl,
} from "./support";

setDefaultTimeout(60_000);

const TIMELINE = Date.parse("2026-04-10T10:00:00.000Z");

const FAILURE_MESSAGES = {
  createSession: "Create session mutation failed in E2E.",
  openSession: "Open session mutation failed in E2E.",
  renameSession: "Rename session mutation failed in E2E.",
  forkSession: "Fork session mutation failed in E2E.",
  deleteSession: "Delete session mutation failed in E2E.",
} as const;

beforeAll(async () => {
  await ensureBuilt();
});

type FixtureOptions = {
  auth?: Record<string, string>;
  control?: HellmE2eControl;
  sessions: SeedSessionInput[];
};

async function withFixture<T>(
  options: FixtureOptions,
  fn: (app: HellmApp) => Promise<T>,
): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    const env: Record<string, string> = {};
    if (options.control) {
      env.HELLM_E2E_CONTROL_PATH = await writeE2eControl(homeDir, options.control);
    }

    return await withHellmApp(
      {
        homeDir,
        env: Object.keys(env).length > 0 ? env : undefined,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          if (options.auth) {
            await seedProviderApiKeys(launchHomeDir, options.auth);
          }
          if (options.sessions.length > 0) {
            await seedSessions(launchHomeDir, options.sessions, workspaceDir);
          }
        },
      },
      fn,
    );
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function withSessions<T>(
  sessions: SeedSessionInput[],
  fn: (app: HellmApp) => Promise<T>,
): Promise<T> {
  return await withFixture({ sessions }, fn);
}

async function readSessionTitles(page: HellmApp["page"]): Promise<string[]> {
  const titles: string[] = [];
  const titleLocator = page.locator(".sidebar-list .session-item .session-main strong");
  const count = await titleLocator.count();
  for (let index = 0; index < count; index += 1) {
    const title = await titleLocator.nth(index).textContent();
    titles.push(title?.trim() ?? "");
  }
  return titles;
}

function sessionItemByTitle(page: HellmApp["page"], title: string) {
  return page.locator(".session-item").filter({
    has: page.locator(".session-main strong").filter({ hasText: title }),
  }).first();
}

async function openSessionActions(page: HellmApp["page"], title: string): Promise<void> {
  const trigger = sessionItemByTitle(page, title)
    .getByRole("button", { name: `Session actions for ${title}` })
    .first();
  await trigger.waitFor({ state: "visible" });
  await trigger.click({ force: true });
}

function sessionMainByTitle(page: HellmApp["page"], title: string) {
  return sessionItemByTitle(page, title).locator(".session-main").first();
}

async function clickSessionByTitle(page: HellmApp["page"], title: string): Promise<void> {
  const sessionButton = sessionMainByTitle(page, title);
  await sessionButton.waitFor({ state: "visible" });
  await sessionButton.click({ force: true });
}

async function clickSessionByIndex(page: HellmApp["page"], index: number): Promise<void> {
  const sessionButton = page.locator(".session-item").nth(index).locator(".session-main");
  await sessionButton.waitFor({ state: "visible" });
  await sessionButton.click({ force: true });
}

async function openRenameDialog(page: HellmApp["page"], title: string): Promise<void> {
  await openSessionActions(page, title);
  await page.locator(".session-menu").getByRole("button", { name: "Rename" }).click({ force: true });
  await page.getByRole("dialog", { name: "Rename Session" }).waitFor({ state: "visible" });
}

async function openDeleteDialog(page: HellmApp["page"], title: string): Promise<void> {
  await openSessionActions(page, title);
  await page.locator(".session-menu").getByRole("button", { name: "Delete" }).click({ force: true });
  await page.getByRole("dialog", { name: "Delete Session" }).waitFor({ state: "visible" });
}

async function waitForText(
  locator: {
    textContent(): Promise<string | null>;
  },
  expected: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = (await locator.textContent())?.trim() ?? "";
    if (lastText === expected) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for text "${expected}". Last text was "${lastText}".`);
}

async function waitForSessionCount(
  page: HellmApp["page"],
  expectedCount: number,
  timeoutMs = 15_000,
): Promise<void> {
  const context = page.locator(".sidebar-context");
  const expectedLabel = `${expectedCount} sessions`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = (await context.textContent())?.trim() ?? "";
    if (text.includes(expectedLabel)) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for sidebar count "${expectedLabel}".`);
}

async function waitForLocatorCount(
  locator: {
    count(): Promise<number>;
  },
  expectedCount: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if ((await locator.count()) === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for locator count ${expectedCount}.`);
}

async function expectMainTitle(page: HellmApp["page"], expected: string): Promise<void> {
  const title = page.locator(".workspace-main-title");
  await waitForText(title, expected);
  expect((await title.textContent())?.trim()).toBe(expected);
}

async function expectActiveSessionTitle(page: HellmApp["page"], expected: string): Promise<void> {
  const activeTitle = page.locator('.session-main[aria-current="true"] strong');
  await waitForText(activeTitle, expected);
  expect((await activeTitle.textContent())?.trim()).toBe(expected);
}

async function expectSidebarError(page: HellmApp["page"], expected: string): Promise<void> {
  const error = page.locator(".sidebar-error");
  await waitForText(error, expected);
  expect((await error.textContent())?.trim()).toBe(expected);
}

async function expectDisabled(
  locator: ReturnType<HellmApp["page"]["locator"]>,
  expected: boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastValue = false;

  while (Date.now() < deadline) {
    const snapshot = await locator.resolve();
    lastValue = Boolean(snapshot.first?.disabled);
    if (lastValue === expected) {
      return;
    }
    await Bun.sleep(50);
  }

  expect(lastValue).toBe(expected);
}

async function launchMutationScenario<T>(
  options: FixtureOptions,
  fn: (app: HellmApp) => Promise<T>,
): Promise<T> {
  return await withFixture(options, fn);
}

test("surfaces create-session errors in the sidebar banner", async () => {
  await launchMutationScenario(
    {
      sessions: [
        {
          key: "existing",
          title: "Existing Session",
          messages: [
            userMessage("Existing prompt", TIMELINE + 100),
            assistantTextMessage("Existing reply", { timestamp: TIMELINE + 101 }),
          ],
        },
      ],
      control: {
        mutations: {
          createSession: { error: FAILURE_MESSAGES.createSession },
        },
      },
    },
    async ({ page }) => {
      await waitForSessionCount(page, 1);
      await page.getByRole("button", { name: "Create a new session" }).click({ force: true });

      await expectSidebarError(page, FAILURE_MESSAGES.createSession);
      await expectMainTitle(page, "Existing Session");
      await expectActiveSessionTitle(page, "Existing Session");
      expect(await readSessionTitles(page)).toEqual(["Existing Session"]);
    },
  );
});

test("surfaces open-session errors in the sidebar banner", async () => {
  await launchMutationScenario(
    {
      sessions: [
        {
          key: "primary",
          title: "Primary Session",
          messages: [
            userMessage("Primary prompt", TIMELINE + 100),
            assistantTextMessage("Primary reply", { timestamp: TIMELINE + 101 }),
          ],
        },
        {
          key: "secondary",
          title: "Secondary Session",
          messages: [
            userMessage("Secondary prompt", TIMELINE + 200),
            assistantTextMessage("Secondary reply", { timestamp: TIMELINE + 201 }),
          ],
        },
      ],
      control: {},
    },
    async ({ page, homeDir }) => {
      await expectMainTitle(page, "Secondary Session");
      await waitForSessionCount(page, 2);
      await writeE2eControl(homeDir, {
        mutations: {
          openSession: { error: FAILURE_MESSAGES.openSession },
        },
      });
      await clickSessionByTitle(page, "Primary Session");

      await expectSidebarError(page, FAILURE_MESSAGES.openSession);
      await expectMainTitle(page, "Secondary Session");
      await expectActiveSessionTitle(page, "Secondary Session");
      expect(await readSessionTitles(page)).toEqual(["Secondary Session", "Primary Session"]);
    },
  );
});

test("surfaces rename-session errors in the sidebar banner", async () => {
  await launchMutationScenario(
    {
      sessions: [
        {
          key: "rename",
          title: "Rename Candidate",
          messages: [
            userMessage("Rename prompt", TIMELINE + 100),
            assistantTextMessage("Rename reply", { timestamp: TIMELINE + 101 }),
          ],
        },
      ],
      control: {
        mutations: {
          renameSession: { error: FAILURE_MESSAGES.renameSession },
        },
      },
    },
    async ({ page }) => {
      await openRenameDialog(page, "Rename Candidate");

      const dialog = page.getByRole("dialog", { name: "Rename Session" });
      const titleInput = page.locator('input[placeholder="Session title"]');
      const nextTitle = "Renamed Candidate";
      await titleInput.fill(nextTitle);
      await dialog.getByRole("button", { name: "Save" }).click({ force: true });

      await expectSidebarError(page, FAILURE_MESSAGES.renameSession);
      await dialog.waitFor({ state: "visible" });
      await expectMainTitle(page, "Rename Candidate");
      await expectActiveSessionTitle(page, "Rename Candidate");
      expect(await readSessionTitles(page)).toEqual(["Rename Candidate"]);
    },
  );
});

test("surfaces fork-session errors in the sidebar banner", async () => {
  await launchMutationScenario(
    {
      sessions: [
        {
          key: "source",
          title: "Fork Source",
          messages: [
            userMessage("Fork prompt", TIMELINE + 100),
            assistantTextMessage("Fork reply", { timestamp: TIMELINE + 101 }),
          ],
        },
      ],
      control: {
        mutations: {
          forkSession: { error: FAILURE_MESSAGES.forkSession },
        },
      },
    },
    async ({ page }) => {
      await openSessionActions(page, "Fork Source");
      await page.locator(".session-menu").getByRole("button", { name: "Fork" }).click({ force: true });

      await expectSidebarError(page, FAILURE_MESSAGES.forkSession);
      await expectMainTitle(page, "Fork Source");
      await expectActiveSessionTitle(page, "Fork Source");
      expect(await readSessionTitles(page)).toEqual(["Fork Source"]);
    },
  );
});

test("surfaces delete-session errors in the sidebar banner", async () => {
  await launchMutationScenario(
    {
      sessions: [
        {
          key: "older",
          title: "Older Session",
          messages: [
            userMessage("Older prompt", TIMELINE + 100),
            assistantTextMessage("Older reply", { timestamp: TIMELINE + 101 }),
          ],
        },
        {
          key: "active",
          title: "Delete Candidate",
          messages: [
            userMessage("Delete prompt", TIMELINE + 200),
            assistantTextMessage("Delete reply", { timestamp: TIMELINE + 201 }),
          ],
        },
      ],
      control: {
        mutations: {
          deleteSession: { error: FAILURE_MESSAGES.deleteSession },
        },
      },
    },
    async ({ page }) => {
      await expectMainTitle(page, "Delete Candidate");
      await openDeleteDialog(page, "Delete Candidate");

      const dialog = page.getByRole("dialog", { name: "Delete Session" });
      await dialog.getByRole("button", { name: "Delete" }).click({ force: true });

      await expectSidebarError(page, FAILURE_MESSAGES.deleteSession);
      await dialog.waitFor({ state: "visible" });
      await expectMainTitle(page, "Delete Candidate");
      await expectActiveSessionTitle(page, "Delete Candidate");
      expect(await readSessionTitles(page)).toEqual(["Delete Candidate", "Older Session"]);
    },
  );
});

test("disables sidebar controls while a rename mutation is in flight", async () => {
  await launchMutationScenario(
    {
      sessions: [
        {
          key: "other",
          title: "Secondary Session",
          messages: [
            userMessage("Secondary prompt", TIMELINE + 100),
            assistantTextMessage("Secondary reply", { timestamp: TIMELINE + 101 }),
          ],
        },
        {
          key: "active",
          title: "Primary Session",
          messages: [
            userMessage("Primary prompt", TIMELINE + 200),
            assistantTextMessage("Primary reply", { timestamp: TIMELINE + 201 }),
          ],
        },
      ],
      control: {
        mutations: {
          renameSession: { delayMs: 1_500 },
        },
      },
    },
    async ({ page }) => {
      await expectMainTitle(page, "Primary Session");
      await openRenameDialog(page, "Primary Session");

      const dialog = page.getByRole("dialog", { name: "Rename Session" });
      const titleInput = page.locator('input[placeholder="Session title"]');
      const saveButton = dialog.getByRole("button", { name: "Save" });
      const nextTitle = "Primary Session Updated";
      await titleInput.fill(nextTitle);
      await saveButton.click({ force: true });

      await expectDisabled(saveButton, true);
      await expectDisabled(page.getByRole("button", { name: "Create a new session" }), true);
      await expectDisabled(sessionMainByTitle(page, "Secondary Session"), true);
      await expectDisabled(sessionMainByTitle(page, "Primary Session"), false);

      await dialog.waitFor({ state: "hidden" });
      await expectMainTitle(page, nextTitle);
      await expectActiveSessionTitle(page, nextTitle);
      expect(await readSessionTitles(page)).toEqual([nextTitle, "Secondary Session"]);
    },
  );
});

test("disables non-active session rows while streaming and blocks deleting the active streaming session", async () => {
  await launchMutationScenario(
    {
      auth: {
        zai: "test-zai-key",
      },
      sessions: [
        {
          key: "observer",
          title: "Observer Session",
          messages: [
            userMessage("Observer prompt", TIMELINE + 100),
            assistantTextMessage("Observer reply", { timestamp: TIMELINE + 101 }),
          ],
        },
        {
          key: "streaming",
          title: "Streaming Session",
          messages: [
            userMessage("Streaming prompt", TIMELINE + 200),
            assistantTextMessage("Streaming reply", { timestamp: TIMELINE + 201 }),
          ],
        },
      ],
      control: {
        prompts: {
          byText: {
            "Stream while guarding the active session": {
              waitForAbort: true,
            },
          },
        },
      },
    },
    async ({ page }) => {
      await expectMainTitle(page, "Streaming Session");
      await expectDisabled(page.getByRole("button", { name: "Create a new session" }), false);

      const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
      await textarea.fill("Stream while guarding the active session");
      await textarea.press("Enter");
      await page.getByRole("button", { name: "Stop" }).waitFor({ state: "visible" });

      await expectDisabled(page.getByRole("button", { name: "Create a new session" }), true);
      await expectDisabled(sessionMainByTitle(page, "Observer Session"), true);
      await expectDisabled(sessionMainByTitle(page, "Streaming Session"), false);

      await openDeleteDialog(page, "Streaming Session");
      const dialog = page.getByRole("dialog", { name: "Delete Session" });
      await dialog.getByRole("button", { name: "Delete" }).click({ force: true });

      await expectSidebarError(page, "Cannot delete a session while it is streaming.");
      await dialog.waitFor({ state: "visible" });
      await expectMainTitle(page, "Streaming Session");
      await expectActiveSessionTitle(page, "Streaming Session");
      expect(await readSessionTitles(page)).toEqual(["Streaming Session", "Observer Session"]);

      await dialog.getByRole("button", { name: "Cancel" }).click({ force: true });
      await page.getByRole("button", { name: "Stop" }).click();
      await page.getByRole("button", { name: "Send" }).waitFor({ state: "visible" });
    },
  );
});
