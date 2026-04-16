import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CHAT_SETTINGS } from "../src/mainview/chat-settings";
import { ensureBuilt, launchSvvyApp, type SvvyApp } from "./harness";

setDefaultTimeout(60_000);

beforeAll(async () => {
  await ensureBuilt();
});

async function createWorkspaceDir(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function withWorkspaceDir<T>(
  fn: (workspaceDir: string) => Promise<T>,
  prefix = "svvy-e2e-workspace-",
): Promise<T> {
  const workspaceDir = await createWorkspaceDir(prefix);
  try {
    return await fn(workspaceDir);
  } finally {
    await rm(workspaceDir, { force: true, recursive: true });
  }
}

async function waitForWorkspaceChrome(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
  await page.locator(".workspace-titlebar").waitFor({ state: "visible" });
  await page.locator(".workspace-footer").waitFor({ state: "visible" });
}

async function currentText(page: SvvyApp["page"], selector: string): Promise<string> {
  return (await page.locator(selector).textContent())?.trim() ?? "";
}

test("shows the workspace chrome once the shell is ready", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchSvvyApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);
      expect(await app.page.getByRole("button", { name: "Open settings" }).isVisible()).toBe(true);
      expect(await currentText(app.page, ".workspace-main-title")).toBe("New Session");
      expect(await currentText(app.page, ".workspace-main-meta")).toContain("Ready");
    } finally {
      await app.close();
    }
  });
});

test("default provider and model bootstrap from Bun-side defaults", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchSvvyApp({ workspaceDir });
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
