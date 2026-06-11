# `@svvy/state` Spec Todo

## Status

- Status: future package spec todo
- Package: `@svvy/state`

## Purpose

`@svvy/state` owns durable product state, settings persistence, logs, and read-model projection.

It stores facts and projects them. It does not execute work.

## Owns

- App and workspace settings persistence.
- Provider auth status and secure secret storage ports.
- Persisted extension env values, env status records, and encrypted extension secrets.
- Ambient resource category settings.
- Workspace identity, default workspace state, worktree identity/context, layout identity, and
  workspace tab state.
- Sessions, surfaces, messages, turns, queue rows, queue ordering indexes, and prompt-binding
  metadata.
- Generated context fingerprints and refresh state.
- Thread groups, handler objectives, reports, conclusion state, and episodes as persisted facts.
- Request-input request, question, option, answer, timeout, and queue-delivery facts.
- Command records, command output events, diagnostics, approval state, and command facts.
- Artifact metadata, physical artifact file-store persistence, immutable markers,
  source-command/thread/workflow linkage, and deleted state.
- Snippet records and transcript provenance.
- App logs, unread state, normalized error payloads, and related links.
- Durable title-generation job facts, title values, manual rename flags, and freeze state.
- Read-model selectors for desktop and non-desktop consumers, including Workflows generated-surface
  pane data.
- State migrations and recovery reads.

## Does Not Own

- Runtime queue execution, claim policy, retries, and delivery.
- pi sessions or model turns.
- Tool execution.
- Sandbox profile generation.
- Extension instruction composition or invocation.
- UI rendering.
- Smithers or Workflows extension guidance.
- Lifecycle invariants that are enforced by `@svvy/runtime` or `@svvy/extensions`; state persists
  their results.

## Public API Shape

Expected surface:

```ts
import { createStateStore } from "@svvy/state";

const state = createStateStore({ databasePath, secretStore });

await state.commands.appendEvent(...);
const workspace = await state.readModels.workspace({ workspaceId });
const runtimeState = state.runtimeStatePort();
const extensionState = state.extensionStatePort();
const sandboxPolicy = state.sandboxPolicyPort();
const artifactStore = state.artifactFileStorePort();
```

API groups:

- `settings`
- `providers`
- `workspaces`
- `worktrees`
- `sessions`
- `surfaces`
- `messages`
- `queues`
- `threads`
- `requests`
- `commands`
- `artifacts`
- `snippets`
- `logs`
- `titles`
- `readModels`
- `migrations`
- `transactions`

## State Rules

- Store authoritative facts, not UI guesses.
- Command facts are the source of truth for tool outcomes.
- Episodes are the source of truth for handler updates and conclusions.
- Logs are evidence and observability, not replacement command/session state.
- Secret values are stored only through secure storage ports and never returned through read models.
- Domain invariants are enforced by runtime/extension modules before state mutation when possible.
- State writes for one product event should be transactional.
- Queues are persisted transactionally in state, but runtime decides claiming, retry policy,
  delivery order, and recovery behavior.
- Worktree state is first-class: surfaces, handler threads, Shell/Smithers command cwd, defaults,
  and UI read models must be able to resolve the intended worktree explicitly.
- Artifact files are durable product state. State owns the file-store port and metadata; sandbox
  enforces immutable/generated boundaries; extensions only create validated artifact commands and
  facts.

## Dependency Rules

- Depends on `@svvy/contracts`.
- May depend on storage and secure-secret-store adapters.
- Must not depend on `@svvy/runtime`, `@svvy/extensions`, `@svvy/pi-host`, `@svvy/sandbox`,
  `@svvy/desktop`, Svelte, or Electrobun.

## Migration Sources

Initial extraction candidates:

- `src/bun/structured-session-state.ts`
- `src/bun/structured-session-selectors.ts`
- `src/bun/app-log-store.ts`
- `src/bun/snippet-library.ts`
- settings stores under `src/bun`
- `src/mainview/session-state.ts` selector logic that is not UI-specific
- read-model contracts in `src/shared/workspace-contract.ts`

## Tests

- Transactional write tests.
- Queue persistence and query-order tests.
- Runtime-facing queue recovery read tests.
- Worktree context selector tests.
- Artifact file-store persistence tests.
- Selector snapshot tests.
- Secret non-exposure tests.
- State migration tests.
- Tests proving state package does not execute commands, call pi, or render UI.
