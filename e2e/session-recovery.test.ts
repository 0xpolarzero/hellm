import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  assistantTextMessage,
  getTestSessionDir,
  seedSessions,
  type SeedSessionInput,
  userMessage,
} from "./support";

setDefaultTimeout(45_000);

beforeAll(async () => {
  await ensureBuilt();
});

async function withHomeDir<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function waitForShell(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
  await page.locator(".session-sidebar").waitFor({ state: "visible" });
  await page.locator(".workspace-main-title").waitFor({ state: "visible" });
}

async function sessionTitles(page: SvvyApp["page"]): Promise<string[]> {
  const rows = page.locator(".session-item strong");
  const count = await rows.count();
  const titles: string[] = [];

  for (let index = 0; index < count; index += 1) {
    titles.push((await rows.nth(index).textContent())?.trim() ?? "");
  }

  return titles;
}

async function expectBootState(
  page: SvvyApp["page"],
  expected: {
    activeTitle: string;
    titles: string[];
  },
): Promise<void> {
  await waitForShell(page);
  expect(await page.locator(".workspace-main-title").textContent()).toBe(expected.activeTitle);
  expect(await page.locator(".session-item").count()).toBe(expected.titles.length);
  expect(await sessionTitles(page)).toEqual(expected.titles);
  expect(await page.locator('.session-item [aria-current="true"] strong').textContent()).toBe(
    expected.activeTitle,
  );
}

async function openSessionActions(page: SvvyApp["page"], title: string): Promise<void> {
  await page.getByRole("button", { name: `Session actions for ${title}` }).click({ force: true });
}

async function renameSession(page: SvvyApp["page"], title: string, nextTitle: string): Promise<void> {
  await openSessionActions(page, title);
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("dialog", { name: "Rename Session" }).waitFor({ state: "visible" });
  await page.locator('input[placeholder="Session title"]').fill(nextTitle);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: `Session actions for ${nextTitle}` }).waitFor({
    state: "visible",
  });
}

async function writeCorruptedSessionFile(
  homeDir: string,
  workspaceDir: string,
  filename = `broken-${Date.now()}.jsonl`,
): Promise<void> {
  const sessionDir = getTestSessionDir(homeDir, workspaceDir);
  await mkdir(sessionDir, { recursive: true });
  await writeFile(join(sessionDir, filename), "{this is not valid json\n", "utf8");
}

test("a corrupted session file does not crash boot and falls back to a fresh session", async () => {
  await withHomeDir(async (homeDir) => {
    await withSvvyApp(
      {
        homeDir,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          await writeCorruptedSessionFile(launchHomeDir, workspaceDir);
        },
      },
      async ({ page }) => {
        await expectBootState(page, {
          titles: ["New Session"],
          activeTitle: "New Session",
        });
        expect(await page.locator(".session-branch").count()).toBe(0);
      },
    );

    await withSvvyApp({ homeDir }, async ({ page }) => {
      await expectBootState(page, {
        titles: ["New Session"],
        activeTitle: "New Session",
      });
    });
  });
});

test("an orphaned forked session still opens, stays labeled as a fork, and remains usable after relaunch", async () => {
  await withHomeDir(async (homeDir) => {
    const orphanTitle = "Orphaned Fork";
    const recoveredTitle = "Recovered Fork";

    await withSvvyApp(
      {
        homeDir,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          const seeded = await seedSessions(
            launchHomeDir,
            [
              {
                key: "parent",
                title: "Original Parent",
                messages: [
                  userMessage("Seed the parent session.", Date.now() - 2_000),
                  assistantTextMessage("Parent is ready.", { timestamp: Date.now() - 1_999 }),
                ],
              },
              {
                key: "child",
                title: orphanTitle,
                parentKey: "parent",
                messages: [
                  userMessage("Seed the forked child.", Date.now() - 1_000),
                  assistantTextMessage("Child is ready.", { timestamp: Date.now() - 999 }),
                ],
              },
            ],
            workspaceDir,
          );

          await rm(seeded[0].file, { force: true });
        },
      },
      async ({ page }) => {
        await expectBootState(page, {
          titles: [orphanTitle],
          activeTitle: orphanTitle,
        });
        expect(await page.locator(".session-branch").count()).toBe(1);

        await renameSession(page, orphanTitle, recoveredTitle);
        await expectBootState(page, {
          titles: [recoveredTitle],
          activeTitle: recoveredTitle,
        });
        expect(await page.locator(".session-branch").count()).toBe(1);
      },
    );

    await withSvvyApp({ homeDir }, async ({ page }) => {
      await expectBootState(page, {
        titles: [recoveredTitle],
        activeTitle: recoveredTitle,
      });
      expect(await page.locator(".session-branch").count()).toBe(1);
    });
  });
});

test("a workspace with many sessions still boots and the newest session is active", async () => {
  await withHomeDir(async (homeDir) => {
    const totalSessions = 18;
    const baseTimestamp = Date.now() - totalSessions * 1_000;
    const sessions: SeedSessionInput[] = Array.from({ length: totalSessions }, (_, index) => {
      const title = `Recovery Session ${String(index + 1).padStart(2, "0")}`;
      const timestamp = baseTimestamp + index * 1_000;
      return {
        key: `session-${index + 1}`,
        title,
        messages: [
          userMessage(`Prompt for ${title}`, timestamp),
          assistantTextMessage(`Response for ${title}`, { timestamp: timestamp + 1 }),
        ],
      };
    });

    const expectedTitles = [...sessions].reverse().map((session) => session.title ?? "New Session");
    const newestTitle = expectedTitles[0] ?? "New Session";

    await withSvvyApp(
      {
        homeDir,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          for (const session of sessions) {
            await seedSessions(launchHomeDir, [session], workspaceDir);
            await Bun.sleep(5);
          }
        },
      },
      async ({ page }) => {
        await expectBootState(page, {
          titles: expectedTitles,
          activeTitle: newestTitle,
        });
      },
    );

    await withSvvyApp({ homeDir }, async ({ page }) => {
      await expectBootState(page, {
        titles: expectedTitles,
        activeTitle: newestTitle,
      });
    });
  });
});
