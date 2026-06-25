import * as Schema from "effect/Schema";

export const ContextBudgetToneSchema = Schema.Literals(["neutral", "orange", "red"]);
export type ContextBudgetTone = typeof ContextBudgetToneSchema.Type;

export const ContextBudgetSchema = Schema.Struct({
  usedTokens: Schema.Number,
  maxTokens: Schema.Number,
  percent: Schema.Number,
  tone: ContextBudgetToneSchema,
  label: Schema.String,
  detail: Schema.String,
});
export type ContextBudget = typeof ContextBudgetSchema.Type;

export const CONTEXT_BUDGET_ORANGE_PERCENT = 40;
export const CONTEXT_BUDGET_RED_PERCENT = 60;

export function getContextBudgetTone(percent: number): ContextBudgetTone {
  if (percent >= CONTEXT_BUDGET_RED_PERCENT) return "red";
  if (percent >= CONTEXT_BUDGET_ORANGE_PERCENT) return "orange";
  return "neutral";
}

export function createContextBudget(input: {
  usedTokens: number | null | undefined;
  maxTokens: number | null | undefined;
}): ContextBudget | null {
  const usedTokens = normalizeNonNegativeInteger(input.usedTokens);
  const maxTokens = normalizePositiveInteger(input.maxTokens);
  if (usedTokens === null || maxTokens === null) {
    return null;
  }

  const percent = Math.min(100, Math.max(0, roundContextPercent((usedTokens / maxTokens) * 100)));
  return {
    usedTokens,
    maxTokens,
    percent,
    tone: getContextBudgetTone(percent),
    label: `${formatContextPercent(percent)}% context`,
    detail: `${formatTokenCount(usedTokens)} of ${formatTokenCount(maxTokens)} tokens`,
  };
}

function roundContextPercent(percent: number): number {
  return Math.round(percent * 10) / 10;
}

function formatContextPercent(percent: number): string {
  return Number.isInteger(percent) ? percent.toString() : percent.toFixed(1);
}

export function readContextBudgetFromMeta(
  meta: Record<string, unknown> | null | undefined,
): ContextBudget | null {
  const budget = readRecord(meta, "contextBudget");
  return createContextBudget({
    usedTokens: readNumber(budget, "usedTokens"),
    maxTokens: readNumber(budget, "maxTokens"),
  });
}

export function formatContextBudgetTooltip(
  budget: Pick<ContextBudget, "usedTokens" | "maxTokens">,
): string {
  return `${formatExactTokenCount(budget.usedTokens)} / ${formatExactTokenCount(budget.maxTokens)} tokens`;
}

function readRecord(
  record: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> | null {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  return typeof record?.[key] === "number" ? record[key] : null;
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : null;
}

function normalizeNonNegativeInteger(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : null;
}

function formatTokenCount(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  return `${(count / 1000000).toFixed(1)}m`;
}

function formatExactTokenCount(count: number): string {
  return count.toLocaleString("en-US");
}
