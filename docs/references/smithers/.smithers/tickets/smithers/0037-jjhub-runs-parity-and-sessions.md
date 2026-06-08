# jjhub parity: runs parity + durable agent sessions

Part of the jjhub parity effort. Full detail: `.smithers/plans/jjhub-parity.md`
(Phase 7). This is gateway-side (local smithers) more than jjhub REST, but it is
the daily-loop completion.

## Problem

The gateway run experience is read-mostly: node-tree inspection and node output
work, but live logs, cancel, rerun, resume, approve/deny, dispatch-with-inputs,
and run artifacts are stubbed or absent. The chat is one ephemeral in-memory
transcript with no durable, listable, repo-bound session, and no hijack/handoff.

## Goal

Complete the run feature against the gateway and make the chat a durable session.

## Scope

- Stop filtering workflow defs to custom-UI-only (`gatewayStore.ts`); dispatch
  with ref + typed/JSON inputs; all-runs list + status filter; run-detail metadata.
- Per-node logs, then live run logs (SSE via 0030); cancel / rerun / resume; run
  artifacts list/download.
- Approvals: filtered list + detail + approve/deny (promote the inline
  `ApprovalCard` to a list canvas).
- Agent sessions: persistence, session list, create/delete, typed message parts
  (text/tool_call/tool_result), provider/transport selection, hijack/handoff.

## Blocks

- NEW GATEWAY RPCs REQUIRED for cancel/rerun/resume/log-stream/approve-deny and
  session-event ingest. These exist as CLI commands (`smithers cancel`/`replay`/
  `resume`/`approve`/`hijack`) but are NOT wired into gateway RPC today.
- Hijack/handoff (XL) has no reachable gateway endpoint — the long pole.
- Typed tool parts are inert without a runner that emits them (the Cerebras chat
  proxy emits plain text); sequence the real dispatch path before tool-part UI.

## Acceptance

- [ ] Dispatch a run with inputs; cancel a running run; approve/deny from a list.
- [ ] Live logs stream and reconnect.
- [ ] Chat survives reload as a listable session; history loads on open.
- [ ] Hijack: a backgrounded run streams into a watched session (once RPC exists).
