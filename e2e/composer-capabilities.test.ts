import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";

setDefaultTimeout(90_000);

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
  await page.locator(".model-menu").waitFor({ state: "visible" });
}

async function openReasoningMenu(page: SvvyApp["page"]): Promise<void> {
  const trigger = page.locator(".thinking-field").first();
  const menu = page.getByRole("listbox", { name: "Thinking level" });
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      if (await menu.isVisible()) {
        return;
      }
    } catch {
      // Retry while the menu is mounting.
    }

    await trigger.click({ force: true });

    try {
      if (await menu.isVisible()) {
        return;
      }
    } catch {
      // Retry while the menu is mounting.
    }

    await Bun.sleep(100);
  }

  throw new Error("Timed out waiting for the thinking level menu.");
}

async function providerHeadings(page: SvvyApp["page"]): Promise<string[]> {
  const options = page.locator(".model-menu .model-option");
  const count = await options.count();
  const labels: string[] = [];

  for (let index = 0; index < count; index += 1) {
    labels.push(((await options.nth(index).textContent()) ?? "").trim());
  }

  return labels;
}

async function selectModelBySearch(page: SvvyApp["page"], query: string): Promise<void> {
  const menu = page.locator(".model-menu");
  await menu.locator('input[placeholder="Search models"]').fill(query);
  await menu.locator(".model-option").first().click({ force: true });
  await menu.waitFor({ state: "hidden" });
}

async function waitForModelLabel(
  page: SvvyApp["page"],
  expectedText: string,
  timeoutMs = 15_000,
): Promise<void> {
  const label = page.locator(".model-control .compact-combobox-label");
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const text = ((await label.textContent()) ?? "").trim().toLowerCase();
    if (text.includes(expectedText.toLowerCase())) {
      return;
    }

    await Bun.sleep(100);
  }

  throw new Error(`Timed out waiting for model label "${expectedText}".`);
}

test("model picker stays scoped to configured providers and updates the composer model label", async () => {
  await runApp(
    createEnv({
      OPENAI_API_KEY: "test-openai-key",
      ZAI_API_KEY: "test-zai-key",
    }),
    async ({ page }) => {
      await openReasoningMenu(page);
      const menu = page.getByRole("listbox", { name: "Thinking level" });
      expect(await menu.getByRole("option", { name: /^xhigh$/i }).count()).toBe(0);

      await page.locator(".thinking-field").first().click({ force: true });
      await menu.waitFor({ state: "hidden" });

      await openModelPicker(page);

      const modelLabels = (await providerHeadings(page)).join("\n").toLowerCase();
      expect(modelLabels).toContain("glm");
      expect(modelLabels).toContain("gpt");
      expect(modelLabels).not.toContain("claude");
      expect(modelLabels).not.toContain("gemini");
      await selectModelBySearch(page, "gpt-5.4");
      await waitForModelLabel(page, "gpt-5.4");

      const modelLabel =
        (await page.locator(".model-control .compact-combobox-label").textContent())?.trim() ?? "";
      expect(modelLabel.toLowerCase()).toContain("gpt-5.4");
    },
  );
});
