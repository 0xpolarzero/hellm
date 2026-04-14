import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";

setDefaultTimeout(45_000);

beforeAll(async () => {
  await ensureBuilt();
});

function createEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
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
    ...overrides,
  };
}

async function runApp<T>(
  env: Record<string, string>,
  fn: (app: SvvyApp) => Promise<T>,
): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    return await withSvvyApp(
      {
        homeDir,
        env,
      },
      fn,
    );
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function openModelPicker(page: SvvyApp["page"]): Promise<void> {
  await page.locator(".model-control").click();
  await page.getByRole("dialog", { name: "Select a model" }).waitFor({ state: "visible" });
}

async function openReasoningMenu(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Thinking level" }).click();
  await page.locator(".thinking-menu").waitFor({ state: "visible" });
}

async function providerHeadings(page: SvvyApp["page"]): Promise<string[]> {
  const headings = page.locator(".model-group h3");
  const count = await headings.count();
  const names: string[] = [];

  for (let index = 0; index < count; index += 1) {
    names.push(((await headings.nth(index).textContent()) ?? "").trim());
  }

  return names;
}

async function selectModelBySearch(page: SvvyApp["page"], query: string): Promise<void> {
  const picker = page.getByRole("dialog", { name: "Select a model" });
  await picker.locator('input[placeholder="Search model families, providers, or ids"]').fill(query);
  await picker.locator(".model-row").first().click({ force: true });
  await picker.waitFor({ state: "hidden" });
}

test("model picker stays scoped to configured providers and reasoning options track the selected model", async () => {
  await runApp(
    createEnv({
      OPENAI_API_KEY: "test-openai-key",
      ZAI_API_KEY: "test-zai-key",
    }),
    async ({ page }) => {
      await openReasoningMenu(page);
      const menu = page.locator(".thinking-menu");
      expect(await menu.getByRole("option", { name: /^xhigh$/i }).count()).toBe(0);

      await page.locator(".workspace-main-title").click();
      await menu.waitFor({ state: "hidden" });

      await openModelPicker(page);

      const headings = await providerHeadings(page);
      expect(headings).toContain("zai");
      expect(headings).toContain("openai");
      expect(headings).not.toContain("anthropic");
      expect(headings).not.toContain("google");
      await selectModelBySearch(page, "gpt-5.4");

      const modelLabel = (await page.locator(".model-control strong").textContent())?.trim() ?? "";
      expect(modelLabel.toLowerCase()).toContain("gpt-5.4");

      await openReasoningMenu(page);
      await menu.getByRole("option", { name: /^xhigh$/i }).waitFor({ state: "visible" });
      await menu.getByRole("option", { name: /^xhigh$/i }).click();
      await menu.waitFor({ state: "hidden" });
      expect(
        (
          (await page.getByRole("button", { name: "Thinking level" }).textContent()) ?? ""
        ).toLowerCase(),
      ).toContain("xhigh");
    },
  );
});
