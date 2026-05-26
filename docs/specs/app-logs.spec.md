# App Logs Spec

## Status

- Date: 2026-05-13
- Status: adopted direction for first-class app logs and live log inspection
- Scope:
  - define the app-owned logs model, API, sources, and severity taxonomy
  - define how logs are emitted across Bun, runtime services, and renderer surfaces
  - define the sidebar entry, unread counts, filters, and live logs pane UI
  - exclude Smithers node logs, raw workflow event streams, full prompt transcripts, and raw command output except as linked artifacts or inspector context

## Purpose

`svvy` needs a user-facing way to understand app behavior before adding notification surfaces.

The logs surface should answer:

- what did the app try to do
- what is currently failing or waiting
- whether a provider, title-generation job, workflow, prompt, renderer/RPC path, or saved workflow action needs attention
- where to inspect the related session, thread, workflow run, command, or artifact

This is product observability, not a developer console dump. Logs should be concise, structured, redacted, filterable, and live.

## Product Shape

The left sidebar gains a `Logs` button directly above `Workflows`.

The `Logs` button shows compact unread counts for action-worthy categories:

- warning count with the warning semantic color
- error count with the danger semantic color

Info logs still contribute to the logs pane's totals and filters, but the sidebar does not show an unread info badge.

Unread counts are based on log sequence numbers, not timestamps. Opening or focusing the app logs pane marks logs as seen through the current latest sequence.

Clicking `Logs` opens an app logs pane in the workspace shell. The pane is a dense workbench surface with filters, search, source selection, mark-read behavior, and a live-updating row list.

## Non-Goals

- Do not use app logs as the canonical source of Project CI, workflow, command, or session state.
- Do not infer product status from logs.
- Do not store raw prompts, API keys, OAuth tokens, auth headers, raw provider responses, full tool output, or full workflow logs in app logs.
- Do not replace existing structured session state, command inspectors, workflow inspectors, or artifacts.
- Do not rely on `electrobun-browser-tools` for production observability. Browser-tools is a dev/e2e/manual-inspection lane only and is absent from the production path.
- Do not create a second notification system yet. App logs are the prerequisite observability substrate.

## Log Model

Shared contracts belong in `src/shared/workspace-contract.ts`.

```ts
export type AppLogLevel = "info" | "warning" | "error";

export type AppLogSource =
  | "app.lifecycle"
  | "app.bridge"
  | "app.rpc"
  | "auth.provider"
  | "settings"
  | "workspace"
  | "session"
  | "session.title"
  | "surface"
  | "prompt"
  | "thread"
  | "smithers"
  | "workflow.library"
  | "workflow.run"
  | "workflow.task"
  | "project-ci"
  | "direct-tool"
  | "execute-typescript"
  | "artifact"
  | "external-editor"
  | "renderer";

export interface AppLogEntry {
  id: string;
  seq: number;
  createdAt: string;
  level: AppLogLevel;
  source: AppLogSource;
  message: string;
  details?: Record<string, unknown>;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
  workspaceSessionId?: string;
  surfacePiSessionId?: string;
  threadId?: string;
  workflowRunId?: string;
  workflowTaskAttemptId?: string;
  commandId?: string;
}

export interface AppLogSummary {
  latestSeq: number;
  seenSeq: number;
  unread: {
    total: number;
    info: number;
    warning: number;
    error: number;
  };
  totals: {
    total: number;
    info: number;
    warning: number;
    error: number;
  };
}

export interface AppLogQuery {
  levels?: AppLogLevel[];
  sources?: AppLogSource[];
  query?: string;
  afterSeq?: number;
  limit?: number;
}

export interface AppLogReadModel {
  entries: AppLogEntry[];
  summary: AppLogSummary;
}
```

Use `warning` in product contracts. Internal helpers may accept `warn` only as a convenience alias.

## Storage

Add a Bun-side app log store.

Suggested file:

- `src/bun/app-log-store.ts`

Responsibilities:

- append structured log entries
- allocate monotonic `seq`
- query by level, source, text, and `afterSeq`
- summarize totals and unread counts
- persist `seenSeq`
- redact sensitive values before persistence and before renderer delivery
- retain a bounded in-memory ring for live updates
- persist a bounded workspace-scoped SQLite history so recent logs survive restart

The first implementation should retain enough history for real debugging without becoming unbounded product data. A practical default is:

- keep the latest 2,000 entries in memory
- persist the latest 10,000 entries or the latest 7 days, whichever is smaller

If retention is configurable later, it belongs in app settings, not in the logs pane itself.

## Redaction

The app log store must redact likely secrets before storing entries.

At minimum redact:

