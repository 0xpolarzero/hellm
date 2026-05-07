import { FIRECRAWL_TOOL_CONTRACTS } from "../provider-contracts/firecrawl";
import { FIRECRAWL_WEB_PROMPT } from "../provider-prompts/firecrawl";
import type {
  WebInvocationContext,
  WebProvider,
  WebProviderCapabilities,
  WebProviderPromptNotes,
  WebProviderReadyState,
  WebProviderToolContracts,
  WebProviderToolResult,
  WebToolName,
} from "../contracts";
import { assertPublicWebUrl, createFetchArtifacts, fetchWithTimeout, textResult } from "./shared";

export class FirecrawlWebProvider implements WebProvider {
  readonly id = "firecrawl" as const;
  readonly label = "Firecrawl";
  readonly capabilities: WebProviderCapabilities = {
    search: true,
    fetch: true,
    extraTools: [],
    supportsSiteSearch: true,
    supportsRecency: true,
    supportsRenderedFetch: true,
  };

  constructor(private readonly apiKey?: string) {}

  checkReady(): WebProviderReadyState {
    return this.apiKey
      ? { ready: true, providerId: this.id, label: this.label }
      : {
          ready: false,
          providerId: this.id,
          label: this.label,
          category: "provider_not_configured",
          message:
            "Firecrawl web tools are unavailable until a Firecrawl API key is configured in Settings.",
          missingRequirement: "Firecrawl API key",
        };
  }

  getToolContracts(): WebProviderToolContracts {
    return FIRECRAWL_TOOL_CONTRACTS;
  }

  buildPromptNotes(): WebProviderPromptNotes {
    return {
      source: "src/bun/web-runtime/provider-prompts/firecrawl.ts",
      text: FIRECRAWL_WEB_PROMPT,
    };
  }

  async invoke(
    toolName: WebToolName,
    input: unknown,
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    if (!this.apiKey) throw new Error("Firecrawl API key is not configured.");
    return toolName === "web.search"
      ? this.search(input as Record<string, unknown> & { query: string }, context)
      : this.fetch(input as Record<string, unknown> & { url: string }, context);
  }

  private async search(
    input: Record<string, unknown> & { query: string },
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    const response = await fetchWithTimeout("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      timeoutMs: 30000,
      signal: context.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(input),
    });
    const json = (await response.json()) as Record<string, unknown>;
    const results = readFirecrawlResults(json);
    return textResult(JSON.stringify({ providerId: this.id, results }, null, 2), {
      providerId: this.id,
      toolName: "web.search",
      status: "succeeded",
      query: input.query,
      resultCount: results.length,
      commandFacts: {
        providerId: this.id,
        toolName: "web.search",
        status: "succeeded",
        query: input.query,
        resultCount: results.length,
      },
    });
  }

  private async fetch(
    input: Record<string, unknown> & { url: string },
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    const url = assertPublicWebUrl(input.url);
    const response = await fetchWithTimeout("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      timeoutMs: typeof input.timeout === "number" ? input.timeout : 45000,
      signal: context.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ ...input, url }),
    });
    const json = (await response.json()) as Record<string, unknown>;
    const data = (json.data && typeof json.data === "object" ? json.data : json) as Record<
      string,
      unknown
    >;
    const markdown = readString(data.markdown);
    const html = readString(data.html) ?? readString(data.rawHtml);
    const format = markdown ? "markdown" : html ? "html" : "json";
    const artifacts = createFetchArtifacts({
      context,
      providerId: this.id,
      url,
      finalUrl: readString(data.url) ?? url,
      title: readString((data.metadata as Record<string, unknown> | undefined)?.title),
      format,
      content: markdown ?? html ?? JSON.stringify(data, null, 2),
      warnings: [],
    });
    return textResult(
      JSON.stringify(
        {
          providerId: this.id,
          artifacts: artifacts.artifacts,
          metadataArtifact: artifacts.metadataArtifact,
        },
        null,
        2,
      ),
      {
        providerId: this.id,
        toolName: "web.fetch",
        status: "succeeded",
        url,
        finalUrl: readString(data.url) ?? url,
        fetchedAt: artifacts.fetchedAt,
        format,
        artifacts: artifacts.artifacts,
        metadataArtifact: artifacts.metadataArtifact,
        commandFacts: artifacts.commandFacts,
      },
    );
  }
}

function readFirecrawlResults(json: Record<string, unknown>): unknown[] {
  const data = json.data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const entries = Object.values(data as Record<string, unknown>).flatMap((value) =>
      Array.isArray(value) ? value : [],
    );
    if (entries.length > 0) return entries;
  }
  return [];
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
