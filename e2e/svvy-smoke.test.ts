import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, withSvvyApp } from "./harness";

setDefaultTimeout(30_000);

beforeAll(async () => {
  await ensureBuilt();
});

test("real app boots and renders the workspace shell", async () => {
  await withSvvyApp(async ({ page }) => {
    await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
    await page.locator(".session-sidebar").waitFor({ state: "visible" });

    expect(await page.locator(".workspace-titlebar-title").textContent()).toBe("svvy");
    await page.getByText("Sessions 1").waitFor({ state: "visible" });
    expect(await page.locator(".session-item").count()).toBe(1);
    await page
      .locator(
        'textarea[placeholder="Ask svvy to inspect the repo, make a change, or delegate work."]',
      )
      .waitFor({ state: "visible" });
  });
});
