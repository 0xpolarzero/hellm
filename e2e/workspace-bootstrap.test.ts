import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type Page } from "electrobun-browser-tools";
import {
  createJsonBridgeMetadataParser,
  launchElectrobunApp,
  type LaunchedElectrobunApp,
} from "electrobun-e2e";
import { DEFAULT_CHAT_SETTINGS } from "../src/mainview/chat-settings";
import { createHomeDir, ensureBuilt, launchHellmApp, type HellmApp } from "./harness";
import { assistantTextMessage, seedSessions, userMessage, writeE2eControl } from "./support";

setDefaultTimeout(60_000);

const INITIAL_BRANCH = "bootstrap-main";
const UPDATED_BRANCH = "bootstrap-updated";
const BRIDGE_METADATA = {
  metadataLabel: "hellm bridge metadata",
  parseLine: createJsonBridgeMetadataParser("hellm bridge:"),
  processLabel: "hellm",
} as const;

type LaunchableApp = LaunchedElectrobunApp;

beforeAll(async () => {
  await ensureBuilt();
});

async function createWorkspaceDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${(result.stderr || result.stdout || "").trim()}`,
    );
  }
}

async function withHomeDir<T>(fn: (homeDir: string) => Promise<T>): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    return await fn(homeDir);
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function withWorkspaceDir<T>(
  fn: (workspaceDir: string) => Promise<T>,
  prefix = "hellm-e2e-workspace-",
): Promise<T> {
  const workspaceDir = await createWorkspaceDir(prefix);
  try {
    return await fn(workspaceDir);
  } finally {
    await rm(workspaceDir, { force: true, recursive: true });
  }
}

async function launchObservedApp(options: {
  bootstrapDelayMs?: number;
  bootstrapError?: string;
  beforeLaunch?: (context: {
    homeDir: string;
    runtimeEnv: NodeJS.ProcessEnv;
    workspaceDir: string;
  }) => Promise<void> | void;
  workspaceDir: string;
}): Promise<LaunchableApp> {
  const homeDir = await createHomeDir();
  try {
    const app = await launchElectrobunApp({
      beforeLaunch: async ({ homeDir, runtimeEnv, workspaceDir }) => {
        const controlFile = await writeE2eControl(homeDir, {
          ...(typeof options.bootstrapDelayMs === "number"
            ? { bootstrapDelayMs: options.bootstrapDelayMs }
            : {}),
          ...(options.bootstrapError ? { bootstrapError: options.bootstrapError } : {}),
          workspaceCwd: workspaceDir,
        });
        runtimeEnv.HELLM_E2E_CONTROL_PATH = controlFile;
        await options.beforeLaunch?.({ homeDir, runtimeEnv, workspaceDir });
      },
      bridgeMetadata: BRIDGE_METADATA,
      env: {
        HELLM_E2E_HEADLESS: "1",
      },
      homeDir,
      projectRoot: process.cwd(),
      ready: async () => {},
      retryLabel: "launchObservedApp",
      workspaceDir: options.workspaceDir,
    });

    return {
      ...app,
      close: async () => {
        await app.close();
        await rm(homeDir, { force: true, recursive: true });
      },
    };
  } catch (error) {
    await rm(homeDir, { force: true, recursive: true });
    throw error;
  }
}

async function launchWorkspaceApp(options: {
  homeDir?: string;
  workspaceDir: string;
}): Promise<HellmApp> {
  return await launchHellmApp({
    homeDir: options.homeDir,
    workspaceDir: options.workspaceDir,
    beforeLaunch: async ({ homeDir, runtimeEnv }) => {
      const controlFile = await writeE2eControl(homeDir, {
        workspaceCwd: options.workspaceDir,
      });
      runtimeEnv.HELLM_E2E_CONTROL_PATH = controlFile;
    },
  });
}

async function launchWorkspaceAppWithBootstrapError(options: {
  workspaceDir: string;
  bootstrapError: string;
}): Promise<LaunchableApp> {
  return await launchObservedApp({
    bootstrapError: options.bootstrapError,
    workspaceDir: options.workspaceDir,
  });
}

async function waitForWorkspaceChrome(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
  await page.locator(".workspace-titlebar").waitFor({ state: "visible" });
  await page.locator(".workspace-footer").waitFor({ state: "visible" });
}

async function waitForLoadingCard(page: Page): Promise<void> {
  await page.getByText("Starting hellm").waitFor({ state: "visible" });
}

async function waitForStartupErrorCard(page: Page, message: string): Promise<void> {
  await page.getByText("Startup failed").waitFor({ state: "visible" });
  await page.getByText(message).waitFor({ state: "visible" });
}

async function currentText(page: Page, selector: string): Promise<string> {
  return (await page.locator(selector).textContent())?.trim() ?? "";
}

async function sessionCountText(page: Page): Promise<string> {
  return (await currentText(page, ".sidebar-context")).replace(/\s+/g, " ").trim();
}

test("shows the loading card during bootstrap and clears it once the shell is ready", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchObservedApp({
      bootstrapDelayMs: 1_000,
      workspaceDir,
      beforeLaunch: async ({ homeDir, workspaceDir: launchWorkspaceDir }) => {
        const base = Date.now() - 10_000;
        await seedSessions(
          homeDir,
          Array.from({ length: 150 }, (_, index) => {
            const timestamp = base + index * 100;
            const title = `Bootstrap session ${String(index + 1).padStart(2, "0")}`;
            return {
              key: `session-${index + 1}`,
              title,
              messages: [
                userMessage(`Seed prompt ${index + 1}`, timestamp),
                assistantTextMessage(`Seed response ${index + 1}`, { timestamp: timestamp + 1 }),
              ],
            };
          }),
          launchWorkspaceDir,
        );
      },
    });
    try {
      await waitForLoadingCard(app.page);
      expect(await app.page.getByText("Starting hellm").isVisible()).toBe(true);
      expect(await app.page.getByRole("button", { name: "Open settings" }).isVisible()).toBe(false);

      await waitForWorkspaceChrome(app.page);
      expect(await app.page.getByRole("button", { name: "Open settings" }).isVisible()).toBe(true);
      expect(await app.page.getByText("Starting hellm").isVisible()).toBe(false);
    } finally {
      await app.close();
    }
  });
});

test("shows the startup error card when Bun bootstrap is forced to fail", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const bootstrapError = "Forced bootstrap failure from the e2e control file.";
    const app = await launchWorkspaceAppWithBootstrapError({
      workspaceDir,
      bootstrapError,
    });

    try {
      await waitForStartupErrorCard(app.page, bootstrapError);
      expect(await app.page.getByRole("button", { name: "Open settings" }).count()).toBe(0);
      expect(await app.page.getByText("Starting hellm").count()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

test("workspace identity follows the cwd override and git branch", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    runGit(workspaceDir, ["init"]);
    runGit(workspaceDir, ["checkout", "-b", INITIAL_BRANCH]);
    await writeFile(join(workspaceDir, "README.md"), "bootstrap identity\n", "utf8");
    runGit(workspaceDir, ["config", "user.name", "Hellm E2E"]);
    runGit(workspaceDir, ["config", "user.email", "hellm-e2e@example.com"]);
    runGit(workspaceDir, ["add", "."]);
    runGit(workspaceDir, ["commit", "-m", "initial"]);

    const app = await launchWorkspaceApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);

      expect(await currentText(app.page, ".workspace-titlebar-title")).toBe("hellm");
      expect(await currentText(app.page, ".sidebar-header-copy h2")).toBe(basename(workspaceDir));
      expect(await sessionCountText(app.page)).toContain(INITIAL_BRANCH);
      expect(await sessionCountText(app.page)).toContain("1 sessions");
    } finally {
      await app.close();
    }
  });
});

test("workspace identity hides the branch badge outside a git repo", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchWorkspaceApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);

      expect(await currentText(app.page, ".sidebar-header-copy h2")).toBe(basename(workspaceDir));
      expect(await sessionCountText(app.page)).toBe("1 sessions");
      expect(await app.page.locator(".sidebar-context span").count()).toBe(1);
    } finally {
      await app.close();
    }
  });
});

test("default provider and model bootstrap from Bun-side defaults", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchWorkspaceApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);

      expect(await currentText(app.page, ".model-control strong")).toBe("GLM-5-Turbo");
      expect(await currentText(app.page, ".thinking-field strong")).toBe(
        DEFAULT_CHAT_SETTINGS.reasoningEffort,
      );
      expect(await currentText(app.page, ".workspace-main-title")).toBe("New Session");
      expect(await currentText(app.page, ".workspace-main-meta")).toContain("Ready");
    } finally {
      await app.close();
    }
  });
});

test("branch refreshes on relaunch when the git branch changes", async () => {
  await withHomeDir(async (homeDir) => {
    await withWorkspaceDir(async (workspaceDir) => {
      runGit(workspaceDir, ["init"]);
      runGit(workspaceDir, ["checkout", "-b", INITIAL_BRANCH]);
      await writeFile(join(workspaceDir, "README.md"), "branch refresh\n", "utf8");
      runGit(workspaceDir, ["config", "user.name", "Hellm E2E"]);
      runGit(workspaceDir, ["config", "user.email", "hellm-e2e@example.com"]);
      runGit(workspaceDir, ["add", "."]);
      runGit(workspaceDir, ["commit", "-m", "initial"]);

      const firstLaunch = await launchWorkspaceApp({ homeDir, workspaceDir });
      try {
        await waitForWorkspaceChrome(firstLaunch.page);
        expect(await currentText(firstLaunch.page, ".sidebar-context")).toContain(INITIAL_BRANCH);
      } finally {
        await firstLaunch.close();
      }

      runGit(workspaceDir, ["checkout", "-b", UPDATED_BRANCH]);

      const secondLaunch = await launchWorkspaceApp({ homeDir, workspaceDir });
      try {
        await waitForWorkspaceChrome(secondLaunch.page);
        expect(await currentText(secondLaunch.page, ".sidebar-context")).toContain(UPDATED_BRANCH);
        expect(await currentText(secondLaunch.page, ".sidebar-context")).not.toContain(
          INITIAL_BRANCH,
        );
      } finally {
        await secondLaunch.close();
      }
    });
  });
});
