/**
 * A SyncKey is a structured cache key for the SDK. The first element is the
 * scope (usually the gateway RPC method or a domain name) and the remainder are
 * narrowing args, stringified deterministically so semantically-equal keys
 * fingerprint identically regardless of property insertion order.
 *
 * Keys are typed (string-tuple at runtime, brand-checked at compile time) so
 * `listRuns` queries can never collide with `getRun` queries, and a custom UI
 * can declare its own scopes without leaking into gateway-method keys.
 */
export type SyncKey = readonly [scope: string, ...args: ReadonlyArray<unknown>];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = value[k];
      if (v === undefined) continue;
      out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

/**
 * A stable, hashable string for a key. Object property order is normalized so
 * `{a:1,b:2}` and `{b:2,a:1}` collapse to the same fingerprint; `undefined`
 * fields are dropped (matching JSON semantics for cache lookup); arrays stay
 * order-sensitive (cache keys often want positional args).
 */
export function syncKeyFingerprint(key: SyncKey): string {
  return JSON.stringify(canonical(key));
}

/** True when `target` is `prefix` or a key whose first elements match `prefix`. */
export function syncKeyMatches(target: SyncKey, prefix: SyncKey): boolean {
  if (prefix.length > target.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (syncKeyFingerprint([String(target[i]), target[i]]) !== syncKeyFingerprint([String(prefix[i]), prefix[i]])) {
      return false;
    }
  }
  return true;
}
