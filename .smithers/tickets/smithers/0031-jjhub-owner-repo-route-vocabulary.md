# jjhub parity: owner/repo route vocabulary + repo-context

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phase 0c). The backend selector store (`app/backendStore.ts`) already shipped.

## Problem

The new UI has no repo-scoped URL space. jjhub features are all `owner/repo`
scoped (`/{owner}/{repo}/...`). Today issues/landings hydrate from a manual
`RepoContextBar` text input, not from the URL, so the active repo is not
shareable, bookmarkable, or back/forward-navigable.

## Goal

Add the `/:owner/:repo/...` route vocabulary and a URL-driven repo-context, so
repo-scoped surfaces attach under it and the active `{owner, repo, ref}` lives in
the URL (the routing law: URL is the source of truth, store reads it via
subscription).

## Scope

- Extend `app/deriveRoute.ts` with `/:owner/:repo/...` patterns, matched AFTER the
  existing `/runs/...` and `/gw/...` patterns (regex order is load-bearing).
- Extend `app/Surface.ts` with repo-scoped surface kinds incrementally.
- A read-only repo-context derived from the URL (replace the per-store
  `RepoContext` duplication in `issuesStore`/`landingsStore` with one source).
- Wire `app/navigation.ts` `openSurface` + a retained repo search param.

## Blocks / sequencing

- COLLISION RISK: edits `deriveRoute.ts`/`Surface.ts`/`navigation.ts`, the hottest
  files in the in-flight UI migration. Land as one isolated change when the
  migration quiets, with tests, before any repo surface attaches.
- Best sequenced immediately before repos + source (0033).

## Acceptance

- [ ] `/:owner/:repo` and sub-paths resolve to surfaces; run/gateway routes still win.
- [ ] Active repo-context is URL-driven and survives reload + back/forward.
- [ ] `issuesStore`/`landingsStore` read the shared repo-context, no per-store dup.
- [ ] `deriveRoute` route-matching unit tests cover the new patterns + ordering.
