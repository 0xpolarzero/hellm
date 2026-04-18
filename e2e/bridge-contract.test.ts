import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { DEFAULT_SYSTEM_PROMPT } from "../src/bun/default-system-prompt";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { assistantTextMessage, seedProviderApiKeys, seedSessions, userMessage } from "./support";

setDefaultTimeout(60_000);

const BLANK_PROVIDER_ENV = {
  OPENAI_API_KEY: "",
  AZURE_OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  GROQ_API_KEY: "",
  CEREBRAS_API_KEY: "",
  XAI_API_KEY: "",
  OPENROUTER_API_KEY: "",
  AI_GATEWAY_API_KEY: "",
  ZAI_API_KEY: "",
  MISTRAL_API_KEY: "",
  MINIMAX_API_KEY: "",
  MINIMAX_CN_API_KEY: "",
  HF_TOKEN: "",
  OPENCODE_API_KEY: "",
  KIMI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
  GH_TOKEN: "",
} satisfies Record<string, string>;

const PROMPT_MODEL = "glm-5-turbo";
const PROMPT_PROVIDER = "zai";

beforeAll(async () => {
  await ensureBuilt();
});

function noAuthEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...BLANK_PROVIDER_ENV,
    ...overrides,
  };
}

function currentGitBranch(): string {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to read the current git branch: ${result.stderr}`);
  }

  return result.stdout.trim();
}

function stateValue<T extends Record<string, unknown>>(state: { namespace?: string; value: T }): T {
  return state.value;
}

async function waitForEvent(
  driver: SvvyApp["driver"],
  eventName: string,
  options: {
    match?: Record<string, string>;
    since?: string;
    timeout?: number;
  } = {},
) {
  const deadline = Date.now() + (options.timeout ?? 10_000);
  let lastResult: Awaited<ReturnType<SvvyApp["driver"]["eventsWait"]>> | null = null;

  while (Date.now() < deadline) {
    lastResult = await driver.eventsWait(eventName, {
      match: options.match,
      since: options.since,
      timeout: Math.min(2_000, Math.max(250, deadline - Date.now())),
    });

    if (lastResult.matched) {
      if (!lastResult.event) {
        throw new Error(`Expected event "${eventName}" but bridge returned no event.`);
      }
      return lastResult.event;
    }

    await Bun.sleep(100);
  }

  expect(lastResult?.matched ?? false).toBe(true);
  throw new Error(`Timed out waiting for bridge event "${eventName}".`);
}

function sinceNow(): string {
  return new Date(Date.now() - 1_000).toISOString();
}

function sessionMenuTrigger(page: SvvyApp["page"], title?: string) {
  if (title) {
    return page
      .locator(".session-item")
      .filter({
        has: page.getByText(title, { exact: true }),
      })
      .locator(".session-menu-trigger");
  }

  return page.locator(".session-menu-trigger").first();
}

function sessionRow(page: SvvyApp["page"], index = 0) {
  return page.locator(".session-item").nth(index);
}

async function openSettings(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByRole("dialog", { name: "Settings" }).waitFor({ state: "visible" });
}

async function openActiveSessionMenu(page: SvvyApp["page"]): Promise<void> {
  const trigger = sessionMenuTrigger(page);
  await trigger.click({ force: true });
  await page.locator(".session-menu").waitFor({ state: "visible" });
}

async function openModelPicker(page: SvvyApp["page"]): Promise<void> {
  await page.locator(".model-control").click();
  await page.getByRole("dialog", { name: "Select a model" }).waitFor({ state: "visible" });
}

async function openReasoningMenu(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Thinking level" }).click();
  await page.locator(".thinking-menu").waitFor({ state: "visible" });
}

async function selectModel(page: SvvyApp["page"], modelName: string): Promise<void> {
  const picker = page.getByRole("dialog", { name: "Select a model" });
  await picker
    .locator('input[placeholder="Search model families, providers, or ids"]')
    .fill(modelName);
  await picker.locator(".model-row").first().click({ force: true });
  await picker.waitFor({ state: "hidden" });
}

async function selectReasoningLevel(page: SvvyApp["page"], level: string): Promise<void> {
  const menu = page.locator(".thinking-menu");
  await menu.getByRole("option", { name: new RegExp(`^${level}$`, "i") }).click();
  await menu.waitFor({ state: "hidden" });
}

async function stateSnapshot(driver: SvvyApp["driver"]) {
  return {
    workspace: stateValue(await driver.stateGet("workspace")),
    defaults: stateValue(await driver.stateGet("defaults")),
    providers: stateValue(await driver.stateGet("providers")),
    sessions: stateValue(await driver.stateGet("sessions")),
  };
}

async function providerRowByName(
  page: SvvyApp["page"],
  providerName: string,
): Promise<ReturnType<SvvyApp["page"]["locator"]>> {
  const rows = page.locator(".provider-row");
  const count = await rows.count();

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const name = (await row.locator(".provider-name").textContent())?.trim() ?? "";
    if (name === providerName) {
      return row;
    }
  }

  throw new Error(`Could not find provider row for "${providerName}".`);
}

test("bridge state snapshot and app.ready expose the workspace/default/provider/session metadata", async () => {
  await withSvvyApp({ env: noAuthEnv({ ZAI_API_KEY: "stub-key" }) }, async ({ driver }) => {
    const ready = await waitForEvent(driver, "app.ready");
    const snapshot = await stateSnapshot(driver);
    const namespaces = await driver.stateList();
    const eventSummary = await driver.eventsSummary({ groupBy: "event" });

    expect(ready.payload?.workspaceId).toBe(snapshot.workspace.cwd);
    expect(typeof ready.payload?.url).toBe("string");
    expect(typeof ready.payload?.bridgeUrl === "string" || ready.payload?.bridgeUrl === null).toBe(
      true,
    );

    expect(namespaces.map((entry) => entry.namespace)).toEqual([
      "workspace",
      "defaults",
      "providers",
      "sessions",
    ]);
    expect(namespaces.map((entry) => entry.keyCount)).toEqual([4, 4, 3, 4]);

    expect(snapshot.workspace).toEqual({
      workspaceId: snapshot.workspace.cwd,
      cwd: snapshot.workspace.cwd,
      label: basename(snapshot.workspace.cwd),
      branch: currentGitBranch(),
    });
    expect(snapshot.defaults).toEqual({
      provider: PROMPT_PROVIDER,
      model: PROMPT_MODEL,
      reasoningEffort: "medium",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
    });
    expect(snapshot.providers.total).toBeGreaterThan(10);
    expect(snapshot.providers.connected).toBe(1);
    expect(snapshot.providers.items.find((provider) => provider.provider === "zai")).toMatchObject({
      provider: "zai",
      hasKey: true,
      keyType: "env",
      supportsOAuth: false,
    });
    expect(snapshot.sessions.total).toBe(1);
    expect(snapshot.sessions.activeSessionId).toBe(snapshot.sessions.active?.session.id);
    expect(snapshot.sessions.active).toMatchObject({
      messageCount: 0,
      model: PROMPT_MODEL,
      provider: PROMPT_PROVIDER,
      reasoningEffort: "medium",
      systemPrompt: snapshot.defaults.systemPrompt,
    });
    expect(snapshot.sessions.summaries).toHaveLength(1);
    expect(snapshot.sessions.summaries[0]).toMatchObject({
      id: snapshot.sessions.activeSessionId,
      title: "New Session",
      status: "idle",
      provider: PROMPT_PROVIDER,
      modelId: PROMPT_MODEL,
      thinkingLevel: "medium",
    });

    expect(eventSummary.totals["app.ready"]).toBe(1);
  });
});

test("session lifecycle bridge events are emitted for create, open, rename, fork, and delete", async () => {
  const seededAt = Date.now() - 10_000;
  await withSvvyApp(
    {
      env: noAuthEnv({ ZAI_API_KEY: "stub-key" }),
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedSessions(
          homeDir,
          [
            {
              title: "Seeded base session",
              messages: [
                userMessage("Seed the base session", seededAt),
                assistantTextMessage("Seeded base reply.", {
                  timestamp: seededAt + 1,
                }),
              ],
            },
          ],
          workspaceDir,
        );
      },
    },
    async ({ driver, page }) => {
      const baseSession = await stateSnapshot(driver);
      const baseSessionId = baseSession.sessions.activeSessionId;
      if (!baseSessionId) {
        throw new Error("Expected an initial active session id.");
      }

      const createSince = sinceNow();
      await page.getByRole("button", { name: "Create a new session" }).click();
      await Bun.sleep(250);
      const created = await waitForEvent(driver, "session.created", { since: createSince });
      expect(created.payload).toMatchObject({
        parentSessionId: null,
        title: null,
      });
      expect(typeof created.payload?.sessionId === "string").toBe(true);

      const afterCreate = await stateSnapshot(driver);
      expect(afterCreate.sessions.total).toBe(2);
      expect(afterCreate.sessions.activeSessionId).not.toBe(baseSessionId);

      const openSince = sinceNow();
      await sessionMenuTrigger(page, "Seeded base session").waitFor({ state: "visible" });
      await sessionRow(page, 1).locator(".session-main").click({ force: true });
      await Bun.sleep(250);
      const opened = await waitForEvent(driver, "session.opened", { since: openSince });
      expect(opened.payload).toMatchObject({ sessionId: baseSessionId });

      const renamedTitle = `Bridge Contract Renamed ${Date.now()}`;
      const renameSince = sinceNow();
      await openActiveSessionMenu(page);
      await page
        .locator(".session-menu")
        .getByRole("button", { name: "Rename" })
        .click({ force: true });
      await page.getByRole("dialog", { name: "Rename Session" }).waitFor({ state: "visible" });
      await page
        .getByRole("dialog", { name: "Rename Session" })
        .locator('input[placeholder="Session title"]')
        .fill(renamedTitle);
      await page
        .getByRole("dialog", { name: "Rename Session" })
        .getByRole("button", { name: "Save" })
        .click();
      await Bun.sleep(250);
      const renamed = await waitForEvent(driver, "session.renamed", { since: renameSince });
      expect(renamed.payload).toMatchObject({
        sessionId: expect.any(String),
        title: renamedTitle,
      });

      const forkSince = sinceNow();
      await openActiveSessionMenu(page);
      await page
        .locator(".session-menu")
        .getByRole("button", { name: "Fork" })
        .click({ force: true });
      await Bun.sleep(250);
      const forked = await waitForEvent(driver, "session.forked", { since: forkSince });
      expect(typeof forked.payload?.sessionId).toBe("string");
      expect(forked.payload?.title).toBeNull();
      expect(typeof forked.payload?.targetSessionId).toBe("string");
      expect(forked.payload?.targetSessionId).not.toBe(forked.payload?.sessionId);

      const deleteSince = sinceNow();
      await openActiveSessionMenu(page);
      await page
        .locator(".session-menu")
        .getByRole("button", { name: "Delete" })
        .click({ force: true });
      await page.getByRole("dialog", { name: "Delete Session" }).waitFor({ state: "visible" });
      await page
        .getByRole("dialog", { name: "Delete Session" })
        .getByRole("button", { name: "Delete" })
        .click({ force: true });
      await Bun.sleep(250);
      const deleted = await waitForEvent(driver, "session.deleted", { since: deleteSince });
      expect(deleted.payload).toMatchObject({
        sessionId: forked.payload?.targetSessionId,
      });

      const sessionsState = stateValue(await driver.stateGet("sessions"));
      expect(typeof sessionsState.activeSessionId).toBe("string");
    },
  );
});

test("composer controls emit session.model.changed and session.reasoning.changed with the active session id", async () => {
  await withSvvyApp({ env: noAuthEnv({ ZAI_API_KEY: "stub-key" }) }, async ({ driver, page }) => {
    const initial = await stateSnapshot(driver);
    const activeSessionId = initial.sessions.activeSessionId;
    if (!activeSessionId) {
      throw new Error("Expected an active session id before changing composer controls.");
    }

    await openModelPicker(page);
    const modelSince = sinceNow();
    await selectModel(page, "glm-4.7-flashx");
    const modelChanged = await waitForEvent(driver, "session.model.changed", {
      match: { model: "glm-4.7-flashx" },
      since: modelSince,
    });
    expect(modelChanged.payload).toMatchObject({
      sessionId: activeSessionId,
      model: "glm-4.7-flashx",
    });

    await openReasoningMenu(page);
    const reasoningSince = sinceNow();
    await selectReasoningLevel(page, "high");
    const reasoningChanged = await waitForEvent(driver, "session.reasoning.changed", {
      match: { level: "high" },
      since: reasoningSince,
    });
    expect(reasoningChanged.payload).toMatchObject({
      sessionId: activeSessionId,
      level: "high",
    });

    const sessionsState = stateValue(await driver.stateGet("sessions"));
    expect(sessionsState.active?.model).toBe("glm-4.7-flashx");
    expect(sessionsState.active?.reasoningEffort).toBe("high");
  });
});

test("provider auth.updated is emitted when saving an api key from settings", async () => {
  await withSvvyApp(
    {
      env: noAuthEnv(),
      beforeLaunch: async ({ homeDir }) => {
        await seedProviderApiKeys(homeDir, {
          openai: "seeded-openai-key",
        });
      },
    },
    async ({ driver, page }) => {
      await openSettings(page);
      const openaiRow = await providerRowByName(page, "openai");
      const openaiActions = openaiRow.locator(".provider-actions");

      await openaiActions.getByRole("button", { name: "API Key" }).first().click();
      await openaiActions.locator('input[placeholder="Paste API key..."]').fill("fresh-openai-key");
      const updatedSince = sinceNow();
      await openaiActions.getByRole("button", { name: "Save" }).first().click();
      const updated = await waitForEvent(driver, "provider.auth.updated", {
        since: updatedSince,
        match: { providerId: "openai" },
      });
      expect(updated.payload).toMatchObject({
        providerId: "openai",
        keyType: "apikey",
      });

      const providersState = stateValue(await driver.stateGet("providers"));
      expect(providersState.items.find((provider) => provider.provider === "openai")?.keyType).toBe(
        "apikey",
      );
    },
  );
});

test("provider auth.removed is emitted when removing an api key from settings", async () => {
  await withSvvyApp(
    {
      env: noAuthEnv(),
      beforeLaunch: async ({ homeDir }) => {
        await seedProviderApiKeys(homeDir, {
          openai: "seeded-openai-key",
        });
      },
    },
    async ({ driver, page }) => {
      await openSettings(page);
      const openaiRow = await providerRowByName(page, "openai");

      const removedSince = sinceNow();
      await openaiRow.getByRole("button", { name: "Remove" }).click();
      const removed = await waitForEvent(driver, "provider.auth.removed", {
        since: removedSince,
        match: { providerId: "openai" },
      });
      expect(removed.payload).toMatchObject({ providerId: "openai" });

      const providersState = stateValue(await driver.stateGet("providers"));
      expect(providersState.connected).toBe(0);
      expect(providersState.items.find((provider) => provider.provider === "openai")?.keyType).toBe(
        "none",
      );
    },
  );
});
