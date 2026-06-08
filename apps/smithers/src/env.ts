/**
 * Bindings available to the Cloudflare Worker at runtime. `CEREBRAS_API_KEY` is
 * a Cloudflare secret (set by Alchemy from the deploy environment); `ASSETS` is
 * the static-assets fetcher the platform injects for the built PWA.
 */
export interface CloudflareEnv {
  CEREBRAS_API_KEY: string;
  /**
   * Override for the upstream OpenAI-compatible base URL. Defaults to Cerebras
   * in production; e2e fixtures point it at a local deterministic SSE server so
   * the whole gateway path can be exercised without a real key.
   */
  CEREBRAS_BASE_URL?: string;
  /** Override for the upstream model id. Defaults to gpt-oss-120b. */
  CEREBRAS_MODEL?: string;
  /**
   * Optional Plue API origin used for Smithers browser auth. When configured,
   * the Worker proxies `/api/auth/*` and `/api/user*` to this origin.
   */
  AUTH_API_BASE_URL?: string;
  /** Back-compat alias for AUTH_API_BASE_URL. */
  PLUE_API_BASE_URL?: string;
  /**
   * Optional public Smithers PWA origin used to rewrite upstream OAuth
   * `redirect_uri` parameters so the authorize and callback requests share one
   * browser cookie jar. Defaults to the incoming request origin.
   */
  AUTH_CALLBACK_BASE_URL?: string;
  /**
   * Optional authenticated Smithers Gateway origin. When configured, the Worker
   * proxies `/v1/rpc`, `/workflows`, and `/health` to the gateway.
   */
  GATEWAY_BASE_URL?: string;
  /**
   * Optional server-side gateway bearer token. Browser-supplied Authorization
   * headers are never treated as gateway credentials by the Worker.
   */
  GATEWAY_AUTH_TOKEN?: string;
  /**
   * Optional jjhub (Plue) code-hosting API origin. When set, the Worker proxies
   * the platform REST routes (`/api/repos`, `/api/orgs`, `/api/search`,
   * `/api/notifications`, `/api/integrations`, `/api/oauth2`, `/resolve`) to it,
   * forwarding the user's credentials. When unset these fall back to
   * AUTH_API_BASE_URL, since jjhub is one Go monolith. The browser reaches these
   * through `jjhub/platformFetch`.
   */
  GO_API_BASE_URL?: string;
  /**
   * Set to "false" to leave `/api/chat` public even when auth is configured.
   * Set to "true" to require auth and fail closed if AUTH_API_BASE_URL is absent.
   */
  AUTH_REQUIRED?: string;
  /** Gateway trusted-proxy scopes to grant after Plue session validation. */
  GATEWAY_TRUSTED_PROXY_SCOPES?: string;
  /** Gateway trusted-proxy role to grant after Plue session validation. */
  GATEWAY_TRUSTED_PROXY_ROLE?: string;
  ASSETS?: { fetch: (request: Request) => Promise<Response> };
}
