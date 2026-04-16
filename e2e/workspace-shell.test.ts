import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";
import {
  assistantTextMessage,
  seedSessions,
  toolCall,
  toolResultMessage,
  type SeedSessionInput,
  userMessage,
} from "./support";

setDefaultTimeout(90_000);

const DESKTOP_SPLIT_BREAKPOINT = 1220;
const MOBILE_OVERLAY_BREAKPOINT = 760;
const BASE_TIMESTAMP = 1_730_000_000_000;
const HTML_ARTIFACT_CONTENT = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Shell Overlay Preview</title>
  </head>
  <body>
    <main id="root">Preview ready</main>
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

type Page = SvvyApp["page"];

function workspaceShellArtifactSession(): SeedSessionInput {
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
    title: "Workspace shell artifact",
    messages: [
      userMessage("Seed the shell overlay transcript.", BASE_TIMESTAMP),
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

async function waitForShellChrome(page: Page): Promise<void> {
  await page.locator(".workspace-titlebar").waitFor({ state: "visible" });
  await page.locator(".workspace-footer").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Open settings" }).waitFor({ state: "visible" });
}

async function currentWindowFrame(app: SvvyApp): Promise<{ width: number; height: number }> {
  return (await app.driver.window("active").info()).frame;
}

test("keeps the workspace chrome visible while toggling the sidebar and opening settings", async () => {
  await withSvvyApp(async (app) => {
    const frame = await currentWindowFrame(app);
    expect(frame.width).toBeGreaterThan(MOBILE_OVERLAY_BREAKPOINT);
    expect(frame.width).toBeLessThan(DESKTOP_SPLIT_BREAKPOINT);

    await waitForShellChrome(app.page);
    expect((await app.page.locator(".workspace-titlebar-title").textContent())?.trim()).toBe(
      "svvy",
    );
    expect((await app.page.locator(".workspace-main-meta").textContent()) ?? "").toContain("Ready");
    expect((await app.page.locator(".workspace-main-meta").textContent()) ?? "").toContain(
      "Waiting for first turn",
    );
    expect(await app.page.getByRole("button", { name: "Open settings" }).isVisible()).toBe(true);

    const hideButton = app.page.getByRole("button", { name: "Hide sidebar" });
    await hideButton.waitFor({ state: "visible" });
    expect((await app.page.attrs("css:.titlebar-icon")).attributes["aria-pressed"]).toBe("true");

    await hideButton.click();
    await app.page.locator(".session-sidebar").waitFor({ state: "hidden" });
    expect((await app.page.attrs("css:.titlebar-icon")).attributes["aria-pressed"]).toBe("false");
    expect(await app.page.locator(".workspace-footer").isVisible()).toBe(true);

    await app.page.getByRole("button", { name: "Show sidebar" }).click();
    await app.page.locator(".session-sidebar").waitFor({ state: "visible" });
    expect((await app.page.attrs("css:.titlebar-icon")).attributes["aria-pressed"]).toBe("true");

    await app.page.getByRole("button", { name: "Hide sidebar" }).click();
    await app.page.locator(".session-sidebar").waitFor({ state: "hidden" });

    await app.page.locator(".statusbar-icon").click({ force: true });
    const settings = app.page.getByRole("dialog", { name: "Settings" });
    await settings.waitFor({ state: "visible" });

    expect(await app.page.locator(".workspace-titlebar").isVisible()).toBe(true);
    expect(await app.page.locator(".workspace-footer").isVisible()).toBe(true);
    expect(await app.page.locator(".session-sidebar").isVisible()).toBe(false);
    expect(await app.page.getByRole("button", { name: "Show sidebar" }).isVisible()).toBe(true);

    await app.page.locator(".ui-dialog-close").click();
    await settings.waitFor({ state: "detached" });

    expect(await app.page.getByRole("button", { name: "Show sidebar" }).isVisible()).toBe(true);
    await app.page.getByRole("button", { name: "Show sidebar" }).click();
    await app.page.locator(".session-sidebar").waitFor({ state: "visible" });
    expect(await app.page.getByRole("button", { name: "Hide sidebar" }).isVisible()).toBe(true);
  });
});

test("renders artifact output as a mobile overlay at the app's narrow shell width", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedSessions(homeDir, [workspaceShellArtifactSession()], workspaceDir);
      },
    },
    async (app) => {
      const frame = await currentWindowFrame(app);
      expect(frame.width).toBeLessThan(DESKTOP_SPLIT_BREAKPOINT);

      await waitForShellChrome(app.page);
      expect((await app.page.locator(".workspace-main-title").textContent())?.trim()).toBe(
        "Workspace shell artifact",
      );
      await app.page.getByText("Seed the shell overlay transcript.").waitFor({ state: "visible" });
      const toolCards = app.page.locator(".tool-card");
      await toolCards.waitFor({ state: "visible", timeout: 15_000 });
      expect(await toolCards.count()).toBe(4);
      await app.page
        .locator(".artifacts-slot.mobile-slot")
        .waitFor({ state: "visible", timeout: 15_000 });
      await app.page
        .locator(".artifacts-panel.overlay")
        .waitFor({ state: "visible", timeout: 15_000 });
      expect(await app.page.locator(".artifacts-slot.desktop-open").count()).toBe(0);
      expect(await app.page.locator(".workspace-titlebar").isVisible()).toBe(true);
      expect(await app.page.locator(".workspace-footer").isVisible()).toBe(true);
    },
  );
});
