import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { getProviders, type Model } from "@mariozechner/pi-ai";
import { ensureBuilt, createHomeDir, type HellmApp, withHellmApp } from "./harness";
import { ROOT_WORKSPACE_DIR, writeRendererSeed } from "./support";
import type { CustomProvider } from "../src/mainview/chat-storage";
import type { PromptHistoryEntry } from "../src/mainview/prompt-history";
import { getProviderEnvVar } from "../src/bun/auth-store";

setDefaultTimeout(45_000);

beforeAll(async () => {
  await ensureBuilt();
});

function makeSeededModel(provider: string, suffix: string, options: { reasoning: boolean; vision: boolean }): Model<any> {
  return {
    id: `renderer-seed-${provider}-${suffix}`,
    name: `Renderer Seed ${provider} ${suffix}`,
    api: "openai-responses",
    provider,
    baseUrl: "https://example.invalid/v1",
    reasoning: options.reasoning,
    input: options.vision ? ["text", "image"] : ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 8192,
    maxTokens: 4096,
  };
}

function buildRendererSeed(): {
  customProviders: CustomProvider[];
  promptHistory: PromptHistoryEntry[];
} {
  const promptHistory: PromptHistoryEntry[] = [
    {
      text: "Seeded history oldest",
      sentAt: Date.now() - 30_000,
      workspaceId: ROOT_WORKSPACE_DIR,
    },
    {
      text: "Seeded history middle",
      sentAt: Date.now() - 20_000,
      workspaceId: ROOT_WORKSPACE_DIR,
    },
    {
      text: "Seeded history newest",
      sentAt: Date.now() - 10_000,
      workspaceId: ROOT_WORKSPACE_DIR,
    },
  ];

  const customProviders: CustomProvider[] = getProviders().map((provider) => ({
    id: `renderer-seed-${provider}`,
    name: provider,
    type: "openai-responses",
    baseUrl: "https://example.invalid",
    models: [
      makeSeededModel(provider, "think", { reasoning: true, vision: false }),
      makeSeededModel(provider, "vision", { reasoning: false, vision: true }),
    ],
  }));

  return { customProviders, promptHistory };
}

function createAuthFreeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const provider of getProviders()) {
    const envVar = getProviderEnvVar(provider);
    if (envVar) {
      env[envVar] = "";
    }
  }
  return env;
}

async function runSeededApp<T>(
  fn: (app: HellmApp) => Promise<T>,
): Promise<T> {
  const homeDir = await createHomeDir();
  try {
    const seedFile = await writeRendererSeed(homeDir, buildRendererSeed());
    return await withHellmApp(
      {
        homeDir,
        env: {
          ...createAuthFreeEnv(),
          HELLM_E2E_RENDERER_SEED_PATH: seedFile,
        },
      },
      fn,
    );
  } finally {
    await rm(homeDir, { force: true, recursive: true });
  }
}

async function textareaValue(page: HellmApp["page"]): Promise<string> {
  const snapshot = await page.locator('textarea[placeholder^="Ask hellm"]').resolve();
  return snapshot.first?.value ?? "";
}

async function waitForTextareaValue(
  page: HellmApp["page"],
  expected: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await textareaValue(page)) === expected) {
      return;
    }
    await Bun.sleep(50);
  }
  expect(await textareaValue(page)).toBe(expected);
}

async function openModelPicker(page: HellmApp["page"]) {
  await page.locator(".model-control").click();
  await page.getByRole("dialog", { name: "Select a model" }).waitFor({ state: "visible" });
}

async function openReasoningMenu(page: HellmApp["page"]) {
  await page.getByRole("button", { name: "Thinking level" }).click();
  await page.locator(".thinking-menu").waitFor({ state: "visible" });
}

test("composer model control opens the picker, surfaces seeded custom providers, and updates the selection", async () => {
  await runSeededApp(async ({ page }) => {
    const modelButton = page.locator(".model-control");
    const initialLabel = (await modelButton.locator("strong").textContent())?.trim() ?? "";

    await openModelPicker(page);
    expect((await page.locator(".model-row.current .model-state").textContent())?.trim()).toBe("Current");

    const picker = page.getByRole("dialog", { name: "Select a model" });
    const search = picker.locator("input[placeholder^=\"Search model families\"]");
    await search.fill("renderer-seed");
    expect((await picker.locator(".picker-summary").textContent())?.trim()).toBe("2 matches");
    expect(await picker.locator(".model-row").count()).toBe(2);
    expect(await picker.getByText("thinking").isVisible()).toBe(true);
    expect(await picker.getByText("vision").isVisible()).toBe(true);

    const firstSeededRow = picker.locator(".model-row").first();
    const firstSeededName = (await firstSeededRow.locator("strong").textContent())?.trim() ?? "";
    await firstSeededRow.click();
    await picker.waitFor({ state: "hidden" });

    const updatedLabel = (await modelButton.locator("strong").textContent())?.trim() ?? "";
    expect(updatedLabel).not.toBe(initialLabel);
    expect(updatedLabel).toBe(firstSeededName);

    await openModelPicker(page);
    await search.fill("renderer-seed");
    expect((await picker.locator(".model-row.current strong").textContent())?.trim()).toBe(firstSeededName);
    await page.locator(".ui-dialog-close").click();
    await picker.waitFor({ state: "hidden" });
  });
});

