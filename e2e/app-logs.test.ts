import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, withSvvyApp } from "./harness";
import { seedAppLogs } from "./support";

setDefaultTimeout(90_000);

const SECRET_TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEF1234567890";
const UI_TIMEOUT = 15_000;

beforeAll(async () => {
  await ensureBuilt();
});

function sinceNow(): string {
  return new Date().toISOString();
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
    async ({ driver, page }) => {
      const logsButton = page.getByRole("button", {
        name: "Open app logs: 1 errors, 1 warnings unread",
      });
      await logsButton.waitFor({ state: "visible", timeout: UI_TIMEOUT });
      const markReadSince = sinceNow();
      await logsButton.click();

      const pane = page.locator(".app-logs-pane");
      await pane.waitFor({ state: "visible", timeout: UI_TIMEOUT });
      await pane.getByText("Background workspace log 12").waitFor({ state: "visible" });
      await pane.getByText("Seeded compile failure").waitFor({ state: "visible" });
      expect(((await pane.textContent()) ?? "").includes(SECRET_TOKEN)).toBe(false);
      await pane.getByText("[REDACTED]").waitFor({ state: "visible" });
      expect(await pane.locator(".logs-virtual-spacer").count()).toBe(1);

      await pane
        .getByRole("button", {
          name: "Error logs: 1 log",
        })
        .click();
      await pane.getByText("Seeded compile failure").waitFor({ state: "visible" });
      expect(((await pane.textContent()) ?? "").includes("Provider token")).toBe(false);

      await pane.locator('input[aria-label="Search app logs"]').fill("cmd-seeded-logs");
      await pane.getByText("Seeded compile failure").waitFor({ state: "visible" });
      await pane.getByRole("button", { name: "Expand Seeded compile failure" }).first().click();
      await pane.getByText("cmd-seeded-logs").waitFor({ state: "visible" });

      let sawAppLogsInvalidation = false;
      for await (const event of driver.eventsTail({
        follow: false,
        since: markReadSince,
        types: "workspace_read_model.changed",
      })) {
        const invalidation = event.payload?.invalidation;
        if (
          invalidation &&
          typeof invalidation === "object" &&
          "model" in invalidation &&
          invalidation.model === "appLogs"
        ) {
          sawAppLogsInvalidation = true;
        }
      }
      if (!sawAppLogsInvalidation) {
        throw new Error("Opening app logs did not commit the expected appLogs read-model update.");
      }
      await page
        .getByRole("button", { name: "Open app logs" })
        .waitFor({ state: "visible", timeout: UI_TIMEOUT });
    },
  );
});
