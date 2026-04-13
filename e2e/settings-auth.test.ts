import { beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OAuthCredentials } from "@mariozechner/pi-ai";
import { ensureBuilt, type HellmApp, withHellmApp } from "./harness";
import { getTestAuthFile } from "./support";

setDefaultTimeout(45_000);

const BLANK_PROVIDER_ENV = {
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
} satisfies Record<string, string>;

const MIXED_AUTH_STATE = {
	anthropic: {
		type: "oauth",
		credentials: {
			refresh: "anthropic-refresh-token",
			access: "anthropic-access-token",
			expires: Date.now() + 60_000,
		} satisfies OAuthCredentials,
	},
	openai: {
		type: "apikey",
		key: "openai-e2e-key",
	},
} as const;

const OAUTH_SUPPORTED_PROVIDERS = [
	"anthropic",
	"github-copilot",
	"google-antigravity",
	"google-gemini-cli",
	"openai-codex",
] as const;

beforeAll(async () => {
	await ensureBuilt();
});

async function seedAuthState(
	homeDir: string,
	authState: Record<
		string,
		{ type: "apikey"; key: string } | { type: "oauth"; credentials: OAuthCredentials }
	>,
): Promise<void> {
	await mkdir(join(homeDir, ".config", "hellm"), { recursive: true });
	await writeFile(getTestAuthFile(homeDir), `${JSON.stringify(authState, null, 2)}\n`, {
		mode: 0o600,
	});
}

async function providerRow(page: HellmApp["page"], providerId: string) {
	const rows = page.locator(".provider-row");
	const count = await rows.count();

	for (let index = 0; index < count; index += 1) {
		const row = rows.nth(index);
		const name = (await row.locator(".provider-name").textContent())?.trim() ?? "";
		if (name === providerId) {
			return row;
		}
	}

	throw new Error(`Could not find provider row for "${providerId}".`);
}

async function openSettings(page: HellmApp["page"]): Promise<void> {
	await page.getByRole("button", { name: "Open settings" }).click();
	await page.getByRole("dialog").waitFor({ state: "visible" });
}

async function closeSettings(page: HellmApp["page"]): Promise<void> {
	await page.locator(".ui-dialog-close").click();
	await page.getByRole("dialog").waitFor({ state: "detached" });
}

async function providerNames(page: HellmApp["page"]): Promise<string[]> {
	const namesLocator = page.locator(".provider-name");
	const count = await namesLocator.count();
	const names: string[] = [];
	for (let index = 0; index < count; index += 1) {
		names.push((await namesLocator.nth(index).textContent())?.trim() ?? "");
	}
	return names;
}

async function waitForProviderNames(
	page: HellmApp["page"],
	expected: string[],
	timeoutMs = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastNames = await providerNames(page);

	while (Date.now() < deadline) {
		if (lastNames.length === expected.length && lastNames.every((name, index) => name === expected[index])) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, 100));
		lastNames = await providerNames(page);
	}

	throw new Error(`Timed out waiting for provider names ${JSON.stringify(expected)}. Last names: ${JSON.stringify(lastNames)}`);
}

async function providerStatus(page: HellmApp["page"], providerId: string): Promise<string> {
	return (await (await providerRow(page, providerId)).locator(".provider-status").textContent())?.trim() ?? "";
}

function noAuthEnv(overrides: Record<string, string> = {}): Record<string, string> {
	return {
		...BLANK_PROVIDER_ENV,
		...overrides,
	};
}

test("settings opens and closes from the workspace shell", async () => {
	await withHellmApp({ env: noAuthEnv() }, async ({ page }) => {
		await openSettings(page);
		await closeSettings(page);
		await openSettings(page);
		await closeSettings(page);
	});
});

test("provider list loads all real provider auth summaries", async () => {
	await withHellmApp({ env: noAuthEnv() }, async ({ page }) => {
		await openSettings(page);
		await page.locator(".provider-row").first().waitFor({ state: "visible" });

		const names = await providerNames(page);
		expect(names.length).toBeGreaterThan(10);
		expect(names).toContain("openai");
		expect(names).toContain("anthropic");
		expect(names).toContain("github-copilot");
		expect(names).toContain("zai");
	});
});

test("configured providers sort ahead of unconfigured ones", async () => {
	await withHellmApp(
		{
			env: noAuthEnv({
				ZAI_API_KEY: "zai-env-key",
			}),
			beforeLaunch: async ({ homeDir }) => {
				await seedAuthState(homeDir, MIXED_AUTH_STATE);
			},
		},
		async ({ page }) => {
			await openSettings(page);
			await page.locator(".provider-row").first().waitFor({ state: "visible" });

			const names = await providerNames(page);
			expect(names.slice(0, 3)).toEqual(["anthropic", "openai", "zai"]);
			expect(names.indexOf("openai-codex")).toBeGreaterThan(names.indexOf("zai"));
		},
	);
});

