import { expect, test } from "@playwright/test";

/**
 * Diff and VCS feature slash commands. Both post a card into the chat transcript
 * (the role="log" live region) rather than navigating: `/diff <id>` renders a
 * DiffCard with file tabs + the selected file's hunks (src/diff/DiffCard.tsx,
 * seeded from authRefactorDiff.ts), and `/vcs` renders a VcsCard showing the
 * working tree (src/vcs/VcsCard.tsx, seeded from the git tree in vcs.ts).
 *
 * No route mocking: the slash is parsed in ComposerBar → runSlash, which posts
 * the card synchronously. Assertions ride the cards' own test ids, classes, and
 * the seeded file/diff content so they survive the router/zustand churn.
 */
test.describe("diff and vcs cards", () => {
  test("/diff auth posts a DiffCard with file hunks in the transcript", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/diff auth");
    await input.press("Enter");

    // The card lands inside the conversation log, behind its accompanying line.
    const transcript = page.getByRole("log");
    await expect(transcript.getByText("Here's what changed.")).toBeVisible();

    const card = transcript.getByTestId("diff-card");
    await expect(card).toBeVisible();
    // Header carries the seeded diff title and the total delta counts.
    await expect(card.locator(".card-title")).toHaveText("Changes · auth refactor");
    await expect(card.locator(".card-sub .delta-add")).toHaveText("+67");
    await expect(card.locator(".card-sub .delta-del")).toHaveText("−234");

    // Every seeded file is a tab; the first is active by default.
    const tabs = card.locator(".file-tab");
    await expect(tabs.filter({ hasText: "auth/session.ts" })).toHaveCount(1);
    await expect(tabs.filter({ hasText: "auth/token.ts" })).toHaveCount(1);
    await expect(tabs.filter({ hasText: "auth/index.ts" })).toHaveCount(1);
    await expect(card.locator(".file-tab.is-on")).toHaveText("auth/session.ts");

    // The active file's hunks render added and removed lines with their text.
    await expect(
      card.locator(".diff-line.add .diff-text", {
        hasText: "const token = sign(user.id, { ttl: ROTATE_TTL })",
      }),
    ).toBeVisible();
    await expect(
      card.locator(".diff-line.del .diff-text", {
        hasText: "const token = sign(user.id)",
      }),
    ).toBeVisible();

    // Picking a different file tab swaps the hunks to that file's lines.
    await tabs.filter({ hasText: "auth/token.ts" }).click();
    await expect(card.locator(".file-tab.is-on")).toHaveText("auth/token.ts");
    await expect(
      card.locator(".diff-line.add .diff-text", {
        hasText: "return jwt.sign({ id }, { expiresIn: ttl })",
      }),
    ).toBeVisible();
  });

  test("/vcs posts a VcsCard showing the working tree in the transcript", async ({ page }) => {
    await page.goto("/");

    const input = page.getByRole("textbox", { name: "Message Smithers" });
    await input.fill("/vcs");
    await input.press("Enter");

    const transcript = page.getByRole("log");
    await expect(transcript.getByText("Here's the working tree.")).toBeVisible();

    const card = transcript.getByTestId("vcs-card");
    await expect(card).toBeVisible();
    // Header shows the branch and aggregate counts off the seeded git tree.
    await expect(card.locator(".card-title")).toHaveText("Changes");
    await expect(card.locator(".card-sub")).toContainText("feat/vcs-dashboard");
    await expect(card.locator(".card-sub .delta-add")).toHaveText("+302");
    await expect(card.locator(".card-sub .delta-del")).toHaveText("−213");

    // The seeded tree has six changes; the card lists the first four with paths
    // and status glyphs, then a "+2 more" overflow row.
    const rows = card.locator(".list-row");
    await expect(rows).toHaveCount(4);
    await expect(card.locator(".vcs-path", { hasText: "VcsCanvas.tsx" })).toBeVisible();
    await expect(card.locator(".vcs-path", { hasText: "CardView.tsx" })).toBeVisible();
    await expect(card.locator(".vcs-glyph")).toHaveCount(4);
    await expect(card.locator(".vcs-more")).toHaveText("+2 more");

    // The footer's commit verb names how many files are staged (two seeded).
    await expect(card.getByRole("button", { name: "Commit (2)" })).toBeVisible();
  });
});