- provider API keys
- OAuth access and refresh tokens
- auth headers
- cookie headers
- env var values whose key includes `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `AUTH`
- bearer tokens
- long high-entropy strings when attached to auth or provider fields

Ordinary filesystem paths and workspace cwd values are not secrets and must remain visible. If the app logs workspace cwd during startup, the detail key is `workspaceCwd`, not `workspaceId`.

Do not log full prompt text by default. Use a summary such as message count, character count, target surface, provider, model, and related ids.

## Logger API

Create one app logger per backend workspace runtime and route product logs through the runtime that owns the action. Duplicate same-cwd workspace tabs share that backend workspace runtime and therefore share the same workspace app log stream; visual tab identity may be included as context when useful, but it must not create an isolated log store.

Suggested API:

```ts
appLog.info(source, message, details?)
appLog.warning(source, message, details?)
appLog.error(source, message, errorOrDetails?, details?)
```

The logger should:

- append to the app log store
- send live log updates to the renderer
- normalize thrown errors into `{ name, message, stack }`
- accept related ids without burying them inside opaque `details`

User-facing app logs should be emitted through the app logger from product call sites. Non-production `electrobun-browser-tools` instrumentation may feed external automation, but it is not part of the production app-log contract and must not be required for production observability.

## RPC And Live Updates

Add requests to `ChatRPCSchema.bun.requests`:

```ts
getAppLogs: {
  params: AppLogQuery | undefined;
  response: AppLogReadModel;
}
getAppLogSummary: {
  params: undefined;
  response: AppLogSummary;
}
markAppLogsSeen: {
  params: {
    throughSeq: number;
  }
  response: AppLogSummary;
}
```

Add webview message:

```ts
sendAppLogUpdate: {
  entries: AppLogEntry[];
  summary: AppLogSummary;
};
```

Renderer behavior:

- fetch initial summary during workspace bootstrap
- fetch entries when the logs pane opens
- apply `sendAppLogUpdate` incrementally
- call `markAppLogsSeen` when the pane opens or gains focus
- avoid polling for normal live behavior

## Pane Target

Add a static pane target:

```ts
{ workspaceSessionId?: string; surface: "app-logs" }
```

The logs pane is workspace-scoped. It may optionally carry `workspaceSessionId` only when opened from a session-context action, but the default sidebar button opens the workspace-wide logs view.

## Sidebar UI

The sidebar button belongs directly above `Workflows`.

Visual rules:

- use an existing lucide log/list icon, such as `Logs`, `ListTree`, or closest available equivalent
- label is `Logs`
- show compact warning and error unread indicators on the right
- cap displayed counts at `99+`
- hide zero categories
- use tabular numerals
- use semantic colors from the design system:
  - warning: `--ui-warning`
  - error: `--ui-danger`
- when unread errors exist, the row may receive subtle danger emphasis, but must not become a loud alert block

The row should use the existing sidebar action row density and focus behavior.

## Logs Pane UI

The logs pane is a dense workbench panel, not a modal.

Toolbar:

- segmented level filter: `All`, `Info`, `Warnings`, `Errors`
- search input
- source dropdown or compact multi-select
- `Mark all read`
- `Copy all logs` icon button with the shared tooltip treatment and a first-use warning dialog that tells the user to review copied logs before public sharing because automated redaction is best-effort
- the copy-all warning includes a `Don't show this again` checkbox that suppresses future warnings on that device
- `Live` / `Frozen` toggle button for explicit tail-following control, defaulting to `Live`

Virtualized list behavior:

- render the log row list with TanStack Virtual so retained histories can be browsed without mounting every row
- use TanStack Virtual's native end anchoring for tail-following and explicit latest jumps, including `anchorTo: "end"` and `scrollToEnd`, rather than deriving product behavior from manual per-row scroll math
- use a stable virtual item key derived from the log entry sequence number
- support variable-height rows because expanded details, stack traces, JSON details, and related chips can change row height
- remeasure rows after expansion, collapse, filtering, search changes, older-page loading, and live entry insertion
- preserve the user's scroll anchor when filters change, rows expand or collapse, older entries load, or entries arrive while the pane is frozen or not pinned to bottom
- keep keyboard focus, row expansion state, copy controls, and related-link actions stable across virtual row recycling

List rows:

- timestamp
- level icon or compact badge
- source badge
- message
- row-level copy button with the shared tooltip treatment
- related context chips when available:
  - session
  - surface
  - thread
  - workflow run
  - workflow task
  - command

Expanded row details:

- clicking anywhere on the log row toggles expansion, except nested related-link and copy controls
- first-class related ids such as session, surface, thread, workflow, task, and command appear as structured facts even when they are stripped from the raw `details` object
- formatted JSON details
- normalized error block
- stack trace when present
- related id links when the relevant inspector exists

Live behavior:

