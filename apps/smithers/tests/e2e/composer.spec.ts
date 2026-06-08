import { expect, test } from "@playwright/test";

/**
 * Composer toolbar controls: the project pill (a menu-button that swaps the
 * active project) and the dictation toggle. These are behavior-level checks on
 * ARIA state and labels, not on the underlying Web Speech API (which is
 * unavailable / non-deterministic headless), so they survive the state/router
 * refactor as long as the controls keep their roles and accessible names.
 */
test.describe("composer controls", () => {
  /** Resolve the project pill by its menu-button role; its label is the project. */
  const projectPill = (page: import("@playwright/test").Page) =>
    page.getByRole("button", { name: "Smithers Web", exact: true });

  test("project pill opens a menu and picking a project updates the label", async ({
    page,
  }) => {
    await page.goto("/");

    const pill = projectPill(page);
    await expect(pill).toHaveAttribute("aria-haspopup", "menu");
    await expect(pill).toHaveAttribute("aria-expanded", "false");

    // Opening the pill reveals the radio menu of projects.
    await pill.click();
    await expect(pill).toHaveAttribute("aria-expanded", "true");
    const option = page.getByRole("menuitemradio", { name: "Personal" });
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute("aria-checked", "false");

    // Selecting a project closes the menu and re-labels the pill.
    await option.click();
    await expect(
      page.getByRole("menuitemradio", { name: "Personal" }),
    ).toBeHidden();
    const updated = page.getByRole("button", { name: "Personal", exact: true });
    await expect(updated).toHaveAttribute("aria-expanded", "false");

    // The chosen project sticks; reopening shows it checked.
    await updated.click();
    await expect(
      page.getByRole("menuitemradio", { name: "Personal" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("Escape closes the project menu and returns focus to the pill", async ({
    page,
  }) => {
    await page.goto("/");

    const pill = projectPill(page);
    await pill.click();
    await expect(pill).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(pill).toHaveAttribute("aria-expanded", "false");
    await expect(pill).toBeFocused();
  });

  test("an outside click closes the project menu", async ({ page }) => {
    await page.goto("/");

    const pill = projectPill(page);
    await pill.click();
    await expect(pill).toHaveAttribute("aria-expanded", "true");

    // An open menu renders a full-viewport backdrop (MenuBackdrop) that catches
    // any outside pointer-down and closes the menu — clicking it is the outside
    // click (it sits above the input, intercepting the pointer).
    await page.locator(".menu-backdrop").click();
    await expect(pill).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("menuitemradio", { name: "Personal" }),
    ).toBeHidden();
  });

  test("the dictation button exposes a label and pressed state", async ({
    page,
  }) => {
    await page.goto("/");

    // The mic toggle's accessible name depends on Web Speech support; match any
    // of its forms so the test holds whether or not the runner exposes the API.
    const mic = page.getByRole("button", {
      name: /dictation/i,
    });
    await expect(mic).toBeVisible();

    if (await mic.isEnabled()) {
      // Supported: an idle toggle starts unpressed and offers to start.
      await expect(mic).toHaveAttribute("aria-label", "Start dictation");
      await expect(mic).toHaveAttribute("aria-pressed", "false");
    } else {
      // Unsupported: the button is disabled and explains why, with no toggle state.
      await expect(mic).toHaveAttribute(
        "aria-label",
        "Dictation isn't supported in this browser",
      );
      await expect(mic).not.toHaveAttribute("aria-pressed");
    }
  });
});
