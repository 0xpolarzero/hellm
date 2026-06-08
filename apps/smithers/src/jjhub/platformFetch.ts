import { handleAuthRequired, withAuthHeaders } from "../auth/authClient";
import { platformUrl } from "./platformBaseUrl";

/**
 * Authenticated fetch against the jjhub REST API: the jjhub analog of
 * auth/authClient.ts `authFetch`. It attaches the bearer token plus (for
 * mutations) the CSRF header via `withAuthHeaders`, sends cookies, and on 401
 * fires the auth-required event so the shell can route to login.
 *
 * Unlike `authFetch` it targets the platform base URL (`platformUrl`), so it
 * works whether jjhub is same-origin (Worker-proxied) or a configured remote
 * origin.
 */
export async function platformFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers = withAuthHeaders(init.headers, method);
  const response = await fetch(platformUrl(path), {
    credentials: "include",
    ...init,
    headers,
  });
  if (response.status === 401) {
    handleAuthRequired();
  }
  return response;
}
