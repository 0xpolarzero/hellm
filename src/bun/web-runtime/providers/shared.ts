import type {
  WebArtifactRef,
  WebInvocationContext,
  WebProviderErrorCategory,
  WebProviderId,
  WebProviderToolResult,
  WebProviderToolResultDetails,
} from "../contracts";

export function assertPublicWebUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw providerError("invalid_url", `Invalid URL: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw providerError("invalid_url", "web.fetch only supports public http(s) URLs.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  ) {
    throw providerError(
      "invalid_url",
      "web.fetch cannot access localhost or private-network URLs.",
    );
  }
  return url.href;
}

export function providerError(
  category: WebProviderErrorCategory,
  message: string,
): Error & { category: WebProviderErrorCategory } {
  const error = new Error(message) as Error & { category: WebProviderErrorCategory };
  error.category = category;
  return error;
}

export async function fetchWithTimeout(
  url: string,
  options: {
    timeoutMs: number;
    signal?: AbortSignal;
    headers?: Record<string, string>;
    method?: string;
    body?: string;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      body: options.body,
      headers: options.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw providerError(
        response.status === 401 || response.status === 403
          ? "provider_authentication_failed"
          : "fetch_failed",
        `Request failed with HTTP ${response.status}.`,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw providerError("timeout", "Web provider request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function createFetchArtifacts(input: {
  context: WebInvocationContext;
  providerId: WebProviderId;
  url: string;
  finalUrl?: string;
  title?: string;
  format: "markdown" | "html" | "text" | "json";
  content: string;
  warnings: string[];
}): {
  fetchedAt: string;
  artifacts: WebArtifactRef[];
  metadataArtifact: WebArtifactRef;
  commandFacts: Record<string, unknown>;
} {
  const fetchedAt = new Date().toISOString();
  const extension = input.format === "json" ? "json" : input.format === "html" ? "html" : "md";
  const contentArtifact = input.context.createArtifact({
    kind: input.format === "json" ? "json" : "text",
    name: `web-fetch.${extension}`,
    content: input.content,
  });
  const artifacts: WebArtifactRef[] = [
    {
      artifactId: contentArtifact.id,
      path: contentArtifact.path ?? "",
      url: input.url,
      finalUrl: input.finalUrl,
      title: input.title,
      format: input.format,
    },
  ];
  const metadata = {
    providerId: input.providerId,
    url: input.url,
    finalUrl: input.finalUrl,
    title: input.title,
    format: input.format,
    fetchedAt,
    warnings: input.warnings,
    artifacts,
  };
  const metadataArtifactRaw = input.context.createArtifact({
    kind: "json",
    name: "web-fetch.metadata.json",
    content: JSON.stringify(metadata, null, 2),
  });
  const metadataArtifact: WebArtifactRef = {
    artifactId: metadataArtifactRaw.id,
    path: metadataArtifactRaw.path ?? "",
    format: "json",
  };
  const commandFacts = {
    providerId: input.providerId,
    toolName: "web.fetch",
    status: "succeeded",
    url: input.url,
    finalUrl: input.finalUrl,
    title: input.title,
    format: input.format,
    fetchedAt,
    artifactPaths: artifacts.map((artifact) => artifact.path),
    artifactIds: artifacts.map((artifact) => artifact.artifactId),
    metadataArtifactPath: metadataArtifact.path,
    metadataArtifactId: metadataArtifact.artifactId,
    warnings: input.warnings,
  };
  return { fetchedAt, artifacts, metadataArtifact, commandFacts };
}

export function textResult(
  text: string,
  details: WebProviderToolResultDetails,
): WebProviderToolResult {
  return { content: [{ type: "text", text }], details };
}
