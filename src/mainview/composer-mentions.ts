import {
  createComposerSnippetMention,
  createUniqueSnippetToken,
  resolveSnippetMentionsInText,
  type ComposerSnippetMention,
  type SentSnippetProvenance,
  type SnippetRecord,
} from "../shared/snippets";
import type { ComposerMentionKind, WorkspacePathIndexEntry } from "../shared/workspace-contract";

export type { ComposerMentionKind, WorkspacePathIndexEntry };

export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

export interface MentionPickerResult extends WorkspacePathIndexEntry {
  type: "path";
  id: string;
  basename: string;
  disambiguation: string;
}

export interface SnippetMentionPickerResult {
  type: "snippet";
  id: string;
  snippet: SnippetRecord;
  basename: string;
  disambiguation: string;
}

export type ComposerMentionPickerResult = MentionPickerResult | SnippetMentionPickerResult;
export type SnippetArgumentKeyboardTarget =
  | { kind: "argument"; argumentIndex: number }
  | { kind: "composer" };

const TOKEN_BOUNDARY = /[\s([{"'`]/;
const QUERY_BOUNDARY = /[\s)]/;

export function getActiveMentionQuery(
  value: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): MentionQuery | null {
  if (selectionStart !== selectionEnd) return null;

  let atIndex = -1;
  for (let index = selectionStart - 1; index >= 0; index -= 1) {
    const char = value[index];
    if (char === "@") {
      atIndex = index;
      break;
    }
    if (!char || QUERY_BOUNDARY.test(char)) break;
  }

  if (atIndex < 0) return null;
  const before = atIndex === 0 ? "" : (value[atIndex - 1] ?? "");
  if (before && !TOKEN_BOUNDARY.test(before)) return null;

  const query = value.slice(atIndex + 1, selectionStart);
  if (query.includes("@")) return null;
  return { start: atIndex, end: selectionStart, query };
}

export function isActiveMentionSelected(input: {
  value: string;
  query: MentionQuery | null;
  paths: readonly WorkspacePathIndexEntry[];
}): boolean {
  return Boolean(
    input.query &&
    input.query.query.length > 0 &&
    input.value.slice(input.query.start, input.query.end) === `@${input.query.query}` &&
    input.paths.some((entry) => entry.workspaceRelativePath === input.query?.query),
  );
}

export function searchMentionPaths(
  entries: readonly WorkspacePathIndexEntry[],
  query: string,
  limit = 12,
): MentionPickerResult[] {
  const normalizedQuery = normalizeQuery(query);
  const scored = entries
    .map((entry) => scoreEntry(entry, normalizedQuery))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .toSorted(
      (left, right) => left.score - right.score || comparePathEntries(left.entry, right.entry),
    );

  return addDisambiguation(scored.slice(0, limit).map((entry) => entry.entry));
}

export function searchComposerMentionResults(input: {
  paths: readonly WorkspacePathIndexEntry[];
  snippets: readonly SnippetRecord[];
  query: string;
  limit?: number;
}): ComposerMentionPickerResult[] {
  const limit = input.limit ?? 12;
  const pathResults = searchMentionPaths(input.paths, input.query, limit);
  const snippetResults = searchMentionSnippets(input.snippets, input.query, limit);
  return [...pathResults, ...snippetResults]
    .toSorted((left, right) => compareMentionPickerResults(left, right))
    .slice(0, limit);
}

export function searchMentionSnippets(
  snippets: readonly SnippetRecord[],
  query: string,
  limit = 12,
): SnippetMentionPickerResult[] {
  const normalizedQuery = normalizeQuery(query);
  return snippets
    .filter((snippet) => snippet.enabled)
    .map((snippet) => scoreSnippet(snippet, normalizedQuery))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .toSorted(
      (left, right) =>
        left.score - right.score || left.snippet.title.localeCompare(right.snippet.title),
    )
    .slice(0, limit)
    .map(({ snippet }) => ({
      type: "snippet",
      id: `snippet:${snippet.id}`,
      snippet,
      basename: snippet.title,
      disambiguation:
        snippet.metadata.description ??
        snippet.metadata.argumentHint ??
        ("path" in snippet ? snippet.path : "svvy snippet"),
    }));
}

export function selectMentionPath(
  value: string,
  query: MentionQuery,
  entry: WorkspacePathIndexEntry,
): { draft: string; caret: number } {
  const mentionText = `@${entry.workspaceRelativePath}`;
  const needsSpace = value[query.end] && !/[\s.,;:!?)]/.test(value[query.end] ?? "");
  const replacement = `${mentionText}${needsSpace ? " " : ""}`;
  const draft = `${value.slice(0, query.start)}${replacement}${value.slice(query.end)}`;
  const caret = query.start + replacement.length;
  return { draft, caret };
}

export function selectMentionSnippet(
  value: string,
  query: MentionQuery,
  snippet: SnippetRecord,
  existingMentions: readonly ComposerSnippetMention[] = [],
): {
  draft: string;
  caret: number;
  mention: ComposerSnippetMention;
} {
  const token = createUniqueSnippetToken(snippet.title, value, existingMentions);
  const needsSpace = value[query.end] && !/[\s.,;:!?)]/.test(value[query.end] ?? "");
  const replacement = `${token}${needsSpace ? " " : ""}`;
  const draft = `${value.slice(0, query.start)}${replacement}${value.slice(query.end)}`;
  return {
    draft,
    caret: query.start + replacement.length,
    mention: createComposerSnippetMention(snippet, token),
  };
}

export function commitTypedSnippetMention(input: {
  value: string;
  caret: number;
  snippets: readonly SnippetRecord[];
  existingMentions?: readonly ComposerSnippetMention[];
}): { draft: string; caret: number; mention: ComposerSnippetMention } | null {
  const existingMentions = input.existingMentions ?? [];
  const trailingWhitespace = /\s+$/.exec(input.value.slice(0, input.caret))?.[0] ?? "";
  if (!trailingWhitespace) return null;
  const tokenEnd = input.caret - trailingWhitespace.length;
  const candidates = input.snippets
    .filter((snippet) => snippet.enabled)
    .map((snippet) => ({ snippet, token: `@${snippet.title}` }))
    .filter(({ token }) => tokenEnd >= token.length)
    .toSorted((left, right) => right.token.length - left.token.length);

  for (const { snippet, token } of candidates) {
    const tokenStart = tokenEnd - token.length;
    if (input.value.slice(tokenStart, tokenEnd) !== token) continue;
    const before = tokenStart === 0 ? "" : (input.value[tokenStart - 1] ?? "");
    if (before && !TOKEN_BOUNDARY.test(before)) continue;
    if (existingMentions.some((mention) => mention.token === token)) {
      const valueWithoutTypedToken = `${input.value.slice(0, tokenStart)}${input.value.slice(tokenEnd)}`;
      const uniqueToken = createUniqueSnippetToken(
        snippet.title,
        valueWithoutTypedToken,
        existingMentions,
      );
      const draft = `${input.value.slice(0, tokenStart)}${uniqueToken}${input.value.slice(tokenEnd)}`;
      return {
        draft,
        caret: tokenStart + uniqueToken.length + trailingWhitespace.length,
        mention: createComposerSnippetMention(snippet, uniqueToken),
      };
    }
    return {
      draft: input.value,
      caret: input.caret,
      mention: createComposerSnippetMention(snippet, token),
    };
  }
  return null;
}

export function nextSnippetArgumentKeyboardTarget(input: {
  key: string;
  argumentIndex: number;
  argumentCount: number;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}): SnippetArgumentKeyboardTarget | null {
  if (
    input.argumentCount <= 0 ||
    input.shiftKey ||
    input.altKey ||
    input.ctrlKey ||
    input.metaKey ||
    (input.key !== "Tab" && input.key !== "Enter")
  ) {
    return null;
  }
  const nextIndex = input.argumentIndex + 1;
  if (nextIndex < input.argumentCount) {
    return { kind: "argument", argumentIndex: nextIndex };
  }
  return { kind: "composer" };
}

export function caretAfterSnippetMentionToken(
  value: string,
  mention: Pick<ComposerSnippetMention, "token">,
): number {
  const tokenIndex = value.indexOf(mention.token);
  if (tokenIndex < 0) return value.length;
  const tokenEnd = tokenIndex + mention.token.length;
  const trailingWhitespace = /^\s+/.exec(value.slice(tokenEnd))?.[0] ?? "";
  return tokenEnd + trailingWhitespace.length;
}

export function expandComposerSnippetMention(
  value: string,
  mention: ComposerSnippetMention,
): { draft: string; caret: number } {
  const tokenIndex = value.indexOf(mention.token);
  const resolvedText = resolveSnippetMentionsInText(mention.token, [mention]).text;
  if (tokenIndex < 0) {
    const prefix = value.trimEnd();
    const separator = prefix ? "\n\n" : "";
    const draft = `${prefix}${separator}${resolvedText}`;
    return { draft, caret: draft.length };
  }
  const draft = `${value.slice(0, tokenIndex)}${resolvedText}${value.slice(
    tokenIndex + mention.token.length,
  )}`;
  return { draft, caret: tokenIndex + resolvedText.length };
}

export function removeComposerSnippetMentionToken(
  value: string,
  mention: Pick<ComposerSnippetMention, "token">,
): { draft: string; caret: number } {
  const tokenIndex = value.indexOf(mention.token);
  if (tokenIndex < 0) return { draft: value, caret: value.length };
  const before = value.slice(0, tokenIndex);
  const after = value.slice(tokenIndex + mention.token.length);
  const shouldTrimPreviousSpace =
    before.endsWith(" ") && (after.startsWith(" ") || /^[.,;:!?)]/.test(after));
  const shouldTrimNextSpace =
    !shouldTrimPreviousSpace && after.startsWith(" ") && (before === "" || /\s$/.test(before));
  const nextBefore = shouldTrimPreviousSpace ? before.slice(0, -1) : before;
  const nextAfter = shouldTrimNextSpace ? after.slice(1) : after;
  const draft = `${nextBefore}${nextAfter}`;
  return { draft, caret: nextBefore.length };
}

