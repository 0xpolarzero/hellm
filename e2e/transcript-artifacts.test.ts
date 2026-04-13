import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, escapeForRegExp, withHellmApp, type HellmApp } from "./harness";
import { resolveElectrobunWorkspaceDir } from "../scripts/electrobun-paths";
import {
  assistantTextMessage,
  seedSessions,
  toolCall,
  toolResultMessage,
  userMessage,
  type SeedSessionInput,
} from "./support";

setDefaultTimeout(45_000);

const BASE_TIMESTAMP = 1_730_000_000_000;

const HTML_ARTIFACT_CONTENT = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Report Preview</title>
  </head>
  <body>
    <main id="root">Preview ready</main>
    <script>
      (async () => {
        console.log("preview log");
        console.warn("preview warning");
        console.info("preview info");
        console.log("artifacts", await listArtifacts());
        console.log("notes", await getArtifact("notes.txt"));
      })();
    </script>
  </body>
</html>`;

const TEXT_ARTIFACT_CONTENT = "Plain text artifact";

const SVG_ARTIFACT_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect width="24" height="24" rx="4" fill="#2d6cdf" />
  <path d="M7 12h10" stroke="#fff" stroke-width="2" stroke-linecap="round" />
</svg>`;

const IMAGE_ARTIFACT_CONTENT =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <rect width="24" height="24" rx="4" fill="#d96f3f" />
  <circle cx="12" cy="12" r="5" fill="#fff" />
