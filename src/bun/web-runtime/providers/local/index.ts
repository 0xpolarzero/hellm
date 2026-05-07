import { LOCAL_TOOL_CONTRACTS } from "../../provider-contracts/local";
import { LOCAL_WEB_PROMPT } from "../../provider-prompts/local";
import type {
  WebInvocationContext,
  WebProvider,
  WebProviderCapabilities,
  WebProviderPromptNotes,
  WebProviderReadyState,
  WebProviderToolContracts,
  WebProviderToolResult,
  WebToolName,
} from "../../contracts";
import {
  assertPublicWebUrl,
  createFetchArtifacts,
  fetchWithTimeout,
  htmlToText,
  textResult,
} from "../shared";

const capabilities: WebProviderCapabilities = {
  search: true,
  fetch: true,
  extraTools: [],
  supportsSiteSearch: true,
  supportsRecency: false,
  supportsRenderedFetch: false,
};

export class LocalWebProvider implements WebProvider {
  readonly id = "local" as const;
  readonly label = "Local";
  readonly capabilities = capabilities;

  checkReady(): WebProviderReadyState {
    return { ready: true, providerId: this.id, label: this.label };
  }

  getToolContracts(): WebProviderToolContracts {
    return LOCAL_TOOL_CONTRACTS;
  }

  buildPromptNotes(): WebProviderPromptNotes {
    return { source: "src/bun/web-runtime/provider-prompts/local.ts", text: LOCAL_WEB_PROMPT };
  }

  async invoke(
    toolName: WebToolName,
    input: unknown,
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    return toolName === "web.search"
      ? this.search(input as { query: string; limit?: number; site?: string }, context)
      : this.fetch(
          input as { url: string; format?: "markdown" | "text" | "html"; timeoutMs?: number },
          context,
        );
  }

  private async search(
    input: { query: string; limit?: number; site?: string },
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    const query = [input.query, input.site ? `site:${input.site}` : ""].filter(Boolean).join(" ");
    const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const warnings = [
      "Local search uses a no-key public HTML search endpoint; ranking and availability may vary.",
    ];
    const response = await fetchWithTimeout(url, { timeoutMs: 10000, signal: context.signal });
    const html = await response.text();
    const results = parseDuckDuckGoResults(html).slice(0, limit);
    const details = {
      providerId: this.id,
      toolName: "web.search" as const,
      status: "succeeded" as const,
      resultCount: results.length,
      query: input.query,
      warnings,
      commandFacts: {
        providerId: this.id,
        toolName: "web.search",
        status: "succeeded",
        query: input.query,
        resultCount: results.length,
        warnings,
      },
    };
    return textResult(JSON.stringify({ providerId: this.id, results, warnings }, null, 2), details);
  }

  private async fetch(
    input: { url: string; format?: "markdown" | "text" | "html"; timeoutMs?: number },
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult> {
    const url = assertPublicWebUrl(input.url);
    const response = await fetchWithTimeout(url, {
      timeoutMs: input.timeoutMs ?? 15000,
      signal: context.signal,
    });
    const finalUrl = response.url || url;
    const html = await response.text();
    const title = readHtmlTitle(html);
    const format = input.format ?? "markdown";
    const content = format === "html" ? html : htmlToText(html);
    const artifacts = createFetchArtifacts({
      context,
      providerId: this.id,
      url,
      finalUrl,
      title,
      format,
      content,
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
        finalUrl,
        fetchedAt: artifacts.fetchedAt,
        format,
        artifacts: artifacts.artifacts,
        metadataArtifact: artifacts.metadataArtifact,
        commandFacts: artifacts.commandFacts,
      },
    );
  }
}

function parseDuckDuckGoResults(
  html: string,
): Array<{ title: string; url: string; snippet?: string }> {
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const anchorPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(anchorPattern)) {
    const rawUrl = decodeHtml(match[1] ?? "");
    const url = unwrapDuckDuckGoUrl(rawUrl);
    if (!url.startsWith("http://") && !url.startsWith("https://")) continue;
    results.push({ title: htmlToText(match[2] ?? "").trim(), url });
  }
  return results;
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.href;
  } catch {
    return rawUrl;
  }
}

function readHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match ? htmlToText(match[1] ?? "").trim() : "";
  return title || undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