export function serializeComposerDraft(
  value: string,
  snippetMentions: readonly ComposerSnippetMention[] = [],
): { text: string; snippetProvenance: SentSnippetProvenance[] } {
  const resolved = resolveSnippetMentionsInText(value, snippetMentions);
  return {
    text: resolved.text.trim(),
    snippetProvenance: resolved.provenance,
  };
}

export interface TranscriptMentionSegment {
  type: "text" | "mention";
  text: string;
  path?: string;
  missing?: boolean;
}

export function parseTranscriptMentionLinks(
  text: string,
  indexedPaths: ReadonlySet<string> = new Set(),
): TranscriptMentionSegment[] {
  const segments: TranscriptMentionSegment[] = [];
  const mentionPattern = /(^|[\s([{"'`])@([A-Za-z0-9._~/-]+[A-Za-z0-9._~/-]?)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(text))) {
    const prefix = match[1] ?? "";
    const path = trimTrailingPunctuation(match[2] ?? "");
    const mentionStart = match.index + prefix.length;
    const mentionEnd = mentionStart + 1 + path.length;
    if (!path || path.includes("//") || path.startsWith("/")) continue;

    if (mentionStart > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, mentionStart) });
    }
    segments.push({
      type: "mention",
      text: `@${path}`,
      path,
      missing: indexedPaths.size > 0 && !indexedPaths.has(path),
    });
    cursor = mentionEnd;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return segments.length > 0 ? segments : [{ type: "text", text }];
}

function scoreEntry(
  entry: WorkspacePathIndexEntry,
  normalizedQuery: string,
): { entry: WorkspacePathIndexEntry; score: number } | null {
  const path = entry.workspaceRelativePath.toLowerCase();
  const base = basename(path);
  if (!normalizedQuery) {
    return { entry, score: path.split("/").length * 8 + path.length / 100 };
  }
  const baseIndex = base.indexOf(normalizedQuery);
  const pathIndex = path.indexOf(normalizedQuery);
  if (baseIndex < 0 && pathIndex < 0) return null;

  const exactBaseBonus = base === normalizedQuery ? -80 : 0;
  const basePrefixBonus = base.startsWith(normalizedQuery) ? -45 : 0;
  const pathPrefixBonus = path.startsWith(normalizedQuery) ? -24 : 0;
  const matchPosition = baseIndex >= 0 ? baseIndex : pathIndex + 12;
  return {
    entry,
    score:
      exactBaseBonus +
      basePrefixBonus +
      pathPrefixBonus +
      matchPosition +
      path.split("/").length * 4 +
      path.length / 100,
  };
}

function addDisambiguation(entries: WorkspacePathIndexEntry[]): MentionPickerResult[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const name = basename(entry.workspaceRelativePath);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return entries.map((entry) => {
    const name = basename(entry.workspaceRelativePath);
    const parent = dirname(entry.workspaceRelativePath);
    return {
      ...entry,
      type: "path",
      id: `${entry.kind}:${entry.workspaceRelativePath}`,
      basename: name,
      disambiguation: counts.get(name) && counts.get(name)! > 1 ? parent : parent ? parent : "",
    };
  });
}

function compareMentionPickerResults(
  left: ComposerMentionPickerResult,
  right: ComposerMentionPickerResult,
): number {
  if (left.type !== right.type) return left.type === "snippet" ? -1 : 1;
  return left.basename.localeCompare(right.basename) || left.id.localeCompare(right.id);
}

function scoreSnippet(
  snippet: SnippetRecord,
  normalizedQuery: string,
): { snippet: SnippetRecord; score: number } | null {
  const title = snippet.title.toLowerCase();
  const description = snippet.metadata.description?.toLowerCase() ?? "";
  const argumentHint = snippet.metadata.argumentHint?.toLowerCase() ?? "";
  const path = "path" in snippet ? snippet.path.toLowerCase() : "";
  if (!normalizedQuery) {
    return { snippet, score: snippet.source === "svvy" ? -8 : 0 };
  }
  const titleIndex = title.indexOf(normalizedQuery);
  const descriptionIndex = description.indexOf(normalizedQuery);
  const argumentIndex = argumentHint.indexOf(normalizedQuery);
  const pathIndex = path.indexOf(normalizedQuery);
  if (titleIndex < 0 && descriptionIndex < 0 && argumentIndex < 0 && pathIndex < 0) return null;
  const exactTitleBonus = title === normalizedQuery ? -90 : 0;
  const titlePrefixBonus = title.startsWith(normalizedQuery) ? -55 : 0;
  const sourceBonus = snippet.source === "svvy" ? -6 : 0;
  const matchPosition =
    titleIndex >= 0
      ? titleIndex
      : descriptionIndex >= 0
        ? descriptionIndex + 16
        : argumentIndex >= 0
          ? argumentIndex + 24
          : pathIndex + 32;
  return {
    snippet,
    score: exactTitleBonus + titlePrefixBonus + sourceBonus + matchPosition + title.length / 100,
  };
}

function comparePathEntries(left: WorkspacePathIndexEntry, right: WorkspacePathIndexEntry): number {
  if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
  return left.workspaceRelativePath.localeCompare(right.workspaceRelativePath);
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function dirname(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/^@/, "").toLowerCase();
}

function trimTrailingPunctuation(path: string): string {
  return path.replace(/[.,;:!?]+$/, "");
}
