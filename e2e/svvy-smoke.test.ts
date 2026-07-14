import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveElectrobunBuildTargetDir } from "electrobun-e2e";
import { sha256File, type E2EEmbeddedBunReceipt } from "../scripts/e2e-embedded-bun";
import { ensureBuilt, PROJECT_ROOT_DIR, withSvvyApp } from "./harness";

const startupLaunchCount = Number.parseInt(process.env.SVVY_E2E_STARTUP_SOAK_LAUNCHES ?? "1", 10);
if (!Number.isInteger(startupLaunchCount) || startupLaunchCount < 1) {
  throw new Error("SVVY_E2E_STARTUP_SOAK_LAUNCHES must be a positive integer.");
}

setDefaultTimeout(Math.max(30_000, startupLaunchCount * 30_000));

beforeAll(async () => {
  await ensureBuilt();
});

test.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "x64 app bundle embeds the pinned CPU-compatible Orb runner Bun",
  async () => {
    const buildTargetDir = resolveElectrobunBuildTargetDir(PROJECT_ROOT_DIR);
    const receipt = JSON.parse(
      await readFile(join(buildTargetDir, "svvy-dev", "e2e-embedded-bun.json"), "utf8"),
    ) as E2EEmbeddedBunReceipt;

    expect(receipt.version).toBe(Bun.version);
    expect(receipt.sourcePath).toBe(process.execPath);
    expect(receipt.destinationPath).toBe(join(buildTargetDir, "svvy-dev", "bin", "bun"));
    expect(receipt.sourceSha256).toBe(await sha256File(process.execPath));
    expect(receipt.sha256).toBe(await sha256File(receipt.destinationPath));
    expect(receipt.sha256).toBe(receipt.sourceSha256);
  },
);

test(`real app boots and renders the workspace shell across ${startupLaunchCount} launch(es)`, async () => {
  for (let launch = 0; launch < startupLaunchCount; launch += 1) {
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
  }
});
