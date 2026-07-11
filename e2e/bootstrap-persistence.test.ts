import { expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolveElectrobunWorkspaceDir } from "electrobun-e2e";
import { launchSvvyApp, createHomeDir } from "./harness";
import { assistantTextMessage, seedSessions, userMessage } from "./support";

setDefaultTimeout(90_000);

function getAppWorkspaceDir(): string {
  return resolveElectrobunWorkspaceDir(process.cwd());
}

function currentGitBranch(): string {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: getAppWorkspaceDir(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to read the current git branch: ${result.stderr}`);
  }

  return result.stdout.trim();
}

async function withHomeDir<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function text(page: Awaited<ReturnType<typeof launchSvvyApp>>["page"], selector: string) {
  return (await page.locator(selector).textContent())?.trim() ?? "";
}

async function sessionTitles(page: Awaited<ReturnType<typeof launchSvvyApp>>["page"]) {
  const rows = page.locator(".session-item");
  const count = await rows.count();
  const titles: string[] = [];

  for (let index = 0; index < count; index += 1) {
    titles.push((await rows.nth(index).locator("strong").textContent())?.trim() ?? "");
  }

  return titles;
}

async function expectWorkspaceChrome(page: Awaited<ReturnType<typeof launchSvvyApp>>["page"]) {
  const branch = currentGitBranch();
  const workspaceLabel = await text(
    page,
    ".sidebar-footer .workspace-path, .sidebar-footer .workspace-path-static",
  );

  expect(await text(page, ".workspace-titlebar-title")).toBe("svvy");
  expect(workspaceLabel).not.toBe("");

  const sidebarContext = await text(page, ".sidebar-sections");
  expect(sidebarContext).toContain("Sessions");

  return { branch, workspaceLabel };
}

async function expectBootState(
  page: Awaited<ReturnType<typeof launchSvvyApp>>["page"],
  expected: {
    titles: string[];
    activeTitle: string;
    surfaceTitle?: string;
  },
) {
  await page
    .locator("[data-testid=active-surface-title]")
    .filter({ hasText: expected.surfaceTitle ?? expected.activeTitle })
    .waitFor({ state: "visible" });
  await page
    .locator('.session-item [aria-current="true"] strong')
    .filter({ hasText: expected.activeTitle })
    .waitFor({ state: "visible" });
  expect(await page.locator(".session-item").count()).toBe(expected.titles.length);
  expect(await sessionTitles(page)).toEqual(expected.titles);
  expect(await text(page, "[data-testid=active-surface-title]")).toBe(
    expected.surfaceTitle ?? expected.activeTitle,
  );
  expect(await text(page, '.session-item [aria-current="true"] strong')).toBe(expected.activeTitle);
}

async function expectBlankLayout(page: Awaited<ReturnType<typeof launchSvvyApp>>["page"]) {
  await page.locator('[data-testid="dockview-watermark"]').waitFor({ state: "visible" });
  expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(0);
  expect(await page.locator("[data-testid=active-surface-title]").count()).toBe(0);
  expect(await page.locator('.session-item [aria-current="true"]').count()).toBe(0);
  expect((await page.locator('[data-testid="dockview-watermark"]').textContent()) ?? "").toContain(
    "No panes open",
  );
}

async function expectBlankBootState(page: Awaited<ReturnType<typeof launchSvvyApp>>["page"]) {
  await expectBlankLayout(page);
  expect(await page.locator(".session-item").count()).toBe(0);
  expect(await sessionTitles(page)).toEqual([]);
}

async function openSession(page: Awaited<ReturnType<typeof launchSvvyApp>>["page"], title: string) {
  const session = page
    .locator(".session-main")
    .filter({ has: page.locator("strong").filter({ hasText: title }) })
    .first();
  await session.waitFor({ state: "visible" });
  await session.click({ force: true });
}

test("a clean isolated home dir boots the shell with a blank workspace", async () => {
  await withHomeDir(async (homeDir) => {
    const app = await launchSvvyApp({ homeDir });
    try {
      const chrome = await expectWorkspaceChrome(app.page);
      expect(chrome.workspaceLabel).not.toBe("");
      await expectBlankBootState(app.page);

      const sidebarContext = await text(app.page, ".sidebar-sections");
      expect(sidebarContext).toContain("Sessions 0");
      expect(await app.page.locator(".session-item [aria-current='true']").count()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

test("seeded sessions are hydrated on boot and the newest one opens explicitly", async () => {
  await withHomeDir(async (homeDir) => {
    const base = Date.now() - 60_000;
    await seedSessions(
      homeDir,
      [
        {
          key: "older",
          title: "Older session",
          messages: [
            userMessage("Investigate the queue", base),
            assistantTextMessage("Queue looks healthy.", { timestamp: base + 1 }),
          ],
        },
        {
          key: "failed",
          title: "Failed session",
          messages: [
            userMessage("Check the failing boot path", base + 2_000),
            assistantTextMessage("Boot path failed.", {
              stopReason: "error",
              timestamp: base + 2_001,
            }),
          ],
        },
        {
          key: "forked",
          title: "Forked child",
          parentKey: "older",
          messages: [
            userMessage("Carry the work forward", base + 4_000),
            assistantTextMessage("Forked work is ready.", { timestamp: base + 4_001 }),
          ],
        },
      ],
      getAppWorkspaceDir(),
    );

    const app = await launchSvvyApp({ homeDir });
    try {
      const chrome = await expectWorkspaceChrome(app.page);
      expect(chrome.workspaceLabel).not.toBe("");
      await expectBlankLayout(app.page);
      await openSession(app.page, "Forked child");
      await expectBootState(app.page, {
        titles: ["Forked child", "Failed session", "Older session"],
        activeTitle: "Forked child",
      });

      const sidebarContext = await text(app.page, ".sidebar-sections");
      expect(sidebarContext).toContain("Sessions 3");
      expect(await app.page.locator(".session-item").nth(0).textContent()).toContain("Fork");
      expect(await app.page.locator(".session-status").count()).toBe(0);
      expect(await app.page.locator(".session-item").nth(2).textContent()).not.toContain("Fork");
      expect(await app.page.locator(".session-item").nth(0).locator("strong").textContent()).toBe(
        "Forked child",
      );
      expect(
        await app.page
          .locator(".session-item")
          .nth(0)
          .locator('[aria-label="Forked session"]')
          .count(),
      ).toBe(1);
    } finally {
      await app.close();
    }
  });
});

test("relaunching the same seeded home dir keeps session data stable", async () => {
  await withHomeDir(async (homeDir) => {
    const base = Date.now() - 60_000;
    await seedSessions(
      homeDir,
      [
        {
          key: "older",
          title: "Older session",
          messages: [
            userMessage("Investigate the queue", base),
            assistantTextMessage("Queue looks healthy.", { timestamp: base + 1 }),
          ],
        },
        {
          key: "failed",
          title: "Failed session",
          messages: [
            userMessage("Check the failing boot path", base + 2_000),
            assistantTextMessage("Boot path failed.", {
              stopReason: "error",
              timestamp: base + 2_001,
            }),
          ],
        },
        {
          key: "forked",
          title: "Forked child",
          parentKey: "older",
          messages: [
            userMessage("Carry the work forward", base + 4_000),
            assistantTextMessage("Forked work is ready.", { timestamp: base + 4_001 }),
          ],
        },
      ],
      getAppWorkspaceDir(),
    );

    const expectedTitles = ["Forked child", "Failed session", "Older session"];

    let firstChrome: Awaited<ReturnType<typeof expectWorkspaceChrome>> | undefined;
    const firstLaunch = await launchSvvyApp({ homeDir });
    try {
      firstChrome = await expectWorkspaceChrome(firstLaunch.page);
      await expectBlankLayout(firstLaunch.page);
      await openSession(firstLaunch.page, "Forked child");
      await expectBootState(firstLaunch.page, {
        titles: expectedTitles,
        activeTitle: "Forked child",
      });
    } finally {
      await firstLaunch.close();
    }

    const secondLaunch = await launchSvvyApp({ homeDir });
    try {
      const secondChrome = await expectWorkspaceChrome(secondLaunch.page);
      expect(firstChrome).toBeDefined();
      expect(secondChrome.workspaceLabel).toBe(firstChrome!.workspaceLabel);
      await expectBootState(secondLaunch.page, {
        titles: expectedTitles,
        activeTitle: "Forked child",
      });
    } finally {
      await secondLaunch.close();
    }
  });
});
