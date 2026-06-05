import { expect, test } from "../support/test";
import {
  SEEDED_MEMORY_FACTS,
  SEEDED_SCORES,
  SEEDED_JJHUB_STATE,
} from "../fixtures/seededData";

/**
 * Discovery surfaces: Memory, Scores, Search. REAL backend — no `page.route`,
 * no `mockGateway`. The browser makes real same-origin fetches to the booted
 * workspace-API server (vite proxies `/__smithers_studio` → workspaceApiServer),
 * which serves the deterministic memory / scores / search state from
 * `tests/fixtures/seededData.ts`. Assertions are on those exact seeded values.
 */

/** Resolve a seeded memory fact's human-readable value (the JSON `fact` field). */
function memoryFactText(key: string): string {
  const fact = SEEDED_MEMORY_FACTS.find((entry) => entry.key === key);
  if (!fact) throw new Error(`No seeded memory fact for key ${key}`);
  return (JSON.parse(fact.valueJson) as { fact: string }).fact;
}

const DEPLOY_FACT = SEEDED_MEMORY_FACTS[0]; // key: deploy-window
const OWNER_FACT = SEEDED_MEMORY_FACTS[1]; // key: owner

async function openMoreSurface(page: import("@playwright/test").Page, label: string) {
  await page.goto("/");
  // The More section is collapsed by default; expand it, then click the row.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByTestId(`nav.${label}`).click();
}

test("Memory lists seeded facts and filters via the real /memory endpoint", async ({ page }) => {
  await openMoreSurface(page, "Memory");

  await expect(page.getByTestId("view.memory")).toBeVisible();
  // Both seeded facts render from the real backend.
  await expect(page.getByTestId("memory.row")).toHaveCount(SEEDED_MEMORY_FACTS.length);
  await expect(page.getByText(DEPLOY_FACT.key, { exact: true })).toBeVisible();
  await expect(page.getByText(OWNER_FACT.key, { exact: true })).toBeVisible();

  // Interaction: the search box re-queries the server; "owner" matches only the
  // owner fact's key (deploy-window's key/value contain no "owner").
  await page.getByTestId("memory.search").fill(OWNER_FACT.key);
  await expect(page.getByText(OWNER_FACT.key, { exact: true })).toBeVisible();
  await expect(page.getByText(DEPLOY_FACT.key, { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("memory.row")).toHaveCount(1);

  // Interaction: select the surviving fact and confirm its real value renders.
  await page.getByTestId("memory.row").first().click();
  await expect(page.getByTestId("memory.detail")).toContainText(memoryFactText(OWNER_FACT.key));
});

test("Scores renders seeded aggregates and rows from the real /scores endpoint", async ({ page }) => {
  await openMoreSurface(page, "Scores");

  await expect(page.getByTestId("view.scores")).toBeVisible();

  // The two seeded scorers aggregate by scorerId — Faithfulness + Relevancy.
  const scorerNames = [...new Set(SEEDED_SCORES.map((row) => row.scorerName))];
  for (const name of scorerNames) {
    await expect(page.getByTestId("scores.aggregates")).toContainText(name);
  }
  await expect(page.getByTestId("scores.row")).toHaveCount(SEEDED_SCORES.length);

  // Interaction: scope to the one seeded run. Every seeded score belongs to that
  // run, so the filtered row count equals the total.
  const seededRunId = SEEDED_SCORES[0].runId;
  const runsWithScores = [...new Set(SEEDED_SCORES.map((row) => row.runId))];
  await page.getByTestId("scores.runfilter").selectOption(seededRunId);
  const expectedRows = SEEDED_SCORES.filter((row) => row.runId === seededRunId).length;
  await expect(page.getByTestId("scores.row")).toHaveCount(expectedRows);
  // Sanity: only one run produced scores in the seed, so this filter is real.
  expect(runsWithScores).toEqual([seededRunId]);
});

test("Search queries the real /search endpoint and supports scope switching", async ({ page }) => {
  await openMoreSurface(page, "Search");

  await expect(page.getByTestId("view.search")).toBeVisible();

  // Code scope searches seeded memory keys; "deploy" matches only deploy-window
  // (the owner fact's key contains no "deploy"), so exactly one real result.
  await page.getByTestId("search.input").fill("deploy");
  await expect(page.getByTestId("search.result")).toHaveCount(1);
  await expect(page.getByTestId("search.result")).toContainText(DEPLOY_FACT.key);

  // Interaction: switch to issues scope; "studio" matches both seeded JJHub issue
  // titles, and the re-query swaps in exactly those real issue results.
  await page.getByTestId("search.scope.issues").click();
  await page.getByTestId("search.input").fill("studio");
  const studioIssueTitles = SEEDED_JJHUB_STATE.issues
    .filter((issue) => issue.title.toLowerCase().includes("studio"))
    .map((issue) => issue.title);
  expect(studioIssueTitles.length).toBeGreaterThan(0);
  await expect(page.getByTestId("search.result")).toHaveCount(studioIssueTitles.length);
  for (const title of studioIssueTitles) {
    await expect(
      page.getByTestId("search.result").filter({ hasText: title }),
    ).toHaveCount(1);
  }
});
