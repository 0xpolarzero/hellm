import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { SerializedDockview } from "dockview-core";
import { connect, type Page } from "electrobun-browser-tools";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { assistantTextMessage, getTestAgentDir, seedSessions, userMessage } from "./support";
import type { WorkspaceDockviewLayoutState } from "../src/mainview/pane-layout";

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

async function waitForDockviewShell(page: Page): Promise<void> {
  await page.locator('[data-testid="dockview-workbench"]').waitFor({ state: "visible" });
  await expectNoUnavailablePane(page);
}

async function expectNoUnavailablePane(page: Page): Promise<void> {
  expect(await page.locator(".dockview-empty-panel").count()).toBe(0);
  expect((await page.locator("body").textContent()).includes("Surface unavailable")).toBe(false);
}

async function waitForWorkspacePaneCount(
  page: Page,
  expectedCount: number,
  timeoutMs = 15_000,
): Promise<void> {
  const panes = page.locator('[data-testid="workspace-pane"]');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await panes.count()) === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${expectedCount} visible workspace panes.`);
}

async function waitForDockviewTabCount(
  page: Page,
  expectedCount: number,
  timeoutMs = 15_000,
): Promise<void> {
  const tabs = page.locator(".dockview-surface-tab");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await tabs.count()) === expectedCount) {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${expectedCount} Dockview tabs.`);
}

async function clickPaneAction(page: Page, name: string): Promise<void> {
  const actionClass =
    name === "Duplicate pane right"
      ? "action-split-right"
      : name === "Duplicate pane below"
        ? "action-split-below"
        : "action-close";
  await page.locator(`.dockview-surface-action.${actionClass}`).first().click({ force: true });
}

async function clickSessionByTitle(page: Page, title: string): Promise<void> {
  const sessionButton = page
    .locator(".session-main")
    .filter({
      has: page.locator("strong").filter({ hasText: title }),
    })
    .first();
  await sessionButton.waitFor({ state: "visible" });
  await sessionButton.click({ force: true });
}

function workspaceIdFor(workspaceDir: string): string {
  const canonicalWorkspace = realpathSync.native(workspaceDir);
  const hash = createHash("sha256").update(canonicalWorkspace).digest("hex").slice(0, 24);
  return `workspace:${hash}`;
}