</svg>`);

beforeAll(async () => {
  await ensureBuilt();
});

function richTranscriptSession(): SeedSessionInput {
  const reportCall = toolCall("artifacts", {
    command: "create",
    filename: "report.html",
    content: HTML_ARTIFACT_CONTENT,
  });
  const notesCall = toolCall("artifacts", {
    command: "create",
    filename: "notes.txt",
    content: TEXT_ARTIFACT_CONTENT,
  });
  const diagramCall = toolCall("artifacts", {
    command: "create",
    filename: "diagram.svg",
    content: SVG_ARTIFACT_CONTENT,
  });
  const imageCall = toolCall("artifacts", {
    command: "create",
    filename: "preview.png",
    content: IMAGE_ARTIFACT_CONTENT,
  });

  return {
    title: "Transcript and artifacts",
    messages: [
      userMessage("Seed the transcript that exercises artifacts.", BASE_TIMESTAMP),
      assistantTextMessage("I will create the HTML preview first.", {
        thinking: "Plan the preview and the supporting files.",
        timestamp: BASE_TIMESTAMP + 1,
        toolCalls: [reportCall],
        stopReason: "toolUse",
      }),
      toolResultMessage(reportCall.id, "artifacts", "Created file report.html", {
        timestamp: BASE_TIMESTAMP + 2,
      }),
      assistantTextMessage("The HTML artifact is ready.", {
        timestamp: BASE_TIMESTAMP + 3,
      }),
      assistantTextMessage("Now create the text note.", {
        thinking: "Add a plain text artifact so the panel can render a code block.",
        timestamp: BASE_TIMESTAMP + 4,
        toolCalls: [notesCall],
        stopReason: "toolUse",
      }),
      toolResultMessage(notesCall.id, "artifacts", "Created file notes.txt", {
        timestamp: BASE_TIMESTAMP + 5,
      }),
      assistantTextMessage("The text artifact is ready.", {
        timestamp: BASE_TIMESTAMP + 6,
      }),
      assistantTextMessage("Add the SVG diagram.", {
        thinking: "Create a vector preview for the artifacts panel.",
        timestamp: BASE_TIMESTAMP + 7,
        toolCalls: [diagramCall],
        stopReason: "toolUse",
      }),
      toolResultMessage(diagramCall.id, "artifacts", "Created file diagram.svg", {
        timestamp: BASE_TIMESTAMP + 8,
      }),
      assistantTextMessage("The SVG artifact is ready.", {
        timestamp: BASE_TIMESTAMP + 9,
      }),
      assistantTextMessage("Add the image preview.", {
        thinking: "Use an inline image artifact to verify image rendering.",
        timestamp: BASE_TIMESTAMP + 10,
        toolCalls: [imageCall],
        stopReason: "toolUse",
      }),
      toolResultMessage(imageCall.id, "artifacts", "Created file preview.png", {
        timestamp: BASE_TIMESTAMP + 11,
      }),
      assistantTextMessage("All artifacts are seeded.", {
        timestamp: BASE_TIMESTAMP + 12,
      }),
    ],
  };
}

function plainTranscriptSession(): SeedSessionInput {
  return {
    title: "Transcript only",
    messages: [
      userMessage("Seed a transcript without artifacts.", BASE_TIMESTAMP),
      assistantTextMessage("This session only checks transcript rendering.", {
        thinking: "No artifact output should be present in this session.",
        timestamp: BASE_TIMESTAMP + 1,
      }),
    ],
  };
}

async function withRichTranscriptApp(fn: (app: HellmApp) => Promise<void>) {
  return await withHellmApp(
    {
      beforeLaunch: async ({ homeDir }) => {
        await seedSessions(homeDir, [richTranscriptSession()], resolveAppWorkspaceDir());
      },
    },
    fn,
  );
}

async function withPlainTranscriptApp(fn: (app: HellmApp) => Promise<void>) {
  return await withHellmApp(
    {
      beforeLaunch: async ({ homeDir }) => {
        await seedSessions(homeDir, [plainTranscriptSession()], resolveAppWorkspaceDir());
      },
    },
    fn,
  );
}

function resolveAppWorkspaceDir(): string {
  return resolveElectrobunWorkspaceDir(process.cwd());
}

async function openArtifactTab(page: HellmApp["page"], filename: string) {
  const tab = page.getByRole("tab", {
    name: new RegExp(escapeForRegExp(filename)),
  });
  await tab.click({ force: true });
  await page.locator(".artifact-name").waitFor({ state: "visible" });
  expect(await page.locator(".artifact-name").textContent()).toBe(filename);
}

async function ensureArtifactsPanelOpen(page: HellmApp["page"], count: number) {
  const panel = page.locator(".artifacts-panel");
  if (await panel.isVisible()) {
    return;
  }

  await page.getByRole("button", { name: new RegExp(`Artifacts ${count}`) }).click({ force: true });
  await panel.waitFor({ state: "visible" });
}

async function openSeededSession(page: HellmApp["page"], expectedTitle: string) {
  await page.locator(".workspace-main-title").waitFor({ state: "visible" });
  const currentTitle = (await page.locator(".workspace-main-title").textContent())?.trim() ?? "";
  if (currentTitle === expectedTitle) {
    return;
  }

  const session = page.locator(".session-item .session-main").first();
  await session.waitFor({ state: "visible" });
  await session.click({ force: true });
  expect((await page.locator(".workspace-main-title").textContent())?.trim()).toBe(expectedTitle);
}

test("renders seeded transcript messages, reasoning traces, and tool cards", async () => {
  await withRichTranscriptApp(async ({ page }) => {
    await openSeededSession(page, "Transcript and artifacts");

    await page.getByText("Seed the transcript that exercises artifacts.").waitFor({ state: "visible" });
    await page.getByText("I will create the HTML preview first.").waitFor({ state: "visible" });
    await page.getByText("The HTML artifact is ready.").waitFor({ state: "visible" });

    const thinkingBlocks = page.locator(".thinking-block");
    expect(await thinkingBlocks.count()).toBe(4);
    const firstThinking = thinkingBlocks.first();
    await firstThinking.locator("summary").click({ force: true });
    expect(await firstThinking.locator("pre").textContent()).toContain("Plan the preview and the supporting files.");

    const toolCards = page.locator(".tool-card");
    expect(await toolCards.count()).toBe(4);
    expect(await toolCards.first().textContent()).toContain("Created artifact");
    expect(await toolCards.first().textContent()).toContain("report.html");
    expect(await toolCards.first().locator(".tool-status").textContent()).toBe("done");

    const toolResults = page.locator(".tool-result");
    expect(await toolResults.count()).toBe(4);
    expect(await toolResults.first().textContent()).toContain("Created artifact");
    expect(await toolResults.first().textContent()).toContain("report.html");
    expect(await toolResults.first().locator(".tool-status").textContent()).toBe("Complete");

    const artifactsButton = page.getByRole("button", { name: /Artifacts 4/ });
    await artifactsButton.waitFor({ state: "visible" });
    expect((await artifactsButton.resolve()).first?.disabled).toBe(false);

    await toolCards.first().getByRole("button", { name: "Open" }).click({ force: true });
    await page.locator(".artifacts-panel").waitFor({ state: "visible" });
    expect(await page.locator(".artifact-name").textContent()).toBe("report.html");
  });
});

test("opens the artifact panel and switches between rendered artifact kinds", async () => {
  await withRichTranscriptApp(async ({ page }) => {
    await openSeededSession(page, "Transcript and artifacts");
    await ensureArtifactsPanelOpen(page, 4);

    expect(await page.locator(".artifact-count").textContent()).toBe("4 outputs");
    expect(await page.locator('[role="tab"]').count()).toBe(4);

    await openArtifactTab(page, "notes.txt");
    expect(await page.locator(".artifact-kind").textContent()).toBe("text");
    expect(await page.locator(".artifact-code").textContent()).toBe(TEXT_ARTIFACT_CONTENT);

    await openArtifactTab(page, "preview.png");
    expect(await page.locator(".artifact-kind").textContent()).toBe("image");
    expect((await page.attrs("css:.artifact-image")).attributes.alt).toBe("preview.png");
    expect((await page.attrs("css:.artifact-image")).attributes.src ?? "").toContain(
      "data:image/svg+xml",
    );

    await openArtifactTab(page, "diagram.svg");
    expect(await page.locator(".artifact-kind").textContent()).toBe("svg");
    expect((await page.attrs("css:.artifact-image")).attributes.alt).toBe("diagram.svg");
    expect((await page.attrs("css:.artifact-image")).attributes.src ?? "").toContain(
      "data:image/svg+xml",
    );

    await openArtifactTab(page, "report.html");
    expect(await page.locator(".artifact-kind").textContent()).toBe("html");
    const iframe = page.locator("iframe.artifact-preview");
    await iframe.waitFor({ state: "visible" });
    expect(await iframe.count()).toBe(1);
  });
});

test("disables the artifact button when no artifacts are seeded", async () => {
  await withPlainTranscriptApp(async ({ page }) => {
    await openSeededSession(page, "Transcript only");
    const assistantTexts = page.locator(".assistant-bubble .message-text");
    expect(await assistantTexts.count()).toBe(1);
    expect((await assistantTexts.first().textContent())?.trim()).toBe(
      "This session only checks transcript rendering.",
    );
    expect((await page.getByRole("button", { name: /Artifacts 0/ }).resolve()).first?.disabled).toBe(true);
  });
});

test("shows runtime logs for seeded html artifacts", async () => {
  await withRichTranscriptApp(async ({ page }) => {
    await openSeededSession(page, "Transcript and artifacts");
    await ensureArtifactsPanelOpen(page, 4);
    await openArtifactTab(page, "report.html");
    expect(await page.locator(".artifact-kind").textContent()).toBe("html");

    const logs = page.locator(".artifact-logs");
    await logs.waitFor({ state: "visible", timeout: 15_000 });
    const logsText = await logs.textContent();
    expect(logsText).toContain("Runtime logs");
    expect(logsText).toContain("preview log");
    expect(logsText).toContain("preview warning");
    expect(logsText).toContain("artifacts");
  });
});
