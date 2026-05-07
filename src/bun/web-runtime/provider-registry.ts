import type { WebProvider, WebProviderId, WebProviderSecrets, WebSettings } from "./contracts";
import { FirecrawlWebProvider } from "./providers/firecrawl";
import { LocalWebProvider } from "./providers/local";
import { TinyFishWebProvider } from "./providers/tinyfish";

export const WEB_PROVIDER_LABELS: Record<WebProviderId, string> = {
  local: "Local",
  tinyfish: "TinyFish",
  firecrawl: "Firecrawl",
};

export function createWebProvider(
  settings: WebSettings,
  secrets: WebProviderSecrets = {},
): WebProvider {
  if (settings.provider === "tinyfish") return new TinyFishWebProvider(secrets.tinyfishApiKey);
  if (settings.provider === "firecrawl") return new FirecrawlWebProvider(secrets.firecrawlApiKey);
  return new LocalWebProvider();
}

export function normalizeWebProviderId(value: string | undefined): WebProviderId {
  return value === "tinyfish" || value === "firecrawl" || value === "local" ? value : "local";
}
