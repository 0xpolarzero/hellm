# jjhub parity: platform breadth (settings, repo config, wiki/releases, search, integrations)

Part of the jjhub parity effort. Full detail (per-feature gap table, effort,
backend deps): `.smithers/plans/jjhub-parity.md` (Phases 8–14). This is the long
tail — an umbrella; split into per-surface tickets when each is scheduled.

## Problem

A large class of jjhub surfaces has no presence in the new UI. None block the
core daily loop, so they trail the surfaces above, but they are required for true
parity.

## Goal

Track the remaining platform surfaces so none are silently dropped.

## Scope (each becomes its own ticket when picked up)

- **Account settings + auth shell** (Phase 9): `/settings` shell, PATs, active
  sessions, profile, emails, connected accounts, SSH keys, OAuth apps, device
  registration, notification prefs. Most are `reach=yes` today (`/api/user/*`).
- **Repo env + keys + webhooks + prompts** (Phase 8): variables/secrets tabs,
  deploy keys, webhooks CRUD + test delivery + history, `.smithers/prompts` files.
- **Repo settings + lifecycle** (Phase 10): metadata/clone URLs, PATCH, delete,
  archive, fork, transfer, topics, stars, connection + GitHub-app status, sync.
- **Wiki + releases** (Phase 11): two full CRUD content surfaces (read-side first;
  release asset write-side is a non-goal).
- **Search** (Phase 13): unified `/search` with code/issues/repos/users scopes +
  state filter + pagination.
- **Integrations + orgs/billing** (Phase 14): integrations catalog, Linear OAuth +
  sync, GitHub-app, orgs/teams, thin billing (open Stripe portal), repo watch,
  alpha waitlist.

## Non-goals (do NOT build into this UI)

- Git Smart-HTTP transport + LFS serving (backend, not the Worker).
- Admin dashboards (`apps/admin` territory) and runner pools.
- Server-to-server plumbing (github proxy/webhook, mirror sync, Stripe/Linear
  webhook receivers), feature flags, client telemetry.

## Acceptance

- [ ] Each scope item is promoted to its own ticket before implementation.
- [ ] Settings shell + PATs land first (PATs are `reach=yes` and high value).
- [ ] Non-goals stay out of the user-facing UI.
