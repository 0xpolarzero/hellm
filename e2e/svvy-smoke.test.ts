import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, escapeForRegExp, withSvvyApp } from "./harness";

setDefaultTimeout(30_000);

beforeAll(async () => {
  await ensureBuilt();
});

test("real app boots and renders the workspace shell", async () => {
  await withSvvyApp(async ({ page }) => {
    await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
    await page.locator(".session-sidebar").waitFor({ state: "visible" });

    expect(await page.locator(".workspace-titlebar-title").textContent()).toBe("svvy");
  });
});

test("a fresh workspace starts with one session", async () => {
  await withSvvyApp(async ({ page }) => {
    await page.getByText("1 sessions").waitFor({ state: "visible" });
    expect(await page.getByRole("button", { name: /Session actions for/ }).count()).toBe(1);
  });
});

test("rename session works on the real app", async () => {
  await withSvvyApp(async ({ page }) => {
    const nextTitle = `Smoke Renamed ${Date.now()}`;
    const firstSession = page.locator(".session-item").first();
    await firstSession.getByRole("button", { name: /Session actions for/ }).click({ force: true });
    await page.getByRole("button", { name: "Rename" }).click();

    const dialog = page.getByRole("dialog", { name: "Rename Session" });
    await dialog.waitFor({ state: "visible" });

    const titleInput = page.locator('input[placeholder="Session title"]');
    await titleInput.fill(nextTitle);
    await page.getByRole("button", { name: "Save" }).click();

    await page.getByRole("button", {
      name: new RegExp(`^Session actions for ${escapeForRegExp(nextTitle)}$`),
    }).waitFor({ state: "visible" });
    expect(await page.locator(".workspace-main-title").textContent()).toBe(nextTitle);
  });
});
