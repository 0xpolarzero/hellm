import type { Model, Usage } from "@mariozechner/pi-ai";

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

function formatCostRate(value: number): string {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1).replace(/\.0$/, "");
  if (value >= 1) return value.toFixed(2).replace(/\.?0+$/, "");
  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function formatModelCost(model: Pick<Model<any>, "cost"> | null | undefined): string {
  const cost = model?.cost;
  if (!cost) return "Free";

  const input = cost.input || 0;
  const output = cost.output || 0;
  if (input === 0 && output === 0) return "Free";

  return `$${formatCostRate(input)}/$${formatCostRate(output)}`;
}

export function formatTokenCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}m`;
}

export function formatUsage(usage: Usage | null | undefined): string {
  if (!usage) return "";

  const parts: string[] = [];
  if (usage.input) parts.push(`↑${formatTokenCount(usage.input)}`);
  if (usage.output) parts.push(`↓${formatTokenCount(usage.output)}`);
  if (usage.cacheRead) parts.push(`R${formatTokenCount(usage.cacheRead)}`);
  if (usage.cacheWrite) parts.push(`W${formatTokenCount(usage.cacheWrite)}`);
  if (usage.cost?.total) parts.push(formatCost(usage.cost.total));

  return parts.join(" ");
}

export function formatTimestamp(timestamp: number | string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return TIME_FORMATTER.format(date);
}

export function subsequenceScore(query: string, text: string): number {
  let queryIndex = 0;
  let textIndex = 0;
  let gaps = 0;
  let lastMatchIndex = -1;

  while (queryIndex < query.length && textIndex < text.length) {
    if (query[queryIndex] === text[textIndex]) {
      if (lastMatchIndex >= 0) {
        gaps += textIndex - lastMatchIndex - 1;
      }
      lastMatchIndex = textIndex;
      queryIndex++;
    }
    textIndex++;
  }

  if (queryIndex < query.length) return 0;
  return query.length / (query.length + gaps);
}

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function searchScore(query: string, fields: readonly string[]): number {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const queryCompact = normalizedQuery.replace(/\s+/g, "");
  const normalizedFields = fields.map(normalizeSearchText).filter(Boolean);
  if (normalizedFields.length === 0) return 0;

  const fieldTokens = normalizedFields.flatMap((field) => field.split(" "));
  const haystack = normalizedFields.join(" ");
  const haystackCompact = normalizedFields.join("");

  let score = 0;

  if (
    normalizedFields.some((field) => field === normalizedQuery) ||
    haystackCompact === queryCompact
  ) {
    score = Math.max(score, 1000);
  }

  if (normalizedFields.some((field) => field.startsWith(normalizedQuery))) {
    score = Math.max(score, 900);
  }

  if (normalizedFields.some((field) => field.includes(normalizedQuery))) {
    score = Math.max(score, 820);
  }

  if (haystack.startsWith(normalizedQuery) || haystackCompact.startsWith(queryCompact)) {
    score = Math.max(score, 760);
  }

  if (haystack.includes(normalizedQuery) || haystackCompact.includes(queryCompact)) {
    score = Math.max(score, 700);
  }

  const queryTokens = normalizedQuery.split(" ");
  if (
    queryTokens.every((token) => fieldTokens.some((fieldToken) => fieldToken.startsWith(token)))
  ) {
    score = Math.max(score, 640 + queryTokens.length);
  }

  if (queryTokens.every((token) => fieldTokens.some((fieldToken) => fieldToken.includes(token)))) {
    score = Math.max(score, 600 + queryTokens.length);
  }

  const subsequence = subsequenceScore(queryCompact, haystackCompact);
  if (subsequence >= 0.55) {
    score = Math.max(score, Math.round(subsequence * 500));
  }

  return score;
}
