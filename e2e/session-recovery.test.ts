import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createStructuredSessionStateStore } from "@svvy/state/structured-session-state";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  assistantTextMessage,
  getTestSessionDir,
  getTestWorkspaceId,
  seedSessions,
  STRUCTURED_SESSION_DB_FILENAME,
  type SeedSessionInput,
  userMessage,
} from "./support";

setDefaultTimeout(90_000);

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

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
  await page.locator('[data-testid="dockview-workbench"]').waitFor({ state: "visible" });
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
    surfaceTitle?: string;
  },
): Promise<void> {
  await waitForShell(page);
  await page
    .locator("[data-testid=active-surface-title]")
    .filter({ hasText: expected.surfaceTitle ?? expected.activeTitle })
    .waitFor({ state: "visible" });
  await page
    .locator('.session-item [aria-current="true"] strong')
    .filter({ hasText: expected.activeTitle })
    .waitFor({ state: "visible" });
  expect(await page.locator("[data-testid=active-surface-title]").textContent()).toBe(
    expected.surfaceTitle ?? expected.activeTitle,
  );
  expect(await page.locator(".session-item").count()).toBe(expected.titles.length);
  expect(await sessionTitles(page)).toEqual(expected.titles);
  expect(await page.locator('.session-item [aria-current="true"] strong').textContent()).toBe(
    expected.activeTitle,
  );
}

async function expectBlankLayout(page: SvvyApp["page"]): Promise<void> {
  await waitForShell(page);
  await page.locator('[data-testid="dockview-watermark"]').waitFor({ state: "visible" });
  expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(0);
  expect(await page.locator("[data-testid=active-surface-title]").count()).toBe(0);
  expect(await page.locator('.session-item [aria-current="true"]').count()).toBe(0);
  expect((await page.locator('[data-testid="dockview-watermark"]').textContent()) ?? "").toContain(
    "No panes open",
  );
}

async function expectBlankBootState(page: SvvyApp["page"]): Promise<void> {
  await expectBlankLayout(page);
  expect(await page.locator(".session-item").count()).toBe(0);
  expect(await sessionTitles(page)).toEqual([]);
}

async function openSession(page: SvvyApp["page"], title: string): Promise<void> {
  const session = page
    .locator(".session-main")
    .filter({ has: page.locator("strong").filter({ hasText: title }) })
    .first();
  await session.waitFor({ state: "visible" });
  await session.click({ force: true });
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

test("a corrupted session file does not crash boot and leaves the workspace blank", async () => {
  await withHomeDir(async (homeDir) => {
    await withSvvyApp(
      {
        homeDir,
        beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
          await writeCorruptedSessionFile(launchHomeDir, workspaceDir);
        },
      },
      async ({ page }) => {
        await expectBlankBootState(page);
        expect(await page.locator('[aria-label="Forked session"]').count()).toBe(0);
      },
    );

    await withSvvyApp({ homeDir }, async ({ page }) => {
      await expectBlankBootState(page);
    });
  });
});

test("an orphaned forked session still opens, stays labeled as a fork, and remains usable after relaunch", async () => {
  await withHomeDir(async (homeDir) => {
    const orphanTitle = "Orphaned Fork";

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
          const canonicalWorkspace = realpathSync.native(workspaceDir);
          const store = createStructuredSessionStateStore({
            databasePath: join(
              getTestSessionDir(launchHomeDir, canonicalWorkspace),
              STRUCTURED_SESSION_DB_FILENAME,
            ),
            digest: testDigest,
            workspace: {
              id: getTestWorkspaceId(canonicalWorkspace),
              label: basename(canonicalWorkspace),
              cwd: canonicalWorkspace,
            },
          });
          try {
            store.deleteSessionState(seeded[0].id);
          } finally {
            store.close();
          }
        },
      },
      async ({ page }) => {
        await expectBlankLayout(page);
        await openSession(page, orphanTitle);
        await expectBootState(page, {
          titles: [orphanTitle],
          activeTitle: orphanTitle,
        });
        expect(await page.locator('[aria-label="Forked session"]').count()).toBe(1);
      },
    );

    await withSvvyApp({ homeDir }, async ({ page }) => {
      await expectBootState(page, {
        titles: [orphanTitle],
        activeTitle: orphanTitle,
      });
      expect(await page.locator('[aria-label="Forked session"]').count()).toBe(1);
    });
  });
});

test("a workspace with many sessions restores the explicitly opened newest session", async () => {
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

    const expectedTitles = [...sessions]
      .toReversed()
      .map((session) => session.title ?? "New Session");
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
        await expectBlankLayout(page);
        await openSession(page, newestTitle);
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
