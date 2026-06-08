# jjhub parity: authenticated SSE seam (`authenticatedEventSource`)

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phase 0). The transport seam (`jjhub/platformFetch` etc.) and the WS/SSE ticket
helper (`jjhub/websocketTicket.ts`) already shipped; this is the remaining
live-stream half.

## Problem

jjhub pushes live updates over authenticated Server-Sent Events with
`Last-Event-ID` replay (notifications feed, agent-session stream, workspace
status, run logs). The new UI has no SSE client; the chat uses a one-shot
fetch-SSE (`chat/streamReplyViaApi.ts`), not a reconnecting `EventSource`.

## Goal

A store-driven `jjhub/authenticatedEventSource.ts` (not a React hook) that opens
an `EventSource` against a platform path, authenticates via the ticket helper
(`?ticket=`), reconnects on drop, and resumes with `Last-Event-ID`. One seam
every live surface reuses.

## Scope

- New file `jjhub/authenticatedEventSource.ts`; pure URL/ticket assembly is
  unit-tested, the connection lifecycle covered by a real-fixture integration test.
- Reuse `jjhub/websocketTicket.ts` for the ticket.
- No consumer in this ticket; it unblocks the notifications inbox (0032) and the
  terminal/session streams (0034, 0037).

## Blocks / open

- BLOCKED on a faithful reference: jjhub's original
  `apps/ui/src/lib/authenticatedEventSource.ts` is no longer in the plue tree.
  Confirm the current jjhub SSE auth + replay semantics before implementing, or
  the reconnect/replay contract will drift.
- SSE through the Cloudflare Worker is a streamed response (works); only the
  WebSocket PTY cannot traverse the Worker (see 0034).

## Acceptance

- [ ] `EventSource` opens against a platform path with a ticket, no auth header.
- [ ] Drop -> reconnect with `Last-Event-ID`, no event gap, no dup.
- [ ] No platform base URL is a clean no-op (offline/dev unchanged).
- [ ] Pure assembly unit-tested; lifecycle integration-tested against a real fixture.
