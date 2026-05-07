import { Type } from "@mariozechner/pi-ai";
import type { WebProviderToolContracts } from "../contracts";

export const tinyfishSearchInputSchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
    location: Type.Optional(Type.String()),
    language: Type.Optional(Type.String()),
    page: Type.Optional(Type.Number({ minimum: 0, maximum: 10 })),
  },
  { additionalProperties: false },
);

export const tinyfishFetchInputSchema = Type.Object(
  {
    url: Type.String({ minLength: 1 }),
    format: Type.Optional(
      Type.Union([Type.Literal("markdown"), Type.Literal("html"), Type.Literal("json")]),
    ),
    waitUntil: Type.Optional(
      Type.Union([
        Type.Literal("load"),
        Type.Literal("domcontentloaded"),
        Type.Literal("networkidle"),
      ]),
    ),
    timeoutMs: Type.Optional(Type.Number({ minimum: 1000, maximum: 60000 })),
  },
  { additionalProperties: false },
);

export const TINYFISH_TOOL_CONTRACTS: WebProviderToolContracts = {
  search: {
    name: "web.search",
    description: "Search with TinyFish Search using TinyFish-shaped options.",
    inputSchema: tinyfishSearchInputSchema,
    outputTypeName: "TinyFishWebSearchOutput",
    inputTypeDeclaration:
      "interface ActiveWebSearchInput  { query: string; limit?: number; location?: string; language?: string; page?: number };",
    outputTypeDeclaration:
      'interface ActiveWebSearchOutput  { providerId: "tinyfish"; results: Array<{ title: string; url: string; snippet?: string; publishedDate?: string }>; warnings?: string[] };',
  },
  fetch: {
    name: "web.fetch",
    description:
      "Fetch rendered page content with TinyFish Fetch and write fetched bodies to svvy artifacts.",
    inputSchema: tinyfishFetchInputSchema,
    outputTypeName: "TinyFishWebFetchOutput",
    inputTypeDeclaration:
      'interface ActiveWebFetchInput  { url: string; format?: "markdown" | "html" | "json"; waitUntil?: "load" | "domcontentloaded"; timeoutMs?: number };',
    outputTypeDeclaration:
      'interface ActiveWebFetchOutput  { providerId: "tinyfish"; artifacts: Array<{ artifactId: string; path: string; url: string; finalUrl?: string; title?: string; format: "markdown" | "html" | "text" | "json" }>; metadataArtifact: { artifactId: string; path: string; format: "json" }; warnings?: string[] };',
  },
};
