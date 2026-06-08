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
declare function runWithToolContext<T>(ctx: Record<string, any>, fn: () => T): T;
/**
 * @returns {Record<string, any> | undefined}
 */
declare function getToolContext(): Record<string, any> | undefined;
/**
 * @param {Record<string, any>} [ctx]
 * @returns {string | null}
 */
declare function getToolIdempotencyKey(ctx?: Record<string, any>): string | null;
/**
 * @param {Record<string, any>} ctx
 * @returns {number}
 */
declare function nextToolSeq(ctx: Record<string, any>): number;

export { getToolContext, getToolIdempotencyKey, nextToolSeq, runWithToolContext };
