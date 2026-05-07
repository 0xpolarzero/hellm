import { Type } from "@mariozechner/pi-ai";
import type { WebProviderToolContracts } from "../contracts";

export const localSearchInputSchema = Type.Object(
  {
    query: Type.String({ minLength: 1 }),
    limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
    site: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

export const localFetchInputSchema = Type.Object(
  {
    url: Type.String({ minLength: 1 }),
    format: Type.Optional(
      Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")]),
    ),
    timeoutMs: Type.Optional(Type.Number({ minimum: 1000, maximum: 30000 })),
  },
  { additionalProperties: false },
);

export const LOCAL_TOOL_CONTRACTS: WebProviderToolContracts = {
  search: {
    name: "web.search",
    description:
      "Search the public web through svvy's no-key Local provider. Results are external untrusted snippets.",
    inputSchema: localSearchInputSchema,
    outputTypeName: "LocalWebSearchOutput",
    inputTypeDeclaration:
      "interface ActiveWebSearchInput  { query: string; limit?: number; site?: string };",
    outputTypeDeclaration:
      'interface ActiveWebSearchOutput  { providerId: "local"; results: Array<{ title: string; url: string; snippet?: string }>; warnings?: string[] };',
  },
  fetch: {
    name: "web.fetch",
    description:
      "Fetch a public http(s) URL through svvy's no-key Local provider and write extracted content to artifacts.",
    inputSchema: localFetchInputSchema,
    outputTypeName: "LocalWebFetchOutput",
    inputTypeDeclaration:
      'interface ActiveWebFetchInput  { url: string; format?: "markdown" | "text" | "html"; timeoutMs?: number };',
    outputTypeDeclaration:
      'interface ActiveWebFetchOutput  { providerId: "local"; artifacts: Array<{ artifactId: string; path: string; url: string; finalUrl?: string; title?: string; format: "markdown" | "html" | "text" | "json" }>; metadataArtifact: { artifactId: string; path: string; format: "json" }; warnings?: string[] };',
  },
};
