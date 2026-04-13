import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { ensureBuilt, withHellmApp, type HellmApp } from "./harness";
import { getTestAuthFile, writeE2eControl } from "./support";

setDefaultTimeout(45_000);

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

beforeAll(async () => {
  await ensureBuilt();
});

function noAuthEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ...BLANK_PROVIDER_ENV,
    ...overrides,
  };
}

function providerRow(page: HellmApp["page"], providerId: string) {
  return page.locator(".provider-row").filter({
    has: page.getByText(providerId, { exact: true }),
  });
}

async function openSettings(page: HellmApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).first().click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
}

async function closeSettings(page: HellmApp["page"]): Promise<void> {
  await page.locator(".ui-dialog-close").click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}

async function providerStatus(page: HellmApp["page"], providerId: string): Promise<string> {
  return (await providerRow(page, providerId).locator(".provider-status").textContent())?.trim() ?? "";
}

test("saving an API key writes auth.json", async () => {
  await withHellmApp({ env: noAuthEnv() }, async ({ homeDir, page }) => {
    await openSettings(page);
    await page.locator(".provider-row").first().waitFor({ state: "visible" });

    const authFile = getTestAuthFile(homeDir);
    expect(existsSync(authFile)).toBe(false);

    const openaiRow = providerRow(page, "openai");
    await openaiRow.getByRole("button", { name: "API Key" }).first().click();
    await openaiRow.locator('input[placeholder="Paste API key..."]').fill("persisted-openai-key");
    await openaiRow.getByRole("button", { name: "Save" }).first().click();

    await page.getByText("Saved").waitFor({ state: "visible" });
    expect(await providerStatus(page, "openai")).toBe("API key");
    expect(existsSync(authFile)).toBe(true);

    const authContent = readFileSync(authFile, "utf8");
    expect(authContent).toContain("persisted-openai-key");
  });
});

test("successful OAuth writes auth.json and refreshes provider status", async () => {
  await withHellmApp(
    {
      env: noAuthEnv(),
      beforeLaunch: async ({ homeDir, runtimeEnv }) => {
        const controlFile = await writeE2eControl(homeDir, {
          oauth: {
            anthropic: {
              credentials: {
                access: "anthropic-access-token",
                refresh: "anthropic-refresh-token",
                expires: Date.now() + 60_000,
              },
            },
          },
        });
        runtimeEnv.HELLM_E2E_CONTROL_PATH = controlFile;
      },
    },
    async ({ homeDir, page }) => {
      const authFile = getTestAuthFile(homeDir);
      await openSettings(page);
      await page.locator(".provider-row").first().waitFor({ state: "visible" });

      const anthropicRow = providerRow(page, "anthropic");
      await anthropicRow.getByRole("button", { name: "OAuth" }).first().click();

      await page.getByText("Connected").waitFor({ state: "visible" });
      expect(await providerStatus(page, "anthropic")).toBe("OAuth");
      expect(existsSync(authFile)).toBe(true);

      const authState = JSON.parse(readFileSync(authFile, "utf8")) as Record<
        string,
        { type?: string; credentials?: { access?: string } }
      >;
      expect(authState.anthropic?.type).toBe("oauth");
      expect(authState.anthropic?.credentials?.access).toBe("anthropic-access-token");
    },
  );
});

test("failed OAuth shows an error and leaves auth state unchanged", async () => {
  await withHellmApp(
    {
      env: noAuthEnv(),
      beforeLaunch: async ({ homeDir, runtimeEnv }) => {
        const controlFile = await writeE2eControl(homeDir, {
          oauth: {
            anthropic: {
              error: "OAuth handshake failed in e2e stub",
            },
          },
        });
        runtimeEnv.HELLM_E2E_CONTROL_PATH = controlFile;
      },
    },
    async ({ homeDir, page }) => {
      await openSettings(page);
      await page.locator(".provider-row").first().waitFor({ state: "visible" });

      const anthropicRow = providerRow(page, "anthropic");
      await anthropicRow.getByRole("button", { name: "OAuth" }).first().click();

      await page.getByText("OAuth handshake failed in e2e stub").waitFor({ state: "visible" });
      expect(await providerStatus(page, "anthropic")).toBe("Not configured");
      expect(existsSync(getTestAuthFile(homeDir))).toBe(false);
    },
  );
});

test("env-backed auth shows as connected without writing auth.json", async () => {
  await withHellmApp(
    {
      env: noAuthEnv({
        ZAI_API_KEY: "env-zai-key",
      }),
    },
    async ({ homeDir, page }) => {
      await openSettings(page);
      await page.locator(".provider-row").first().waitFor({ state: "visible" });

      expect(await providerStatus(page, "zai")).toBe("Env var");
      expect(existsSync(getTestAuthFile(homeDir))).toBe(false);
    },
  );
});
