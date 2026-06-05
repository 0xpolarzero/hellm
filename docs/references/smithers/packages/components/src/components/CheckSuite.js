// @smithers-type-exports-begin
/** @typedef {import("./CheckSuiteProps.ts").CheckSuiteProps} CheckSuiteProps */
// @smithers-type-exports-end

import React from "react";
import { SmithersContext } from "@smithers-orchestrator/react-reconciler/context";
import { Sequence } from "./Sequence.js";
import { Parallel } from "./Parallel.js";
import { Task } from "./Task.js";
/** @typedef {import("./CheckConfig.ts").CheckConfig} CheckConfig */

/**
 * Whether a single check's output row counts as a pass. A missing row (the
 * check never produced output) or an explicit failure signal counts as a fail.
 * @param {unknown} row
 * @returns {boolean}
 */
function checkPassed(row) {
    if (row == null)
        return false;
    if (typeof row === "object") {
        const r = /** @type {Record<string, unknown>} */ (row);
        if (r.passed === false || r.ok === false || r.failed === true)
            return false;
        if (r.error != null && r.error !== false)
            return false;
    }
    return true;
}

/**
 * Resolve the overall pass/fail verdict from the per-check pass count.
 * @param {"all-pass" | "majority" | "any-pass"} strategy
 * @param {number} passCount
 * @param {number} total
 * @returns {boolean}
 */
function resolveVerdict(strategy, passCount, total) {
    if (strategy === "any-pass")
        return passCount > 0;
    if (strategy === "majority")
        return passCount * 2 > total;
    return total > 0 && passCount === total;
}

/**
 * @param {CheckConfig[] | Record<string, Omit<CheckConfig, "id">>} checks
 * @returns {CheckConfig[]}
 */
function normalizeChecks(checks) {
    if (Array.isArray(checks))
        return checks;
    return Object.entries(checks).map(([key, cfg]) => ({
        id: key,
        ...cfg,
    }));
}
/**
 * <CheckSuite> — Parallel checks with auto-aggregated pass/fail verdict.
 *
 * Composes: Sequence > Parallel[Task per check] > Task(verdict aggregator)
 * @param {CheckSuiteProps} props
 */
export function CheckSuite(props) {
    if (props.skipIf)
        return null;
    const ctx = React.useContext(SmithersContext);
    const { id, checks, verdictOutput, strategy = "all-pass", maxConcurrency, continueOnFail = true, } = props;
    const prefix = id ?? "checksuite";
    const normalized = normalizeChecks(checks);
    // Build parallel check tasks
    const checkTasks = normalized.map((check) => {
        const taskId = `${prefix}-${check.id}`;
        const childContent = check.command
            ? `Run check: ${check.command}`
            : `Run check: ${check.label ?? check.id}`;
        const taskProps = {
            key: taskId,
            id: taskId,
            output: verdictOutput,
            continueOnFail,
            label: check.label ?? check.id,
        };
        if (check.agent) {
            taskProps.agent = check.agent;
        }
        return React.createElement(Task, taskProps, childContent);
    });
    const parallelEl = React.createElement(Parallel, { maxConcurrency }, ...checkTasks);
    // The verdict depends on every check. We use dependsOn (the mechanism the
    // graph extractor honors) so the verdict only runs once all checks have
    // produced output — a `needs` map alone is ignored when no `deps` are set.
    const checkIds = normalized.map((check) => `${prefix}-${check.id}`);
    // Compute the aggregate verdict from the per-check outputs. Reads are taken
    // from the workflow context at render time and captured in the closure; the
    // component re-renders reactively as each check's output becomes available,
    // and the engine defers execution until every dependency has completed.
    const verdictTask = React.createElement(Task, {
        id: `${prefix}-verdict`,
        output: verdictOutput,
        dependsOn: checkIds,
        label: "verdict",
    }, () => {
        let passCount = 0;
        const results = {};
        for (const check of normalized) {
            const checkId = `${prefix}-${check.id}`;
            const row = ctx?.outputMaybe(verdictOutput, { nodeId: checkId });
            const passed = checkPassed(row);
            results[check.id] = passed;
            if (passed)
                passCount += 1;
        }
        const total = normalized.length;
        return {
            passed: resolveVerdict(strategy, passCount, total),
            passCount,
            total,
            strategy,
            results,
        };
    });
    return React.createElement(Sequence, null, parallelEl, verdictTask);
}
