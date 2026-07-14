import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENT_SETTINGS } from "../src/shared/agent-settings";
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
  await page.getByTestId("dockview-workbench").waitFor({ state: "visible" });
}

async function currentText(page: SvvyApp["page"], selector: string): Promise<string> {
  return (
    (await page.locator(selector).filter({ visible: true }).first().textContent())?.trim() ?? ""
  );
}

async function waitForText(
  page: SvvyApp["page"],
  selector: string,
  expected: string,
): Promise<void> {
  const target = page.locator(selector).filter({ hasText: expected, visible: true }).first();
  await target.waitFor({ state: "visible", timeout: 15_000 });
  expect((await target.textContent())?.trim()).toBe(expected);
}

test("default provider and model bootstrap from Bun-side defaults", async () => {
  await withWorkspaceDir(async (workspaceDir) => {
    const app = await launchSvvyApp({ workspaceDir });
    try {
      await waitForWorkspaceChrome(app.page);
      const createButton = app.page
        .getByRole("button", { name: "Create a new orchestrator" })
        .filter({ visible: true });
      await createButton.waitFor({ state: "visible" });
      await createButton.click();
      await app.page.locator(".composer-shell").waitFor({ state: "visible" });

      await waitForText(app.page, ".model-control .compact-combobox-label", "GLM-5-Turbo");

      expect(await currentText(app.page, ".model-control .compact-combobox-label")).toBe(
        "GLM-5-Turbo",
      );
      expect(await currentText(app.page, ".thinking-field .compact-select-label")).toBe(
        DEFAULT_AGENT_SETTINGS.reasoningEffort,
      );
      expect(await currentText(app.page, "[data-testid=active-surface-title]")).toBe(
        "New orchestrator",
      );
      expect(await app.page.locator(".composer-shell").isVisible()).toBe(true);
    } finally {
      await app.close();
    }
  });
});
