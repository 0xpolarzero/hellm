import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, type SvvyApp, withSvvyApp } from "./harness";

setDefaultTimeout(90_000);

beforeAll(async () => {
  await ensureBuilt();
});

async function openAgentsPane(page: SvvyApp["page"]): Promise<void> {
  await page.getByRole("button", { name: "Open agent profiles" }).click({ force: true });
  await page.getByTestId("agents-pane").waitFor({ state: "visible" });
}

async function agentsPaneText(page: SvvyApp["page"]): Promise<string> {
  return (await page.getByTestId("agents-pane").textContent()) ?? "";
}

async function waitForAgentsPaneTokens(page: SvvyApp["page"]): Promise<string> {
  const deadline = Date.now() + 15_000;
  let text = "";
  let previewError = "";

  while (Date.now() < deadline) {
    text = await agentsPaneText(page);
    previewError =
      (await page
        .attrs("css:.profile-extension-preview-error")
        .then((result) => result.attributes.title ?? "")
        .catch(() => "")) || previewError;
    if (/~[\d,.]+k? tokens total/.test(text) && /~[\d,.]+k? tokens/.test(text)) {
      return text;
    }
    await Bun.sleep(100);
  }

  throw new Error(
    `Timed out waiting for Agents pane token counts. Preview error: ${previewError || "none"}. Last text: ${text}`,
  );
}

test("keeps expanded agent token counts visible across extension state refresh", async () => {
  await withSvvyApp({ openInitialWorkspace: false }, async ({ page }) => {
    await openAgentsPane(page);

    await page.getByRole("button", { name: "Expand Default" }).click({ force: true });
    const initialText = await waitForAgentsPaneTokens(page);

    expect(initialText).toContain("tokens total");
    expect(initialText).not.toContain("Preview failed");
    expect(await page.locator(".agents-error").count()).toBe(0);

    await page.getByRole("button", { name: "Set Shell to Off" }).click({ force: true });
    const refreshText = await waitForAgentsPaneTokens(page);

    expect(refreshText).toContain("tokens total");
    expect(refreshText).not.toContain("Preview failed");
    expect(await page.locator(".agents-error").count()).toBe(0);
    expect(await page.getByTestId("agents-pane").isVisible()).toBe(true);
  });
});
