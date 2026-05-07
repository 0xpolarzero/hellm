import { TINYFISH_TOOL_CONTRACTS } from "../provider-contracts/tinyfish";
import { TINYFISH_WEB_PROMPT } from "../provider-prompts/tinyfish";
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
import {
  assertPublicWebUrl,
  createFetchArtifacts,
  fetchWithTimeout,
  htmlToText,
  textResult,
} from "./shared";

export class TinyFishWebProvider implements WebProvider {
  readonly id = "tinyfish" as const;
  readonly label = "TinyFish";
  readonly capabilities: WebProviderCapabilities = {
    search: true,
    fetch: true,
    extraTools: [],
    supportsSiteSearch: false,
    supportsRecency: false,
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
            "TinyFish web tools are unavailable until a TinyFish API key is configured in Settings.",
          missingRequirement: "TinyFish API key",
        };
  }

  getToolContracts(): WebProviderToolContracts {
    return TINYFISH_TOOL_CONTRACTS;
  }

  buildPromptNotes(): WebProviderPromptNotes {
    return {
      source: "src/bun/web-runtime/provider-prompts/tinyfish.ts",
      text: TINYFISH_WEB_PROMPT,
    };
  }

  async invoke(
    toolName: WebToolName,
    input: unknown,
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    if (!this.apiKey) throw new Error("TinyFish API key is not configured.");
    return toolName === "web.search"
      ? this.search(
          input as {
            query: string;
            limit?: number;
            location?: string;
            language?: string;
            page?: number;
          },
          context,
        )
      : this.fetch(input as { url: string; format?: string; timeoutMs?: number }, context);
  }

  private async search(
    input: { query: string; limit?: number; location?: string; language?: string; page?: number },
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("TinyFish API key is not configured.");
    const url = new URL("https://api.search.tinyfish.ai");
    url.searchParams.set("query", input.query);
    if (input.location) url.searchParams.set("location", input.location);
    if (input.language) url.searchParams.set("language", input.language);
    if (typeof input.page === "number") url.searchParams.set("page", String(input.page));
    const response = await fetchWithTimeout(url.href, {
      timeoutMs: 30000,
      signal: context.signal,
      headers: {
        "X-API-Key": apiKey,
      },
    });
    const json = (await response.json()) as { results?: unknown[] };
    const results = (Array.isArray(json.results) ? json.results : []).slice(0, input.limit ?? 10);
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
    input: { url: string; format?: string; timeoutMs?: number },
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    const apiKey = this.apiKey;
    if (!apiKey) throw new Error("TinyFish API key is not configured.");
    const url = assertPublicWebUrl(input.url);
    const response = await fetchWithTimeout("https://api.fetch.tinyfish.ai", {
      method: "POST",
      timeoutMs: input.timeoutMs ?? 45000,
      signal: context.signal,
      headers: {
        "content-type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ urls: [url], format: input.format ?? "markdown" }),
    });
    const json = (await response.json()) as {
      results?: Array<Record<string, unknown>>;
      errors?: unknown[];
    };
    const page = json.results?.[0] ?? {};
    const text = page.text;
    const markdown =
      typeof text === "string"
        ? text
        : text
          ? JSON.stringify(text, null, 2)
          : readString(page.content);
    const html = readString(page.html);
    const format = markdown ? "markdown" : html ? "html" : "json";
    const content = markdown ?? html ?? JSON.stringify(page, null, 2);
    const warnings =
      Array.isArray(json.errors) && json.errors.length > 0
        ? ["TinyFish returned per-URL fetch errors."]
        : [];
    const artifacts = createFetchArtifacts({
      context,
      providerId: this.id,
      url,
      finalUrl: readString(page.final_url) ?? readString(page.finalUrl) ?? url,
      title: readString(page.title),
      format,
      content: format === "html" ? htmlToText(content) : content,
      warnings,
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
        finalUrl: readString(page.final_url) ?? readString(page.finalUrl) ?? url,
        fetchedAt: artifacts.fetchedAt,
        format,
        artifacts: artifacts.artifacts,
        metadataArtifact: artifacts.metadataArtifact,
        commandFacts: artifacts.commandFacts,
      },
    );
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
