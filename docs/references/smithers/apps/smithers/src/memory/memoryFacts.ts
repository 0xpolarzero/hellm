/**
 * The cross-run memory store: a namespaced fact table plus the semantic-recall
 * scorer, ported from the Swift MemoryView (smithers memory). One card and one
 * canvas read the same seeded facts; the Facts tab browses the table, the Recall
 * tab scores facts against a query. apps/smithers has no gateway yet, so the
 * data is a believable demo store like the other feature surfaces.
 *
 * Everything below the seed data is pure — the value previews, the relative-age
 * formatter, the namespace derivation, and the recall scorer — so they unit-test
 * without a DOM and without a clock (see memoryDomain.test.ts).
 *
 * Determinism: there is no Date.now() anywhere. A single fixed NOW_MS anchor is
 * baked in, and every fact's timestamps are NOW_MS minus a constant offset, so
 * `5m ago` / `2h ago` / `3d ago` render identically on every run.
 */

/** The fixed "now" anchor (a 2024 epoch). All ages are measured against this. */
export const NOW_MS = 1_717_286_400_000;

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * One cross-run memory fact. `value` is a JSON string (the stored payload, the
 * way the backend persists it); `text` is a derived human one-line summary that
 * the recall scorer and the chat card read. `weight` is the base relevance the
 * recall query nudges by keyword overlap.
 */
export type MemoryFact = {
  id: string;
  namespace: string;
  key: string;
  /** The stored payload, a JSON string (object, array, or quoted scalar). */
  value: string;
  /** A human one-line summary, used by recall content + the chat card. */
  text: string;
  createdAtMs: number;
  updatedAtMs: number;
  /** Time-to-live in milliseconds, present only on facts that expire. */
  ttlMs?: number;
  /** Base recall relevance, in [0, 1]; recall adds keyword-overlap on top. */
  weight: number;
};

/** A scored recall hit: the content shown, its score, and an optional provenance. */
export type RecallResult = {
  score: number;
  content: string;
  /** A single-line `namespace/key` provenance, or null when not applicable. */
  metadata: string | null;
};

/**
 * ~12 seeded facts across 5 namespaces (ci, auth, infra, review, docs),
 * evolving the original 4. Timestamps are NOW_MS minus a fixed offset so the
 * relative ages span seconds / minutes / hours / days deterministically.
 */
