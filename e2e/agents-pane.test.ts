import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { seedInitialExtensionSnapshot } from "./support";

setDefaultTimeout(90_000);

beforeAll(async () => {
  await ensureBuilt();
});

async function openAgentsPane(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open agent profiles" }).click();
  await page.getByTestId("agents-pane").waitFor({ state: "visible" });
}

async function agentsPaneText(page: SvvyApp["page"]): Promise<string> {
  return (await page.getByTestId("agents-pane").textContent()) ?? "";
}

async function waitForAgentsPaneTokens(page: SvvyApp["page"]): Promise<string> {
  await page.locator(".profile-extension-total").waitFor({ state: "visible" });
  return await agentsPaneText(page);
}

test("keeps expanded agent token counts visible across extension state refresh", async () => {
  await withSvvyApp(
    {
      openInitialWorkspace: false,
      beforeLaunch: async ({ homeDir }) => {
        await seedInitialExtensionSnapshot(homeDir);
      },
    },
    async ({ driver, page }) => {
      await openAgentsPane(page);

      await page.locator('button[aria-label="Expand Default"]').click();
      const initialText = await waitForAgentsPaneTokens(page);

      expect(initialText).toContain("tokens total");
      expect(initialText).not.toContain("Preview failed");
      expect(await page.locator(".agents-error").count()).toBe(0);

      const shellOff = page.getByRole("button", { name: "Shell usage state: set Off" });
      await shellOff.waitFor({ state: "visible" });
      const agentsChangedSince = new Date().toISOString();
      await shellOff.click();
      await page
        .getByRole("button", { name: "Shell usage state: Off" })
        .waitFor({ state: "visible" });
      let sawAgentsInvalidation = false;
      for await (const event of driver.eventsTail({
        follow: false,
        since: agentsChangedSince,
        types: "app_read_model.changed",
      })) {
        const invalidation = event.payload?.invalidation;
        if (
          invalidation &&
          typeof invalidation === "object" &&
          "model" in invalidation &&
          invalidation.model === "agents"
        ) {
          sawAgentsInvalidation = true;
        }
      }
      if (!sawAgentsInvalidation) {
        throw new Error(
          "Changing Shell usage did not commit the expected agents read-model update.",
        );
      }
      const refreshText = await waitForAgentsPaneTokens(page);

      expect(refreshText).toContain("tokens total");
      expect(refreshText).not.toContain("Preview failed");
      expect(await page.locator(".agents-error").count()).toBe(0);
      expect(await page.getByTestId("agents-pane").isVisible()).toBe(true);
    },
  );
});
