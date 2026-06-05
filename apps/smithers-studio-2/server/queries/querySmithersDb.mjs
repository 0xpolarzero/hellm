import { Database } from "bun:sqlite";

const [, , dbPath, operation, payloadJson = "{}"] = process.argv;

if (!dbPath || !operation) {
  console.error("usage: bun scripts/query-smithers-db.mjs <dbPath> <operation> [payloadJson]");
  process.exit(2);
}

const payload = JSON.parse(payloadJson);
const db = new Database(dbPath, { readonly: true });

function tableExists(name) {
  return Boolean(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function numberOr(value, fallback) {
  // A missing query param is forwarded by the server as `null` (and an absent
  // key as `undefined` / ""). Treat those as "not provided" so the caller's
  // default applies instead of `Number(null) === 0`, which would otherwise
  // clamp limits down to a single row. An explicit numeric value (including 0)
  // still wins.
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function limitFromPayload(defaultLimit = 100) {
  return Math.max(1, Math.min(500, numberOr(payload.limit, defaultLimit)));
}

function parseJsonObject(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstString(record, keys) {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function approvalDecisionValue(decision) {
  const value = decision?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function approvalDecisionState(row, decision) {
  const status = String(row.status ?? "").toLowerCase();
  const decisionValue = approvalDecisionValue(decision);
  const explicitApproved = typeof decision?.approved === "boolean"
    ? decision.approved
    : typeof decisionValue?.approved === "boolean"
      ? decisionValue.approved
      : null;
  const explicitDecision = firstString(decision, ["decision", "action", "status"]) ??
    firstString(decisionValue, ["decision", "action", "status"]);
  const normalizedDecision = explicitDecision ? explicitDecision.toLowerCase() : "";

  if (explicitApproved === true || ["approve", "approved", "granted"].includes(normalizedDecision)) {
    return "approved";
  }
  if (explicitApproved === false || ["deny", "denied", "rejected", "reject"].includes(normalizedDecision)) {
    return "denied";
  }
  if (["cancel", "cancelled", "canceled"].includes(status) || ["cancel", "cancelled", "canceled"].includes(normalizedDecision)) {
    return "cancelled";
  }
  if (["timeout", "timed-out", "timed_out", "expired"].includes(status) || ["timeout", "timed-out", "timed_out", "expired"].includes(normalizedDecision)) {
    return "timeout";
  }
  if (["malformed", "invalid", "invalid-payload", "invalid_payload"].includes(status) || ["malformed", "invalid", "invalid-payload", "invalid_payload"].includes(normalizedDecision)) {
    return "malformed";
  }
  if (["error", "failed", "failure"].includes(status) || ["error", "failed", "failure"].includes(normalizedDecision)) {
    return "error";
  }
  if (["stale", "expired", "superseded"].includes(status) || ["stale", "expired", "superseded"].includes(normalizedDecision)) {
    return "stale";
  }
  if (["requested", "pending", "waiting", "waiting-approval"].includes(status)) {
    return "pending";
  }
  if (status.includes("deny") || status === "rejected") {
    return "denied";
  }
  if (status.includes("approv") || status === "granted") {
    return "approved";
  }
  return "unknown";
}

function approvalAction(row, decision) {
  return approvalDecisionState(row, decision);
}

function approvalHistory() {
  if (!tableExists("_smithers_approvals")) {
    return { decisions: [], dbPath };
  }
  const limit = limitFromPayload(100);
  const hasRuns = tableExists("_smithers_runs");
  const rows = db.query(`
    SELECT
      a.run_id AS runId,
      a.node_id AS nodeId,
      a.iteration,
      a.status,
      a.requested_at_ms AS requestedAtMs,
      a.decided_at_ms AS decidedAtMs,
      a.note,
      a.decided_by AS decidedBy,
      a.request_json AS requestJson,
      a.decision_json AS decisionJson,
      a.auto_approved AS autoApproved,
      ${hasRuns ? "r.workflow_name" : "NULL"} AS workflowKey
    FROM _smithers_approvals a
    ${hasRuns ? "LEFT JOIN _smithers_runs r ON a.run_id = r.run_id" : ""}
    ORDER BY COALESCE(a.decided_at_ms, a.requested_at_ms, 0) DESC, a.run_id, a.node_id, a.iteration
    LIMIT ?
  `).all(limit);
  const decisions = rows.map((row) => {
    const request = parseJsonObject(row.requestJson);
    const decision = parseJsonObject(row.decisionJson);
    const decisionValue = approvalDecisionValue(decision);
    const iteration = Number(row.iteration ?? 0);
    const runId = String(row.runId ?? "");
    const nodeId = String(row.nodeId ?? "");
    return {
      id: `${runId}:${nodeId}:${iteration}`,
      runId,
      nodeId,
      iteration,
      workflowKey: row.workflowKey == null ? null : String(row.workflowKey),
      status: String(row.status ?? ""),
      decisionState: approvalDecisionState(row, decision),
      action: approvalAction(row, decision),
      requestTitle: firstString(request, ["title", "requestTitle"]),
      requestSummary: firstString(request, ["summary", "requestSummary"]),
      requestedAtMs: row.requestedAtMs == null ? null : Number(row.requestedAtMs),
      decidedAtMs: row.decidedAtMs == null ? null : Number(row.decidedAtMs),
      note: row.note == null ? firstString(decision, ["note"]) ?? firstString(decisionValue, ["note"]) : String(row.note),
      decidedBy: row.decidedBy == null
        ? firstString(decision, ["decidedBy", "resolvedBy"]) ?? firstString(decisionValue, ["decidedBy", "resolvedBy"])
        : String(row.decidedBy),
      requestJson: row.requestJson == null ? null : String(row.requestJson),
      decisionJson: row.decisionJson == null ? null : String(row.decisionJson),
      autoApproved: Boolean(row.autoApproved),
    };
  });
  return { decisions, dbPath };
}

function memoryFacts() {
  if (!tableExists("_smithers_memory_facts")) {
    return { facts: [], dbPath };
  }
  const limit = limitFromPayload(200);
  const namespace = typeof payload.namespace === "string" && payload.namespace.trim()
    ? payload.namespace.trim()
    : null;
  const query = typeof payload.query === "string" && payload.query.trim()
    ? `%${payload.query.trim().toLowerCase()}%`
    : null;
  const conditions = [];
  const params = [];
  if (namespace) {
    conditions.push("namespace = ?");
    params.push(namespace);
  }
  if (query) {
    conditions.push("(lower(namespace) LIKE ? OR lower(key) LIKE ? OR lower(value_json) LIKE ?)");
    params.push(query, query, query);
  }
  params.push(limit);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const facts = db.query(`
    SELECT
      namespace,
      key,
      value_json AS valueJson,
      schema_sig AS schemaSig,
      created_at_ms AS createdAtMs,
      updated_at_ms AS updatedAtMs,
      ttl_ms AS ttlMs
    FROM _smithers_memory_facts
    ${where}
    ORDER BY updated_at_ms DESC, namespace, key
    LIMIT ?
  `).all(...params);
  return { facts, dbPath };
}

function recallMemory() {
  if (!tableExists("_smithers_memory_facts")) {
    return { results: [], dbPath };
  }
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    return { results: [], dbPath };
  }
  const topK = Math.max(1, Math.min(50, numberOr(payload.topK, 10)));
  const namespace = typeof payload.namespace === "string" && payload.namespace.trim()
    ? payload.namespace.trim()
    : null;
  const lowerQuery = query.toLowerCase();
  const facts = memoryFacts().facts;
  const results = facts
    .map((fact) => {
      const haystack = `${fact.namespace}\n${fact.key}\n${fact.valueJson}`.toLowerCase();
      const index = haystack.indexOf(lowerQuery);
      if (namespace && fact.namespace !== namespace) {
        return null;
      }
      if (index < 0) {
        return null;
      }
      const score = Math.max(0.1, 1 - index / Math.max(1, haystack.length));
      return {
        score,
        content: `${fact.namespace}/${fact.key}: ${fact.valueJson}`,
        metadata: JSON.stringify({
          factId: `${fact.namespace}:${fact.key}`,
          namespace: fact.namespace,
          key: fact.key,
          source: dbPath,
          dbPath,
          createdAtMs: fact.createdAtMs,
          updatedAtMs: fact.updatedAtMs,
          queryScope: { namespace: namespace ?? "all", query, topK },
        }),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
  return { results, dbPath };
}

function p50(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function stddev(values, mean) {
  if (values.length <= 1) {
    return 0;
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return sorted[index];
}

function parseJsonValue(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function valueAtPath(record, path) {
  let current = record;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function firstNumberAt(record, paths) {
  for (const path of paths) {
    const value = numberValue(valueAtPath(record, path));
    if (value !== null) {
      return value;
    }
  }
  return null;
}

const INPUT_TOKEN_PATHS = [
  ["inputTokens"],
  ["input_tokens"],
  ["promptTokens"],
  ["prompt_tokens"],
  ["input"],
  ["prompt"],
];

const OUTPUT_TOKEN_PATHS = [
  ["outputTokens"],
  ["output_tokens"],
  ["completionTokens"],
  ["completion_tokens"],
  ["output"],
  ["completion"],
];

const TOTAL_TOKEN_PATHS = [
  ["totalTokens"],
  ["total_tokens"],
  ["tokens"],
  ["total"],
];

const CACHE_READ_TOKEN_PATHS = [
  ["cacheReadTokens"],
  ["cache_read_tokens"],
  ["cacheReadInputTokens"],
  ["cache_read_input_tokens"],
  ["cachedInputTokens"],
  ["cached_input_tokens"],
  ["inputTokenDetails", "cacheReadTokens"],
  ["input_token_details", "cache_read_tokens"],
];

const CACHE_WRITE_TOKEN_PATHS = [
  ["cacheWriteTokens"],
  ["cache_write_tokens"],
  ["cacheCreationInputTokens"],
  ["cache_creation_input_tokens"],
  ["inputTokenDetails", "cacheWriteTokens"],
  ["input_token_details", "cache_write_tokens"],
];

const TOTAL_COST_PATHS = [
  ["costUsd"],
  ["costUSD"],
  ["cost_usd"],
  ["totalCostUSD"],
  ["totalCostUsd"],
  ["total_cost_usd"],
  ["cost"],
];

const INPUT_COST_PATHS = [
  ["inputCostUSD"],
  ["inputCostUsd"],
  ["input_cost_usd"],
  ["promptCostUSD"],
  ["promptCostUsd"],
  ["prompt_cost_usd"],
];

const OUTPUT_COST_PATHS = [
  ["outputCostUSD"],
  ["outputCostUsd"],
  ["output_cost_usd"],
  ["completionCostUSD"],
  ["completionCostUsd"],
  ["completion_cost_usd"],
];

function hasUsageNumbers(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return false;
  }
  return [
    firstNumberAt(record, INPUT_TOKEN_PATHS),
    firstNumberAt(record, OUTPUT_TOKEN_PATHS),
    firstNumberAt(record, TOTAL_TOKEN_PATHS),
    firstNumberAt(record, CACHE_READ_TOKEN_PATHS),
    firstNumberAt(record, CACHE_WRITE_TOKEN_PATHS),
    firstNumberAt(record, TOTAL_COST_PATHS),
    firstNumberAt(record, INPUT_COST_PATHS),
    firstNumberAt(record, OUTPUT_COST_PATHS),
  ].some((value) => value !== null);
}

function usageRecordsFromPayload(type, eventPayload) {
  if (!eventPayload || typeof eventPayload !== "object" || Array.isArray(eventPayload)) {
    return [];
  }
  const records = [];
  if (type === "TokenUsageReported" || hasUsageNumbers(eventPayload)) {
    records.push(eventPayload);
  }
  for (const candidate of [
    eventPayload.usage,
    eventPayload.totalUsage,
    eventPayload.stats,
    eventPayload.message?.usage,
    eventPayload.event?.usage,
    eventPayload.data?.usage,
    eventPayload.raw?.usage,
  ]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      records.push(candidate);
    }
  }
  return records;
}

function normalizeUsageEntry(row, record) {
  const inputTokens = firstNumberAt(record, INPUT_TOKEN_PATHS) ?? 0;
  const outputTokens = firstNumberAt(record, OUTPUT_TOKEN_PATHS) ?? 0;
  const explicitTotalTokens = firstNumberAt(record, TOTAL_TOKEN_PATHS);
  const cacheReadTokens = firstNumberAt(record, CACHE_READ_TOKEN_PATHS) ?? 0;
  const cacheWriteTokens = firstNumberAt(record, CACHE_WRITE_TOKEN_PATHS) ?? 0;
  const totalCost = firstNumberAt(record, TOTAL_COST_PATHS);
  const inputCost = firstNumberAt(record, INPUT_COST_PATHS);
  const outputCost = firstNumberAt(record, OUTPUT_COST_PATHS);
  const totalTokens = explicitTotalTokens ?? inputTokens + outputTokens;
  if (
    totalTokens <= 0 &&
    cacheReadTokens <= 0 &&
    cacheWriteTokens <= 0 &&
    totalCost === null &&
    inputCost === null &&
    outputCost === null
  ) {
    return null;
  }
  const explicitCostTotal = totalCost ?? (inputCost !== null || outputCost !== null ? (inputCost ?? 0) + (outputCost ?? 0) : null);
  const tokenTotal = inputTokens + outputTokens;
  const allocatedInputCost = inputCost ?? (
    explicitCostTotal !== null && tokenTotal > 0 ? explicitCostTotal * (inputTokens / tokenTotal) : null
  );
  const allocatedOutputCost = outputCost ?? (
    explicitCostTotal !== null && tokenTotal > 0 ? explicitCostTotal * (outputTokens / tokenTotal) : null
  );
  return {
    runId: firstString(record, ["runId", "run_id"]) ?? String(row.runId ?? ""),
    timestampMs: firstNumberAt(record, [["timestampMs"], ["timestamp_ms"], ["timeMs"], ["time_ms"]]) ?? Number(row.timestampMs ?? 0),
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCostUSD: explicitCostTotal,
    inputCostUSD: allocatedInputCost,
    outputCostUSD: allocatedOutputCost,
  };
}

function tokenUsageEntries(runId) {
  if (!tableExists("_smithers_events")) {
    return [];
  }
  const params = [];
  const where = runId ? "WHERE run_id = ?" : "";
  if (runId) {
    params.push(runId);
  }
  const rows = db.query(`
    SELECT run_id AS runId, timestamp_ms AS timestampMs, type, payload_json AS payloadJson
    FROM _smithers_events
    ${where}
    ORDER BY timestamp_ms DESC, seq DESC
  `).all(...params);
  return rows
    .map((row) => {
      const eventPayload = parseJsonValue(row.payloadJson);
      for (const record of usageRecordsFromPayload(row.type, eventPayload)) {
        const entry = normalizeUsageEntry(row, record);
        if (entry) {
          return entry;
        }
      }
      return null;
    })
    .filter(Boolean);
}

function dateLabel(ms) {
  const date = new Date(Number(ms) || Date.now());
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
}

function tokenMetricsFromEntries(entries) {
  const byPeriod = new Map();
  const totals = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  for (const entry of entries) {
    totals.totalInputTokens += entry.inputTokens;
    totals.totalOutputTokens += entry.outputTokens;
    totals.totalTokens += entry.totalTokens;
    totals.cacheReadTokens += entry.cacheReadTokens;
    totals.cacheWriteTokens += entry.cacheWriteTokens;
    const label = dateLabel(entry.timestampMs);
    const period = byPeriod.get(label) ?? {
      label,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    period.inputTokens += entry.inputTokens;
    period.outputTokens += entry.outputTokens;
    period.cacheReadTokens += entry.cacheReadTokens;
    period.cacheWriteTokens += entry.cacheWriteTokens;
    byPeriod.set(label, period);
  }
  return {
    ...totals,
    byPeriod: [...byPeriod.values()].sort((left, right) => right.label.localeCompare(left.label)),
  };
}

function costReportFromEntries(entries) {
  const costEntries = entries.filter((entry) =>
    entry.totalCostUSD !== null || entry.inputCostUSD !== null || entry.outputCostUSD !== null
  );
  const byPeriod = new Map();
  let totalCostUSD = 0;
  let inputCostUSD = 0;
  let outputCostUSD = 0;
  const runIds = new Set();
  for (const entry of costEntries) {
    const total = entry.totalCostUSD ?? (entry.inputCostUSD ?? 0) + (entry.outputCostUSD ?? 0);
    const input = entry.inputCostUSD ?? 0;
    const output = entry.outputCostUSD ?? Math.max(0, total - input);
    totalCostUSD += total;
    inputCostUSD += input;
    outputCostUSD += output;
    if (entry.runId) {
      runIds.add(entry.runId);
    }
    const label = dateLabel(entry.timestampMs);
    const period = byPeriod.get(label) ?? {
      label,
      totalCostUSD: 0,
      inputCostUSD: 0,
      outputCostUSD: 0,
      runIds: new Set(),
    };
    period.totalCostUSD += total;
    period.inputCostUSD += input;
    period.outputCostUSD += output;
    if (entry.runId) {
      period.runIds.add(entry.runId);
    }
    byPeriod.set(label, period);
  }
  return {
    totalCostUSD,
    inputCostUSD,
    outputCostUSD,
    runCount: runIds.size,
    byPeriod: [...byPeriod.values()]
      .sort((left, right) => right.label.localeCompare(left.label))
      .map((period) => ({
        label: period.label,
        totalCostUSD: period.totalCostUSD,
        inputCostUSD: period.inputCostUSD,
        outputCostUSD: period.outputCostUSD,
        runCount: period.runIds.size,
      })),
  };
}

function latencyRowsFromAttempts(runId) {
  if (!tableExists("_smithers_attempts")) {
    return [];
  }
  const params = [];
  const where = runId ? "WHERE run_id = ? AND finished_at_ms IS NOT NULL" : "WHERE finished_at_ms IS NOT NULL";
  if (runId) {
    params.push(runId);
  }
  return db.query(`
    SELECT run_id AS runId, finished_at_ms AS timestampMs, started_at_ms AS startedAtMs, finished_at_ms AS finishedAtMs
    FROM _smithers_attempts
    ${where}
  `).all(...params)
    .map((row) => ({
      runId: String(row.runId ?? ""),
      timestampMs: Number(row.timestampMs ?? 0),
      durationMs: Number(row.finishedAtMs) - Number(row.startedAtMs),
    }))
    .filter((row) => Number.isFinite(row.durationMs) && row.durationMs >= 0);
}

function latencyRowsFromScorers(runId) {
  if (!tableExists("_smithers_scorers")) {
    return [];
  }
  const params = [];
  const where = runId ? "WHERE run_id = ?" : "";
  if (runId) {
    params.push(runId);
  }
  return db.query(`
    SELECT run_id AS runId, scored_at_ms AS timestampMs, duration_ms AS durationMs, latency_ms AS latencyMs
    FROM _smithers_scorers
    ${where}
  `).all(...params)
    .map((row) => ({
      runId: String(row.runId ?? ""),
      timestampMs: Number(row.timestampMs ?? 0),
      durationMs: numberValue(row.durationMs) ?? numberValue(row.latencyMs) ?? 0,
    }))
    .filter((row) => Number.isFinite(row.durationMs) && row.durationMs >= 0);
}

function latencyMetrics(runId) {
  const rows = latencyRowsFromAttempts(runId);
  const latencyRows = rows.length ? rows : latencyRowsFromScorers(runId);
  const values = latencyRows.map((row) => row.durationMs);
  if (values.length === 0) {
    return { count: 0, meanMs: 0, minMs: 0, maxMs: 0, p50Ms: 0, p95Ms: 0, byPeriod: [] };
  }
  const meanMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  const byPeriod = new Map();
  for (const row of latencyRows) {
    const label = dateLabel(row.timestampMs);
    const period = byPeriod.get(label) ?? { label, values: [] };
    period.values.push(row.durationMs);
    byPeriod.set(label, period);
  }
  return {
    count: values.length,
    meanMs,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    p50Ms: p50(values),
    p95Ms: percentile(values, 95),
    byPeriod: [...byPeriod.values()]
      .sort((left, right) => right.label.localeCompare(left.label))
      .map((period) => {
        const periodMean = period.values.reduce((sum, value) => sum + value, 0) / Math.max(1, period.values.length);
        return {
          label: period.label,
          count: period.values.length,
          meanMs: periodMean,
          p50Ms: p50(period.values),
          p95Ms: percentile(period.values, 95),
        };
      }),
  };
}

function workflowIdForScore(row) {
  for (const value of [row.metaJson, row.inputJson, row.outputJson]) {
    const parsed = parseJsonValue(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const workflowId = firstString(parsed, ["workflowId", "workflow_id", "workflow", "workflowName"]);
    if (workflowId) {
      return workflowId;
    }
  }
  return "unknown";
}

function aggregateScoreRows(rows, keyForRow, shapeForRow) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyForRow(row);
    const group = groups.get(key) ?? {
      ...shapeForRow(row),
      values: [],
      sources: new Set(),
      firstScoredAtMs: Number(row.scoredAtMs),
      latestScoredAtMs: Number(row.scoredAtMs),
    };
    group.values.push(Number(row.score));
    group.sources.add(String(row.source ?? "unknown"));
    group.firstScoredAtMs = Math.min(group.firstScoredAtMs, Number(row.scoredAtMs));
    group.latestScoredAtMs = Math.max(group.latestScoredAtMs, Number(row.scoredAtMs));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const values = group.values;
    const count = values.length;
    const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, count);
    const { values: _values, sources, ...rest } = group;
    return {
      ...rest,
      count,
      mean,
      min: Math.min(...values),
      max: Math.max(...values),
      p50: p50(values),
      stddev: stddev(values, mean),
      sources: [...sources].sort(),
    };
  });
}

function scores() {
  if (!tableExists("_smithers_scorers")) {
    const usageEntries = tokenUsageEntries(null);
    return {
      scores: [],
      aggregates: [],
      runs: [],
      runAggregates: [],
      nodeAggregates: [],
      workflowAggregates: [],
      tokenMetrics: tokenMetricsFromEntries(usageEntries),
      latencyMetrics: latencyMetrics(null),
      costReport: costReportFromEntries(usageEntries),
      dbPath,
    };
  }
  const limit = limitFromPayload(200);
  const runId = typeof payload.runId === "string" && payload.runId.trim()
    ? payload.runId.trim()
    : null;
  const params = [];
  const where = runId ? "WHERE run_id = ?" : "";
  if (runId) {
    params.push(runId);
  }
  params.push(limit);
  const rows = db.query(`
    SELECT
      id,
      run_id AS runId,
      node_id AS nodeId,
      iteration,
      attempt,
      scorer_id AS scorerId,
      scorer_name AS scorerName,
      source,
      score,
      reason,
      meta_json AS metaJson,
      input_json AS inputJson,
      output_json AS outputJson,
      latency_ms AS latencyMs,
      scored_at_ms AS scoredAtMs,
      duration_ms AS durationMs
    FROM _smithers_scorers
    ${where}
    ORDER BY scored_at_ms DESC
    LIMIT ?
  `).all(...params);

  const aggregateParams = runId ? [runId] : [];
  const allRows = db.query(`
      SELECT
        run_id AS runId,
        node_id AS nodeId,
        scorer_id AS scorerId,
        scorer_name AS scorerName,
        source,
        score,
        meta_json AS metaJson,
        input_json AS inputJson,
        output_json AS outputJson,
        scored_at_ms AS scoredAtMs
      FROM _smithers_scorers
      ${where}
    `).all(...aggregateParams);
  const aggregates = aggregateScoreRows(
    allRows,
    (row) => `${row.scorerId}\0${row.scorerName}`,
    (row) => ({ scorerId: row.scorerId, scorerName: row.scorerName }),
  ).sort((left, right) => left.scorerName.localeCompare(right.scorerName));
  const runAggregates = aggregateScoreRows(
    allRows,
    (row) => row.runId,
    (row) => ({ runId: row.runId }),
  ).sort((left, right) => right.latestScoredAtMs - left.latestScoredAtMs);
  const nodeAggregates = aggregateScoreRows(
    allRows,
    (row) => `${row.runId}\0${row.nodeId}`,
    (row) => ({ runId: row.runId, nodeId: row.nodeId }),
  ).sort((left, right) => right.latestScoredAtMs - left.latestScoredAtMs);
  const workflowAggregates = aggregateScoreRows(
    allRows,
    (row) => workflowIdForScore(row),
    (row) => ({ workflowId: workflowIdForScore(row) }),
  ).sort((left, right) => right.latestScoredAtMs - left.latestScoredAtMs);
  const runs = db.query(`
    SELECT run_id AS runId, COUNT(*) AS count, MIN(scored_at_ms) AS firstScoredAtMs, MAX(scored_at_ms) AS latestScoredAtMs
    FROM _smithers_scorers
    GROUP BY run_id
    ORDER BY latestScoredAtMs DESC
  `).all();
  const usageEntries = tokenUsageEntries(runId);
  return {
    scores: rows,
    aggregates,
    runs,
    runAggregates,
    nodeAggregates,
    workflowAggregates,
    tokenMetrics: tokenMetricsFromEntries(usageEntries),
    latencyMetrics: latencyMetrics(runId),
    costReport: costReportFromEntries(usageEntries),
    dbPath,
  };
}

function eventPayloadContent(type, payload, payloadJson) {
  if (payload && typeof payload === "object") {
    if (type === "NodeOutput" || type === "task.output") {
      return firstString(payload, ["text", "output", "content", "message"]) ?? payloadJson;
    }
    if (type === "NodeFailed" || type === "node.failed") {
      return firstString(payload, ["error", "message"]) ?? payloadJson;
    }
    if (type === "AgentEvent") {
      const event = payload.event && typeof payload.event === "object" ? payload.event : null;
      return [
        firstString(payload, ["engine", "nodeId"]),
        firstString(event, ["type", "message", "text", "content"]),
      ].filter(Boolean).join(": ") || payloadJson;
    }
    return firstString(payload, ["summary", "message", "text", "output", "content", "error"]) ?? payloadJson;
  }
  return payloadJson;
}

function eventNodeId(payload) {
  if (payload && typeof payload === "object") {
    return firstString(payload, ["nodeId", "node_id"]);
  }
  return null;
}

function transcriptSearch() {
  if (!tableExists("_smithers_events")) {
    return { results: [], dbPath };
  }
  const query = typeof payload.query === "string" ? payload.query.trim() : "";
  if (!query) {
    return { results: [], dbPath };
  }
  const limit = limitFromPayload(40);
  const like = `%${query.toLowerCase()}%`;
  const hasRuns = tableExists("_smithers_runs");
  const rows = db.query(`
    SELECT
      e.run_id AS runId,
      e.seq,
      e.timestamp_ms AS timestampMs,
      e.type,
      e.payload_json AS payloadJson,
      ${hasRuns ? "r.workflow_name" : "NULL"} AS workflowKey,
      ${hasRuns ? "r.status" : "NULL"} AS runStatus
    FROM _smithers_events e
    ${hasRuns ? "LEFT JOIN _smithers_runs r ON e.run_id = r.run_id" : ""}
    WHERE lower(e.type) LIKE ? OR lower(e.payload_json) LIKE ?
    ORDER BY e.timestamp_ms DESC, e.run_id, e.seq DESC
    LIMIT ?
  `).all(like, like, limit);

  const results = rows.map((row) => {
    const payloadObject = parseJsonObject(row.payloadJson);
    const content = eventPayloadContent(String(row.type ?? ""), payloadObject, String(row.payloadJson ?? ""));
    const nodeId = eventNodeId(payloadObject);
    const workflowKey = row.workflowKey == null ? null : String(row.workflowKey);
    const runId = String(row.runId ?? "");
    const seq = Number(row.seq ?? 0);
    return {
      id: `transcript:${runId}:${seq}`,
      title: `${workflowKey ?? runId}${nodeId ? ` · ${nodeId}` : ""}`,
      description: `Run ${runId} #${seq} ${String(row.type ?? "event")}${row.runStatus ? ` · ${row.runStatus}` : ""}`,
      snippet: content,
      filePath: `run:${runId}`,
      lineNumber: seq,
      kind: "transcript",
      snippetRanges: [{
        content,
        startLine: seq,
      }],
    };
  });
  return { results, dbPath };
}

function quoteIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function sqlTables() {
  const tables = db.query(`
    SELECT name, type
    FROM sqlite_master
    WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((table) => {
    let rowCount = 0;
    if (table.type === "table") {
      try {
        rowCount = Number(db.query(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`).get().count ?? 0);
      } catch {
        rowCount = 0;
      }
    }
    return {
      name: table.name,
      type: table.type,
      rowCount,
    };
  });
  return { tables, dbPath };
}

function sqlSchema() {
  const tableName = typeof payload.tableName === "string" ? payload.tableName.trim() : "";
  if (!tableName) {
    throw new Error("tableName is required");
  }
  const table = db.query(`
    SELECT name
    FROM sqlite_master
    WHERE type IN ('table', 'view') AND name = ?
  `).get(tableName);
  if (!table) {
    throw new Error(`Table not found: ${tableName}`);
  }
  const columns = db.query(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all().map((column) => ({
    cid: Number(column.cid ?? 0),
    name: String(column.name ?? ""),
    type: String(column.type ?? ""),
    notNull: Boolean(column.notnull),
    defaultValue: column.dflt_value == null ? null : String(column.dflt_value),
    primaryKey: Number(column.pk ?? 0) > 0,
  }));
  return { schema: { tableName, columns }, dbPath };
}

function stripLeadingSqlComments(sql) {
  let remaining = sql.trim();
  while (true) {
    if (remaining.startsWith("--")) {
      const newline = remaining.indexOf("\n");
      remaining = newline >= 0 ? remaining.slice(newline + 1).trimStart() : "";
      continue;
    }
    if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/");
      remaining = end >= 0 ? remaining.slice(end + 2).trimStart() : "";
      continue;
    }
    return remaining;
  }
}

function normalizeReadOnlySql(sql) {
  let normalized = stripLeadingSqlComments(sql);
  if (normalized.endsWith(";")) {
    normalized = normalized.slice(0, -1).trimEnd();
  }
  if (!normalized) {
    throw new Error("query is required");
  }
  if (normalized.includes(";")) {
    throw new Error("Only one SQL statement is allowed.");
  }
  const firstWord = /^[A-Za-z]+/.exec(normalized)?.[0]?.toLowerCase() ?? "";
  if (!["select", "pragma", "explain"].includes(firstWord)) {
    throw new Error("Read-only SQL Browser supports SELECT, PRAGMA, and EXPLAIN only.");
  }
  return normalized;
}

function sqlCell(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (value instanceof Uint8Array) {
    return `<blob ${value.byteLength} bytes>`;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function sqlQuery() {
  const query = normalizeReadOnlySql(typeof payload.query === "string" ? payload.query : "");
  const limit = limitFromPayload(500);
  const statement = db.query(query);
  const rows = statement.all().slice(0, limit);
  const columns = Array.isArray(statement.columnNames) && statement.columnNames.length > 0
    ? statement.columnNames.map(String)
    : rows.length > 0 ? Object.keys(rows[0]) : [];
  return {
    result: {
      columns,
      rows: rows.map((row) => columns.map((column) => sqlCell(row[column]))),
    },
    dbPath,
  };
}

const operations = {
  approvalHistory,
  memoryFacts,
  recallMemory,
  scores,
  transcriptSearch,
  sqlTables,
  sqlSchema,
  sqlQuery,
};

if (!(operation in operations)) {
  console.error(`Unknown operation: ${operation}`);
  process.exit(2);
}

try {
  console.log(JSON.stringify(operations[operation]()));
} catch (error) {
  // Surface the failure as a structured envelope on stdout (exit 1) so the
  // caller can map it to a clean 400 instead of leaking a runtime stack trace.
  // SELECT-only/invalid-SQL rejections and SQLite errors flow through here.
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(1);
}
