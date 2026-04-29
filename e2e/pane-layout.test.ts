import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { assistantTextMessage, seedSessions, userMessage } from "./support";

setDefaultTimeout(120_000);

beforeAll(async () => {
  await ensureBuilt();
});

async function waitForPaneShell(page: SvvyApp["page"]): Promise<void> {
  await page.locator('[data-testid="pane-grid"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="workspace-pane"]').first().waitFor({ state: "visible" });
}

test("splits, exposes resize dividers, and closes the durable pane grid", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir: seededHome, workspaceDir }) => {
        await seedSessions(
          seededHome,
          [
            {
              title: "Pane Layout Seed",
              messages: [
                userMessage("Seed pane layout session.", 1_730_000_000_000),
                assistantTextMessage("Pane layout session is ready.", {
                  timestamp: 1_730_000_000_001,
                }),
              ],
            },
          ],
          workspaceDir,
        );
      },
    },
    async (app) => {
      await waitForPaneShell(app.page);
      expect(await app.page.locator('[data-testid="workspace-pane"]').count()).toBe(1);

      await app.page.locator('[data-testid="pane-split-right"]').click();
      await app.page.locator('[data-testid="workspace-pane"]').nth(1).waitFor({ state: "visible" });
      expect(await app.page.locator('[data-testid="workspace-pane"]').count()).toBe(2);

      const firstBox = await app.page
        .locator('[data-testid="workspace-pane"]')
        .nth(0)
        .boundingBox();
      const secondBox = await app.page
        .locator('[data-testid="workspace-pane"]')
        .nth(1)
        .boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();
      expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(secondBox!.x + 2);

      expect(await app.page.locator('[data-testid="pane-divider-vertical"]').count()).toBe(1);
      expect(await app.page.locator('[data-testid="pane-divider-add-vertical"]').count()).toBe(1);
      expect(await app.page.locator(".pane-drag-handle").count()).toBe(2);
      expect(await app.page.locator('[data-testid="pane-close-button"]').count()).toBe(2);
      expect(await app.page.locator('[data-testid="pane-close"]').count()).toBe(0);
      expect(await app.page.locator('[data-testid^="pane-span-drop-"]').count()).toBe(4);

      const dividerBox = await app.page
        .locator('[data-testid="pane-divider-vertical"]')
        .boundingBox();
      const dividerAddBox = await app.page
        .locator('[data-testid="pane-divider-add-vertical"]')
        .boundingBox();
      expect(dividerBox).not.toBeNull();
      expect(dividerAddBox).not.toBeNull();
      expect(
        Math.abs(
          dividerBox!.x + dividerBox!.width / 2 - (dividerAddBox!.x + dividerAddBox!.width / 2),
        ),
      ).toBeLessThan(1);
      expect(
        Math.abs(
          dividerBox!.y + dividerBox!.height / 2 - (dividerAddBox!.y + dividerAddBox!.height / 2),
        ),
      ).toBeLessThan(1);

      await app.page.locator('[data-testid="pane-split-below"]').click();
      expect(await app.page.locator('[data-testid="workspace-pane"]').count()).toBe(3);
      expect(await app.page.locator('[data-testid="pane-close-button"]').count()).toBe(3);

      await app.page.locator('[data-testid="pane-close-button"]').nth(2).click();
      expect(await app.page.locator('[data-testid="workspace-pane"]').count()).toBe(2);
      const leftAfterClose = await app.page
        .locator('[data-testid="workspace-pane"]')
        .nth(0)
        .boundingBox();
      const rightAfterClose = await app.page
        .locator('[data-testid="workspace-pane"]')
        .nth(1)
        .boundingBox();
      expect(leftAfterClose).not.toBeNull();
      expect(rightAfterClose).not.toBeNull();
      expect(leftAfterClose!.width).toBeGreaterThan(120);
      expect(rightAfterClose!.width).toBeGreaterThan(120);
    },
  );
});
