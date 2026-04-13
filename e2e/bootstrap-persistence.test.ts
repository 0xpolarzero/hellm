import { expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolveElectrobunWorkspaceDir } from "electrobun-e2e";
import { escapeForRegExp, launchHellmApp, createHomeDir } from "./harness";
import { assistantTextMessage, seedSessions, userMessage } from "./support";

setDefaultTimeout(45_000);

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

async function text(page: Awaited<ReturnType<typeof launchHellmApp>>["page"], selector: string) {
  return (await page.locator(selector).textContent())?.trim() ?? "";
}

async function sessionTitles(page: Awaited<ReturnType<typeof launchHellmApp>>["page"]) {
  const rows = page.locator(".session-item");
  const count = await rows.count();
  const titles: string[] = [];

  for (let index = 0; index < count; index += 1) {
    titles.push((await rows.nth(index).locator("strong").textContent())?.trim() ?? "");
  }

  return titles;
}

async function expectWorkspaceChrome(page: Awaited<ReturnType<typeof launchHellmApp>>["page"]) {
  const branch = currentGitBranch();
  const workspaceLabel = await text(page, ".sidebar-header-copy h2");

  expect(await text(page, ".workspace-titlebar-title")).toBe("hellm");
  expect(workspaceLabel).not.toBe("");

  const sidebarContext = await text(page, ".sidebar-context");
  expect(sidebarContext).toContain("sessions");
  if (branch) {
    expect(sidebarContext).toContain(branch);
  }

  return { branch, workspaceLabel };
}

async function expectBootState(page: Awaited<ReturnType<typeof launchHellmApp>>["page"], expected: {
  titles: string[];
  activeTitle: string;
}) {
  expect(await page.locator(".session-item").count()).toBe(expected.titles.length);
  expect(await sessionTitles(page)).toEqual(expected.titles);
  expect(await text(page, ".workspace-main-title")).toBe(expected.activeTitle);
  expect(await text(page, '.session-item [aria-current="true"] strong')).toBe(expected.activeTitle);
}

test("a clean isolated home dir boots the shell and creates one session", async () => {
  await withHomeDir(async (homeDir) => {
    const app = await launchHellmApp({ homeDir });
    try {
      const chrome = await expectWorkspaceChrome(app.page);
      expect(chrome.workspaceLabel).not.toBe("");
      await expectBootState(app.page, {
        titles: ["New Session"],
        activeTitle: "New Session",
      });

      const sidebarContext = await text(app.page, ".sidebar-context");
      expect(sidebarContext).toContain("1 sessions");
      expect(await app.page.locator(".session-item [aria-current='true']").count()).toBe(1);
    } finally {
      await app.close();
    }
  });
});

test("seeded sessions are hydrated on boot and the newest one opens first", async () => {
  await withHomeDir(async (homeDir) => {
    const base = Date.now() - 60_000;
    await seedSessions(homeDir, [
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
    ], getAppWorkspaceDir());

    const app = await launchHellmApp({ homeDir });
    try {
      const chrome = await expectWorkspaceChrome(app.page);
      expect(chrome.workspaceLabel).not.toBe("");
      await expectBootState(app.page, {
        titles: ["Forked child", "Failed session", "Older session"],
        activeTitle: "Forked child",
      });

      const sidebarContext = await text(app.page, ".sidebar-context");
      expect(sidebarContext).toContain("3 sessions");
      expect(await app.page.locator(".session-item").nth(0).textContent()).toContain("Fork");
      expect(await app.page.locator(".session-item").nth(1).textContent()).toContain("Error");
      expect(await app.page.locator(".session-item").nth(2).textContent()).not.toContain("Fork");
      expect(await app.page.locator(".session-item").nth(0).locator("strong").textContent()).toBe(
        "Forked child",
      );
      expect(await app.page.locator(".session-item").nth(0).locator(".session-branch").textContent()).toBe(
        "Fork",
      );
    } finally {
      await app.close();
    }
  });
});

test("renaming a session persists across relaunch on the same home dir", async () => {
  await withHomeDir(async (homeDir) => {
    await seedSessions(homeDir, [
      {
        key: "rename-me",
        title: "Original session",
        messages: [
          userMessage("Rename this session", Date.now() - 1_000),
          assistantTextMessage("Ready to rename.", { timestamp: Date.now() - 999 }),
        ],
      },
    ], getAppWorkspaceDir());

    const renamedTitle = `Renamed for persistence ${Date.now()}`;

    const firstLaunch = await launchHellmApp({ homeDir });
    try {
      const chrome = await expectWorkspaceChrome(firstLaunch.page);
      expect(chrome.workspaceLabel).not.toBe("");
      await expectBootState(firstLaunch.page, {
        titles: ["Original session"],
        activeTitle: "Original session",
      });

      const firstSession = firstLaunch.page.locator(".session-item").first();
      await firstSession.getByRole("button", { name: /Session actions for/ }).click({ force: true });
      await firstLaunch.page.getByRole("button", { name: "Rename" }).click();

      const dialog = firstLaunch.page.getByRole("dialog", { name: "Rename Session" });
      await dialog.waitFor({ state: "visible" });
      await firstLaunch.page.locator('input[placeholder="Session title"]').fill(renamedTitle);
      await firstLaunch.page.getByRole("button", { name: "Save" }).click();

      await firstLaunch.page
        .getByRole("button", {
          name: new RegExp(`^Session actions for ${escapeForRegExp(renamedTitle)}$`),
        })
        .waitFor({ state: "visible" });
      expect(await text(firstLaunch.page, ".workspace-main-title")).toBe(renamedTitle);
    } finally {
      await firstLaunch.close();
    }

    const secondLaunch = await launchHellmApp({ homeDir });
    try {
      const chrome = await expectWorkspaceChrome(secondLaunch.page);
      expect(chrome.workspaceLabel).not.toBe("");
      await expectBootState(secondLaunch.page, {
        titles: [renamedTitle],
        activeTitle: renamedTitle,
      });
    } finally {
      await secondLaunch.close();
    }
  });
});

test("relaunching the same seeded home dir keeps session data stable", async () => {
  await withHomeDir(async (homeDir) => {
    const base = Date.now() - 60_000;
    await seedSessions(homeDir, [
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
    ], getAppWorkspaceDir());

    const expectedTitles = ["Forked child", "Failed session", "Older session"];

    let firstChrome: Awaited<ReturnType<typeof expectWorkspaceChrome>> | undefined;
    const firstLaunch = await launchHellmApp({ homeDir });
    try {
      firstChrome = await expectWorkspaceChrome(firstLaunch.page);
      await expectBootState(firstLaunch.page, {
        titles: expectedTitles,
        activeTitle: "Forked child",
      });
    } finally {
      await firstLaunch.close();
    }

    const secondLaunch = await launchHellmApp({ homeDir });
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
