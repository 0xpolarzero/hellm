import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { connect, type Page } from "electrobun-browser-tools";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { assistantTextMessage, seedSessions, userMessage } from "./support";

setDefaultTimeout(120_000);

const PANE_LAYOUT_BRIDGE_TIMEOUT_MS = 10_000;

beforeAll(async () => {
  await ensureBuilt();
});

async function createPaneLayoutPage(app: SvvyApp): Promise<Page> {
  const driver = await connect({
    ...(app.bridgeUrl ? { url: app.bridgeUrl } : { app: app.appId }),
    timeout: PANE_LAYOUT_BRIDGE_TIMEOUT_MS,
  });
  return driver.page("active");
}

async function waitForPaneShell(page: Page): Promise<void> {
  await page.locator('[data-testid="pane-grid"]').waitFor({ state: "visible" });
  await page.locator('[data-testid="workspace-pane"]').first().waitFor({ state: "visible" });
}

async function runPaneCommand(page: Page, command: string): Promise<void> {
  await page.getByRole("button", { name: "Open command palette" }).click({ force: true });
  await page.getByTestId("command-palette").waitFor({ state: "visible" });
  await page.locator("[data-cmdk-input]").fill(command);
  await page.locator("[data-cmdk-input]").press("Enter");
  await page.getByTestId("command-palette").waitFor({ state: "hidden" });
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
      const page = await createPaneLayoutPage(app);
      await waitForPaneShell(page);
      expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(1);
      expect(await page.locator('[data-testid="pane-copy-transcript-button"]').count()).toBe(1);
      expect(await page.locator('[data-testid="pane-duplicate-button"]').count()).toBe(1);

      expect(await page.locator('[data-testid="pane-split-right"]').count()).toBe(0);
      expect(await page.locator('[data-testid="pane-split-below"]').count()).toBe(0);

      await runPaneCommand(page, "Duplicate Pane Right");
      await page.locator('[data-testid="workspace-pane"]').nth(1).waitFor({ state: "visible" });
      expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(2);

      const firstBox = await page.locator('[data-testid="workspace-pane"]').nth(0).boundingBox();
      const secondBox = await page.locator('[data-testid="workspace-pane"]').nth(1).boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();
      expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(secondBox!.x + 2);

      expect(await page.locator('[data-testid="pane-divider-vertical"]').count()).toBe(1);
      expect(await page.locator('[data-testid="pane-divider-add-vertical"]').count()).toBe(1);
      expect(await page.locator(".pane-drag-handle").count()).toBe(2);
      expect(await page.locator('[data-testid="pane-copy-transcript-button"]').count()).toBe(2);
      expect(await page.locator('[data-testid="pane-duplicate-button"]').count()).toBe(2);
      expect(await page.locator('[data-testid="pane-close-button"]').count()).toBe(2);
      expect(await page.locator('[data-testid="pane-close"]').count()).toBe(0);
      expect(await page.locator('[data-testid^="pane-span-drop-"]').count()).toBe(4);

      const dividerBox = await page.locator('[data-testid="pane-divider-vertical"]').boundingBox();
      const dividerAddBox = await page
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

      await runPaneCommand(page, "Duplicate Pane Right");
      expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(3);
      expect(await page.locator('[data-testid="pane-close-button"]').count()).toBe(3);

      await runPaneCommand(page, "Close Pane");
      expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(2);
      const leftAfterClose = await page
        .locator('[data-testid="workspace-pane"]')
        .nth(0)
        .boundingBox();
      const rightAfterClose = await page
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

test("keeps resize controls aligned when a pane spans the full bottom row", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir: seededHome, workspaceDir }) => {
        await seedSessions(
          seededHome,
          [
            {
              title: "Bottom Span Seed",
              messages: [
                userMessage("Seed bottom span layout.", 1_730_000_000_100),
                assistantTextMessage("Bottom span layout is ready.", {
                  timestamp: 1_730_000_000_101,
                }),
              ],
            },
          ],
          workspaceDir,
        );
      },
    },
    async (app) => {
      const page = await createPaneLayoutPage(app);
      await waitForPaneShell(page);

      await runPaneCommand(page, "Duplicate Pane Right");
      await page.locator('[data-testid="workspace-pane"]').nth(1).waitFor({ state: "visible" });

      await runPaneCommand(page, "Duplicate Pane Below");
      expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(3);

      await runPaneCommand(page, "Move Pane To Full-Width Bottom Row");
      expect(await page.locator('[data-testid="workspace-pane"]').count()).toBe(3);

      const paneBoxes = await Promise.all(
        [0, 1, 2].map((index) =>
          page.locator('[data-testid="workspace-pane"]').nth(index).boundingBox(),
        ),
      );
      expect(paneBoxes.every((box) => box !== null)).toBe(true);

      const boxes = paneBoxes as NonNullable<(typeof paneBoxes)[number]>[];
      const bottomPane = boxes.reduce(
        (lowest, box) => (box.y > lowest.y ? box : lowest),
        boxes[0]!,
      );
      const topPanes = boxes.filter((box) => box !== bottomPane);
      expect(topPanes).toHaveLength(2);
      expect(bottomPane.width).toBeGreaterThan(
        topPanes.reduce((sum, box) => sum + box.width, 0) - 4,
      );
      expect(bottomPane.y).toBeGreaterThan(topPanes[0]!.y + topPanes[0]!.height - 2);

      expect(await page.locator('[data-testid="pane-divider-vertical"]').count()).toBe(1);
      expect(await page.locator('[data-testid="pane-divider-horizontal"]').count()).toBe(1);

      const verticalDivider = await page
        .locator('[data-testid="pane-divider-vertical"]')
        .boundingBox();
      const horizontalDivider = await page
        .locator('[data-testid="pane-divider-horizontal"]')
        .boundingBox();
      expect(verticalDivider).not.toBeNull();
      expect(horizontalDivider).not.toBeNull();

      const topBoundary = Math.max(...topPanes.map((box) => box.y + box.height));
      expect(verticalDivider!.y).toBeLessThanOrEqual(topPanes[0]!.y + 2);
      expect(verticalDivider!.y + verticalDivider!.height).toBeLessThanOrEqual(bottomPane.y + 2);
      expect(
        Math.abs(horizontalDivider!.y + horizontalDivider!.height / 2 - topBoundary),
      ).toBeLessThan(8);
      expect(horizontalDivider!.width).toBeGreaterThan(bottomPane.width - 8);
    },
  );
});
