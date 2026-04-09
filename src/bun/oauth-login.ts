import { getOAuthProviders, type OAuthCredentials, type OAuthLoginCallbacks } from "@mariozechner/pi-ai/oauth";
import { getCredential, setOAuthCredentials, updateOAuthCredentials } from "./auth-store";

const refreshPromises = new Map<string, Promise<OAuthCredentials | null>>();

export function supportsOAuth(providerId: string): boolean {
	return getOAuthProviders().some((provider) => provider.id === providerId);
}

export async function startOAuthLogin(providerId: string): Promise<void> {
	const provider = getOAuthProviders().find((entry) => entry.id === providerId);
	if (!provider) throw new Error(`OAuth not supported for provider: ${providerId}`);

	const callbacks: OAuthLoginCallbacks = {
		onAuth: (info) => {
			const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
			import("node:child_process")
				.then(({ execSync }) => {
					execSync(`${command} "${info.url}"`);
				})
				.catch(() => {
					console.log(`Open this URL to authenticate:\n${info.url}`);
				});
		},
		onPrompt: async () => "",
	};

	const credentials = await provider.login(callbacks);
	setOAuthCredentials(providerId, credentials);
}

export async function refreshIfNeeded(providerId: string): Promise<string | undefined> {
	const pending = refreshPromises.get(providerId);
	if (pending) return (await pending)?.access ?? undefined;

	const stored = getCredential(providerId);
	if (!stored || stored.type !== "oauth") return undefined;

	const { credentials } = stored;
	if (credentials.expires > Date.now()) return credentials.access;

	const provider = getOAuthProviders().find((entry) => entry.id === providerId);
	if (!provider) return undefined;

	const refreshPromise = (async () => {
		try {
			const refreshed = await provider.refreshToken(credentials);
			updateOAuthCredentials(providerId, refreshed);
			return refreshed;
		} catch (error) {
			console.error(`Token refresh failed for ${providerId}:`, error);
			return null;
		} finally {
			refreshPromises.delete(providerId);
		}
	})();

	refreshPromises.set(providerId, refreshPromise);
	return (await refreshPromise)?.access ?? undefined;
}
