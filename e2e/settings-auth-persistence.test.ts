import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { ensureBuilt, withSvvyApp, type SvvyApp } from "./harness";
import { getTestAuthFile } from "./support";

setDefaultTimeout(90_000);

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

async function providerRow(page: SvvyApp["page"], providerId: string) {
  const rows = page.locator(".provider-row");
  const count = await rows.count();

  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const name = (await row.locator(".provider-name").textContent())?.trim() ?? "";
    if (name === providerId) {
      return row;
    }
  }

  throw new Error(`Could not find provider row for "${providerId}".`);
}

async function openSettings(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open settings" }).first().click();
  await page.getByTestId("settings-pane").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Providers" }).click();
  await page.locator(".settings-search").waitFor({ state: "visible" });
}

async function providerStatus(page: SvvyApp["page"], providerId: string): Promise<string> {
  const row = await providerRow(page, providerId);
  return (await row.locator(".provider-status").textContent())?.trim() ?? "";
}

test("saving an API key writes auth.json", async () => {
  await withSvvyApp({ env: noAuthEnv() }, async ({ homeDir, page }) => {
    await openSettings(page);
    await page.locator(".provider-row").first().waitFor({ state: "visible" });

    const authFile = getTestAuthFile(homeDir);
    expect(existsSync(authFile)).toBe(false);

    const openaiRow = await providerRow(page, "openai");
    await openaiRow.getByRole("button", { name: "Add openai API key" }).first().click({
      force: true,
    });
    await openaiRow.locator('input[placeholder="Paste API key..."]').fill("persisted-openai-key");
    await openaiRow.getByRole("button", { name: "Save" }).first().click({ force: true });

    await page.getByText("Saved").waitFor({ state: "visible" });
    expect(await providerStatus(page, "openai")).toBe("API key");
    expect(existsSync(authFile)).toBe(true);

    const authContent = readFileSync(authFile, "utf8");
    expect(authContent).toContain("persisted-openai-key");
  });
});

test("env-backed auth shows as connected without writing auth.json", async () => {
  await withSvvyApp(
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
