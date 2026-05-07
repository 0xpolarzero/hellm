import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";

export type WebProviderId = "local" | "tinyfish" | "firecrawl";
export type WebToolName = "web.search" | "web.fetch";
export type WebProviderErrorCategory =
  | "provider_not_configured"
  | "provider_authentication_failed"
  | "rate_limited"
  | "unsupported_option"
  | "invalid_url"
  | "fetch_failed"
  | "extraction_failed"
  | "timeout"
  | "provider_unavailable";

export type WebProviderCapabilities = {
  search: boolean;
  fetch: boolean;
  extraTools: string[];
  supportsSiteSearch: boolean;
  supportsRecency: boolean;
  supportsRenderedFetch: boolean;
};

export type WebProviderReadyState =
  | { ready: true; providerId: WebProviderId; label: string }
  | {
      ready: false;
      providerId: WebProviderId;
      label: string;
      category: WebProviderErrorCategory;
      message: string;
      missingRequirement: string;
    };

export type WebProviderToolContract = {
  name: WebToolName;
  description: string;
  inputSchema: TSchema;
  outputTypeName: string;
  inputTypeDeclaration: string;
  outputTypeDeclaration: string;
};

export type WebProviderToolContracts = {
  search: WebProviderToolContract;
  fetch: WebProviderToolContract;
};

export type WebProviderPromptNotes = {
  source: string;
  text: string;
};

export type WebArtifactRef = {
  artifactId: string;
  path: string;
  url?: string;
  finalUrl?: string;
  title?: string;
  format: "markdown" | "html" | "text" | "json";
};

export type WebProviderToolResultDetails = {
  providerId: WebProviderId;
  toolName: WebToolName;
  status: "succeeded" | "failed";
  resultCount?: number;
  query?: string;
  url?: string;
  finalUrl?: string;
  fetchedAt?: string;
  format?: string;
  artifacts?: WebArtifactRef[];
  metadataArtifact?: WebArtifactRef;
  warnings?: string[];
  error?: {
    category: WebProviderErrorCategory;
    message: string;
  };
  commandFacts: Record<string, unknown>;
};

export type WebProviderToolResult = AgentToolResult<WebProviderToolResultDetails>;

export interface WebProvider {
  readonly id: WebProviderId;
  readonly label: string;
  readonly capabilities: WebProviderCapabilities;
  checkReady(): WebProviderReadyState;
  getToolContracts(): WebProviderToolContracts;
  invoke(
    toolName: WebToolName,
    input: unknown,
    context: WebInvocationContext,
  ): Promise<WebProviderToolResult>;
  buildPromptNotes(): WebProviderPromptNotes;
}

export type WebInvocationContext = {
  cwd: string;
  commandId: string;
  signal?: AbortSignal;
  createArtifact(input: {
    kind: "text" | "json" | "log" | "file";
    name: string;
    content: string;
  }): { id: string; path?: string };
};

export type WebSettings = {
  provider: WebProviderId;
};

export type WebProviderSecrets = {
  tinyfishApiKey?: string;
  firecrawlApiKey?: string;
};

export function providerNotReadyResult(
  readyState: Extract<WebProviderReadyState, { ready: false }>,
  toolName: WebToolName,
): WebProviderToolResult {
  const facts = {
    providerId: readyState.providerId,
    toolName,
    status: "failed",
    errorCategory: readyState.category,
    missingRequirement: readyState.missingRequirement,
  };
  return {
    content: [{ type: "text", text: readyState.message }],
    details: {
      providerId: readyState.providerId,
      toolName,
      status: "failed",
      error: {
        category: readyState.category,
        message: readyState.message,
      },
      commandFacts: facts,
    },
  };
}
