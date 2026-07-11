import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { basename } from "node:path";
import { ensureBuilt, withSvvyApp } from "./harness";
import { assistantTextMessage, seedSessions, userMessage } from "./support";

setDefaultTimeout(90_000);

const TIMELINE = Date.parse("2026-04-10T10:00:00.000Z");

beforeAll(async () => {
  await ensureBuilt();
});

test("renders the integrated workspace tab counters and selectable A/B/C layout slots", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedSessions(
          homeDir,
          [
            {
              key: "alpha",
              title: "Header Alpha",
              messages: [
                userMessage("Alpha request", TIMELINE + 60_000),
                assistantTextMessage("Alpha response", {
                  timestamp: TIMELINE + 60_500,
                }),
              ],
            },
            {
              key: "beta",
              title: "Header Beta",
              messages: [
                userMessage("Beta request", TIMELINE + 5 * 60_000),
                assistantTextMessage("Beta response", { timestamp: TIMELINE + 5 * 60_000 + 500 }),
              ],
            },
          ],
          workspaceDir,
        );
      },
    },
    async ({ page, workspaceDir }) => {
      const workspaceTab = page.locator(".workspace-tab.active");
      await workspaceTab.waitFor({ state: "visible" });
      expect((await workspaceTab.locator(".workspace-tab-label").textContent())?.trim()).toBe(
        basename(workspaceDir),
      );
      expect(await workspaceTab.locator(".workspace-tab-count").count()).toBe(0);

      const layoutTabs = page.locator(".workspace-layout-tab");
      const layoutLabels: string[] = [];
      for (let index = 0; index < (await layoutTabs.count()); index += 1) {
        layoutLabels.push((await layoutTabs.nth(index).textContent())?.trim() ?? "");
      }
      expect(layoutLabels).toEqual(["A", "B", "C"]);
      expect((await page.locator(".workspace-layout-tab.active").textContent())?.trim()).toBe("A");
      expect(await page.locator(".workspace-layout-tab.initialized").count()).toBe(0);
      expect(await page.locator(".workspace-layout-tab.empty").count()).toBe(3);

      await page
        .locator(".session-main")
        .filter({ has: page.getByText("Header Beta", { exact: true }) })
        .click({ force: true });
      await page.locator('[data-testid="workspace-pane"]').waitFor({ state: "visible" });
      expect((await page.locator(".workspace-layout-tab.initialized").textContent())?.trim()).toBe(
        "A",
      );
      expect(await page.locator(".workspace-layout-tab.empty").count()).toBe(2);

      await layoutTabs.nth(1).click({ force: true });

      await page.locator(".workspace-layout-tab.active.empty").waitFor({ state: "visible" });
      expect((await page.locator(".workspace-layout-tab.active").textContent())?.trim()).toBe("B");
      expect(await page.locator(".workspace-layout-tab.active.empty").count()).toBe(1);
    },
  );
});
