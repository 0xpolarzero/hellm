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
    await page.getByTestId("dockview-watermark").waitFor({ state: "visible" });

    expect(await page.locator(".workspace-titlebar-title").textContent()).toBe("svvy");
    await page.getByText("Sessions 0").waitFor({ state: "visible" });
    expect(await page.locator(".session-item").count()).toBe(0);
    expect((await page.getByTestId("dockview-watermark").textContent()) ?? "").toContain(
      "No panes open",
    );
    expect(await page.locator("[data-testid=active-surface-title]").count()).toBe(0);
    expect(await page.locator(".composer-shell").count()).toBe(0);
  });
});