test("model picker search and filters stay coherent across Thinking and Vision toggles", async () => {
  await runSeededApp(async ({ page }) => {
    await openModelPicker(page);

    const picker = page.getByRole("dialog", { name: "Select a model" });
    const search = picker.locator("input[placeholder^=\"Search model families\"]");
    const thinking = picker.getByRole("button", { name: "Thinking" });
    const vision = picker.getByRole("button", { name: "Vision" });

    await search.fill("renderer-seed");
    expect((await picker.locator(".picker-summary").textContent())?.trim()).toBe("2 matches");
    expect(await picker.locator(".model-row").count()).toBe(2);

    await thinking.click();
    expect((await picker.locator(".picker-summary").textContent())?.trim()).toBe("1 match");
    expect(await picker.locator(".model-row").count()).toBe(1);
    expect((await picker.locator(".model-row").textContent()) ?? "").toContain("thinking");

    await vision.click();
    expect((await picker.locator(".picker-summary").textContent())?.trim()).toBe("0 matches");
    expect(await picker.getByText("No models match the current filters.").isVisible()).toBe(true);

    await thinking.click();
    expect((await picker.locator(".picker-summary").textContent())?.trim()).toBe("1 match");
    expect(await picker.locator(".model-row").count()).toBe(1);
    expect((await picker.locator(".model-row").textContent()) ?? "").toContain("vision");

    await vision.click();
    expect((await picker.locator(".picker-summary").textContent())?.trim()).toBe("2 matches");
    expect(await picker.locator(".model-row").count()).toBe(2);
    await page.locator(".ui-dialog-close").click();
    await picker.waitFor({ state: "hidden" });
  });
});

test("reasoning selector opens, closes, and persists a selected level", async () => {
  await runSeededApp(async ({ page }) => {
    const reasoningButton = page.getByRole("button", { name: "Thinking level" });

    await openReasoningMenu(page);
    const menu = page.locator(".thinking-menu");
    expect(await menu.isVisible()).toBe(true);

    await page.locator(".workspace-titlebar-title").click();
    await menu.waitFor({ state: "hidden" });

    await openReasoningMenu(page);
    await page.locator(".workspace-main-title").click();
    await menu.waitFor({ state: "hidden" });

    await openReasoningMenu(page);
    const currentText = (await reasoningButton.textContent())?.toLowerCase() ?? "";
    const nextLevel = currentText.includes("high") ? "off" : "high";
    await menu.getByRole("option", { name: new RegExp(nextLevel, "i") }).click();
    await menu.waitFor({ state: "hidden" });
    expect((await reasoningButton.textContent())?.toLowerCase() ?? "").toContain(nextLevel);
  });
});

test("prompt history recalls seeded workspace entries and returns to the empty draft", async () => {
  await runSeededApp(async ({ page }) => {
    const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
    await textarea.waitFor({ state: "visible" });
    await textarea.focus();

    await textarea.press("ArrowUp");
    await waitForTextareaValue(page, "Seeded history newest");

    await textarea.press("ArrowDown");
    await waitForTextareaValue(page, "");
  });
});

test("prompt history ignores arrow keys while another ui surface owns them", async () => {
  await runSeededApp(async ({ page }) => {
    const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
    await textarea.waitFor({ state: "visible" });
    await textarea.focus();
    await textarea.fill("boundary guard");

    await openReasoningMenu(page);
    await textarea.press("ArrowUp");
    expect(await textareaValue(page)).toBe("boundary guard");
    await textarea.press("ArrowDown");
    expect(await textareaValue(page)).toBe("boundary guard");
    await page.locator(".workspace-titlebar-title").click();
  });
});

test("sending without provider auth opens settings instead of clearing the draft", async () => {
  await runSeededApp(async ({ page }) => {
    const textarea = page.locator('textarea[placeholder^="Ask hellm"]');
    await textarea.waitFor({ state: "visible" });
    await textarea.fill("Need provider access");
    await page.getByRole("button", { name: "Send" }).click();

    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.waitFor({ state: "visible" });
    expect(await settings.getByText("Not configured").isVisible()).toBe(true);
    expect((await textareaValue(page)).trimEnd()).toBe("Need provider access");
  });
});