- `Live` mode means the pane follows the tail only while the user is pinned to the bottom
- scrolling only changes derived bottom-pinned viewport state and never toggles `Live` or `Frozen`
- `Frozen` mode keeps the visible list stable while new entries accumulate behind the `New logs` affordance
- if the user is at the bottom in `Live` mode, new entries keep the virtual list pinned to the live tail
- if the user scrolls away from bottom in `Live` mode, new entries do not steal scroll and the pane shows the `New logs` affordance
- if the user switches to `Frozen`, new entries never move the current viewport until the user explicitly resumes live tailing or activates `New logs`
- activating `New logs` scrolls to the newest matching entry with smooth motion unless the user prefers reduced motion, in which case the jump is immediate, and returns the pane to tail-following `Live` behavior
- opening or focusing the pane marks logs seen through the current latest sequence

Empty states:

- no logs yet: `No app logs yet.`
- no filter matches: `No logs match these filters.`

## What Must Log

### Info

- app startup completed
- workspace cwd resolved
- branch resolved
- renderer/RPC bridge initialized for the workspace runtime
- workspace path index refresh started and completed with counts
- session created, opened, forked, pinned, archived, unarchived, deleted
- surface opened and closed
- model or reasoning changed for a surface
- prompt requested, started, finished, cancelled
- title generation queued, started, completed
- handler thread created, opened, handoff emitted
- Smithers runtime initialized
- workflow registry scanned
- workflow run launched, resumed, completed, cancelled
- saved workflow library read
- saved workflow validation completed
- workflow source opened in external editor
- provider auth updated or removed, without secrets
- Project CI run detected or projected
- artifact created or attached

### Warning

- configured provider is not connected for an attempted operation
- namer provider is missing, invalid, or unavailable
- title generation returned an empty or generic title
- title generation failed but did not block the main prompt turn
- saved workflow validation returned diagnostics
- workflow registry is empty when an action expected runnable entries
- workspace path index skipped unreadable paths
- external editor is unavailable or failed recoverably
- prompt or context reconstruction omitted unavailable structured context
- Smithers run entered waiting, approval, or troubleshooting state
- renderer bridge reconnect or retry occurred
- non-fatal RPC validation issue

### Error

- app bootstrap failure
- uncaught RPC handler exception
- prompt failed from provider or pi runtime error
- provider auth refresh failed
- session create, open, fork, rename, archive, delete, or restore failed
- surface lifecycle failed
- title-generation model error
- Smithers runtime startup, run, watch, resume, or cancellation failed
- workflow task-agent failed
- direct tool execution failed
- `execute_typescript` compile or runtime failed
- artifact persistence failed
- structured session state SQLite read or write failed
- saved workflow deletion or validation internal failure
- Project CI projection or storage failed

## What Must Not Log

- every streamed token
- every normal workspace sync
- every hover, click, focus, or local UI-only interaction
- raw API keys or tokens
- full prompt text
- full assistant transcript
- full tool output
- full workflow logs
- large JSON payloads already available in inspectors or artifacts

When more detail exists elsewhere, logs should link to the durable inspector or artifact instead of duplicating it.

## Implementation Contract

The shipped app logs surface is made of:

- shared `AppLogEntry`, `AppLogSummary`, `AppLogQuery`, `AppLogReadModel`, and `surface: "app-logs"` contracts
- a Bun-side app log store with append, query, summary, seen-state, redaction, bounded retention, SQLite persistence, and live subscriptions
- one app logger per backend workspace runtime, with renderer delivery through `sendAppLogUpdate`
- RPC handlers for `getAppLogs`, `getAppLogSummary`, and `markAppLogsSeen`
- production product call sites routed through the app logger, while `electrobun-browser-tools` remains outside the production observability contract
- renderer app-log state in the chat runtime/bootstrap path
- the sidebar `Logs` button with unread counts above `Workflows`
- `AppLogsPane.svelte` and Dockview routing for the app logs target
- a TanStack Virtual row list using stable sequence keys, variable-height measurement, older-page loading, native end anchoring, explicit smooth jump-to-latest with reduced-motion fallback, and Live/Frozen no-scroll-stealing semantics

## Testing Requirements

Unit tests:

- app log store increments seq monotonically
- unread counts update by level
- `markAppLogsSeen` clears unread through the requested seq
- query filters by level, source, text, and `afterSeq`
- redaction removes representative secret shapes
- retention trims old entries without breaking seq

Renderer tests:

- sidebar shows no badges with zero unread
- sidebar shows per-level unread badges
- logs pane renders entries and filters levels
- search filters rows
- opening the pane marks logs seen
- live updates append without losing filters

Integration tests:

- missing provider during prompt produces a warning or error log and visible unread badge
- prompt failure produces an error log with related session/surface ids
- title generation failure produces a `session.title` warning or error log
- saved workflow validation diagnostics produce warning logs

E2E tests should use the OrbStack machine lane via `bun run test:e2e` when added.
