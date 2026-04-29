import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, withSvvyApp, type SvvyApp } from "./harness";
import {
  assistantTextMessage,
  seedSessions,
  toolCall,
  toolResultMessage,
  userMessage,
} from "./support";

setDefaultTimeout(90_000);

const TIMELINE = Date.parse("2026-04-10T10:00:00.000Z");

beforeAll(async () => {
  await ensureBuilt();
});

async function launchWithSeededSessions(fn: (app: SvvyApp) => Promise<void>): Promise<void> {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        const alphaToolCall = toolCall("run_command", { command: "echo alpha" });
        await seedSessions(
          homeDir,
          [
            {
              key: "alpha",
              title: "Header Alpha",
              messages: [
                userMessage("Alpha request", TIMELINE + 60_000),
                assistantTextMessage("Alpha response", {
                  timestamp: TIMELINE + 60_500,
                  toolCalls: [alphaToolCall],
                }),
                toolResultMessage(alphaToolCall.id, alphaToolCall.name, "alpha done", {
                  timestamp: TIMELINE + 61_000,
                }),
              ],
            },
            {
              key: "beta",
              title: "Header Beta",
              messages: [
                userMessage("Beta request", TIMELINE + 5 * 60_000),
                assistantTextMessage("Beta response", { timestamp: TIMELINE + 5 * 60_000 + 500 }),
              ],
            },
          ],
          workspaceDir,
        );
      },
    },
    fn,
  );
}

async function clickSessionByTitle(page: SvvyApp["page"], title: string): Promise<void> {
  const sessionButton = page
    .locator(".session-main")
    .filter({
      has: page.locator("strong").filter({ hasText: title }),
    })
    .first();
  await sessionButton.waitFor({ state: "visible" });
  await sessionButton.click({ force: true });
}

async function readLastActivityLabel(page: SvvyApp["page"]): Promise<string> {
  const label = await page
    .locator(".workspace-main-meta > span:not(.ui-badge)")
    .nth(2)
    .textContent();
  return label?.trim() ?? "";
}

async function expectHeaderMeta(
  page: SvvyApp["page"],
  expected: {
    activity: string;
    status: string;
    title: string;
    toolRuns: string;
    turns: string;
  },
): Promise<void> {
  const title = page.locator(".workspace-main-title");
  const badge = page.locator(".workspace-main-copy .ui-badge");
  const metaSpans = page.locator(".workspace-main-meta > span:not(.ui-badge)");

  await title.waitFor({ state: "visible" });
  await badge.waitFor({ state: "visible" });
  await metaSpans.first().waitFor({ state: "visible" });

  expect((await title.textContent())?.trim()).toBe(expected.title);
  expect((await badge.textContent())?.trim()).toBe(expected.status);
  expect((await metaSpans.nth(0).textContent())?.trim()).toBe(expected.turns);
  expect((await metaSpans.nth(1).textContent())?.trim()).toBe(expected.toolRuns);
  expect((await metaSpans.nth(2).textContent())?.trim()).toContain(expected.activity);
}

test("projects the main header from the active session and updates when switching sessions", async () => {
  await launchWithSeededSessions(async ({ page }) => {
    await expectHeaderMeta(page, {
      title: "Header Beta",
      status: "Ready",
      turns: "2 turns",
      toolRuns: "0 tool runs",
      activity: "Last activity",
    });
    const betaActivity = await readLastActivityLabel(page);
    expect(betaActivity).toContain("Last activity");
    expect(betaActivity).not.toBe("Waiting for first turn");

    await clickSessionByTitle(page, "Header Alpha");

    await expectHeaderMeta(page, {
      title: "Header Alpha",
      status: "Ready",
      turns: "2 turns",
      toolRuns: "1 tool run",
      activity: "Last activity",
    });
    const alphaActivity = await readLastActivityLabel(page);
    expect(alphaActivity).toContain("Last activity");
    expect(alphaActivity).not.toBe("Waiting for first turn");
    expect(alphaActivity).not.toBe(betaActivity);
  });
});
