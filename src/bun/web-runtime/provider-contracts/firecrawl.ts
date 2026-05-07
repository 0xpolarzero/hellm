import { Type } from "@mariozechner/pi-ai";
import type { WebProviderToolContracts } from "../contracts";

const firecrawlFormatSchema = Type.Union([
  Type.Literal("markdown"),
  Type.Literal("html"),
  Type.Literal("rawHtml"),
  Type.Literal("links"),
  Type.Literal("screenshot"),
]);

export const firecrawlSearchInputSchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
    sources: Type.Optional(Type.Array(Type.String())),
    categories: Type.Optional(Type.Array(Type.String())),
    tbs: Type.Optional(Type.String()),
    location: Type.Optional(Type.String()),
    ignoreInvalidURLs: Type.Optional(Type.Boolean()),
    scrapeOptions: Type.Optional(
      Type.Object(
        {
          formats: Type.Optional(Type.Array(firecrawlFormatSchema)),
          onlyMainContent: Type.Optional(Type.Boolean()),
          includeTags: Type.Optional(Type.Array(Type.String())),
          excludeTags: Type.Optional(Type.Array(Type.String())),
          waitFor: Type.Optional(Type.Number()),
          timeout: Type.Optional(Type.Number()),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: false },
);

export const firecrawlFetchInputSchema = Type.Object(
  {
    url: Type.String({ minLength: 1 }),
    formats: Type.Optional(Type.Array(firecrawlFormatSchema)),
    onlyMainContent: Type.Optional(Type.Boolean()),
    includeTags: Type.Optional(Type.Array(Type.String())),
    excludeTags: Type.Optional(Type.Array(Type.String())),
    waitFor: Type.Optional(Type.Number()),
    timeout: Type.Optional(Type.Number()),
  },
  { additionalProperties: false },
);

export const FIRECRAWL_TOOL_CONTRACTS: WebProviderToolContracts = {
  search: {
    name: "web.search",
    description:
      "Search with Firecrawl Search. Supports Firecrawl-specific source/category filters and optional scrapeOptions.",
    inputSchema: firecrawlSearchInputSchema,
    outputTypeName: "FirecrawlWebSearchOutput",
    inputTypeDeclaration:
      'interface ActiveWebSearchInput  { query: string; limit?: number; sources?: string[]; categories?: string[]; tbs?: string; location?: string; ignoreInvalidURLs?: boolean; scrapeOptions?: { formats?: Array<"markdown" | "html" | "rawHtml" | "links" | "screenshot">; onlyMainContent?: boolean; includeTags?: string[]; excludeTags?: string[]; waitFor?: number; timeout?: number; [key: string]: unknown } };',
    outputTypeDeclaration:
      'interface ActiveWebSearchOutput  { providerId: "firecrawl"; results: Array<{ title?: string; url: string; description?: string; markdown?: string; metadata?: Record<string, unknown> }>; warnings?: string[] };',
  },
  fetch: {
    name: "web.fetch",
    description:
      "Scrape a known URL with Firecrawl scrape-shaped options and write fetched page bodies to svvy artifacts.",
    inputSchema: firecrawlFetchInputSchema,
    outputTypeName: "FirecrawlWebFetchOutput",
    inputTypeDeclaration:
      'interface ActiveWebFetchInput  { url: string; formats?: Array<"markdown" | "html" | "rawHtml" | "links" | "screenshot">; onlyMainContent?: boolean; includeTags?: string[]; excludeTags?: string[]; waitFor?: number; timeout?: number };',
    outputTypeDeclaration:
      'interface ActiveWebFetchOutput  { providerId: "firecrawl"; artifacts: Array<{ artifactId: string; path: string; url: string; finalUrl?: string; title?: string; format: "markdown" | "html" | "text" | "json" }>; metadataArtifact: { artifactId: string; path: string; format: "json" }; warnings?: string[] };',
  },
};
