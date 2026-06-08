import { expect, test } from "@playwright/test";
import {
  factsInNamespace,
  MEMORY_FACTS,
  namespaces,
} from "../../src/memory/memoryFacts";

const SEEDED_FACTS = MEMORY_FACTS;

/**
 * The `/memory` canvas. Two modes — Facts table with a namespace filter, and a
 * Recall query that runs against the seeded facts. Determinism comes from
 * SEEDED_FACTS (no Date.now), so counts and namespaces can be derived from the
 * same module the canvas reads.
 */
test.describe("memory canvas", () => {
  test("deep-link to /memory renders every seeded fact + namespace pills", async ({
    page,
  }) => {
    await page.goto("/memory");
    await expect(page.getByTestId("memory-canvas")).toBeVisible();

    // The Facts mode is the default.
    await expect(page.getByTestId("memory-facts")).toBeVisible();
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(
      SEEDED_FACTS.length,
    );

    // The All-Namespaces pill plus one per distinct namespace.
    const distinctNamespaces = namespaces(SEEDED_FACTS).length;
    await expect(
      page.getByTestId("memory-namespaces").locator(".mem-ns-pill"),
    ).toHaveCount(distinctNamespaces + 1);
  });

  test("clicking a namespace pill filters the table", async ({ page }) => {
    await page.goto("/memory");
    const first = namespaces(SEEDED_FACTS)[0];
    const expected = factsInNamespace(SEEDED_FACTS, first).length;

    await page
      .getByTestId("memory-namespaces")
      .getByRole("button", { name: first, exact: true })
      .click();
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(expected);

    // All-Namespaces restores the full set.
    await page
      .getByTestId("memory-namespaces")
      .getByRole("button", { name: "All Namespaces" })
      .click();
    await expect(page.getByTestId("memory-fact-row")).toHaveCount(
      SEEDED_FACTS.length,
    );
  });

  test("opening a fact shows its detail with Back to list returning", async ({
    page,
  }) => {
    await page.goto("/memory");
    await page.getByTestId("memory-fact-row").first().click();

    await expect(page.getByTestId("memory-fact-detail")).toBeVisible();
    await expect(page.locator(".mem-value-block")).toBeVisible();
    await page.getByRole("button", { name: /Back to list/ }).click();
    await expect(page.getByTestId("memory-facts")).toBeVisible();
  });

  test("Recall mode keyboard Enter runs the search and Search button gates on text", async ({
    page,
  }) => {
    await page.goto("/memory");
    await page
      .getByTestId("memory-mode")
      .getByRole("button", { name: "Recall" })
      .click();

    await expect(page.getByTestId("memory-recall-idle")).toBeVisible();
    const search = page.getByTestId("memory-search");
    await expect(search).toBeDisabled();

    const query = page.getByTestId("memory-recall-query");
    await query.fill("auth");
    await expect(search).toBeEnabled();
    await query.press("Enter");

    // Either the recall returned hits OR the empty state — both are real, but
    // the idle/disabled state must be gone.
    await expect(page.getByTestId("memory-recall-idle")).toHaveCount(0);
  });
});
