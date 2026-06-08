# jjhub parity: notifications inbox surface

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phase 13). The jjhub client `jjhub/notifications.ts` already exists; this builds
the surface that consumes it.

## Problem

The new UI has only ephemeral toasts (`notifications/Toasts.tsx` +
`notificationsStore.ts`). jjhub has a persisted notification inbox (feed, unread
count, mark-read / mark-all, source-typed badges, live SSE stream). None of that
exists as a surface, even though the data client is built.

## Goal

A persisted inbox surface, distinct from the toast stack, that lists
notifications from jjhub, filters unread/all, marks read, and streams live
updates. The toast becomes the live nudge that deep-links into an inbox item.

## Scope

- New domain `inbox/`: `inbox.ts` + `InboxCanvas.tsx` + `inboxStore.ts` +
  `runInboxRoute.tsx` + `inboxDomain.test.ts`, following the `vcs/` template.
- Wire `inboxStore` to `jjhub/notifications.ts` (real-when-configured, no-op
  offline), mirroring the issues/landings hydration pattern.
- Keep `notifications/Toasts.tsx` as the ephemeral live slice.
- Add `{kind:"inbox"}` to `Surface.ts` + `deriveRoute` + `openSurface` + `CardView`.

## Blocks

- Live stream depends on the SSE seam (0030).
- Route registration touches shared migration-owned files (sequence per 0031).

## Acceptance

- [ ] Inbox lists jjhub notifications with unread/all filter + unread count.
- [ ] Mark-read and mark-all work against the backend.
- [ ] Live SSE updates the feed (after 0030); offline keeps a seed/empty state.
- [ ] Toast deep-links into the inbox item.
