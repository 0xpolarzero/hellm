import { AsyncLocalStorage } from "node:async_hooks";

/** @type {AsyncLocalStorage<Record<string, any>>} */
const storage = new AsyncLocalStorage();

/**
 * Run `fn` with `ctx` as the ambient tool-execution context. Tool `execute`
 * functions invoked anywhere inside (including across awaits) can read it with
 * getToolContext(). Used by the engine to give in-process agent tools their
 * run/node/cwd context and a durability snapshot hook.
 *
 * @template T
 * @param {Record<string, any>} ctx
 * @param {() => T} fn
 * @returns {T}
 */
export function runWithToolContext(ctx, fn) {
    return storage.run(ctx, fn);
}

/**
 * @returns {Record<string, any> | undefined}
 */
export function getToolContext() {
    return storage.getStore();
}

/**
 * @param {Record<string, any>} [ctx]
 * @returns {string | null}
 */
export function getToolIdempotencyKey(ctx = getToolContext()) {
    if (!ctx) {
        return null;
    }
    if (typeof ctx.idempotencyKey === "string" && ctx.idempotencyKey.length > 0) {
        return ctx.idempotencyKey;
    }
    if (!ctx.runId || !ctx.nodeId) {
        return null;
    }
    return `smithers:${ctx.runId}:${ctx.nodeId}:${ctx.iteration ?? 0}`;
}

/**
 * @param {Record<string, any>} ctx
 * @returns {number}
 */
export function nextToolSeq(ctx) {
    ctx.seq = (ctx.seq ?? 0) + 1;
    return ctx.seq;
}
