import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, withSvvyApp, type SvvyApp } from "./harness";
import { assistantTextMessage, seedSessions, type SeedSessionInput, userMessage } from "./support";

setDefaultTimeout(90_000);

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

async function expectMainTitle(page: SvvyApp["page"], expected: string): Promise<void> {
  const title = page.locator("[data-testid=active-surface-title]");
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

test("renders seeded sessions in recency order, projects the fork badge, and switches the active session", async () => {
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
      await page.getByText("Sessions 3").waitFor({ state: "visible" });

      expect(await readSessionTitles(page)).toEqual([
        "Track beta branch",
        "Gamma Fork",
        "Alpha Review",
      ]);
      await expectMainTitle(page, "Track beta branch");
      await expectActiveSessionTitle(page, "Track beta branch");
      expect(await page.locator('[aria-label="Forked session"]').count()).toBe(1);

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
        await waitForSessionRows(page, 1);
        await page
          .getByRole("button", { name: "Create a new orchestrator" })
          .click({ force: true });

        await waitForSessionRows(page, 2);
        await expectMainTitle(page, "New orchestrator");
        await expectActiveSessionTitle(page, "New orchestrator");
        expect((await readSessionTitles(page))[0]).toBe("New orchestrator");
        await page
          .locator(
            'textarea[placeholder="Ask svvy to inspect the repo, make a change, or delegate work."]',
          )
          .waitFor({ state: "visible" });
      },
    );

    await withSvvyApp(
      {
        homeDir,
      },
      async ({ page }) => {
        await waitForSessionRows(page, 2);
        await expectMainTitle(page, "New orchestrator");
        await expectActiveSessionTitle(page, "New orchestrator");
      },
    );
  });
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
