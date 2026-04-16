import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, escapeForRegExp, withSvvyApp, type SvvyApp } from "./harness";
import {
  assistantTextMessage,
  seedSessions,
  toolCall,
  toolResultMessage,
  userMessage,
  type SeedSessionInput,
} from "./support";

setDefaultTimeout(90_000);

const BASE_TIMESTAMP = 1_730_100_000_000;

function artifactCommandSession(): SeedSessionInput {
  const createNotes = toolCall("artifacts", {
    command: "create",
    filename: "notes.txt",
    content: "alpha",
  });
  const updateNotes = toolCall("artifacts", {
    command: "update",
    filename: "notes.txt",
    old_str: "alpha",
    new_str: "beta",
  });
  const rewriteReport = toolCall("artifacts", {
    command: "rewrite",
    filename: "report.html",
    content: "<!doctype html><html><body><main>final report</main></body></html>",
  });
  const createTemp = toolCall("artifacts", {
    command: "create",
    filename: "temporary.txt",
    content: "remove me",
  });
  const deleteTemp = toolCall("artifacts", {
    command: "delete",
    filename: "temporary.txt",
  });
  const getNotes = toolCall("artifacts", {
    command: "get",
    filename: "notes.txt",
  });
  const getLogs = toolCall("artifacts", {
    command: "logs",
    filename: "report.html",
  });

  return {
    title: "Artifact command reconstruction",
    messages: [
      userMessage("Seed artifact command history.", BASE_TIMESTAMP),
      assistantTextMessage("Create notes.", {
        timestamp: BASE_TIMESTAMP + 1,
        toolCalls: [createNotes],
        stopReason: "toolUse",
      }),
      toolResultMessage(createNotes.id, "artifacts", "Created file notes.txt", {
        timestamp: BASE_TIMESTAMP + 2,
      }),
      assistantTextMessage("Update notes.", {
        timestamp: BASE_TIMESTAMP + 3,
        toolCalls: [updateNotes],
        stopReason: "toolUse",
      }),
      toolResultMessage(updateNotes.id, "artifacts", "Updated file notes.txt", {
        timestamp: BASE_TIMESTAMP + 4,
      }),
      assistantTextMessage("Rewrite report.", {
        timestamp: BASE_TIMESTAMP + 5,
        toolCalls: [rewriteReport],
        stopReason: "toolUse",
      }),
      toolResultMessage(rewriteReport.id, "artifacts", "Rewrote file report.html", {
        timestamp: BASE_TIMESTAMP + 6,
      }),
      assistantTextMessage("Create temp.", {
        timestamp: BASE_TIMESTAMP + 7,
        toolCalls: [createTemp],
        stopReason: "toolUse",
      }),
      toolResultMessage(createTemp.id, "artifacts", "Created file temporary.txt", {
        timestamp: BASE_TIMESTAMP + 8,
      }),
      assistantTextMessage("Delete temp.", {
        timestamp: BASE_TIMESTAMP + 9,
        toolCalls: [deleteTemp],
        stopReason: "toolUse",
      }),
      toolResultMessage(deleteTemp.id, "artifacts", "Deleted file temporary.txt", {
        timestamp: BASE_TIMESTAMP + 10,
      }),
      assistantTextMessage("Read notes.", {
        timestamp: BASE_TIMESTAMP + 11,
        toolCalls: [getNotes],
        stopReason: "toolUse",
      }),
      toolResultMessage(getNotes.id, "artifacts", "beta", {
        timestamp: BASE_TIMESTAMP + 12,
      }),
      assistantTextMessage("Read html logs.", {
        timestamp: BASE_TIMESTAMP + 13,
        toolCalls: [getLogs],
        stopReason: "toolUse",
      }),
      toolResultMessage(getLogs.id, "artifacts", "(no logs yet)", {
        timestamp: BASE_TIMESTAMP + 14,
      }),
    ],
  };
}

beforeAll(async () => {
  await ensureBuilt();
});

async function openSeededSession(page: SvvyApp["page"], expectedTitle: string) {
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

async function openArtifactTab(page: SvvyApp["page"], filename: string) {
  await page
    .getByRole("tab", { name: new RegExp(escapeForRegExp(filename)) })
    .click({ force: true });
  expect((await page.locator(".artifact-name").textContent())?.trim()).toBe(filename);
}

async function ensureArtifactsPanelOpen(page: SvvyApp["page"], count: number) {
  const panel = page.locator(".artifacts-panel");
  if (await panel.isVisible()) {
    return;
  }

  await page.getByRole("button", { name: new RegExp(`Artifacts ${count}`) }).click({ force: true });
  await panel.waitFor({ state: "visible" });
}

test("seeded create/update/rewrite/delete/get/logs history reconstructs the intended artifact surface", async () => {
  await withSvvyApp(
    {
      beforeLaunch: async ({ homeDir, workspaceDir }) => {
        await seedSessions(homeDir, [artifactCommandSession()], workspaceDir);
      },
    },
    async ({ page }) => {
      await openSeededSession(page, "Artifact command reconstruction");

      const artifactsButton = page.getByRole("button", { name: /Artifacts 2/ });
      await artifactsButton.waitFor({ state: "visible" });
      await ensureArtifactsPanelOpen(page, 2);

      expect(await page.getByRole("tab").count()).toBe(2);
      expect(await page.getByRole("tab", { name: /temporary\.txt/ }).count()).toBe(0);

      await openArtifactTab(page, "notes.txt");
      expect(await page.locator(".artifact-kind").textContent()).toBe("text");
      expect((await page.locator(".artifact-code").textContent())?.trim()).toBe("beta");

      await openArtifactTab(page, "report.html");
      expect(await page.locator(".artifact-kind").textContent()).toBe("html");
      await page.locator("iframe.artifact-preview").waitFor({ state: "visible" });

      const toolResults = page.locator(".tool-result");
      expect(await toolResults.count()).toBe(7);
      expect((await toolResults.nth(5).textContent()) ?? "").toContain("beta");
      expect((await toolResults.nth(6).textContent()) ?? "").toContain("(no logs yet)");
    },
  );
});
