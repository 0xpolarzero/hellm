# jjhub backend seam

The new UI talks to two backends. This doc defines the client seam for the second
one. See `.smithers/plans/jjhub-parity.md` for the full parity roadmap; this is
Phase 0a, the transport client every code-hosting feature imports.

## Two backends

| Backend | Context | Transport | Client |
|---|---|---|---|
| smithers gateway | run-context (a run = a unit of work) | `POST {base}/v1/rpc/<method>`, JSON frame `{type:"res",ok,payload}` | `gateway/gatewayRpc.ts` |
| jjhub (Plue) | repo-context (`owner/repo`) | REST over `fetch`, plain JSON bodies | `jjhub/` (this seam) |

They coexist. The gateway client is not changed. jjhub is reached only through
`jjhub/`.

## Base-URL resolution — `jjhub/platformBaseUrl.ts`

`platformUrl(path)` resolves an API path to a full URL:

- A configured origin wins: `VITE_SMITHERS_PLATFORM_BASE_URL`, overridable at
  runtime via the `smithers_platform_base_url` localStorage key
  (`setPlatformBaseUrl`). The value is canonicalized by
  `normalizePlatformBaseUrl` (http/https only, trailing slash/hash/query
  stripped; `""` for anything unusable).
- With no configured origin, paths resolve **same-origin**, so the Cloudflare
  Worker proxies them. The Worker proxy branch for `/api/repos/*` etc. is a later
  Phase-0 step; until it lands, point `VITE_SMITHERS_PLATFORM_BASE_URL` at a
  jjhub origin directly.

This mirrors the gateway base-url helpers (`getGatewayBaseUrl`/`gatewayUrl`) in
`auth/authClient.ts`.

## Requests — `jjhub/platformFetch.ts` and `jjhub/platformJson.ts`

`platformFetch(path, init): Promise<Response>` is the jjhub analog of
`authFetch`. It attaches the bearer token and (for mutations) the CSRF header via
`withAuthHeaders`, sends cookies (`credentials: "include"`), targets
`platformUrl(path)`, and on `401` fires the auth-required event
(`handleAuthRequired`) so the shell can route to login.

`platformJson<T>(path, init): Promise<T>` wraps it for the common case: parse the
JSON body, return it on 2xx, throw `PlatformError` on anything else.
`PlatformError` carries `status` and the machine `code` from the jjhub error body
(`{error:{code,message}}` or `{error,message}`), falling back to the HTTP status.

## Pagination — `jjhub/parseLinkCursor.ts`

jjhub list endpoints page with a `Link` header:
`Link: <…?cursor=abc>; rel="next"`. `parseLinkCursor(header)` returns the `cursor`
query param of the `rel="next"` URL, or `null` for the last page. Consumers read
`response.headers.get("Link")` from a `platformFetch` call and pass it here.

## Typed clients — `jjhub/{repos,issues,landings,workspaces,notifications}.ts`

The thin typed surface every feature card imports. Each module exports:

- One or more `list*` functions returning `{ <items>, nextCursor }`.
- A `listAll*` walker that follows `nextCursor` to the last page, bounded by
  `maxPages` (default 50) so a buggy upstream `Link` header is never fatal.
- A `get*` accessor for the single-record case.
- Mutation helpers (`createIssue`, `updateIssue`, `markAllNotificationsRead`).

Every helper throws `PlatformError` (carrying `status` and the jjhub `code`)
on non-2xx and tolerates extra wire fields without crashing the parser. The
client never trusts an unknown shape — `parseRepo`/`parseIssue` etc. inspect
each field and return `null` for malformed rows so a list silently drops the
bad row instead of throwing.

## Worker proxy — `/api/user/<sub>` precedence

The Cloudflare Worker (`src/worker.ts`) routes same-origin paths to two upstreams:

- `AUTH_API_BASE_URL` (a.k.a. `PLUE_API_BASE_URL`) — identity + OAuth.
- `GO_API_BASE_URL` — jjhub REST.

`/api/user` (the identity singleton) always lands on `AUTH_API_BASE_URL`.
Platform user subpaths — `/api/user/repos`, `/api/user/readable-repos`,
`/api/user/workspaces`, `/api/user/orgs`, `/api/user/starred`,
`/api/user/issues`, `/api/user/landings`, `/api/user/notifications`,
`/api/user/{subscriptions,following,followers,searches}` — go to
`GO_API_BASE_URL` when set, and fall back to `AUTH_API_BASE_URL` when not
(the monolith case).

