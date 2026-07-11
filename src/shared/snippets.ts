import type {
  ComposerSnippetMention,
  DiscoveredSnippetSource,
  SentSnippetProvenance,
  SnippetMetadata,
} from "@svvy/core";

export type {
  ComposerSnippetMention,
  DiscoveredSnippetSource,
  SentSnippetProvenance,
  SnippetMetadata,
  SnippetSource,
} from "@svvy/core";
export { parseSnippetMarkdown } from "@svvy/core";

export interface DiscoveredSnippet {
  id: string;
  source: DiscoveredSnippetSource;
  title: string;
  path: string;
  body: string;
  metadata: SnippetMetadata;
  enabled: boolean;
}

export interface ManagedSnippet {
  id: string;
  source: "svvy";
  title: string;
  body: string;
  metadata: SnippetMetadata;
  enabled: boolean;
}

export type SnippetRecord = ManagedSnippet | DiscoveredSnippet;

export interface SnippetsReadModel {
  snippets: SnippetRecord[];
}

export interface CreateManagedSnippetRequest {
  title: string;
  body: string;
  description?: string | null;
  argumentHint?: string | null;
}

export interface UpdateManagedSnippetRequest {
  snippetId: string;
  title: string;
  body: string;
  description: string | null;
  argumentHint: string | null;
}

export interface SetSnippetEnabledRequest {
  snippetId: string;
  enabled: boolean;
}

export function expandSnippetBody(body: string, args: readonly string[]): string {
  const argumentText = args.join(" ");
  return body
    .replace(/\$\{@:(\d+):(\d+)\}/g, (_match, startRaw: string, lengthRaw: string) => {
      const start = Number.parseInt(startRaw, 10);
      const length = Number.parseInt(lengthRaw, 10);
      if (!Number.isFinite(start) || !Number.isFinite(length) || start < 1 || length < 0) return "";
      return args.slice(start - 1, start - 1 + length).join(" ");
    })
    .replace(/\$\{@:(\d+)\}/g, (_match, startRaw: string) => {
      const start = Number.parseInt(startRaw, 10);
      if (!Number.isFinite(start) || start < 1) return "";
      return args.slice(start - 1).join(" ");
    })
    .replace(/\$ARGUMENTS\b/g, argumentText)
    .replace(/\$@/g, argumentText)
    .replace(/\$(\d+)/g, (_match, indexRaw: string) => {
      const index = Number.parseInt(indexRaw, 10);
      if (!Number.isFinite(index) || index < 1) return "";
      return args[index - 1] ?? "";
    });
}

export function createComposerSnippetMention(
  snippet: SnippetRecord,
  token = `@${snippet.title}`,
): ComposerSnippetMention {
  return {
    id: `snippet-mention-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    snippetId: snippet.id,
    source: snippet.source,
    title: snippet.title,
    token,
    body: snippet.body,
    path: "path" in snippet ? snippet.path : undefined,
    contentHash: hashSnippetBody(snippet.body),
    arguments: createEmptySnippetArguments(snippet),
    metadata: snippet.metadata,
  };
}

export function createUniqueSnippetToken(
  title: string,
  existingText: string,
  existingMentions: readonly Pick<ComposerSnippetMention, "token">[] = [],
): string {
  const base = `@${title}`;
  const usedTokens = new Set(existingMentions.map((mention) => mention.token));
  if (!existingText.includes(base) && !usedTokens.has(base)) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}#${index}`;
    if (!existingText.includes(candidate) && !usedTokens.has(candidate)) return candidate;
  }
  return `${base}#${Date.now().toString(36)}`;
}

export function createEmptySnippetArguments(
  snippet: Pick<SnippetRecord, "body" | "metadata">,
): string[] {
  return Array.from({ length: inferSnippetArgumentCount(snippet) }, () => "");
}

export function inferSnippetArgumentCount(
  snippet: Pick<SnippetRecord, "body" | "metadata">,
): number {
  const body = snippet.body;
  let count = 0;
  for (const match of body.matchAll(/\$(\d+)/g)) {
    count = Math.max(count, Number.parseInt(match[1] ?? "0", 10));
  }
  for (const match of body.matchAll(/\$\{@:(\d+)(?::(\d+))?\}/g)) {
    const start = Number.parseInt(match[1] ?? "0", 10);
    const length = match[2] ? Number.parseInt(match[2], 10) : 1;
    if (Number.isFinite(start) && Number.isFinite(length)) {
      count = Math.max(count, start + Math.max(length, 1) - 1);
    }
  }
  if (count === 0 && (/\$@|\$ARGUMENTS\b/.test(body) || snippet.metadata.argumentHint)) {
    return 1;
  }
  return count;
}

export function resolveSnippetMentionsInText(
  text: string,
  mentions: readonly ComposerSnippetMention[],
): { text: string; provenance: SentSnippetProvenance[] } {
  let nextText = text;
  const provenance: SentSnippetProvenance[] = [];

  for (const mention of mentions) {
    const tokenIndex = nextText.indexOf(mention.token);
    if (tokenIndex < 0) continue;
    const resolvedText = expandSnippetBody(mention.body, mention.arguments).trim();
    nextText = `${nextText.slice(0, tokenIndex)}${resolvedText}${nextText.slice(
      tokenIndex + mention.token.length,
    )}`;
    provenance.push({
      mentionId: mention.id,
      snippetId: mention.snippetId,
      source: mention.source,
      title: mention.title,
      path: mention.path,
      contentHash: mention.contentHash,
      arguments: [...mention.arguments],
      resolvedText,
    });
  }

  return { text: nextText, provenance };
}

export function hashSnippetBody(body: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
