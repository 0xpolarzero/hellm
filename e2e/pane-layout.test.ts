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

test("splits, resizes, and closes the durable pane grid", async () => {
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

        const firstBox = await app.page.locator('[data-testid="workspace-pane"]').nth(0).boundingBox();
        const secondBox = await app.page.locator('[data-testid="workspace-pane"]').nth(1).boundingBox();
        expect(firstBox).not.toBeNull();
        expect(secondBox).not.toBeNull();
        expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(secondBox!.x + 2);

        await app.page.locator('[data-testid="pane-resize-vertical"]').nth(1).click();
        const resizedFirstBox = await app.page.locator('[data-testid="workspace-pane"]').nth(0).boundingBox();
        expect(resizedFirstBox!.width).not.toBe(firstBox!.width);

        await app.page.locator('[data-testid="pane-split-below"]').click();
        expect(await app.page.locator('[data-testid="workspace-pane"]').count()).toBe(3);

        await app.page.locator('[data-testid="pane-close"]').click();
        expect(await app.page.locator('[data-testid="workspace-pane"]').count()).toBe(2);
        const leftAfterClose = await app.page.locator('[data-testid="workspace-pane"]').nth(0).boundingBox();
        const rightAfterClose = await app.page.locator('[data-testid="workspace-pane"]').nth(1).boundingBox();
        expect(leftAfterClose).not.toBeNull();
        expect(rightAfterClose).not.toBeNull();
        expect(Math.abs(leftAfterClose!.height - rightAfterClose!.height)).toBeLessThanOrEqual(2);
      },
  );
});