export const MEMORY_FACTS: MemoryFact[] = [
  {
    id: "f1",
    namespace: "ci",
    key: "token-ttl-rotation",
    value: '"Token TTL races the clock skew on CI; rotation must use a fixed ROTATE_TTL, not wall time."',
    text: "Token TTL races the clock skew on CI; rotation must use a fixed ROTATE_TTL, not wall time.",
    createdAtMs: NOW_MS - 9 * DAY,
    updatedAtMs: NOW_MS - 42 * SECOND,
    ttlMs: 3_600_000,
    weight: 0.94,
  },
  {
    id: "f2",
    namespace: "ci",
    key: "lockfile-topology",
    value:
      '{"runner":"pnpm","ignored":["bun.lock"],"note":"examples/ & benchmarks/ are not workspaces; a missing pnpm-lock update reds all jobs"}',
    text: "CI runs on pnpm (bun.lock ignored); examples/ & benchmarks/ aren't workspaces, so a stale lockfile reds every job.",
    createdAtMs: NOW_MS - 6 * DAY,
    updatedAtMs: NOW_MS - 5 * MINUTE,
    weight: 0.86,
  },
  {
    id: "f3",
    namespace: "auth",
    key: "session-sync-signing",
    value: '"session.ts signs tokens synchronously; the suite assumed async and flaked under load."',
    text: "session.ts signs tokens synchronously; the suite assumed async and flaked under load.",
    createdAtMs: NOW_MS - 11 * DAY,
    updatedAtMs: NOW_MS - 18 * MINUTE,
    weight: 0.88,
  },
  {
    id: "f4",
    namespace: "auth",
    key: "refactor-frames",
    value: '{"frames":7,"gateFrame":4,"file":"runs/authRefactorFrames.ts"}',
    text: "The auth refactor replays in 7 frames with the approval gate at frame 4.",
    createdAtMs: NOW_MS - 4 * DAY,
    updatedAtMs: NOW_MS - 2 * HOUR,
    weight: 0.71,
  },
  {
    id: "f5",
    namespace: "infra",
    key: "bun-mock-module-leak",
    value: '"Bun mock.module leaks across concurrent test files; prefer DI seams over module mocks."',
    text: "Bun mock.module leaks across concurrent test files; prefer DI seams over module mocks.",
    createdAtMs: NOW_MS - 14 * DAY,
    updatedAtMs: NOW_MS - 3 * HOUR,
    weight: 0.81,
  },
  {
    id: "f6",
    namespace: "infra",
    key: "gateway-shared-db",
    value:
      '{"surface":"gateway","fix":"shared-DB run attribution","detail":"detached runs lost live events until the inspector rebound on tab focus"}',
    text: "Gateway run attribution needs a shared DB; detached runs dropped live events until the inspector rebound on focus.",
    createdAtMs: NOW_MS - 8 * DAY,
    updatedAtMs: NOW_MS - 6 * HOUR,
    weight: 0.69,
  },
  {
    id: "f7",
    namespace: "infra",
    key: "compute-node-inputs",
    value:
      '{"kinds":["compute","static","agent"],"gotcha":"ctx.input fields arrive null not zod-default — coalesce!","rows":"snake_case + JSON-string arrays"}',
    text: "Compute task ctx.input fields arrive null (not the zod default) — coalesce; output rows are snake_case with JSON-string arrays.",
    createdAtMs: NOW_MS - 5 * DAY,
    updatedAtMs: NOW_MS - 11 * HOUR,
    weight: 0.77,
  },
  {
    id: "f8",
    namespace: "review",
    key: "inline-findings",
    value: '"Open Code Review uses the native Smithers review flow; post findings as inline comments."',
    text: "Open Code Review uses the native Smithers review flow; post findings as inline comments.",
    createdAtMs: NOW_MS - 13 * DAY,
    updatedAtMs: NOW_MS - 1 * DAY,
    weight: 0.74,
  },
  {
    id: "f9",
    namespace: "review",
    key: "no-mocks-rule",
    value:
      '{"rule":"no mocks","scope":"product + e2e","forbidden":["mockGateway","page.route","routeWebSocket"],"allowed":"deliberate failure-injection against a real fault path"}',
    text: "Product code and e2e tests must hit real backends — no mockGateway, no route fabrication; only deliberate fault-injection is allowed.",
    createdAtMs: NOW_MS - 7 * DAY,
    updatedAtMs: NOW_MS - 2 * DAY,
    weight: 0.79,
  },
  {
    id: "f10",
    namespace: "docs",
    key: "docs-driven",
    value: '"Always update docs before writing code — docs define the API contract."',
    text: "Always update docs before writing code — docs define the API contract.",
    createdAtMs: NOW_MS - 20 * DAY,
    updatedAtMs: NOW_MS - 3 * DAY,
    weight: 0.83,
  },
  {
    id: "f11",
    namespace: "docs",
    key: "anti-slop-writing",
    value:
      '{"style":"anti-slop","bans":["em-dashes","not X but Y","padding triads","hedging"],"applies":"chat replies too"}',
    text: "Anti-slop prose: no em-dashes, no 'not X but Y', no padding triads, no hedging — applies to chat replies too.",
    createdAtMs: NOW_MS - 16 * DAY,
    updatedAtMs: NOW_MS - 5 * DAY,
    weight: 0.66,
  },
  {
    id: "f12",
    namespace: "docs",
    key: "colocate-by-domain",
    value: '"Organize by domain/feature, not by kind; colocate types and errors next to their functionality."',
    text: "Organize by domain/feature, not by kind (types.ts, errors.ts) — colocate types and errors near their functionality.",
    createdAtMs: NOW_MS - 12 * DAY,
    updatedAtMs: NOW_MS - 8 * DAY,
    weight: 0.62,
  },
];

/**
 * The distinct namespaces present in the facts, sorted alphabetically. Drives
 * the namespace filter pills (port MemoryNamespaceFilterState.namespaces).
 */
