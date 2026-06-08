import { expect, test } from "@playwright/test";

/**
 * The Arc-style sidebar rail (aside.chat-rail) can be collapsed shut and
 * reopened. Collapsing is a drag on the rail's resize handle past the snap-shut
 * threshold; once shut the rail is hidden and a "Show chat panel" tab appears on
 * the canvas to bring it back. Assertions stay behavioral — rail present/hidden
 * and the restore affordance — never exact pixel widths, which the drag owns.
 */
test.describe("sidebar chat rail collapse/restore", () => {
  test("collapses the rail shut and restores it", async ({ page }) => {
    await page.goto("/");

    // Switch into the Arc-style shell; the rail only exists in sidebar mode.
    await page.getByRole("button", { name: "Switch to sidebar layout" }).click();
    const shell = page.locator("main.app-shell");
    await expect(shell).toHaveAttribute("data-mode", "sidebar");

    const rail = page.locator("aside.chat-rail");
    await expect(rail).toBeVisible();
    // While open there's no reopen tab.
    await expect(page.getByRole("button", { name: "Show chat panel" })).toHaveCount(0);

    // Drag the resize handle leftward past the snap-shut threshold. Using the
    // real pointer drives the rail's pointer-capture path, the same gesture a
    // user performs; the final x (near the viewport's left edge) is well under
    // the collapse cutoff, so the rail snaps closed regardless of its width.
    const resizer = page.getByRole("separator", { name: "Resize chat panel" });
    const handle = await resizer.boundingBox();
    if (!handle) {
      throw new Error("rail resizer has no bounding box");
    }
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(8, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();

    // The rail is shut and the reopen tab takes its place. Still sidebar mode.
    await expect(rail).toBeHidden();
    const restore = page.getByRole("button", { name: "Show chat panel" });
    await expect(restore).toBeVisible();
    await expect(shell).toHaveAttribute("data-mode", "sidebar");

    // Reopen from the tab: the rail comes back and the tab goes away.
    await restore.click();
    await expect(rail).toBeVisible();
    await expect(page.getByRole("button", { name: "Show chat panel" })).toHaveCount(0);
  });
});
