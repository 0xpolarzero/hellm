export type AuthProvider = "google" | "github" | "email";
export type AuthStrategy = "workos" | "auth0";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  isAdmin: boolean;
};

const TOKEN_KEY = "smithers_token";
const GATEWAY_BASE_URL_KEY = "smithers_gateway_base_url";
const POST_LOGIN_REDIRECT_KEY = "smithers_post_login_redirect";
const LOGIN_PENDING_KEY = "smithers_login_pending";
const CSRF_COOKIE = "__csrf";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readSessionValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeSessionValue(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures during logout.
  }
}

function readLocalValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalValue(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
    return true;
  } catch {
    return false;
  }
}

function envString(key: string): string {
  const value = import.meta.env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function authStrategy(): AuthStrategy {
  return envString("VITE_SMITHERS_AUTH_STRATEGY").toLowerCase() === "auth0" ? "auth0" : "workos";
}

export function authProviderSelectionEnabled(): boolean {
  return authStrategy() === "workos";
}

export function normalizeAuthToken(raw: string): string | null {
  const token = raw.trim();
  if (!token) return null;
  return token.replace(/^(bearer|token)\s+/i, "").trim() || null;
}

export function getStoredToken(): string | null {
  const raw = readSessionValue(TOKEN_KEY);
  return raw ? normalizeAuthToken(raw) : null;
}

export function getStoredAuthorization(): string | null {
  const token = getStoredToken();
  return token ? `Bearer ${token}` : null;
}

export function setStoredToken(token: string): boolean {
  const normalized = normalizeAuthToken(token);
  if (!normalized) return false;
  return writeSessionValue(TOKEN_KEY, normalized);
}

export function hasStoredToken(): boolean {
  return getStoredToken() !== null;
}

function removeCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function clearLocalAuth(): void {
  removeSessionValue(TOKEN_KEY);
  removeCookie(CSRF_COOKIE);
}

export function getCSRFToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE}=`));
  if (!match) return null;
  const token = match.slice(CSRF_COOKIE.length + 1).trim();
  return token || null;
}

export function withAuthHeaders(headers?: HeadersInit, method?: string): Headers {
  const merged = new Headers(headers ?? undefined);
  if (!merged.has("Authorization")) {
    const authorization = getStoredAuthorization();
    if (authorization) merged.set("Authorization", authorization);
  }
  if (method && MUTATING_METHODS.has(method.toUpperCase()) && !merged.has("X-CSRF-Token")) {
    const csrf = getCSRFToken();
    if (csrf) merged.set("X-CSRF-Token", csrf);
  }
  return merged;
}

export const AUTH_REQUIRED_EVENT = "smithers:auth-required";

function dispatchAuthRequired(redirectPath: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(AUTH_REQUIRED_EVENT, {
      detail: { redirect: redirectPath },
    }),
  );
}

export function safeRedirectPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  try {
    const parsed = new URL(trimmed, "http://smithers.local");
    if (parsed.origin !== "http://smithers.local" || parsed.pathname === "/login") {
      return null;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function currentRedirectPath(): string {
  if (typeof window === "undefined") return "/";
  return safeRedirectPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  ) ?? "/";
}

export function loginUrlForRedirect(redirectPath = currentRedirectPath()): string {
  const safe = safeRedirectPath(redirectPath) ?? "/";
  return `/login?redirect=${encodeURIComponent(safe)}`;
}

let authRedirectInFlight = false;

/** Tests only: clear the cross-call redirect guard between isolated test cases. */
export function resetAuthRedirectForTests(): void {
  authRedirectInFlight = false;
}

export function handleAuthRequired(redirectPath = currentRedirectPath()): void {
  // Both gatewayRpc (RPC 401) and SyncClient.onAuthError (stream-side
  // UNAUTHORIZED) can call this back-to-back for the same failure. The guard
  // collapses the burst to a single redirect so we don't double-navigate or
  // fire duplicate clear-local-auth side effects.
  if (authRedirectInFlight) return;
  authRedirectInFlight = true;
  try {
    clearLocalAuth();
    const safe = safeRedirectPath(redirectPath) ?? "/";
    dispatchAuthRequired(safe);
    if (typeof window === "undefined" || window.location.pathname === "/login") {
      // Already on /login — reset the guard so a fresh sign-in attempt that
      // re-fails (e.g. bad credentials) can redirect again later.
      authRedirectInFlight = false;
      return;
    }
    window.location.assign(loginUrlForRedirect(safe));
  } catch (error) {
    authRedirectInFlight = false;
    throw error;
  }
}

export function getLoginRedirectTarget(): string {
  if (typeof window === "undefined") return "/";
  const params = new URLSearchParams(window.location.search);
  return safeRedirectPath(params.get("redirect")) ?? "/";
}

export function rememberPostLoginRedirect(redirectPath = getLoginRedirectTarget()): void {
  const safe = safeRedirectPath(redirectPath) ?? "/";
  writeSessionValue(POST_LOGIN_REDIRECT_KEY, safe);
  writeSessionValue(LOGIN_PENDING_KEY, "1");
}

export function consumePostLoginRedirect(): string | null {
  if (readSessionValue(LOGIN_PENDING_KEY) !== "1") return null;
  removeSessionValue(LOGIN_PENDING_KEY);
  const value = readSessionValue(POST_LOGIN_REDIRECT_KEY);
  removeSessionValue(POST_LOGIN_REDIRECT_KEY);
  return safeRedirectPath(value);
}

export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const headers = withAuthHeaders(init.headers, method);
  const url = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers,
  });
  if (response.status === 401) {
    handleAuthRequired();
  }
  return response;
}

export function parseAuthUser(payload: unknown): AuthUser | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const id = record.id;
  const username = record.username;
  if ((typeof id !== "number" && typeof id !== "string") || typeof username !== "string") {
    return null;
  }
  return {
    id: String(id),
    username,
    displayName:
      typeof record.display_name === "string" && record.display_name
        ? record.display_name
        : username,
    email: typeof record.email === "string" ? record.email : "",
    avatarUrl: typeof record.avatar_url === "string" ? record.avatar_url : "",
    isAdmin: record.is_admin === true,
  };
}

export function providerAuthorizeUrl(
  provider: AuthProvider,
  options: { email?: string; redirect?: string } = {},
): string {
  const strategy = authStrategy();
  const path = strategy === "auth0" ? "/api/auth/auth0/authorize" : "/api/auth/workos/authorize";
  const params = new URLSearchParams();
  if (strategy === "workos") {
    if (provider === "github") params.set("provider", "GitHubOAuth");
    if (provider === "google") params.set("provider", "GoogleOAuth");
    if (provider === "email") params.set("provider", "authkit");
    if (options.email) params.set("login_hint", options.email.trim());
  }
  const redirect = safeRedirectPath(options.redirect) ?? getLoginRedirectTarget();
  if (redirect !== "/") params.set("redirect", redirect);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function defaultGatewayBaseUrl(): string {
  return envString("VITE_SMITHERS_GATEWAY_BASE_URL");
}

export function normalizeGatewayBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function getGatewayBaseUrl(): string {
  return normalizeGatewayBaseUrl(readLocalValue(GATEWAY_BASE_URL_KEY) ?? defaultGatewayBaseUrl());
}

export function setGatewayBaseUrl(value: string): boolean {
  return writeLocalValue(GATEWAY_BASE_URL_KEY, normalizeGatewayBaseUrl(value));
}

export function gatewayUrl(path: string): string {
  const base = getGatewayBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base) {
    const origin =
      typeof location !== "undefined" ? location.origin : "http://127.0.0.1:7331";
    return `${origin}${normalizedPath}`;
  }
  return new URL(normalizedPath, base).toString();
}
