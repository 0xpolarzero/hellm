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
  AWS_PROFILE: "",
  AWS_ACCESS_KEY_ID: "",
  AWS_SECRET_ACCESS_KEY: "",
  AWS_BEARER_TOKEN_BEDROCK: "",
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "",
  AWS_CONTAINER_CREDENTIALS_FULL_URI: "",
  AWS_WEB_IDENTITY_TOKEN_FILE: "",
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

async function waitForEnabled(
  locator: {
    isDisabled?: () => Promise<boolean>;
    getAttribute?: (name: string) => Promise<string | null>;
  },
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const disabled =
      typeof locator.isDisabled === "function"
        ? await locator.isDisabled()
        : typeof locator.getAttribute === "function"
          ? (await locator.getAttribute("disabled")) !== null
          : false;
    if (!disabled) {
      return;
    }
    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for a control to become enabled.");
}

function isRetryableClickError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("Resolved element is disabled") ||
      error.message.includes("Bridge request timed out"))
  );
}

async function clickWhenEnabled(
  locator: {
    click: (options?: { force?: boolean }) => Promise<void>;
    isDisabled?: () => Promise<boolean>;
    getAttribute?: (name: string) => Promise<string | null>;
  },
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await waitForEnabled(locator, Math.min(500, timeoutMs));
    try {
      await locator.click({ force: true });
      return;
    } catch (error) {
      if (!isRetryableClickError(error)) {
        throw error;
      }
    }
    await Bun.sleep(100);
  }

  throw new Error("Timed out clicking an enabled control.");
}

