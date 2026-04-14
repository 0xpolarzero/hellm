import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, withSvvyApp, type SvvyApp } from "./harness";
import { assistantTextMessage, seedSessions, type SeedSessionInput, userMessage } from "./support";

setDefaultTimeout(45_000);

const TIMELINE = Date.parse("2026-04-10T10:00:00.000Z");

beforeAll(async () => {
  await ensureBuilt();
});

async function launchWithSessions(
  sessions: SeedSessionInput[],
  fn: (app: SvvyApp) => Promise<void>,
): Promise<void> {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedSessions(homeDir, sessions, workspaceDir);
      },
    },
    fn,
  );
}

async function withPersistentHome<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function readSessionTitles(page: SvvyApp["page"]): Promise<string[]> {
  const titles: string[] = [];
  const count = await page.locator(".session-main strong").count();
  for (let index = 0; index < count; index += 1) {
    const title = await page.locator(".session-main strong").nth(index).textContent();
    titles.push(title?.trim() ?? "");
  }
  return titles;
}

async function openSessionActions(page: SvvyApp["page"], title: string): Promise<void> {
  const trigger = page.getByRole("button", { name: `Session actions for ${title}` });
  await trigger.waitFor({ state: "visible" });
  await trigger.click({ force: true });
}

async function clickSessionByTitle(page: SvvyApp["page"], title: string): Promise<void> {
  const sessionButton = page
    .locator(".session-main")
    .filter({
      has: page.locator("strong").filter({ hasText: title }),
    })
    .first();
  await sessionButton.waitFor({ state: "visible" });
  await sessionButton.click({ force: true });
}

