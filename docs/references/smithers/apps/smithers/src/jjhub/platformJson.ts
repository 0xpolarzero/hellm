import { platformFetch } from "./platformFetch";

/**
 * A failed jjhub request. `status` is the HTTP code; `code` is the machine
 * string from the error body, defaulting to the status when absent. Thrown by
 * `platformJson` and by the typed-client list/get/mutation helpers.
 */
export class PlatformError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PlatformError";
    this.status = status;
    this.code = code;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Read the body of a `platformFetch` response as JSON, tolerating empty bodies
 * (returns null) and non-JSON bodies (returns null). Shared by every typed
 * client so the read-then-validate dance lives in one place — drift here used
 * to mean each client reinvented `await response.text() + JSON.parse` slightly
 * differently.
 */
export async function readPlatformJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  return safeJson(text);
}

/** Build a PlatformError from a parsed jjhub error body, tolerating the few
 *  shapes the API uses (`{error:{code,message}}`, `{error,message}`, `{message}`).
 *
 *  Exported so the typed clients (repos/issues/landings/workspaces/notifications)
 *  share one definition rather than each owning a near-identical copy. */
export function platformErrorFromBody(status: number, body: unknown): PlatformError {
  const error = (body as { error?: unknown } | null)?.error;
  if (error && typeof error === "object") {
    const code = String((error as { code?: unknown }).code ?? status);
    const message = String(
      (error as { message?: unknown }).message ?? `jjhub request failed (${status})`,
    );
    return new PlatformError(status, code, message);
  }
  const message =
    typeof error === "string"
      ? error
      : String((body as { message?: unknown } | null)?.message ?? `jjhub request failed (${status})`);
  return new PlatformError(status, String(status), message);
}

/**
 * Fetch jjhub JSON: parse the body, return it on 2xx, throw `PlatformError`
 * otherwise. The thin typed layer over `platformFetch` for endpoints that return
 * a JSON document. For paginated lists, call `platformFetch` directly and read
 * the `Link` header with `parseLinkCursor`.
 */
export async function platformJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await platformFetch(path, init);
  const body = await readPlatformJson(response);
  if (!response.ok) {
    throw platformErrorFromBody(response.status, body);
  }
  return body as T;
}
