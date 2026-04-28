import type { ComposerMentionKind, WorkspacePathIndexEntry } from "../shared/workspace-contract";

export type { ComposerMentionKind, WorkspacePathIndexEntry };

export interface ComposerMentionLink {
  id: string;
  kind: ComposerMentionKind;
  label: string;
  workspaceRelativePath: string;
}

export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

export interface MentionPickerResult extends WorkspacePathIndexEntry {
  id: string;
  basename: string;
  disambiguation: string;
}

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

export function searchMentionPaths(
  entries: readonly WorkspacePathIndexEntry[],
  query: string,
  limit = 12,
): MentionPickerResult[] {
  const normalizedQuery = normalizeQuery(query);
  const scored = entries
    .map((entry) => scoreEntry(entry, normalizedQuery))
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => left.score - right.score || comparePathEntries(left.entry, right.entry));

  return addDisambiguation(scored.slice(0, limit).map((entry) => entry.entry));
}

export function selectMentionPath(
  value: string,
  query: MentionQuery,
  entry: WorkspacePathIndexEntry,
): { draft: string; caret: number; mention: ComposerMentionLink } {
  const mentionText = `@${entry.workspaceRelativePath}`;
  const needsSpace = value[query.end] && !/[\s.,;:!?)]/.test(value[query.end] ?? "");
  const replacement = `${mentionText}${needsSpace ? " " : ""}`;
  const draft = `${value.slice(0, query.start)}${replacement}${value.slice(query.end)}`;
  const caret = query.start + replacement.length;
  return {
    draft,
    caret,
    mention: {
      id: `${entry.kind}:${entry.workspaceRelativePath}`,
      kind: entry.kind,
      label: basename(entry.workspaceRelativePath),
      workspaceRelativePath: entry.workspaceRelativePath,
    },
  };
}

export function removeMentionFromDraft(value: string, mention: ComposerMentionLink): string {
  const mentionText = `@${mention.workspaceRelativePath}`;
  const index = value.indexOf(mentionText);
  if (index < 0) return value;
  const before = value.slice(0, index).replace(/[ \t]$/, "");
  const after = value.slice(index + mentionText.length).replace(/^[ \t]/, "");
  if (!before || !after || before.endsWith("\n") || after.startsWith("\n")) {
    return `${before}${after}`;
  }
  return `${before} ${after}`;
}

export function serializeComposerDraft(value: string): string {
  return value.trim();
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
      id: `${entry.kind}:${entry.workspaceRelativePath}`,
      basename: name,
      disambiguation: counts.get(name) && counts.get(name)! > 1 ? parent : parent ? parent : "",
    };
  });
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
