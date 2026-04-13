import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHomeDir, ensureBuilt, escapeForRegExp, launchSvvyApp, type SvvyApp } from "./harness";
import {
	assistantTextMessage,
	seedSessions,
	toolCall,
	toolResultMessage,
	userMessage,
	type SeedSessionInput,
} from "./support";

setDefaultTimeout(60_000);

const DESKTOP_SPLIT_BREAKPOINT = 1220;
const BASE_TIMESTAMP = Date.parse("2026-04-10T15:00:00.000Z");
const REPORT_ARTIFACT_CONTENT = "Report from the artifacts panel test.";
const NOTES_ARTIFACT_CONTENT = "Notes from the artifacts panel test.";

beforeAll(async () => {
	await ensureBuilt();
});

function seededArtifactsSession(): SeedSessionInput {
	const reportCall = toolCall("artifacts", {
		command: "create",
		filename: "report.txt",
		content: REPORT_ARTIFACT_CONTENT,
	});
	const notesCall = toolCall("artifacts", {
		command: "create",
		filename: "notes.txt",
		content: NOTES_ARTIFACT_CONTENT,
	});

	return {
		title: "Artifact panel session",
		messages: [
			userMessage("Seed the artifact panel session.", BASE_TIMESTAMP),
			assistantTextMessage("Created the report.", {
				timestamp: BASE_TIMESTAMP + 1,
				toolCalls: [reportCall],
				stopReason: "toolUse",
			}),
			toolResultMessage(reportCall.id, "artifacts", "Created file report.txt", {
				timestamp: BASE_TIMESTAMP + 2,
			}),
			assistantTextMessage("Created the notes.", {
				timestamp: BASE_TIMESTAMP + 3,
				toolCalls: [notesCall],
				stopReason: "toolUse",
			}),
			toolResultMessage(notesCall.id, "artifacts", "Created file notes.txt", {
				timestamp: BASE_TIMESTAMP + 4,
			}),
			assistantTextMessage("The artifacts are ready.", {
				timestamp: BASE_TIMESTAMP + 5,
			}),
		],
	};
}

async function waitForWorkspace(page: SvvyApp["page"]): Promise<void> {
	await page.locator(".workspace-titlebar").waitFor({ state: "visible" });
	await page.locator(".workspace-footer").waitFor({ state: "visible" });
}

async function ensureArtifactsOpen(page: SvvyApp["page"], count: number): Promise<void> {
	const panel = page.locator(".artifacts-panel");
	if (await panel.isVisible()) {
		return;
	}

	await page.getByRole("button", { name: new RegExp(`Artifacts ${count}`) }).click({ force: true });
	await panel.waitFor({ state: "visible", timeout: 15_000 });
}

async function selectArtifact(page: SvvyApp["page"], filename: string): Promise<void> {
	await page.getByRole("tab", { name: new RegExp(escapeForRegExp(filename)) }).click({ force: true });
	await page.locator(".artifact-name").waitFor({ state: "visible" });
	expect((await page.locator(".artifact-name").textContent())?.trim()).toBe(filename);
}

async function assertLayoutMode(app: SvvyApp, page: SvvyApp["page"]): Promise<void> {
	const frame = (await app.driver.window("active").info()).frame;
	if (frame.width >= DESKTOP_SPLIT_BREAKPOINT) {
		await page.locator(".artifacts-slot.desktop-open").waitFor({
			state: "visible",
			timeout: 15_000,
		});
		expect(await page.locator(".artifacts-slot.mobile-slot").count()).toBe(0);
		expect(await page.locator(".artifacts-panel.overlay").count()).toBe(0);
		return;
	}

	await page.locator(".artifacts-slot.mobile-slot").waitFor({ state: "visible", timeout: 15_000 });
	await page.locator(".artifacts-panel.overlay").waitFor({ state: "visible", timeout: 15_000 });
	expect(await page.locator(".artifacts-slot.desktop-open").count()).toBe(0);
}

test("auto-opens the artifacts panel for seeded artifacts, supports close/reopen and tab switching, and matches the current layout mode", async () => {
	const homeDir = await createHomeDir();
	try {
		const app = await launchSvvyApp({
			homeDir,
			env: { ZAI_API_KEY: "stub-key" },
			beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
				await seedSessions(launchHomeDir, [seededArtifactsSession()], workspaceDir);
			},
		});

		try {
			await waitForWorkspace(app.page);
			await app.page.locator(".artifacts-panel").waitFor({ state: "visible", timeout: 15_000 });
			await app.page.getByRole("button", { name: /Artifacts 2/ }).waitFor({
				state: "visible",
				timeout: 15_000,
			});
			await assertLayoutMode(app, app.page);

			expect((await app.page.locator(".artifact-count").textContent())?.trim()).toBe("2 outputs");
			expect((await app.page.locator(".artifact-name").textContent())?.trim()).toBe("report.txt");
			expect((await app.page.locator(".artifact-code").textContent())?.trim()).toBe(
				REPORT_ARTIFACT_CONTENT,
			);

			await selectArtifact(app.page, "notes.txt");

			const panel = app.page.locator(".artifacts-panel");
			await panel.getByRole("button", { name: "Close" }).click({ force: true });
			await panel.waitFor({ state: "detached" });

			await app.page.getByRole("button", { name: /Artifacts 2/ }).click({ force: true });
			await panel.waitFor({ state: "visible", timeout: 15_000 });
			await assertLayoutMode(app, app.page);
			expect((await app.page.locator(".artifact-name").textContent())?.trim()).toBe("notes.txt");
			expect((await app.page.locator(".tab.active strong").textContent())?.trim()).toBe("notes.txt");
		} finally {
			await app.close();
		}
	} finally {
		await rm(homeDir, { force: true, recursive: true });
	}
});

test("reconstructs the artifacts panel after relaunch on the same home dir", async () => {
	const homeDir = await createHomeDir();
	try {
		const firstLaunch = await launchSvvyApp({
			homeDir,
			env: { ZAI_API_KEY: "stub-key" },
			beforeLaunch: async ({ homeDir: launchHomeDir, workspaceDir }) => {
				await seedSessions(launchHomeDir, [seededArtifactsSession()], workspaceDir);
			},
		});

		try {
			await waitForWorkspace(firstLaunch.page);
			await firstLaunch.page.locator(".artifacts-panel").waitFor({ state: "visible", timeout: 15_000 });
			await selectArtifact(firstLaunch.page, "notes.txt");
			await Bun.sleep(250);
		} finally {
			await firstLaunch.close();
		}

		const secondLaunch = await launchSvvyApp({
			homeDir,
			env: { ZAI_API_KEY: "stub-key" },
		});

		try {
			await waitForWorkspace(secondLaunch.page);
			await secondLaunch.page.locator(".artifacts-panel").waitFor({
				state: "visible",
				timeout: 15_000,
			});
			await assertLayoutMode(secondLaunch, secondLaunch.page);
			expect((await secondLaunch.page.locator(".artifact-count").textContent())?.trim()).toBe(
				"2 outputs",
			);
			expect((await secondLaunch.page.locator(".artifact-name").textContent())?.trim()).toBe(
				"report.txt",
			);
			expect((await secondLaunch.page.locator(".artifact-code").textContent())?.trim()).toBe(
				REPORT_ARTIFACT_CONTENT,
			);
		} finally {
			await secondLaunch.close();
		}
	} finally {
		await rm(homeDir, { force: true, recursive: true });
	}
});
