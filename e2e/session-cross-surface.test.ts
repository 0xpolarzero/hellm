import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { ensureBuilt, escapeForRegExp, withHellmApp, type HellmApp } from "./harness";
import {
	artifactCreateConversation,
	assistantTextMessage,
	seedSessions,
	type SeedSessionInput,
	userMessage,
} from "./support";

setDefaultTimeout(45_000);

const BASE_TIMESTAMP = Date.parse("2026-04-10T10:00:00.000Z");

beforeAll(async () => {
	await ensureBuilt();
});

function sessionButton(page: HellmApp["page"], title: string) {
	return page.getByRole("button", { name: new RegExp(escapeForRegExp(title)) }).first();
}

async function text(page: HellmApp["page"], selector: string): Promise<string> {
	return (await page.locator(selector).textContent())?.trim() ?? "";
}

async function waitForText(
	locator: {
		textContent(): Promise<string | null>;
	},
	expected: string,
	timeoutMs = 15_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastText = "";

	while (Date.now() < deadline) {
		lastText = (await locator.textContent())?.trim() ?? "";
		if (lastText === expected) {
			return;
		}
		await Bun.sleep(100);
	}

	throw new Error(`Timed out waiting for text "${expected}". Last text was "${lastText}".`);
}

async function openSession(page: HellmApp["page"], title: string): Promise<void> {
	await sessionButton(page, title).click({ force: true });
	await waitForText(page.locator(".workspace-main-title"), title);
}

async function seedApp(
	sessions: SeedSessionInput[],
	fn: (app: HellmApp) => Promise<void>,
): Promise<void> {
	await withHellmApp(
		{
			beforeLaunch: async ({ homeDir, workspaceDir }) => {
				await seedSessions(homeDir, sessions, workspaceDir);
			},
		},
		fn,
	);
}

test("cross-surface session behavior stays coherent when switching among artifacts and controls", async () => {
	const longTitle =
		"A very long session title that should visibly truncate in the sidebar yet still be fully operable";

	await seedApp(
		[
			{
				title: "User Only Session",
				messages: [userMessage("A session can exist without an assistant reply.", BASE_TIMESTAMP)],
			},
			{
				title: longTitle,
				messages: [
					userMessage("Long title prompt.", BASE_TIMESTAMP + 10),
					assistantTextMessage("Long title reply.", {
						timestamp: BASE_TIMESTAMP + 11,
					}),
				],
			},
			{
				title: "Control Session",
				messages: [
					userMessage("Control prompt.", BASE_TIMESTAMP + 20),
					assistantTextMessage("Control reply.", {
						timestamp: BASE_TIMESTAMP + 21,
					}),
				],
			},
			{
				title: "Plain Session",
				messages: [
					userMessage("Plain session prompt.", BASE_TIMESTAMP + 30),
					assistantTextMessage("Plain session reply.", {
						timestamp: BASE_TIMESTAMP + 31,
					}),
				],
			},
			{
				title: "Artifacts Session",
				messages: artifactCreateConversation({
					timestamp: BASE_TIMESTAMP + 40,
					filename: "report.html",
					content: "<html><body><main>Artifact preview</main></body></html>",
					prompt: "Create an artifact for the surface switch test.",
				}),
			},
			{
				title: "Light Session",
				model: "glm-5-turbo",
				thinkingLevel: "off",
				messages: [
					userMessage("Light session prompt.", BASE_TIMESTAMP + 50),
					assistantTextMessage("Light session reply.", {
						model: "glm-5-turbo",
						provider: "zai",
						timestamp: BASE_TIMESTAMP + 51,
					}),
				],
			},
			{
				title: "Heavy Session",
				model: "glm-4.7-flash",
				thinkingLevel: "high",
				messages: [
					userMessage("Heavy session prompt.", BASE_TIMESTAMP + 60),
					assistantTextMessage("Heavy session reply.", {
						model: "glm-4.7-flash",
						provider: "zai",
						timestamp: BASE_TIMESTAMP + 61,
					}),
				],
			},
			],
			async ({ page }) => {
				await waitForText(page.locator(".workspace-main-title"), "Heavy Session");
				await openSession(page, "Heavy Session");
				await waitForText(page.locator(".model-control strong"), "GLM-4.7-Flash");
				await waitForText(page.locator(".thinking-field strong"), "high");

			await openSession(page, "Light Session");
			await waitForText(page.locator(".model-control strong"), "GLM-5-Turbo");
			await waitForText(page.locator(".thinking-field strong"), "off");

			await openSession(page, "Heavy Session");
			await waitForText(page.locator(".model-control strong"), "GLM-4.7-Flash");
			await waitForText(page.locator(".thinking-field strong"), "high");

			await openSession(page, "Artifacts Session");
			await page.locator(".artifacts-panel").waitFor({ state: "visible" });
			expect(await text(page, ".artifact-name")).toBe("report.html");
			expect((await page.getByRole("button", { name: "Artifacts 1" }).resolve()).first?.disabled).toBe(false);

			await openSession(page, "Plain Session");
			await page.locator(".artifacts-panel").waitFor({ state: "detached" });
			expect((await page.getByRole("button", { name: "Artifacts 0" }).resolve()).first?.disabled).toBe(true);
			expect(await page.locator(".artifacts-panel").count()).toBe(0);

			await openSession(page, "Artifacts Session");
			await page.locator(".artifacts-panel").waitFor({ state: "visible" });
			expect(await text(page, ".artifact-name")).toBe("report.html");
			expect((await page.getByRole("button", { name: "Artifacts 1" }).resolve()).first?.disabled).toBe(false);

		},
	);
});
