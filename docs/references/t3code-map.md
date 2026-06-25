# t3code Effect Reference Map

This map identifies the local `docs/references/t3code` files that are useful when applying Effect
v4 patterns to `svvy`. It is a research index only. `svvy` product architecture is governed by
`docs/prd.md`, `docs/features.ts`, and `docs/specs/package-architecture/`; `t3code` is not product
authority.

## Bootstrap And Runtime Ownership

- `docs/references/t3code/apps/server/src/bin.ts`
- `docs/references/t3code/infra/relay/src/worker.ts`
- `docs/references/t3code/apps/mobile/src/lib/runtime.ts`
- `docs/references/t3code/apps/server/src/cloud/ManagedEndpointRuntime.ts`

Use these for process-edge runtime creation, scoped runtime lifetime, explicit startup, and
finalizer ownership patterns. Do not copy product topology from them.

## Service And Layer Composition

- `docs/references/t3code/infra/relay/src/auth/DpopProofs.ts`
- `docs/references/t3code/infra/relay/src/agentActivity/ApnsDeliveryQueue.ts`
- `docs/references/t3code/infra/relay/src/Config.ts`
- `docs/references/t3code/infra/relay/src/worker.ts`

Use these for `Context.Service`/`Layer` style, dependency injection, service tests, and avoiding
package-local runtime creation.

## Schema And Protocol Contracts

- `docs/references/t3code/packages/effect-acp/scripts/generate.ts`
- `docs/references/t3code/packages/effect-acp/src/schema.ts`
- `docs/references/t3code/packages/effect-acp/src/rpc.ts`
- `docs/references/t3code/packages/effect-codex-app-server/src/client.ts`
- `docs/references/t3code/packages/contracts/src/rpc.ts`
- `docs/references/t3code/packages/contracts/src/relay.ts`
- `docs/references/t3code/infra/relay/src/http/Api.ts`

Use these for schema-first DTOs, generated protocol artifacts, RPC boundary validation, and
transport-to-domain error mapping.

## Snapshot, Stream, And RPC Boundaries

- `docs/references/t3code/apps/server/src/ws.ts`
- `docs/references/t3code/apps/server/src/observability/RpcInstrumentation.ts`
- `docs/references/t3code/packages/client-runtime/src/wsRpcClient.ts`

Use these for snapshot-plus-live-update boundaries, RPC instrumentation, and edge facade behavior.
Durable `svvy` state still comes from `@svvy/state` read models, not runtime event payloads.

## Workers And Backpressure

- `docs/references/t3code/packages/shared/src/DrainableWorker.ts`
- `docs/references/t3code/packages/shared/src/KeyedCoalescingWorker.ts`
- `docs/references/t3code/infra/relay/src/agentActivity/ApnsDeliveries.ts`
- `docs/references/t3code/infra/relay/src/agentActivity/ApnsDeliveryQueue.ts`

Use these for deterministic worker loops, coalesced wakeups, retry cadence, and shutdown behavior.

## Observability And Test Layers

- `docs/references/t3code/infra/relay/src/observability.ts`
- `docs/references/t3code/packages/shared/src/observability.ts`
- `docs/references/t3code/packages/shared/src/logging.ts`
- `docs/references/t3code/packages/effect-codex-app-server/src/client.test.ts`
- `docs/references/t3code/packages/shared/src/relayClient.test.ts`

Use these for service-level observability, log annotations, and focused Effect tests.

## Guardrails

- `docs/references/t3code/oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts`
- `docs/references/t3code/oxlint-plugin-t3code/rules/no-global-process-runtime.ts`
- `docs/references/t3code/oxlint-plugin-t3code/rules/no-inline-schema-compile.ts`
- `docs/references/t3code/packages/shared/src/hostProcess.ts`

Use these for lintable constraints around runtime creation, process-global reads, and schema
compiler placement.