export function namespaces(facts: MemoryFact[]): string[] {
  const seen = new Set<string>();
  for (const fact of facts) seen.add(fact.namespace);
  return Array.from(seen).sort();
}

/**
 * Validate a stored namespace filter against the live namespaces. A stale
 * filter (no longer present in the facts) falls back to null / All, so it can
 * never hide every row (port validatedFilter).
 */
export function validatedFilter(filter: string | null, facts: MemoryFact[]): string | null {
  if (filter === null) return null;
  return namespaces(facts).includes(filter) ? filter : null;
}

/** Keep only the facts in the active namespace; null shows every fact. */
export function factsInNamespace(facts: MemoryFact[], namespace: string | null): MemoryFact[] {
  if (namespace === null) return facts.slice();
  return facts.filter((fact) => fact.namespace === namespace);
}

/**
 * Truncate a value for the table's Value column (port factValuePreview): trim
 * whitespace, drop the wrapping double-quotes when the value is a JSON string,
 * then clip to `maxLen` with a trailing ellipsis when it is longer.
 */
export function factValuePreview(value: string, maxLen = 60): string {
  let text = value.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1);
  }
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

/**
 * The relative age of a fact's `updatedAtMs`, measured against the fixed NOW_MS
 * (port factAge). Buckets: <60s `{n}s ago`, <60m `{n}m ago`, <24h `{n}h ago`,
 * else `{n}d ago`. Never reads the wall clock.
 */
export function factAge(updatedAtMs: number, now = NOW_MS): string {
  const deltaSec = Math.max(0, Math.floor((now - updatedAtMs) / SECOND));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ago`;
  if (deltaSec < 86_400) return `${Math.floor(deltaSec / 3600)}h ago`;
  return `${Math.floor(deltaSec / 86_400)}d ago`;
}

/**
 * An absolute timestamp for the fact-detail meta block, formatted from the fixed
 * epoch with no locale or timezone dependence (so the snapshot is stable). Shape
 * is `YYYY-MM-DD HH:MM:SS` in UTC.
 */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** Format a TTL as seconds with one decimal place (port the Swift `3600.0s`). */
export function formatTtl(ttlMs: number): string {
  return `${(ttlMs / 1000).toFixed(1)}s`;
}

/**
 * Pretty-print a fact's stored value for the VALUE block: JSON.parse then
 * re-serialize with 2-space indent; fall back to the raw (trimmed) string when
 * it does not parse; `(empty)` when blank.
 */
export function prettyValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "(empty)";
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return trimmed;
  }
}

/** Clamp a recall topK up to at least 1 (port normalizedRecallTopK). */
export function normalizedRecallTopK(topK: number): number {
  if (!Number.isFinite(topK)) return 1;
  return topK < 1 ? 1 : Math.floor(topK);
}

/** Map a recall score to its color band: >=0.8 ok, >=0.5 warn, else danger. */
export function scoreTone(score: number): "score-ok" | "score-warn" | "score-danger" {
  if (score >= 0.8) return "score-ok";
  if (score >= 0.5) return "score-warn";
  return "score-danger";
}

/**
 * Rank facts for a recall query, scoped to a namespace: keyword overlap on top
 * of the base weight, sorted by score descending, sliced to topK. An empty
 * query returns the namespace's facts at their base weight (so the Recall tab
 * is useful before typing). Pure and deterministic — the scorer never touches a
 * clock or Math.random.
 */
export function recall(
  query: string,
  facts: MemoryFact[] = MEMORY_FACTS,
  namespace: string | null = null,
  topK = 10,
): RecallResult[] {
  const scoped = factsInNamespace(facts, namespace);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const limit = normalizedRecallTopK(topK);
  return scoped
    .map((fact) => {
      const haystack = `${fact.text} ${fact.namespace} ${fact.key}`.toLowerCase();
      const hits = terms.filter((term) => haystack.includes(term)).length;
      const score = Math.min(0.99, fact.weight + hits * 0.02);
      return {
        score,
        content: fact.text,
        metadata: `${fact.namespace}/${fact.key}`,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