async function waitForSessionSummary(
  driver: SvvyApp["driver"],
  sessionId: string,
  match: (summary: { id: string; title?: string }) => boolean,
  timeout = 5_000,
) {
  const deadline = Date.now() + timeout;
  let lastSummary: { id: string; title?: string } | null = null;

  while (Date.now() < deadline) {
    const sessions = stateValue(await driver.stateGet("sessions"));
    lastSummary =
      sessions.summaries.find((summary: { id: string }) => summary.id === sessionId) ?? null;
    if (lastSummary && match(lastSummary)) {
      return lastSummary;
    }
    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for session summary "${sessionId}" to match.`);
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
  const trigger = page
    .locator(".session-item")
    .filter({
      has: page.locator('.session-main[aria-current="true"]'),
    })
    .locator(".session-menu-trigger")
    .first();
  await trigger.click({ force: true });
  await page.locator(".session-menu").waitFor({ state: "visible" });
}

async function openModelPicker(page: SvvyApp["page"]): Promise<void> {
  await page.locator(".composer-row-actions .model-control").click({ force: true });
  await page.getByRole("dialog", { name: "Select a model" }).waitFor({ state: "visible" });
}

async function openReasoningMenu(page: SvvyApp["page"]): Promise<void> {
  await page.locator(".thinking-field").first().click({ force: true });
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
    surfaces: stateValue(await driver.stateGet("surfaces")),
  };
}

function currentOrchestratorSurface(snapshot: Awaited<ReturnType<typeof stateSnapshot>>) {
  const surface =
    snapshot.surfaces.items.find(
      (entry: {
        target: {
          surface: string;
        };
      }) => entry.target.surface === "orchestrator",
    ) ?? null;
  if (!surface) {
    throw new Error("Expected an open orchestrator surface in the bridge snapshot.");
  }
  return surface;
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

test("bridge state snapshot and app.ready expose workspace, session metadata, and open surfaces", async () => {
  await withSvvyApp({ env: noAuthEnv({ ZAI_API_KEY: "stub-key" }) }, async ({ driver }) => {
    const ready = await waitForEvent(driver, "app.ready");
    const snapshot = await stateSnapshot(driver);
    const namespaces = await driver.stateList();
    const eventSummary = await driver.eventsSummary({ groupBy: "event" });
    const initialSession = snapshot.sessions.summaries[0];
    const initialSurface = currentOrchestratorSurface(snapshot);

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
      "surfaces",
    ]);
    expect(namespaces.map((entry) => entry.keyCount)).toEqual([4, 4, 3, 2, 2]);

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
    expect("active" in snapshot.sessions).toBe(false);
    expect("activeSessionId" in snapshot.sessions).toBe(false);
    expect(snapshot.sessions.summaries).toHaveLength(1);
    expect(initialSession).toMatchObject({
      title: "New Session",
      status: "idle",
      provider: PROMPT_PROVIDER,
      modelId: PROMPT_MODEL,
      thinkingLevel: "medium",
    });
    expect(snapshot.surfaces.total).toBe(1);
    expect(snapshot.surfaces.items).toHaveLength(1);
    expect(initialSurface).toMatchObject({
      messageCount: 0,
      model: PROMPT_MODEL,
      provider: PROMPT_PROVIDER,
      reasoningEffort: "medium",
      systemPrompt: snapshot.defaults.systemPrompt,
      promptStatus: "idle",
      target: {
        workspaceSessionId: initialSession.id,
        surface: "orchestrator",
        surfacePiSessionId: initialSession.id,
      },
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
      const baseSurface = currentOrchestratorSurface(baseSession);
      const baseSessionId = baseSurface.target.workspaceSessionId;

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
      expect("activeSessionId" in afterCreate.sessions).toBe(false);
      expect(
        afterCreate.surfaces.items.some(
          (surface: {
            target: {
              surface: string;
              workspaceSessionId: string;
            };
          }) =>
            surface.target.surface === "orchestrator" &&
            surface.target.workspaceSessionId === created.payload?.sessionId,
        ),
      ).toBe(true);

      const openSince = sinceNow();
      await sessionMenuTrigger(page, "Seeded base session").waitFor({ state: "visible" });
      await sessionRow(page, 1).locator(".session-main").click({ force: true });
      await Bun.sleep(250);
      const opened = await waitForEvent(driver, "session.opened", { since: openSince });
      expect(opened.payload).toMatchObject({ sessionId: baseSessionId });
      const afterOpen = await stateSnapshot(driver);
      expect(
        afterOpen.surfaces.items.some(
          (surface: {
            target: {
              surface: string;
              workspaceSessionId: string;
            };
          }) =>
            surface.target.surface === "orchestrator" &&
            surface.target.workspaceSessionId === baseSessionId,
        ),
      ).toBe(true);

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
      const renameSaveButton = page
        .getByRole("dialog", { name: "Rename Session" })
        .getByRole("button", { name: "Save" });
      await clickWhenEnabled(renameSaveButton);
      await Bun.sleep(250);
      const renamed = await waitForEvent(driver, "session.renamed", { since: renameSince });
      expect(renamed.payload).toMatchObject({
        sessionId: expect.any(String),
        title: renamedTitle,
      });
      const renamedSummary = await waitForSessionSummary(
        driver,
        baseSessionId,
        (session) => session.title === renamedTitle,
      );
      expect(renamedSummary.title).toBe(renamedTitle);

      const forkSince = sinceNow();
      await openActiveSessionMenu(page);
      const forkButton = page.locator(".session-menu").getByRole("button", { name: "Fork" });
      await clickWhenEnabled(forkButton);
      await Bun.sleep(250);
      const forked = await waitForEvent(driver, "session.forked", { since: forkSince });
      expect(typeof forked.payload?.sessionId).toBe("string");
      expect(forked.payload?.title).toBeNull();
      expect(typeof forked.payload?.targetSessionId).toBe("string");
      expect(forked.payload?.targetSessionId).not.toBe(forked.payload?.sessionId);
      const afterFork = await stateSnapshot(driver);
      expect(
        afterFork.surfaces.items.some(
          (surface: {
            target: {
              surface: string;
              workspaceSessionId: string;
            };
          }) =>
            surface.target.surface === "orchestrator" &&
            surface.target.workspaceSessionId === forked.payload?.targetSessionId,
        ),
      ).toBe(true);

      const deleteSince = sinceNow();
      await openActiveSessionMenu(page);
      const deleteButton = page.locator(".session-menu").getByRole("button", { name: "Delete" });
      await clickWhenEnabled(deleteButton);
      await page.getByRole("dialog", { name: "Delete Session" }).waitFor({ state: "visible" });
      const confirmDeleteButton = page
        .getByRole("dialog", { name: "Delete Session" })
        .getByRole("button", { name: "Delete" });
      await clickWhenEnabled(confirmDeleteButton);
      await Bun.sleep(250);
      const deleted = await waitForEvent(driver, "session.deleted", { since: deleteSince });
      expect(deleted.payload).toMatchObject({
        sessionId: forked.payload?.targetSessionId,
      });

      const sessionsState = stateValue(await driver.stateGet("sessions"));
      const surfacesState = stateValue(await driver.stateGet("surfaces"));
      expect("activeSessionId" in sessionsState).toBe(false);
      expect(
        sessionsState.summaries.some(
          (session: { id: string }) => session.id === forked.payload?.targetSessionId,
        ),
      ).toBe(false);
      expect(
        surfacesState.items.some(
          (surface: {
            target: {
              workspaceSessionId: string;
            };
          }) => surface.target.workspaceSessionId === forked.payload?.targetSessionId,
        ),
      ).toBe(false);
    },
  );
});

test("composer controls emit surface.model.changed and surface.reasoning.changed for the current surface", async () => {
  await withSvvyApp({ env: noAuthEnv({ ZAI_API_KEY: "stub-key" }) }, async ({ driver, page }) => {
    const initial = await stateSnapshot(driver);
    const initialSurface = currentOrchestratorSurface(initial);

    await openModelPicker(page);
    const modelSince = sinceNow();
    await selectModel(page, "glm-4.7-flashx");
    const modelChanged = await waitForEvent(driver, "surface.model.changed", {
      match: { model: "glm-4.7-flashx" },
      since: modelSince,
    });
    expect(modelChanged.payload).toMatchObject({
      surfacePiSessionId: initialSurface.target.surfacePiSessionId,
      threadId: null,
      workspaceSessionId: initialSurface.target.workspaceSessionId,
      model: "glm-4.7-flashx",
    });

    await openReasoningMenu(page);
    const reasoningSince = sinceNow();
    await selectReasoningLevel(page, "high");
    const reasoningChanged = await waitForEvent(driver, "surface.reasoning.changed", {
      match: { level: "high" },
      since: reasoningSince,
    });
    expect(reasoningChanged.payload).toMatchObject({
      surfacePiSessionId: initialSurface.target.surfacePiSessionId,
      threadId: null,
      workspaceSessionId: initialSurface.target.workspaceSessionId,
      level: "high",
    });

    const sessionsState = stateValue(await driver.stateGet("sessions"));
    const surfacesState = stateValue(await driver.stateGet("surfaces"));
    const updatedSurface =
      surfacesState.items.find(
        (surface: {
          target: {
            surfacePiSessionId: string;
          };
        }) => surface.target.surfacePiSessionId === initialSurface.target.surfacePiSessionId,
      ) ?? null;
    expect(updatedSurface).toMatchObject({
      model: "glm-4.7-flashx",
      reasoningEffort: "high",
    });
    expect(
      sessionsState.summaries.find(
        (session: { id: string }) => session.id === initialSurface.target.workspaceSessionId,
      ),
    ).toMatchObject({
      modelId: "glm-4.7-flashx",
      thinkingLevel: "high",
    });
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

      await clickWhenEnabled(openaiActions.getByRole("button", { name: "Change API key" }).first());
      await openaiActions.locator('input[placeholder="Paste API key..."]').fill("fresh-openai-key");
      const updatedSince = sinceNow();
      await clickWhenEnabled(openaiActions.getByRole("button", { name: "Save" }).first());
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
      await clickWhenEnabled(openaiRow.getByRole("button", { name: "Remove" }));
      const confirmRemove = openaiRow.locator("button").filter({ hasText: "Confirm remove" });
      await confirmRemove.waitFor({ state: "visible" });
      await clickWhenEnabled(confirmRemove);
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