async function waitForSessionCount(
  page: SvvyApp["page"],
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

async function waitForSessionRows(
  page: SvvyApp["page"],
  expectedCount: number,
  timeoutMs = 15_000,
): Promise<void> {
  const rows = page.locator(".session-item");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if ((await rows.count()) === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for ${expectedCount} session rows.`);
}

async function openRenameDialog(page: SvvyApp["page"], title: string): Promise<void> {
  await openSessionActions(page, title);
  await page
    .locator(".session-menu")
    .getByRole("button", { name: "Rename" })
    .click({ force: true });
  await page.getByRole("dialog", { name: "Rename Session" }).waitFor({ state: "visible" });
}

async function openDeleteDialog(page: SvvyApp["page"], title: string): Promise<void> {
  await openSessionActions(page, title);
  await page
    .locator(".session-menu")
    .getByRole("button", { name: "Delete" })
    .click({ force: true });
  await page.getByRole("dialog", { name: "Delete Session" }).waitFor({ state: "visible" });
}

async function expectMainTitle(page: SvvyApp["page"], expected: string): Promise<void> {
  const title = page.locator(".workspace-main-title");
  await waitForText(title, expected);
  expect((await title.textContent())?.trim()).toBe(expected);
}

async function expectActiveSessionTitle(page: SvvyApp["page"], expected: string): Promise<void> {
  const activeTitle = page.locator('.session-main[aria-current="true"] strong');
  await waitForText(activeTitle, expected);
  expect((await activeTitle.textContent())?.trim()).toBe(expected);
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

test("renders seeded sessions in recency order, projects badges, and switches the active session", async () => {
  await launchWithSessions(
    [
      {
        key: "alpha",
        title: "Alpha Review",
        messages: [
          userMessage("Review the alpha path", TIMELINE + 100),
          assistantTextMessage("Alpha answer", { timestamp: TIMELINE + 101 }),
        ],
      },
      {
        key: "beta",
        messages: [
          userMessage("Track beta branch", TIMELINE + 300),
          assistantTextMessage("Beta answer", { timestamp: TIMELINE + 301 }),
        ],
      },
      {
        key: "gamma",
        title: "Gamma Fork",
        parentKey: "alpha",
        messages: [
          userMessage("Investigate the fork", TIMELINE + 200),
          assistantTextMessage("Gamma issue", {
            timestamp: TIMELINE + 201,
            stopReason: "error",
          }),
        ],
      },
    ],
    async ({ page }) => {
      await page.getByText("3 sessions").waitFor({ state: "visible" });

      expect(await readSessionTitles(page)).toEqual([
        "Track beta branch",
        "Gamma Fork",
        "Alpha Review",
      ]);
      await expectMainTitle(page, "Track beta branch");
      await expectActiveSessionTitle(page, "Track beta branch");
      await page.locator(".session-status.status-error").waitFor({ state: "visible" });
      await page.locator(".session-branch").waitFor({ state: "visible" });

      await clickSessionByTitle(page, "Alpha Review");

      await expectMainTitle(page, "Alpha Review");
      await expectActiveSessionTitle(page, "Alpha Review");
    },
  );
});

test("creates a new session, activates it, and keeps it after relaunch", async () => {
  await withPersistentHome(async (homeDir) => {
    await withSvvyApp(
      {
        homeDir,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          await seedSessions(
            launchHomeDir,
            [
              {
                key: "existing",
                title: "Existing Session",
                messages: [
                  userMessage("Existing prompt", TIMELINE + 100),
                  assistantTextMessage("Existing reply", { timestamp: TIMELINE + 101 }),
                ],
              },
            ],
            workspaceDir,
          );
        },
      },
      async ({ page }) => {
        await waitForSessionCount(page, 1);
        await page.getByRole("button", { name: "Create a new session" }).click({ force: true });

        await waitForSessionRows(page, 2);
        await expectMainTitle(page, "New Session");
        await expectActiveSessionTitle(page, "New Session");
        expect((await readSessionTitles(page))[0]).toBe("New Session");
      },
    );

    await withSvvyApp(
      {
        homeDir,
      },
      async ({ page }) => {
        await waitForSessionRows(page, 2);
        await expectMainTitle(page, "New Session");
        await expectActiveSessionTitle(page, "New Session");
      },
    );
  });
});

test("rejects an empty rename, then renames and persists the session title", async () => {
  await withPersistentHome(async (homeDir) => {
    await withSvvyApp(
      {
        homeDir,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          await seedSessions(
            launchHomeDir,
            [
              {
                key: "rename",
                title: "Rename Candidate",
                messages: [
                  userMessage("Rename candidate prompt", TIMELINE + 100),
                  assistantTextMessage("Rename candidate reply", { timestamp: TIMELINE + 101 }),
                ],
              },
            ],
            workspaceDir,
          );
        },
      },
      async ({ page }) => {
        await openRenameDialog(page, "Rename Candidate");

        const dialog = page.getByRole("dialog", { name: "Rename Session" });
        const titleInput = page.locator('input[placeholder="Session title"]');
        await titleInput.clear();
        await dialog.getByRole("button", { name: "Save" }).click({ force: true });

        await page.getByText("Session title cannot be empty.").waitFor({ state: "visible" });
        await dialog.waitFor({ state: "visible" });

        const nextTitle = `Renamed Session ${Date.now()}`;
        await titleInput.fill(nextTitle);
        await dialog.getByRole("button", { name: "Save" }).click({ force: true });

        await page.getByRole("dialog", { name: "Rename Session" }).waitFor({ state: "hidden" });
        await expectMainTitle(page, nextTitle);
        await expectActiveSessionTitle(page, nextTitle);
        expect((await readSessionTitles(page))[0]).toBe(nextTitle);
      },
    );

    await withSvvyApp(
      {
        homeDir,
      },
      async ({ page }) => {
        const nextTitleMatch = await page.locator(".workspace-main-title").textContent();
        expect(nextTitleMatch?.trim()).toMatch(/^Renamed Session /);
        await expectActiveSessionTitle(page, nextTitleMatch?.trim() ?? "");
      },
    );
  });
});

test("forks a session into a new active copy with a fork badge", async () => {
  await withPersistentHome(async (homeDir) => {
    await withSvvyApp(
      {
        homeDir,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          await seedSessions(
            launchHomeDir,
            [
              {
                key: "source",
                title: "Fork Source",
                messages: [
                  userMessage("Fork source prompt", TIMELINE + 100),
                  assistantTextMessage("Fork source reply", { timestamp: TIMELINE + 101 }),
                ],
              },
            ],
            workspaceDir,
          );
        },
      },
      async ({ page }) => {
        await openSessionActions(page, "Fork Source");
        await page
          .locator(".session-menu")
          .getByRole("button", { name: "Fork" })
          .click({ force: true });

        await waitForSessionRows(page, 2);
        await expectMainTitle(page, "Fork Source");
        await expectActiveSessionTitle(page, "Fork Source");
        expect(await page.locator(".session-branch").count()).toBe(1);
        await page.locator(".session-item.active .session-branch").waitFor({ state: "visible" });
      },
    );

    await withSvvyApp(
      {
        homeDir,
      },
      async ({ page }) => {
        await waitForSessionRows(page, 2);
        await expectMainTitle(page, "Fork Source");
        expect(await page.locator(".session-branch").count()).toBe(1);
        await page.locator(".session-branch").waitFor({ state: "visible" });
      },
    );
  });
});

test("delete confirmation can be canceled and then remove an inactive session", async () => {
  await launchWithSessions(
    [
      {
        key: "kept",
        title: "Keep Me",
        messages: [
          userMessage("Keep me prompt", TIMELINE + 100),
          assistantTextMessage("Keep me reply", { timestamp: TIMELINE + 101 }),
        ],
      },
      {
        key: "discarded",
        title: "Discard Me",
        messages: [
          userMessage("Discard me prompt", TIMELINE + 200),
          assistantTextMessage("Discard me reply", { timestamp: TIMELINE + 201 }),
        ],
      },
    ],
    async ({ page }) => {
      await waitForSessionCount(page, 2);
      await expectMainTitle(page, "Discard Me");

      await openDeleteDialog(page, "Keep Me");
      await page
        .getByRole("dialog", { name: "Delete Session" })
        .getByRole("button", { name: "Cancel" })
        .click({ force: true });

      await page.getByRole("dialog", { name: "Delete Session" }).waitFor({ state: "hidden" });
      await waitForSessionCount(page, 2);
      await expectMainTitle(page, "Discard Me");
      expect(await readSessionTitles(page)).toEqual(["Discard Me", "Keep Me"]);

      await openDeleteDialog(page, "Keep Me");
      await page
        .getByRole("dialog", { name: "Delete Session" })
        .getByRole("button", { name: "Delete" })
        .click({ force: true });

      await page.getByRole("dialog", { name: "Delete Session" }).waitFor({ state: "hidden" });
      await waitForSessionCount(page, 1);
      await expectMainTitle(page, "Discard Me");
      expect(await readSessionTitles(page)).toEqual(["Discard Me"]);
    },
  );
});

test("falls back to the next session after deleting the active session", async () => {
  await launchWithSessions(
    [
      {
        key: "older",
        title: "Older Backup",
        messages: [
          userMessage("Older backup prompt", TIMELINE + 100),
          assistantTextMessage("Older backup reply", { timestamp: TIMELINE + 101 }),
        ],
      },
      {
        key: "active",
        title: "Current Active",
        messages: [
          userMessage("Current active prompt", TIMELINE + 200),
          assistantTextMessage("Current active reply", { timestamp: TIMELINE + 201 }),
        ],
      },
    ],
    async ({ page }) => {
      await expectMainTitle(page, "Current Active");
      await openDeleteDialog(page, "Current Active");
      await page
        .getByRole("dialog", { name: "Delete Session" })
        .getByRole("button", { name: "Delete" })
        .click({ force: true });

      await waitForSessionCount(page, 1);
      await expectMainTitle(page, "Older Backup");
      await expectActiveSessionTitle(page, "Older Backup");
      expect(await readSessionTitles(page)).toEqual(["Older Backup"]);
    },
  );
});

test("recreates a fresh session after deleting the last remaining one", async () => {
  await launchWithSessions(
    [
      {
        key: "solo",
        title: "Solo Session",
        messages: [
          userMessage("Solo prompt", TIMELINE + 100),
          assistantTextMessage("Solo reply", { timestamp: TIMELINE + 101 }),
        ],
      },
    ],
    async ({ page }) => {
      await expectMainTitle(page, "Solo Session");
      await openDeleteDialog(page, "Solo Session");
      await page
        .getByRole("dialog", { name: "Delete Session" })
        .getByRole("button", { name: "Delete" })
        .click({ force: true });

      await waitForSessionCount(page, 1);
      await expectMainTitle(page, "New Session");
      await expectActiveSessionTitle(page, "New Session");
      expect(await readSessionTitles(page)).toEqual(["New Session"]);
    },
  );
});

test("sidebar toggle updates visibility and the resize handle tracks the hidden state", async () => {
  await launchWithSessions(
    [
      {
        key: "solo",
        title: "Solo Session",
        messages: [
          userMessage("Solo prompt", TIMELINE + 100),
          assistantTextMessage("Solo reply", { timestamp: TIMELINE + 101 }),
        ],
      },
    ],
    async ({ page }) => {
      const handle = page.locator(".sidebar-resize-handle");
      await page.locator(".session-sidebar").waitFor({ state: "visible" });
      await handle.waitFor({ state: "visible" });

      const attrs = await page.attrs("css:.sidebar-resize-handle");
      expect(attrs.attributes["aria-orientation"]).toBe("vertical");
      expect(Number(attrs.attributes["aria-valuemin"])).toBeGreaterThan(0);
      expect(Number(attrs.attributes["aria-valuemax"])).toBeGreaterThanOrEqual(
        Number(attrs.attributes["aria-valuemin"]),
      );
      expect(Number(attrs.attributes["aria-valuenow"])).toBeGreaterThanOrEqual(
        Number(attrs.attributes["aria-valuemin"]),
      );

      const hideButton = page.getByRole("button", { name: "Hide sidebar" });
      await hideButton.click();

      await page.locator(".session-sidebar").waitFor({ state: "hidden" });
      await handle.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Show sidebar" }).waitFor({ state: "visible" });

      await page.getByRole("button", { name: "Show sidebar" }).click();
      await page.locator(".session-sidebar").waitFor({ state: "visible" });
      await page.getByRole("button", { name: "Hide sidebar" }).waitFor({ state: "visible" });
      await handle.waitFor({ state: "visible" });
    },
  );
});
