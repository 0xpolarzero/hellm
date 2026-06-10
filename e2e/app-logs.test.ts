import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { SvvyApp } from "./harness";
import { ensureBuilt, withSvvyApp } from "./harness";
import { seedAppLogs } from "./support";

setDefaultTimeout(90_000);

const SECRET_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890";
const UI_TIMEOUT = 15_000;

beforeAll(async () => {
  await ensureBuilt();
});

type Page = SvvyApp["page"];

async function waitForAppLogPaneText(
  page: Page,
  text: string,
  timeoutMs = UI_TIMEOUT,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const paneText = await page.locator(".app-logs-pane").textContent();
      if (typeof paneText === "string" && paneText.includes(text)) {
        return;
      }
    } catch {
      // The browser-tools bridge has a short per-request timeout; keep polling until our deadline.
    }
    await Bun.sleep(150);
  }
  throw new Error(`Timed out waiting for app log pane text: ${text}`);
}

test("renders seeded app logs with badges, redaction, filters, and mark-read behavior", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedAppLogs(
          homeDir,
          [
            ...Array.from({ length: 12 }, (_, index) => ({
              level: "info" as const,
              source: "workspace" as const,
              message: `Background workspace log ${String(index + 1).padStart(2, "0")}`,
            })),
            {
              level: "warn",
              source: "auth.provider",
              message: `Provider token Authorization=Bearer ${SECRET_TOKEN}`,
              details: {
                apiKey: `sk-${SECRET_TOKEN}`,
                harmless: "visible-detail",
              },
            },
            {
              level: "error",
              source: "execute_typescript",
              message: "Seeded compile failure",
              commandId: "cmd-seeded-logs",
              artifactId: "artifact-seeded-logs",
              workspaceSessionId: "session-seeded-logs",
            },
          ],
          workspaceDir,
        );
      },
    },
    async ({ page }) => {
      const logsButton = page.getByRole("button", {
        name: "Open app logs: 1 errors, 1 warnings unread",
      });
      await logsButton.waitFor({ state: "visible", timeout: UI_TIMEOUT });
      await logsButton.click({ force: true });

      const pane = page.locator(".app-logs-pane");
      await pane.waitFor({ state: "visible", timeout: UI_TIMEOUT });
      await waitForAppLogPaneText(page, "entries");
      await waitForAppLogPaneText(page, "Seeded compile failure");
      expect((await pane.textContent()).includes(SECRET_TOKEN)).toBe(false);
      await waitForAppLogPaneText(page, "[REDACTED]");
      expect(await pane.locator(".logs-virtual-spacer").count()).toBe(1);

      await pane
        .getByRole("button", {
          name: "Error logs: 1 log",
        })
        .click({ force: true });
      await waitForAppLogPaneText(page, "Seeded compile failure");
      expect((await pane.textContent()).includes("Provider token")).toBe(false);

      await pane.locator('input[aria-label="Search app logs"]').fill("cmd-seeded-logs");
      await waitForAppLogPaneText(page, "Seeded compile failure");
      await waitForAppLogPaneText(page, "cmd-seeded-logs");

      await pane.getByRole("button", { name: "Mark all read" }).click({ force: true });
      await page
        .getByRole("button", {
          name: "Open app logs",
        })
        .waitFor({ state: "visible", timeout: UI_TIMEOUT });
    },
  );
});