test("provider search matches OAuth capability and access state", async () => {
	await withHellmApp({ env: noAuthEnv({ ZAI_API_KEY: "zai-env-key" }) }, async ({ page }) => {
		await openSettings(page);
		await page.locator(".provider-row").first().waitFor({ state: "visible" });

		const search = page.locator('input[placeholder="Search providers, auth types, or access state"]');
		await search.fill("oauth");
		await waitForProviderNames(page, [...OAUTH_SUPPORTED_PROVIDERS]);

		await search.fill("env var");
		await waitForProviderNames(page, ["zai"]);
	});
});

test("provider status labels render for api key, oauth, env var, and unconfigured states", async () => {
	await withHellmApp(
		{
			env: noAuthEnv({
				ZAI_API_KEY: "zai-env-key",
			}),
			beforeLaunch: async ({ homeDir }) => {
				await seedAuthState(homeDir, MIXED_AUTH_STATE);
			},
		},
		async ({ page }) => {
			await openSettings(page);
			await page.locator(".provider-row").first().waitFor({ state: "visible" });

			expect(await providerStatus(page, "anthropic")).toBe("OAuth");
			expect(await providerStatus(page, "openai")).toBe("API key");
			expect(await providerStatus(page, "zai")).toBe("Env var");
			expect(await providerStatus(page, "openai-codex")).toBe("Not configured");
		},
	);
});

test("API key editor supports cancel and save flows", async () => {
	await withHellmApp({ env: noAuthEnv() }, async ({ page }) => {
		await openSettings(page);
		await page.locator(".provider-row").first().waitFor({ state: "visible" });

		const openaiRow = await providerRow(page, "openai");
		await openaiRow.getByRole("button", { name: "API Key" }).click({ force: true });

		const apiKeyInput = openaiRow.locator('input[placeholder="Paste API key..."]');
		await apiKeyInput.waitFor({ state: "visible" });
		await apiKeyInput.fill("temporary-cancel-key");
		await openaiRow.getByRole("button", { name: "Cancel" }).click({ force: true });
		await apiKeyInput.waitFor({ state: "detached" });
		expect(await providerStatus(page, "openai")).toBe("Not configured");

		await openaiRow.getByRole("button", { name: "API Key" }).click({ force: true });
		await openaiRow.locator('input[placeholder="Paste API key..."]').fill("saved-openai-key");
		await openaiRow.getByRole("button", { name: "Save" }).click({ force: true });

		await page.getByText("Saved").waitFor({ state: "visible" });
		await page.getByText("API key").waitFor({ state: "visible" });
		expect(await providerStatus(page, "openai")).toBe("API key");

		await closeSettings(page);
		await openSettings(page);
		await page.locator(".provider-row").first().waitFor({ state: "visible" });
		expect(await providerStatus(page, "openai")).toBe("API key");
	});
});

test("removing provider auth clears the status and shows feedback", async () => {
	await withHellmApp(
		{
			env: noAuthEnv(),
			beforeLaunch: async ({ homeDir }) => {
				await seedAuthState(homeDir, {
					openai: MIXED_AUTH_STATE.openai,
				});
			},
		},
		async ({ page }) => {
			await openSettings(page);
			await page.locator(".provider-row").first().waitFor({ state: "visible" });

			const openaiRow = await providerRow(page, "openai");
			expect(await providerStatus(page, "openai")).toBe("API key");

			await openaiRow.getByRole("button", { name: "Remove" }).click();
			await page.getByText("Removed").waitFor({ state: "visible" });
			await page.getByText("Not configured").waitFor({ state: "visible" });
			expect(await providerStatus(page, "openai")).toBe("Not configured");

			await closeSettings(page);
			await openSettings(page);
			await page.locator(".provider-row").first().waitFor({ state: "visible" });
			expect(await providerStatus(page, "openai")).toBe("Not configured");
		},
	);
});

test("supported providers show OAuth actions while unsupported ones do not", async () => {
	await withHellmApp({ env: noAuthEnv() }, async ({ page }) => {
		await openSettings(page);
		await page.locator(".provider-row").first().waitFor({ state: "visible" });

		for (const providerId of OAUTH_SUPPORTED_PROVIDERS) {
			await (await providerRow(page, providerId)).getByRole("button", { name: "OAuth" }).waitFor({ state: "visible" });
		}

		expect(await (await providerRow(page, "openai")).getByRole("button", { name: "OAuth" }).count()).toBe(0);
		expect(await (await providerRow(page, "zai")).getByRole("button", { name: "OAuth" }).count()).toBe(0);
	});
});

test("missing provider access opens settings when trying to send a prompt", async () => {
	await withHellmApp({ env: noAuthEnv() }, async ({ page }) => {
		const prompt = page.locator('textarea[placeholder="Ask hellm to inspect the repo, make a change, or run verification."]');
		await prompt.fill("Check auth gating.");
		await page.getByRole("button", { name: "Send" }).click();

		await page.getByRole("dialog").waitFor({ state: "visible" });
		await page.locator(".provider-row").first().waitFor({ state: "visible" });
		expect(await page.getByRole("button", { name: "Open settings" }).count()).toBe(1);
	});
});
