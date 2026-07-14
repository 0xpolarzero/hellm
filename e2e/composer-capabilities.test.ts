import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHomeDir, ensureBuilt, PROJECT_ROOT_DIR, type SvvyApp, withSvvyApp } from "./harness";
import { chatCompletionChunk, startLiveProviderStub } from "./live-provider-stub";
import { selectNativePickerPath } from "./native-picker";
import { writeAgentModelsConfig } from "./support";

setDefaultTimeout(90_000);

const LIVE_MENTION_API_KEY = "svvy-composer-mentions-key";
const LIVE_MENTION_MODEL = "glm-5-turbo";
const LIVE_MENTION_RESPONSE_ID = "chatcmpl-composer-mentions";
const COMPOSER_PLACEHOLDER = "Ask svvy to inspect the repo, make a change, or delegate work.";
const MISSING_MENTION = "@missing/does-not-exist.txt";

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
  await trigger.click();
  await menu.waitFor({ state: "visible" });
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
  await menu.locator(".model-option").first().click();
  await menu.waitFor({ state: "hidden" });
}

test("typing @ opens the workspace mention picker without arrow-key recovery", async () => {
  await runApp(
    createEnv({
      OPENAI_API_KEY: "svvy-e2e-openai-key",
      ZAI_API_KEY: "svvy-e2e-zai-key",
    }),
    async ({ page }) => {
      await page.getByRole("button", { name: "Create a new orchestrator" }).click();
      const composer = page.locator(
        'textarea[placeholder="Ask svvy to inspect the repo, make a change, or delegate work."]',
      );
      await composer.waitFor({ state: "visible" });

      await composer.focus();
      await composer.press("@");

      const composerSnapshot = await composer.resolve();
      expect(composerSnapshot.first?.value).toBe("@");
      expect(composerSnapshot.first?.selectionStart).toBe(1);
      expect(composerSnapshot.first?.selectionEnd).toBe(1);

      const mentionPicker = page.getByRole("listbox", { name: "Workspace paths" });
      await mentionPicker.waitFor({ state: "visible", timeout: 5_000 });
      await page.getByText("Indexing workspace paths...").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      await page.locator(".mention-picker .mention-option").first().waitFor({ state: "visible" });

      expect(await mentionPicker.isVisible()).toBe(true);
      expect(await page.locator(".mention-picker .mention-option").count()).toBeGreaterThan(0);
    },
  );
});