`/api/user/<anything-else>` (e.g. `/api/user/keys`, `/api/user/settings/*`) is
treated as auth-identity and stays on `AUTH_API_BASE_URL`. Adding a new
platform subpath means appending one string to `PLATFORM_USER_SUBPATHS` in
`worker.ts` — the rest of the dispatcher composes around it.

| Config | `/api/user` | `/api/user/repos` | `/api/repos` |
|---|---|---|---|
| Both set (split) | → AUTH | → GO | → GO |
| Only AUTH (monolith) | → AUTH | → AUTH | → AUTH |
| Only GO (platform-only) | 404 | → GO | → GO |
| Neither (missing) | 404 | 404 | 404 |

Credentials forward straight through (cookie + Authorization). The Worker
never invents `x-user-id` / `x-user-scopes` for the platform proxy — those
trusted-proxy headers are gateway-only (`/v1/rpc`, `/workflows`). jjhub
validates the session itself.

## UI wiring status

| Client | Typed surface | Unit tests | Wired UI | Reason |
|---|---|---|---|---|
| `repos.ts` | yes | yes | no | Phase 0b — repo picker lands with the URL-routed `repoContext` store. Today no surface lists repos. |
| `issues.ts` | yes | yes | **yes** — `IssuesCanvas` repo selector → `useIssuesStore.selectRepoContext` → `hydrateFromPlatform` | The first live consumer; proves the typed-client → store → canvas chain end-to-end. |
| `landings.ts` | yes | yes | no | Same as repos: deferred until `/:owner/:repo/landings` lands. The landings surface today renders seeded data only. |
| `workspaces.ts` | yes | yes | no | Workspaces are surfaced by the JJHub workspace lifecycle (a separate slice). The typed client exists so that slice can import it without re-doing transport, but no card mounts it. |
| `notifications.ts` | yes | yes | no | Notifications need a real-time stream (the SSE seam below), not a one-shot list, so the typed client is the static-fetch piece only. The bell uses `notificationsStore` (transient toasts) — wiring it to live Plue is deferred until the SSE channel lands. |

A typed client without a wired UI is on purpose: the transport layer is one
slice, the surfaces that consume it are several slices. Adding a wired surface
later means importing from `jjhub/<client>.ts` and reusing
`hydrateFromPlatform`'s pattern (no-op when no base URL is configured;
`PlatformError` surfaces as a banner; `AbortSignal` short-circuits the
post-fetch mutation).

## Local harness — `tests/fixtures/fakePlueHost.ts`

`apps/smithers` ships a deterministic fake Plue server (`Bun.serve`) that
mirrors the platform routes the new UI consumes (`/api/user`, `/api/user/repos`,
`/api/repos/:owner/:repo`, issues with cursor pagination, landings, workspaces,
notifications, plus WorkOS/Auth0 authorize redirects). Boot via:

```
pnpm -C apps/smithers run plue:harness        # standalone
pnpm -C apps/smithers run test:plue           # worker + fixture contract tests
pnpm -C apps/smithers exec playwright test    # bundled via webServer
```

The same fixture drives `src/workerPlue.test.ts` (split + monolith proxy
modes, pagination, 401/403, large lists) and
`tests/e2e/plueHarness.spec.ts` (browser -> vite -> fake-plue end-to-end).
Playwright also boots the normal Worker-backed app origin so the split-config
Worker tests keep running against `authFixture.ts` + `plueFixture.ts`; the Plue
harness spec uses its own Vite origin with auth and platform proxies pointed at
the fake hosts.

When a real Plue stack is preferred, `scripts/dev-with-plue.sh` boots Plue's
docker-compose stack and points vite's auth + platform proxies at it. Full
design in
[../../.smithers/specs/smithers-plue-local-e2e-harness.md](../../.smithers/specs/smithers-plue-local-e2e-harness.md).

## Deferred (the rest of Phase 0)

- `repoContext` URL selection. Per the routing law (URL is the source of
  truth), the active `owner/repo` should live in the URL with a read-only store,
  alongside the new `/:owner/:repo/...` route vocabulary in `deriveRoute.ts` /
  `Surface.ts`. The current in-store `repoContext` on `useIssuesStore` is a
  transitional seam — once the URL parameter exists, the canvas binds against
  it instead of a local form.
- A `backend` selector store that picks the home view (gateway runs vs repo
  dashboard).
- The SSE seam (`authenticatedEventSource`) and the WebSocket ticket helper
  (`/api/auth/sse-ticket`) that the notifications stream and the terminal need.
