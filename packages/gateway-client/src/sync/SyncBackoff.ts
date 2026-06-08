/**
 * Exponential backoff with full jitter, mirroring the curve `gatewayBackoffDelay`
 * uses so a Smithers-wide reconnect storm doesn't synchronize and DOS the
 * gateway. The function is pure so tests can pass a deterministic `random` and
 * assert exact delays.
 */
export type SyncBackoffOptions = {
  /** First backoff delay, ms. Default 250ms. */
  baseMs?: number;
  /** Hard ceiling, ms. Default 10s. */
  maxMs?: number;
  /** Injection seam for tests. Defaults to Math.random. */
  random?: () => number;
};

export function syncBackoffDelay(attempt: number, options: SyncBackoffOptions = {}): number {
  const base = options.baseMs ?? 250;
  const max = options.maxMs ?? 10_000;
  const random = options.random ?? Math.random;
  const upper = Math.min(max, base * 2 ** Math.max(0, attempt));
  return Math.floor(random() * upper);
}