test("selects indexed file and folder mentions, sends ordinary @path text, and renders actionable and missing links", async () => {
  let expectedPrompt = "";
  let selectedFileMention = "";
  let selectedFolderMention = "";
  const provider = startLiveProviderStub({
    apiKey: LIVE_MENTION_API_KEY,
    steps: [
      {
        label: "settle composer mention turn",
        assertRequest: (request) => {
          const userMessage = request.body.messages
            .toReversed()
            .find((message) => message.role === "user");
          const content = userMessage?.content;
          const text =
            typeof content === "string"
              ? content
              : Array.isArray(content)
                ? content
                    .map((part) =>
                      part && typeof part === "object" && !Array.isArray(part)
                        ? ((part as Record<string, unknown>).text ?? "")
                        : typeof part === "string"
                          ? part
                          : "",
                    )
                    .join("")
                : "";
          expect(text).toBe(expectedPrompt);
        },
        events: [
          chatCompletionChunk({
            id: LIVE_MENTION_RESPONSE_ID,
            model: LIVE_MENTION_MODEL,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Mention paths received." },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: LIVE_MENTION_RESPONSE_ID,
            model: LIVE_MENTION_MODEL,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
        ],
      },
    ],
  });
  const homeDir = await createHomeDir("svvy-composer-mentions-");
  let configured = false;

  try {
    await withSvvyApp(
      {
        homeDir,
        workspaceDir: PROJECT_ROOT_DIR,
        env: {
          ANTHROPIC_API_KEY: "",
          OPENAI_API_KEY: "",
          ZAI_API_KEY: LIVE_MENTION_API_KEY,
        },
        beforeLaunch: async ({ homeDir: launchHomeDir }) => {
          if (configured) return;
          configured = true;
          await writeAgentModelsConfig(launchHomeDir, {
            providers: { zai: { baseUrl: provider.baseUrl } },
          });
        },
      },
      async ({ page }) => {
        await page.getByRole("button", { name: "Create a new orchestrator" }).click();
        const composer = page.getByRole("group", { name: "Message composer" }).first();
        await composer.waitFor({ state: "visible" });
        const textarea = composer.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`);

        await textarea.focus();
        await textarea.press("@");
        const mentionPicker = page.getByRole("listbox", { name: "Workspace paths" });
        await mentionPicker.waitFor({ state: "visible" });
        await page.getByText("Indexing workspace paths...").waitFor({
          state: "hidden",
          timeout: 15_000,
        });

        const options = page.locator(".mention-picker .mention-option");
        const fileOptions = options.filter({ has: page.locator("svg.lucide-file") });
        expect(await fileOptions.count()).toBeGreaterThan(0);
        await fileOptions.first().click();

        const selectedMentionSnapshot = await textarea.resolve();
        selectedFileMention = selectedMentionSnapshot.first?.value ?? "";
        expect(selectedFileMention).toMatch(/^@[A-Za-z0-9._~/-]+$/);
        expect(selectedMentionSnapshot.first?.selectionStart).toBe(selectedFileMention.length);
        expect(selectedMentionSnapshot.first?.selectionEnd).toBe(selectedFileMention.length);

        await textarea.fill("@doc");
        await mentionPicker.waitFor({ state: "visible" });
        const folderOptions = options.filter({ has: page.locator("svg.lucide-folder") });
        expect(await folderOptions.count()).toBeGreaterThan(0);
        await folderOptions.first().click();
        const selectedFolderSnapshot = await textarea.resolve();
        selectedFolderMention = selectedFolderSnapshot.first?.value ?? "";
        expect(selectedFolderMention).toMatch(/^@[A-Za-z0-9._~/-]+\/$/);

        expectedPrompt = `Please inspect ${selectedFileMention} and ${selectedFolderMention} and report on ${MISSING_MENTION}`;
        await textarea.fill(expectedPrompt);
        await textarea.press("Escape");
        await composer.getByRole("button", { name: "Send" }).click();
        await provider.waitForRequestCount(1);

        const selectedPath = selectedFileMention.slice(1);
        const sentMention = page.locator(
          `a.workspace-mention-link[href="workspace://${selectedPath}"]`,
        );
        const sentMentionText = sentMention.filter({
          hasText: selectedFileMention,
        });
        await sentMentionText.waitFor({ state: "visible" });
        expect(await sentMentionText.count()).toBe(1);

        const selectedFolderPath = selectedFolderMention.slice(1);
        const sentFolderMention = page
          .locator(`a.workspace-mention-link[href="workspace://${selectedFolderPath}"]`)
          .filter({ hasText: selectedFolderMention });
        await sentFolderMention.waitFor({ state: "visible" });
        expect(await sentFolderMention.count()).toBe(1);

        const missingMention = page
          .locator(
            'a.workspace-mention-link.missing[href="workspace://missing/does-not-exist.txt"][aria-disabled="true"]',
          )
          .filter({
            hasText: MISSING_MENTION,
          });
        await missingMention.waitFor({ state: "visible" });
        expect(await missingMention.count()).toBe(1);
        expect(await page.getByText(/^Mention paths received\.$/).count()).toBe(1);
      },
    );
    provider.assertHealthy();
  } finally {
    provider.stop();
    await rm(homeDir, { force: true, recursive: true });
  }
});

test("attaches real picker file, folder, and image selections and sends transcript tiles", async () => {
  const workspaceDir = await mkdtemp(join(tmpdir(), "svvy-composer-attachments-"));
  const filePath = join(workspaceDir, "docs", "notes.md");
  const folderPath = join(workspaceDir, "fixtures");
  const imagePath = join(folderPath, "photo.png");
  const imageBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const imageBase64 = imageBytes.toString("base64");
  await mkdir(join(workspaceDir, "docs"), { recursive: true });
  await mkdir(folderPath, { recursive: true });
  await writeFile(filePath, "picker attachment file\n");
  await writeFile(imagePath, imageBytes);

  const provider = startLiveProviderStub({
    apiKey: LIVE_MENTION_API_KEY,
    steps: [
      {
        label: "settle composer attachment turn",
        assertRequest: (request) => {
          const userMessage = request.body.messages
            .toReversed()
            .find((message) => message.role === "user");
          expect(userMessage).toBeDefined();
          const content = userMessage?.content;
          expect(Array.isArray(content)).toBe(true);
          const parts = Array.isArray(content)
            ? content.filter(
                (part): part is Record<string, unknown> =>
                  Boolean(part) && typeof part === "object" && !Array.isArray(part),
              )
            : [];
          const text = parts
            .filter((part) => part.type === "text")
            .map((part) => String(part.text ?? ""))
            .join("\n");
          expect(text).toContain("Attached files are available at these workspace-relative paths:");
          expect(text).toContain("- file path: docs/notes.md (name: notes.md)");
          expect(text).toContain("- folder path: fixtures (name: fixtures)");
          expect(text).toContain("- image path: fixtures/photo.png (name: photo.png)");

          const imagePart = parts.find((part) => part.type === "image_url");
          expect(JSON.stringify(imagePart)).toContain(imageBase64);
          expect(JSON.stringify(imagePart)).toContain("image/png");
        },
        events: [
          chatCompletionChunk({
            id: LIVE_MENTION_RESPONSE_ID,
            model: LIVE_MENTION_MODEL,
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "Picker attachments received." },
                finish_reason: null,
              },
            ],
          }),
          chatCompletionChunk({
            id: LIVE_MENTION_RESPONSE_ID,
            model: LIVE_MENTION_MODEL,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          }),
        ],
      },
    ],
  });
  const homeDir = await createHomeDir("svvy-composer-attachments-home-");
  let configured = false;

  try {
    await withSvvyApp(
      {
        homeDir,
        workspaceDir,
        env: {
          ANTHROPIC_API_KEY: "",
          OPENAI_API_KEY: "",
          ZAI_API_KEY: LIVE_MENTION_API_KEY,
        },
        beforeLaunch: async ({ homeDir: launchHomeDir }) => {
          if (configured) return;
          configured = true;
          await writeAgentModelsConfig(launchHomeDir, {
            providers: {
              zai: {
                baseUrl: provider.baseUrl,
                modelOverrides: {
                  [LIVE_MENTION_MODEL]: { input: ["text", "image"] },
                },
              },
            },
          });
        },
      },
      async ({ homeDir: appHomeDir, page }) => {
        await page.getByRole("button", { name: "Create a new orchestrator" }).click();
        const composer = page.getByRole("group", { name: "Message composer" }).first();
        await composer.waitFor({ state: "visible" });
        const pickerButton = composer.getByRole("button", { name: "Attach files or folder" });

        const selectAttachment = async (path: string, kind: "file" | "folder") => {
          const picker = selectNativePickerPath(path, { homeDir: appHomeDir, kind });
          await pickerButton.click();
          const menu = composer.getByRole("menu", { name: "Attach" });
          await menu.waitFor({ state: "visible" });
          await menu
            .getByRole("menuitem", { name: kind === "folder" ? "Attach folder" : "Attach files" })
            .click();
          await picker;
        };

        await selectAttachment(filePath, "file");
        await composer
          .getByRole("button", { name: "Remove attachment docs/notes.md" })
          .waitFor({ state: "visible" });

        await selectAttachment(folderPath, "folder");
        await composer
          .getByRole("button", { name: /^Remove attachment fixtures$/ })
          .waitFor({ state: "visible" });

        await selectAttachment(imagePath, "file");
        await composer
          .getByRole("button", { name: "Remove attachment fixtures/photo.png" })
          .waitFor({ state: "visible" });

        const textarea = composer.locator(`textarea[placeholder="${COMPOSER_PLACEHOLDER}"]`);
        await textarea.fill("Inspect the selected picker attachments.");
        await composer.getByRole("button", { name: "Send" }).click();
        await provider.waitForRequestCount(1);

        const attachedFiles = page.getByRole("group", { name: "Attached files" });
        await attachedFiles.waitFor({ state: "visible" });
        await attachedFiles.getByText("notes.md").waitFor({ state: "visible" });
        await attachedFiles.getByText("fixtures").waitFor({ state: "visible" });
        await page
          .locator('img[alt="User attached image photo.png"]')
          .waitFor({ state: "visible" });
        expect(await page.locator(".user-file-attachment").count()).toBe(2);
        expect(await page.locator(".user-image-attachment").count()).toBe(1);
        expect(await page.getByText(/^Picker attachments received\.$/).count()).toBe(1);
      },
    );
    provider.assertHealthy();
  } finally {
    provider.stop();
    await rm(homeDir, { force: true, recursive: true });
    await rm(workspaceDir, { force: true, recursive: true });
  }
});

test("model picker stays scoped to configured providers and updates the composer model label", async () => {
  await runApp(
    createEnv({
      OPENAI_API_KEY: "test-openai-key",
      ZAI_API_KEY: "test-zai-key",
    }),
    async ({ page }) => {
      await page.getByRole("button", { name: "Create a new orchestrator" }).click();
      await openReasoningMenu(page);
      const menu = page.getByRole("listbox", { name: "Thinking level" });
      expect(await menu.getByRole("option", { name: /^xhigh$/i }).count()).toBe(0);

      await page.locator(".thinking-field").first().click();
      await menu.waitFor({ state: "hidden" });

      await openModelPicker(page);

      const modelLabels = (await providerHeadings(page)).join("\n").toLowerCase();
      expect(modelLabels).toContain("glm");
      expect(modelLabels).toContain("gpt");
      expect(modelLabels).not.toContain("claude");
      expect(modelLabels).not.toContain("gemini");
      await selectModelBySearch(page, "gpt-5.4");

      const modelLabel =
        (await page.locator(".model-control .compact-combobox-label").textContent())?.trim() ?? "";
      expect(modelLabel.toLowerCase()).toContain("gpt-5.4");
    },
  );
});