async function seedWorkspaceUiRestore(
  homeDir: string,
  workspaceDir: string,
  layout: WorkspaceDockviewLayoutState,
): Promise<void> {
  const agentDir = getTestAgentDir(homeDir);
  await mkdir(agentDir, { recursive: true });
  const workspaceKey = `workspace:${encodeURIComponent(workspaceIdFor(workspaceDir))}`;
  await writeFile(
    join(agentDir, "app-workspace-ui-restore.json"),
    `${JSON.stringify(
      {
        [workspaceKey]: {
          version: 5,
          layouts: {
            A: layout,
            B: null,
            C: null,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
}

function serializedDockviewFixture(sessionPanelId: string): SerializedDockview {
  return {
    activeGroup: sessionPanelId,
    panels: {
      [sessionPanelId]: {
        id: sessionPanelId,
        contentComponent: "surface",
        tabComponent: "surfaceTab",
        title: "Restored Session",
        renderer: "always",
      },
      settings: {
        id: "settings",
        contentComponent: "surface",
        tabComponent: "surfaceTab",
        title: "Settings",
        renderer: "onlyWhenVisible",
      },
      logs: {
        id: "logs",
        contentComponent: "surface",
        tabComponent: "surfaceTab",
        title: "Logs",
        renderer: "onlyWhenVisible",
      },
      workflows: {
        id: "workflows",
        contentComponent: "surface",
        tabComponent: "surfaceTab",
        title: "Workflows",
        renderer: "onlyWhenVisible",
      },
    },
    grid: {
      width: 1200,
      height: 760,
      orientation: "HORIZONTAL",
      root: {
        type: "branch",
        data: [
          {
            type: "leaf",
            data: {
              id: "session-group",
              views: [sessionPanelId],
              activeView: sessionPanelId,
            },
            size: 600,
          },
          {
            type: "leaf",
            data: {
              id: "settings-group",
              views: ["settings"],
              activeView: "settings",
            },
            size: 600,
          },
        ],
        size: 1200,
      },
    },
    floatingGroups: [
      {
        data: {
          id: "floating-workflows-group",
          views: ["workflows"],
          activeView: "workflows",
        },
        position: { x: 40, y: 64, width: 520, height: 420 },
      },
    ],
    edgeGroups: {
      left: {
        size: 280,
        visible: true,
        group: {
          id: "logs-edge-group",
          views: ["logs"],
          activeView: "logs",
        },
      },
    },
  };
}

test("opens, duplicates, resizes, and closes Dockview panels without custom pane chrome", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir: seededHome, workspaceDir }) => {
        await seedSessions(
          seededHome,
          [
            {
              title: "Dockview Layout Seed",
              messages: [
                userMessage("Seed Dockview layout session.", 1_730_000_000_000),
                assistantTextMessage("Dockview layout session is ready.", {
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
      await waitForDockviewShell(page);

      await waitForWorkspacePaneCount(page, 1);
      await waitForDockviewTabCount(page, 1);
      await clickSessionByTitle(page, "Dockview Layout Seed");
      await waitForWorkspacePaneCount(page, 1);
      await waitForDockviewTabCount(page, 1);
      await expectNoUnavailablePane(page);

      await clickPaneAction(page, "Duplicate pane right");
      await waitForWorkspacePaneCount(page, 2);
      await waitForDockviewTabCount(page, 2);
      await expectNoUnavailablePane(page);

      const firstBox = await page.locator('[data-testid="workspace-pane"]').nth(0).boundingBox();
      const secondBox = await page.locator('[data-testid="workspace-pane"]').nth(1).boundingBox();
      expect(firstBox).not.toBeNull();
      expect(secondBox).not.toBeNull();
      expect(
        Math.abs(firstBox!.x - secondBox!.x) + Math.abs(firstBox!.y - secondBox!.y),
      ).toBeGreaterThan(20);

      await clickPaneAction(page, "Duplicate pane below");
      await waitForWorkspacePaneCount(page, 3);
      await waitForDockviewTabCount(page, 3);
      await expectNoUnavailablePane(page);

      await clickPaneAction(page, "Close pane");
      await waitForWorkspacePaneCount(page, 2);
      await waitForDockviewTabCount(page, 2);
      await expectNoUnavailablePane(page);
    },
  );
});

test("opens session and workspace-scoped surface panes without unavailable Dockview panels", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir: seededHome, workspaceDir }) => {
        await seedSessions(
          seededHome,
          [
            {
              title: "First Pane Target",
              messages: [
                userMessage("Seed first pane target.", 1_730_000_000_100),
                assistantTextMessage("First pane target is ready.", {
                  timestamp: 1_730_000_000_101,
                }),
              ],
            },
            {
              title: "Second Pane Target",
              messages: [
                userMessage("Seed second pane target.", 1_730_000_000_200),
                assistantTextMessage("Second pane target is ready.", {
                  timestamp: 1_730_000_000_201,
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
      await waitForDockviewShell(page);

      await waitForWorkspacePaneCount(page, 1);
      await waitForDockviewTabCount(page, 1);
      const openedSessionTitle = "First Pane Target";
      await clickSessionByTitle(page, openedSessionTitle);
      await waitForWorkspacePaneCount(page, 1);
      await waitForDockviewTabCount(page, 1);
      expect(openedSessionTitle).toMatch(/Pane Target/);
      await expectNoUnavailablePane(page);

      await page
        .getByRole("button", { name: "Open workflows" })
        .filter({ visible: true })
        .first()
        .click({ force: true });
      await page.locator(".workflows-pane").waitFor({
        state: "visible",
      });
      await waitForDockviewTabCount(page, 1);
      await expectNoUnavailablePane(page);

      await page
        .getByRole("button", { name: "Open app logs" })
        .filter({ visible: true })
        .first()
        .click({ force: true });
      await page.locator(".app-logs-pane").waitFor({ state: "visible" });
      await waitForDockviewTabCount(page, 1);
      await expectNoUnavailablePane(page);
    },
  );
});

test("restores serialized Dockview edge, floating, and focused panel state on mount", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir: seededHome, workspaceDir }) => {
        const [seededSession] = await seedSessions(
          seededHome,
          [
            {
              title: "Restored Dockview Session",
              messages: [
                userMessage("Seed serialized Dockview restore.", 1_730_000_000_300),
                assistantTextMessage("Serialized Dockview restore is ready.", {
                  timestamp: 1_730_000_000_301,
                }),
              ],
            },
          ],
          workspaceDir,
        );
        if (!seededSession) {
          throw new Error("Expected seeded restore session.");
        }

        await seedWorkspaceUiRestore(seededHome, workspaceDir, {
          dockview: serializedDockviewFixture("primary"),
          compactSurfaces: [],
          panels: [
            {
              panelId: "primary",
              binding: {
                workspaceSessionId: seededSession.id,
                surface: "orchestrator",
                surfacePiSessionId: seededSession.id,
              },
              localState: {
                scroll: { transcriptAnchorId: "assistant-restore", offsetPx: 24 },
                timelineDensity: "compact",
              },
              placement: null,
            },
            {
              panelId: "settings",
              binding: { surface: "settings" },
              localState: {
                scroll: null,
                timelineDensity: "comfortable",
              },
              placement: null,
            },
            {
              panelId: "logs",
              binding: { surface: "app-logs" },
              localState: {
                scroll: null,
                timelineDensity: "comfortable",
              },
              placement: { kind: "edge", direction: "left", size: 280 },
            },
            {
              panelId: "workflows",
              binding: { surface: "workflows" },
              localState: {
                scroll: null,
                timelineDensity: "comfortable",
              },
              placement: {
                kind: "floating",
                box: { x: 40, y: 64, width: 520, height: 420 },
              },
            },
          ],
          focusedPanelId: "settings",
          updatedAt: "2026-06-09T00:00:00.000Z",
        });
      },
    },
    async (app) => {
      const driver = await connect({
        ...(app.bridgeUrl ? { url: app.bridgeUrl } : { app: app.appId }),
        timeout: PANE_LAYOUT_BRIDGE_TIMEOUT_MS,
      });
      const page = driver.page("active");
      await waitForDockviewShell(page);

      await page.locator('[data-testid="settings-pane"]').waitFor({ state: "visible" });
      await page.locator(".app-logs-pane").waitFor({ state: "visible" });
      await page.locator(".workflows-pane").waitFor({ state: "visible" });
      await page.getByText("Serialized Dockview restore is ready.").waitFor({ state: "visible" });
      await expectNoUnavailablePane(page);

      expect(await page.locator(".dv-edge-group .app-logs-pane").count()).toBeGreaterThan(0);
      expect(await page.locator(".dv-resize-container .workflows-pane").count()).toBeGreaterThan(0);

      const activeTitle = (await page.locator('[data-testid="active-surface-title"]').textContent())
        ?.replace(/\s+/g, " ")
        .trim();
      expect(activeTitle).toBe("Settings");
      expect(await page.locator(".dockview-empty-panel").count()).toBe(0);
    },
  );
});
