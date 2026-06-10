import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import { seedProviderApiKeys } from "./support";

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

beforeAll(async () => {
  await ensureBuilt();
});

function noAuthEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...BLANK_PROVIDER_ENV,
    ...overrides,
  };
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

function sinceNow(): string {
  return new Date(Date.now() - 1_000).toISOString();
}

async function openSettings(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.getByTestId("settings-pane").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Providers" }).click();
  await page.locator(".settings-search").waitFor({ state: "visible" });
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

      await clickWhenEnabled(
        openaiActions.getByRole("button", { name: "Change openai API key" }).first(),
      );
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
      await clickWhenEnabled(openaiRow.getByRole("button", { name: "Remove openai credentials" }));
      const confirmRemove = openaiRow.getByRole("button", {
        name: "Confirm removing openai credentials",
      });
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
